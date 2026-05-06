/**
 * TUI 中央状态。React useReducer 驱动。
 *
 * 只保留 App.tsx 真正读取的字段：status / chat / workers / currentTurnToolCalls /
 * cliSessionId / pid / adapterName。早期迭代里的 feed / turnCount / lastToolCallCount
 * 已经被 Static scrollback 方案取代，reducer 维护它们但没人读，删掉。
 */

import type { WorkerView } from './types.js';
import type { WorkerSnapshot } from '../session/storage.js';

export type Status =
  | { kind: 'starting'; message: string }
  | { kind: 'ready' }
  | { kind: 'chatting' }
  | { kind: 'error'; message: string }
  | { kind: 'stopped' };

export interface ChatMessage {
  id: string;
  role: 'user' | 'sup' | 'tool';
  text: string;
  ts: Date;
  streaming?: boolean;
  /** role==='tool' 才有：工具名（短名，已经 shortenToolName 过） */
  toolName?: string;
  /** role==='tool' 才有：参数摘要（如 "→ 小游"） */
  argsSummary?: string;
  /** role==='tool' 才有：结果出错时的简短预览，OK 时空 */
  toolError?: string;
}

export interface AppState {
  status: Status;
  adapterName: string;
  adapterDisplayName: string;
  cliSessionId: string | null;
  pid: number | null;
  chat: ChatMessage[];
  workers: WorkerView[];
  /** resume 场景下还没被 /respawn 重新拉起来的历史工人（本轮 UI-only，不在 WorkerManager 里） */
  dormantWorkers: WorkerSnapshot[];
  /** 当前 turn 已经看到的工具调用次数（chat 开始时归零、chat 进行中增量）*/
  currentTurnToolCalls: number;
  /** 当前 turn 最近一次的工具调用（thinking 指示器用），null 表示空闲或刚结束 turn */
  currentTool: { name: string; target?: string } | null;
  /** 当前 turn 出错的工具次数 */
  currentTurnToolErrors: number;
  /** 最近一条错误（顶部 banner 显示，下次 user-submit 清掉） */
  lastError: { message: string; ts: Date } | null;
}

const CHAT_MAX = 100; // 永远保留最后 N 条消息在内存里

export const initialState = (adapterName: string, adapterDisplayName: string): AppState => ({
  status: { kind: 'starting', message: '正在启动总管…' },
  adapterName,
  adapterDisplayName,
  cliSessionId: null,
  pid: null,
  chat: [],
  workers: [],
  dormantWorkers: [],
  currentTurnToolCalls: 0,
  currentTool: null,
  currentTurnToolErrors: 0,
  lastError: null,
});

// ─── Actions ─────────────────────────────────────

export type Action =
  | { type: 'set-status'; status: Status }
  | { type: 'session-started'; cliSessionId: string; pid: number }
  | { type: 'workers-refreshed'; workers: WorkerView[] }
  | { type: 'user-submit'; text: string; messageId: string }
  | { type: 'sup-reply-started'; messageId: string }
  | { type: 'sup-text-delta'; messageId: string; delta: string }
  | { type: 'sup-text-final'; messageId: string; text: string }
  | { type: 'sup-turn-completed'; messageId: string; toolCallCount: number }
  | { type: 'tool-call'; callId: string; toolName: string; inputSummary: string; workerName?: string | undefined }
  | { type: 'tool-result-error'; preview: string }
  | { type: 'error'; message: string }
  | { type: 'clear-chat' }
  | { type: 'restore-chat'; messages: ChatMessage[] }
  | { type: 'set-dormant'; workers: WorkerSnapshot[] }
  | { type: 'remove-dormant'; name: string };

// ─── Reducer ─────────────────────────────────────

