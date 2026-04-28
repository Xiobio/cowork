/**
 * 进程注册表 —— 兜底清理被 cowork spawn 出来的 CLI 子进程。
 *
 * 正常退出时 BaseRunningSession.stopProcess + WorkerManager.stopAll 会
 * 把所有进程清掉。但有几种异常退出 path：
 *
 * 1. 用户在 Windows 直接点终端窗口的红 X
 * 2. 父进程被外部 SIGKILL（kill -9）
 * 3. node 自己 panic
 * 4. cleanup 里某一步 throw 了，剩下的进程没轮到处理
 *
 * 这些情况下 Node 子进程会变成孤儿。Windows 上尤其严重 ——
 * cross-spawn 跑 .cmd 时套了一层 cmd.exe，杀 cmd.exe 不会传递给真正
 * 的 codex/claude.exe，于是孤儿进程一堆堆吃 CPU。
 *
 * 这里提供一个 process-level Set，每个 BaseRunningSession 启动时 track
 * 自己的 pid，退出时 untrack。process.on('exit') 时调 killAllSync() 用
 * 同步 taskkill /F 把残留全部 nuke 掉。
 */

import { spawnSync } from 'node:child_process';

const tracked = new Set<number>();
const IS_WINDOWS = process.platform === 'win32';

/**
 * Windows 启动时清扫孤儿：上一次 cowork 异常退出可能漏了几个 codex.exe /
 * claude.exe 在外面跑（cross-spawn 的 cmd.exe 链 + codex 自己 detach）。
 * 这里用 CommandLine pattern 精确匹配 cowork 风格的调用：
 * - claude.exe 带 `--input-format stream-json` 的（普通交互 claude 不会有）
 * - codex.exe 带 `app-server` 的
 * 父进程不在了的才杀，不会误伤用户当前在跑的 CLI。
 *
 * 不报错；找不到 powershell 或 wmic 就静默跳过。
 */
export function cleanupOrphansSync(): { killed: number; scanned: number } {
  if (!IS_WINDOWS) return { killed: 0, scanned: 0 };
  try {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='codex.exe'" | ` +
          `Where-Object { ` +
          `(-not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue)) ` +
          `-and ($_.CommandLine -match 'stream-json' -or $_.CommandLine -match 'app-server') ` +
          `} | ` +
          `Select-Object -ExpandProperty ProcessId`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    if (ps.status !== 0) return { killed: 0, scanned: 0 };
    const pids = (ps.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
    let killed = 0;
    for (const pid of pids) {
      const r = spawnSync('taskkill', ['/PID', String(pid), '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (r.status === 0) killed++;
    }
    return { killed, scanned: pids.length };
  } catch {
    return { killed: 0, scanned: 0 };
  }
}

export function track(pid: number): void {
  if (pid > 0) tracked.add(pid);
}

export function untrack(pid: number): void {
  tracked.delete(pid);
}

export function listTracked(): number[] {
  return [...tracked];
}

/**
 * 同步杀光所有 tracked pid。process.on('exit') 里用 —— 那个回调
 * 不能 await，所以必须用 spawnSync。
 */
export function killAllSync(): void {
  if (tracked.size === 0) return;
  const pids = [...tracked];
  tracked.clear();
  for (const pid of pids) {
    try {
      if (IS_WINDOWS) {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }
    } catch {
      /* ignore，最多就是漏一个 */
    }
  }
}

let installed = false;
/**
 * 在 main 进程初始化时调用一次。注册 process.on('exit') / 'SIGHUP' 等
 * 的同步兜底。重复调用安全。
 *
 * 同时启动 parent watchdog：每 10s 检查一次父进程是否还活，没活就自杀。
 * 这是 Windows 上 cowork main 自己不被漏掉的关键 —— 终端关闭后 npm/cmd.exe
 * 的 SIGHUP 在 Windows 上传不可靠，靠 watchdog 兜底。
 */
export function installSafetyNet(): void {
  if (installed) return;
  installed = true;
  process.on('exit', () => killAllSync());
  process.on('SIGHUP', () => {
    killAllSync();
    process.exit(129);
  });

  const ppid = process.ppid;
  if (ppid && ppid > 0) {
    const timer = setInterval(() => {
      try {
        // process.kill(pid, 0) = "is alive" 探测，不真发信号
        process.kill(ppid, 0);
      } catch {
        // 父进程死了 —— 终端被关 / npm 异常退出 / 其它，自杀别留 zombie
        killAllSync();
        process.exit(0);
      }
    }, 10_000);
    timer.unref(); // 不阻止正常退出
  }
}

/**
 * 强力清扫：找所有"node dist/index.js" 风格的 cowork main 进程（除自己外），
 * 用 taskkill /T /F 杀树。给 --clean-orphans 用，crud 但管用。
 * 返回杀掉数量。
 */
export function killOtherCoworkMainsSync(): { killed: number; pids: number[] } {
  if (!IS_WINDOWS) return { killed: 0, pids: [] };
  try {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
          `Where-Object { $_.CommandLine -match 'dist[\\\\/]index\\.js' -and $_.ProcessId -ne ${process.pid} } | ` +
          `Select-Object -ExpandProperty ProcessId`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    if (ps.status !== 0) return { killed: 0, pids: [] };
    const pids = (ps.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
    let killed = 0;
    for (const pid of pids) {
      const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (r.status === 0) killed++;
    }
    return { killed, pids };
  } catch {
    return { killed: 0, pids: [] };
  }
}
