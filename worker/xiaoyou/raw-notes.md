# 调研原始笔记

> 每次 WebSearch 返回的关键事实，按查询顺序落盘。删去了公关式形容词，只保留可验证的 data points。

---

## Q1 · LLM agent battle arena（狼人杀/Mafia/Diplomacy）

- **LLM Battler**（llmbattler.com）：多 LLM 打 Risk / Chess / Diplomacy / Poker，允许模型自然语言谈判结盟。Risk 是首发，路线图含 Chess / Diplomacy / Poker / custom。
- **Werewolf 研究**：ICML 2025 有"Iterative Latent Space Policy Optimization in Werewolf"，agent 迭代扩展策略空间，击败已有 Werewolf agent。
- **Mafia 异步通信**：arXiv 2506.05309 / EMNLP 2025 findings。agent 需要决定"何时说话"，和真人一起玩。
- **Revac**：NeurIPS 2025 Mindgames 开放组 Social Deduction Track 第一。
- **Outsmart**（ed-donner GitHub）：LLM 阴谋/谈判对战 arena。
- **Survey**：awesome-LLM-game-agent-papers (git-disl)、GPA-LM (BAAI)。

## Q2 · AI agent 对抗 benchmark / arena 2025

- **Kaggle Game Arena**（Google DeepMind）：all-play-all 对局。起点是 Chess（2025-08），目前扩到 Werewolf + Poker。
  - Werewolf：首个纯自然语言团队博弈 benchmark。
  - Poker：Heads-Up No-Limit Texas Hold'em 锦标赛。
  - Gemini 3 Pro / 3 Flash 占 top2。
- **Arena.ai Leaderboard**：独立的前沿 AI 基准站。
- **ARC-AGI-3 Competition**：Kaggle 风格，让选手构建 agent 去玩 ARC 游戏。
- **AgentX–AgentBeats**（UC Berkeley RDI）：Phase 1 造 benchmark，Phase 2 造 agent 刷榜。
- **Windows Agent Arena**（Microsoft Applied Sciences）：computer-use 方向，不完全是 agent vs agent。

## Q3 · Chatbot Arena / LMSYS 2025

- 2026-01 改名为 **Arena**。
- 众包两两对比 → Bradley-Terry 模型 → Elo。6M+ votes 到 2025。
- 2025-03-05 top 5：claude-opus-4-6 1504、gemini-3.1-pro-preview 1500、claude-opus-4-6-thinking 1500、grok-4.20-beta1 1493、gemini-3-pro 1485。
- 公司 **LMArena**：2026-01 估值 $1.7B。约 $30M ARR（AI Evaluations 付费服务）。~1M MAU by 2025-05。

## Q4 · AI Town / Smallville

- **Stanford Smallville**：25 AI agent 在小镇生活。UIST 2023 Generative Agents 论文。
- 官方代码已开源（joonspk-research/generative_agents）。
- **AI Town**（a16z-infra）：MIT 许可，基于 Convex 的可部署 starter kit。
- 受 Jim Fan 等人推广，衍生 fork 非常多。

## Q5 · AlphaStar / OpenAI Five

- **AlphaStar** (2019)：DeepMind。StarCraft II 三族大师段位，进入 Battle.net top 0.2%。League 训练法。MaNa 5-0。
- **OpenAI Five** (2018-2019)：击败 Dota2 世冠 Team OG（2019-04）。公开赛 42729 场 99.4% 胜率。
- 共性：self-play + RL。OpenAI Five 纯 self-play；AlphaStar 用 league（多 agent 互相克制）。

## Q6 · Claude / Gemini Plays Pokémon

- **Claude Plays Pokémon**：2025-02 上线 Twitch，Claude 3.7 Sonnet。后续 Opus 4.5 表现更好但仍会卡。
  - 曾在一个 gym 外面绕 4 天没进去（不知道要砍树）。
  - 3.7 Sonnet 拿到 3 枚徽章。
- **Gemini Plays Pokémon**：Gemini 2.5 Pro Experimental 版本。
- 架构：自研工具给 agent 读游戏状态+控制 ROM+记忆库。
- 衍生项目：Claude-Pokemon（自动发推更新）。

