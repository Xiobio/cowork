/**
 * Adapter 注册表 —— 按名字拿具体的 adapter 实现。
 *
 * 加新 CLI 时只动这个文件和对应的 adapters/<name>/ 目录。
 */

import type { CliAdapter } from './types.js';
import { CodexAdapter } from './adapters/codex/index.js';
import { ClaudeCodeAdapter } from './adapters/claude-code/index.js';

const adapters = new Map<string, CliAdapter>();

// 一个 adapter 可以注册多个别名
const codex = new CodexAdapter();
adapters.set('codex', codex);

const claudeCode = new ClaudeCodeAdapter();
adapters.set('claude', claudeCode);
adapters.set('claude-code', claudeCode);

export function getAdapter(name: string): CliAdapter {
  const a = adapters.get(name);
  if (!a) {
    const available = [...adapters.keys()].join(', ');
    throw new Error(`未知 adapter: "${name}"。已注册的：${available}`);
  }
  return a;
}

export function listAdapters(): CliAdapter[] {
  // 一个 adapter 可能有多个别名，这里按 name 去重
  const seen = new Set<string>();
  const unique: CliAdapter[] = [];
  for (const a of adapters.values()) {
    if (seen.has(a.name)) continue;
    seen.add(a.name);
    unique.push(a);
  }
  return unique;
}
