# AI 支付赛道调研报告

> 调研日期：2026-04-23
> 原始素材见同目录 `raw-notes.md` 与 `sources.md`

---

## TL;DR

- "AI 支付"不是单一赛道，而是 4 种形态并行：**Agent 代付电商（B2C agentic commerce）、Agent-to-Agent 支付（B2B/M2M）、AI 驱动的传统风控、AI 原生支付协议**。前两者是真正的新赛道。
- 2025 年发生了"协议大爆炸"：**x402（5 月）、Stripe/OpenAI ACP（9 月）、Google AP2（9 月）、Visa TAP（10 月）、Stripe+Tempo MPP（2026 年 3 月）**，外加 Mastercard Agent Pay、PayPal Agent Toolkit、Amazon Rufus Auto-Buy 等产品级落地。标准层的竞合格局正在快速形成。
- **监管松绑已经发生**：GENIUS Act 2025 年 7 月签署为法，稳定币被从 SEC/CFTC 管辖中豁免，为 agent real-time 微支付扫清一大障碍。
- **OpenAI/Walmart 在 2026 年 3 月的回撤**是最重要的反向信号：通用 agent 平台无法替代商户直接控制 checkout 体验，这会把交易权重从"AI 平台"重新推回"商户 + AI 工具化"。
- **时机判断**：
  - **B2B / 机器对机器（API 计费、算力、数据）**：已进入实际量产爆发期（x402 6 个月 1 亿笔），2026-2027 进入主流。
  - **B2C agentic commerce**：标准已就绪，但 UX、商户库动、责任归属、转换率仍不成熟，**真正大规模爆发在 2027 下半年 -2028**。
- **最有杠杆的切入点**：做**中间层的"agent 钱包 / 授权 mandate / KYA（Know Your Agent）"**，而不是做又一个大厂协议。

---

## 1. 概念厘清

### 1.1 本报告所指的"AI 支付"

**包含**：

1. **Agent 代付电商 (Agentic Commerce)**：AI agent 在用户授权下，代表用户完成一次现实购买（商品、服务、订阅）。例：ChatGPT Instant Checkout、Amazon Rufus Buy for Me、Perplexity Instant Buy。
2. **Agent-to-Agent / Machine-to-Machine 支付**：一个 agent 为调用另一个 agent / API / 工具 / 算力 而支付。通常是亚秒、亚美分级微支付，频率高。例：x402、MPP 的 sessions 原语、Nevermined。
3. **AI 原生新支付协议与新轨道**：为 agent 量身设计的支付基础设施，区别于人类卡支付的新语义原语（mandate、scoped token、session、agent identity）。例：x402、ACP、AP2、TAP、MPP、Skyfire KYAPay、Catena ACK。

**排除（不在本报告主要讨论范围）**：

- **AI 驱动的传统反欺诈/风控**（Forter、Riskified、Sift 等）—— 这是已有赛道用 AI 增强，不是新形态。
- **AI 辅助的预算/支出管理 SaaS**（Ramp、Brex 用 AI 做记账）—— 仍是人类主导交易。
- **CBDC / 数字美元**—— 国家层面的数字货币，与 agent 经济正交。
- **用 LLM 聊天界面替代银行 app** —— 只是 UI 改造。

### 1.2 四种形态的关系图

```
                Agent 代付电商 (B2C)
                       │
                       ▼
            ┌─────────────────────┐
            │  AI 原生支付协议     │  ← 新轨道（x402/ACP/AP2/TAP/MPP）
            └─────────────────────┘
                       ▲
                       │
              Agent-to-Agent (B2B/M2M)

    ┌────────────────────────────────────┐
    │  AI 风控（传统金融科技） ：支撑以上 3 层 │
    └────────────────────────────────────┘
```

---

## 2. 关键技术栈

### 2.1 身份与授权层：agent 怎么证明被用户授权？

**核心矛盾**：passkey/WebAuthn 依赖人的生物 gesture，**agent 无法直接使用**，这是设计使然的安全特性。

**当前的共识范式**：

