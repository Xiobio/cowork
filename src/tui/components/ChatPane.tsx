/**
 * 对话面板 —— 无边框版。直接铺满可用空间。
 */

import { Box, Text } from 'ink';
import type { ChatMessage } from '../state.js';

interface Props {
  messages: ChatMessage[];
  height: number;
}

export function ChatPane({ messages, height }: Props) {
  const visible = pickLatest(messages, height);

  if (visible.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>type a message to start. /help for suggestions.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {visible.map((m) => <MessageRow key={m.id} message={m} />)}
    </Box>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <Box marginTop={1}>
        <Text color="cyan" bold>&gt; </Text>
        <Text color="white">{message.text}</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Text>{message.text || (message.streaming ? '...' : '')}</Text>
    </Box>
  );
}

function pickLatest(messages: ChatMessage[], maxLines: number): ChatMessage[] {
  const result: ChatMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const lines = estimateDisplayLines(m);
    if (used + lines > maxLines && result.length > 0) break;
    result.unshift(m);
    used += lines;
    if (used >= maxLines) break;
  }
  return result;
}

function estimateDisplayLines(m: ChatMessage): number {
  const text = m.text || '...';
  const displayWidth = 70;
  const textCols = stringDisplayWidth(m.role === 'user' ? `> ${text}` : text);
  const textLines = Math.max(1, Math.ceil(textCols / displayWidth));
  return textLines + 1;
}

function stringDisplayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}
