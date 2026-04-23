/**
 * cowork 主入口。
 *
 * 关键架构：
 * 1. 启动时创建 WorkerManager（持有真工人）+ IpcServer（本地 TCP）
 * 2. Spawn Sup（codex / claude），通过 mcpServers.*.env 把 IPC 地址
 *    和 token 传给 MCP server 子进程
 * 3. TUI 直接持有 WorkerManager 引用（同进程，不走 IPC）
 * 4. Sup 的 MCP server 子进程通过 IPC 打回 cowork 主进程的 WorkerManager
 *
 * 用法：
 *   npm run dev                        默认 TUI 模式，codex adapter
 *   npm run dev -- --adapter=claude    切到 claude code
 *   npm run dev -- --classic           纯 readline 聊天（调试用）
 *   npm run dev -- --prompt "xxx"      单次模式
 *   npm run dev -- --probe             探测 adapter
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { Supervisor, SUPERVISOR_SYSTEM_PROMPT, type ChatObserver } from './supervisor.js';
import { getAdapter, listAdapters } from './sup-runtime/registry.js';
import type { CliAdapter, McpServerConfig, SpawnOptions } from './sup-runtime/types.js';
import { WorkerManager } from './worker-manager/manager.js';
import { IpcServer, type IpcServerInfo } from './worker-manager/ipc-server.js';
import { runTui } from './tui/index.js';
import {
  createSession,
  findLatestSession,
  listSessions,
  loadSession,
  touchSession,
  type SessionBundle,
  type SessionMeta,
} from './session/storage.js';

// ─── 启动参数解析 ──────────────────────────────────

interface CliArgs {
  adapter: string;
  prompt: string | null;
  probe: boolean;
  verbose: boolean;
  help: boolean;
  classic: boolean;
  forceTui: boolean;
  tuiSnapshot: boolean;
  /** --new: 强制新 session（不 resume 最近一次） */
  newSession: boolean;
  /** --session <id>: 指定某个历史 session resume */
  sessionId: string | null;
  /** --list-sessions: 打印本目录下所有 session 列表后退出 */
  listSessions: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    adapter: 'claude',
    prompt: null,
    probe: false,
    verbose: false,
    help: false,
    classic: false,
    forceTui: false,
    tuiSnapshot: false,
    newSession: false,
    sessionId: null,
    listSessions: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--adapter') {
      args.adapter = argv[++i] ?? 'codex';
    } else if (a?.startsWith('--adapter=')) {
      args.adapter = a.slice('--adapter='.length);
    } else if (a === '--prompt') {
      args.prompt = argv[++i] ?? null;
    } else if (a?.startsWith('--prompt=')) {
      args.prompt = a.slice('--prompt='.length);
    } else if (a === '--probe') {
      args.probe = true;
    } else if (a === '--classic') {
      args.classic = true;
    } else if (a === '--tui') {
      args.forceTui = true;
    } else if (a === '--tui-snapshot') {
      args.tuiSnapshot = true;
    } else if (a === '--new') {
      args.newSession = true;
    } else if (a === '--session') {
      args.sessionId = argv[++i] ?? null;
    } else if (a?.startsWith('--session=')) {
      args.sessionId = a.slice('--session='.length);
    } else if (a === '--list-sessions') {
      args.listSessions = true;
    } else if (a === '--verbose' || a === '-v') {
      args.verbose = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

function printHelp(): void {
  const adapterNames = listAdapters()
    .map((a) => `${a.name} (${a.displayName})`)
    .join(', ');
  console.log(`cowork —— 让你在一个地方统筹多个 Claude / Codex 工人

用法:
  npm run dev                          默认 TUI 模式 (claude adapter)，自动 resume 最近会话
  npm run dev -- --new                 强制新开一个 session（不 resume）
  npm run dev -- --session <id>        resume 指定的 session（--list-sessions 看 id）
  npm run dev -- --list-sessions       列出本目录下所有 session
  npm run dev -- --adapter=<name>      切换 adapter
  npm run dev -- --classic             退到纯 readline 聊天（调试用）
  npm run dev -- --prompt "问题"       单次模式：发一句话拿答案就退出
  npm run dev -- --probe               探测所有 adapter
  npm run dev -- --verbose             打印工具调用等调试信息（仅 classic/prompt）

已注册 adapter: ${adapterNames}

真工人架构：cowork 主进程持有 WorkerManager，招工时会真的 spawn
一个 CLI subprocess（Codex 或 Claude Code）。关工人时会真的 kill。

Session 语义（phase 1）：
- 对话记录和工人清单会保存在 .cowork/sessions/<id>/ 下
- 下次打开默认 resume 最近 session（对话滚屏回放 + 工人列表以 stopped 显示）
- 工人的真进程**不**自动拉起（phase 2 补），用 /respawn <名字> 用同样 prompt+cwd 再起
`);
}

function resolveMcpServerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, 'mcp-server', 'index.js');
  if (!existsSync(path)) {
    throw new Error(
      `找不到编译后的 MCP server：${path}\n` +
        `请先运行 \`npm run build\` 把 TypeScript 编到 dist/`,
    );
  }
  return path;
}