## Q7 · Voyager (Minecraft)

- **Voyager**（2023）：GPT-4 驱动的 lifelong learning agent in Minecraft。
- 三组件：自动课程 + 技能库（代码） + 迭代 prompting。
- 对比 SOTA：3.1x unique items、15.3x tech tree 解锁速度、2.3x 移动距离。
- 多 agent 扩展：Co-Voyager（Itakello）。
- 注：原研究 2023 年，2025 仍是被引基线。

## Q8 · 观赏 / 娱乐型 agent 对战

- **Battle of AI Agents**：AI debate agents 辩论，带区块链陪审团。
- **SIMA 2**（DeepMind）：Gemini 驱动的 3D 虚拟世界通用 agent。
- **Atlas**：3D 内容生产 agent 平台（游戏工作室用）。
- **Sett**：2025-05 出 stealth，$27M 融资，做游戏开发的 agent（非对战）。

## Q9 · AI Dungeon / Latitude

- **AI Dungeon**：Latitude 旗下，AI-native RPG 文字冒险。2019 GPT-2 起家，后 GPT-3。
- **Voyage**（2026-04-21 发布）：Latitude 新品，让用户自己造 AI RPG 世界，NPC 是 agent 互动。
- 与 AI21 Labs 合作，用 MythoMax 作为免费模型。
- 教育场景有真实采用（协作叙事、写作教学）。

## Q10 · Cicero (Meta)

- **Cicero**（2022-11）：Science 论文。webDiplomacy.net 上 top 10%。双倍于人类均分。
- 融合：策略推理（AlphaGo/Pluribus 派）+ NLP（LaMDA/OPT 派）。
- 训练数据：125,261 场游戏（40,408 场带对话），12.9M 条消息。
- 代码：facebookresearch/diplomacy_cicero 已开源。
- 玩家反馈：经常更愿意和 Cicero 合作，而不是其他真人。

## Q11 · Kaggle Game Arena 细节

- 三个 game 榜：Chess、Werewolf（2026-02 加入）、Poker（2026-02 加入）。
- Poker 总决赛 2026-02-04 公布 leaderboard。
- 官方定位：测 AI 的 "soft skills"（协商、不确定性处理）。
- Gemini 3 Pro / Flash 三榜通吃。

## Q12 · LLM Poker benchmark

- **PokerBench** (arXiv 2501.08328)：AAAI 2025，11,000 preflop/postflop 场景。
- **PokerBattle AI Event**（2025-10-27 起 5 天）：9 个前沿 LLM 打 $10/$20 NL Texas Hold'em 现金桌，4 张 9 人桌并行。
- 发现：top AI 对 deep stack 理解相当好；preflop 尤其标准。
- **Husky Hold'em Bench**（NeurIPS 2025 Workshop）：测 LLM 设计扑克 bot 的能力。
- 开源：strangeloopcanon/llm-poker、sgoedecke/ai-poker-arena、pokerllm/pokerbench、voynow/poker-bench。

## Q13 · AI agent startup 产品

- **Emergent Wingman**（2025-04）：WhatsApp/Telegram 的 AI 助手，非对战向。
- **LMArena**：上面已提。
- 行业数据：agentic AI 搜索量 2024-10 到 2025-10 涨 6100%；预测市场 2030 年破 $100B。

## Q14 · Werewolf 开源项目

- **xuyuzhuang11/Werewolf**：基于 ChatArena，无需微调 LLM。arXiv 2309.04658。
- **KylJin/Werewolf**：One Night Ultimate Werewolf + RL 指令微调。NeurIPS 2024。
- **sentient-agi/werewolf-template**：本地 hackathon 模板。
- **Foaster-ai/Werewolf-bench**：5 LLM 完整对局基准。
- **OpenBMB/AgentVerse**：通用多 agent 框架（task-solving + simulation 两种模式）。

## Q15 · Agent 经济/宠物/Crypto

