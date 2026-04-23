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

import type { CliAdapter, McpServerConfig, SpawnOptions } from '../sup-runtime/types.js';
import { Supervisor, SUPERVISOR_SYSTEM_PROMPT } from '../supervisor.js';
import type { WorkerManager } from '../worker-manager/manager.js';
import type { SessionBundle, SessionMeta } from '../session/storage.js';
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


  // Spawn Sup session
  const spawnOpts: SpawnOptions = {
    systemPrompt: SUPERVISOR_SYSTEM_PROMPT,
    cwd: process.cwd(),
    mcpServers,
  };

  let session;
  try {
    session = await adapter.spawn(spawnOpts);
  } catch (err) {
    console.error('启动 Sup 失败:', err instanceof Error ? err.message : String(err));
    process.exit(1);
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