function buildMcpServerConfig(
  mcpServerPath: string,
  ipcInfo: IpcServerInfo,
): Record<string, McpServerConfig> {
  return {
    cowork_tools: {
      command: 'node',
      args: [mcpServerPath],
      env: {
        COWORK_IPC_HOST: ipcInfo.host,
        COWORK_IPC_PORT: String(ipcInfo.port),
        COWORK_IPC_TOKEN: ipcInfo.token,
      },
    },
  };
}

// ─── 主流程 ──────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.probe) {
    await probeAdapters();
    return;
  }

  if (args.listSessions) {
    printSessionList();
    return;
  }

  const mcpServerPath = resolveMcpServerPath();

  // 1. 选 adapter 并探测
  let adapter: CliAdapter;
  try {
    adapter = getAdapter(args.adapter);
  } catch (err) {
    console.error('错误:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const probe = await adapter.probe();
  if (!probe.installed) {
    console.error(
      `错误: ${adapter.displayName} 未安装或无法运行\n原因: ${probe.error ?? 'unknown'}`,
    );
    process.exit(1);
  }

  // 1.5 决定 session：默认 resume 最近一次，--new 强制新建，--session <id> 指定
  const sessionBundle = resolveSession(args, adapter.name);

  // 2. 创建 WorkerManager + IpcServer
  const manager = new WorkerManager({
    adapter,
    adapterName: adapter.name,
    workerCwdRoot: process.cwd(),
  });
  const ipc = new IpcServer(manager);
  const ipcInfo = await ipc.start();

  // 3. 退出时清理所有工人
  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    await manager.stopAll();
    await ipc.stop();
  };
  const onSignal = (sig: NodeJS.Signals): void => {
    void cleanup().then(() => process.exit(sig === 'SIGINT' ? 130 : 0));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  // 4. 构造 Sup 的 MCP server 配置（带 IPC 环境变量）
  const mcpServers = buildMcpServerConfig(mcpServerPath, ipcInfo);

  // 5. TUI snapshot 分支
  if (args.tuiSnapshot) {
    try {
      await runTui({
        adapter,
        manager,
        mcpServers,
        snapshot: true,
        session: sessionBundle,
      });
    } catch (err) {
      console.error('TUI snapshot 错误:', err instanceof Error ? err.message : String(err));
    } finally {
      await cleanup();
    }
    return;
  }

  // 6. 决定 TUI 还是 classic
  const isTty = !!process.stdout.isTTY;
  const shouldUseTui = args.forceTui || (isTty && !args.classic && !args.prompt);

  if (shouldUseTui) {
    try {
      await runTui({ adapter, manager, mcpServers, session: sessionBundle });
    } catch (err) {
      console.error('TUI 错误:', err instanceof Error ? err.message : String(err));
    } finally {
      await cleanup();
    }
    return;
  }

  // 7. Classic / one-shot 分支：直接跑 Supervisor + readline
  const bar = '─'.repeat(60);
  console.log(bar);
  console.log(`cowork (classic) · adapter=${adapter.displayName} v${probe.version ?? '?'}`);
  console.log(`MCP server: ${mcpServerPath}`);
  console.log(`IPC: ${ipcInfo.host}:${ipcInfo.port}`);
  console.log(`工作目录: ${process.cwd()}`);
  console.log(bar);
  console.log('正在启动总管，第一次可能需要几秒...');

  const spawnOpts: SpawnOptions = {
    systemPrompt: SUPERVISOR_SYSTEM_PROMPT,
    cwd: process.cwd(),
    mcpServers,
  };

  let session;
  try {
    session = await adapter.spawn(spawnOpts);
  } catch (err) {
    console.error('\n启动总管失败:', err instanceof Error ? err.message : String(err));
    await cleanup();
    process.exit(1);
  }

  const sup = new Supervisor(session);
  console.log(`总管已就位 (pid=${session.pid} · session=${session.cliSessionId ?? '…'})`);
  console.log();

  try {
    if (args.prompt) {
      await runOneShot(sup, args.prompt, args.verbose);
    } else {
      await runClassicReadline(sup, args.verbose);
    }
  } finally {
    await sup.stop();
    await cleanup();
  }
}

async function runOneShot(sup: Supervisor, prompt: string, verbose: boolean): Promise<void> {
  console.log(`你 > ${prompt}\n`);
  const observer = makeObserver(verbose);
  const result = await sup.chat(prompt, observer);
  console.log('\n总管 >');
  console.log();
  console.log(result.text || '（总管没有文本输出）');
  console.log();
  console.log(
    `─── 元信息: stopReason=${result.stopReason} toolCalls=${result.toolCallCount} ───`,
  );
}

async function runClassicReadline(sup: Supervisor, verbose: boolean): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log('（输入 /quit 或 /exit 退出，/help 看试玩建议）');
  console.log();

  while (true) {
    let userInput: string;
    try {
      userInput = (await rl.question('你 > ')).trim();
    } catch {
      console.log('\n再见。');
      break;
    }

    if (!userInput) continue;
    if (userInput === '/quit' || userInput === '/exit') {
      console.log('再见。');
      break;
    }
    if (userInput === '/help') {
      printInteractiveHelp();
      continue;
    }

    try {
      stdout.write('\n总管 · 思考中');
      const ticker = setInterval(() => stdout.write('.'), 500);
      const observer = makeObserver(verbose);
      const result = await sup.chat(userInput, observer);
      clearInterval(ticker);
      stdout.write('\r                                   \r');

      console.log('总管 >\n');
      console.log(result.text || '（总管没有文本输出）');
      console.log();
      if (verbose) {
        console.log(
          `─── stopReason=${result.stopReason} toolCalls=${result.toolCallCount} ───`,
        );
        console.log();
      }
    } catch (err) {
      stdout.write('\r                                   \r');
      console.error('\n[错误]', err instanceof Error ? err.message : String(err));
      console.log();
    }
  }

  rl.close();
}