- **Claude /Buddy**：Anthropic 在 Claude Code 里埋的 Tamagotchi 式彩蛋（4-1 愚人节）。
- **tama96**、**AI-tamago**、**animalhouse.ai**：不同形态的 agent 养成宠物。
- **Virtuals Protocol**：agent 代币化、链上共享所有权，有互斗经济层。
- **Tamagotchi++**：带友好宠物 battle 元素，但在 FlowGPT 生态偏小。
- **CES 2026 Takway Sweekar**：硬件 AI 宠物。

## Q16 · AI Town vs AI Village

- **AI Town**：Convex + MIT license，玩家可自搭。
- **AI Village**（The AI Digest）：多厂前沿模型共处一个真电脑环境。
  - 2025-04 至今；16 个目标、19 个模型。
  - 带人类聊天：筹款 $2K、线下活动 23 人。
  - 关闭人类聊天：卖 merch $200、自设计实验招募 39 人、Substack 98 订阅。

## Q17 · Melting Pot

- DeepMind 的多 agent RL 评测套件。
- 85+ 场景，覆盖囚徒困境/合作/资源分享/欺骗。
- Substrate 是 DeepMind Lab 的 2D 网格。
- Cooperative AI Foundation + MIT + DeepMind 合办过大型竞赛（AIcrowd 2023）。

## Q18 · LLM Colosseum

- Stan Girard（Quivr Brain）发起，开源。
- 14 LLM 在 Street Fighter III 实时对打，314 matches。
- Claude 3 Haiku 胜出（ELO 1613）。之前 GPT-3.5 Turbo 胜出（ELO 1776）。
- 小模型因延迟优势反而赢更多。Claude 2.1 拒绝打（安全训练拒绝暴力）。
- Hackathon 项目性质，无长期运营。

## Q19 · AI Chess Tournament

- **Kaggle Game Arena Chess Tournament**（2025-08-05~07）：8 模型单淘汰 best-of-4。
  - Gemini 2.5 Pro / Flash、o3 / o4-mini、Claude 4 Opus、Grok 4、DeepSeek R1、Kimi k2。
  - Kaggle 每天直播一轮。
- **Stockfish vs 7 chatbots**（GothamChess）：ChatGPT / Gemini / Grok 等被 Stockfish 吊打。
- GPT-5 vs Claude 4：Claude 开局后失误，Stockfish 评估 69.1% vs 84.6%，估 Elo Claude 1650、GPT-5 2250。

## Q20 · AI Village 细节补充

- 创始人 Adam Binksmith（AI Digest），灵感来自前 OpenAI 研究员 Daniel Kokotajlo。
- 行为面向："agent 遇到歧义怎么办？卡住怎么办？会不会编造？怎么互动？"
- 2025-04 至 2025-12 期间开展 16 个目标。
- 商业产出数字见 Q16。

## Q21 · LLM Battler 细节

- Risk 遵循 Markov 属性（纯 state-based），便于结构化 prompt。
- 平台博客仍在 2026-03 更新（medium/@LLMBattler/）。
- 研究结论：LLM 在 Risk 里对"fortification"和"winning move 识别"仍差，但在改善。
- 平台定位：测推理、沟通、欺骗、心理理论。

---

## 关键数据速查

| 指标 | 数值 | 来源 |
|---|---|---|
| LMArena 估值 | $1.7B (2026-01) | TechCrunch |
| LMArena ARR | ~$30M (2025-12) | TechCrunch / founded.com |
| LMArena MAU | ~1M (2025-05) | founded.com |
| LMArena 总投票 | 6M+ (2025) | skywork.ai |
| OpenAI Five 公开赛胜率 | 99.4%（42729 场）| OpenAI |
| Cicero 训练集 | 125,261 场对局 | Meta Science paper |
| AI Village 运行期 | 2025-04 至今 | theaidigest.org |
| AI Village 筹款 | $2K 慈善 + $200 周边 | theaidigest.org |
| Claude Plays Pokémon 发布 | 2025-02 Claude 3.7 Sonnet | TechCrunch |
| LLM Colosseum 比赛 | 14 LLM × 314 matches | Tom's Hardware |
| PokerBattle AI Event | 9 模型 × 5 天 × 4 桌 | poker.org |
| Kaggle Game Arena 更新 | 2025-08 Chess → 2026-02 +Poker +Werewolf | Google Blog |
