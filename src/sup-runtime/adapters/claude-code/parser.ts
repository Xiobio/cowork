/**
 * Claude Code stdout NDJSON 事件 → CanonicalEvent 转换。
 *
 * Claude Code 的 stream-json 事件按类型分成这几类：
 *   - system (subtype=init): 启动信息，带 session_id
 *   - stream_event (Anthropic Messages API 原始事件，例如 content_block_delta)
 *   - assistant (一整条已经完成的 assistant 消息)
 *   - user (tool_result 回显)
 *   - result (整个 turn 完成，带 cost / usage)
 *
 * 我们只处理我们关心的子集，其它 return []。
 */

import type { CanonicalEvent } from '../../types.js';

type RawEvent = Record<string, unknown>;

const now = (): Date => new Date();

export function parseClaudeEvent(raw: RawEvent): CanonicalEvent[] {
  const type = raw.type;
  if (typeof type !== 'string') return [];

  switch (type) {
    case 'system':
      return parseSystem(raw);
    case 'stream_event':
      return parseStreamEvent(raw);
    case 'assistant':
      return parseAssistant(raw);
    case 'user':
      return parseUserEcho(raw);
    case 'result':
      return parseResult(raw);
    default:
      return [];
  }
}

function parseSystem(raw: RawEvent): CanonicalEvent[] {
  if (raw.subtype !== 'init') return [];
  const sid = raw.session_id;
  if (typeof sid !== 'string') return [];
  return [{ type: 'session_started', cliSessionId: sid, ts: now() }];
}

function parseStreamEvent(raw: RawEvent): CanonicalEvent[] {
  const event = raw.event as RawEvent | undefined;
  if (!event || typeof event !== 'object') return [];
  const eventType = event.type;
  if (eventType !== 'content_block_delta') return [];
  const delta = event.delta as RawEvent | undefined;
  if (!delta || delta.type !== 'text_delta') return [];
  const text = delta.text;
  if (typeof text !== 'string' || text.length === 0) return [];
  return [{ type: 'assistant_text_delta', delta: text, ts: now() }];
}

interface ContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

function parseAssistant(raw: RawEvent): CanonicalEvent[] {
  const message = raw.message as RawEvent | undefined;
  if (!message || typeof message !== 'object') return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];

  const events: CanonicalEvent[] = [];
  for (const block of content as ContentBlock[]) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      events.push({ type: 'assistant_text', text: block.text, ts: now() });
    } else if (block.type === 'tool_use' && block.id && block.name) {
      events.push({
        type: 'tool_call',
        toolName: block.name,
        input: block.input,
        callId: block.id,
        ts: now(),
      });
    } else if (block.type === 'thinking' && typeof block.text === 'string') {
      events.push({ type: 'thinking', text: block.text, ts: now() });
    }
  }
  return events;
}

function parseUserEcho(raw: RawEvent): CanonicalEvent[] {
  // user 事件里出现的是 tool_result blocks（工具返回给 assistant 看的）
  const message = raw.message as RawEvent | undefined;
  if (!message || typeof message !== 'object') return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];

  const events: CanonicalEvent[] = [];
  for (const block of content as ContentBlock[]) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      events.push({
        type: 'tool_result',
        callId: block.tool_use_id,
        output: block.content ?? '',
        isError: block.is_error === true,
        ts: now(),
      });
    }
  }
  return events;
}

function parseResult(raw: RawEvent): CanonicalEvent[] {
  const subtype = typeof raw.subtype === 'string' ? raw.subtype : 'success';
  const isError = raw.is_error === true || subtype.startsWith('error');
  let stopReason: 'end_turn' | 'max_tokens' | 'interrupted' | 'error';
  if (isError) stopReason = 'error';
  else if (subtype === 'success') stopReason = 'end_turn';
  else if (subtype === 'error_max_turns' || subtype === 'error_during_execution') stopReason = 'error';
  else stopReason = 'end_turn';
  return [{ type: 'turn_completed', stopReason, ts: now() }];
}
