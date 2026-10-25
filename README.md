# AI Agent 免费额度调度中台

把各家大模型的「免费额度」真正用起来的调度台：额度盘点、跨模型分阶段编排、总控一致性闭环、接入通道与网关配置、主流模型接入核验。

单文件 HTML 应用（无构建依赖、无后端、双击即用），毛玻璃界面，`Ctrl + K` 可全局跳转，配套一份 11 章的调研报告。
接入核验页带**自动探活**：GitHub Actions 每 6 小时探测 22 家端点是否还通，结果写进 `probe.json` 并内联进页面——所以数据有一个可验证的「新鲜度」，而不是一句「核对至某日」。

![总览界面](docs/screenshot-overview.png)

## 在线访问

**https://albertlionzz.github.io/ai-agent-quota-hub/**

每次 push 到 `main`，GitHub Actions 会自动把构建产物发布到这个地址（见 `.github/workflows/pages.yml`）。想离线用，直接下载仓库里的 `AI-Agent免费额度调度中台.html` 双击打开——不联网也能跑。

> **首次开启**：Pages 站点需要管理员在仓库 Settings → Pages → Build and deployment → Source 选「GitHub Actions」并保存一次。`GITHUB_TOKEN` 建不了站点（该接口要 admin 权限），所以工作流只能检测不能代劳；未开启时它会给出警告并跳过发布，不会报红。

## 它解决什么问题

拿到一堆免费额度之后，真正会卡住的不是「哪家送得多」，而是这三件事：

1. **额度混在一起比** —— 一次性礼包、每日刷新、试用金、网页版额度、自托管，五种形态混着算，结论一定是错的。
2. **接不通** —— 端点域名、路径版本、model id 三处任一处过时，脚本第一次就跑不起来。
3. **跑不完一个项目** —— 单个模型的免费额度撑不住完整项目，需要按阶段换模型，并把上下文压缩成「交接卡」往下传。

中台对应给出：五类额度建模 → 项目编排流水线 → 总控调度舱 → 接入通道与网关 → 23 家接入核验。

## 11 个视图

| 视图 | 作用 |
|---|---|
| 总览 | 额度总盘、可持续产能、红线提示 |
| 平台库 | 48 个平台的额度、限制维度（RPD / TPM / 并发）、注册门槛 |
| 任务路由 | 按任务需求把额度分配出去，算缺口 |
| 项目编排 | 6 个模板 × 2 种执行模式，多模型分阶段跑完一个项目 |
| 总控调度舱 | 四角色（总控 / 执行 / 审查 / 汇总）+ 状态卡 + 五类冲突检查 + 经验库 |
| 能力画像 | 12 模型 × 9 维得分，每条挂评测来源与可信度分级 |
| 我的额度 | 已开通清单、用量登记（算得出真实余量）、JSON 备份导出/导入 |
| 重置日程 | 今天哪些额度会刷新、哪些只减不增、哪些周期未公示 |
| 接入通道 | 两个问题给一条路（向导）、粘贴 key 生成配置命令、三类额度、五条路径、LiteLLM 网关配置 |
| 接入核验 | 23 家主流厂商的端点 / 环境变量 / model id / 退役清单 / 免费状态，附自动探活与自检脚本导出 |
| 情报与避坑 | 已终止的通道、数据存疑项 |

## 快速开始

直接打开 `AI-Agent免费额度调度中台.html`（单文件，含全部样式与脚本，离线可用）。

从源码构建：

```bash
cd quota-hub
python build.py          # 产出 ../AI-Agent免费额度调度中台.html
```

`build.py` 把 `assets/*.js` 按固定顺序注入 `app.js` 的 IIFE 内部（USAGE → WALLETIO → SCHEDULE → ONBOARD → CAP → PIPE → ORCH → ACCESS → PROBESNAP + PROBE → VERIFY → PALETTE），再套进 `template.html`。顺序有依赖：orchestrator 用 pipeline 的产能函数，access 与 verify 用 pipeline 的端点表。

## 自动探活（probe.json）

接入核验页顶部那张卡片不是手写的，是跑出来的。

```bash
node quota-hub/probe/gen_endpoints.js    # 从 assets/verify.js 抽出端点清单 → probe/endpoints.json
python quota-hub/probe/probe.py          # 逐个探测 → probe.json
```

`.github/workflows/probe.yml` 每 6 小时（`17 */6 * * *`）跑一次并把 `probe.json` 提交回仓库，Pages 和单文件产物都读它。**零 secret 也能跑**，这是设计上有意为之：

| 探测结果 | 含义 | 要做什么 |
|---|---|---|
| `ok` 200 | 带 key 通了 | 无 |
| `auth` 401 | **端点存在**，只是没配 key | 正常，路是对的 |
| `badkey` 401/403 | 带了 key 仍被拒 | 去控制台重新生成 key |
| `forbidden` 403 | 地域封锁 / IP 限制 / 无该模型权限 | 换 key 未必有用，先看原因 |
| `notfound` 404 | base_url 或路径写错 | **这才是真错误**，跟 key 无关 |
| `unreachable` | 网络层到不了（含代理回 502 connect failed） | 看执行环境，不代表平台挂了 |
| `ratelimited` 429 | 配置没问题，额度或频率到了 | 等重置或降并发 |

几个刻意的取舍：

- **测的是「路」，不是「量」**。用 `GET /models`，不消耗 token、不占生成额度，所以它只能证明接得通，证明不了还剩多少——这一页从不假装知道你的余额。
- **401 不报警**。把「没配 key」当成故障，会让这个看板永远一片红，最后没人看。
- **403 和 401 分开**。401 是「没出示证件」，403 是「出示了也不让进」，合并会让人白白去换 key。
- **代理的 502 归到 unreachable**。企业网关连不上上游时常回 502 + `connect failed`，那是网络问题，不是对方服务端挂了。
- **执行环境决定结论，而且两个方向都会失真**。首轮实测：本机（境内网络）有 4 家「未连通」（OpenAI / Gemini / xAI / Mistral），而 GitHub 海外 runner 一家都没断路、17 家回 401——所以「未连通」说的是这台机器到不了，不是平台挂了。页面里把执行环境标出来，就是为了让人知道该信哪一半。

