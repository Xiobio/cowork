# Agent 对战游戏 赛道调研报告

> 调研时间：2026-04-23
> 目的：盘点「让 AI agent 互相对战」这个方向已有哪些玩家、形态、机会、坑

---

## 1. 赛道定义

「Agent 对战游戏」是个边界模糊的复合概念。为了聚焦，本报告按两条轴切分：

**轴 A — 参赛者类型**
- **LLM 对 LLM**：用自然语言 / 工具调用驱动的语言模型互斗（社交博弈、策略游戏、狼人杀等）
- **RL bot 对 RL bot**：经典强化学习自博弈（AlphaStar / OpenAI Five 路线）
- **人 vs Agent / 混合**：人类玩家可下场和 agent 同台

**轴 B — 场景目的**
- **Benchmark 型**（严肃评测）：Chatbot Arena、Kaggle Game Arena、Melting Pot
- **观赏/娱乐型**（直播打发时间）：Claude/Gemini Plays Pokémon、AI Village、LLM Colosseum
- **沙盒社会模拟型**：Smallville、AI Town、WarAgent
- **玩家可参与型**：AI Dungeon / Voyage、Mafia 混合对局、Risk/Diplomacy 可加入的人机混战
- **资产 / 经济型**：Virtuals Protocol（agent 代币化+互斗）、animalhouse.ai

**本报告范围**：以 LLM-based agent 为主，RL 线只做对比背景；同时纳入 benchmark、娱乐、沙盒、可参与四类，排除「单 agent 打单机游戏（无对抗）」和纯 NPC AI（不属于 agent vs agent）。

---

## 2. 现有玩家盘点（分类汇总）

### 2.1 Benchmark / 评测型 Arena

| 名字 | 做什么 | 形态 | 活跃度 | 亮点 | 短板 |
|---|---|---|---|---|---|
| **Chatbot Arena / LMArena** | 匿名 LLM 两两 PK，人类投票打 Elo | Web 众包评测平台 | 极活跃，~100 万 MAU，2026-01 估值 17 亿美元 | 数据量最大，行业公认；已商业化推出 AI Evaluations 付费服务 | 不是「agent 对 agent」，是「人评两模型单回合输出」|
| **Kaggle Game Arena**（Google DeepMind） | LLM 在 Chess / Poker / Werewolf 全循环对打 | 官方 benchmark 平台，2025-08 启动，2026-02 加入 Poker+Werewolf | 很活跃，Gemini 3 目前通吃三榜 | 真正的 agent vs agent；all-play-all 统计稳 | 模型接入受限（需 DeepMind 拉名单）|
| **ARC-AGI-3** | 构建 agent 去玩新颖 ARC 游戏 | Kaggle 竞赛 | 进行中 | 衡量泛化推理，不是预训过的游戏 | 更偏科研向，观赏性一般 |
| **AgentX / AgentBeats**（UC Berkeley RDI） | 先设计 benchmark 再造 agent 刷榜 | 大学竞赛 | 2025 赛季 | 双阶段设计有意思 | 圈子内部 |
| **Melting Pot**（DeepMind） | 85+ 多智能体 RL 场景，测合作/竞争/欺骗 | 开源 Python 套件 | 稳定维护，有年度 AIcrowd 竞赛 | 社会困境覆盖全面，学术标准 | 纯 RL，非 LLM；2D 网格世界观赏性差 |
| **PokerBench / Husky Hold'em Bench** | LLM 打 No-Limit Texas Hold'em | 学术 benchmark（AAAI 2025 / NeurIPS 2025） | 活跃 | 场景标准化 | 限于学术 |
| **Werewolf Arena** | LLM 狼人杀社会推理评测 | 论文 + 代码（arXiv 2407.13943） | 已并入 Kaggle Game Arena | 早期 Werewolf 标杆 | - |

### 2.2 观赏 / 直播型（Reality TV for AIs）

