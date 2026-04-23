# Benchmark / Arena 型玩家详情

## Kaggle Game Arena（Google DeepMind）

- **首发**：2025-08 Chess tournament（8 模型单淘汰 BO4）
- **扩展**：2026-02 加入 Poker（Heads-Up NL Texas Hold'em）+ Werewolf（社交推理）
- **赛制**：all-play-all，Bradley-Terry/Elo 拟合
- **当前王者**：Gemini 3 Pro + Gemini 3 Flash 三榜通吃
- **官方定位**：测 AI "soft skills"（协商、风险管理、不确定性）
- **参赛模型**：Gemini 2.5 Pro/Flash、o3、o4-mini、Claude 4 Opus、Grok 4、DeepSeek R1、Kimi k2
- **直播**：Kaggle 分日直播
- **战略意义**：Google 把"游戏评测"做成模型营销主战场，对 Anthropic/OpenAI 是被动应战
- Sources: https://blog.google/innovation-and-ai/products/kaggle-game-arena/ , https://blog.google/innovation-and-ai/models-and-research/google-deepmind/kaggle-game-arena-updates/

## Chatbot Arena / LMArena

- **形态**：两两匿名问答比较 → 投票 → Elo 榜
- **规模**：6M+ votes, ~1M MAU (2025-05)
- **公司化**：2026-01 LMArena 估值 $1.7B；AI Evaluations 付费版 ~$30M ARR
- **注意**：严格说是"人评模型"而非"agent vs agent"，但行业基石地位影响所有后续评测
- **2025-03-05 Top5**：Claude Opus 4.6、Gemini 3.1 Pro preview、Claude Opus 4.6 thinking、Grok 4.20 beta1、Gemini 3 Pro
- Sources: https://lmarena.ai/ , https://techcrunch.com/2026/01/06/lmarena-lands-1-7b-valuation-four-months-after-launching-its-product/

## Melting Pot（DeepMind）

- **类型**：多 agent RL 评测，非 LLM
- **规模**：85+ 场景
- **主题**：合作、竞争、欺骗、互惠、资源分享
- **技术**：DeepMind Lab 2D 网格 substrate
- **竞赛**：Cooperative AI Foundation + MIT 每年办 MeltingPot Challenge
- **价值**：学术黄金标准，但离消费产品远
- Sources: https://deepmind.google/blog/melting-pot-an-evaluation-suite-for-multi-agent-reinforcement-learning/

## ARC-AGI-3

- **形态**：选手构建 agent 玩"ARC 游戏"，测泛化推理
- **特点**：不让模型预训过的新游戏
- **判断**：学术向，观赏性低，但对 AGI 进展有指示意义
- Source: https://arcprize.org/blog/arc-agi-3-launch

## AgentX / AgentBeats（UC Berkeley RDI）

- **双阶段**：Phase 1 造 benchmark，Phase 2 造 agent 刷
- **组织**：大学联合竞赛
- Source: https://rdi.berkeley.edu/agentx-agentbeats.html

## PokerBench (AAAI 2025)

- **论文**：arXiv 2501.08328
- **数据集**：11,000 个 preflop/postflop 关键决策
- **目的**：训练 LLM 成为职业扑克玩家
- **衍生**：多个 GitHub fork（JoeAzar/pokerbench, pokerllm/pokerbench）
- Source: https://arxiv.org/abs/2501.08328

## Husky Hold'em Bench (NeurIPS 2025)

- **题目**："LLM 能否设计有竞争力的扑克 bot"（元层评测）
- Source: https://openreview.net/pdf?id=jARUSddVIB

## Werewolf Arena (arXiv 2407.13943)

- **地位**：早期 LLM 狼人杀评测标杆
- **归宿**：已并入 Kaggle Game Arena
- Source: https://arxiv.org/abs/2407.13943
