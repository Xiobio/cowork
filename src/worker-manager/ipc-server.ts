/**
 * IPC server —— 让 MCP server 子进程可以打 RPC 回到 cowork 主进程的
 * WorkerManager。
 *
 * 协议：newline-delimited JSON 消息。
 *   第一条必须是 hello：{"type":"hello","token":"..."}
 *   之后是请求：     {"id":N,"method":"...","params":{...}}
 *   服务端回：       {"id":N,"result":...} 或 {"id":N,"error":"..."}
 *
 * 只接受 127.0.0.1 连接，端口由 OS 分配（listen 0），token 是启动时
 * 随机生成的 UUID。MCP server 子进程通过 env var 知道地址和 token。
 */

import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';

import type { IWorkerManager } from './types.js';

interface IpcRequest {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

type HandlerResult = unknown;
type MethodHandler = (params: Record<string, unknown>) => Promise<HandlerResult> | HandlerResult;

export interface IpcServerInfo {
  host: string;
  port: number;
  token: string;
}

export class IpcServer {
  private readonly handlers = new Map<string, MethodHandler>();
  private server: Server | null = null;
  private info: IpcServerInfo | null = null;
  private readonly clients = new Set<Socket>();

  constructor(private readonly manager: IWorkerManager) {
    this.registerHandlers();
  }

  async start(): Promise<IpcServerInfo> {
    const token = randomBytes(16).toString('hex');
    const server = createServer((socket) => this.handleSocket(socket));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const addr = server.address();
    if (typeof addr !== 'object' || addr === null) {
      throw new Error('IpcServer: no address after listen');
    }

    this.server = server;
    this.info = { host: '127.0.0.1', port: addr.port, token };
    return this.info;
  }

  async stop(): Promise<void> {
    for (const socket of this.clients) {
      try {
        socket.destroy();
      } catch { /* ignore */ }
    }
    this.clients.clear();
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }

  getInfo(): IpcServerInfo | null {
    return this.info;
  }

  // ─── socket 处理 ────────────────────────────────

  private handleSocket(socket: Socket): void {
    this.clients.add(socket);
    let buffer = '';
    let authenticated = false;

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          this.clients.delete(socket);
          socket.destroy();
          return;
        }

        if (!authenticated) {
          if (
            typeof msg === 'object' &&
            msg !== null &&
            (msg as Record<string, unknown>).type === 'hello' &&
            (msg as Record<string, unknown>).token === this.info?.token
          ) {
            authenticated = true;
            socket.write(JSON.stringify({ type: 'hello_ack' }) + '\n');
          } else {
            socket.write(JSON.stringify({ type: 'hello_nack', error: 'bad token' }) + '\n');
            socket.destroy();
          }
          continue;
        }

        void this.handleRequest(socket, msg as IpcRequest);
      }
    });

    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => {
      this.clients.delete(socket);
    });
  }

  private async handleRequest(socket: Socket, req: IpcRequest): Promise<void> {
    if (typeof req !== 'object' || req === null || typeof req.method !== 'string') {
      this.send(socket, { id: req?.id ?? 0, error: 'bad request shape' });
      return;
    }
    const handler = this.handlers.get(req.method);
    if (!handler) {
      this.send(socket, { id: req.id, error: `unknown method: ${req.method}` });
      return;
    }
    try {
      const result = await handler(req.params ?? {});
      this.send(socket, { id: req.id, result });
    } catch (err) {
      this.send(socket, {
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private send(socket: Socket, msg: object): void {
    try {
      socket.write(JSON.stringify(msg) + '\n');
    } catch { /* ignore */ }
  }

  // ─── handler 注册 ────────────────────────────────

  private registerHandlers(): void {
    const m = this.manager;

    this.handlers.set('list_workers', () => m.listWorkers().map(workerInfoToJson));
    this.handlers.set('get_worker', (p) => {
      const name = str(p, 'name');
      const w = m.getWorker(name);
      return w ? workerInfoToJson(w) : null;
    });
    this.handlers.set('peek_events', (p) =>
      m.peekEvents(str(p, 'name'), {
        since: optStr(p, 'since'),
        limit: optNum(p, 'limit'),
      }),
    );
    this.handlers.set('read_event', (p) => m.readEvent(str(p, 'event_id')));
    this.handlers.set('get_summary', (p) => m.getSummary(str(p, 'name')));
    this.handlers.set('update_summary', (p) => ({
      ok: m.updateSummary(str(p, 'name'), str(p, 'text')),
    }));
    this.handlers.set('send_to_worker', async (p) =>
      m.sendToWorker(str(p, 'name'), str(p, 'message')),
    );
    this.handlers.set('send_interrupt', async (p) =>
      m.sendInterrupt(str(p, 'name')),
    );
    this.handlers.set('spawn_worker', async (p) =>
      m.spawnWorker(str(p, 'name'), str(p, 'cwd'), str(p, 'initial_prompt')),
    );
    this.handlers.set('kill_worker', async (p) =>
      m.killWorker(str(p, 'name'), (p['graceful'] as boolean | undefined) ?? true),
    );
    this.handlers.set('note', (p) => m.note(str(p, 'key'), str(p, 'text')));
    this.handlers.set('get_note', (p) => m.getNote(str(p, 'key')));
  }
}

// ─── 小工具 ──────────────────────────────────────

function str(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  if (typeof v !== 'string') {
    throw new Error(`缺少字符串参数 "${key}"`);
  }
  return v;
}

function optStr(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
}

function optNum(p: Record<string, unknown>, key: string): number | undefined {
  const v = p[key];
  return typeof v === 'number' ? v : undefined;
}

function workerInfoToJson(w: import('./types.js').WorkerInfo): Record<string, unknown> {
  return {
    name: w.name,
    cwd: w.cwd,
    initialPrompt: w.initialPrompt,
    adapterName: w.adapterName,
    state: w.state,
    pid: w.pid,
    cliSessionId: w.cliSessionId,
    lastActivity: w.lastActivity.toISOString(),
    tokenUsed: w.tokenUsed,
    currentAction: w.currentAction,
    eventCount: w.eventCount,
    summary: w.summary,
  };
}

/** 生成一个独立的 token（测试 / debugging 用）*/
export function generateToken(): string {
  return randomUUID().replace(/-/g, '');
}