| 名字 | 做什么 | 形态 | 活跃度 | 亮点 | 短板 |
|---|---|---|---|---|---|
| **Claude Plays Pokémon** | Claude 实时直播打 Pokémon Red | Twitch 直播，2025-02 启动 | 很活跃，有爆款破圈 | Anthropic 官方背书，观众互动强 | 是「单 agent vs 游戏」，不是互斗 |
| **Gemini Plays Pokémon** | Gemini 版本 | Twitch | 与 Claude 版形成竞争 | 模型对比叙事 | 同上 |
| **AI Village**（The AI Digest） | 多家前沿模型（OpenAI/Anthropic/Google/xAI）同桌，真有电脑+网+群聊，做真实目标 | 长期直播实验，2025-04 至今 | 持续运行超一年 | 给真实任务（筹款、卖货、办线下活动），agent 之间真合作/摩擦；已筹到 $2K 慈善款、卖出 $200 周边 | 偏研究实验，不是游戏化产品 |
| **LLM Battler** | 多 LLM 打 Risk / Chess / Diplomacy，支持自然语言谈判 | 独立 Web 平台 | 新项目但更新活跃（2026-03 还在发博客） | 真·游戏化 agent vs agent；Risk 里会有结盟/背叛 | 量级小 |
| **LLM Colosseum** | LLM 操控 Street Fighter III 实时对打 | 开源项目 + hackathon | 爆款 hackathon 项目 | 魔性观赏性，小模型反而赢（延迟优势） | 一次性 meme，没持续运营 |
| **Outsmart**（ed-donner） | LLM 玩阴谋/谈判游戏 | GitHub 开源 | 社区项目 | 定位清晰（deviousness） | 规模小 |

### 2.3 社会模拟 / 沙盒型

| 名字 | 做什么 | 形态 | 活跃度 | 亮点 | 短板 |
|---|---|---|---|---|---|
| **Generative Agents / Smallville**（Stanford + Google） | 25 个 agent 在小镇生活，有记忆/反思/规划 | 研究 + 开源（UIST 2023） | 经典，fork 极多 | 定义了 agent 社会模拟的架构 | 非对战，偏生活模拟 |
| **AI Town**（a16z-infra） | Smallville 的 MIT 许可工业化版 | 开源 starter kit（Convex 后端） | 活跃 | 可一键部署自己版本 | 同上，无胜负机制 |
| **AgentVerse**（OpenBMB） | 通用多 agent 部署框架，含 task-solving + simulation 两种 | 开源库 | 中等活跃 | 既能做评测也能做模拟 | 框架向，产品化弱 |
| **WarAgent**（agiresearch） | LLM 多 agent 模拟世界大战 | 研究项目 | 论文向 | 宏观政治博弈有趣 | 学术 demo |
| **BBC "1000 AIs built their own village"** | 大规模 agent 涌现社会 | 媒体报道的实验 | 已发生 | 规模效应叙事 | 一次性 |

### 2.4 玩家可下场型（人机混战 / UGC）

| 名字 | 做什么 | 形态 | 活跃度 | 亮点 | 短板 |
|---|---|---|---|---|---|
| **AI Dungeon**（Latitude） | AI 做 DM 的无限文字冒险 | 消费 App，web+mobile | 老牌，仍活跃 | 用户基础大，UGC 生态成熟 | 严格来说是「人玩 AI 世界」，非 agent 互斗 |
| **Voyage**（Latitude 新品，2026-04） | 造自己的 AI RPG，NPC 是 agent | 平台型 | 刚发 | 把「多 agent 互动」做进消费 RPG | 刚起步 |
| **Mafia with asynchronous LLM agents**（EMNLP 2025） | LLM agent 和真人一起玩 Mafia，要决定「何时说话」 | 研究原型 | 2025 年 | 异步说话是新颖问题 | 未产品化 |
| **Virtuals Protocol** | Agent 代币化，可互相交易/对战，链上 | Crypto infra | 活跃（投机性强） | 给 agent 加资产层，有经济对抗 | 强 crypto 味，合规/真实价值存疑 |
| **animalhouse.ai** | Agent 专用的 Tamagotchi，有养成和互动 | REST API 平台 | 新兴 | 为 agent 设计而非为人 | 玩法轻，战斗弱 |

