/**
 * cowork sup-runtime 核心类型。
 *
 * 这层是 cowork 主进程和各种 CLI 之间的抽象契约。设计理念在
 * docs/adapter-design.md 里。改动这个文件要同步改那份文档。
 */

// ─── Canonical Event ─────────────────────────────────────────────
// 所有 adapter 把 CLI 输出 normalize 成这套事件。上层（Supervisor /
// UI）只消费这个，不关心 CLI 的原始协议格式。

export interface BaseEvent {
  ts: Date;
}

export interface SessionStartedEvent extends BaseEvent {
  type: 'session_started';
  cliSessionId: string;
}

export interface AssistantTextEvent extends BaseEvent {
  type: 'assistant_text';
  text: string;
}

export interface AssistantTextDeltaEvent extends BaseEvent {
  type: 'assistant_text_delta';
  delta: string;
}

export interface ToolCallEvent extends BaseEvent {
  type: 'tool_call';
  toolName: string;
  input: unknown;
  callId: string;
}

export interface ToolResultEvent extends BaseEvent {
  type: 'tool_result';
  callId: string;
  output: unknown;
  isError: boolean;
}

export interface ThinkingEvent extends BaseEvent {
  type: 'thinking';
  text: string;
}

export interface TurnCompletedEvent extends BaseEvent {
  type: 'turn_completed';
  stopReason: 'end_turn' | 'max_tokens' | 'interrupted' | 'error';
}

export interface SessionErrorEvent extends BaseEvent {
  type: 'session_error';
  message: string;
  fatal: boolean;
}

export interface SessionStoppedEvent extends BaseEvent {
  type: 'session_stopped';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export type CanonicalEvent =
  | SessionStartedEvent
  | AssistantTextEvent
  | AssistantTextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ThinkingEvent
  | TurnCompletedEvent
  | SessionErrorEvent
  | SessionStoppedEvent;

// ─── Capabilities ───────────────────────────────────────────────
// 静态描述某个 CLI 支持什么不支持什么。上层可以在 spawn 前查询。

export interface CliCapabilities {
  /** 支持流式 token delta（assistant_text_delta 事件）吗 */
  streamingDeltas: boolean;
  /** 系统提示词注入方式 */
  systemPromptOverride: 'replace' | 'append' | 'prepend-as-user';
  /** 支持 turn 级别的中断（不退出 session） */
  midTurnInterrupt: boolean;
  /** MCP server 注入方式 */
  mcpInjection: 'config-override' | 'config-file' | 'none';
}

// ─── Spawn options ──────────────────────────────────────────────

export interface McpServerConfig {
  /** 启动 MCP server 子进程的命令（通常是 'node'） */
  command: string;
  /** 命令参数（通常是 [absoluteScriptPath]） */
  args: string[];
  /** MCP server 子进程的额外 env */
  env?: Record<string, string>;
}

export interface SpawnOptions {
  /**
   * 系统提示词。总管必填（秘书 prompt）；工人传空字符串让 CLI 用自己的默认身份
   * （普通 coding agent），此时启动后通过 sendUserMessage 把任务下达给工人。
   */
  systemPrompt: string;
  /** 启动 CLI 的工作目录 */
  cwd: string;
  /** MCP server 配置表：name → config。工人传 {} 不接任何 MCP server */
  mcpServers: Record<string, McpServerConfig>;
  /** 可选：强制指定模型 */
  model?: string;
  /** 可选：额外 env var（注入到 CLI 子进程） */
  env?: Record<string, string>;
}

// ─── Running session interface ──────────────────────────────────
// 一个活着的 Sup 会话对上层暴露的接口。

export interface RunningSession {
  readonly cliName: string;
  readonly pid: number;
  /** CLI 本身的 session id，启动后几毫秒才会填上 */
  readonly cliSessionId: string | null;

  /** 事件流。只能被一个消费者 for await，二次订阅行为未定义。 */
  events(): AsyncIterable<CanonicalEvent>;

  /** 往 Sup 发一条用户消息 */
  sendUserMessage(text: string): Promise<void>;

  /** 中断当前 turn（不退出 session） */
  sendInterrupt(): Promise<void>;

  /** 优雅结束 session */
  stop(opts?: { timeoutMs?: number }): Promise<void>;

  /** 等待 session 自然退出。resolve 后事件流也会结束。 */
  wait(): Promise<SessionExitInfo>;
}

export interface SessionExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

// ─── Adapter factory interface ──────────────────────────────────

export interface ProbeResult {
  installed: boolean;
  version?: string;
  error?: string;
  binaryPath?: string;
}

export interface CliAdapter {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: CliCapabilities;

  /** 检查 CLI 是否已安装、能跑、版本是否在支持范围内 */
  probe(): Promise<ProbeResult>;

  /** 启动一个新的 Sup 会话 */
  spawn(opts: SpawnOptions): Promise<RunningSession>;
}
