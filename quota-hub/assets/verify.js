/* ============================================================
   接入核验（Access Verification）
   ------------------------------------------------------------
   解决的问题：额度表再准，接不通也是零。
   本轮调研里同一个厂商的 base_url 出现了 2~3 个互相冲突的
   版本（MiniMax / 讯飞 / Kimi / LongCat 全部中招），
   而且大量教程里的 model id 已经被官方退役。
   所以这里只做两件事：
     1) 给出「以官方文档为准」的接入硬事实 + 出处 + 核实日期
     2) 导出一个能自己跑的自检脚本，让对错由你自己的 key 说了算
   数据截止：2026-10-20
   ============================================================ */

/* 免费额度状态 —— 不是额度大小，是「能不能免费拿到 API」这件事的确信度 */
const FREE_STATE = {
  yes:      { label: '有免费档', cls: 'green',  desc: '官方存在可长期使用的免费 API 档' },
  limited:  { label: '仅试用金', cls: 'amber',  desc: '一次性赠送额度，用完转付费，不能当产能' },
  no:       { label: '无免费 API', cls: 'red', desc: '网页端可能免费，但 API 必须付费' },
  disputed: { label: '免费存疑', cls: 'red',  desc: '多个来源给出互相矛盾的说法，必须以控制台为准' }
};

/* ------------------------------------------------------------
   主流模型接入总表
   ------------------------------------------------------------
   base     = OpenAI 兼容端点（脚本里填的这个）
   alt      = 该厂的其他协议端点（Anthropic 兼容 / 区域端点等）
   env      = 环境变量名（脚本从这里读 key）
   models   = 当前可用模型 id 示例（务必对着控制台填，这里只是格式示范）
   retired  = 已退役 / 会直接报错的老 id —— 这是最容易踩的坑
   probe    = 自检脚本用哪种探测方式：models(GET /models，不耗额度) / chat(POST 最小请求)
   ------------------------------------------------------------ */