| 环节 | 方案 |
|---|---|
| 用户身份 | Passkey / WebAuthn（人类端一次性验证） |
| agent 授权 | OAuth 2.1 scoped token（时限 + 权限范围） |
| 授权证据 | Verifiable Credentials（W3C VC-JWT），把"人已验证"编码为可签名传递的凭证 |
| 链式委托 | 每一跳带 scope-limited capability，加密绑定回最初 passkey 登录 |
| "mandate" | 用户预设消费规则（上限、商户、时间、条件）的结构化指令 |

**标准化状态**：
- W3C AI Agent Protocol Community Group、IETF 正在制定中；尚无单一权威标准。
- Visa TAP 使用 HTTP Message Signatures；AP2 定义 Intent/Cart/Payment Mandate 三层 mandate；ACP 走 scoped tokens；MPP 走 sessions 原语。
- Skyfire 的 **KYAPay (Know Your Agent Pay)** 是目前最明确的「agent 身份验证」尝试，概念类似 "KYC for agents"。

**工程结论**：在 2026 年，任何想让 agent 实际付款的系统都必须回答"用户授权证据是什么"，而 mandate + passkey + scoped token 的组合是当前事实标准。

### 2.2 协议层

| 协议 | 主推方 | 核心思想 | 状态 |
|---|---|---|---|
| **x402** | Coinbase + Cloudflare | 复活 HTTP 402，把稳定币支付嵌入 HTTP 语义；服务端 1 行、客户端 1 函数 | 生产；6 个月 1 亿笔；V2 已发布 |
| **ACP (Agentic Commerce Protocol)** | OpenAI + Stripe | 买家 agent ↔ 商家之间的结构化对话协议，支持 RESTful 或 MCP 传输；payment handlers + scoped tokens | 生产；Apache 2.0 开源；多版本迭代 |
| **AP2 (Agent Payments Protocol)** | Google | A2A/MCP 的扩展；payment-agnostic；明确 Authorization / Authenticity / Accountability 3A | 2025/9 发布；60+ 伙伴 |
| **A2A x402 extension** | Google + Coinbase + Ethereum Foundation + MetaMask | AP2 的加密支付扩展 | 生产 |
| **TAP (Trusted Agent Protocol)** | Visa + Cloudflare | 基于 HTTP Message Signatures；商户改动最小；Agent Intent / Consumer Recognition / Payment Info 三元组 | 2025/10 发布；Nuvei/Adyen/Stripe 早期接入 |
| **MPP (Machine Payments Protocol)** | Stripe + Tempo | Shared Payment Tokens + sessions 原语；agent 预设额度后流式微支付，不必每次上链 | 2026/3 发布；Tempo L1 主网上线 |
| **PayPal Agent Toolkit + MCP** | PayPal | 让 agent 调 PayPal 所有 API；首个远程 MCP 支付服务器 | 2025/4 发布 |
| **Visa Intelligent Commerce / Mastercard Agent Pay** | Visa / Mastercard | AI-ready cards + 代币化凭证 + 消费限额；agent 需先验证 | 2025/4 发布 |

**关键观察**：协议间**不是替代而是堆叠**关系——
- AP2 是**编排层**（agent-to-merchant 意图语义）
- ACP 是**会话层**（买方 agent 与卖方应用的对话）
- TAP 是**传输层**（让 HTTP 请求自带可验签的 agent 身份）
- x402 / MPP 是**结算层**（真正完成资金转移）
- 底下是卡网络 or 稳定币链

大厂已经悄悄形成"全都支持"的策略（Stripe/Visa/Coinbase 同时在多个协议表里出现），这意味着**协议战争不会决出独赢者，堆栈会分层共存**。

### 2.3 结算层

**三条并行轨道**：

1. **传统卡网络 + tokenized credentials**（Visa/Mastercard Agent Pay）：UX 好、商户容易接、成熟的争议体系，但不擅长亚美分微支付和非商品 agent-to-agent 场景。
2. **稳定币 L1/L2**：USDC (Ethereum/Base/Solana/Stellar)、Tempo L1（Stripe 专为稳定币优化）。优势：亚秒、亚美分、7×24、无国界；GENIUS Act 后监管明朗。
3. **Bitcoin Lightning、PIX、UPI 等实时支付轨道**：Lightspark 已把 MPP 扩展到闪电网络。

**Stripe 的双栈战略极具启示意义**：一边做 ACP + 卡网络（传统商业），一边自建 Tempo L1 + MPP（机器经济）。这表明 Stripe 判断两条轨道**长期并行**，不是谁替代谁。

