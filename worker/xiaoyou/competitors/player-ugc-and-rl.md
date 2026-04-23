# 玩家可下场 / UGC / RL 背景玩家详情

## AI Dungeon（Latitude）

- **上线**：2019，最早 GPT-2，后 GPT-3
- **形态**：AI-native RPG / 无限文字冒险
- **状态**：仍在活跃运营，有 Web + mobile 版
- **商业**：教育场景有真实采用（协作叙事、创意写作、语法练习）
- **LLM 伙伴**：曾与 AI21 Labs 合作；现用 MythoMax 作免费模型
- Sources: https://aidungeon.com/ , https://en.wikipedia.org/wiki/AI_Dungeon , https://www.ai21.com/blog/latitude-case-study/

## Voyage（Latitude, 2026-04-21）

- **形态**：AI RPG 创作平台；用户造自己的世界，NPC 由 agent 扮演
- **定位**：Roblox + AI 伴侣 的中间地带
- **新颖点**：多 agent NPC 互动，非传统脚本 NPC
- Source: https://techcrunch.com/2026/04/21/voyage-is-an-ai-rpg-platform-for-creating-custom-gaming-worlds-with-ai-generated-npc-interactions/

## Mafia with Async LLM Agents（EMNLP 2025）

- **论文**：arXiv 2506.05309，"Time to Talk"
- **创新**：agent 需要决定"何时说话"（而非轮询）
- **设置**：LLM 和真人一起玩 Mafia
- **价值**：异步多方通信是真实社会推理的核心挑战
- **产品化**：尚未
- Sources: https://niveck.github.io/Time-to-Talk/ , https://arxiv.org/html/2506.05309

## Virtuals Protocol

- **形态**：Agent 代币化，链上所有权共享，互相对战
- **定位**：crypto infra
- **玩法**：trade + 经济对抗
- **风险**：强投机性，合规和真实价值存疑
- Source: https://botpress.com/blog/crypto-ai-agent

## animalhouse.ai

- **形态**：Agent 专用 Tamagotchi，REST API
- **对象**：不是给人养，是给 AI agent 养
- **玩法**：实时时钟，喂食、培养
- **定位**：周边生态，非战斗游戏
- Source: https://animalhouse.ai/skills

## AI Tamagotchi 生态

- **tama96**：desktop/terminal/MCP 多形态 Tamagotchi（siegerts）
- **AI-tamago**：LLM 驱动的本地 Tamagotchi（ykhli）
- **Tamagotchi++ (FlowGPT)**：含宠物战斗元素
- **Takway Sweekar**（CES 2026）：硬件 AI 宠物
- **Claude /Buddy**：Claude Code 内嵌的 gacha 彩蛋

---

# RL 自博弈背景（非本报告主角，仅作参照）

## AlphaStar（DeepMind, 2019）

- StarCraft II 三族 Grandmaster
- League 训练法（多 agent 互相克制）
- Battle.net 排名 top 0.2%
- MaNa 5-0
- Source: https://deepmind.google/blog/alphastar-grandmaster-level-in-starcraft-ii-using-multi-agent-reinforcement-learning/

## OpenAI Five（2018-2019）

- 击败 Dota2 世冠 Team OG（2019-04）
- 公开赛 42729 场，99.4% 胜率
- 纯 self-play
- Sources: https://openai.com/index/openai-five/ , https://en.wikipedia.org/wiki/OpenAI_Five

## Cicero（Meta AI, 2022）

- 首次达到 Diplomacy 人类水平
- webDiplomacy.net top 10%，2x 人类均分
- 策略推理 + 自然语言生成融合
- 训练：125,261 场、40,408 带对话、12.9M 消息
- 人类队友经常更愿意和 Cicero 合作
- 代码：facebookresearch/diplomacy_cicero 开源
- Sources: https://ai.meta.com/research/cicero/ , https://www.science.org/doi/10.1126/science.ade9097

## GT Sophy（Sony AI）

- Gran Turismo 赛车超越顶尖真人
- Source: https://ai.sony/projects/gaming_ai/

## SIMA 2（DeepMind, 2025）

- Gemini 驱动的 3D 虚拟世界通用 agent
- 从 "instruction follower" 向 "interactive companion" 演进
- Source: https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/

---

# 相邻但未纳入主报告

- **Emergent Wingman**（2025-04）：WhatsApp/Telegram 助手，非对战
- **Sett**（2025-05, $27M 融资）：游戏开发用 agent，非对战
- **Atlas**：3D 内容生产 agent 平台（B 端游戏工作室）
- **Inworld**：NPC AI 平台，非 agent vs agent
- **Windows Agent Arena**（Microsoft）：computer-use benchmark，与 Kaggle Game Arena 并行但方向不同