const VENDOR_ACCESS = [
  /* ================= 一线：使用量最大，必须保证准确 ================= */
  {
    id: 'openai', name: 'OpenAI (GPT)', vendor: 'OpenAI', region: 'global', tier: 1,
    console: 'https://platform.openai.com/api-keys',
    base: 'https://api.openai.com/v1',
    alt: [],
    env: 'OPENAI_API_KEY', keyPrefix: 'sk- / sk-proj-',
    models: ['gpt-5.6', 'gpt-5.6-mini', 'gpt-5.6-nano'],
    retired: ['gpt-4-turbo', 'gpt-3.5-turbo（老教程常写，已下线）'],
    probe: 'models',
    free: 'disputed',
    freeText: '三种说法互相矛盾：① 新户 $5 试用金（3 个月过期）② 2026 年起无免费额度，从第一笔请求起付费 ③ 无常设额度，但可 opt-in 数据共享换每日免费 token（约 1M/天）',
    verifyDate: '2026-10-20',
    src: 'https://platform.openai.com/docs/overview',
    srcName: 'OpenAI 官方文档',
    conflict: '⚠ 是否仍发 $5 注册赠送：llmpricewatch（2026-07）称「无免费 API 额度」，admix/getaiperks 称「$5 试用金」。两方都自称核对过官方页。',
    pitfall: '项目级 key（sk-proj-）与用户级 key 的可用模型范围不同；组织下多项目要带 org id。',
    note: '网页端 chatgpt.com 纯文本已从 2026-08-10 起不限量，但那不是 API。要脚本化就只有付费这一条路。'
  },
  {
    id: 'anthropic', name: 'Anthropic (Claude)', vendor: 'Anthropic', region: 'global', tier: 1,
    console: 'https://console.anthropic.com/settings/keys',
    base: 'https://api.anthropic.com/v1',
    alt: [{ url: 'https://api.anthropic.com/v1/messages', note: '原生 Messages 端点（不是 OpenAI 格式）' }],
    env: 'ANTHROPIC_API_KEY', keyPrefix: 'sk-ant-',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    retired: ['claude-3-5-sonnet-20241022（老教程高频出现，需查是否仍在线）'],
    probe: 'anthropic',
    free: 'limited',
    freeText: '注册后约 $5 试用金（一次性，约 1 个月过期），需手机号短信验证；无长期免费速率档',
    verifyDate: '2026-10-20',
    src: 'https://docs.anthropic.com/en/api/overview',
    srcName: 'Anthropic 官方文档',
    conflict: null,
    pitfall: '⚠ 不是 OpenAI 兼容格式。除 Authorization 头外还必须带 x-api-key 与 anthropic-version: 2023-06-01。用 LiteLLM 时 provider 名写 anthropic/，不要当 OpenAI 端点填 api_base。',
    note: 'Claude Code / Cline 这类工具可以直接吃它，但要走 Anthropic 协议那一侧。'
  },
  {
    id: 'gemini', name: 'Google Gemini', vendor: 'Google', region: 'global', tier: 1,
    console: 'https://aistudio.google.com/apikey',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    alt: [{ url: 'https://generativelanguage.googleapis.com/v1beta', note: '原生端点，配合 google-genai SDK 用' }],
    env: 'GEMINI_API_KEY', keyPrefix: 'AIza',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemma-4-31b-it'],
    retired: ['gemini-pro / gemini-1.0-pro（早期教程写法，已下线）'],
    probe: 'models',
    free: 'yes',
    freeText: '官方定价页确认存在免费层级：Flash / Flash-Lite 免费，Pro 在免费层被严格限制（约 50 RPD）。无需信用卡。',
    verifyDate: '2026-10-20',
    src: 'https://ai.google.dev/gemini-api/docs/pricing',
    srcName: 'Google 官方定价页（原文含「免费层级」列）',
    conflict: '⚠ 日请求数出现 1500 / 500 / 250 / 20 四个互相冲突的数字。Google 已不再公布统一限速表，唯一可靠做法是查 aistudio.google.com/rate-limit 或读响应头 x-ratelimit-*。',
    pitfall: '官方定价页明写：免费层数据「用于改进 Google 产品」= 是，付费层 = 否。涉密研报、未公开财报不要喂免费层。Grounding with Google Search 在免费层不可用（付费层每月 5000 次免费）。',
    note: '1M 上下文 + 原生多模态，且不要求信用卡——它是唯一能长期白用的大厂一线 API。'
  },
  {
    id: 'deepseek', name: 'DeepSeek', vendor: '深度求索', region: 'cn', tier: 1,
    console: 'https://platform.deepseek.com/api_keys',
    base: 'https://api.deepseek.com/v1',
    alt: [],
    env: 'DEEPSEEK_API_KEY', keyPrefix: 'sk-',
    models: ['deepseek-flash', 'deepseek-flash-v4.1'],
    retired: ['deepseek-chat', 'deepseek-reasoner（2026-07-24 退役）', 'deepseek-v4-pro（2026-09-14 起请求被路由到 V4.1-Flash）'],
    probe: 'models',
    free: 'limited',
    freeText: '网页版 chat.deepseek.com 免费；API 侧为注册赠送（口径 $5 或 ¥500 不一），30 天有效，无永久免费档',
    verifyDate: '2026-10-20',
    src: 'https://api-docs.deepseek.com/',
    srcName: 'DeepSeek 官方 API 文档',
    conflict: '⚠ 赠送额度口径：$5（≈500 万 token）与 ¥500 两种说法并存。以控制台余额为准。',
    pitfall: '⚠ 全网教程里的 deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役；V4-Pro 自 2026-09-14 起自动路由到 V4.1-Flash。老脚本不报错但会静默换模型，是「结果对不上」的常见来源。',
    note: '错峰优惠：北京时间 00:30–08:30 输入输出 5 折；缓存命中再打一折。这两项叠加后成本可以低到忽略。'
  },
  {
    id: 'bailian', name: '阿里云百炼（Qwen）', vendor: '阿里巴巴', region: 'cn', tier: 1,
    console: 'https://bailian.console.aliyun.com',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    alt: [{ url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', note: '国际站（新加坡），账号与额度不通用' }],
    env: 'DASHSCOPE_API_KEY', keyPrefix: 'sk-',
    models: ['qwen-plus', 'qwen-max', 'qwen-flash'],
    retired: ['qwen-max-2025-01-25 这类带日期的快照 model id（DashScope 快照随版本下线，官方建议用不带日期的稳定名）'],
    probe: 'models',
    free: 'limited',
    freeText: '每个模型各 100 万 token，覆盖 70+ 模型，有效期 90 天；不抵扣 Batch / 模型调优 / 部署',
    verifyDate: '2026-10-20',
    src: 'https://bailian.console.aliyun.com',
    srcName: '百炼控制台（官方文档口径）',
    conflict: '⚠ 总额口径：官方表述为「每模型 100 万 × 70+ 模型」，第三方文章写作「5000 万」或「7000 万+」。',
    pitfall: '⚠ 免费额度仅限华北 2（北京）地域。用错地域不报错，直接按原价计费——这是最贵的坑。',
    note: '模型货架最全，适合做横向选型评测。当「一次性评测预算」用，别当长期产能。'
  },
  {
    id: 'volc', name: '火山方舟（豆包）', vendor: '字节跳动', region: 'cn', tier: 1,
    console: 'https://console.volcengine.com/ark',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    alt: [],
    env: 'ARK_API_KEY', keyPrefix: '（控制台生成的长串）',
    models: ['doubao-seed-2-1-pro-260628', 'ep-xxxxxxxx-xxxxx（接入点 ID）'],
    retired: ['doubao-pro-32k（老教程高频写法，需查是否仍可开）'],
    probe: 'models',
    free: 'yes',
    freeText: '安心体验：每模型 50 万 token（一次性）；协作奖励计划：每日 200 万 token（个人）/ 500 万（企业认证），按天重置',
    verifyDate: '2026-10-20',
    src: 'https://console.volcengine.com/ark',
    srcName: '火山方舟控制台活动页',
    conflict: '⚠ 另有官方活动页称 Doubao-Seed-2.1-pro「每日最高 500 万 token」（2026 年 Q3 起的常态化申领）。与「协作奖励计划 200 万/日」并存，需看控制台实际生效规则。',
    pitfall: '⚠ 必须在控制台先「开通」目标模型，否则有 key 也返回 404。model 字段可以填接入点 ID（ep- 开头），这是方舟特有的，和别家不一样。',
    note: '国内唯一「大额度 + 按天重置」的组合，是每日定时任务的主力。'
  },
  {
    id: 'moonshot', name: 'Kimi（月之暗面）', vendor: '月之暗面', region: 'cn', tier: 1,
    console: 'https://platform.moonshot.cn',
    base: 'https://api.moonshot.cn/v1',
    alt: [{ url: 'https://api.moonshot.cn/anthropic', note: 'Anthropic Messages 兼容端点，Claude Code 可直接接' }],
    env: 'MOONSHOT_API_KEY', keyPrefix: 'sk-',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
    retired: ['kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k（2026-08-31 16:00 退役，现返回 404）'],
    probe: 'models',
    free: 'no',
    freeText: 'API 侧无免费档，预付费最低 $1 起；Tier 0 限额 1 并发 / 3 RPM / 1.5M TPD。网页与 App 免费不限。',
    verifyDate: '2026-10-20',
    src: 'https://platform.moonshot.cn/docs/api/',
    srcName: 'Kimi 官方 API 概述页',
    conflict: '⚠ 域名冲突：官方文档写 api.moonshot.cn，多个二手教程写 api.moonshot.ai。以官方为准。',
    pitfall: '⚠ Kimi Code 与 Kimi 会员发放的 key 不能用于开放平台 API；k3 需充值 $1 才解锁。Anthropic 端点下模型别名写 kimi-k3[1m]。',
    note: '1M 上下文是国产最长。想免费拿 K3，走商汤 SenseNova 或魔搭的免费额度更划算。'
  },
  {
    id: 'zhipu', name: '智谱 GLM', vendor: '智谱华章', region: 'cn', tier: 1,
    console: 'https://open.bigmodel.cn/usercenter/apikeys',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    alt: [{ url: 'https://open.bigmodel.cn/api/anthropic', note: 'Anthropic 兼容端点' }],
    env: 'ZHIPUAI_API_KEY', keyPrefix: '（zhipu 控制台生成，id.secret 形式）',
    models: ['glm-4.7-flash', 'glm-4.6v-flash', 'glm-4.5-air'],
    retired: ['glm-4-flash（老教程常写，需查是否仍在免费清单）'],
    probe: 'models',
    free: 'yes',
    freeText: '官方标注免费：GLM-4.7-Flash(200K) / GLM-4.6V-Flash(视觉) / GLM-4.1V-Thinking-Flash / GLM-4V-Flash / CogView-3-Flash(生图) / CogVideoX-Flash(生视频)',
    verifyDate: '2026-10-20',
    src: 'https://open.bigmodel.cn/pricing',
    srcName: 'BigModel 官方定价页',
    conflict: '⚠ 免费档并发：freellm 实测为「1 并发」，国内多篇攻略写「30 并发」。新户礼包口径也有 1 亿 / 2000 万 / 100 万三种说法。',
    pitfall: '免费模型清单会随版本更迭调整（GLM-4.5-Flash 已标注即将下线）。上生产前先对着官方定价页的「免费」标签核一遍。',
    note: '国内最稳的长期免费基本盘，且是少数连生图/生视频都给免费的。'
  },
  {
    id: 'minimax', name: 'MiniMax', vendor: 'MiniMax（稀宇）', region: 'cn', tier: 1,
    console: 'https://platform.minimaxi.com',
    base: 'https://api.minimaxi.com/v1',
    alt: [
      { url: 'https://api.minimax.io/v1', note: '国际版；与国内版账号体系、key、额度完全不通用' },
      { url: 'https://api.minimax.chat/v1', note: '老端点，部分老教程仍在用' }
    ],
    env: 'MINIMAX_API_KEY', keyPrefix: 'eyJh…（JWT 形式）',
    models: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-VL-01'],
    retired: ['abab6.5s-chat（老系列）'],
    probe: 'chat',
    free: 'limited',
    freeText: '注册赠送约 ¥15 体验额度；M2 发布期曾限时免费（2025-11-07 08:00 结束）。海螺 AI 网页版免费。',
    verifyDate: '2026-10-20',
    src: 'https://platform.minimaxi.com/document',
    srcName: 'MiniMax 开放平台文档中心',
    conflict: '⚠ 三个端点并存：api.minimaxi.com/v1（国内现行）、api.minimax.io/v1（国际）、api.minimax.chat/v1（老）。另有教程写 api.minimax.chat/v1/openai。必须对着自己控制台的域名确认。',
    pitfall: '⚠ 国内版与国际版是两个独立账号体系，key 互不相认。注册时选错站点，后面全白配。',
    note: 'M2 系列在 OpenRouter 编程调用量一度登顶，能力在线；但免费额度很薄，适合当「第二梯队备胎」。'
  },
  {
    id: 'xai', name: 'xAI (Grok)', vendor: 'xAI', region: 'global', tier: 1,
    console: 'https://console.x.ai',
    base: 'https://api.x.ai/v1',
    alt: [
      { url: 'https://api.x.ai/v1/responses', note: '主推的 Responses API' },
      { url: 'https://us.api.x.ai/v1', note: '美国区域端点，1.1× 价格，仅服务 grok-4.7 / grok-4.6' }
    ],
    env: 'XAI_API_KEY', keyPrefix: 'xai-',
    models: ['grok-4.7', 'grok-4.6', 'grok-4.1-fast'],
    retired: ['/v1/messages 与 /v1/complete（Anthropic 兼容端点已标记 deprecated）、/v1/completions'],
    probe: 'models',
    free: 'disputed',
    freeText: '多源称：注册 $25 赠送（30 天过期，不结转）+ 数据共享计划 $150/月（不可撤销，需先消费 $5，仅团队管理员可开启）',
    verifyDate: '2026-10-20',
    src: 'https://docs.x.ai/',
    srcName: 'xAI 官方文档',
    conflict: '⚠ grokmag（2026-09）称「官方 quickstart / billing / pricing 页面未列出任何免费或注册赠送额度」，企业 FAQ 仅表示「可能提供」免费额度以换取数据训练权。与「$25 注册赠送」的说法直接冲突。',
    pitfall: '⚠ 数据共享计划一旦开启不可撤销，且 only team admin。正解是建两个 team：一个开数据共享跑非敏感任务，另一个不开。另外建议每次请求带 prompt_cache_key，否则可能落到冷缓存服务器按全价计费。',
    note: '若 $25 属实，它是「美元金额」上最慷慨的注册赠送；但前提是你接受 30 天过期且可能需要绑卡。'
  },

  /* ================= 二线：特定场景使用量大 ================= */
  {
    id: 'hunyuan', name: '腾讯混元', vendor: '腾讯', region: 'cn', tier: 2,
    console: 'https://console.cloud.tencent.com/hunyuan',
    base: 'https://api.hunyuan.cloud.tencent.com/v1',
    alt: [],
    env: 'HUNYUAN_API_KEY', keyPrefix: 'sk-',
    models: ['hunyuan-turbos', 'hunyuan-t1', 'hunyuan-large'],
    retired: [],
    probe: 'models',
    free: 'limited',
    freeText: '语言 / 多模态各 100 万 token，有效期 1 年（同类里最长）；Embedding 另赠 100 万',
    verifyDate: '2026-10-20',
    src: 'https://cloud.tencent.com/document/product/1729',
    srcName: '腾讯云混元文档',
    conflict: null,
    pitfall: '通用资源包在多模型间共享额度，不是每个模型各 100 万——和百炼的规则不一样，别照搬。',
    note: '有效期 1 年是最大优势，适合「不知道什么时候要用」的兜底场景。'
  },
  {
    id: 'qianfan', name: '百度千帆（文心）', vendor: '百度', region: 'cn', tier: 2,
    console: 'https://qianfan.cloud.baidu.com',
    base: 'https://qianfan.baidubce.com/v2',
    alt: [],
    env: 'QIANFAN_API_KEY', keyPrefix: 'bce-v3/…',
    models: ['ernie-4.5-turbo', 'ernie-speed-8k', 'ernie-4.0'],
    retired: ['ernie-3.5-8k（老端点写法）'],
    probe: 'models',
    free: 'yes',
    freeText: 'ERNIE-Speed-8K 永久免费（QPS 50，国内免费档最高）；ERNIE-4.5 系列每模型约 100 万 token（约 3 个月）',
    verifyDate: '2026-10-20',
    src: 'https://qianfan.cloud.baidu.com',
    srcName: '千帆控制台',
    conflict: null,
    pitfall: '⚠ v2 端点用 API Key 鉴权；老的 v1 端点用 access_token（需 AK/SK 换）。两者鉴权方式不同，混用会一直 401。',
    note: '要跑几千条批量任务，ERNIE-Speed 的 50 QPS 是国内免费档里唯一扛得住的。'
  },
  {
    id: 'spark', name: '讯飞星火', vendor: '科大讯飞', region: 'cn', tier: 2,
    console: 'https://console.xfyun.cn/services/bmx1',
    base: 'https://spark-api-open.xf-yun.com/v1',
    alt: [{ url: 'https://spark-api-open.xf-yun.com/v2', note: '另有来源给出的 v2 路径，需自行验证' }],
    env: 'SPARK_API_KEY', keyPrefix: '（控制台的 APIPassword）',
    models: ['4.0Ultra', 'x1', 'lite'],
    retired: ['v1/v2/v3.5 旧版 WebSocket 协议（需 APPID+APIKey+APISecret 签名）'],
    probe: 'chat',
    free: 'limited',
    freeText: '新用户约 200 万 token；Spark Lite 免费使用，5 RPM',
    verifyDate: '2026-10-20',
    src: 'https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html',
    srcName: '讯飞星火 HTTP 调用文档',
    conflict: '⚠ 路径冲突：多个教程写 /v1，官方文档示例出现 /v2/chat/completions。两版都试一遍再定。',
    pitfall: '⚠ 最大的坑不是端点而是入口：讯飞控制台里星火大模型与语音识别 / OCR / 语音合成混在一起。在语音类应用下申请的 key 调不通 Spark Chat，会一直鉴权失败，排查半天才发现入口找错了。要认准「星火认知大模型」这个产品。',
    note: '语音/方言场景是它的独门优势；纯文本任务国产里有更省事的选择。'
  },
  {
    id: 'mistral', name: 'Mistral AI', vendor: 'Mistral AI', region: 'global', tier: 2,
    console: 'https://console.mistral.ai/api-keys',
    base: 'https://api.mistral.ai/v1',
    alt: [],
    env: 'MISTRAL_API_KEY', keyPrefix: '（32 位字符串）',
    models: ['mistral-large-latest', 'codestral-latest', 'ministral-8b-latest'],
    retired: ['mistral-tiny / mistral-small 旧命名'],
    probe: 'models',
    free: 'yes',
    freeText: 'Free Experiment 计划：无总量上限，仅速率限制（口径一：2 RPM / 500K TPM / 10 亿 token 每月；口径二：1 RPS / 30 RPM）',
    verifyDate: '2026-10-20',
    src: 'https://docs.mistral.ai/deployment/laplateforme/overview',
    srcName: 'Mistral La Plateforme 文档',
    conflict: '⚠ 速率口径两套数字并存。「无总量上限」这一点各家一致，速率具体多少以控制台为准。',
    pitfall: '需手机号验证。欧洲数据合规友好，英文场景明显强于中文。',
    note: '「无总量上限」在小流量长期跑的场景很值钱，代价是要忍受低速率。'
  },
  {
    id: 'llama', name: 'Meta Llama', vendor: 'Meta（无官方 API）', region: 'global', tier: 2,
    console: '（无官方 API，走第三方推理商）',
    base: null,
    alt: [
      { url: 'https://api.groq.com/openai/v1', note: 'Groq —— 速度最快' },
      { url: 'https://api.cerebras.ai/v1', note: 'Cerebras —— 吞吐最高' },
      { url: 'https://api.together.xyz/v1', note: 'Together —— 模型最全' },
      { url: 'https://openrouter.ai/api/v1', note: 'OpenRouter —— 一个 key 全调' }
    ],
    env: '（取决于所选推理商）', keyPrefix: '—',
    models: ['llama-4-scout', 'llama-4-maverick', 'gpt-oss-120b（Groq 免费档）'],
    retired: ['llama-3.3-70b-versatile / llama-3.1-8b-instant（Groq 免费档 2026-08-16 转 Enterprise）'],
    probe: 'models',
    free: 'yes',
    freeText: 'Meta 不提供官方 API，免费额度全部来自第三方推理商：Groq 30 RPM / 1000 RPD / 8K TPM / 200K TPD；Cerebras 与 Together 为 fair use',
    verifyDate: '2026-10-20',
    src: 'https://console.groq.com/settings/limits',
    srcName: 'Groq 官方限额页',
    conflict: null,
    pitfall: '⚠ Groq 上 Llama 全系已于 2026-08-16 转 Enterprise，免费档只剩 gpt-oss 与 qwen3.8-27b。全网 Groq 教程的 model 名集体失效。',
    note: '「Llama 免费」这句话本身是错的——免费的是推理商的额度，不是 Meta 给的。'
  },
  {
    id: 'sensenova', name: '商汤 SenseNova', vendor: '商汤科技', region: 'cn', tier: 2,
    console: 'https://platform.sensenova.cn',
    base: 'https://api.sensenova.cn/v1',
    alt: [{ url: 'https://token.sensenova.cn/v1', note: '另有来源给出的端点，需验证' }],
    env: 'SENSENOVA_API_KEY', keyPrefix: 'sk-',
    models: ['SenseNova-V6-Turbo', 'Kimi-K3', 'DeepSeek-V4-Pro', 'GLM-5.2'],
    retired: [],
    probe: 'models',
    free: 'limited',
    freeText: 'Free 档 ¥0/月：滚动 5 小时 60,000 积分 + 滚动周 600,000 积分；公测期可直接调 Kimi K3 / DeepSeek V4 Pro / GLM-5.2 等旗舰',
    verifyDate: '2026-10-20',
    src: 'https://platform.sensenova.cn',
    srcName: 'SenseNova 控制台',
    conflict: '⚠ 端点两个版本并存，且官方处于公测期，规则可能随时调整。',
    pitfall: '⚠ 积分制不是 token 制，实际能跑多少要自己测。Flash-Lite 走专属积分池，规则不同。',
    note: '当前唯一能免费用到三家国产旗舰的入口，价值最高，但也是变动风险最大的一个。'
  },
  {
    id: 'longcat', name: '美团 LongCat', vendor: '美团', region: 'cn', tier: 2,
    console: 'https://longcat.chat/platform/',
    base: 'https://api.longcat.chat/openai/v1',
    alt: [{ url: 'https://api.longcat.chat/openai', note: '二手教程常写的版本（缺 /v1），需自行验证' }],
    env: 'LONGCAT_API_KEY', keyPrefix: 'sk-',
    models: ['longcat-flash-lite', 'longcat-flash-chat', 'longcat-flash-thinking'],
    retired: [],
    probe: 'models',
    free: 'disputed',
    freeText: '口径一：新户实名赠 1000 万 token，30 天有效（缓存命中不计消耗）；口径二：LongCat-Flash-Lite 独享 5000 万/日 + 三款共享 500 万/日',
    verifyDate: '2026-10-20',
    src: 'https://longcat.chat/platform/',
    srcName: 'LongCat 开放平台',
    conflict: '⚠ 「一次性 1000 万」与「每日 5500 万」是两个完全不同的量级，来源均为二手且差距过大。必须以控制台实际额度为准。',
    pitfall: '路径有 /openai 与 /openai/v1 两种写法，先用自检脚本确认哪个通。',
    note: '若「每日 5500 万」属实，它是全网最大的单日免费额度；但这个数字来自营销类文章，可信度低。'
  },

  /* ================= 聚合 / 推理商：脚本化最常用 ================= */
  {
    id: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter', region: 'global', tier: 3,
    console: 'https://openrouter.ai/keys',
    base: 'https://openrouter.ai/api/v1',
    alt: [],
    env: 'OPENROUTER_API_KEY', keyPrefix: 'sk-or-v1-',
    models: ['openrouter/free', '（具体 :free 模型 id 每月在变）'],
    retired: ['deepseek/… / google/gemini-… / mistralai/… 的 :free 端点（2026-10-05 后已无）'],
    probe: 'models',
    free: 'yes',
    freeText: '17 个 :free 模型；50 RPD（累计充值 <$10）→ 1000 RPD（累计充值 ≥$10，永久生效）；固定 20 RPM',
    verifyDate: '2026-10-20',
    src: 'https://openrouter.ai/docs/api-reference/limits',
    srcName: 'OpenRouter 官方 API 文档（限额部分）',
    conflict: null,
    pitfall: '⚠ 免费名单每月在变（7 月 27 个 → 10 月 17 个），老文章里的 :free id 会直接报错。余额为负返回 402。',
    note: '充值 $10 一次，日限从 50 提到 1000（20 倍）——全网性价比最高的「解锁」动作。'
  },
  {
    id: 'groq', name: 'Groq', vendor: 'Groq', region: 'global', tier: 3,
    console: 'https://console.groq.com/keys',
    base: 'https://api.groq.com/openai/v1',
    alt: [],
    env: 'GROQ_API_KEY', keyPrefix: 'gsk_',
    models: ['gpt-oss-120b', 'gpt-oss-20b', 'qwen3.8-27b'],
    retired: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it（2026-08-16 转 Enterprise）'],
    probe: 'models',
    free: 'yes',
    freeText: '30 RPM / 1000 RPD / 8K TPM / 200K TPD（按组织计，不计 key）；缓存命中的 prompt 不计入限速',
    verifyDate: '2026-10-20',
    src: 'https://console.groq.com/settings/limits',
    srcName: 'Groq 官方限额页',
    conflict: null,
    pitfall: '8K TPM 通常比 1000 RPD 先撞墙——长 prompt 一次就吃掉一分钟预算。多开 key 不增加额度。',
    note: '输出 500~1100 tok/s，实时对话与语音场景首选。'
  },
  {
    id: 'siliconflow', name: '硅基流动', vendor: '硅基流动', region: 'cn', tier: 3,
    console: 'https://cloud.siliconflow.cn',
    base: 'https://api.siliconflow.cn/v1',
    alt: [],
    env: 'SILICONFLOW_API_KEY', keyPrefix: 'sk-',
    models: ['Qwen/Qwen3-8B', 'deepseek-ai/DeepSeek-V3.2'],
    retired: ['「9B 以下永久免费」政策（2026-10 起已取消）'],
    probe: 'models',
    free: 'limited',
    freeText: '新户约 ¥16 代金券；现仅 embedding / 语音 / OCR / 翻译 / Kolors 图生图免费，Chat 模型按量计费',
    verifyDate: '2026-10-20',
    src: 'https://docs.siliconflow.cn/',
    srcName: '硅基流动官方文档',
    conflict: '⚠ 「送 2000 万 token + 小模型永久免费」的说法仍在大量 2026 年中的文章里流传，但 2026-10 核查显示该政策已取消。',
    pitfall: '⚠ 别按老文章规划产能。一个 key 调 100+ 模型这点仍然成立，只是要付费。',
    note: '国内延迟常 <100ms，是拿开源模型做批量任务最省事的路子。'
  },
  {
    id: 'github-models', name: 'GitHub Models', vendor: 'GitHub', region: 'global', tier: 3,
    console: 'https://github.com/settings/tokens',
    base: 'https://models.github.ai/inference',
    alt: [],
    env: 'GITHUB_TOKEN', keyPrefix: 'ghp_ / github_pat_',
    models: ['openai/gpt-4o-mini', 'meta/Llama-4-Scout-17B-16E-Instruct'],
    retired: [],
    probe: 'models',
    free: 'limited',
    freeText: '有 GitHub 账号即可；每天约 50~150 次请求（按模型档位不同），定位是实验/调试',
    verifyDate: '2026-10-20',
    src: 'https://docs.github.com/en/github-models',
    srcName: 'GitHub Models 文档',
    conflict: '⚠ 日请求数区间 50~150，各家攻略说法不一。',
    pitfall: 'PAT 需要正确 scope；组织可能禁用 Models 访问。',
    note: '零门槛调试渠道，别当主力产能。'
  },
  {
    id: 'together', name: 'Together AI', vendor: 'Together AI', region: 'global', tier: 3,
    console: 'https://api.together.ai/settings/api-keys',
    base: 'https://api.together.xyz/v1',
    alt: [],
    env: 'TOGETHER_API_KEY', keyPrefix: '（64 位字符串）',
    models: ['（开源模型，fair use 名单会变动）'],
    retired: ['曾有的 $25 注册赠送（2025 年已退休）'],
    probe: 'models',
    free: 'limited',
    freeText: '部分开源模型 fair use 免费；新户一次性 $1~$5（口径不一，早期 $25 已取消）',
    verifyDate: '2026-10-20',
    src: 'https://docs.together.ai/docs/introduction',
    srcName: 'Together 官方文档',
    conflict: '⚠ 注册赠送：$1（publicapis，2026 中）与 $5（getaiperks）两种口径。',
    pitfall: 'fair use 意味着忙时会被动态限流，不能当稳定产能。',
    note: '适合当「旗舰模型备用通道」，主力额度用完时的第二梯队。'
  },
  {
    id: 'cerebras', name: 'Cerebras', vendor: 'Cerebras', region: 'global', tier: 3,
    console: 'https://cloud.cerebras.ai',
    base: 'https://api.cerebras.ai/v1',
    alt: [],
    env: 'CEREBRAS_API_KEY', keyPrefix: 'csk-',
    models: ['qwen-3-32b', 'llama-4-scout-17b-16e-instruct', 'gpt-oss-120b'],
    retired: [],
    probe: 'models',
    free: 'yes',
    freeText: '免费层每日约 100 万 token（社区口径，官方页未明确公示完整限速表）',
    verifyDate: '2026-10-20',
    src: 'https://inference-docs.cerebras.ai/',
    srcName: 'Cerebras 推理文档',
    conflict: '⚠ 日额度为社区口径，未在官方页找到明确数字。',
    pitfall: '模型选择少；吞吐高但长上下文支持弱于 Gemini。',
    note: '批量任务（几千条分类/抽取）优先试这里，速度快直接等于省时间。'
  }
];

/* ============================================================
   导出：.env 模板
   ============================================================ */
function buildEnvTemplate() {
  const lines = [
    '# AI 端点自检用环境变量模板',
    '# 生成自「AI Agent 免费额度调度中台」· 数据核对至 ' + DATA_DATE,
    '#',
    '# 用法：',
    '#   1. 复制本文件为 .env，只填你已经开通的那几行（留空的行会被跳过）',
    '#   2. python verify_all.py',
    '#   3. 看输出表格：401 是 key 问题，404 是端点问题，429 是额度/限速问题',
    '#',
    '# 安全提醒：.env 必须加进 .gitignore，不要提交到仓库，不要贴进聊天窗口。',
    ''
  ];

  const byTier = [1, 2, 3];
  const tierName = { 1: '一线：使用量最大', 2: '二线：特定场景常用', 3: '聚合 / 推理商' };

  byTier.forEach(t => {
    const list = VENDOR_ACCESS.filter(v => v.tier === t);
    if (!list.length) return;
    lines.push('# ============ ' + tierName[t] + ' ============');
    list.forEach(v => {
      lines.push('# ' + v.name + ' · ' + v.vendor);
      lines.push('#   控制台：' + v.console);
      if (v.base) lines.push('#   端点：' + v.base);
      if (v.free) {
        const fs = FREE_STATE[v.free];
        lines.push('#   免费状态：[' + fs.label + '] ' + v.freeText);
      }
      if (v.conflict) lines.push('#   ' + v.conflict.replace(/\n/g, ' '));
      lines.push(v.env + '=');
      lines.push('');
    });
  });

  return lines.join('\n');
}

/* ============================================================
   导出：自检脚本
   ============================================================
   探测策略：
     优先 GET /models —— 不消耗任何 token 和 RPD，纯验证「key 有效 + 端点正确」
     失败且平台标记 probe=chat 时才用最小 POST（约 1 token）兜底
   ============================================================ */
function buildVerifyScript() {
  const targets = VENDOR_ACCESS.filter(v => v.base).map(v => ({
    id: v.id,
    name: v.name,
    env: v.env,
    base: v.base,
    probe: v.probe,
    alt: v.alt.map(a => a.url)
  }));

  const payload = JSON.stringify(targets, null, 6).split('\n').map((l, i) => i === 0 ? l : '    ' + l).join('\n');

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 端点连通性自检 —— 由「AI Agent 免费额度调度中台」生成
数据核对至 ${DATA_DATE}

为什么需要它：
  同一家厂商的 base_url 在网上的教程里常有 2~3 个互相冲突的版本，
  且 model id 退役是常态。文档说的不算，跑一遍才算。

用法：
    python verify_all.py                 # 测所有已填 key 的平台
    python verify_all.py --only zhipu,volc,gemini
    python verify_all.py --probe-chat    # 强制用真实请求探测（会消耗极少量 token）
    python verify_all.py --verbose       # 打印响应体前 300 字符

退出码：0 = 全部通过   1 = 至少一个失败

依赖：仅标准库。Python 3.8+
"""

import json
import os
import sys
import ssl
import time
import argparse
import urllib.request
import urllib.error

# ---------------------------------------------------------------
# 目标清单（由中台注入，与页面上的接入总表一一对应）
# ---------------------------------------------------------------
TARGETS = ${payload}

TIMEOUT = 20

# 诊断字典：把 HTTP 状态码翻译成「下一步该干什么」
DIAG = {
    200: ("OK",      "端点与 key 均正常"),
    401: ("KEY",     "key 无效 / 被吊销 / 复制时带上了多余空格"),
    403: ("PERM",    "key 有效但无该模型或该地域权限——去控制台确认已开通模型"),
    404: ("ENDPOINT","端点 URL 写错，或该平台不支持此路径（不是 key 的问题）"),
    422: ("MODEL",   "端点通了，但请求体/model 名不被接受"),
    429: ("RATE",    "配置没问题，是限速或额度耗尽——降低并发或等重置"),
    500: ("SERVER",  "服务端异常，稍后重试"),
    502: ("SERVER",  "网关错误，稍后重试"),
    503: ("SERVER",  "服务不可用，稍后重试"),
    0:   ("NETWORK", "连不上：DNS / 网络 / 需要代理 / 域名已变更"),
}


def load_env_file(path=".env"):
    """极简 .env 解析，只支持 KEY=VALUE 与 # 注释。"""
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            # 环境变量优先，.env 只做兜底
            if k and k not in os.environ:
                os.environ[k] = v


def probe_get_models(base, key, auth_style):
    """GET {base}/models —— 不消耗 token 与 RPD，是首选探测方式。"""
    url = base.rstrip("/") + "/models"
    headers = {"Content-Type": "application/json"}
    if auth_style == "anthropic":
        headers["x-api-key"] = key
        headers["anthropic-version"] = "2023-06-01"
    else:
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(url, headers=headers, method="GET")
    return _send(req)


def probe_post_chat(base, key, auth_style, model_hint):
    """最小 POST 探测。约消耗 1 个 token，会占用一次 RPD。"""
    url = base.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if auth_style == "anthropic":
        headers["x-api-key"] = key
        headers["anthropic-version"] = "2023-06-01"
    else:
        headers["Authorization"] = "Bearer " + key
    body = {
        "model": model_hint or "gpt-4o-mini",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    return _send(req)


def _send(req):
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, body
    except urllib.error.URLError as e:
        return 0, "URLError: %s" % e.reason
    except Exception as e:
        return 0, "%s: %s" % (type(e).__name__, e)


def check_one(t, force_chat=False, verbose=False, hint=""):
    key = os.environ.get(t["env"], "").strip()
    if not key:
        return {"id": t["id"], "name": t["name"], "status": "SKIP", "code": None,
                "diag": "未配置 " + t["env"], "detail": "", "hint": ""}

    auth_style = "anthropic" if t.get("probe") == "anthropic" else "bearer"
    use_chat = force_chat or t.get("probe") == "chat"

    if use_chat:
        code, body = probe_post_chat(t["base"], key, auth_style, hint)
    else:
        code, body = probe_get_models(t["base"], key, auth_style)
        # GET /models 不被支持时，降级为最小 POST（多数平台都支持 chat）
        if code == 404:
            code, body = probe_post_chat(t["base"], key, auth_style, hint)

    status, diag = DIAG.get(code, ("HTTP%d" % code, "未预期的响应码"))
    return {
        "id": t["id"], "name": t["name"], "status": status, "code": code,
        "diag": diag, "detail": body[:300] if verbose else "", "hint": hint,
    }


def main():
    ap = argparse.ArgumentParser(description="AI 端点连通性自检")
    ap.add_argument("--only", default="", help="只测指定平台，逗号分隔，如 zhipu,volc")
    ap.add_argument("--probe-chat", action="store_true", help="强制用真实请求探测（消耗极少量 token）")
    ap.add_argument("--verbose", action="store_true", help="打印响应体前 300 字符")
    ap.add_argument("--env-file", default=".env", help="环境变量文件，默认 .env")
    args = ap.parse_args()

    load_env_file(args.env_file)

    only = [x.strip() for x in args.only.split(",") if x.strip()]
    targets = [t for t in TARGETS if (not only or t["id"] in only)]

    unconfigured = [t for t in targets if not os.environ.get(t["env"], "").strip()]
    todo = [t for t in targets if os.environ.get(t["env"], "").strip()]

    print("")
    print("=" * 74)
    print("  AI 端点连通性自检   共 %d 家 / 已配置 %d 家 / 未配置 %d 家"
          % (len(targets), len(todo), len(unconfigured)))
    print("  探测方式：%s" % ("最小 POST 请求（消耗约 1 token）" if args.probe_chat else "GET /models（不消耗额度）"))
    print("=" * 74)
    print("")

    if not todo:
        print("  没有检测到任何已配置的 key。")
        print("  请先复制 .env 模板填入 key，或直接在环境变量里导出，例如：")
        print("")
        print("    export ZHIPUAI_API_KEY='你的key'")
        print("    python verify_all.py")
        print("")
        return 1

    results = []
    for t in todo:
        sys.stdout.write("  探测 %-14s ... " % t["name"])
        sys.stdout.flush()
        r = check_one(t, force_chat=args.probe_chat, verbose=args.verbose)
        results.append(r)
        print("%s" % r["status"])
        time.sleep(0.2)

    print("")
    print("-" * 74)
    print("  %-18s %-8s %-6s %s" % ("平台", "状态", "码", "诊断"))
    print("-" * 74)
    for r in results:
        print("  %-18s %-8s %-6s %s" % (
            r["name"][:18], r["status"], r["code"] if r["code"] else "-", r["diag"]))
        if r["detail"]:
            print("      %s" % r["detail"].replace("\\n", " ")[:120])
    print("-" * 74)
    print("")

    ok = [r for r in results if r["status"] == "OK"]
    bad = [r for r in results if r["status"] != "OK"]

    # 按错误类型分组给出下一步动作，而不是干巴巴地列一堆失败
    groups = {}
    for r in bad:
        groups.setdefault(r["status"], []).append(r)

    print("  小结：通过 %d / 失败 %d" % (len(ok), len(bad)))
    print("")

    ACTION = {
        "KEY":      "逐个去控制台重新生成 key；注意复制时别带上首尾空格或引号。",
        "PERM":     "去控制台确认：① 该模型是否已「开通」② 地域是否正确（如百炼仅华北 2 有免费额度）。",
        "ENDPOINT": "base_url 写错了。对照控制台的接入文档改；若本平台在页面里标了多个候选端点，逐个试。",
        "MODEL":    "端点通了但 model 名不被接受。用 --probe-chat 并确认 model id 是否已被官方退役。",
        "RATE":     "限速或额度耗尽，配置是对的。降并发，或等下一个重置周期。",
        "SERVER":   "服务端临时故障，稍后重试即可，不要改配置。",
        "NETWORK":  "连不上。检查网络 / 代理；国内平台确认没被防火墙拦，海外平台确认代理已生效。",
    }
    for st in sorted(groups):
        members = ", ".join(r["name"] for r in groups[st])
        print("  [%s] %s" % (st, members))
        if st in ACTION:
            print("        → %s" % ACTION[st])
        print("")

    if ok:
        print("  可用端点：%s" % ", ".join(r["name"] for r in ok))
        print("")

    if unconfigured:
        print("  未配置（跳过）：%s" % ", ".join(t["name"] for t in unconfigured))
        print("")

    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
`;
}

/* ============================================================
   视图：接入核验
   ============================================================ */
const VERIFY_TIER = {
  1: { label: '一线', desc: '使用量最大的主流模型，接入方式必须零出错' },
  2: { label: '二线', desc: '特定场景/区域使用量大' },
  3: { label: '聚合与推理商', desc: '脚本化最常走的一层，一个 key 调多家' }
};

let VERIFY_FILTER = { tier: 'all', free: 'all', q: '' };
/* 紧凑模式：23 家全展开约 1.7 万像素，读起来很累。开启后压缩留白、
   把长段落截到 2 行，但「免费额度 / 易错点 / 口径冲突」三块始终保留可见
   —— 这几块正是判断会不会接错的关键，不能藏。 */
let VERIFY_COMPACT = false;

function verifyMatches(v) {
  const f = VERIFY_FILTER;
  if (f.tier !== 'all' && String(v.tier) !== f.tier) return false;
  if (f.free !== 'all' && v.free !== f.free) return false;
  if (f.q) {
    const hay = (v.name + ' ' + v.vendor + ' ' + v.env + ' ' + (v.base || '') + ' ' +
                 v.models.join(' ') + ' ' + v.retired.join(' ')).toLowerCase();
    if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
  }
  return true;
}

function renderVerify() {
  const all = VENDOR_ACCESS;
  const list = all.filter(verifyMatches);

  /* --- 统计条 --- */
  const nFree = all.filter(v => v.free === 'yes').length;
  const nDisputed = all.filter(v => v.free === 'disputed').length;
  const nConflict = all.filter(v => v.conflict).length;
  const nRetired = all.reduce((a, v) => a + v.retired.length, 0);

  $('#verify-summary').innerHTML = `
    <div class="kpi">
      <div class="k-label">接入总表</div>
      <div class="k-val">${all.length}<small>家</small></div>
      <div class="k-foot">一线 ${all.filter(v => v.tier === 1).length} · 二线 ${all.filter(v => v.tier === 2).length} · 聚合 ${all.filter(v => v.tier === 3).length}</div>
    </div>
    <div class="kpi">
      <div class="k-label">有真免费档</div>
      <div class="k-val k-green">${nFree}<small>家</small></div>
      <div class="k-foot">官方存在长期免费 API，可再生</div>
    </div>
    <div class="kpi">
      <div class="k-label">口径冲突</div>
      <div class="k-val ${nDisputed ? 'k-red' : 'k-green'}">${nDisputed + nConflict}<small>处</small></div>
      <div class="k-foot">${nDisputed} 家免费政策存疑 · ${nConflict} 家接入信息有冲突</div>
    </div>
    <div class="kpi">
      <div class="k-label">已退役 id / 端点</div>
      <div class="k-val k-amber">${nRetired}<small>个</small></div>
      <div class="k-foot">教程里还在写、现在会直接报错的名字</div>
    </div>`;

  /* --- 筛选器 --- */
  $('#verify-filters').innerHTML = `
    <div class="seg-group">
      <button class="seg ${VERIFY_FILTER.tier === 'all' ? 'on' : ''}" data-vt="all">全部</button>
      ${Object.entries(VERIFY_TIER).map(([k, t]) =>
        `<button class="seg ${VERIFY_FILTER.tier === k ? 'on' : ''}" data-vt="${k}">${esc(t.label)}</button>`).join('')}
    </div>
    <div class="seg-group">
      <button class="seg ${VERIFY_FILTER.free === 'all' ? 'on' : ''}" data-vf="all">免费状态不限</button>
      ${Object.entries(FREE_STATE).map(([k, s]) =>
        `<button class="seg ${VERIFY_FILTER.free === k ? 'on' : ''}" data-vf="${k}">${esc(s.label)}</button>`).join('')}
    </div>
    <input class="vsearch" id="verify-q" type="search" placeholder="搜厂商 / 环境变量 / base_url / model id…" value="${esc(VERIFY_FILTER.q)}">
    <button class="seg ${VERIFY_COMPACT ? 'on' : ''}" id="verify-compact" title="压缩留白、长段落截到 2 行；关键警示不隐藏">${VERIFY_COMPACT ? '紧凑视图 · 开' : '紧凑视图'}</button>
    <div class="vcount">匹配 <b>${list.length}</b> / ${all.length}</div>`;

  $$('[data-vt]').forEach(b => b.addEventListener('click', () => {
    VERIFY_FILTER.tier = b.dataset.vt;
    renderVerify();
  }));
  $$('[data-vf]').forEach(b => b.addEventListener('click', () => {
    VERIFY_FILTER.free = b.dataset.vf;
    renderVerify();
  }));
  const qEl = $('#verify-q');
  if (qEl) qEl.addEventListener('input', e => {
    VERIFY_FILTER.q = e.target.value;
    const pos = e.target.selectionStart;
    renderVerify();
    const n = $('#verify-q');
    if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  });
  const cBtn = $('#verify-compact');
  if (cBtn) cBtn.addEventListener('click', () => {
    VERIFY_COMPACT = !VERIFY_COMPACT;
    renderVerify();
  });

  /* 紧凑类挂在列表容器上，空结果时也要生效 */
  const listEl = $('#verify-list');
  if (listEl) listEl.classList.toggle('compact', VERIFY_COMPACT);

  /* --- 主表 --- */
  if (!list.length) {
    $('#verify-list').innerHTML = '<div class="empty-state">没有匹配的平台，换个筛选条件试试。</div>';
    return;
  }

  const byTier = {};
  list.forEach(v => { (byTier[v.tier] = byTier[v.tier] || []).push(v); });

  $('#verify-list').innerHTML = Object.keys(byTier).sort().map(t => {
    const tinfo = VERIFY_TIER[t];
    return `
      <div class="vtier">
        <div class="vtier-head">
          <b>${esc(tinfo.label)}</b>
          <span>${esc(tinfo.desc)}</span>
        </div>
        ${byTier[t].map(v => {
          const fs = FREE_STATE[v.free];
          return `
          <div class="vcard ${v.conflict ? 'has-conflict' : ''}">
            <div class="vcard-head">
              <div class="vcard-id">
                <b>${esc(v.name)}</b>
                <span class="vcard-vendor">${esc(v.vendor)}</span>
              </div>
              <div class="vcard-tags">
                <span class="chip ${v.region === 'cn' ? 'blue' : 'slate'}">${v.region === 'cn' ? '国内' : '海外'}</span>
                <span class="chip ${fs.cls}">${esc(fs.label)}</span>
                ${v.conflict ? '<span class="chip red">口径冲突</span>' : ''}
              </div>
            </div>

            <div class="kv-grid">
              <div class="kv"><i>控制台</i><a class="mono sm" href="${esc(v.console)}" target="_blank" rel="noopener">${esc(v.console.replace(/^https?:\/\//, ''))}</a></div>
              <div class="kv"><i>环境变量</i><code class="mono">${esc(v.env)}</code></div>
              <div class="kv wide"><i>base_url</i><code class="mono">${v.base ? esc(v.base) : '<span class="muted">无官方 API，见下方备用通道</span>'}</code></div>
              <div class="kv"><i>key 前缀</i><code class="mono">${esc(v.keyPrefix)}</code></div>
              <div class="kv wide"><i>model id 示例</i><code class="mono">${v.models.map(esc).join('  ·  ')}</code></div>
            </div>

            ${v.alt.length ? `
            <div class="valt">
              <i>其他协议 / 区域端点</i>
              <ul>${v.alt.map(a => `<li><code class="mono">${esc(a.url)}</code><span>${esc(a.note)}</span></li>`).join('')}</ul>
            </div>` : ''}

            <div class="vfree">
              <i>免费额度</i>
              <p>${esc(v.freeText)}</p>
            </div>

            ${v.retired.length ? `
            <div class="vretired">
              <i>已退役 / 会报错的 id 与端点</i>
              <div>${v.retired.map(r => `<code class="mono">${esc(r)}</code>`).join('')}</div>
            </div>` : ''}

            ${v.pitfall ? `<div class="vpit"><i>接入易错点</i><p>${esc(v.pitfall)}</p></div>` : ''}
            ${v.conflict ? `<div class="vconf"><i>⚠ 口径冲突</i><p>${esc(v.conflict)}</p></div>` : ''}

            <div class="vsrc">
              <span>核实日期 ${esc(v.verifyDate)}</span>
              <a href="${esc(v.src)}" target="_blank" rel="noopener">${esc(v.srcName)} →</a>
            </div>
            ${v.note ? `<div class="vnote">${esc(v.note)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
  }).join('');

  /* --- 导出按钮 --- */
  const ex = $('#verify-export');
  if (ex && !ex.dataset.bound) {
    ex.dataset.bound = '1';
    ex.innerHTML = `
      <button class="fbtn" id="vx-py">下载自检脚本 verify_all.py</button>
      <button class="fbtn" id="vx-env">下载 .env 模板</button>
      <button class="fbtn" id="vx-md">下载接入速查表 .md</button>`;
    $('#vx-py').addEventListener('click', () => downloadFile('verify_all.py', buildVerifyScript(), 'text/x-python'));
    $('#vx-env').addEventListener('click', () => downloadFile('.env.template', buildEnvTemplate(), 'text/plain'));
    $('#vx-md').addEventListener('click', () => downloadFile('接入核验速查表.md', buildVerifyMd(), 'text/markdown'));
  }

  /* --- 冲突清单 --- */
  const conflicts = all.filter(v => v.conflict);
  $('#verify-conflicts').innerHTML = conflicts.map(v => `
    <div class="cf-row">
      <b>${esc(v.name)}</b>
      <p>${esc(v.conflict)}</p>
      <div class="cf-fix">以官方为准：${esc(v.srcName)} · <a href="${esc(v.src)}" target="_blank" rel="noopener">${esc(v.src)}</a></div>
    </div>`).join('');

  /* --- 退役清单 --- */
  $('#verify-retired').innerHTML = all.filter(v => v.retired.length).map(v => `
    <div class="rt-row">
      <b>${esc(v.name)}</b>
      <div>${v.retired.map(r => `<code class="mono">${esc(r)}</code>`).join('')}</div>
    </div>`).join('');
}

/* 接入速查表 Markdown */
function buildVerifyMd() {
  const L = [];
  L.push('# 主流大模型接入核验速查表');
  L.push('');
  L.push('数据核对至 ' + DATA_DATE + '。');
  L.push('');
  L.push('> 这张表只回答一件事：**怎么接才不会错**。');
  L.push('> 额度会变、活动会过期，但端点、环境变量名、鉴权方式这些是相对稳定的硬事实。');
  L.push('> 凡是标了「口径冲突」的，说明多个来源给出了互相矛盾的说法，请以控制台为准。');
  L.push('');

  Object.keys(VERIFY_TIER).sort().forEach(t => {
    const list = VENDOR_ACCESS.filter(v => String(v.tier) === t);
    if (!list.length) return;
    L.push('## ' + VERIFY_TIER[t].label + ' —— ' + VERIFY_TIER[t].desc);
    L.push('');
    list.forEach(v => {
      const fs = FREE_STATE[v.free];
      L.push('### ' + v.name + '（' + v.vendor + '）');
      L.push('');
      L.push('- **控制台**：' + v.console);
      L.push('- **base_url**：' + (v.base ? '`' + v.base + '`' : '无官方 API，走第三方推理商'));
      if (v.alt.length) v.alt.forEach(a => L.push('  - 其他端点：`' + a.url + '` —— ' + a.note));
      L.push('- **环境变量**：`' + v.env + '`（key 前缀：' + v.keyPrefix + '）');
      L.push('- **model id 示例**：' + v.models.map(m => '`' + m + '`').join('、'));
      if (v.retired.length) L.push('- **⚠ 已退役**：' + v.retired.map(m => '`' + m + '`').join('、'));
      L.push('- **免费额度**：[' + fs.label + '] ' + v.freeText);
      if (v.pitfall) L.push('- **接入易错点**：' + v.pitfall);
      if (v.conflict) L.push('- **⚠ 口径冲突**：' + v.conflict);
      L.push('- **出处**：' + v.srcName + ' —— ' + v.src + '（核实于 ' + v.verifyDate + '）');
      if (v.note) L.push('');
      if (v.note) L.push('  ' + v.note);
      L.push('');
    });
  });

  L.push('---');
  L.push('');
  L.push('## 三条通用铁律');
  L.push('');
  L.push('1. **端点以官方文档为准，不信二手教程。** 本轮核实里 MiniMax、讯飞、Kimi、LongCat 的 base_url 都存在 2~3 个互相冲突的版本。');
  L.push('2. **model id 会退役，而且要当常态。** DeepSeek 的 `deepseek-chat`/`deepseek-reasoner` 已于 2026-07-24 退役，Groq 的 Llama 全系于 2026-08-16 转 Enterprise，Kimi 的 `moonshot-v1` 全系于 2026-08-31 退役。老脚本不会报错，只会静默换模型或返回 404。');
  L.push('3. **跑一遍 verify_all.py 比读十篇文章有用。** 401 是 key 问题，404 是端点问题，429 是额度问题——三种错误的修法完全不同，先分清是哪一类再动手。');
  L.push('');

  return L.join('\n');
}

/* 注册视图（verify.js 注入点在 VIEWS 声明之后，可以直接挂） */
VIEWS.verify = {
  title: '接入核验',
  sub: '主流模型的端点、密钥、model id，以及它们各自的出错方式',
  render: renderVerify
};
