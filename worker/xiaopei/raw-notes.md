# AI 支付调研 - 原始笔记

> 从 WebSearch 返回的原始信息片段，按主题整理。用于事后核验。
> 调研时间：2026-04-23。

---

## 1. x402（Coinbase 主导的 HTTP 原生支付协议）

**关键事实**：
- 2025 年 5 月发布。核心思路：复活 HTTP 402 "Payment Required" 状态码，让 API 端直接要钱、客户端直接付钱，一行代码集成。
- 2025 年 9 月与 Cloudflare 共同成立 x402 Foundation。
- 上线 6 个月累计处理 > 1 亿笔支付；截至 12 月统计为 7500 万笔、2400 万美元。
- V2 版本已发布，基于 6 个月真实使用迭代。
- 生态：Coinbase、Circle、Alchemy、Visa TAP、Stripe ACP 都有集成。Stellar 也支持 x402。
- 用途：API 按次付费、AI agent 微支付（数据访问、算力、工具调用），客户端"发现工具→付钱→消费"可在 1 秒内完成。
- Coinbase 还推出了 x402 AI Agent App Store。

**价值观**：x402 在结构上解决的问题是传统卡/订阅/发票无法做的「亚秒、亚美分、程序化、无账户」的支付。

---

## 2. Agentic Commerce Protocol (ACP, OpenAI + Stripe)

**关键事实**：
- 2025 年 9 月由 OpenAI 与 Stripe 联合推出，首个生产级 agentic 商业规范。
- Apache 2.0 开源，OpenAI & Stripe 作为 Founding Maintainers，计划过渡到社区治理。
- 既可用 RESTful 实现，也可用 MCP 服务器实现。
- 自发布以来已发 4 个版本，新增：payment handlers、scoped tokens、扩展（含折扣）、内置 buyer auth、原生 MCP 传输。
- ChatGPT Instant Checkout 是首个应用场景（2025 年 9 月底上线），首批商户：Etsy（美国）+ 即将接入 100 万+ Shopify 商家。
- 品牌合作：URBN（Anthropologie、Free People、Urban Outfitters）、Etsy、Ashley Furniture、Coach、Kate Spade、Nectar、Revolve、Halara、Abt Electronics。
- PwC 与 Stripe 2025 年宣布合作加速企业落地。

---

## 3. Google Agent Payments Protocol (AP2)

**关键事实**：
- 2025 年 9 月 16 日发布。
- 可作为 Agent2Agent (A2A) 协议和 Model Context Protocol (MCP) 的扩展。
- 支付手段中立：信用卡、借记卡、稳定币、实时银行转账都支持。
- 核心解决的 3 个问题（3A）：
  - **Authorization** 用户确实给了 agent 特定权限
  - **Authenticity** 商户能确信 agent 请求反映用户真实意图
  - **Accountability** 欺诈或错误交易时责任归属
- 合作伙伴 60+：Adyen、American Express、Ant International、Coinbase、Etsy、Forter、Intuit、JCB、Mastercard、Mysten Labs、PayPal、Revolut、Salesforce、ServiceNow、UnionPay International、Worldpay 等。
- 与 Coinbase / Ethereum Foundation / MetaMask 合作推出 **A2A x402 extension** —— agent 加密支付的生产级方案。

---

## 4. Visa Intelligent Commerce & Trusted Agent Protocol (TAP)

**关键事实**：
- Intelligent Commerce 2025 年 4 月 30 日发布（与 Mastercard Agent Pay 4 月 29 日几乎同日）。
- 合作：OpenAI、Microsoft、Anthropic、Stripe、Samsung。
- 核心：AI-ready cards（代币化凭证，替代真实卡号）+ 用户可设消费限额和条件。
- **Trusted Agent Protocol (TAP)**：2025 年 10 月 14 日推出。
  - 与 Cloudflare 合作开发
  - 基于 HTTP Message Signatures 标准、商户改动最小
  - 三个核心数据元素：Agent Intent、Consumer Recognition、Payment Information
  - 早期商户集成：Nuvei、Adyen、Stripe
  - 开源在 Visa Developer Center 和 GitHub
- 2026 年被 Visa 定位为"主流采纳年"。

---

## 5. Mastercard Agent Pay

**关键事实**：
- 2025 年 4 月 29 日发布。
- 基于 Mastercard 现有基础设施（contactless、card-on-file、tokenization）。
- 专为对话式 AI 平台集成设计。
- 用代币化凭证降低欺诈；AI agent 必须先被验证才能发起支付。
- 也是 Google AP2 的合作伙伴。

---

## 6. Machine Payments Protocol (MPP) + Tempo L1

