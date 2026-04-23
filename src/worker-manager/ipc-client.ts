/**
 * IPC client —— 在 MCP server 子进程里用，打回 cowork 主进程的 IpcServer。
 *
 * 和 server 对齐的协议：每行一条 JSON。启动后立刻发 hello（带 token），
 * 收到 hello_ack 才算连上，然后就可以发 request 等 response。
 */

import { createConnection, type Socket } from 'node:net';

export interface IpcClientOptions {
  host: string;
  port: number;
  token: string;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class IpcClient {
  private socket: Socket | null = null;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly opts: IpcClientOptions) {}

  async connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.opts.port, this.opts.host);
      socket.setEncoding('utf8');

      // 持久 error listener：握手期间任何错误 reject 外面的 connect Promise；
      // 握手完之后再 fire 的错误 reject 是 no-op，但起码 socket 的 'error'
      // 事件有人接，不会被 node 当 unhandled 整个进程崩。close 会兜底清 pending。
      socket.on('error', (err) => reject(err));

      socket.on('data', (chunk: string) => {
        this.buffer += chunk;
        let idx: number;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          this.handleLine(line, resolve, reject);
        }
      });

      socket.on('close', () => {
        this.connected = false;
        this.connectPromise = null; // 允许下次 connect() 重试
        const err = new Error('IPC connection closed');
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      });

      this.socket = socket;

      // 发 hello
      socket.write(JSON.stringify({ type: 'hello', token: this.opts.token }) + '\n');
    });

    return this.connectPromise;
  }

  private handleLine(line: string, resolveConnect: () => void, rejectConnect: (e: Error) => void): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (!this.connected) {
      if (msg.type === 'hello_ack') {
        this.connected = true;
        resolveConnect();
      } else if (msg.type === 'hello_nack') {
        rejectConnect(new Error(`IPC 握手失败: ${msg.error ?? 'unknown'}`));
      }
      return;
    }

    const id = msg.id;
    if (typeof id !== 'number') return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);

    if (typeof msg.error === 'string') {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    await this.connect();
    if (!this.socket || this.socket.destroyed) {
      throw new Error('IPC socket not connected');
    }
    const id = this.nextId++;
    const payload = { id, method, params: params ?? {} };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      try {
        this.socket!.write(JSON.stringify(payload) + '\n');
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  close(): void {
    if (this.socket) {
      try {
        this.socket.end();
      } catch { /* ignore */ }
      this.socket = null;
    }
    this.connected = false;
  }
}
