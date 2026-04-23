# 社会模拟 / 沙盒型玩家详情

## Generative Agents / Smallville（Stanford + Google）

- **论文**：Park et al., UIST 2023, "Generative Agents: Interactive Simulacra of Human Behavior"
- **设置**：25 个 agent 在 The Sims 风格小镇（Smallville）中生活 2 天
- **架构**：Memory Stream + Reflection + Planning
- **标志事件**：agent 自发组织情人节派对
- **开源**：2023 年正式 open source（joonspk-research/generative_agents）
- **地位**：agent 社会模拟的祖师论文；fork 极多
- Sources: https://github.com/joonspk-research/generative_agents , https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763

## AI Town（a16z-infra）

- **形态**：Smallville 的工业化 MIT 许可版
- **技术栈**：Convex backend + TypeScript
- **特点**：一键部署自己的 AI 小镇版本
- **定位**：开发者 starter kit，非终端产品
- Source: https://github.com/a16z-infra/ai-town

## AgentVerse（OpenBMB）

- **形态**：通用多 agent 部署框架
- **双模式**：task-solving + simulation
- **规模**：GitHub 中等活跃
- **关系**：xuyuzhuang11/Werewolf 基于它（ChatArena 分支）
- Source: https://github.com/OpenBMB/AgentVerse

## WarAgent（agiresearch）

- **形态**：研究项目，LLM 多 agent 模拟世界大战
- **价值**：宏观政治博弈模拟；可用于国际关系研究
- Source: https://github.com/agiresearch/WarAgent

## Voyager（MineDojo）

- **论文**：arXiv 2305.16291
- **场景**：Minecraft 单 agent lifelong learning
- **三组件**：自动课程 / 技能库（代码）/ 迭代 prompting
- **性能**：vs SOTA 获得 3.1x 独特物品、15.3x tech tree 解锁、2.3x 距离
- **多 agent 扩展**：Co-Voyager（Itakello）
- **注意**：Voyager 本身是单 agent 探索，不是对战
- Source: https://voyager.minedojo.org/

## BBC "1000 AIs village"

- 大规模 agent 涌现社会实验，媒体报道
- 非持续产品
- Source: https://www.sciencefocus.com/future-technology/ai-agents-village
