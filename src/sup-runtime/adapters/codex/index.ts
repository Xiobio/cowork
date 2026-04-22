/**
 * Codex adapter —— 把 `codex app-server` spawn 成 Sup。
 *
 * 流程：
 * 1. CodexAdapter.probe() 探测 codex 是否装了 + 版本
 * 2. CodexAdapter.spawn() 启动 `codex app-server` 子进程，通过 -c 注入 MCP server
 * 3. 发 initialize → 等 response
 * 4. 发 initialized notification
 * 5. 发 thread/start with baseInstructions = 系统提示词
 * 6. 等 thread/started notification 拿 threadId
 * 7. 之后每次 sendUserMessage → turn/start
 * 8. 把 server notifications normalize 成 CanonicalEvent 入队
 * 9. 自动响应 server-initiated approval requests
 */

import { type ChildProcess } from 'node:child_process';
import crossSpawn from 'cross-spawn';

import { findCliBinary, runForOutput } from '../../platform.js';


import { BaseRunningSession } from '../../base.js';
import type {
  CliAdapter,
  CliCapabilities,
  ProbeResult,
  RunningSession,
  SpawnOptions,
} from '../../types.js';
import { JsonRpcClient } from './app-server.js';
import {
  parseAgentMessageDelta,
  parseError,
  parseItemCompleted,
  parseItemStarted,
  parseThreadStarted,
  parseTurnCompleted,
} from './parser.js';
import type {
  AgentMessageDeltaNotification,
  ErrorNotification,
  InitializeParams,
  ItemCompletedNotification,
  ItemStartedNotification,
  ThreadStartedNotification,
  ThreadStartParams,
  TurnCompletedNotification,
  TurnStartParams,
  UserInput,
} from './protocol.js';

const CAPABILITIES: CliCapabilities = {
  streamingDeltas: true,
  systemPromptOverride: 'replace',
  midTurnInterrupt: true,
  mcpInjection: 'config-override',
};

export class CodexAdapter implements CliAdapter {
  readonly name = 'codex';
  readonly displayName = 'OpenAI Codex CLI';
  readonly capabilities = CAPABILITIES;

