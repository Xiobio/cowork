/**
 * Session 持久化 —— 让 cowork 下次打开还能看到历史对话和工人清单。
 *
 * 目录布局：
 *   .cowork/
 *     sessions/
 *       <session-id>/
 *         meta.json       { id, createdAt, lastUsedAt, adapter, supCliSessionId? }
 *         chat.jsonl      append-only 对话记录（每行一条 ChatEntry JSON）
 *         workers.json    最后一次快照的工人清单
 *
 * 约定：
 * - session-id = ISO timestamp 去掉 ":" 替换成 "-"，方便作文件名
 * - chat 用 append-only 防止崩溃丢整段
 * - workers.json 是覆盖写（每次工人状态变更重写一次）
 * - 无锁机制，同一 session 不要多个 cowork 进程同时打开
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';

/** 大文件 tail 读取阈值。文件超过这个大小就只读最后一段，避免 readFileSync 整个文件占内存。 */
const TAIL_THRESHOLD = 2_000_000; // 2MB
const TAIL_CHUNK = 500_000; // 500KB

export interface SessionMeta {
  id: string;
  adapter: string;
  createdAt: string; // ISO
  lastUsedAt: string; // ISO
  /** Sup CLI 自己的 session id，未来 phase 2 用来 --resume */
  supCliSessionId?: string | null;
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'sup';
  text: string;
  ts: string; // ISO
}

export interface WorkerSnapshot {
  name: string;
  cwd: string;
  initialPrompt: string;
  adapterName: string;
  /** 上次保存时的状态（下次打开时所有都按 stopped/dormant 处理）*/
  state: string;
  /** 保存时的 cliSessionId，phase 2 resume 用 */
  cliSessionId?: string | null;
  lastActivity: string; // ISO
  eventCount: number;
  tokenUsed: number;
}

export interface SessionBundle {
  meta: SessionMeta;
  chat: ChatEntry[];
  workers: WorkerSnapshot[];
}

// ─── 路径工具 ─────────────────────────────────

export function sessionsRoot(cwd: string): string {
  return join(cwd, '.cowork', 'sessions');
}

function sessionDir(cwd: string, id: string): string {
  return join(sessionsRoot(cwd), id);
}

function metaPath(cwd: string, id: string): string {
  return join(sessionDir(cwd, id), 'meta.json');
}

function chatPath(cwd: string, id: string): string {
  return join(sessionDir(cwd, id), 'chat.jsonl');
}

function workersPath(cwd: string, id: string): string {
  return join(sessionDir(cwd, id), 'workers.json');
}

// ─── 生成 id ─────────────────────────────────

export function newSessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ─── 写 ─────────────────────────────────

export function createSession(cwd: string, adapter: string): SessionMeta {
  const id = newSessionId();
  const dir = sessionDir(cwd, id);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const meta: SessionMeta = {
    id,
    adapter,
    createdAt: now,
    lastUsedAt: now,
  };
  writeFileSync(metaPath(cwd, id), JSON.stringify(meta, null, 2));
  writeFileSync(workersPath(cwd, id), '[]');
  // chat.jsonl 延迟到第一条消息才建（避免空 session 污染 list）
  return meta;
}

export function touchSession(cwd: string, id: string): void {
  const p = metaPath(cwd, id);
  if (!existsSync(p)) return;
  try {
    const meta = JSON.parse(readFileSync(p, 'utf8')) as SessionMeta;
    meta.lastUsedAt = new Date().toISOString();
    writeFileSync(p, JSON.stringify(meta, null, 2));
  } catch {
    /* ignore */
  }
}

export function updateMeta(cwd: string, id: string, patch: Partial<SessionMeta>): void {
  const p = metaPath(cwd, id);
  if (!existsSync(p)) return;
  try {
    const meta = JSON.parse(readFileSync(p, 'utf8')) as SessionMeta;
    const merged = { ...meta, ...patch, lastUsedAt: new Date().toISOString() };
    writeFileSync(p, JSON.stringify(merged, null, 2));
  } catch {
    /* ignore */
  }
}

export function appendChat(cwd: string, id: string, entry: ChatEntry): void {
  try {
    appendFileSync(chatPath(cwd, id), JSON.stringify(entry) + '\n');
  } catch {
    /* ignore */
  }
}

export function saveWorkers(cwd: string, id: string, workers: WorkerSnapshot[]): void {
  const p = workersPath(cwd, id);
  // 覆盖写 + rename 保证原子性
  const tmp = p + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(workers, null, 2));
    renameSync(tmp, p);
  } catch {
    /* ignore */
  }
}