**数据现实核查**：2025 年链上稳定币交易量 $33T 声称超过 Visa+Mastercard 合计，但其中**只有 $390B（~1%）是真实支付**，其余 99% 是 DeFi 交易、套利、抵押再循环。**不要被大数字迷惑**。

### 2.4 信任与争议处理

- **当前责任真空**：卡组织和发卡行**明确不承担 agent 欺诈损失**。
- **商户被动承担**：agent 理解错误 → 商户承担 chargeback + 退货。
- **预计 dispute 案件 2025-2028 增长 24%**；agent 抽象层会加剧 friendly fraud。
- **监管缺位**：CFPB 的 Regulation E 未更新；NIST 计划 2026/4 才开始 agent 标准的公私对话。
- **协议层的补救**：AP2 定义 Intent/Cart/Payment Mandate 三层签名，把"谁授权了、授权做什么、实际付了什么"形式化 —— 为后续责任划分提供证据链。
- **实操对策（商户）**：强化 agent 意图信号捕获、区分 agent/人类流量、要求商户出示 mandate。

---

## 3. 现有玩家盘点

### 3.1 大厂

**Stripe** — **最激进、最全栈**
- 做什么：ACP (与 OpenAI 合作)、MPP (与 Tempo 合作)、Agentic Commerce Suite、Tempo L1 (与 Paradigm)
- 阶段：生产，多协议已落地
- 亮点：同时押注卡网络 + 稳定币 + 自建 L1；收购 Bridge ($1.1B) 拿下稳定币底层
- 风险：同时打 4 条战线可能过度分散

**OpenAI** — **分发入口 + 协议共同作者**
- 做什么：ChatGPT Instant Checkout、ACP 共同维护
- 阶段：2025/9 上线，**2026/3 战略回撤**
- 亮点：ChatGPT 是最大 AI 消费入口
- 风险：Walmart 2026/3 拉回控制权表明 OpenAI 不能同时做 "AI 入口 + 交易运营商"

**Visa** — **基础设施守护者**
- 做什么：Intelligent Commerce、TAP、60+ 合作伙伴
- 阶段：生产；2026 定位为主流采纳年
- 亮点：网络效应 + tokenization 成熟度；与 Cloudflare 合作
- 风险：守方策略，创新速度受制于合规

**Mastercard** — **跟跑者**
- 做什么：Agent Pay
- 阶段：生产
- 亮点：与 Visa 对称，AP2 合作伙伴
- 风险：无明显差异化

**PayPal** — **老钱包 + MCP 首发**
- 做什么：Agent Toolkit、MCP Server、接入 ChatGPT & Perplexity
- 阶段：2025/4 起生产，已是多平台默认支付选项
- 亮点：Passkey 一键结账、Venmo 组合、在 B2C agentic commerce 首轮合作中占位
- 风险：平台化争夺中是被接入方而非主导方

**Amazon** — **围墙花园**
- 做什么：Rufus Auto Buy、Buy for Me
- 阶段：生产；2.5 亿用户
- 亮点：自有数据 + 闭环；不开放外部 agent 访问 Amazon
- 风险：拒绝 agent 协议化可能错过 M2M 经济

**Google** — **标准制定者 + Gemini 入口**
- 做什么：AP2 协议、Gemini + 商户集成（Walmart、Shopify）
- 阶段：协议 2025/9 发布，业务端跟进
- 亮点：最中立的协议身份，60+ 伙伴包括 PayPal/Adyen/Coinbase
- 风险：Google 历史上"发标准不运营"的模式可能再次发生

### 3.2 Crypto 侧

**Coinbase** — **x402 主推方**
- 做什么：x402、x402 Foundation、AI Agent App Store
- 阶段：生产，6 个月 1 亿笔
- 亮点：真正规模化的 agent 微支付基础设施
- 风险：与 Cloudflare 共治；监管变动

**Circle** — **稳定币发行方**
- 做什么：USDC、Gateway M2M 支付、ACK (Agent Commerce Kit via Catena)
- 阶段：生产；FY2025 营收 $2.7B，USDC 流通 $75.7B
- 亮点：Visa 2026/3 签全球伙伴协议
- 风险：Tether 仍占市占大头

