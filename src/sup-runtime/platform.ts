/**
 * 跨平台小工具 —— 被多个 adapter 共享。
 *
 * 为什么不放在 base.ts：base.ts 是 BaseRunningSession 那个类，只和
 * "活着的 session" 相关。这里的是启动前的辅助函数（找二进制、跑短命令
 * 拿输出），概念上不一样。
 */

import { existsSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import crossSpawn from 'cross-spawn';

/**
 * 在 PATH 中找一个 CLI 二进制。
 *
 * Windows 上 npm 全局安装的 CLI 通常是 `.cmd`（batch 文件），Node 的
 * child_process.spawn 不会自动根据 PATHEXT 加扩展名。我们显式枚举
 * 常见扩展名。
 */
export function findCliBinary(baseName: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = pathEnv.split(sep).filter(Boolean);

  const candidates =
    process.platform === 'win32'
      ? [`${baseName}.cmd`, `${baseName}.exe`, `${baseName}.bat`, baseName]
      : [baseName];

  for (const dir of dirs) {
    for (const cand of candidates) {
      const full = joinPath(dir, cand);
      try {
        if (existsSync(full)) return full;
      } catch {
        /* 权限问题等继续 */
      }
    }
  }
  return null;
}

/**
 * 跑一个短命令，收集 stdout 返回。
 *
 * 用 cross-spawn 是为了正确处理 Windows `.cmd` 文件的 spawn 问题
 * （CVE-2024-27980 后 Node 禁止直接 spawn .cmd 文件，cross-spawn 包了
 * 一层 cmd.exe 调用并做正确转义）。
 */
export function runForOutput(
  bin: string,
  args: string[],
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* noop */
      }
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit ${code}: ${err || out}`));
    });
  });
}