**关键事实**：
- Stripe + Paradigm 开发的稳定币专用 L1 链 **Tempo** 于 2026 年 3 月 18 日主网上线。
- **MPP**：Stripe + Tempo 联合发布的 agent-to-service 支付开放标准；Visa 为设计伙伴。
- **Shared Payment Tokens (SPTs)**：允许商户接受 agent 直接付的稳定币 / 卡 / BNPL。
- Stripe、Visa、Lightspark 已分别把 MPP 扩展到卡、钱包、比特币闪电网络。
- 创新：**sessions 原语**，agent 可预设消费上限后持续流式微支付，不需每次都上链。
- 费用：基础稳定币转账亚千分之一美元（< $0.001）。
- 合作伙伴：Anthropic、OpenAI、DoorDash、Mastercard、Nubank、Revolut、Shopify、Standard Chartered。
- Stripe 2024 年以 $1.1B 收购 Bridge，用于掌握稳定币底层管道。

---

## 7. PayPal Agent Toolkit

**关键事实**：
- 2025 年 4 月 2 日发布 MCP Server（业界首个远程 MCP server 支付方案）+ Agent Toolkit。
- 支持框架：Amazon Bedrock、CrewAI、LangChain、MCP、OpenAI Agents SDK、Vercel AI SDK。
- 语言：TypeScript 为主，Python 即将到来。
- 功能：支付、发票、争议、物流、目录、订阅、报告。
- 2025 年 10 月：与 OpenAI 合作接入 ChatGPT Instant Checkout。
- 2025 年 11 月：与 Perplexity 合作 Instant Buy，在 Black Friday 前上线。Perplexity 在聊天里用 PayPal passkey 一键结账，接入 5000+ 商户。

---

## 8. Amazon Rufus / Buy for Me

**关键事实**：
- Rufus 2024 年 2 月美国 preview。
- Buy for Me 2025 年 4 月宣布：能在亚马逊之外的网站上替用户完成购买（user 描述需求 → Rufus 去外部商户站完成结账）。
- 2025 年 11 月 18 日：推出 auto-buy，Prime 会员可让 Rufus 在目标价格到达时自动下单。
- 2025 年 Rufus 月活用户 2.5 亿；MAU +149%、交互量 +210% YoY。
- Rufus 对 Amazon 2025 年带来 $10B 销售增量。
- 2026 年 3 月扩展 Buy for Me 覆盖范围。
- **策略特点**：Amazon 走"围墙花园"路线，不向外部 agent 开放 Amazon 购物。

---

## 9. ChatGPT Instant Checkout + Walmart 案例

**关键事实**：
- 2025 年 9 月底：ChatGPT Instant Checkout 上线（美国），由 Stripe + ACP 支撑。
- 2025 年 10 月：PayPal 接入，Walmart 宣布合作。
- 2025 年 12 月：Instacart 成首个杂货合作伙伴，把端到端购物/结账嵌入 ChatGPT。
- 2026 年 3 月：**重要转向**。OpenAI 将 Instant Checkout 让位给商户自有 checkout 体验，原因是灵活性不足。Walmart 在 3 月中旬拉回控制权，将 Sparky 自有 chatbot 嵌入 ChatGPT 和 Gemini；转换率达到 Walmart.com 直接流量的 70%（仍低于自有渠道，但显著优于纯 Instant Checkout）。
- **教训**：平台级 "一张表 + 代付" 方案无法满足商户对库存、库动、个性化、精确匹配的要求；商户宁愿以 app 形式嵌入 AI 端，也不愿把交易控制权完全交出。

---

## 10. Catena Labs（Sean Neville，Circle 联合创始人）

**关键事实**：
- 2025 年 5 月 20 日出 stealth，融资 $18M。
- 投资人：a16z crypto 领投，Breyer Capital、Circle Ventures、Coinbase Ventures、CoinFund、Pillar VC、Stanford Engineering VF；天使包括 Tom Brady、Kevin Lin (Twitch)、Sam Palmisano (前 IBM CEO)。
- 目标：第一家**持牌的 AI 原生金融机构**，专服务 agent 经济。
- 开源 **Agent Commerce Kit (ACK)**。
- 提供计划：稳定币支付轨道（近实时结算、低费用）、agent 身份与信任、针对 AI 商业的能力。

---

## 11. Skyfire & Nekuda（创业公司）

**Skyfire**：
- 2024 年 8 月 TechCrunch 报道「让 AI 花你的钱」。
- 累计融资 $9.5M：Neuberger Berman、a16z CSX、Coinbase Ventures。
- 产品：KYAPay (Know Your Agent Pay)、Agent Checkout，允许 agent 独立注册、登录、付款。
- 定位：agent 侧身份 + 支付。

**Nekuda**：
- 种子轮 $5M，Madrona 领投；Amex Ventures、Visa Ventures 参投。
- 产品：agentic payments SDK，两大核心——Secure Agent Wallet + Agentic Mandates。
- 定位：商户侧 SDK，帮商户接 agent。

**Basis Theory / Nekuda / Skyfire**：合计累计融资接近 $50M，集中在身份 + 支付层。

