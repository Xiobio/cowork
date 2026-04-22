/**
 * Claude Code 的 stdin NDJSON 编码器。
 *
 * 它的 headless stream-json 模式每一行一条 JSON 消息，格式：
 *   {"type":"user","message":{"role":"user","content":"..."}}
 *
 * content 可以是字符串或 content block 数组（图片 / tool_result 等）。
 * 我们暂时只用字符串。
 */

import type { Writable } from 'node:stream';

export function writeUserMessage(stdin: Writable, text: string): void {
  const payload = {
    type: 'user',
    message: { role: 'user', content: text },
  };
  stdin.write(JSON.stringify(payload) + '\n');
}
