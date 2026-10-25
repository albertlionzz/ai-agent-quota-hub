# GitHub 同类项目调研：免费额度聚合这一片，谁在做什么

> 核查时间 2026-10-25，星数取自 GitHub API 实时值。结论先行：**同类项目很多，但没有一个做「不代理的额度调度台」**——它们几乎全在解决「把请求转发出去」，本项目解决的是「先把有限的免费额度分给谁」。

---

## 一、全景：三类玩家，七条赛道

| 项目 | 星 | 语言 / 许可 | 它到底是什么 | 要部署吗 | 管额度吗 | 管调度吗 |
|---|---|---|---|---|---|---|
| [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) | 80.9k | TS / MIT | 免费网关，375 家供应商、150+ 免费、1400+ 模型收成 1 个端点 | 要（本地/容器） | ✅ 免费额度看板 | ⏳ 路线图上 |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | 62.0k | Py / MIT | 企业级 LLM 网关，按 key / 团队 / 组织设硬预算 | 要（+PG +Redis） | ✅ 预算与开销日志 | 部分（fallback） |
| [QuantumNous/new-api](https://github.com/QuantumNous/new-api) | 50.7k | Go / AGPL | 中转站后台：渠道、令牌、额度、计费、分销 | 要（Docker） | ✅ 令牌额度 | 部分（渠道轮询） |
| [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) | 41.3k | TS / MIT | 34 家免费额度聚合，逐 key 用量追踪 + 自动故障转移 | 要（Node 20+） | ✅ 逐 key | ✅ 路由策略 |
| [songquanpeng/one-api](https://github.com/songquanpeng/one-api) | 37.2k | JS / MIT | 老牌中转站，最后 push 2026-01，维护已放缓 | 要（Docker） | ✅ 基础额度 | ✗ |
| [AIPMAndy/FreeToken](https://github.com/AIPMAndy/FreeToken) | 144 | HTML / MIT | 免费 AI API 额度大全（中文清单站） | 不要（静态） | ❌ 只列清单 | ✗ |
| [wynx1123/ai-welfare-hub](https://github.com/wynx1123/ai-welfare-hub) | 73 | JS | 公益站导航，Actions 每 6 小时探活 15+ 站点 | 不要（静态） | ❌ | ✗ |
| [Q-shuang-dot/ai-coding-welfare](https://github.com/Q-shuang-dot/ai-coding-welfare) | 64 | JS / MIT | Claude Code / Codex 免费额度导航 + 自动巡检 | 不要（静态） | ❌ | ✗ |
| [rockbenben/free-llm-intel](https://github.com/rockbenben/free-llm-intel) | 49 | Py / MIT | 厂商动态 → RSS + 免费额度总表（约 70 家），每天巡检 | 不要（静态） | ❌ 只做情报 | ✗ |
| [justjavac/free-models](https://github.com/justjavac/free-models) | 30 | TS / MIT | 只收免费额度的中转站 / 聚合网关清单 | 不要（静态） | ❌ | ✗ |
| **本项目 Quota Hub** | — | 单文件 HTML | 额度当资源做决策：路由 / 编排 / 日程 / 核验 / 画像 | 不要（开箱即用） | ✅ 本地钱包 | ✅ 本项目的核心 |

三类玩家很清楚：
1. **网关派**（OmniRoute / LiteLLM / new-api / one-api / freellmapi）——解决「N 个 key 变 1 个端点」。代价是必须跑一个服务，且要持续维护上游变更。
2. **导航派**（FreeToken / ai-welfare-hub / ai-coding-welfare / free-models / free-llm-intel）——解决「哪里还有免费的」。本质是清单站，不参与你的实际调度。
3. **决策派**——目前几乎是空的。OmniRoute 把 `Quota-aware scheduling` 和 `Quota telemetry` 明确标成 `next`（未发布），其余项目连这个概念都没立项。

---

## 二、最需要正视的对手：OmniRoute

80.9k 星，MIT，375 家供应商、1400+ 模型、宣称每月约 15 亿免费 token，还带 `/dashboard/free-tiers` 把免费额度算成一个诚实的总数，每两周对着实时目录重审。这个规模和更新频率，单靠人工核对是追不上的。

它和本项目的**根本分歧**：

| | OmniRoute | Quota Hub |
|---|---|---|
| 运行形态 | 本地服务 + 端点 | 单文件 HTML，双击即用 |
| 对请求的介入 | 代理并转发（流量过它） | 完全不碰请求，只出决策 |
| 免费额度数字 | 目录计算出的总量 | 你自己名下、你真开通的那部分 |
| 能不能离线 / 内网 | 不能 | 能 |
| 数据是否可审计 | 算出来的，不透明到条目 | 每条挂官方出处 + 核实日期 |

也就是说：**它算「世界上有多少免费额度」，本项算「你手上这些额度今晚该给谁」**。前者是市场行情，后者是排产计划。两者不冲突，甚至可以互相印证——但别去比谁列的平台多，那是必输的战场。

---

## 三、真正值得抄的四件事

### 1. 自动探活（优先级最高）

`ai-welfare-hub`、`ai-coding-welfare` 都用 GitHub Actions 每 6 小时跑一次探活，把结果写成静态 JSON，页面直接读。本项目现在是「本地脚本自检 + 手工登记」，别人多这一层就能说「我的数据是活的」。

**而且这件事本项目不需要后端就能做**：仓库加一个 `probe.yml`，定时 `GET /models`（不耗 token），产出 `probe.json`；页面读同目录这个文件，把「最近一次探活时间 + 各平台存活状态」显示在接入核验页。零服务器、零密钥泄露（key 只存在 Actions Secrets，探测结果不含 key）。

### 2. 数据双源交叉校验

`free-llm-intel` 每天巡检 30+ 家厂商官方页面并整理成约 70 家额度总表；`justjavac/free-models`、`FreeToken` 是社区维护的中文清单。本项目已有的「口径冲突清单」正好是校验别人的位置——把三方说法并列，冲突的标出来，比任何单方都更可信。这一步不需要抓数据，手工比对一次就能给现有 48 家补上交叉证据。

### 3. 逐 key 用量与冷却（借 freellmapi 的机制）

freellmapi 的「命中 429 → 冷却该 key → 换下一个」是成熟机制。本项目离线，做不到自动切换，但可以在「我的额度」里加「冷却截止时间」字段：登记一次 429 就自动置为冷却，重置日程页把冷却中的平台压到列表底部。这是把网关的运行时智慧移植到排产层。

### 4. 一键把方案交给网关（本项目的出口）

已经做了 LiteLLM config 导出，但对手多了两个值得加的目标：**OmniRoute** 和 **freellmapi** 的配置格式。理由很实在——本项目不做代理，用户真要跑起来迟早要落到某个网关上；把「选哪个平台组合」直接翻译成那个网关的配置，是决策台最自然的收口方式。

---

## 四、结论

- **位置是对的**：没有同类项目在做「不代理的额度调度」。网关派不管你的排产，导航派不管你的执行。
- **威胁是真实的**：OmniRoute 一旦把 `Quota-aware scheduling` 发出来，会覆盖本项目的一部分价值。但它是服务端、要部署、数据不可逐条审计——这三条短时间内改不掉。
- **当前最大的短板不是功能，是数据的「新鲜度证明」**。别人每 6 小时探活、每天巡检，本项目的数据停在「核对至某日」。补上自动探活，是这个项目从「一份做得很细的报告」变成「一个可信工具」的分界线。

**建议的下一步顺序**：① Actions 定时探活 + `probe.json`（可自动化、零后端）→ ② 额度页加「冷却」字段 → ③ 网关配置导出补 OmniRoute / freellmapi 两个目标 → ④ 三方清单交叉校验，扩充口径冲突。
