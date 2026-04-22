/**
 * WorkerManager 层的类型定义。
 *
 * 这些类型取代了旧的 mock-daemon 里的定义。思路相同，但现在每个 "Worker"
 * 背后是一个**真的** CLI subprocess（通过 sup-runtime 的 Adapter 创建）。
 */

export type WorkerState = 'starting' | 'running' | 'idle' | 'blocked' | 'stopped';

export interface WorkerInfo {
  name: string;
  cwd: string;
  /** 招工时用户给的初始任务描述 */
  initialPrompt: string;
  /** 实际跑的 adapter（'codex' / 'claude-code'） */
  adapterName: string;
  state: WorkerState;
  pid: number;
  cliSessionId: string | null;
  lastActivity: Date;
  /** 估算的 token 使用量（v0 只粗略估算） */
  tokenUsed: number;
  /** 最近一次工具调用名，用于 sidebar 显示 "Edit"/"Bash" 等 */
  currentAction: string | null;
  eventCount: number;
  summary: string;
}

export type WorkerEventType =
  | 'assistant_text'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'status_change'
  | 'completion';

export interface StoredEvent {
  id: string;
  workerName: string;
  type: WorkerEventType;
  toolName?: string | undefined;
  /** 80 字符预览（用于 peek_events） */
  preview: string;
  /** 完整正文（用于 read_event） */
  body: unknown;
  size: number;
  ts: Date;
}

export interface PeekEventRow {
  id: string;
  type: WorkerEventType;
  toolName?: string | undefined;
  size: number;
  preview: string;
  ts: string;
}

export interface ReadEventResult {
  id: string;
  workerName: string;
  type: WorkerEventType;
  toolName?: string | undefined;
  body: unknown;
  ts: string;
}

/** WorkerManager 对外暴露的接口（TUI 和 IPC 都通过它访问） */
export interface IWorkerManager {
  listWorkers(): WorkerInfo[];
  getWorker(name: string): WorkerInfo | null;
  peekEvents(name: string, opts?: { since?: string; limit?: number }): PeekEventRow[] | null;
  readEvent(eventId: string): ReadEventResult | null;
  getSummary(name: string): string | null;
  updateSummary(name: string, text: string): boolean;
  sendToWorker(name: string, message: string): Promise<{ ok: true } | { ok: false; error: string }>;
  sendInterrupt(name: string): Promise<{ ok: true } | { ok: false; error: string }>;
  spawnWorker(
    name: string,
    cwd: string,
    initialPrompt: string,
  ): Promise<{ ok: true; name: string } | { ok: false; error: string }>;
  killWorker(
    name: string,
    graceful: boolean,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  note(key: string, text: string): { ok: true };
  getNote(key: string): string | null;
}
