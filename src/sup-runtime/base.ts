/**
 * BaseRunningSession —— 所有 adapter 的 RunningSession 实现共享的基类。
 *
 * 把两种东西提出来：
 * 1. 事件队列 + async iterator 的实现（单消费者 pull 模型）
 * 2. 子进程生命周期管理（wait / stop 的 Promise 包装）
 *
 * 具体 adapter 只需要继承此类，实现 sendUserMessage / sendInterrupt / stop，
 * 并在拿到 CLI 事件时调 protected 的 enqueueEvent() / markStopped()。
 */

import type { ChildProcess } from 'node:child_process';
import { spawn as nativeSpawn } from 'node:child_process';
import { track as trackPid, untrack as untrackPid } from './process-registry.js';
import type {
  CanonicalEvent,
  RunningSession,
  SessionExitInfo,
} from './types.js';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Windows 专用：杀进程树。cross-spawn 跑 .cmd 时套了一层 cmd.exe，
 * child.kill 只能杀掉 cmd.exe，下面真正的 CLI 进程会成孤儿。
 * 用 taskkill /T /F 才能整棵树清掉。
 *
 * 注意：Windows console 进程对 WM_CLOSE（taskkill 不带 /F）几乎不响应，
 * graceful 模式实际是 theater —— 都得等到 timeout 才真死。这里直接 /F
 * 一次到位，TerminateProcess 不给清理机会，但 cowork 的 CLI 子进程都是
 * stateless 的（codex/claude 没有自己的需要 flush 的状态），可以接受。
 */
function killTreeWindows(pid: number): void {
  if (pid <= 0) return;
  try {
    const child = nativeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

type Waiter = {
  resolve: (v: IteratorResult<CanonicalEvent>) => void;
};

export abstract class BaseRunningSession implements RunningSession {
  public readonly cliName: string;
  public readonly pid: number;
  public cliSessionId: string | null = null;

  protected readonly child: ChildProcess;
  private readonly eventQueue: CanonicalEvent[] = [];
  private readonly waiters: Waiter[] = [];
  private streamDone = false;

  private exitInfo: SessionExitInfo | null = null;
  private readonly exitPromise: Promise<SessionExitInfo>;

  constructor(cliName: string, child: ChildProcess) {
    this.cliName = cliName;
    this.child = child;
    this.pid = child.pid ?? -1;

    // 注册到全局表，process.on('exit') 兜底 taskkill 用
    trackPid(this.pid);

    // child.stdin 必须挂 error listener，否则在 pipe 已关闭后继续 write
    // 会抛 EPIPE，node 因无 listener 直接 crash 整个进程。
    // 这里把任何 stdin/stdout/stderr 的 io 错误吞掉：真正的异常会通过
    // child 的 exit 事件反映出来，不需要 stdin.error 再通知一遍。
    if (child.stdin) child.stdin.on('error', () => {});
    if (child.stdout) child.stdout.on('error', () => {});
    if (child.stderr) child.stderr.on('error', () => {});
    child.on('error', () => {});

    this.exitPromise = new Promise<SessionExitInfo>((resolve) => {
      child.on('exit', (code, signal) => {
        this.exitInfo = { code, signal };
        untrackPid(this.pid);
        this.enqueueEvent({
          type: 'session_stopped',
          exitCode: code,
          signal,
          ts: new Date(),
        });
        // 先让事件流把 session_stopped 派送出去，再标记结束。
        // 这样 for await 的消费者能看到这条事件，而不是直接 done。
        queueMicrotask(() => {
          this.markStreamDone();
          resolve(this.exitInfo!);
        });
      });
    });
  }

  // ─── 事件流 ───────────────────────────────────

  protected enqueueEvent(event: CanonicalEvent): void {
    if (this.streamDone) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: event });
    } else {
      this.eventQueue.push(event);
    }
  }

  protected markStreamDone(): void {
    if (this.streamDone) return;
    this.streamDone = true;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w.resolve({ done: true, value: undefined });
    }
  }

  public events(): AsyncIterable<CanonicalEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<CanonicalEvent> {
        return {
          next(): Promise<IteratorResult<CanonicalEvent>> {
            // 1. 队列里有就直接拿
            if (self.eventQueue.length > 0) {
              return Promise.resolve({
                done: false,
                value: self.eventQueue.shift()!,
              });
            }
            // 2. 流已结束
            if (self.streamDone) {
              return Promise.resolve({ done: true, value: undefined });
            }
            // 3. 等下一条
            return new Promise<IteratorResult<CanonicalEvent>>((resolve) => {
              self.waiters.push({ resolve });
            });
          },
        };
      },
    };
  }

  // ─── 生命周期 ───────────────────────────────────

  public wait(): Promise<SessionExitInfo> {
    return this.exitPromise;
  }

  protected async stopProcess(opts: { timeoutMs?: number } = {}): Promise<void> {
    if (this.exitInfo) return;

    const timeoutMs = opts.timeoutMs ?? 3000;

    if (IS_WINDOWS) {
      // Windows 直接 taskkill /T /F —— graceful 在 console 进程上不工作
      killTreeWindows(this.pid);
    } else {
      // Unix 给 CLI 一次 SIGINT 机会，不行再 SIGKILL
      try { this.child.kill('SIGINT'); } catch { /* ok */ }
    }

    // 到点还没死就强杀（Unix；Windows 上 /F 已经是强杀，timer 是兜底）
    const timer = setTimeout(() => {
      if (IS_WINDOWS) {
        killTreeWindows(this.pid); // 再 /F 一次防漏
      } else {
        try { this.child.kill('SIGKILL'); } catch { /* ok */ }
      }
    }, timeoutMs);

    try {
      await this.exitPromise;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── 必须由子类实现的 ───────────────────────────────────

  abstract sendUserMessage(text: string): Promise<void>;
  abstract sendInterrupt(): Promise<void>;
  abstract stop(opts?: { timeoutMs?: number }): Promise<void>;
}
