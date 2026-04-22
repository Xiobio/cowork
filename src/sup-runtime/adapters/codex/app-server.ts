/**
 * Codex app-server 的 JSON-RPC 2.0 客户端。
 *
 * 只做协议层：request/response 匹配 + notification 分发 + server-initiated
 * request 的 handler。不知道 Codex 的具体业务语义，那在 index.ts 里。
 *
 * 假设：
 * - stdin/stdout 都是**行分隔**的 JSON（每行一条消息），不是 LSP 风格的
 *   Content-Length 头。如果 Codex 未来改了这点，这里会一行一行被读错。
 * - 所有 server-initiated request 我们都必须响应，否则 server 可能卡住。
 * - child.stderr 的内容我们只原样输出到 process.stderr（debugging 用）。
 */

import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

// ─── JSON-RPC 基本类型 ──────────────────────────────────

type Id = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: Id;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponseSuccess {
  jsonrpc: '2.0';
  id: Id;
  result: unknown;
}

export interface JsonRpcResponseError {
  jsonrpc: '2.0';
  id: Id;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcResponseSuccess | JsonRpcResponseError;

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

// ─── Client ─────────────────────────────────────────────

type NotificationHandler = (params: unknown) => void;
type RequestHandler = (params: unknown) => Promise<unknown>;

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (err: Error) => void;
}

export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<Id, PendingRequest>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private stderrBuffer = '';
  private closed = false;

  // 如果有任何 serverrequest 没配 handler，就按方法名记一下然后 -32601 返回。
  // 避免 Codex 挂起。
  public defaultRequestHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null;
  public onProtocolError: ((err: Error, raw?: string) => void) | null = null;
  /** 是否把子进程 stderr 转发到 process.stderr。默认只有 debug 模式打开。 */
  public stderrPassthrough: boolean;

  constructor(private readonly child: ChildProcess) {
    this.stderrPassthrough = process.env.COWORK_DEBUG === '1';
    if (!child.stdin || !child.stdout) {
      throw new Error('JsonRpcClient: child must have stdin and stdout pipes');
    }

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.handleIncomingLine(trimmed);
    });
    rl.on('close', () => {
      this.closed = true;
      // 拒绝所有还在等的 request
      const err = new Error('JsonRpcClient: child stdout closed');
      for (const pending of this.pending.values()) {
        pending.reject(err);
      }
      this.pending.clear();
    });

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (!this.stderrPassthrough) return;
        this.stderrBuffer += chunk;
        const idx = this.stderrBuffer.lastIndexOf('\n');
        if (idx !== -1) {
          const toWrite = this.stderrBuffer.slice(0, idx + 1);
          this.stderrBuffer = this.stderrBuffer.slice(idx + 1);
          process.stderr.write(`[codex stderr] ${toWrite}`);
        }
      });
    }
  }

  private handleIncomingLine(line: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch (err) {
      this.onProtocolError?.(
        new Error(`parse error: ${(err as Error).message}`),
        line,
      );
      return;
    }

    if (typeof msg !== 'object' || msg === null) {
      this.onProtocolError?.(new Error('message is not an object'), line);
      return;
    }
    // 注意：Codex app-server 不带 jsonrpc 字段，所以不强校验。
    // 只按形状（id + result/error | id + method | method only）分派。

    // response: has id AND (result or error)
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const resp = msg as JsonRpcResponse;
      const pending = this.pending.get(resp.id);
      if (!pending) {
        this.onProtocolError?.(new Error(`unmatched response id=${resp.id}`), line);
        return;
      }
      this.pending.delete(resp.id);
      if ('error' in resp) {
        pending.reject(new JsonRpcError(resp.error.code, resp.error.message, resp.error.data));
      } else {
        pending.resolve(resp.result);
      }
      return;
    }

    // server-initiated request: has id AND method
    if ('id' in msg && 'method' in msg) {
      const req = msg as JsonRpcRequest;
      this.handleServerRequest(req);
      return;
    }

    // notification: no id, has method
    if ('method' in msg) {
      const notif = msg as JsonRpcNotification;
      const handler = this.notificationHandlers.get(notif.method);
      handler?.(notif.params);
      return;
    }

    this.onProtocolError?.(new Error('unknown message shape'), line);
  }

  private async handleServerRequest(req: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(req.method) ?? (this.defaultRequestHandler
      ? (params: unknown) => this.defaultRequestHandler!(req.method, params)
      : null);

    if (!handler) {
      this.sendError(req.id, -32601, `Method not found: ${req.method}`);
      return;
    }

    try {
      const result = await handler(req.params);
      this.sendResponse(req.id, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendError(req.id, -32603, `Internal error: ${msg}`);
    }
  }

  // ─── 发送 ────────────────────────────

  public request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('JsonRpcClient: connection closed'));
    }
    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;
    const p = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.writeLine(payload);
    return p as Promise<T>;
  }

  public notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const payload: JsonRpcNotification = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    this.writeLine(payload);
  }

  public onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  public onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  private sendResponse(id: Id, result: unknown): void {
    if (this.closed) return;
    const payload: JsonRpcResponseSuccess = { jsonrpc: '2.0', id, result };
    this.writeLine(payload);
  }

  private sendError(id: Id, code: number, message: string, data?: unknown): void {
    if (this.closed) return;
    const payload: JsonRpcResponseError = {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    };
    this.writeLine(payload);
  }

  private writeLine(msg: JsonRpcMessage): void {
    const line = JSON.stringify(msg) + '\n';
    if (!this.child.stdin || this.child.stdin.destroyed) return;
    this.child.stdin.write(line);
  }
}
