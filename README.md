# cowork

让你在**一个地方**统筹多个 Claude Code / Codex 工人的工具。

你不再需要在 4-5 个终端窗口之间来回切换。你只跟一个叫「总管」的
助手对话，它替你读所有工人的输出、压缩成摘要向你汇报、把你的指令
翻译并转达给对应的工人。就像皇帝批奏折 —— 奏折由总管呈上、指示由
总管下达、你只需要保持一个对话的注意力。

总管本身就是一个 **CLI subprocess**（Codex 或 Claude Code），用你现有
的 CLI 登录（订阅或 API key），**不需要额外的 API key**。

## 文档导览

按顺序读：

1. **[docs/problem.md](docs/problem.md)** —— 我们要解决什么
2. **[docs/design.md](docs/design.md)** —— 我们打算怎么解决（含整体架构）
3. **[docs/adapter-design.md](docs/adapter-design.md)** —— Adapter 层设计，如何加新 CLI
4. **[docs/supervisor-spec.md](docs/supervisor-spec.md)** —— 总管的详细行为规则

## 当前状态

**v3 可用** —— mock 拆了，工人是真的：

- ✅ 总管跑在 Codex 或 Claude Code subprocess 里
- ✅ **工人也是真的 CLI subprocess**。`spawn_worker` 会真的 `fork codex app-server`
  或 `claude -p` 子进程，分配真的 pid / cliSessionId，吃真的订阅配额
- ✅ WorkerManager + IpcServer 架构：主进程持有真工人，MCP server
  子进程通过本地 TCP + token 打回主进程
- ✅ 12 个工具（list / spawn / send / kill / peek / read 等）都走真状态
- ✅ **TUI**：Ink 驱动，左侧对话 + 右上工人状态 + 右下事件流
  （sidebar 实时反映真工人进程的状态）
- ✅ Classic 模式（`--classic`）：纯 readline 聊天
- ✅ 单次模式（`--prompt`）：脚本化测试
- ✅ 两个 CLI adapter（Codex / Claude Code）都跑通了真工人

尚未：多会话持久化、主动汇报（Sup 主动顶事件而不是等你问）、
cli-daemon 级别的进程监控（比如 worker 挂了自动恢复）。

## 运行

### 先决条件

