/**
 * Claude Code 的 stdin NDJSON 编码器。
 *
 * 它的 headless stream-json 模式每一行一条 JSON 消息，格式：
 *   {"type":"user","message":{"role":"user","content":"..."}}
 *
 * content 可以是字符串或 content block 数组（图片 / tool_result 等）。
 * 我们暂时只用字符串。
 *
 * 实现细节：用 stream.write(data, cb) 的回调把 EPIPE 等异步错误
 * propagate 回 Promise，不要靠外部的 error listener 吞掉 —— 否则上层
 * 会以为消息发出去了，实际 CLI 已死。
 */

import type { Writable } from 'node:stream';

export function writeUserMessage(stdin: Writable, text: string): Promise<void> {
  const payload = {
    type: 'user',
    message: { role: 'user', content: text },
  };
  const line = JSON.stringify(payload) + '\n';
  return new Promise((resolve, reject) => {
    stdin.write(line, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
