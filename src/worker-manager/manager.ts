/**
 * WorkerManager —— 真的管理真工人。
 *
 * 每个工人是一个 CLI subprocess（通过 sup-runtime 的 Adapter spawn），
 * 持有在 WorkerManager 的 Map 里。事件从 session.events() 的 async
 * iterator 流出来，我们开一个后台 reader task 把事件 push 到 worker 的
 * 环形缓冲里。
 *
 * 和 mock-daemon 的关键区别：
 * - 状态不是硬编码种子，是实时观测到的真状态
 * - spawn/kill/send 都是对真 CLI 进程的操作，不是改内存对象
 * - token 估算依然粗糙（因为 CLI 不一定每次都给 usage），但事件数是真的
 */

import type { CliAdapter, RunningSession, CanonicalEvent } from '../sup-runtime/types.js';
import type {
  IWorkerManager,
  PeekEventRow,
  ReadEventResult,
  StoredEvent,
  WorkerInfo,
} from './types.js';

const EVENT_BUFFER_MAX = 500;

interface WorkerEntry {
  info: WorkerInfo;
  session: RunningSession;
  events: StoredEvent[];
}

export class WorkerManager implements IWorkerManager {
  private readonly workers = new Map<string, WorkerEntry>();
  private readonly notes = new Map<string, string>();
  private readonly adapter: CliAdapter;
  private readonly adapterName: string;
  private readonly workerCwdRoot: string;
  /** 订阅者：在任何工人状态变化时被调用 */
  private readonly listeners = new Set<() => void>();
  private nextEventId = 1;

  constructor(opts: { adapter: CliAdapter; adapterName: string; workerCwdRoot: string }) {
    this.adapter = opts.adapter;
    this.adapterName = opts.adapterName;
    this.workerCwdRoot = opts.workerCwdRoot;
  }