### 2.5 RL 自博弈（历史背景）

| 名字 | 做什么 | 形态 |
|---|---|---|
| **AlphaStar**（DeepMind 2019） | 星际 2 三族大师段位；league 训练法 | 研究项目 |
| **OpenAI Five**（2019） | Dota2 击败 TI 冠军 OG；42k 场公开赛 99.4% 胜率 | 研究项目 |
| **Cicero**（Meta AI 2022） | Diplomacy 首次达到人类水平，自然语言+策略推理结合；webDiplomacy.net 前 10% | 研究项目，已开源 |
| **GT Sophy**（Sony AI） | Gran Turismo 赛车超越顶尖真人 | 研究 |
| **SIMA 2**（DeepMind 2025） | Gemini 驱动的 3D 虚拟世界通用 agent | 研究/产品预告 |

**关键对比**：RL 线追求「超越人类」，打的是单一专精游戏；LLM 线追求「通用+可解释+可谈判」，牺牲段位换泛化。两条线的产品形态差异很大。

### 2.6 相关学术综述

- **awesome-LLM-game-agent-papers**（git-disl）：LLM 游戏 agent 论文总表
- **GPA-LM**（BAAI）：Game playing + large multimodality model 综述
- **arXiv 2404.02039**：LLM-Based Game Agents 综述

---

## 3. 形态分类（一张图概括）

```
                ┌──────────────────────┬─────────────────────┐
                │    严肃（评测）       │    娱乐（观赏）      │
┌───────────────┼──────────────────────┼─────────────────────┤
│ 对抗          │  Kaggle Game Arena   │  LLM Colosseum       │
│ (zero-sum)    │  PokerBench          │  LLM Battler (Risk)  │
│               │  Werewolf Arena      │  Claude vs Gemini 棋 │
├───────────────┼──────────────────────┼─────────────────────┤
│ 混合动机       │  Melting Pot         │  AI Village          │
│ (cooperation  │  Diplomacy/Cicero    │  Mafia w/ humans     │
│  +competition)│                      │                     │
├───────────────┼──────────────────────┼─────────────────────┤
│ 纯合作/社会    │  Generative Agents   │  AI Town             │
│ 模拟          │  WarAgent            │  AI Dungeon/Voyage   │
└───────────────┴──────────────────────┴─────────────────────┘
```

代表作各拉一个：
- **对抗+严肃**：Kaggle Game Arena（Chess / Poker / Werewolf）— 行业金标
- **对抗+娱乐**：LLM Battler — 直接对标「AI 版棋牌综艺」
- **混动+严肃**：Melting Pot — 学术标准
- **混动+娱乐**：AI Village — reality TV for AIs，已做出真实社会影响
- **社会模拟+严肃**：Generative Agents — 学术祖师
- **社会模拟+娱乐**：AI Dungeon / Voyage — 消费市场体量最大

---

## 4. 技术与成本要点

### 4.1 关键技术挑战
- **多 agent 协调**：异步说话时机（EMNLP 2025 Mafia 论文的核心问题）、turn-taking、广播 vs 私聊
- **长上下文与记忆**：社会推理要记住「谁上轮说过什么/骗过谁」。Smallville 的 memory stream + reflection 仍是范式
- **可观测性**：观众想看 agent 的「心理活动」。Claude Plays Pokémon 直播侧边栏暴露了 thinking 轨迹，这是爆款关键之一
- **防作弊 / 公平性**：同一模型不同温度/prompt/工具会造成巨大差距；Kaggle Game Arena 用 all-play-all + 多回合平滑
- **胜负判定**：社会博弈（Werewolf、Diplomacy）没有客观 reward 信号，需要仲裁机制
- **避免「摆烂」与退赛**：Claude 2.1 曾拒绝打 Street Fighter；模型的安全训练会影响对抗性任务

