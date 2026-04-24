/**
 * cowork MCP server —— 独立 stdio 子进程，被 Sup (codex/claude) spawn。
 *
 * 不再持有状态！所有工具调用都通过 IPC 打回 cowork 主进程里的真
 * WorkerManager，那边才是事实源。
 *
 * 连接流程：
 * 1. 从 env var 读 COWORK_IPC_HOST / PORT / TOKEN
 * 2. connect 到 IpcServer，握手（发 hello 带 token）
 * 3. 注册 12 个 MCP 工具，每个工具 handler 把参数转发成 IPC request
 * 4. 从 IPC 收到 result 后 wrap 成 MCP CallToolResult 返回
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve as pathResolve, join as pathJoin } from 'node:path';

import { IpcClient } from '../worker-manager/ipc-client.js';

const log = (...args: unknown[]): void => {
  process.stderr.write(
    `[mcp-server] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`,
  );
};

const j = (v: unknown): string => JSON.stringify(v, null, 2);

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

function readIpcEnv(): { host: string; port: number; token: string } {
  const host = process.env.COWORK_IPC_HOST;
  const portStr = process.env.COWORK_IPC_PORT;
  const token = process.env.COWORK_IPC_TOKEN;
  if (!host || !portStr || !token) {
    throw new Error(
      `MCP server 需要 cowork 主进程通过 env 传 COWORK_IPC_{HOST,PORT,TOKEN}。当前: host=${host} port=${portStr} token=${token ? '(set)' : '(missing)'}`,
    );
  }
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port)) {
    throw new Error(`COWORK_IPC_PORT 不是数字: ${portStr}`);
  }
  return { host, port, token };
}

function getMainCwd(): string {
  // cowork 主进程的 cwd，由 index.ts buildMcpServerConfig 传进来。
  // 如果 env 丢了就退回 MCP server 自己的 cwd（通常等价）。
  return process.env.COWORK_MAIN_CWD || process.cwd();
}

function getSessionId(): string | null {
  return process.env.COWORK_SESSION_ID || null;
}

/** 把"当前目录" / 相对路径 解析成绝对路径。不存在的路径也原样返回不校验（spawn 会再报错）。*/
function resolveWorkerCwd(input: string): string {
  const mainCwd = getMainCwd();
  const trimmed = input.trim();
  if (!trimmed || trimmed === '.' || trimmed === './' || trimmed === '当前目录') {
    return mainCwd;
  }
  if (isAbsolute(trimmed)) return trimmed;
  return pathResolve(mainCwd, trimmed);
}

/** 读当前 session 的 chat.jsonl 给 Sup 作为"上次做了什么"的记忆 */
function loadChatHistoryText(limit: number): string {
  const sid = getSessionId();
  if (!sid) return '(无 session id，读不到历史)';
  const p = pathJoin(getMainCwd(), '.cowork', 'sessions', sid, 'chat.jsonl');
  if (!existsSync(p)) return '(本 session 还没有历史对话)';
  const raw = readFileSync(p, 'utf8');
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const entry = JSON.parse(t) as { role: string; text: string; ts: string };
      const tag = entry.role === 'user' ? '你' : '总管';
      const ts = entry.ts ? ` [${entry.ts}]` : '';
      lines.push(`${tag}${ts}:\n${entry.text}`);
    } catch {
      /* skip bad line */
    }
  }
  const tail = lines.slice(-limit);
  return tail.join('\n\n---\n\n') || '(无历史)';
}

