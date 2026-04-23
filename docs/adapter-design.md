# Adapter 层设计

本文定义 cowork 的 **Adapter 接口** —— 让同一个总管规则能跑在不同
的 CLI 后端上（Codex、Claude Code，将来还会有 Gemini / OpenCode 等）。

Adapter 是 cowork 主进程和 CLI subprocess 之间的翻译层。上面对接
`Supervisor`（总管的大脑，纯规则），下面对接各种不同协议格式的 CLI。

> 如果你在找"总管应该怎么读事件怎么汇报"，那是 [`supervisor-spec.md`](supervisor-spec.md)。
> 本文只管**承载总管的那个 CLI 进程怎么 spawn、喂什么、读什么**。

---

## 1. 目标

1. **一份 Sup 系统提示词，跑在多个 CLI 上**。新增一个 CLI 只要写
   一个 adapter，不用改总管本身
2. **统一的事件 schema**。上层（cowork 主进程、UI）不关心底层是
   Codex 的 JSON-RPC 还是 Claude Code 的 NDJSON，看到的是 canonical
   事件
3. **无状态 adapter**（尽量）。每个 CLI 会话的状态用 `RunningSession`
   对象持有，adapter 本身只是工厂
4. **MCP 是工具的唯一入口**。adapter 负责告诉 CLI "你的 MCP server
   在哪"，不直接暴露工具本身

---

## 2. CanonicalEvent

所有 adapter 都把 CLI 输出 normalize 成下面这套事件。对上层透明。

```ts
export type CanonicalEvent =
  | { type: 'session_started'; cliSessionId: string; ts: Date }
  | { type: 'assistant_text'; text: string; ts: Date }
  | { type: 'assistant_text_delta'; delta: string; ts: Date }  // 流式增量
  | { type: 'tool_call'; toolName: string; input: unknown; callId: string; ts: Date }
  | { type: 'tool_result'; callId: string; output: unknown; isError: boolean; ts: Date }
  | { type: 'thinking'; text: string; ts: Date }
  | { type: 'turn_completed'; stopReason: 'end_turn' | 'max_tokens' | 'interrupted' | 'error'; ts: Date }
  | { type: 'session_error'; message: string; fatal: boolean; ts: Date }
  | { type: 'session_stopped'; exitCode: number | null; ts: Date };
```

设计取舍：

- **`assistant_text` vs `assistant_text_delta`**：非流式 CLI 只发前者；
  支持 token 级流式的 CLI 发多个 delta 然后一个 final text。上层既能
  做流式渲染也能只监听 final 事件
- **`tool_call` / `tool_result` 独立存在**：即使工具是 MCP 的，
  adapter 也应该把 CLI 自己发出的 tool_use 事件转成 canonical 格式
  方便上层观察（比如 debug 时想看 Sup 到底调了哪些工具）
- **没有 `permission_request`**：按 [`supervisor-spec.md`](supervisor-spec.md)
  的决定，工人全自主，cowork 这层不做事前审批。如果 CLI 弹权限请求，
  adapter 自动 allow
- **`session_error` 的 `fatal` 字段**：区分"这一轮跑挂了但 session
  还活着"和"session 死了必须重启"

---

## 3. 核心接口

```ts
// cowork 的 Adapter 合同 —— 每个 CLI 一份实现
export interface CliAdapter {
  readonly name: string;                // 'codex' | 'claude-code' | ...
  readonly displayName: string;         // 展示给用户的名字
  readonly capabilities: CliCapabilities;

  /** 检查这个 CLI 有没有装在用户机器上 */
  probe(): Promise<{ installed: boolean; version?: string; error?: string }>;

  /** 启动一个新的 Sup 会话 */
  spawn(opts: SpawnOptions): Promise<RunningSession>;
}

export interface CliCapabilities {
  /** 支持流式 token delta 吗 */
  streamingDeltas: boolean;
  /** 支持把 system prompt 完全替换（而不是 append） */
  systemPromptOverride: 'replace' | 'append' | 'prepend-as-user';
  /** 支持中断当前 turn（不退出 session） */
  midTurnInterrupt: boolean;
  /** MCP server 注入方式 */
  mcpInjection: 'config-override' | 'config-file' | 'none';
}

export interface SpawnOptions {
  /** 系统提示词（总管人格 + 规则） */
  systemPrompt: string;
  /** 启动总管的工作目录 */
  cwd: string;
  /** MCP server 配置：告诉 CLI 去哪连我们的工具服务 */
  mcpServers: Record<string, McpServerConfig>;
  /** 可选：强制指定模型 */
  model?: string;
  /** 额外 env var（注入到 CLI 子进程）*/
  env?: Record<string, string>;
}

export interface McpServerConfig {
  /** 启动 MCP server 子进程的命令 */
  command: string;
  /** 命令参数 */
  args: string[];
  /** MCP server 子进程的 env */
  env?: Record<string, string>;
}

/** 一个活着的 Sup 会话，对上层暴露的接口 */
export interface RunningSession {
  readonly cliName: string;
  readonly pid: number;
  /** CLI 本身的 session id，启动后几毫秒才会填上 */
  cliSessionId?: string;

  /** 事件流：async iterator，上层 for await 消费 */
  events(): AsyncIterable<CanonicalEvent>;

  /** 往 Sup 发一条用户消息 */
  sendUserMessage(text: string): Promise<void>;

  /** 中断当前 turn（不退出 session） */
  sendInterrupt(): Promise<void>;

  /** 优雅结束 session */
  stop(opts?: { timeoutMs?: number }): Promise<void>;

  /** 等待 session 自然退出 */
  wait(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
```