- Node.js 20+（推荐 22+）
- 下面至少一个 CLI 已安装并登录好：
  - **[Codex CLI](https://github.com/openai/codex)** 0.118+ —— 默认
  - **[Claude Code](https://docs.claude.com/claude-code)** 2.0+

**不需要** 单独申请 Anthropic / OpenAI API key —— 总管直接继承你 CLI
的登录（订阅或 API key 都行）。

### 第一次运行

```bash
# 1. 装依赖
npm install

# 2. 编译
npm run build

# 3. 探测可用 adapter
npm run probe

#   探测输出示例：
#     codex        OpenAI Codex CLI       ✓ 0.118.0
#     claude-code  Anthropic Claude Code  ✓ 2.1.109

# 4. 启动 —— 默认进 TUI
npm run dev

#   或用 claude code 当总管：
npm run dev -- --adapter=claude
```

TUI 里 `/help` 看建议的试玩问题，`/quit` 或 Ctrl+C 退出。

### TUI 布局

```
┌─ 🦅 cowork · Codex            2跑 1阻 · 就绪 · 18:04 ─┐
│                                                       │
│ ┌─ 💬 对话 ───────────┐ ┌─ 👷 工人状态 (4) ───┐      │
│ │ 👤 你 · 18:04         │ │ ● 小A   Edit  2.1kt │      │
│ │   现在大家都怎么样？  │ │ ● 小B   Bash  4.9kt │      │
│ │                      │ │ ◆ 小C         3.2kt │      │
│ │ 🤖 总管 · 18:04       │ │ ○ 小D         1.8kt │      │
│ │   ⚠ 需要你决定        │ └─────────────────────┘      │
│ │    小C 卡住了…        │                              │
│ │                      │ ┌─ 📜 事件流 ─────────┐      │
│ │   ℹ 通报             │ │ 18:04 → 现在大家都 │      │
│ │    小A 重构完成…      │ │ 18:04 🔧 list_wor… │      │
│ │                      │ │ 18:04 🔧 peek_eve… │      │
│ │                      │ │ 18:04 ← 就绪        │      │
│ │                      │ └─────────────────────┘      │
│ └──────────────────────┘                              │
│                                                       │
│ ┌─ ✎ 跟总管说点什么… ──────────────────────────────┐  │
│ └──────────────────────────────────────────────────┘  │
│  Enter 发送 · Ctrl+C 退出 · /quit · /help · /clear   │
└───────────────────────────────────────────────────────┘
```

左侧是你和总管的对话（流动滚屏）。右侧上半是当前工人列表（状态点 +
名字 + 当前动作 + token 累计），右下是事件流（总管每次调用的工具、
发送的消息、错误）。底下是输入框。

### Classic 模式（纯 readline）

方便调试、粘贴长文、或者脚本化测试：

```bash
npm run dev -- --classic
```

### 单次模式（脚本化）

```bash
# 一次性问一句话
node dist/index.js --prompt "现在大家都怎么样？"

# 用 claude code 跑同样的问题
node dist/index.js --adapter=claude --prompt "小C 为什么卡住了？"

# verbose 显示每个工具调用
node dist/index.js --prompt "..." --verbose
```

### TUI 快照（调试用）

```bash
# 渲染 TUI 的初始帧到 stdout，不开交互。
# 用来验证布局、颜色、尺寸，或者 CI 里跑截图比对。
node dist/index.js --tui-snapshot
```

### 调试

需要看 CLI 子进程的 stderr（诊断用）：

```bash
COWORK_DEBUG=1 npm run dev
```

## 建议的试玩顺序

1. **"现在大家都怎么样？"** —— 看总管怎么同时读 4 个工人的状态并压缩
2. **"小A 在干嘛？"** —— 看它用 peek_events + read_event 深入一个工人
3. **"小C 为什么卡住了？"** —— 看它处理 blocked 事件
4. **"让小A 顺便更新文档"** —— 看它把指令路由给具体工人（1 个 tool call）
5. **"帮我招一个新工人叫小E，放在 D:/proj/bench，跑性能压测"** —— 看 spawn_worker

同一个问题在两个 adapter 下跑会得到类似但不完全一样的答案，可以用来
对比两个 LLM 的理解方式。

## 代码结构

```
src/
├── worker-manager/            真工人管理（v3 新）
│   ├── types.ts                 WorkerInfo / StoredEvent / IWorkerManager
│   ├── manager.ts               WorkerManager：持有 Map<name, RunningSession>
│   ├── ipc-server.ts            本地 TCP JSON 协议服务端（主进程）
│   └── ipc-client.ts            TCP 客户端（MCP server 子进程用）
│
├── mcp-server/                总管工具的 MCP server 子进程
│   └── index.ts                 注册 12 个工具 → 走 IPC 打回主进程
│
├── sup-runtime/               adapter 层（cowork ↔ CLI subprocess）
│   ├── types.ts                 CanonicalEvent / Adapter 接口
│   ├── base.ts                  BaseRunningSession 基类
│   ├── platform.ts              跨平台 spawn 辅助（findCliBinary 等）
│   ├── registry.ts              按名字拿 adapter
│   └── adapters/
│       ├── codex/               Codex app-server JSON-RPC 客户端
│       │   ├── protocol.ts
│       │   ├── app-server.ts
│       │   ├── parser.ts
│       │   └── index.ts
│       └── claude-code/         Claude Code NDJSON stream-json 客户端
│           ├── input.ts
│           ├── parser.ts
│           └── index.ts
│
├── tui/                       Ink / React TUI 界面
│   ├── index.ts                 TUI 入口（spawn supervisor + render）
│   ├── App.tsx                  主组件（持 WorkerManager 引用 + subscribe）
│   ├── state.ts                 reducer + actions + initialState
│   ├── types.ts                 WorkerView 等 UI 层类型
│   └── components/
│       ├── StatusBar.tsx        顶部状态条
│       ├── Clock.tsx            独立时钟（避免每秒整屏 re-render）
│       ├── ChatPane.tsx         对话主区
│       ├── WorkersPane.tsx      右上：工人列表
│       ├── EventFeedPane.tsx    右下：事件流
│       ├── InputBox.tsx         底部输入
│       └── HelpBar.tsx          最底快捷键
│
├── supervisor.ts              总管大脑：系统提示词 + chat 循环
└── index.ts                   CLI 入口（TUI 默认 / classic / prompt / probe）
```

### 数据流

```
            用户在 TUI 打字
                ↓
┌──────────────────────────────────────┐
│  cowork 主进程 (Node)                │
│                                      │
│  ┌── TUI (React/Ink)                 │
│  │   直接持 WorkerManager 引用       │
│  │   订阅 manager.subscribe()        │
│  │                                   │
│  ├── WorkerManager                   │
│  │   Map<name, RunningSession>       │
│  │   真 CLI 子进程的真状态           │
│  │                                   │
│  ├── IpcServer (localhost TCP + UUID token)
│  │                                   │
│  └── Supervisor session (via adapter)│
│      │                               │
└──────┼───────────────────────────────┘
       │ stdio
       ▼
   codex app-server / claude -p  ←──  总管 CLI 子进程
       │
       ├── stdio
       ▼
   MCP server (Node 孙进程)      ←──  工具接入层
       │
       │ TCP to localhost:<ipc_port>
       ▼
   cowork 主进程的 IpcServer     ←──  回到主进程
       │
       ▼
   WorkerManager 处理工具调用
       │
       ├── spawn_worker → 用同一个 adapter spawn 一个新 CLI 子进程
       ├── send_to_worker → 往 RunningSession stdin 写消息
       └── kill_worker → SIGINT → SIGKILL
```

### 改总管行为

改 `docs/supervisor-spec.md` 里的规则，然后把变更同步到
`src/supervisor.ts` 的 `SUPERVISOR_SYSTEM_PROMPT` 常量。两份东西
必须保持一致：spec 是设计谈判的靶子，system prompt 是它的编码版本。
改完重新 `npm run build`。

### 加一个新 CLI adapter（Gemini、OpenCode、…）

读 [docs/adapter-design.md](docs/adapter-design.md) §4 的 checklist。
核心步骤：

1. 在 `src/sup-runtime/adapters/<name>/` 下写 parser + adapter
2. 在 `src/sup-runtime/registry.ts` 里注册
3. 跑 `node dist/index.js --adapter=<name> --prompt "测试问题"`

## 名词表

| 词 | 意思 |
|---|---|
| **用户** | 坐在键盘前的那个人，就是你 |
| **总管**（Sup） | 协调所有工人的角色，由一个 CLI subprocess 承载 |
| **Adapter** | cowork 主进程和具体 CLI 之间的翻译层，每个 CLI 一份实现 |
| **工人**（worker） | 被总管管理的 CLI 进程（v0 是 mock） |
| **招工**（spawn） | 开一个新工人 |
| **MCP server** | 暴露总管工具的独立 stdio 子进程（`@modelcontextprotocol/sdk` 实现）|
| **mock-daemon** | v0 用的内存假工人池，未来会被 cli-daemon 客户端替换 |