**Catena Labs** — **AI 原生金融机构**
- 做什么：为 agent 服务的持牌金融机构 + 开源 ACK
- 阶段：2025/5 出 stealth，$18M 种子
- 亮点：Sean Neville（Circle 联合创始人）+ a16z crypto；野心做整套"AI 银行"
- 风险：持牌金融机构周期长、监管重

**Halliday** — **Agentic Workflow 替代智能合约**
- 做什么：用 AI agent 编排链上工作流（循环支付、跨链桥、结账）
- 阶段：生产（ApeChain、Avalanche Core 等）；$20M Series A
- 亮点：a16z crypto 领投；真实跑在生产
- 风险：概念上模糊（AI agent vs 智能合约的边界）

**Tempo** — **Stripe/Paradigm 的稳定币 L1**
- 做什么：针对 agent 经济优化的 L1 区块链
- 阶段：2026/3 主网
- 亮点：Stripe 深度绑定、MPP 设计伙伴
- 风险：新链与现有生态的竞争

### 3.3 创业公司

**Skyfire** — **Agent 侧身份 + 支付**
- 阶段：累计 $9.5M；a16z CSX、Coinbase Ventures
- 亮点：KYAPay 开放标准、Agent Checkout 可代替 agent 注册登录下单
- 风险：与大厂协议直接竞争

**Nekuda** — **商户侧 agent SDK**
- 阶段：种子 $5M；Madrona / Amex Ventures / Visa Ventures
- 亮点：Secure Agent Wallet + Agentic Mandates 双产品；被 Visa/Amex 战略投资背书
- 风险：商户接入意愿取决于 agent 流量

**Basis Theory** — **token 化基础设施**
- 亮点：与 Nekuda/Skyfire 三家合计近 $50M 聚焦身份 + 支付层

**Nevermined** — **AI agent 专用计费**
- 亮点：支持 A2A、MCP、x402；sub-cent 微支付可盈利
- 场景：agent 监视 / 编排 / 按调用计费

**Rye** — **全球 checkout 基础设施（agent friendly）**
- 亮点：面向 "让 AI 平台统一接商户" 的中立基础设施

### 3.4 玩家格局观察

1. **协议层已经饱和**：大厂各有自推协议，独立创业公司很难做一个新协议赢。
2. **身份 + 授权层仍稀缺**：这是 Nekuda/Skyfire 切入的明智点 —— "谁代表谁、做什么、多久有效、怎么撤销"是每个堆栈都回答不好的问题。
3. **商户执行层是被低估的瓶颈**：Agent 找到商品容易，完成结账难。Rye 判断"execution layer 少纯玩家"是有洞察的。
4. **风控/反欺诈层将被重塑**：agent 流量的风控与人类完全不同（频率、无 cookie、无 UA 指纹、但可签名），Riskified/Forter/Sift 面临架构更替。

---

## 4. 场景盘点

| 场景 | 代表玩家 | 成熟度 | 判断 |
|---|---|---|---|
| **API 按次计费** | x402、Nevermined、Skyfire | ⭐⭐⭐⭐⭐ 已爆发 | agent 要调用工具就必须付费，需求天然；6 个月 1 亿笔是明证 |
| **算力/模型调用** | x402、MPP sessions | ⭐⭐⭐⭐ 已起量 | MPP 的 sessions 原语专为连续调用设计 |
| **数据采购** | Circle Gateway、Nevermined | ⭐⭐⭐ 萌芽 | 数据市场仍需规范化 |
| **电商购买（泛消费品）** | ChatGPT/Stripe、Perplexity/PayPal、Amazon Rufus、Walmart Sparky | ⭐⭐⭐ 起步，但 2026/3 遇挫 | 协议已就绪，但 UX 和转换率仍差于商户自营 |
| **订阅管理** | PayPal Agent Toolkit、Halliday | ⭐⭐⭐ 起步 | 定期续费/取消由 agent 管是最自然的场景 |
| **订机票/酒店 (OTA)** | 尚无明显领跑者 | ⭐⭐ 早期 | 需要 OTA 开放 agent-friendly API；TAP/AP2 可解 |
| **内容打赏 / 付费墙代付** | x402（理论上） | ⭐⭐ 早期 | 适合稳定币微支付，但需用户心理门槛跨越 |
| **Agent 雇 Agent** | MPP、Nevermined、Skyfire | ⭐⭐ 早期 | 最有长期想象力，但 agent 市场还未形成网络效应 |
| **金融产品（证券/保险）代购** | - | ⭐ 禁区 | 监管极重，2027+ |
| **跨境 B2B 转账** | Circle、Tempo、Stellar | ⭐⭐ 早期 | 需 KYC/AML 成熟；GENIUS Act 后通道打开 |