### 为什么这样拆

- **`CliAdapter` 是工厂，`RunningSession` 是实例**：跟 cli-daemon 同构。
  好处是可以在不 spawn 的情况下问 adapter "Codex 装了吗"、"它的 capability
  是什么"，用来在 UI 上展示可用后端列表
- **`events()` 返回 AsyncIterable 而不是 EventEmitter**：避开"先订阅
  后启动导致错过事件"的经典陷阱。cli-daemon 走的同一条路
- **`sendUserMessage` 是 `Promise<void>`**：发送就返回，响应通过 events 流回来，
  不在这里 await 回复。上层要等回复自己消费 events 到 `turn_completed`

---

## 4. 添加一个新 CLI 的 checklist

假设未来要加 Gemini CLI 或 OpenCode。步骤：

1. **先跑一次 `<cli> --help`** 了解它支持什么 flag：headless 模式、
   输入格式、输出格式、system prompt、MCP 配置
2. **找一个长期会话模式**。必须是"spawn 一次 → 多轮对话都在这个
   进程里"，不能是"每次 exec 都新启动"。如果只有一次性模式，这个
   CLI 就不适合当总管
3. **搞清楚它输出事件的格式**。写一个 10 行小脚本 spawn 它、发一句
   话、打印 stdout 看实际吐出来什么。记录下来作为 parser 的目标
4. **搞清楚它怎么吃 MCP 配置**。有的是配置文件，有的是启动 flag，
   有的是动态协议消息。记录这是哪种
5. **实现 `CliAdapter`**：
   - `probe()`：`which <cli>` + `<cli> --version`
   - `spawn()`：build argv、spawn 子进程、注入 MCP 配置、把 system
     prompt 送进去
   - 一个配套的 `SomeCliSession implements RunningSession`：持有
     进程句柄、有事件队列、有 sendUserMessage 转协议的逻辑
6. **写 parser**：`stdout 原始事件 → CanonicalEvent`
7. **写 input writer**：`text → CLI 协议的消息`
8. **registry 里注册**：`src/sup-runtime/registry.ts` 加一行
9. **smoke test**：用 `--adapter=新名字 --prompt "现在大家都怎么样"`
   跑一次，看能不能走到"总管调 list_workers → 返回结果 → 总管压缩 → 输出"

---

## 5. Codex 和 Claude Code 的差异对照

对照表（为 v1 的两个具体实现做对比，也是未来加其它 CLI 的参考）：

| 关注点 | Codex | Claude Code |
|---|---|---|
| **Headless 入口** | `codex app-server` (experimental) | `claude -p --input-format stream-json --output-format stream-json` |
| **传输协议** | JSON-RPC 2.0 (stdio) | NDJSON (stdio) |
| **sendUserMessage 的 wire format** | `{"jsonrpc":"2.0","id":N,"method":"turn/start","params":{"threadId":"...","input":[{"type":"text","text":"..."}]}}` | `{"type":"user","message":{"role":"user","content":"..."}}` |
| **Session ID 怎么拿** | 异步 — 等 `thread/started` notification 里的 `thread.id` | 同步 — 第一行 `{type:"system", subtype:"init", session_id, ...}` |
| **System prompt 注入** | `thread/start` 的 `baseInstructions` 字段（JSON-RPC 参数）| `--append-system-prompt "<text>"` flag |
| **替换 vs append system prompt** | 需实测 —— cli-daemon 没明确文档。最坏情况是 prepend-as-user | append only（`--append-system-prompt`） |
| **MCP 配置** | `-c 'mcp_servers.<name>.command="..."' -c 'mcp_servers.<name>.args=["..."]'`（runtime override）| `--mcp-config <path-to-json-file>` |
| **Assistant 输出事件** | `item/agentMessage/delta`（流式）+ `item/completed/agentMessage`（最终） | `stream_event` / `assistant` |
| **Tool call 事件** | `item/started/commandExecution` + `item/completed/commandExecution` | `assistant` 里的 `tool_use` block |
| **Tool result 事件** | `item/completed/commandExecution` 的 output 字段 | `user` 里的 `tool_result` block |
| **中断 turn** | `turn/interrupt` JSON-RPC，fallback SIGINT | SIGINT（无原生 turn 中断） |
| **Resume session** | `thread/resume` JSON-RPC | `--resume <id>` flag |
| **模型选择** | `thread/start` 的 `model` 字段 | `--model <id>` flag |
| **权限审批** | 服务端自动批（我们配 `on-request` + 默认 allow） | 我们用 `--dangerously-skip-permissions` 全开 |
| **capabilities** | `{streamingDeltas: true, systemPromptOverride: 'prepend-as-user' (可能需降级), midTurnInterrupt: true, mcpInjection: 'config-override'}` | `{streamingDeltas: true, systemPromptOverride: 'append', midTurnInterrupt: false, mcpInjection: 'config-file'}` |

