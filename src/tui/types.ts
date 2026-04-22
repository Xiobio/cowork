/**
 * TUI 层特有的类型 —— UI 显示用的 Worker 视图（原始 WorkerInfo 的子集）。
 */

/** TUI 显示的 worker 状态（WorkerManager 的 'starting' 合并为 'running'） */
export type UiWorkerState = 'idle' | 'running' | 'blocked' | 'stopped';

/** 渲染侧的工人视图 */
export interface WorkerView {
  name: string;
  state: UiWorkerState;
  lastActivity: Date;
  tokenUsed: number;
  currentAction: string | null;
}
