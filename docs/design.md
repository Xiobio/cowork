# 方案

> **v3 更新（2026-04）**：这份文档最初写于 mock-daemon 阶段，很多地方
> 把工人描述成"v0 阶段是假的"。v3 已经把 mock 拆掉，工人是真的 CLI
> 子进程。具体改了什么看 **README.md § 代码结构** 和 `src/worker-manager/`
> 下面的源码。设计思想本身没变，"总管 + N 个工人 + MCP 桥"的三层架构
> 和下文描述一致，只是"第三层现在是真进程"。

## 核心想法一句话

> 把一个叫「总管」的 Claude 塞在你和所有工人之间。你只跟总管对话，
> 总管负责读所有工人、压缩汇报给你、把你的指令翻译并转达给对应的
> 工人。

## 为什么这个想法能工作

因为信息本身不是问题，**理解信息的脑力带宽**才是问题。而理解文本
这件事，Claude 本来就擅长 —— 它是读 Claude 输出的最合适人选。

一个具体的量化直觉：

- 5 个 worker 一天可能产生几万字的原始输出
- 其中 90% 是 `Read`/`Edit`/`Bash` 的常规工具调用、自言自语式的
  思考、进度更新 —— 你完全不需要看
- 剩下 10% 里，大约一半是"通报"（任务完成、某个方案确定了），
  另一半是"需要你参与"（开放式问题、方向判断、意料之外的情况）
- **你每天其实只需要读几百字、做几次决策**

总管的职责就是做这个 90% → 10% → 几百字的压缩。一个 Sonnet 级别
的 Claude 完全能干这件事。

## 角色分工

这个系统里有**四个角色**，每个角色有清晰的职责边界。前三个是
"有名有姓"的角色，第四个（工人）目前是 mock，未来会变真：

### 1. 你 —— 皇帝

**只做决策**。你不读原始事件流、不审批每一个工具调用、不维护"哪个
工人在干嘛"的心智地图。你只干一件事：**跟总管对话**。

- 告诉总管你要做什么
- 回答总管转达过来的问题
- 从总管的汇报里做判断

### 2. cowork 主进程 —— 调度员

**一层很薄的中介**。cowork 自己不做判断，也不当 LLM，它只负责：

- 启动总管（spawn 一个 CLI subprocess，如 `codex app-server` 或 `claude -p`）
- 把你在聊天框里打的话转发成 CLI 的输入协议（不同 CLI 格式不同）
- 把 CLI 的输出流 normalize 成一个统一的"canonical event"流打给 UI
- 拦截生命周期事件（启动/退出/中断/重连）

它是一个 Adapter 层 —— 同一个 cowork 可以挂不同的 CLI 当总管
（Codex / Claude Code / 未来的 Gemini / OpenCode…），每个 CLI 一个
adapter 翻译。

### 3. 总管 Sup —— 协调者（一个 CLI subprocess）

**读、压缩、路由、汇报**。总管的职责和原来一样，没变。变的是
**它的实现形态**：

- 原方案：总管 = 一个 `@anthropic-ai/sdk` agent，需要 API key
- 新方案：总管 = 一个**CLI subprocess**（`codex app-server` 或
  `claude -p --input-format stream-json`），**用你现成的 CLI 登录**，
  不需要额外的 API key；如果你是订阅登录，甚至能吃订阅配额

总管的行为规则（读什么 / 压缩多少 / 什么时候汇报 / 怎么路由指令）
完全由**系统提示词**驱动，详见 [`supervisor-spec.md`](supervisor-spec.md)。
同一份系统提示词可以跨 CLI 复用。

总管可以调的工具是一组固定的 12 个（`list_workers`、`peek_events`、
`send_to_worker` 等）。这些工具不是通过 SDK 在 cowork 进程里定义的，
而是**跑在一个独立的 MCP server 子进程**里 —— 见下一节的架构图。

### 4. 工人（Worker）—— 真正干活的 CLI 进程

**总管协调的对象**。每个工人是一个独立的 CLI subprocess（未来也是
`codex` / `claude` / 等），有自己的 cwd、task、事件流。总管通过
`send_to_worker` 工具往工人的 stdin 写消息，通过 `peek_events` /
`read_event` 读它的 stdout。

**v0 阶段工人全部是 mock**：cowork 里有一个 `mock-daemon` 模块，
硬编码了 4 个假工人（小A/B/C/D）和一堆预设事件。它只用来调试总管
的行为，不真的 spawn 任何子进程。