### 4.2 成本估算（粗算）
- 一局 8 人狼人杀，50 轮对话、平均 2k tokens/回合 ≈ 8×50×2k = 800k tokens。用 Opus/Gemini Pro 约 $5-15/局
- AI Village 级别的 24/7 多 agent 实时运作，月烧 $10k-50k 级别是常见水位
- 直播型一旦出圈观看量大，token 成本相对于用户获取成本可能反而便宜——这是娱乐向业务的核心杠杆

### 4.3 工程基础设施
- **多 agent 框架**：AgentVerse、AutoGen、LangGraph、CrewAI 已成标配
- **游戏接入层**：PyBoy（GameBoy）、ChatArena、minedojo（Minecraft）、OpenSpiel
- **直播/可视化**：Twitch + OBS + 自建 agent state UI；AI Village 用自研看板
- **仲裁/对局管理**：Kaggle 走「集中服务器调度 + Bradley-Terry/Elo」

---

## 5. 商业化与用户场景

### 5.1 已验证的买单方
- **模型厂商**：做 benchmark、做品牌宣传（Claude Plays Pokémon 是 Anthropic 品牌投放典范）
- **评测公司**：LMArena 4 个月做到 $30M ARR、17 亿估值，证明「给企业做模型选型服务」是真金白银市场
- **研究机构 / 政府**：AI safety、多智能体合作研究经费
- **娱乐观众**：Twitch 打赏 + 订阅；目前还没跑通纯订阅模型，靠流量导流到模型厂商 API 更多

### 5.2 潜力场景
- **训练数据生产**：高质量多 agent 对局 = 便宜的社交/谈判/推理语料（对 RLHF/DPO 有价值）
- **招聘 / 人才评估**：给候选人设计「和一组 agent 玩 Diplomacy」的能力测验
- **教育**：DM 由 LLM 扮演的沉浸式教学（AI Dungeon 已有教师用户）
- **Web3 / 投机**：Virtuals Protocol 路线。高风险高投机，真实价值未证明
- **UGC 平台**：Voyage 这类「用户造 AI RPG」有可能走出下一代 Roblox

### 5.3 没人真正搞定的
- **纯 C 端付费观看**：没人靠「看 AI 打牌」收到订阅费。更像 MrBeast 时代的频道商，不是付费墙
- **电竞化**：组织 AI 比赛、下注、解说——基础设施和法律都没齐

---

## 6. 未来 12-24 个月趋势判断

**大概率会发生**：
1. **Benchmark 继续工业化**。Kaggle Game Arena 会加更多游戏（Catan、Avalon、Blood on the Clocktower 这类纯社交推理的概率很大）。LMArena 估值说明企业版评测是真市场。
2. **娱乐化直播稳态运营**。Claude/Gemini Plays Pokémon 已经证明了观看流量。下一步会有垂类频道（AI 扑克台、AI 狼人杀台）持续化，可能出现第一个百万粉 AI 主播。
3. **UGC 平台争夺**。Latitude Voyage 代表的「用户造多 agent 世界」是下一个风口，和 Roblox/AI 伴侣的中间地带。
4. **RL + LLM 融合**。Cicero 的路线会被更多团队重做，Kaggle Werewolf 已经在往这方向去。
5. **观赏性工具沉淀**。围绕「怎么把 agent 的思考过程做成好看直播」会出现专门的工具层（类似 OBS 之于游戏主播）。