---

## 5. 大爆发的前置条件（6 项 + 评分）

| # | 条件 | 当前完成度 | 说明 |
|---|---|---|---|
| 1 | **标准统一（至少分层收敛）** | 🟡 60% | 协议爆炸期已过，分层堆栈（AP2 编排 + ACP/TAP 传输 + x402/MPP 结算）逐渐清晰；但大厂仍在互相渗透 |
| 2 | **监管明朗** | 🟡 55% | GENIUS Act ✅；但 Regulation E / CFPB agent rules / EU AI Act 下的 agent 条款 / 各国实时支付监管仍未定型 |
| 3 | **身份与授权基础设施** | 🟡 40% | passkey + OAuth 2.1 + VC 范式共识已形成，但**缺"跨平台可携带的 agent 身份"**的事实标准；KYAPay/Skyfire 是方向 |
| 4 | **商户端改造完成（库存、价格、结账 API）** | 🔴 25% | 大部分商户系统没有 agent-ready checkout；Shopify/Stripe 抢跑但离覆盖全行业还远 |
| 5 | **UX 成熟（用户敢把钱交给 agent）** | 🔴 30% | Walmart 案例暴露转换率仍有 30% 断层；用户心理信任尚未建立 |
| 6 | **成本 < 卡网络摩擦成本** | 🟢 85% | 稳定币亚美分 + MPP sessions 已经达标，且链上费用持续降低 |
| 7 | **Agent 推理能力门槛** | 🟢 80% | 2025-2026 年模型能力已足以完成大部分"找 + 比 + 买"任务 |
| 8 | **责任归属规则** | 🔴 20% | 核心卡组织仍拒绝承担 agent 欺诈；Regulation E 未更新；这是最危险的未补短板 |

**结论**：**7/8 的条件**已达 50% 以上，**最关键的 2 个短板**是：
- 商户端改造（#4）
- 责任归属规则（#8）

这两者都不是技术问题，而是**产业协调 + 监管演进**问题，天然比协议开发慢。

---

## 6. 时机判断（分场景）

### 6.1 B2B / Machine-to-Machine（API、算力、数据、agent-to-agent）

**判断：2026 年已进入主流；2026-2027 是规模化爆发期。**

推理：
- x402 6 个月 1 亿笔已是实际证据；MPP 2026/3 上线后 Stripe 的分销会把它推到数万商户。
- 责任归属问题在 B2B 场景**不关键**（开发者/企业用户自担风险 + 清晰合同）。
- 稳定币 + GENIUS Act 在美国的合规性已明朗。
- 监管对 M2M 比对 B2C 友好得多（没有"欺负消费者"的担忧）。
- 成本已经比传统卡低 2-3 个数量级。

**唯一瓶颈**：agent-to-agent 经济本身规模。这取决于 LLM agent 在企业中的部署进度 —— 仍然在增长期。

### 6.2 B2C Agentic Commerce（AI 代用户买东西）

**判断：2026 仍是试错期；2027 下半年 -2028 真正大爆发。**

推理：
- **负面信号**：OpenAI 2026/3 撤回 Instant Checkout、Walmart 2026/3 拉回控制权。这暴露了通用 AI 入口无法取代商户自营 checkout。
- **UX 鸿沟**：Walmart 转换率只有直接流量的 70%，即产生 30% 流失。商户不会长期接受。
- **商户端改造速度慢**：大多数商户（尤其长尾）没有 agent-ready API/catalog/stock sync。
- **责任归属未定**：一旦 agent 大规模买错、退货、退款，商户承担风险 → 商户阻力大。
- **真正的 tipping point 会是**：
  1. 卡组织正式推出 "Agent-Verified Transaction" 责任转移规则（类似 3DS 2.0 责任转移），预计 2027 年；
  2. 主流商户 5000+ 完成 ACP/TAP 接入，预计 2027 年底；
  3. 一代用户完成"信任 AI 代付" 心理建设，预计 2027-2028。
