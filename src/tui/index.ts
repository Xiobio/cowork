/**
 * TUI 入口 —— 从 index.ts 调用。
 *
 * 负责：
 * 1. Spawn 总管 Sup session（用 main 传来的 adapter + mcpServers）
 * 2. 渲染 React App（把 WorkerManager 直接传给 App，同进程访问）
 * 3. 清理：用户退出时停掉 Sup session 和 Ink 渲染
 *    （注意 WorkerManager / IpcServer 的生命周期由 main 管，不在这里）
 */

import React from 'react';
import { render, renderToString } from 'ink';

import type { CliAdapter, McpServerConfig, RunningSession, SpawnOptions } from '../sup-runtime/types.js';
import { Supervisor, SUPERVISOR_SYSTEM_PROMPT } from '../supervisor.js';
import type { WorkerManager } from '../worker-manager/manager.js';
import type { SessionBundle, SessionMeta } from '../session/storage.js';
import { updateMeta } from '../session/storage.js';
import { App } from './App.js';

export interface TuiOptions {
  adapter: CliAdapter;
  manager: WorkerManager;
  mcpServers: Record<string, McpServerConfig>;
  /** 快照模式：不开交互，只渲染初始帧到 stdout 然后退出 */
  snapshot?: boolean;
  /** session 引导结果：meta 必须，bundle 只在 resume 场景下非空 */
  session: {
    bundle: SessionBundle | null;
    meta: SessionMeta;
    resumed: boolean;
  };
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const { adapter, manager, mcpServers } = opts;

  const probe = await adapter.probe();
  if (!probe.installed) {
    console.error(`错误: ${adapter.displayName} 未安装或无法运行`);
    console.error(`原因: ${probe.error ?? 'unknown'}`);
    process.exit(1);
  }


  // Spawn Sup session。如果之前的 session meta 里有 supCliSessionId，
  // 先试 resume；resume 失败（比如 id 过期 / CLI 拒绝）就 fallback 到新开。
  const resumeId = opts.session.resumed ? opts.session.meta.supCliSessionId ?? null : null;

  let session: RunningSession;
  try {
    session = await spawnSupWithResume(adapter, {
      systemPrompt: SUPERVISOR_SYSTEM_PROMPT,
      cwd: process.cwd(),
      mcpServers,
      resumeCliSessionId: resumeId,
    });
  } catch (err) {
    console.error('启动 Sup 失败:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 把本次 CLI session id 写回 meta，下次 resume 用
  // 注意：session.cliSessionId 可能要等第一个 session_started 事件才填上，
  // 这里尝试读一下，填不上也没事，App 里还会再 updateMeta 一次。
  if (session.cliSessionId) {
    updateMeta(process.cwd(), opts.session.meta.id, {
      supCliSessionId: session.cliSessionId,
    });
  }

  const supervisor = new Supervisor(session);

  const onExit = async (): Promise<void> => {
    try {
      await supervisor.stop();
    } catch {
      /* ignore */
    }
  };

  if (opts.snapshot) {
    try {
      const output = renderToString(
        React.createElement(App, {
          adapter: { name: adapter.name, displayName: adapter.displayName },
          session,
          supervisor,
          manager,
          onExit,
          persistence: opts.session,
        }),
        { columns: process.stdout.columns ?? 100 },
      );
      console.log(output);
    } finally {
      await onExit();
    }
    return;
  }

  const ink = render(
    React.createElement(App, {
      adapter: { name: adapter.name, displayName: adapter.displayName },
      session,
      supervisor,
      manager,
      onExit,
      persistence: opts.session,
    }),
  );

  await ink.waitUntilExit();
  await onExit();
}

/**
 * 带 resume 的 spawn：有 resumeCliSessionId 就先试 resume，失败 fallback 到新开。
 * 失败的定义：spawn 本身 throw，或者 spawn 回来但 5s 内没收到任何 session_started
 * 事件（说明 CLI 拒绝了 resume 但没正式报错）。目前只用第一个条件兜底，
 * 第二个太侵入。
 */
async function spawnSupWithResume(
  adapter: CliAdapter,
  opts: SpawnOptions,
): Promise<RunningSession> {
  if (!opts.resumeCliSessionId) {
    return adapter.spawn(opts);
  }
  try {
    return await adapter.spawn(opts);
  } catch (err) {
    process.stderr.write(
      `[cowork] resume ${opts.resumeCliSessionId} 失败（${err instanceof Error ? err.message : String(err)}），fallback 到新开\n`,
    );
    return adapter.spawn({ ...opts, resumeCliSessionId: null });
  }
}