未来接入真工人时，把 mock-daemon 替换成
[Clawbond cli-daemon](https://github.com/Bauhinia-AI/Clawbond/tree/v2/dev/cli-daemon)
的客户端即可 —— 这是一个已经解决了进程管理/stdio pipe/事件广播/
多客户端鉴权的现成库。mock-daemon 的接口是按 cli-daemon 的 API 形状
抽象的，替换代价很低。

## 进程结构和数据流

整个系统在你机器上跑起来之后，是**三个进程 + 一个可抽换的底层**：

```
┌──────────────────────────────────────────────┐
│  你（皇帝）                                  │
│  在终端里用聊天框和 cowork 说话              │
└──────────────────────────────────────────────┘
                 ↕ 自然语言
┌──────────────────────────────────────────────┐
│  cowork 主进程 · Node                        │
│                                              │
│  • readline 聊天 CLI                         │
│  • Adapter 层（Codex / Claude Code / …）     │
│  • 把用户输入 → CLI 协议                     │
│  • 把 CLI 输出 → CanonicalEvent 流           │
└──────────────────────────────────────────────┘
                 ↕ stdio（JSON-RPC 或 NDJSON）
┌──────────────────────────────────────────────┐
│  总管 Sup = CLI subprocess                   │
│                                              │
│  v1 候选实现：                               │
│   • codex app-server（JSON-RPC 2.0）         │
│   • claude -p --input-format stream-json     │
│                                              │
│  Sup 通过 system prompt / baseInstructions   │
│  加载我们的"总管"人格和规则                  │
│                                              │
│  需要调工具时走 MCP 协议 ↓                   │
└──────────────────────────────────────────────┘
                 ↕ stdio（MCP 协议）
┌──────────────────────────────────────────────┐
│  cowork-mcp-server · Node subprocess         │
│                                              │
│  • 用 @modelcontextprotocol/sdk              │
│  • 注册 12 个工具                            │
│     list_workers / get_vitals / peek_events  │
│     / read_event / send_to_worker / …        │
│  • 工具实现调用 mock-daemon（在同一进程内）  │
└──────────────────────────────────────────────┘
                 ↕ 函数调用
┌──────────────────────────────────────────────┐
│  mock-daemon（v0）/ cli-daemon client（v1+） │
│                                              │
│  v0：内存硬编码的 4 个假工人                 │
│  v1+：替换成 cli-daemon WebSocket 客户端，   │
│       连到真正的工人进程                     │
└──────────────────────────────────────────────┘
```

**关键**：MCP server 不是 cowork 主进程的一部分，它是 Sup（CLI）
**自己 spawn 的子进程**，通过 MCP 协议通信。cowork 主进程只需要告诉
CLI "你的 MCP 服务器是 `node dist/mcp-server/index.js`"，剩下的
连接管理由 CLI 负责。

对 Codex：通过 `-c mcp_servers.cowork_tools.command="node"` 等配置
override 在启动时注入。
对 Claude Code：通过 `--mcp-config <path>` 指定 MCP 配置文件。

### 向下的流（你 → 工人）

1. 你在聊天里说"让小A 改用 vitest"
2. cowork 主进程把这句话通过 adapter 转成 CLI 协议（比如 Codex 的
   `turn/start` JSON-RPC 请求），写到 Sup 子进程的 stdin
3. Sup 理解语义，决定调 `send_to_worker("小A", "用户要求把 jest
   换成 vitest")` 这个工具
4. Sup 通过 MCP 协议把工具调用转给它的 MCP server 子进程
5. MCP server 的 `send_to_worker` handler 调用 mock-daemon 的
   `sendToWorker()`，往小A 的 events 数组里追加一条假消息
6. 工具结果回传给 Sup，Sup 生成一句简短确认给你："收到，已转达给小A"
7. cowork 主进程 parse Sup 的输出，提取文本展示给你

### 向上的流（工人 → 你）

工人在 v0 阶段是 mock 的，所以"向上的流"其实是：你提问 → Sup 主动
查 mock-daemon → Sup 压缩 → 展示。

举例：
1. 你问"小A 现在在干嘛？"
2. Sup 调 `get_worker_summary("小A")`（如果有缓存）和 `peek_events("小A")`
3. MCP server 返回事件元数据，Sup 扫 preview 判断哪些要读正文
4. Sup 对重要事件调 `read_event(id)` 拉全文
5. Sup 压缩成一段秘书风格的汇报："小A 正在重构中间件，刚完成 3 个测试"
6. 回传给你

## 主界面长什么样

主界面**就是一个聊天窗口**。你左边跟总管对话，右边一条极窄的
sidebar 显示"周边信息"，sidebar 上半部分是工人状态面板、下半
部分是原始事件流。

```
┌─ cowork ──────────────────────────────────────── 12:47 ────┐
│                                                            │
│ ┌─ 💬 跟总管对话 ──────────┐ ┌─ 工人状态 ─────────────┐  │
│ │                          │ │ 小A  🟢 空闲           │  │
│ │  🤖 早。小A 完成了中间件 │ │ 小B  🟡 在跑 Bash      │  │
│ │  重构，小B 在跑支付回调  │ │ 小C  🟢 空闲           │  │
│ │  预计还 2 分钟。         │ │ 小D  ⚫ 停了           │  │
│ │                          │ │                        │  │
│ │  小D 我已经停了（昨天那个│ │ 今日花费  $1.23        │  │
│ │  压测任务已完成）。      │ ├────────────────────────┤  │
│ │                          │ │ 事件流                 │  │
│ │  👤 小B 那个你再催一下   │ │ 12:34  A  💬 done      │  │
│ │                          │ │ 12:34  C  🔧 Bash      │  │
│ │  🤖 收到，告诉小B 加快   │ │ 12:34  D  ✅ done      │  │
│ │                          │ │ 12:33  A  🔧 Edit      │  │
│ └──────────────────────────┘ └────────────────────────┘  │
│                                                            │
│ ┌─ ✎ 发给总管 ───────────────────────────────────────────┐ │
│ │ > _                                                    │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

Sidebar 是你的**周边视觉安全阀** —— 你不主动看它，但它一直在那。
万一总管忘了汇报、或者被绕过了，你扫一眼工人状态和事件流能立刻
发现问题。这是防止"全靠总管"产生单点故障的保险。

更多界面细节和快捷键会在实现阶段的单独文档里定。当前阶段的决定
是：**聊天是主角，sidebar 是配角**。

## 底层技术栈

| 层 | 用什么 | 为什么 |
|---|---|---|
| 总管 Sup 的承载 | **CLI subprocess**：首选 `codex app-server`，次选 `claude -p --input-format stream-json`，未来 Gemini / OpenCode | 复用用户现成的 CLI 登录（包括订阅），免 API key。Codex 的 `app-server` 是 JSON-RPC 2.0 长期会话，Claude Code 的 `-p stream-json` 是双向 NDJSON 长期会话 —— 都是这些 CLI 官方支持的 headless 模式 |
| Adapter 层 | 自己写，参考 [Clawbond cli-daemon](https://github.com/Bauhinia-AI/Clawbond/tree/v2/dev/cli-daemon) 的 adapter 合同 | cli-daemon 已经为 Codex/Claude Code/Gemini 等写过 adapter，证明了这套抽象可行。我们不直接依赖它（它是个完整的 daemon 服务），而是抽取它的 adapter 接口思路自己写薄层 |
| 工具实现 | 独立 stdio MCP server 子进程 | 每个现代 CLI 都支持 MCP，工具只用写一份。MCP server 由 Sup (CLI) 自己 spawn，跟 cowork 主进程解耦 |
| MCP SDK | [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | 官方 TypeScript SDK，stdio / SSE / WebSocket 传输都支持，用 Zod 定义工具 schema |
| 工人状态存储 | v0 mock-daemon（内存）→ v1+ cli-daemon 客户端 | v0 用 mock 调试总管；未来切到 cli-daemon 让工人变真，只改 MCP server 里工具实现的一层即可 |
| 总管使用的模型 | 看 CLI 的设置 | Codex 默认模型由它自己的 config 决定；Claude Code 同理。也可以通过 adapter 层强制指定 |
| UI | v0 纯 readline 聊天 CLI | 先验证交互合不合理，TUI / Web 留 v1+ |

### 为什么不用 `@anthropic-ai/sdk` 或 `@anthropic-ai/claude-agent-sdk`

这是一条实际走过的弯路，值得记录下来免得未来重蹈：

1. **Anthropic SDK（`@anthropic-ai/sdk`）**：能用，但必须单独申请
   API key。对"用户已经有 Claude Code 订阅"这种情况不友好，等于让
   用户为同一个 Claude 模型付两次钱
2. **Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）**：以为它
   会继承 Claude Code 的登录，**实际不会**。官方明确写着不允许第三方
   开发者 piggyback on subscription，Agent SDK 强制要求 `ANTHROPIC_API_KEY`
3. **CLI subprocess**：`claude` 和 `codex` 的 CLI 本身用的是用户自己
   的登录（订阅或 API key），把它们作为子进程 spawn 就自动继承这份
   授权。代价是要自己写 adapter 处理 JSON-RPC / NDJSON 协议差异

选 CLI subprocess 方案后，项目里彻底**不依赖任何 Anthropic SDK 包**。

### 关于 UI 的决定

UI 不是第一优先级。原因是：**聊天这种交互形式极其可移植**。一旦
总管和 adapter 接好了，前端可以是：

1. **TUI**（Ink 或 textual）：最贴合 Claude Code 使用场景，迭代快
2. **本地 Web App**：浏览器打开 `localhost:8765`，富渲染、多设备
3. **Web + ttyd 包装 TUI**：同一套代码两种形态
4. **直接透传到 Slack / Telegram**：总管是个 bot，你在聊天工具里
   @它

**v0 阶段我们做纯 readline CLI**（比 TUI 更简化）。理由是迭代速度
最快 + 方便脚本测试。TUI 留 v1+。

## 和原始"用多终端"相比改变了什么

| 维度 | 多终端窗口 | cowork |
|---|---|---|
| 你同时维护的上下文数 | N 个 | 1 个（跟总管的对话） |
| 你读的字数 | 所有 worker 的原始输出 | 总管压缩后的摘要 |
| 重要的事如何被发现 | 你主动扫 | 总管主动顶上来 |
| 反向发指令 | 切窗口手打 | 自然语言说给总管 |
| 心流被打断的频次 | 高 | 低（只在总管判断值得打断时） |
| token 成本 | 1x | ~2x（总管也是 Claude） |
| 依赖 | 无 | 总管本身的判断质量 |

## 必须坦诚的代价

这个方案不是免费午餐，我们在 `problem.md` 里说过那几个现有方案
有缺陷，本方案也有它自己的：

1. **总管的判断可能错**。它可能漏报重要信息，也可能过度汇报噪音。
   早期你会不停去 sidebar 或者深潜检查它说的对不对，这段时间其实
   是在做双份工
2. **token 成本翻倍**。每个工人的输出总管都要读一遍（虽然是选择
   性读），相当于一个 worker 消耗两份 token
3. **信任曲线**。按经验估计 2-3 周后才会真正开始依赖总管的汇报。
   这期间你还是要频繁对照原始对话验证
4. **单点故障**。总管挂了整个系统瘫痪。相比之下多终端窗口是 N 个
   独立故障点，反而更健壮
5. **高敏感任务不适合全交**。涉及生产环境、钱、法律的事情，你
   永远应该亲自看原始对话，不能只信总管的摘要

## 下一步

设计和架构都已经敲定。当前工作：

- [x] 问题定义（`problem.md`）
- [x] 方案总体（本文档）
- [x] 总管行为规则（`supervisor-spec.md`）
- [x] Adapter 接口设计（`adapter-design.md`）
- [ ] MCP server 实现
- [ ] Codex adapter 实现 + 端到端跑通
- [ ] Sup 行为对照 spec 评估 + 系统提示词调优
- [ ] Claude Code adapter 实现 + 端到端跑通
- [ ] 优化打磨 + 最终测试

完成后（v1 终态）的典型启动流程：

```bash
cd cowork
npm install
npm run build
npm run dev                       # 默认用 codex
# 或
npm run dev -- --adapter=claude   # 用 claude code
```

再往后的演进（v2+）：

1. **接入真工人**：把 mock-daemon 替换成 cli-daemon 客户端，
   让工人也变成真的 CLI subprocess
2. **TUI**：聊天主界面 + 右侧工人状态 sidebar + 底部事件流
3. **主动汇报**：后台轮询真工人事件流，让总管在有重要事件时
   主动顶出通知而不是等你问
4. **持久化**：running summaries 和 notes 写 SQLite，跨进程重启保留