function trimChat(chat: ChatMessage[]): ChatMessage[] {
  if (chat.length <= CHAT_MAX) return chat;
  return chat.slice(chat.length - CHAT_MAX);
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'set-status':
      return { ...state, status: action.status };

    case 'session-started':
      return {
        ...state,
        cliSessionId: action.cliSessionId,
        pid: action.pid,
        status: { kind: 'ready' },
      };

    case 'workers-refreshed':
      return { ...state, workers: action.workers };

    case 'user-submit': {
      const msg: ChatMessage = {
        id: action.messageId,
        role: 'user',
        text: action.text,
        ts: new Date(),
      };
      return {
        ...state,
        chat: trimChat([...state.chat, msg]),
        status: { kind: 'chatting' },
        currentTurnToolCalls: 0, // 新 turn 重置
        currentTool: null,
        currentTurnToolErrors: 0,
        lastError: null, // 用户开口就清错误 banner
      };
    }

    case 'sup-reply-started': {
      const reply: ChatMessage = {
        id: action.messageId,
        role: 'sup',
        text: '',
        ts: new Date(),
        streaming: true,
      };
      return {
        ...state,
        chat: trimChat([...state.chat, reply]),
      };
    }

    case 'sup-text-delta': {
      return {
        ...state,
        chat: state.chat.map((m) =>
          m.id === action.messageId && m.role === 'sup' ? { ...m, text: m.text + action.delta } : m,
        ),
      };
    }

    case 'sup-text-final': {
      return {
        ...state,
        chat: state.chat.map((m) =>
          m.id === action.messageId && m.role === 'sup'
            ? { ...m, text: action.text, streaming: false }
            : m,
        ),
      };
    }

    case 'sup-turn-completed':
      return {
        ...state,
        status: { kind: 'ready' },
        currentTurnToolCalls: 0,
        currentTool: null,
        chat: state.chat.map((m) =>
          m.id === action.messageId && m.streaming ? { ...m, streaming: false } : m,
        ),
      };

    case 'tool-call': {
      // 同时把工具调用作为 'tool' role 消息追加到 chat，让用户看到 Sup 在干啥
      const toolMsg: ChatMessage = {
        id: action.callId,
        role: 'tool',
        text: '',
        ts: new Date(),
        toolName: action.toolName,
        argsSummary: action.inputSummary,
      };
      return {
        ...state,
        chat: trimChat([...state.chat, toolMsg]),
        currentTurnToolCalls: state.currentTurnToolCalls + 1,
        currentTool: { name: action.toolName, target: action.workerName },
      };
    }

    case 'tool-result-error':
      // 把错误也回填到最近一条 tool 消息上（如果有），让用户在 chat 里看到红色标记
      return {
        ...state,
        currentTurnToolErrors: state.currentTurnToolErrors + 1,
        lastError: { message: action.preview, ts: new Date() },
        chat: state.chat.map((m, idx) => {
          // 倒着找最近一条 role='tool' 没标过 error 的，标上
          if (idx === state.chat.length - 1 && m.role === 'tool' && !m.toolError) {
            return { ...m, toolError: action.preview };
          }
          return m;
        }),
      };

    case 'error':
      return {
        ...state,
        status: { kind: 'error', message: action.message },
        lastError: { message: action.message, ts: new Date() },
      };

    case 'clear-chat':
      return {
        ...state,
        chat: [],
      };

    case 'restore-chat':
      // 把历史消息塞进 chat，全部标 non-streaming（避免被当成正在生成）
      return {
        ...state,
        chat: trimChat(action.messages.map((m) => ({ ...m, streaming: false }))),
      };

    case 'set-dormant':
      return { ...state, dormantWorkers: action.workers };

    case 'remove-dormant':
      return {
        ...state,
        dormantWorkers: state.dormantWorkers.filter((w) => w.name !== action.name),
      };

    default:
      return state;
  }
}

// ─── id 工具 ─────────────────────────────────────

let nextMsgId = 1;
export const mkMessageId = (): string => `m_${nextMsgId++}`;

/** 从历史消息里取最大 id 数字，把 counter 推到那之后，避免 id 冲突 */
export function seedMessageId(maxSeen: number): void {
  if (maxSeen + 1 > nextMsgId) nextMsgId = maxSeen + 1;
}
