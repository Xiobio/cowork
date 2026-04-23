/**
 * TUI 中央状态。React useReducer 驱动。
 *
 * 只保留 App.tsx 真正读取的字段：status / chat / workers / currentTurnToolCalls /
 * cliSessionId / pid / adapterName。早期迭代里的 feed / turnCount / lastToolCallCount
 * 已经被 Static scrollback 方案取代，reducer 维护它们但没人读，删掉。
 */

import type { WorkerView } from './types.js';

export type Status =
  | { kind: 'starting'; message: string }
  | { kind: 'ready' }
  | { kind: 'chatting' }
  | { kind: 'error'; message: string }
  | { kind: 'stopped' };

export interface ChatMessage {
  id: string;
  role: 'user' | 'sup';
  text: string;
  ts: Date;
  streaming?: boolean;
}

export interface AppState {
  status: Status;
  adapterName: string;
  adapterDisplayName: string;
  cliSessionId: string | null;
  pid: number | null;
  chat: ChatMessage[];
  workers: WorkerView[];
  /** 当前 turn 已经看到的工具调用次数（chat 开始时归零、chat 进行中增量）*/
  currentTurnToolCalls: number;
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
  currentTurnToolCalls: 0,
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
  | { type: 'error'; message: string }
  | { type: 'clear-chat' };

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
        chat: state.chat.map((m) =>
          m.id === action.messageId && m.streaming ? { ...m, streaming: false } : m,
        ),
      };

    case 'tool-call':
      return {
        ...state,
        currentTurnToolCalls: state.currentTurnToolCalls + 1,
      };

    case 'error':
      return {
        ...state,
        status: { kind: 'error', message: action.message },
      };

    case 'clear-chat':
      return {
        ...state,
        chat: [],
      };

    default:
      return state;
  }
}

// ─── id 工具 ─────────────────────────────────────

let nextMsgId = 1;
export const mkMessageId = (): string => `m_${nextMsgId++}`;
