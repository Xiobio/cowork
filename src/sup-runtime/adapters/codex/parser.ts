/**
 * Codex app-server 通知 → CanonicalEvent 转换。
 *
 * 这个文件是无状态的：每个函数接受一个 notification，产出 0 或多个
 * CanonicalEvent。上层（CodexSession）调用这些函数并 enqueue 结果。
 *
 * 设计原则：
 * - 不 throw，遇到不认识的 notification 返回 [] 而不是崩溃
 * - 不维护跨 notification 的状态（session id / thread id 由 CodexSession 持有）
 * - 所有时间戳用 new Date() 现场生成（因为 Codex 不在 notification 里带时间戳）
 */

import type { CanonicalEvent } from '../../types.js';
import type {
  AgentMessageDeltaNotification,
  ErrorNotification,
  ItemCompletedNotification,
  ItemStartedNotification,
  ThreadItem,
  ThreadStartedNotification,
  TurnCompletedNotification,
} from './protocol.js';

const now = (): Date => new Date();

export function parseThreadStarted(params: ThreadStartedNotification): CanonicalEvent[] {
  return [
    {
      type: 'session_started',
      cliSessionId: params.thread.id,
      ts: now(),
    },
  ];
}

export function parseAgentMessageDelta(params: AgentMessageDeltaNotification): CanonicalEvent[] {
  if (!params.delta) return [];
  return [
    {
      type: 'assistant_text_delta',
      delta: params.delta,
      ts: now(),
    },
  ];
}

export function parseItemStarted(_params: ItemStartedNotification): CanonicalEvent[] {
  // 目前不在这里 emit 事件 —— item/completed 是权威源，delta 负责流式。
  // 未来要做 "工具开始执行" 的 UI 可以在这里发 tool_call 的 start 变体。
  return [];
}

export function parseItemCompleted(params: ItemCompletedNotification): CanonicalEvent[] {
  const item = params.item;
  return parseCompletedItem(item);
}

function parseCompletedItem(item: ThreadItem): CanonicalEvent[] {
  switch (item.type) {
    case 'agentMessage': {
      const agent = item as Extract<ThreadItem, { type: 'agentMessage' }>;
      // 有些 agentMessage 事件 text 是空串（比如只是 phase 指示器）
      if (!agent.text) return [];
      return [
        {
          type: 'assistant_text',
          text: agent.text,
          ts: now(),
        },
      ];
    }

    case 'commandExecution': {
      const cmd = item as Extract<ThreadItem, { type: 'commandExecution' }>;
      return [
        {
          type: 'tool_call',
          toolName: 'bash',
          input: { command: cmd.command, cwd: cmd.cwd },
          callId: cmd.id,
          ts: now(),
        },
        {
          type: 'tool_result',
          callId: cmd.id,
          output: {
            exitCode: cmd.exitCode ?? null,
            output: cmd.aggregatedOutput ?? '',
          },
          isError: (cmd.exitCode ?? 0) !== 0,
          ts: now(),
        },
      ];
    }

    case 'mcpToolCall': {
      const mcp = item as Extract<ThreadItem, { type: 'mcpToolCall' }>;
      const events: CanonicalEvent[] = [
        {
          type: 'tool_call',
          toolName: `${mcp.server}.${mcp.tool}`,
          input: mcp.arguments,
          callId: mcp.id,
          ts: now(),
        },
      ];
      if (mcp.error) {
        events.push({
          type: 'tool_result',
          callId: mcp.id,
          output: mcp.error,
          isError: true,
          ts: now(),
        });
      } else if (mcp.result !== undefined) {
        events.push({
          type: 'tool_result',
          callId: mcp.id,
          output: mcp.result,
          isError: false,
          ts: now(),
        });
      }
      return events;
    }

    case 'reasoning': {
      const reasoning = item as Extract<ThreadItem, { type: 'reasoning' }>;
      const text = reasoning.summary.join('\n') || reasoning.content.join('\n');
      if (!text) return [];
      return [{ type: 'thinking', text, ts: now() }];
    }

    case 'userMessage':
      // 回显，忽略
      return [];

    default:
      // 未知 item 类型（可能是 fileChange / webSearch / etc.）
      // 先当成一个 tool_call 事件记下来，让上层知道发生了什么
      return [
        {
          type: 'tool_call',
          toolName: `codex.${item.type}`,
          input: item,
          callId: item.id,
          ts: now(),
        },
      ];
  }
}

export function parseTurnCompleted(params: TurnCompletedNotification): CanonicalEvent[] {
  const status = typeof params.turn.status === 'string' ? params.turn.status : 'completed';
  let stopReason: 'end_turn' | 'max_tokens' | 'interrupted' | 'error';
  switch (status) {
    case 'completed':
    case 'active':
      stopReason = 'end_turn';
      break;
    case 'interrupted':
      stopReason = 'interrupted';
      break;
    case 'failed':
      stopReason = 'error';
      break;
    default:
      stopReason = 'end_turn';
  }
  return [{ type: 'turn_completed', stopReason, ts: now() }];
}

export function parseError(params: ErrorNotification): CanonicalEvent[] {
  const message = typeof params.message === 'string' ? params.message : JSON.stringify(params);
  return [
    {
      type: 'session_error',
      message,
      fatal: false,
      ts: now(),
    },
  ];
}