- **反方论据**：如果某个大厂（OpenAI / Google / Amazon）推出"100% 赔付保证"把责任吸收了，爆发可能提前到 2026 年底。

### 6.3 Crypto / Stablecoin 结算层

**判断：2026 年技术和监管基础已就绪；企业采纳 2026-2027。**

推理：
- GENIUS Act 已签署 ✅
- Tempo L1 主网已上线 ✅
- Visa/Circle 全球合作、Stripe Bridge 收购、Coinbase x402 规模化都在同步发生
- 但"传统 B2B 客户用稳定币"仍需说服与集成周期 ~12-18 月

### 6.4 综合时间线图

```
          2025                2026                2027               2028
            │                  │                  │                 │
协议层       ╞══标准爆发期═════╡══堆栈收敛═════════╡                 │
B2B/M2M      │     ╞══量产起步═╡══规模化═════════════════════════════▶
             │                  │                                   │
B2C electron │     ╞═试错/回撤══╡═重启══════╡══主流爆发═════════════▶
             │                  │                 ▲
             │                  │                 │
监管         │═GENIUS═╡═Reg E?╡═CFPB?═╡═Liability 转移═┤
             │                                         │
身份基础设施 │════早期═════════════╡════KYA 标准═══════╡══成熟═══════▶
```

---

## 7. 风险与坑

| # | 风险 | 说明 | 缓解 |
|---|---|---|---|
| R1 | **责任归属真空** | 卡组织不赔、消费者不赔、模型不赔，商户独扛 → 商户抵制 | 等 Visa/MC 出 "Agent-Verified Transaction" 责任转移条款；签 AP2 三层 mandate |
| R2 | **AI 幻觉买错商品** | agent 把"蓝色大号毛衣"理解成别的；退货/退款成本高 | Agent 需"结账前强制人类确认"的 UX；商户端降级的 re-verify |
| R3 | **友好欺诈（Friendly Fraud）放大** | 用户声称"我没授权 agent 买"→ 无法证伪 | mandate 签名证据链 + passkey 登录日志 |
| R4 | **身份假冒 / agent 冒充** | 恶意 agent 伪装成用户 | TAP/KYAPay 的 agent 身份验证；但跨平台 agent 身份仍是碎片化 |
| R5 | **洗钱/合规** | 稳定币微支付 + agent 自动化 → AML 监控盲区 | GENIUS Act 要求发行方合规；但 M2M 频率过高，传统 AML 模型失效 |
| R6 | **隐私** | agent 要"看到"用户支付历史、偏好 → 数据最小化原则冲突 | scoped token 限权；但商户会想拿更多数据 |
| R7 | **大厂锁定** | 用户绑 OpenAI/Google/Amazon 的 agent → 切换成本高 | 支持可携带 agent 身份 & 数据导出；行业仍未有强制规则 |
| R8 | **监管突变** | EU AI Act、美国各州、中国央行随时可能收紧 agent 支付限制 | 多司法辖区部署；法务前置 |
| R9 | **协议战争 lock-in** | 早期押错协议（如 x402 vs MPP vs TAP）可能需要重写 | 走抽象层，或只押大厂明确拥抱的组合（AP2 + TAP + x402） |
| R10 | **微支付诈骗（低额高频）** | < $0.01 太小无法起诉，但规模化下吸血 | 速率限制 + 行为分析 |

---

## 8. 给用户的 Next Step 建议

### 8.1 判断入场姿势

**不建议**：
- ❌ 再做一个新的 AI 支付协议（市场已饱和，大厂把持）
- ❌ 直接做面向最终消费者的 agent（OpenAI/Amazon/Google 三家已经头对头竞争）
- ❌ 做稳定币发行（Circle/Tether 已成寡头 + 监管门槛极高）

### 8.2 建议的 3 个高杠杆切入点