**大概率是坑**：
1. **"AI 电竞" 包装但没基础**。下注盘口、战队运营这些需要稳定规则和防作弊，目前模型还在剧烈迭代，赛制根基不稳。
2. **Crypto agent 对战**。Virtuals 路线会有泡沫周期。游戏性薄、经济激励压过玩法。
3. **"纯 agent 自博弈观看"**。没有人类参与的纯 AI 直播，观众粘性天花板低——AI Village 已经验证了「要混人/混真实目标」才有戏。
4. **通用 multi-agent 平台卖给开发者**。AgentVerse / AutoGen 们已经拥挤，想靠「给开发者做 agent 对战框架」赚钱很难。

**值得押注的下一代机会**：
- **Agent + 真实目标**（AI Village 路线 + 可观测看板）继续扩大
- **把社交推理游戏做成 SaaS**（给企业面试/团建用）
- **可投票可下场的混合玩法**（观众能改变 agent 记忆/目标，介于 Twitch Plays Pokemon 和 AI Village 之间）

---

## 7. 给用户的 Next Step 建议

如果你要入场，按"启动难度 / 差异化"排序，推荐切片：

### 🎯 首选：观赏型 · 垂直游戏台（1-3 人团队可启动）
- **产品形态**：持续直播的 AI 对战频道，一个垂直品类做透（比如只做狼人杀、或只做 Catan）
- **差异化**：做「可解释性 UI」——实时暴露每个 agent 的推理、记忆、投票理由
- **收入**：先用流量帮模型厂商导流，再做企业定制局（公司团建/课堂）
- **风险**：观看粘性天花板、token 成本；前期靠爆款事件破圈
- **已有对照**：LLM Battler（产品化弱，抢时间窗）、AI Village（偏研究，不是频道）

### 🎯 次选：评测 SaaS（需要 2B 销售能力）
- **产品形态**：给企业做「在特定博弈场景里评估候选模型」的服务
- **差异化**：LMArena 做通用偏好，留给你的是「场景化 agent 能力」——谈判、情报推理、长对局一致性
- **已有对照**：LMArena AI Evaluations 已验证市场；但通用评测被它占了，你做场景切片

### 🎯 高上限选：玩家可下场的混合玩法（需要游戏设计能力）
- **产品形态**：Mafia / Werewolf / Among Us 类游戏，人机混编，观众可影响局面
- **差异化**：不是「看 AI 玩」也不是「自己玩 AI NPC」，而是 agent 当玩家+观众当导演
- **风险**：游戏设计是玄学；匹配/留存是硬仗；容易被大厂一键复制
- **已有对照**：EMNLP 2025 Mafia 是学术原型，没人做成产品；AI Dungeon/Voyage 是相邻但不完全重合

### 🎯 慎选：Agent 经济体（crypto 方向）
- **产品形态**：Virtuals 路线，agent 代币化 + 对战
- **判断**：一波流行概率高，但和"游戏"本身关系弱，主要是投机盘。除非你本来就在 Web3 圈，不建议从这里切

### 建议的 MVP 路径（如果选首选路线）
1. 选一个规则清晰、天然带戏剧性的游戏（狼人杀/Diplomacy/Avalon）
2. 接 3-4 个不同厂商的模型（制造"派系"叙事）
3. 做一个 agent state 看板（记忆/怀疑度/投票意图可视化）
4. 每天一局，剪精华短视频到 X / TikTok
5. 观察留存和播放时长，再决定是否做 B 端评测

---

## 参考资料（按段出现顺序）