  async probe(): Promise<ProbeResult> {
    const binaryPath = findCliBinary('codex');
    if (!binaryPath) {
      return { installed: false, error: 'codex 不在 PATH 中' };
    }
    try {
      // 用 cross-spawn 避免 Windows .cmd 的 spawn EINVAL 问题
      const stdout = await runForOutput('codex', ['--version']);
      const match = stdout.match(/codex-cli\s+(\S+)/i) ?? stdout.match(/(\d+\.\d+\.\d+)/);
      const version = match?.[1] ?? stdout.trim();
      return { installed: true, version, binaryPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { installed: false, error: message, binaryPath };
    }
  }

  async spawn(opts: SpawnOptions): Promise<RunningSession> {
    const binaryPath = findCliBinary('codex');
    if (!binaryPath) {
      throw new Error('codex 不在 PATH 中，无法启动');
    }
    const args = buildCodexArgs(opts);
    // cross-spawn 在 Windows 上会自动把 .cmd 脚本转成合适的 cmd.exe 调用，
    // 并正确处理 args 里的特殊字符（包括我们 TOML 里的 " 和 []）。
    const child = crossSpawn(binaryPath, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    if (!child.pid) {
      throw new Error('codex 子进程启动失败，没拿到 pid');
    }

    const session = new CodexSession(child, opts);
    await session.initialize();
    return session;
  }
}

function buildCodexArgs(opts: SpawnOptions): string[] {
  const args: string[] = [];

  // 把 MCP server 们通过 -c key=value 覆盖注入进去
  for (const [name, cfg] of Object.entries(opts.mcpServers)) {
    // 注意：value 会被 codex 当 TOML 解析，所以字符串要加引号，数组用 [] 语法
    args.push('-c', `mcp_servers.${name}.command=${JSON.stringify(cfg.command)}`);
    args.push(
      '-c',
      `mcp_servers.${name}.args=${serializeTomlArray(cfg.args)}`,
    );
    if (cfg.env) {
      // env 是一个 table，每个 key 都是一条 -c
      for (const [k, v] of Object.entries(cfg.env)) {
        args.push('-c', `mcp_servers.${name}.env.${k}=${JSON.stringify(v)}`);
      }
    }
  }

  // 必须放在子命令前面
  args.push('app-server');

  return args;
}

function serializeTomlArray(items: string[]): string {
  // TOML 数组：["a", "b"]
  return '[' + items.map((x) => JSON.stringify(x)).join(', ') + ']';
}

// ─── Session ─────────────────────────────────────────────

class CodexSession extends BaseRunningSession {
  private readonly client: JsonRpcClient;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private readonly opts: SpawnOptions;

  constructor(child: ChildProcess, opts: SpawnOptions) {
    super('codex', child);
    this.opts = opts;
    this.client = new JsonRpcClient(child);

    this.client.onProtocolError = (err, raw) => {
      this.enqueueEvent({
        type: 'session_error',
        message: `protocol error: ${err.message}${raw ? ` (line: ${raw.slice(0, 120)})` : ''}`,
        fatal: false,
        ts: new Date(),
      });
    };

    this.wireNotifications();
    this.wireApprovalHandlers();
  }

  private wireNotifications(): void {
    this.client.onNotification('thread/started', (params) => {
      const p = params as ThreadStartedNotification;
      this.threadId = p.thread.id;
      this.cliSessionId = p.thread.id;
      for (const ev of parseThreadStarted(p)) this.enqueueEvent(ev);
    });

    this.client.onNotification('turn/started', (params) => {
      const p = params as { threadId: string; turn: { id: string } };
      this.activeTurnId = p.turn.id;
    });

    this.client.onNotification('item/started', (params) => {
      for (const ev of parseItemStarted(params as ItemStartedNotification)) {
        this.enqueueEvent(ev);
      }
    });

    this.client.onNotification('item/agentMessage/delta', (params) => {
      for (const ev of parseAgentMessageDelta(params as AgentMessageDeltaNotification)) {
        this.enqueueEvent(ev);
      }
    });

    this.client.onNotification('item/completed', (params) => {
      for (const ev of parseItemCompleted(params as ItemCompletedNotification)) {
        this.enqueueEvent(ev);
      }
    });

    this.client.onNotification('turn/completed', (params) => {
      this.activeTurnId = null;
      for (const ev of parseTurnCompleted(params as TurnCompletedNotification)) {
        this.enqueueEvent(ev);
      }
    });

    this.client.onNotification('error', (params) => {
      for (const ev of parseError(params as ErrorNotification)) {
        this.enqueueEvent(ev);
      }
    });

    // 其它 notification 我们默认 ignore。如果 debug 需要，可以打开下面这行：
    // this.client.defaultRequestHandler = async (m, p) => { ... }
  }

  private wireApprovalHandlers(): void {
    // Server-initiated approval requests —— 全部自动同意。
    this.client.onRequest('item/commandExecution/requestApproval', async () => {
      return { decision: 'accept' };
    });
    this.client.onRequest('item/fileChange/requestApproval', async () => {
      return { decision: 'accept' };
    });
    this.client.onRequest('execCommandApproval', async () => {
      return { decision: 'approved' };
    });
    this.client.onRequest('applyPatchApproval', async () => {
      return { decision: 'approved' };
    });
    // 其它类型（permissions / elicitation / dynamic tool call）默认方法找不到返回 -32601
    // Codex 会把它视为拒绝。万一某个场景需要我们会在这里补。

    // Fallback：任何我们没显式处理的 server request
    this.client.defaultRequestHandler = async (method, params) => {
      process.stderr.write(
        `[codex-adapter] 未处理的 server request: ${method} ${JSON.stringify(params).slice(0, 200)}\n`,
      );
      throw new Error(`unsupported server request: ${method}`);
    };
  }

  async initialize(): Promise<void> {
    // 1. initialize
    const initParams: InitializeParams = {
      clientInfo: { name: 'cowork', title: 'cowork supervisor', version: '0.0.1' },
      capabilities: { experimentalApi: false },
    };
    await this.client.request('initialize', initParams);

    // 2. initialized notification
    this.client.notify('initialized');

    // 3. thread/start
    // 注意：空字符串 systemPrompt 意思是"不覆盖 Codex 默认"，这种情况下
    // 传 null 给 baseInstructions。Codex 会用自己内置的 coding agent prompt。
    const threadParams: ThreadStartParams = {
      cwd: this.opts.cwd,
      baseInstructions: this.opts.systemPrompt || null,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      experimentalRawEvents: false,
      persistExtendedHistory: false,
      ephemeral: true,
    };
    if (this.opts.model) threadParams.model = this.opts.model;

    // thread/start 的 response 里就有 threadId，但 cli-daemon 的做法是等
    // thread/started notification。我们两条都能跑，先用 response
    // 直接拿 id，异步到达的 notification 作为补充。
    const resp = (await this.client.request('thread/start', threadParams)) as {
      thread?: { id: string };
    };
    if (resp?.thread?.id) {
      this.threadId = resp.thread.id;
      if (!this.cliSessionId) this.cliSessionId = resp.thread.id;
    }

    if (!this.threadId) {
      throw new Error('thread/start 没有返回 threadId');
    }
  }

  async sendUserMessage(text: string): Promise<void> {
    if (!this.threadId) throw new Error('thread 还没准备好');
    const input: UserInput[] = [{ type: 'text', text, text_elements: [] }];
    const params: TurnStartParams = { threadId: this.threadId, input };
    await this.client.request('turn/start', params);
  }

  async sendInterrupt(): Promise<void> {
    if (!this.threadId) return;
    try {
      await this.client.request('turn/interrupt', {
        threadId: this.threadId,
        turnId: this.activeTurnId,
      });
    } catch {
      // 回退到 SIGINT
      try {
        this.child.kill('SIGINT');
      } catch {
        /* 已死 */
      }
    }
  }

  async stop(opts?: { timeoutMs?: number }): Promise<void> {
    await this.stopProcess(opts);
  }
}
