/**
 * Codex app-server 协议的最小类型定义。
 *
 * 这些类型从 `codex app-server generate-ts` 生成的完整 schema 里**手动裁剪**
 * 出我们真正用到的部分。不全量复制是因为：
 * - 完整 schema 几百个文件，绝大部分我们不需要
 * - 裁剪过的版本更容易读，接 CLI 升级时也更容易 diff 看到冲突
 *
 * 如果将来 Codex 升级协议破坏了这里的某个形状，rerun:
 *   codex app-server generate-ts --out /tmp/codex-proto
 * 对比 v2/*.ts 里的目标类型。
 */

// ─── Requests we send (client → server) ──────────────────

export interface ClientInfo {
  name: string;
  title: string | null;
  version: string;
}

export interface InitializeCapabilities {
  experimentalApi: boolean;
  optOutNotificationMethods?: string[] | null;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities: InitializeCapabilities | null;
}

export type AskForApproval = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: SandboxMode | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean | null;
  // 这两个是 required 的 boolean，生成代码显示没有 ? 标记
  experimentalRawEvents: boolean;
  persistExtendedHistory: boolean;
}

export interface TextElement {
  // 占位；我们不填充任何 span 信息
  [k: string]: unknown;
}

export type UserInput =
  | { type: 'text'; text: string; text_elements: TextElement[] }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string };

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
}

export interface TurnInterruptParams {
  threadId: string;
  turnId?: string | null;
}

// ─── Notifications we receive (server → client) ──────────────

export type ThreadStatus = 'idle' | 'running' | { [k: string]: unknown };

export interface Thread {
  id: string;
  status: ThreadStatus;
  cwd: string;
  cliVersion: string;
  // 其它字段我们不关心
  [k: string]: unknown;
}

export interface ThreadStartedNotification {
  thread: Thread;
}

export type TurnStatus = 'active' | 'completed' | 'interrupted' | 'failed' | { [k: string]: unknown };

export interface Turn {
  id: string;
  status: TurnStatus;
  // items/error 我们不关心
  [k: string]: unknown;
}

export interface TurnStartedNotification {
  threadId: string;
  turn: Turn;
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: Turn;
}

// ThreadItem 的 variant 只列我们需要的
export type ThreadItem =
  | { type: 'agentMessage'; id: string; text: string; phase?: string | null }
  | { type: 'commandExecution'; id: string; command: string; cwd: string; status: string; exitCode?: number | null; aggregatedOutput?: string | null }
  | {
      type: 'mcpToolCall';
      id: string;
      server: string;
      tool: string;
      status: string;
      arguments: unknown;
      result?: unknown;
      error?: unknown;
    }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | { type: 'userMessage'; id: string; content: unknown[] }
  | { type: string; id: string; [k: string]: unknown };  // fallback for未知类型

export interface ItemStartedNotification {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface ItemCompletedNotification {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ErrorNotification {
  // 很宽松，我们只关心是不是有个 message 字段
  message?: string;
  [k: string]: unknown;
}

// ─── Responses and approvals ─────────────────────────────

// ReviewDecision：字符串或对象 union。我们只用字符串形式。
export type ReviewDecision = 'approved' | 'approved_for_session' | 'denied' | 'abort';

export type CommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel';

export type FileChangeApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'decline'
  | 'cancel';