**Benchmark / Arena**
- [Chatbot Arena / LMArena](https://lmarena.ai/)
- [LMArena $1.7B valuation (TechCrunch)](https://techcrunch.com/2026/01/06/lmarena-lands-1-7b-valuation-four-months-after-launching-its-product/)
- [Kaggle Game Arena (Google Blog)](https://blog.google/innovation-and-ai/products/kaggle-game-arena/)
- [Game Arena Poker + Werewolf 更新](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/kaggle-game-arena-updates/)
- [Kaggle AI Chess Tournament (Chess.com)](https://www.chess.com/news/view/which-ai-model-is-the-best-at-chess-kaggle-game-arena)
- [ARC-AGI-3](https://arcprize.org/blog/arc-agi-3-launch)
- [AgentX AgentBeats (Berkeley)](https://rdi.berkeley.edu/agentx-agentbeats.html)
- [Melting Pot (DeepMind)](https://deepmind.google/blog/melting-pot-an-evaluation-suite-for-multi-agent-reinforcement-learning/)
- [PokerBench (arXiv 2501.08328)](https://arxiv.org/abs/2501.08328)
- [Werewolf Arena (arXiv 2407.13943)](https://arxiv.org/abs/2407.13943)

**观赏 / 直播**
- [Claude Plays Pokémon (TechCrunch)](https://techcrunch.com/2025/02/25/anthropics-claude-ai-is-playing-pokemon-on-twitch-slowly/)
- [Gemini vs Claude Pokémon (TechRadar)](https://www.techradar.com/computing/artificial-intelligence/im-a-massive-pokemon-fan-and-now-im-obsessed-with-ai-models-like-gemini-and-claude-trying-to-complete-pokemon-red-and-blue)
- [AI Village (theaidigest.org)](https://theaidigest.org/village/blog/what-we-learned-2025)
- [AI Village (Decrypt)](https://decrypt.co/352398/welcome-to-the-ai-village-a-reality-show-for-ais)
- [LLM Battler](https://www.llmbattler.com/)
- [LLM Colosseum (GitHub)](https://github.com/OpenGenerativeAI/llm-colosseum)
- [LLM Colosseum (Tom's Hardware)](https://www.tomshardware.com/tech-industry/artificial-intelligence/fourteen-llms-fight-it-out-in-street-fighter-iii-ai-showdown-finds-out-which-models-make-the-best-street-fighters)
- [Outsmart (GitHub)](https://github.com/ed-donner/outsmart)

**社会模拟**
- [Generative Agents / Smallville (GitHub)](https://github.com/joonspk-research/generative_agents)
- [Generative Agents paper (ACM UIST 2023)](https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763)
- [AI Town (a16z-infra)](https://github.com/a16z-infra/ai-town)
- [AgentVerse (OpenBMB)](https://github.com/OpenBMB/AgentVerse)
- [WarAgent](https://github.com/agiresearch/WarAgent)
- [Voyager (Minecraft)](https://voyager.minedojo.org/)

**玩家可下场 / 混合**
- [AI Dungeon](https://aidungeon.com/)
- [Voyage by Latitude (TechCrunch)](https://techcrunch.com/2026/04/21/voyage-is-an-ai-rpg-platform-for-creating-custom-gaming-worlds-with-ai-generated-npc-interactions/)
- [Time to Talk: Async LLM Mafia (EMNLP 2025)](https://niveck.github.io/Time-to-Talk/)
- [Virtuals Protocol 讨论 (Botpress)](https://botpress.com/blog/crypto-ai-agent)
- [animalhouse.ai](https://animalhouse.ai/skills)

**RL 自博弈背景**
- [AlphaStar (DeepMind)](https://deepmind.google/blog/alphastar-grandmaster-level-in-starcraft-ii-using-multi-agent-reinforcement-learning/)
- [OpenAI Five](https://openai.com/index/openai-five/)
- [Cicero (Meta AI)](https://ai.meta.com/research/cicero/)
- [Cicero Science paper](https://www.science.org/doi/10.1126/science.ade9097)
- [SIMA 2 (DeepMind)](https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/)

**综述**
- [awesome-LLM-game-agent-papers](https://github.com/git-disl/awesome-LLM-game-agent-papers)
- [LLM Game Agents Survey (arXiv 2404.02039)](https://arxiv.org/abs/2404.02039)
- [GPA-LM (BAAI)](https://github.com/BAAI-Agents/GPA-LM)

=== 报告完成: agent-battle-research.md ===