function makeObserver(verbose: boolean): ChatObserver {
  if (!verbose) {
    return {
      onError: (message) => {
        process.stderr.write(`\n[sup error] ${message}\n`);
      },
    };
  }
  return {
    onTextDelta: () => {
      /* 流式打印留空，避免 verbose 模式输出混乱 */
    },
    onToolCall: (toolName, input) => {
      process.stderr.write(`\n  ↳ 🔧 ${toolName}(${JSON.stringify(input).slice(0, 120)})\n`);
    },
    onToolResult: (_callId, output, isError) => {
      const preview = JSON.stringify(output).slice(0, 120);
      process.stderr.write(`    ${isError ? '❌' : '✓'} ${preview}\n`);
    },
    onError: (message, fatal) => {
      process.stderr.write(`\n  ⚠ ${fatal ? '[FATAL]' : ''} ${message}\n`);
    },
  };
}

function printInteractiveHelp(): void {
  console.log();
  console.log('可以试试这些问题（v2 真工人模式初始工人数 = 0，先招一个再问）：');
  console.log();
  console.log('  · 帮我招一个新工人叫 小A，放在 D:/proj/test，让他输出 hello 后停下');
  console.log('  · 现在大家都怎么样？');
  console.log('  · 小A 在干嘛？');
  console.log('  · 让小A 停下');
  console.log();
  console.log('命令：/quit 退出 · /help 帮助');
  console.log();
}

// ─── session 引导 ─────────────────────────────────

interface ResolvedSession {
  /** meta + chat + workers，resume 场景下 chat/workers 非空 */
  bundle: SessionBundle | null;
  /** 当前活跃 session 的 meta（不管是 resume 还是 new） */
  meta: SessionMeta;
  /** 是否是 resume 场景（用来决定是否回放 chat） */
  resumed: boolean;
}

function resolveSession(args: CliArgs, adapterName: string): ResolvedSession {
  const cwd = process.cwd();

  // --new 明确新开
  if (args.newSession) {
    const meta = createSession(cwd, adapterName);
    return { bundle: null, meta, resumed: false };
  }

  // --session <id> 指定
  if (args.sessionId) {
    const loaded = loadSession(cwd, args.sessionId);
    if (!loaded) {
      console.error(`错误: 找不到 session "${args.sessionId}"。可用 --list-sessions 查看。`);
      process.exit(1);
    }
    touchSession(cwd, loaded.meta.id);
    return { bundle: loaded, meta: loaded.meta, resumed: true };
  }

  // 默认：resume 最近一次
  const latest = findLatestSession(cwd);
  if (latest) {
    const loaded = loadSession(cwd, latest.id);
    if (loaded) {
      touchSession(cwd, loaded.meta.id);
      return { bundle: loaded, meta: loaded.meta, resumed: true };
    }
  }

  // 没有历史 session —— 创新的
  const meta = createSession(cwd, adapterName);
  return { bundle: null, meta, resumed: false };
}

function printSessionList(): void {
  const cwd = process.cwd();
  const sessions = listSessions(cwd);
  if (sessions.length === 0) {
    console.log('本目录下还没有 session。第一次运行 npm run dev 会自动创建。');
    return;
  }
  console.log(`本目录下的 cowork session（${sessions.length} 个，新的在上）：\n`);
  for (const s of sessions) {
    const age = formatTimeAgo(new Date(s.lastUsedAt));
    console.log(`  ${s.id}`);
    console.log(`    adapter=${s.adapter}  lastUsed=${age}  created=${s.createdAt}`);
  }
  console.log(`\nresume 指定的：  npm run dev -- --session <id>`);
  console.log(`新开一个：       npm run dev -- --new`);
}

function formatTimeAgo(d: Date): string {
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

async function probeAdapters(): Promise<void> {
  console.log('探测已注册的 adapter...\n');
  for (const adapter of listAdapters()) {
    const r = await adapter.probe();
    const status = r.installed ? `✓ ${r.version ?? 'unknown version'}` : `✗ ${r.error ?? 'not installed'}`;
    console.log(`  ${adapter.name.padEnd(14)} ${adapter.displayName.padEnd(24)} ${status}`);
  }
  console.log();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