---

## 12. Halliday（a16z crypto Series A）

**关键事实**：
- 2025 年 3 月 Series A $20M，a16z crypto 领投；累计 $26M。
- 产品：Agentic Workflow Protocol —— 用 AI agent 代替传统智能合约完成循环支付、跨链桥、跨网结账、资金管理。
- 商业模式：按计算量向客户收费。
- 已在生产：ApeChain、Avalanche Core Wallet、Shrapnel、DeFi Kingdoms、Metis 等。

---

## 13. 稳定币 / AI 支付 / 市场数据

**2025 数据**：
- 稳定币全球市值 $317B；2025 年链上交易量 $33T，超过 Visa + Mastercard 合计。
- USDC 流通 $75.7B，YoY +73%。
- Circle FY2025 营收 $2.7B。
- AI agent 9 个月支付 1.4 亿笔。
- **$33T 仅 $390B（~1%）是真实支付**，其余 99% 是 DeFi 交易 / 套利 / 抵押再循环 —— 需审慎看待"agent 经济"大数据。
- Visa 年化 $4.6B 稳定币结算；2026 年 3 月与 Circle 签全球伙伴协议。

**预测**：
- Morgan Stanley：AI 购物助理到 2030 年或驱动美国 $385B 电商销售。
- Galaxy：agentic commerce B2C 到 2030 年 $3-5T 收入。
- Juniper Research / Mordor / CognitiveMarket 有各自差异较大的预测（$5.2B 到 $1.7T 不等），口径差异大，取上限下限仅供参考。
- **关键拐点：2026-2027 被多家机构共同点名**。

---

## 14. 欺诈与合规

**核心痛点**：
- **责任归属真空**：卡组织、发卡行、消费者、AI 模型本身都不会承担 agent 欺诈的损失 → 压力全在商户端。
- 全球 dispute 案件量预计 2025-2028 增长 24%。
- 友好欺诈 (friendly fraud) 已占全部争议的 75%，agent 抽象层只会加剧此问题。
- Regulation E（CFPB 负责）需更新以纳入 agent 场景；2025 年 8 月 CFPB 对「个人金融数据权」征集意见。
- NIST 计划 2026 年 4 月主持 agent 标准公私对话。
- Visa TAP / Google AP2 / Stripe ACP / x402 都在用"意图签名 + mandate + 代币化"来形式化 agent 购买意图，目的就是为了界定"这次交易到底是谁的责任"。

---

## 15. GENIUS Act（稳定币立法）

**关键事实**：
- 参议院 2025 年 6 月 17 日通过（68-30）；众议院 7 月 17 日通过（308-122）；Trump 次日签署。
- 核心：payment stablecoin 须 1:1 美元或低风险资产背书，不再视为 security 或 commodity（SEC/CFTC 管辖豁免）。
- 对 AI 支付的直接影响：为 24/7 可编程、实时稳定币支付提供合规基础 —— agent 为数据 / 算力 / 内容 real-time 付款的监管障碍清除。
- 法案通过后全球加密资产一度冲破 $4T。

---

## 16. 身份与 Passkey / 授权

**核心设计**：
- **AI agent 不能直接用 passkey**：passkey/WebAuthn 依赖人的 gesture，是设计出来的安全机制。
- **解决方案**：人用 passkey 登录 → 通过 **OAuth 2.1** 委托 → 签发 scoped 且有时限的 token 给 agent。
- 可验证凭证 (Verifiable Credentials, W3C VC-JWT) 把 "人的 passkey 验证行为" 作为可密码学证明的原始证据，绑定到后续授权链的每一跳。
- 标准组织：W3C AI Agent Protocol Community Group、IETF。
- 公司动作：Grantex 做 "OAuth 2.0 for AI Agents" 这一点。

---

## 17. 场景清单（真实在跑）

**已落地**：
- **订阅与 API 计费**：x402（Coinbase 主推）、Nevermined（sub-cent 微支付）、Skyfire 在做；开发者、agent 之间按次付 API 已经在生产。
- **电商购买**：ChatGPT Instant Checkout、Walmart Sparky、Amazon Rufus Buy for Me、Perplexity Instant Buy、Instacart。
- **Agent-to-Agent**：MPP (Stripe/Tempo)、AP2 + x402 扩展、Nevermined 支持 A2A 协议。

**萌芽**：
- **订机票酒店 OTA**：大模型有工具调用能力，但传统 OTA 没开放 agent friendly API；需 TAP 类协议统一。
- **数据采购**：Gateway (Circle) 的 M2M 微支付、nevermined 在做。
- **AI 雇佣 AI**：MPP 的 session 原语专为这种连续调用设计。

**仍早期**：
- 跨境 B2B agent 付款（需 KYC/AML 成熟后放开）。
- 内容打赏 / 付费墙 agent 代付。
- 合规严格的金融产品（证券、保险）agent 代购。