// ─── 读 ─────────────────────────────────

/**
 * 读 chat.jsonl 的最后 maxLines 条。
 * 文件 < 2MB：全文 split 然后 slice(-maxLines)
 * 文件 ≥ 2MB：从末尾 seek 500KB chunk，跳过第一条可能切半的行，parse
 */
export function readChatTail(cwd: string, id: string, maxLines: number): ChatEntry[] {
  const p = chatPath(cwd, id);
  if (!existsSync(p)) return [];
  const size = statSync(p).size;
  if (size < TAIL_THRESHOLD) {
    const raw = readFileSync(p, 'utf8');
    return parseChatLines(raw).slice(-maxLines);
  }

  // 大文件：tail 读
  const fd = openSync(p, 'r');
  try {
    const chunk = Math.min(TAIL_CHUNK, size);
    const buf = Buffer.alloc(chunk);
    readSync(fd, buf, 0, chunk, size - chunk);
    const text = buf.toString('utf8');
    // 第一行可能切了半条，从第一个 \n 之后开始
    const firstNl = text.indexOf('\n');
    const safeText = firstNl >= 0 ? text.slice(firstNl + 1) : text;
    return parseChatLines(safeText).slice(-maxLines);
  } finally {
    closeSync(fd);
  }
}

function parseChatLines(raw: string): ChatEntry[] {
  const out: ChatEntry[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as ChatEntry);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

export function listSessions(cwd: string): SessionMeta[] {
  const root = sessionsRoot(cwd);
  if (!existsSync(root)) return [];
  const ids = readdirSync(root).filter((f) => {
    try {
      return statSync(join(root, f)).isDirectory();
    } catch {
      return false;
    }
  });
  const metas: SessionMeta[] = [];
  for (const id of ids) {
    const mp = metaPath(cwd, id);
    if (!existsSync(mp)) continue;
    try {
      const meta = JSON.parse(readFileSync(mp, 'utf8')) as SessionMeta;
      metas.push(meta);
    } catch {
      /* 跳过损坏 */
    }
  }
  // 最近使用优先
  metas.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  return metas;
}

export function findLatestSession(cwd: string): SessionMeta | null {
  const all = listSessions(cwd);
  return all[0] ?? null;
}

/** 给 --list-sessions / /sessions 用的总览：每个 session 加上 chat 行数和 worker 数 */
export interface SessionSummary extends SessionMeta {
  chatLines: number;
  workerCount: number;
}

export function summarizeSession(cwd: string, id: string): SessionSummary | null {
  const mp = metaPath(cwd, id);
  if (!existsSync(mp)) return null;
  let meta: SessionMeta;
  try {
    meta = JSON.parse(readFileSync(mp, 'utf8')) as SessionMeta;
  } catch {
    return null;
  }
  let chatLines = 0;
  const cp = chatPath(cwd, id);
  if (existsSync(cp)) {
    // 不全文 parse —— 大文件就估算（按 size / 平均行长）
    const size = statSync(cp).size;
    if (size < TAIL_THRESHOLD) {
      chatLines = readFileSync(cp, 'utf8').split('\n').filter((s) => s.trim()).length;
    } else {
      chatLines = Math.round(size / 200); // 假设每条 ~200 字节
    }
  }
  let workerCount = 0;
  const wp = workersPath(cwd, id);
  if (existsSync(wp)) {
    try {
      const workers = JSON.parse(readFileSync(wp, 'utf8')) as WorkerSnapshot[];
      workerCount = workers.length;
    } catch { /* ignore */ }
  }
  return { ...meta, chatLines, workerCount };
}

export function summarizeAllSessions(cwd: string): SessionSummary[] {
  return listSessions(cwd)
    .map((m) => summarizeSession(cwd, m.id))
    .filter((s): s is SessionSummary => s !== null);
}

export function loadSession(cwd: string, id: string): SessionBundle | null {
  const mp = metaPath(cwd, id);
  if (!existsSync(mp)) return null;
  let meta: SessionMeta;
  try {
    meta = JSON.parse(readFileSync(mp, 'utf8')) as SessionMeta;
  } catch {
    return null;
  }

  const chat: ChatEntry[] = readChatTail(cwd, id, /* maxLines */ 500);

  let workers: WorkerSnapshot[] = [];
  const wp = workersPath(cwd, id);
  if (existsSync(wp)) {
    try {
      workers = JSON.parse(readFileSync(wp, 'utf8')) as WorkerSnapshot[];
    } catch {
      /* ignore */
    }
  }

  return { meta, chat, workers };
}