#### **A) Agent 身份与授权中间件（KYA + Mandate 管理）**
- **为什么**：这是整个堆栈最缺事实标准的一层，Nekuda/Skyfire 在做但远未饱和。
- **做什么**：
  - 用户端 mandate 管理（"我授权 XX agent 在 YY 金额/YY 商户/YY 时限内支付"）
  - 跨平台可携带的 agent 身份（一个 agent 走遍所有协议）
  - 审计/撤销/合规接口
- **商业模式**：按验证调用收费 + 企业 SaaS
- **时间窗**：2026 下半年启动；抢在标准定型前

#### **B) 商户侧的"Agent-Ready 一键接入"**
- **为什么**：商户不想自己实现 AP2/ACP/TAP，又担心错过 agent 流量；Rye 在做但偏早期。
- **做什么**：
  - 一个 SDK / plugin 让 Shopify/WooCommerce/Magento 商户 5 分钟变 agent-ready
  - 自动处理 catalog 暴露 / 库存同步 / checkout token 换发 / 退货与 chargeback 数据
  - 接 Stripe ACP + Visa TAP + PayPal Toolkit 至少 3 条
- **商业模式**：转化后分成或 subscription
- **时间窗**：立刻；一旦商户接入 agent 规模化爆发必须先到

#### **C) B2B/M2M agent 计费 + 结算基础设施**
- **为什么**：这是已经爆发的赛道（x402 1 亿笔），但仍缺"企业级的计费/发票/审计/预算控制"层。
- **做什么**：
  - 企业统一控制"我司所有 agent 能花多少钱"的预算 / 审批 / 报表
  - 开发者一站式接入 x402/MPP/ACP 而不需懂底层
  - 成本归因（哪个部门 / 哪个 agent / 哪个客户花的）
- **商业模式**：企业 SaaS（类比 Ramp for agents）
- **时间窗**：2026 全年最佳；2027 可能被大厂 / Catena Labs 吞并

### 8.3 最关键的判断问题（用户自测）

1. **你有电商 / 商户生态资源吗？** → 切入 B
2. **你有加密/Web3 背景?** → 切入 C（直接在 x402/MPP 生态上做应用）
3. **你对身份、合规、安全有深度理解?** → 切入 A
4. **都没有，但是好的产品工程师?** → **最低风险是做 AI agent 企业预算 SaaS (C 的一部分)**，因为 B2B 订单周期虽长但不依赖消费者心智。

### 8.4 未来 6 个月值得追踪的 3 个信号

1. **Visa/Mastercard 是否推出"Agent-Verified Transaction 责任转移"规则** —— 会解锁 B2C 大爆发。
2. **Shopify / WooCommerce 是否把 ACP 或 TAP 作为默认开启** —— 会解锁长尾商户。
3. **OpenAI / Google / Amazon 其中一家是否推出"agent 100% 赔付保证"** —— 会打破商户抵制心理。

---

## 附录：主要时间线速查

| 日期 | 事件 |
|---|---|
| 2024/8 | Skyfire 被 TechCrunch 报道，"AI 花你的钱"成为关键词 |
| 2025/3 | Halliday a16z Series A $20M |
| 2025/4 | PayPal Agent Toolkit + MCP 首发；Amazon Buy for Me 宣布 |
| 2025/4/29 | Mastercard Agent Pay 发布 |
| 2025/4/30 | Visa Intelligent Commerce 发布 |
| 2025/5 | x402 发布；Catena Labs 出 stealth，$18M |
| 2025/6-7 | GENIUS Act 通过并签署 |
| 2025/9 | OpenAI Instant Checkout + Stripe ACP 发布；Google AP2 发布 |
| 2025/9 | x402 Foundation 成立（Coinbase + Cloudflare） |
| 2025/10 | Walmart 与 OpenAI 合作；Visa TAP 发布；PayPal 接入 ChatGPT |
| 2025/11 | Perplexity + PayPal Instant Buy；Amazon Rufus Auto-Buy |
| 2025/12 | Instacart 成首个杂货 partner 接入 ChatGPT |
| 2026/3 | Tempo L1 主网上线 + MPP 发布；OpenAI 战略回撤；Walmart 拉回控制权 |
| 2026/4 | NIST 计划主持 agent 标准公私对话（本报告撰写月） |

---

*报告结束。原始素材与来源链接见 `raw-notes.md` 与 `sources.md`。*

=== 报告完成: ai-payment-research.md ===
