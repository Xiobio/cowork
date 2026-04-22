/**
 * Claude Code adapter —— 把 `claude -p --input-format stream-json` spawn 成 Sup。
 *
 * 和 Codex adapter 的差异：
 * - 协议是 NDJSON（每行一个 JSON），不是 JSON-RPC
 * - 系统提示词通过 --system-prompt flag 完全替换
 * - MCP server 通过 --mcp-config 传一个 inline JSON 字符串（也可以是文件路径）
 * - session id 同步可得（第一行 system/init 就有）
 * - 中断只能 SIGINT，没有 turn-level interrupt
 * - 内置工具用 --tools "" 全部禁用
 */

import { type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import crossSpawn from 'cross-spawn';

import { BaseRunningSession } from '../../base.js';
import { findCliBinary, runForOutput } from '../../platform.js';
import type {
  CliAdapter,
  CliCapabilities,
  ProbeResult,
  RunningSession,
  SpawnOptions,
} from '../../types.js';
import { writeUserMessage } from './input.js';
import { parseClaudeEvent } from './parser.js';

const CAPABILITIES: CliCapabilities = {
  streamingDeltas: true,
  systemPromptOverride: 'replace',
  midTurnInterrupt: false,
  mcpInjection: 'config-file',
};

export class ClaudeCodeAdapter implements CliAdapter {
  readonly name = 'claude-code';
  readonly displayName = 'Anthropic Claude Code';
  readonly capabilities = CAPABILITIES;

  async probe(): Promise<ProbeResult> {
    const binaryPath = findCliBinary('claude');
    if (!binaryPath) {
      return { installed: false, error: 'claude 不在 PATH 中' };
    }
    try {
      const stdout = await runForOutput('claude', ['--version']);
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = match?.[1] ?? stdout.trim();
      return { installed: true, version, binaryPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { installed: false, error: message, binaryPath };
    }
  }

  async spawn(opts: SpawnOptions): Promise<RunningSession> {
    const binaryPath = findCliBinary('claude');
    if (!binaryPath) {
      throw new Error('claude 不在 PATH 中，无法启动');
    }

    // 构造 MCP 配置 inline JSON
    const mcpConfig = {
      mcpServers: Object.fromEntries(
        Object.entries(opts.mcpServers).map(([name, cfg]) => [
          name,
          {
            command: cfg.command,
            args: cfg.args,
            ...(cfg.env ? { env: cfg.env } : {}),
          },
        ]),
      ),
    };

    const args: string[] = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
    ];

    // 空 systemPrompt = 用 CLI 默认 prompt（工人场景）
    if (opts.systemPrompt) {
      args.push('--system-prompt', opts.systemPrompt);
    }

    // 空 mcpServers = 不注入任何 MCP（工人场景）
    if (Object.keys(opts.mcpServers).length > 0) {
      args.push('--mcp-config', JSON.stringify(mcpConfig));
      args.push('--strict-mcp-config');
      // 禁用所有内置工具，只留 MCP（总管场景）
      args.push('--tools', '');
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    const child = crossSpawn(binaryPath, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    if (!child.pid) {
      throw new Error('claude 子进程启动失败');
    }

    const session = new ClaudeCodeSession(child);
    return session;
  }
}

// ─── Session ─────────────────────────────────────────────

class ClaudeCodeSession extends BaseRunningSession {
  private readonly stderrPassthrough = process.env.COWORK_DEBUG === '1';
  private stderrBuffer = '';

  constructor(child: ChildProcess) {
    super('claude-code', child);

    // stdout NDJSON parsing
    if (!child.stdout) {
      throw new Error('claude 子进程没有 stdout');
    }
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        this.enqueueEvent({
          type: 'session_error',
          message: `parse error on line: ${trimmed.slice(0, 120)}`,
          fatal: false,
          ts: new Date(),
        });
        return;
      }
      const events = parseClaudeEvent(raw);
      for (const ev of events) {
        if (ev.type === 'session_started') this.cliSessionId = ev.cliSessionId;
        this.enqueueEvent(ev);
      }
    });

    // stderr 默认静默
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (!this.stderrPassthrough) return;
        this.stderrBuffer += chunk;
        const idx = this.stderrBuffer.lastIndexOf('\n');
        if (idx !== -1) {
          const toWrite = this.stderrBuffer.slice(0, idx + 1);
          this.stderrBuffer = this.stderrBuffer.slice(idx + 1);
          process.stderr.write(`[claude stderr] ${toWrite}`);
        }
      });
    }
  }

  async sendUserMessage(text: string): Promise<void> {
    if (!this.child.stdin || this.child.stdin.destroyed) {
      throw new Error('claude stdin 已关闭');
    }
    writeUserMessage(this.child.stdin, text);
  }

  async sendInterrupt(): Promise<void> {
    try {
      this.child.kill('SIGINT');
    } catch {
      /* 已死 */
    }
  }

  async stop(opts?: { timeoutMs?: number }): Promise<void> {
    await this.stopProcess(opts);
  }
}
