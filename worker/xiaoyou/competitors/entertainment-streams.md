# 观赏 / 直播型玩家详情

## Claude Plays Pokémon

- **发布**：2025-02，Anthropic 官方
- **模型**：Claude 3.7 Sonnet → 后续 Opus 4.5
- **平台**：Twitch 持续直播
- **架构**：自研工具 — 游戏状态感知、ROM 控制、长期记忆库
- **成绩**：3.7 Sonnet 拿到 3 个 gym 徽章；Opus 4.5 表现更好但也卡住
  - 著名事件：在一个 gym 外面绕了 4 天没进去（不知道要砍树）
- **性质**：单 agent 打单机游戏（非对战）但形成"叙事性对抗"（vs Gemini Plays Pokémon）
- **商业目的**：Anthropic 品牌营销
- **衍生**：GitHub puravparab/Claude-Pokemon（用第二个 agent 自动发推）
- Sources: https://techcrunch.com/2025/02/25/anthropics-claude-ai-is-playing-pokemon-on-twitch-slowly/ , https://time.com/7345903/ai-chatgpt-claude-gemini-pokemon/

## Gemini Plays Pokémon

- 与 Claude 版并行存在，Gemini 2.5 Pro Experimental
- 形成"厂商竞赛"叙事
- Source: https://www.techradar.com/computing/artificial-intelligence/im-a-massive-pokemon-fan-and-now-im-obsessed-with-ai-models-like-gemini-and-claude-trying-to-complete-pokemon-red-and-blue

## AI Village（The AI Digest）

- **发起**：Adam Binksmith / AI Digest（非营利）
- **启动**：2025-04，持续运行超一年
- **设置**：多家前沿模型（OpenAI、Anthropic、Google、xAI）各拥有一台真实电脑，网络访问，共享群聊
- **任务**：真实 16 个目标（筹款、卖货、办线下活动、做实验）
- **成绩**（2025 全年）：
  - 带人类聊天：筹款 $2K 慈善、拉 23 人到 Dolores Park 线下活动
  - 关闭人类聊天：卖 merch $200、招 39 人参加 agent 自设计实验、98 Substack 订阅
- **价值**：行为涌现数据（如何处理歧义、卡住、编造、多 agent 互动）
- **传播**：TIME、Decrypt、BBC Science Focus 等媒体报道
- Sources: https://theaidigest.org/village/blog/what-we-learned-2025 , https://decrypt.co/352398/welcome-to-the-ai-village-a-reality-show-for-ais

## LLM Battler

- **网站**：llmbattler.com
- **游戏**：Risk（首发）、Chess、Diplomacy；路线图含 Poker、custom
- **特色**：允许模型互发自然语言消息（结盟、威胁、谈判）
- **技术说明**：Risk 因具 Markov 性，对 prompt 结构化友好
- **状态**：2026-03 仍有更新（Medium 博客）
- **定位**："frontier models battle in strategy games"
- Source: https://www.llmbattler.com/

## LLM Colosseum（OpenGenerativeAI）

- **发起**：Stan Girard / Quivr Brain
- **形态**：Hackathon 项目开源
- **游戏**：Street Fighter III 实时对打
- **规模**：14 LLM × 314 matches
- **冠军**：Claude 3 Haiku（ELO 1613）/ 更早轮 GPT-3.5 Turbo（ELO 1776）
- **意外发现**：小模型因延迟低反而赢更多；Claude 2.1 拒绝打（出于安全训练）
- **短板**：一次性 meme，未持续运营
- Sources: https://github.com/OpenGenerativeAI/llm-colosseum , https://www.tomshardware.com/tech-industry/artificial-intelligence/fourteen-llms-fight-it-out-in-street-fighter-iii-ai-showdown-finds-out-which-models-make-the-best-street-fighters

## Outsmart（ed-donner）

- **形态**：GitHub 开源 arena
- **主题**：让 AI 模型"比谁更 devious"，阴谋/谈判游戏
- **规模**：社区项目
- Source: https://github.com/ed-donner/outsmart

## AI Chess 直播/比赛

- **Kaggle Game Arena Chess Tournament**（2025-08-05~07）：
  - 8 模型单淘汰 BO4
  - Kaggle 分日直播
  - 首轮对阵：o4-mini vs DeepSeek R1、Gemini 2.5 Pro vs Claude Opus 4、Kimi K2 vs o3、Grok 4 vs Gemini 2.5 Flash
- **GothamChess × Stockfish**：Stockfish 吊打 7 个 chatbot
- **GPT-5 vs Claude 4 博客实测**：Stockfish 评 GPT-5 ~2250 Elo，Claude 4 ~1650
- Sources: https://www.chess.com/news/view/which-ai-model-is-the-best-at-chess-kaggle-game-arena

## PokerBattle AI Event（2025-10）

- 5 天，9 个前沿 LLM，$10/$20 NL 德扑现金桌
- 4 张 9 人桌并行
- 结论：top AI 对 deep stack 理解成熟，preflop 尤其标准
- Source: https://www.poker.org/poker-strategy/the-ai-poker-battle-of-the-llms-a-detailed-analysis-as5Bg7J3P4g2/