想加 key 让探活变成真验证：仓库 Settings → Secrets and variables → Actions，按 `probe/endpoints.json` 里的 `env` 字段建同名 secret（如 `ZHIPUAI_API_KEY`）。没建的会按「无 key」处理，不会报错。


## 测试

```bash
cd quota-hub
node test-route.js       # 路由分配不变量
node test-pipeline.js    # 编排：模板 × 规模 × 模式全组合
node test-export.js      # 导出脚本语法与要素
node test-orch.js        # 总控 121 项断言
node test-access.js      # 网关配置：真实 YAML 解析 + Python 编译（32 项）
node test-verify.js      # 接入核验 28 项：含「核验表 base 与端点表逐字一致」
node test-usage.js       # 用量登记纯函数 48 项（解析 1.5万/200k、跨天归零、脏数据净化）
node test-palette.js     # 全局跳转 14 项：含「kimi 不能拖出 DeepSeek」假阳性回归
node test-walletio.js    # 备份导入 22 项：坏输入全拒、脏字段清洗、合并语义
node test-schedule.js    # 重置日程 20 项：分桶、不编造日期、0 点倒计时边界
node test-onboard.js     # 接入向导 21 项：推荐矩阵 + 生成的脚本过 bash -n 与 PS 解析器
node test-probe.js       # 探活卡片 22 项：时间表述、状态排序、XSS 转义、短名、file:// 不发请求
python test-probe.py     # 探活脚本 27 项：分类语义、密钥不泄露、本地假服务器真实往返
node smoke/run.js        # 浏览器冒烟 148 项 × 4 场景（1440 / 360 / 脏存储 / __proto__ 污染）
```

`test-probe.py` 用本地 `http.server` 造 200/401/404/500/超时五种端点，所以不需要外网、不碰任何真平台的账号。其中一条断言是：错误响应体里回显了 key 时必须被 `[redacted]` 掉。

`smoke/run.js` 用 Edge 无头把产物真正跑起来，只做 DOM 交互（点按钮、敲键盘、派发事件），不调用内部函数——所以它测的是用户实际会遇到的东西。它也会跑「脏 localStorage」和 `__proto__` 污染两种异常数据，确认页面照常渲染。

`test-verify.js` 里最有用的一条断言：核验表里的 `base_url` 必须与端点表 `PIPE_BASE` 完全一致 —— 防止只改一处。

`test-usage.js` 直接 `require` 真实的 `assets/usage.js`，而不是把逻辑抄一份 —— 抄一份的测试，代码改了它不会红。

## 目录结构

```
AI-Agent免费额度调度中台.html   构建产物（单文件）
AI-Agent免费额度调研报告.md      11 章调研报告
GitHub同类项目调研.md            11 个同类项目的定位与能力矩阵
probe.json                      自动探活结果（Actions 每 6 小时更新）
.github/workflows/pages.yml     push 后自动发布到 GitHub Pages
.github/workflows/probe.yml     每 6 小时探活并提交 probe.json
docs/screenshot-overview.png    README 用的界面截图
quota-hub/
  build.py                 注入式构建
  test-*.js / test-probe.py 13 个测试文件
  probe/
    gen_endpoints.js       从 verify.js 抽端点清单（--check 校验漂移）
    endpoints.json         生成的端点清单，别手改
    probe.py               探活脚本（stdlib，无依赖）
  smoke/
    harness.js             注入页面的冒烟脚本
    run.js                 无头浏览器执行器（4 场景）
    shot.js                指定视图截图（node shot.js verify out.png probe-body）
  assets/
    data.js                48 个平台的额度数据
    app.js                 主逻辑与视图框架
    template.html          页面骨架
    style.css              样式
    pipeline.js            项目编排（交接卡 / 产能 / 导出）
    capability.js          12 模型 × 9 维能力画像
    orchestrator.js        总控调度舱
    access.js              接入通道与网关配置
    verify.js              接入核验（23 家，端点表是探活的真相源）
    probe.js               探活结果卡片
    usage.js               用量登记纯函数（解析 / 余量 / 跨天归零）
    walletio.js            备份导出/导入与校验
    schedule.js            重置日程分桶
    onboard.js             接入向导与配置脚本生成
    palette.js             Ctrl+K 全局跳转
```

## 关于数据准确性

- 额度与接入字段全部对着**官方文档**核对，每个条目都记录核实日期与出处链接。
- 存在互相冲突的二手说法时，标为「口径冲突 / 免费存疑」，而不是二选一硬写 —— 这类必须去控制台确认。
- 数据截至 **2026-10-20**（接入字段复核于 2026-10-21）。免费政策变动频繁，超过 1 个月请重新核实。
- 需要跑一遍才算数的，用「接入核验」页导出的 `verify_all.py`：默认 `GET /models`，不消耗 token 与请求次数。
- **探活会当场推翻表里的说法**，这是它最有用的时候。2026-10-25 首轮探活就抓到一条：商汤的 `https://api.sensenova.cn/v1` 请求 `/models` 返回 404，而 `compatible-mode/v1` 返回 401（存在）。经 `POST` 复核，`/v1/chat/completions` 是 404、`compatible-mode/v1/chat/completions` 是 401 —— 老教程抄的那个 `/v1` 根本打不通，现已更正，并把结论写进该条目的「口径冲突」。

## License

MIT