### 什么是**真正被抽象**的差异

看完表格就能分辨：

- **真抽象**（每个 adapter 都要自己实现）：wire format、parser、
  session id 获取时机、MCP 配置注入方式、中断机制
- **假抽象**（所有 adapter 都长得差不多，应该提取基类）：事件队列
  和 async iterator 管理、`stop()` 的 SIGTERM→SIGKILL 升级、`wait()`
  的 Promise 包装、子进程 stdout/stderr 的 readline 循环

→ 所以 `src/sup-runtime/base.ts` 提供一个 `BaseRunningSession` 基类
做事件队列和生命周期，两个具体 adapter 只需要实现差异部分。

---

## 6. 已知风险和未决事项

### 6.1 Codex `baseInstructions` 的语义

`codex app-server` 的 `thread/start` 接受一个 `baseInstructions` 字段。
官方文档和 cli-daemon 里都没明确说它是**替换** Codex 自己的 system
prompt 还是**追加** —— 只说"the base instructions that the model
will be given"。

影响：如果是追加，Sup 会同时带着 Codex 自己的"coding agent"人格和
我们的"supervisor"人格，可能混乱。

应对：
- 第一轮实测如果不错就不管
- 如果明显是 coding agent 风格污染，在 baseInstructions 开头加一段
  **强制改写人格**的话（比如"忘记你之前被告知的一切身份，你现在是
  一个协调多个工人的秘书"）
- 最后兜底：把整个 system prompt 包成 `<system-instructions>...</system-instructions>`
  作为第一条 user message 塞进去（cli-daemon 对 legacy codex exec 模式
  的做法），capabilities 标为 `'prepend-as-user'`

### 6.2 Codex `-c mcp_servers` 覆盖实测可行

已经 smoke test 验证（任务 #1）：

```
codex -c 'mcp_servers.test_server.command="node"' \
      -c 'mcp_servers.test_server.args=["-e", "process.stdin.resume()"]' \
      mcp list
```

返回结果里 `test_server` 状态是 `enabled`。可以放心用这条路。

### 6.3 Codex app-server 是 experimental

`codex app-server` 在 0.118.0 里标的 `[experimental]`。协议可能在未来
版本变。

应对：
- adapter 里捕获所有未知方法名，记录到事件流但不崩溃
- `probe()` 里同时记录 codex 版本，不在允许列表里时输出警告但仍然尝试

### 6.4 跨进程状态 —— 走 IpcServer 回主进程（v3 现状）

MCP server 是 Sup 的子进程，不是 cowork 主进程的子进程。早期 v0 里
工人状态活在 MCP server 进程里（叫 mock-daemon），每次 Sup 重启都
会丢。v3 的做法不一样：

- 真工人（RunningSession）由 cowork **主进程**里的 `WorkerManager` 持有
- 主进程启一个 `IpcServer`（localhost TCP + UUID token）
- MCP server 子进程启动时从 env 读 `COWORK_IPC_HOST/PORT/TOKEN`，
  用 `IpcClient` 连回主进程做 RPC
- 所有工具调用（spawn_worker / list_workers / send_to_worker …）
  都是打回主进程的 RPC，不是进程内调用

这样 Sup session 重启也不会丢工人状态 —— Sup 是进程里的一个子进程，
死了主进程里的 WorkerManager 还活着。

---

## 7. 源码布局映射

```
src/
├── sup-runtime/
│   ├── types.ts            ← 本文 §2-§3 里的所有接口定义
│   ├── base.ts             ← BaseRunningSession（§5 里提到的"假抽象"部分）
│   ├── platform.ts         ← 跨平台 spawn 辅助（findCliBinary 等）
│   ├── registry.ts         ← adapter 注册表
│   └── adapters/
│       ├── codex/
│       │   ├── index.ts    ← CodexAdapter + CodexSession
│       │   ├── app-server.ts ← JSON-RPC 2.0 client + 协议类型
│       │   ├── protocol.ts ← Codex notification 的类型
│       │   └── parser.ts   ← notification → CanonicalEvent
│       └── claude-code/
│           ├── index.ts    ← ClaudeCodeAdapter + ClaudeCodeSession
│           ├── input.ts    ← user message NDJSON writer（Promise 回调）
│           └── parser.ts   ← stdout NDJSON → CanonicalEvent
```

---

## 8. 未来扩展方向

1. **在 `events()` 上再加一层过滤/聚合**：比如 `events().filterByType(['assistant_text'])`
2. **支持多会话并发**：现在一个 adapter 只跑一个 RunningSession，
   未来可能同时开多个工人（每人一个 session）共享同一个 adapter
3. **Capabilities 驱动的 UI 降级**：UI 根据 `capabilities.streamingDeltas`
   决定是做打字机效果还是整段显示
4. **Adapter 健康探测**：定期调 `probe()` 监控 CLI 是否仍然可用