  /** TUI 订阅：当有工人状态/事件变化时，触发回调（防抖由 TUI 层做） */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }

  // ─── 读 ───────────────────────────────────────

  listWorkers(): WorkerInfo[] {
    return [...this.workers.values()].map((e) => ({ ...e.info }));
  }

  getWorker(name: string): WorkerInfo | null {
    const entry = this.workers.get(name);
    return entry ? { ...entry.info } : null;
  }

  peekEvents(
    name: string,
    opts: { since?: string; limit?: number } = {},
  ): PeekEventRow[] | null {
    const entry = this.workers.get(name);
    if (!entry) return null;
    const limit = opts.limit ?? 20;
    let events = entry.events;
    if (opts.since) {
      const idx = events.findIndex((e) => e.id === opts.since);
      if (idx !== -1) events = events.slice(idx + 1);
    }
    return events.slice(-limit).map((e) => ({
      id: e.id,
      type: e.type,
      toolName: e.toolName,
      size: e.size,
      preview: e.preview,
      ts: e.ts.toISOString(),
    }));
  }

  readEvent(eventId: string): ReadEventResult | null {
    for (const entry of this.workers.values()) {
      const e = entry.events.find((ev) => ev.id === eventId);
      if (e) {
        return {
          id: e.id,
          workerName: e.workerName,
          type: e.type,
          toolName: e.toolName,
          body: e.body,
          ts: e.ts.toISOString(),
        };
      }
    }
    return null;
  }

  getSummary(name: string): string | null {
    return this.workers.get(name)?.info.summary ?? null;
  }

  updateSummary(name: string, text: string): boolean {
    const entry = this.workers.get(name);
    if (!entry) return false;
    entry.info.summary = text;
    this.notify();
    return true;
  }

  note(key: string, text: string): { ok: true } {
    this.notes.set(key, text);
    return { ok: true };
  }

  getNote(key: string): string | null {
    return this.notes.get(key) ?? null;
  }

  // ─── 行动 ─────────────────────────────────────

  async sendToWorker(
    name: string,
    message: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.workers.get(name);
    if (!entry) return { ok: false, error: `找不到工人 "${name}"` };
    if (entry.info.state === 'stopped') {
      return { ok: false, error: `工人 "${name}" 已停止，不能发消息` };
    }
    try {
      await entry.session.sendUserMessage(message);
      entry.info.lastActivity = new Date();
      if (entry.info.state === 'idle') entry.info.state = 'running';
      this.notify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendInterrupt(
    name: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.workers.get(name);
    if (!entry) return { ok: false, error: `找不到工人 "${name}"` };
    try {
      await entry.session.sendInterrupt();
      entry.info.state = 'idle';
      entry.info.currentAction = null;
      entry.info.lastActivity = new Date();
      this.notify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async spawnWorker(
    name: string,
    cwd: string,
    initialPrompt: string,
  ): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    if (this.workers.has(name)) {
      return { ok: false, error: `工人 "${name}" 已存在` };
    }

    let session: RunningSession;
    try {
      session = await this.adapter.spawn({
        // 工人用 CLI 自己的默认 coding agent prompt，空字符串表示"不覆盖"
        systemPrompt: '',
        cwd,
        // 工人不需要访问 cowork 的 MCP 工具（那是总管的事）
        mcpServers: {},
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const info: WorkerInfo = {
      name,
      cwd,
      initialPrompt,
      adapterName: this.adapterName,
      state: 'starting',
      pid: session.pid,
      cliSessionId: session.cliSessionId,
      lastActivity: new Date(),
      tokenUsed: 0,
      currentAction: null,
      eventCount: 0,
      summary: '',
    };

    const entry: WorkerEntry = {
      info,
      session,
      events: [],
    };
    this.workers.set(name, entry);

    // 后台读 session.events()，push 到 events 缓冲、更新 info
    void this.readEventLoop(entry);

    // 把初始任务作为第一条 user message 发给工人
    // （注意这里不等待 session idle —— spawn 立即返回，工人后台开工）
    try {
      await session.sendUserMessage(initialPrompt);
      entry.info.state = 'running';
    } catch (err) {
      // 回滚：zombie entry 会让下次同名 spawn 报"已存在"，必须从 map 删掉
      // 同时把刚 spawn 出来的 session 停了，别漏进程
      this.workers.delete(name);
      try { await session.stop({ timeoutMs: 1000 }); } catch { /* ignore */ }
      this.notify();
      return { ok: false, error: `启动初始任务失败: ${err instanceof Error ? err.message : err}` };
    }

    this.notify();
    return { ok: true, name };
  }

  async killWorker(
    name: string,
    graceful: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const entry = this.workers.get(name);
    if (!entry) return { ok: false, error: `找不到工人 "${name}"` };
    // 幂等：已 stopped 就直接返回成功，不要再等 3s timeout
    if (entry.info.state === 'stopped') return { ok: true };
    try {
      if (graceful) {
        await entry.session.stop({ timeoutMs: 3000 });
      } else {
        await entry.session.stop({ timeoutMs: 0 });
      }
      entry.info.state = 'stopped';
      entry.info.currentAction = null;
      this.notify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 所有工人都停掉（进程退出时清理） */
  async stopAll(): Promise<void> {
    const promises: Promise<unknown>[] = [];
    for (const entry of this.workers.values()) {
      if (entry.info.state !== 'stopped') {
        promises.push(entry.session.stop({ timeoutMs: 2000 }).catch(() => {}));
      }
    }
    await Promise.all(promises);
  }

  // ─── 后台事件 reader ──────────────────────────

  private async readEventLoop(entry: WorkerEntry): Promise<void> {
    try {
      for await (const event of entry.session.events()) {
        this.ingestEvent(entry, event);
        this.notify();
      }
    } catch {
      // iterator 异常（session 进程异常退出、pipe 断裂等）
    }
    entry.info.state = 'stopped';
    entry.info.currentAction = null;
    this.notify();
  }

  private ingestEvent(entry: WorkerEntry, event: CanonicalEvent): void {
    const stored = this.canonicalToStored(entry.info.name, event);
    if (!stored) return;

    entry.events.push(stored);
    if (entry.events.length > EVENT_BUFFER_MAX) {
      entry.events.splice(0, entry.events.length - EVENT_BUFFER_MAX);
    }
    entry.info.eventCount++;
    entry.info.lastActivity = stored.ts;

    // 状态机更新
    switch (event.type) {
      case 'session_started':
        entry.info.cliSessionId = event.cliSessionId;
        entry.info.state = 'running';
        break;
      case 'tool_call':
        entry.info.currentAction = shortToolName(event.toolName);
        entry.info.state = 'running';
        break;
      case 'tool_result':
        // 工具结束，清当前 action
        entry.info.currentAction = null;
        break;
      case 'turn_completed':
        entry.info.state = 'idle';
        entry.info.currentAction = null;
        break;
      case 'session_error':
        if (event.fatal) {
          entry.info.state = 'blocked';
        }
        break;
      case 'session_stopped':
        entry.info.state = 'stopped';
        entry.info.currentAction = null;
        break;
      default:
        break;
    }

    // 估算 token：每条 assistant_text 按字数估，每个 tool_call 加 20
    if (event.type === 'assistant_text') {
      entry.info.tokenUsed += Math.ceil(event.text.length / 3);
    } else if (event.type === 'tool_call') {
      entry.info.tokenUsed += 20;
    }
  }

  private canonicalToStored(
    workerName: string,
    event: CanonicalEvent,
  ): StoredEvent | null {
    const mkId = (): string => `evt_${String(this.nextEventId++).padStart(5, '0')}`;

    switch (event.type) {
      case 'session_started':
        return {
          id: mkId(),
          workerName,
          type: 'status_change',
          preview: `session started: ${event.cliSessionId.slice(0, 16)}`,
          body: { cliSessionId: event.cliSessionId },
          size: 0,
          ts: event.ts,
        };

      case 'assistant_text':
        return {
          id: mkId(),
          workerName,
          type: 'assistant_text',
          preview: preview80(event.text),
          body: event.text,
          size: event.text.length,
          ts: event.ts,
        };

      case 'tool_call':
        return {
          id: mkId(),
          workerName,
          type: 'tool_call',
          toolName: event.toolName,
          preview: preview80(`${event.toolName}(${JSON.stringify(event.input)})`),
          body: { toolName: event.toolName, input: event.input },
          size: JSON.stringify(event.input).length,
          ts: event.ts,
        };

      case 'tool_result': {
        const serialized = typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
        return {
          id: mkId(),
          workerName,
          type: 'tool_result',
          preview: (event.isError ? '[err] ' : '') + preview80(serialized),
          body: event.output,
          size: serialized.length,
          ts: event.ts,
        };
      }

      case 'turn_completed':
        return {
          id: mkId(),
          workerName,
          type: 'completion',
          preview: `turn ${event.stopReason}`,
          body: { stopReason: event.stopReason },
          size: 0,
          ts: event.ts,
        };

      case 'session_error':
        return {
          id: mkId(),
          workerName,
          type: 'error',
          preview: preview80(event.message),
          body: { message: event.message, fatal: event.fatal },
          size: event.message.length,
          ts: event.ts,
        };

      case 'session_stopped':
        return {
          id: mkId(),
          workerName,
          type: 'status_change',
          preview: `stopped exit=${event.exitCode}`,
          body: { exitCode: event.exitCode, signal: event.signal },
          size: 0,
          ts: event.ts,
        };

      case 'assistant_text_delta':
      case 'thinking':
        return null;
    }
  }
}

function preview80(s: string): string {
  const single = s.replace(/\s+/g, ' ').trim();
  if (single.length <= 80) return single;
  return single.slice(0, 77) + '…';
}

function shortToolName(name: string): string {
  // "bash" → "Bash", "mcp__xxx__yyy" → "yyy"
  const m = name.match(/^(?:mcp__)?[\w-]+__([\w-]+)$/);
  if (m && m[1]) return cap(m[1]);
  if (name.includes('.')) {
    const parts = name.split('.');
    return cap(parts[parts.length - 1] ?? name);
  }
  return cap(name);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
