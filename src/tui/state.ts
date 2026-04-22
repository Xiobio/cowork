/**
 * TUI 中央状态。React useReducer 驱动。
 *
 * 一点架构说明：mock-daemon 是在 cowork 主进程里 import 的，TUI 从
 * 这里直接读 worker 状态。但真正调用工具的是 Sup 底下那个 MCP server
 * 子进程（它有自己独立的 mock-daemon 实例），所以主进程这一份状态
 * 默认是"初始种子"。
 *
 * 为了让 sidebar 和 Sup 看到的状态保持大致一致，TUI 在 ChatObserver
 * 里监听 Sup 的工具调用（spawn_worker / kill_worker / send_to_worker），
 * 把这些改动**镜像**到主进程自己的 mock-daemon 实例上。不是完美的
 * 事实源，但比纯静态好，且对 v0 demo 足够。
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

export interface FeedItem {
  id: string;
  type: 'tool_call' | 'chat_sent' | 'chat_received' | 'error' | 'info';
  label: string;
  workerName?: string | undefined;
  ts: Date;
}

export interface AppState {
  status: Status;
  adapterName: string;
  adapterDisplayName: string;
  cliSessionId: string | null;
  pid: number | null;
  chat: ChatMessage[];
  workers: WorkerView[];
  feed: FeedItem[]; // newest first, max FEED_MAX
  turnCount: number;
  /** 当前 turn 已经看到的工具调用次数（chat 开始时归零、chat 进行中增量）*/
  currentTurnToolCalls: number;
  /** 上一个 turn 最终的工具调用次数（turn 结束后冻结在这里，给"上一轮 N 次"展示）*/
  lastToolCallCount: number;
}

const FEED_MAX = 30;
const CHAT_MAX = 100; // 永远保留最后 N 条消息在内存里

export const initialState = (adapterName: string, adapterDisplayName: string): AppState => ({
  status: { kind: 'starting', message: '正在启动总管…' },
  adapterName,
  adapterDisplayName,
  cliSessionId: null,
  pid: null,
  chat: [],
  workers: [],
  feed: [],
  turnCount: 0,
  currentTurnToolCalls: 0,
  lastToolCallCount: 0,
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
  | { type: 'tool-error'; callId: string; message: string }
  | { type: 'error'; message: string }
  | { type: 'feed-push'; item: Omit<FeedItem, 'id' | 'ts'> }
  | { type: 'clear-chat' };

// ─── Reducer ─────────────────────────────────────

let nextFeedId = 1;
const mkFeedId = (): string => `f_${nextFeedId++}`;

function pushFeed(feed: FeedItem[], item: Omit<FeedItem, 'id' | 'ts'>): FeedItem[] {
  const newItem: FeedItem = { ...item, id: mkFeedId(), ts: new Date() };
  const next = [newItem, ...feed];
  if (next.length > FEED_MAX) next.length = FEED_MAX;
  return next;
}

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
        feed: pushFeed(state.feed, {
          type: 'chat_sent',
          label: action.text.length > 50 ? action.text.slice(0, 48) + '…' : action.text,
        }),
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
        turnCount: state.turnCount + 1,
        lastToolCallCount: action.toolCallCount,
        currentTurnToolCalls: 0,
        chat: state.chat.map((m) =>
          m.id === action.messageId && m.streaming ? { ...m, streaming: false } : m,
        ),
      };

    case 'tool-call':
      return {
        ...state,
        currentTurnToolCalls: state.currentTurnToolCalls + 1,
        feed: pushFeed(state.feed, {
          type: 'tool_call',
          label: `${action.toolName}${action.inputSummary ? ' ' + action.inputSummary : ''}`,
          workerName: action.workerName,
        }),
      };

    case 'tool-error':
      return {
        ...state,
        feed: pushFeed(state.feed, {
          type: 'error',
          label: `tool ${action.callId} 失败: ${action.message}`,
        }),
      };

    case 'error':
      return {
        ...state,
        status: { kind: 'error', message: action.message },
        feed: pushFeed(state.feed, { type: 'error', label: action.message }),
      };

    case 'feed-push':
      return {
        ...state,
        feed: pushFeed(state.feed, action.item),
      };

    case 'clear-chat':
      return {
        ...state,
        chat: [],
        feed: pushFeed(state.feed, { type: 'info', label: '聊天记录已清空' }),
      };

    default:
      return state;
  }
}

// ─── id 工具 ─────────────────────────────────────

let nextMsgId = 1;
export const mkMessageId = (): string => `m_${nextMsgId++}`;