async function main(): Promise<void> {
  log('启动 cowork MCP server');

  const ipcInfo = readIpcEnv();
  const ipc = new IpcClient(ipcInfo);
  try {
    await ipc.connect();
    log('已连上 cowork 主进程 IPC');
  } catch (err) {
    log('致命: 连不上 cowork 主进程', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // 辅助：把 ipc 返回值包成 MCP text 结果
  const tool = async <T>(method: string, params: Record<string, unknown>): Promise<ReturnType<typeof text>> => {
    try {
      const result = await ipc.request<T>(method, params);
      if (result === null || result === undefined) {
        return text('null');
      }
      if (typeof result === 'string') return text(result);
      return text(j(result));
    } catch (err) {
      return text(`错误: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const server = new McpServer(
    {
      name: 'cowork-tools',
      version: '0.1.0',
    },
    {
      capabilities: { tools: {} },
    },
  );

  // ─── 观察类 ──────────────────────────────────

  server.registerTool(
    'list_workers',
    {
      description:
        '列出所有工人及其体征：name、state (starting/running/idle/blocked/stopped)、lastActivity、tokenUsed、currentAction、eventCount、cwd、adapterName。成本极低，每次对话开始时调用一次用来同步整体状态。返回一个 JSON 数组；数组为空说明还没有招任何工人。',
      inputSchema: {},
    },
    async () => tool('list_workers', {}),
  );

  server.registerTool(
    'get_vitals',
    {
      description: '获取某一个工人的最新体征。低成本。',
      inputSchema: {
        name: z.string().describe('工人的名字，如 "小A"'),
      },
    },
    async ({ name }) => tool('get_worker', { name }),
  );

  server.registerTool(
    'peek_events',
    {
      description:
        '读某个工人最近的事件元数据（不含正文）。每条返回 id/type/toolName/size/preview(80字)/ts。这是你的主力工具 —— 扫预览判断是否值得 read_event 拉正文。assistant_text 的预览就是文本前 80 字；tool_call 的预览是 "工具名(参数片段)"。',
      inputSchema: {
        name: z.string().describe('工人名字'),
        since: z.string().optional().describe('只返回此 event_id 之后的事件。用于增量同步。'),
        limit: z.number().int().min(1).max(100).optional().describe('返回最近的 N 条，默认 20'),
      },
    },
    async ({ name, since, limit }) => tool('peek_events', { name, since, limit }),
  );

  server.registerTool(
    'read_event',
    {
      description:
        '读某条事件的完整正文。比 peek 贵，只在事件属于重要档/警报档、或用户明确要细节时调用。',
      inputSchema: {
        event_id: z.string().describe('事件 ID，如 evt_00042'),
      },
    },
    async ({ event_id }) => tool('read_event', { event_id }),
  );

  server.registerTool(
    'get_worker_summary',
    {
      description: '读取你之前为某个工人维护的 running summary（心智模型）。零成本。',
      inputSchema: {
        name: z.string().describe('工人名字'),
      },
    },
    async ({ name }) => tool('get_summary', { name }),
  );

  // ─── 行动类 ──────────────────────────────────

  server.registerTool(
    'send_to_worker',
    {
      description:
        '把一条自然语言消息发给指定工人。工人会把它当成新的用户输入处理。用户说"让小A 换成 vitest"时，你调这个工具把用户意图转述给小A。',
      inputSchema: {
        name: z.string().describe('工人名字'),
        message: z.string().describe('要发给工人的消息正文'),
      },
    },
    async ({ name, message }) => tool('send_to_worker', { name, message }),
  );

  server.registerTool(
    'send_interrupt',
    {
      description:
        '中断工人当前正在跑的工具调用。只在用户明确要求中断、或者工人走偏卡死时才调。',
      inputSchema: {
        name: z.string().describe('工人名字'),
      },
    },
    async ({ name }) => tool('send_interrupt', { name }),
  );

  server.registerTool(
    'spawn_worker',
    {
      description:
        '招一个新工人。这会**真的启动一个新的 CLI subprocess**（Codex 或 Claude Code，取决于 cowork 的配置），它会跑用户给的任务。需要：名字（用户起的）、工作目录、初始任务描述。cwd 可以是绝对路径，也可以是相对于 cowork 主进程 cwd 的相对路径（"." 或 "./" 或 "当前目录" = 直接用主进程 cwd）。工人会被放进那个目录执行。注意：不要为 demo 目的乱招，每个工人都是真实的订阅配额消耗。',
      inputSchema: {
        name: z.string().describe('新工人的名字，必须和现有工人不重名'),
        cwd: z.string().describe('工作目录。可以是绝对路径，相对路径（基于 cowork 主进程 cwd 解析），或 "." / "当前目录" 表示直接用主进程 cwd'),
        initial_prompt: z.string().describe('给新工人的第一个任务描述'),
      },
    },
    async ({ name, cwd, initial_prompt }) =>
      tool('spawn_worker', { name, cwd: resolveWorkerCwd(cwd), initial_prompt }),
  );

  server.registerTool(
    'kill_worker',
    {
      description:
        '结束某个工人。默认 graceful=true，发 SIGINT 让它优雅停下。graceful=false 时硬杀。',
      inputSchema: {
        name: z.string().describe('工人名字'),
        graceful: z.boolean().optional().describe('是否优雅停止，默认 true'),
      },
    },
    async ({ name, graceful }) => tool('kill_worker', { name, graceful: graceful ?? true }),
  );

  // ─── 环境类（本地，不走 IPC）──────────────────────────────

  server.registerTool(
    'get_cwd',
    {
      description:
        '获取 cowork 主进程的工作目录（用户启动 cowork 时所在的目录）。用户说"当前目录"就是指这个。spawn_worker 其实也支持相对路径或 "."，你不用每次都问用户要绝对路径。',
      inputSchema: {},
    },
    async () => text(getMainCwd()),
  );

  server.registerTool(
    'get_session_history',
    {
      description:
        '读当前 session 的历史对话记录（你和用户之前说过什么，包括上次打开 cowork 的内容）。用户问"上次做了什么"、"还记得吗"这类话时调这个工具把记忆找回来。返回的是按时间排序的人话文本，不是事件流。limit 控制返回最近多少条。',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('返回最近多少条消息，默认 50'),
      },
    },
    async ({ limit }) => text(loadChatHistoryText(limit ?? 50)),
  );

  // ─── 记忆类 ──────────────────────────────────

  server.registerTool(
    'update_worker_summary',
    {
      description:
        '更新你对某个工人的 running summary。每次读了新事件后增量修改这份摘要（不重写），长度保持在 ~200 字。格式：状态 / 近况 / 风险 / 我不确定。下次再提这个工人时直接从这份摘要出发，不用重读老事件。',
      inputSchema: {
        name: z.string().describe('工人名字'),
        text: z.string().describe('新的 summary 全文（将覆盖旧的）'),
      },
    },
    async ({ name, text: summaryText }) =>
      tool('update_summary', { name, text: summaryText }),
  );

  server.registerTool(
    'note',
    {
      description:
        '写一条给你自己将来看的笔记（跨会话保留）。用于记用户的偏好、历史决策、工作流习惯等。',
      inputSchema: {
        key: z.string().describe('笔记的 key'),
        text: z.string().describe('笔记正文'),
      },
    },
    async ({ key, text: noteText }) => tool('note', { key, text: noteText }),
  );

  server.registerTool(
    'get_note',
    {
      description: '读之前用 note() 写的笔记。',
      inputSchema: {
        key: z.string().describe('笔记 key'),
      },
    },
    async ({ key }) => tool('get_note', { key }),
  );

  log('注册了 14 个工具，连接 stdio transport');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server ready');
}

main().catch((err) => {
  log('致命错误:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
