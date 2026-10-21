/* ============================================================
   AI Agent 免费额度调度中台 — 数据层
   调研截止：2026-10-20
   confidence 分级：
     verified = 多来源一致 / 官方页面明确
     reported = 单一来源报道，未经二次交叉验证
     disputed = 多个来源给出互相冲突的数字
   ============================================================ */

const DATA_DATE = '2026-10-20';

/* 额度形态定义 —— 这是整个中台的分类基础 */
const QUOTA_TYPES = {
  forever:  { label: '永久免费档', short: '永久', color: 'green',  desc: '模型本身免费，无总量上限，通常有速率/并发限制。可再生，是基本盘。', weight: 100 },
  daily:    { label: '每日刷新',   short: '每日', color: 'blue',   desc: '每天自动重置的配额，用不完不累积。可再生，适合长期常驻任务。', weight: 80 },
  gift:     { label: '新户礼包',   short: '礼包', color: 'amber',  desc: '注册赠送的一次性 Token，通常 30~90 天过期。会失效，应优先消耗。', weight: 40 },
  trial:    { label: '试用积分',   short: '试用', color: 'red',    desc: '一次性积分，用完即止不刷新。只够做 Demo，不能规划为产能。', weight: 15 },
  selfhost: { label: '开源自托管', short: '自托管', color: 'purple', desc: '软件免费、无额度概念，成本转移到你自己的硬件/服务器上。', weight: 90 },
  freechat: { label: '免费聊天版', short: '网页', color: 'slate',  desc: '网页/App 端免费使用，但无 API、无法自动化调用。', weight: 60 }
};

/* 自托管产能的现实估算
   自托管软件本身「无限」，但吞吐受本地硬件约束，绝不是无限。
   按消费级单卡（20~48G 显存、7B~32B 模型、20~50 tok/s）全天满载估算：
   30 tok/s × 86400 s ≈ 260 万 tok/日，取下限保守值 150 万。
   没有这块硬件的话，这个数字应视为 0。 */
const SELFHOST_DAILY_EST = 1500000;

/* 任务标签定义 */
const TASK_TAGS = {
  chat:      '日常对话',
  writing:   '中文写作',
  'long-text':'长文/文档',
  reasoning: '深度推理',
  code:      '代码生成',
  batch:     '批量处理',
  vision:    '图像理解',
  image:     '图片生成',
  video:     '视频生成',
  research:  '深度研究',
  realtime:  '低延迟实时',
  agent:     'Agent 编排'
};

const PLATFORMS = [
  /* ================= 国内 API ================= */
  {
    id: 'zhipu', name: '智谱 BigModel', vendor: '智谱华章 · 02513.HK', region: 'cn', cat: 'api',
    quotaType: 'forever', unlimited: true,
    headline: 'GLM-4.7-Flash 永久免费、不限 Token',
    freeTokensPerDay: 3000000, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '200K 上下文；⚠ 并发口径冲突：实测 1 并发 vs 攻略称 30 并发',
    strengths: ['中文理解第一梯队', '200K 长上下文', 'OpenAI 兼容'],
    caveats: ['免费档并发低，不适合多用户并发', '免费政策平台保留调整权'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','reasoning','code','vision'],
    confidence: 'verified', source: 'bigmodel.cn/pricing',
    url: 'https://open.bigmodel.cn',
    note: '国内最稳的长期免费渠道。GLM-4.6V-Flash(视觉)、GLM-Z1-Flash(推理)、CogView-3-Flash(生图) 也在免费清单内。'
  },
  {
    id: 'sensenova', name: '商汤 SenseNova Token Plan', vendor: '商汤科技', region: 'cn', cat: 'api',
    quotaType: 'daily',
    headline: 'Free 档 ¥0/月，Kimi K3 / DeepSeek V4 Pro / GLM-5.2 旗舰直接免',
    freeTokensPerDay: 2000000, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '滚动 5 小时 60,000 积分 + 滚动周 600,000 积分；积分≠token，按模型换算',
    strengths: ['一个 Key 同时调 Kimi K3 / DeepSeek V4 Pro / GLM-5.2 三家旗舰', 'OpenAI + Anthropic 双兼容接口', '1M 上下文'],
    caveats: ['积分制不是 token 制，实际能跑多少要自己测', '公测期，窗口何时关闭官方未承诺', 'Flash-Lite 走专属积分池，规则不同'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','reasoning','code','batch','agent'],
    confidence: 'reported', source: 'platform.sensenova.cn + 2026-09 实测帖',
    url: 'https://platform.sensenova.cn',
    note: '⚠ 这是当前唯一能免费直连三家国产旗舰的入口，价值最高。freeTokensPerDay 是按周额度摊到日的保守折算，不是官方 token 数。'
  },
  {
    id: 'amd-radeon', name: 'AMD Radeon Cloud Token Factory', vendor: 'AMD', region: 'cn', cat: 'api',
    quotaType: 'daily',
    headline: '4 款 Public Free 模型免费用，额度按 points 计',
    freeTokensPerDay: 1500000, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '每日用量上限按 points 计，北京时间 00:00 重置；具体额度官方未公示；429 带 Retry-After',
    strengths: ['中国站可直连，不需要海外手机号', 'DeepSeek-V4-Flash 给到原生 1M 上下文', 'OpenAI + Anthropic 双协议，OpenCode 可直接接'],
    caveats: ['免费的是 4 款 Flash/小模型，不含 Kimi K3 / GLM-5.2 等旗舰', 'RPM 与并发按 key 限制', '官方定位是免费试用，不是生产服务'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','reasoning','code','batch','agent','vision'],
    confidence: 'disputed', source: '官方 radeon-cloud-docs vs Linux Do 实测帖',
    url: 'https://developer.amd.com.cn/radeon/tokenfactory',
    note: '⚠ 冲突点：二手来源称「每日 $10 额度、含 Kimi K3 / GLM 5.2」，官方 API 文档只列出 4 款 Public Free 模型（DeepSeek-V4-Flash-0731、DeepSeek-V4-Flash-Vision-Exp、Qwen3.8-Flash-Next、MiniCPM5-1B），且未公示额度数字。以官方为准；freeTokensPerDay 是保守估计。中国站专属，海外站点没有 Token Factory。'
  },
  {
    id: 'together', name: 'Together AI', vendor: 'Together AI', region: 'intl', cat: 'api',
    quotaType: 'forever',
    headline: 'GLM-5.2-FP8 等开源模型 free tier（fair use）',
    freeTokensPerDay: 1000000, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: 'Fair use，按服务器负载动态限速；无硬性公布数字',
    strengths: ['能免费跑到 GLM-5.2 这类当开源旗舰', 'OpenAI 兼容，Claude Code / Cline 可直接接'],
    caveats: ['fair use 意味着忙时会被限流，不能当稳定产能', '海外节点'],
    needsCard: false, needsPhone: false,
    tags: ['chat','reasoning','code','batch','agent'],
    confidence: 'reported', source: 'llmperks.com 2026-10-20 快照',
    url: 'https://api.together.xyz',
    note: '适合当「旗舰模型备用通道」——主力额度用完时的第二梯队，不要规划为每日产能。'
  },
  {
    id: 'zhipu-gift', name: '智谱 新户礼包', vendor: '智谱华章', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '注册实名后赠约 2000 万 Token',
    freeTokensPerDay: null, tokensTotal: 20000000, reset: 'once', expiresAt: null,
    limits: '构成：1200万 GLM-4.5-Air + 600万 GLM-4.6V + 200万通用 + 100次联网搜索 + 20次按次计费',
    strengths: ['可用来跑付费旗舰模型', '额度大'],
    caveats: ['有效期约 3 个月，过期清零（实测样本 9/20 至 12/20）', '不是永久额度，别当产能规划'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','reasoning','code','vision'],
    confidence: 'reported', source: '控制台实测样本',
    url: 'https://open.bigmodel.cn',
    note: '不同注册时点活动规则会变，以控制台「资源包管理」实际显示为准。另有来源称赠 1 亿或 100 万，口径不一。'
  },
  {
    id: 'volc', name: '火山方舟（豆包）', vendor: '字节跳动', region: 'cn', cat: 'api',
    quotaType: 'daily',
    headline: '每日自动发放 200 万 Token',
    freeTokensPerDay: 2000000, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '安心体验：每模型 50 万（一次性）；协作奖励计划：每日 200 万/单模型（个人），企业认证 500 万；按天重置不累积',
    strengths: ['单日额度国内最大', '按天刷新，可再生', '豆包 + DeepSeek + Qwen 全系'],
    caveats: ['⚠ 必须在控制台手动开通模型，否则有 Key 也返回 404', '免费 QPS 低', 'model 字段可填接入点 ID（ep- 开头），与别家不同'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','code','batch','vision'],
    confidence: 'reported', source: '多篇 2026-09/10 攻略一致',
    url: 'https://console.volcengine.com/ark',
    note: '「协作奖励计划」是每日额度的来源，需在控制台加入。⚠ 另有官方活动页称 Doubao-Seed-2.1-pro「每日最高 500 万 Token」，与「200 万/日」并存，以控制台实际生效规则为准。'
  },
  {
    id: 'bailian', name: '阿里云百炼', vendor: '阿里巴巴', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '每个模型各 100 万 Token，覆盖 70+ 模型',
    freeTokensPerDay: null, tokensTotal: 70000000, reset: 'once', expiresAt: null,
    limits: '各模型独立计算、不共享；90 天有效；仅限华北2（北京）地域',
    strengths: ['模型货架最全，适合横向对比选型', '合计额度名义上最高（7000 万+）'],
    caveats: ['90 天过期，不支持补发/延期/重置', '仅华北2地域有免费额度', '不抵扣 Batch、模型调优、部署'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','reasoning','code','batch','vision'],
    confidence: 'verified', source: 'bailian.console.aliyun.com',
    url: 'https://bailian.console.aliyun.com',
    note: '总额口径不一（超 5000 万与超 7000 万并存），这里取「每模型 100 万 × 70+ 模型」的官方表述。'
  },
  {
    id: 'siliconflow', name: '硅基流动 SiliconFlow', vendor: '硅基流动', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '新户约 ¥16 代金券；小模型永久免费已取消',
    freeTokensPerDay: null, tokensTotal: null, reset: 'once', expiresAt: null,
    limits: '现仅 embedding、语音、OCR、翻译、Kolors 图生图免费；Chat 模型按量计费',
    strengths: ['一个 Key 调 100+ 模型', '国内低延迟（常 <100ms）', 'OpenAI 兼容'],
    caveats: ['「9B 以下永久免费」老攻略已失效，别按老文章规划', '代金券只有约 16 元'],
    needsCard: false, needsPhone: true,
    tags: ['chat','code','batch','vision','image'],
    confidence: 'disputed', source: '2026-10 免费地图 vs 多篇旧攻略',
    url: 'https://siliconflow.cn',
    note: '⚠ 冲突点：多篇 2026 年中文章仍称「送 2000 万 Token + 小模型永久免费」，而 2026-10 的核查称该政策已取消（现仅 embedding / 语音 / OCR / 翻译 / Kolors 免费）。别按老文章规划产能。'
  },
  {
    id: 'hunyuan', name: '腾讯云 TokenHub（混元）', vendor: '腾讯', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '语言 / 多模态各 100 万 Token，有效期 1 年',
    freeTokensPerDay: null, tokensTotal: 2000000, reset: 'once', expiresAt: null,
    limits: '有效期 1 年（同类里最长）；视频生成 50 积分、3D 各 100 积分',
    strengths: ['有效期 1 年，不急着用', '微信生态直连'],
    caveats: ['额度规模小', '免费并发低'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','vision','video'],
    confidence: 'verified', source: '腾讯云 TokenHub 定价页',
    url: 'https://console.cloud.tencent.com',
    note: '有效期长是最大优势——可以用来兜底那些「不确定什么时候要用」的场景。'
  },
  {
    id: 'qianfan', name: '百度千帆', vendor: '百度', region: 'cn', cat: 'api',
    quotaType: 'forever',
    headline: 'ERNIE-Speed 永久免费，并发最高 50 QPS',
    freeTokensPerDay: 1500000, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: 'ERNIE-Speed / ERNIE-3.5-8K 永久免费；新户另赠 100 万/月（ERNIE-4.0）',
    strengths: ['免费档并发国内最高（50 QPS）', '中文文档解析强'],
    caveats: ['免费模型能力偏基础', '高级模型走试用额度'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','batch'],
    confidence: 'reported', source: '多篇攻略一致',
    url: 'https://qianfan.cloud.baidu.com',
    note: '需要高并发的场景（批量跑几千条）国内首选。'
  },
  {
    id: 'deepseek', name: 'DeepSeek', vendor: '深度求索', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '新户赠送 300~500 万 Token（30 天）',
    freeTokensPerDay: null, tokensTotal: 4000000, reset: 'once', expiresAt: null,
    limits: '30 天有效；无永久免费 API 档',
    strengths: ['推理/代码能力极强', '官方定价极低（百万 token 几毛到几块）'],
    caveats: ['免费额度小且短命', '⚠ deepseek-chat / deepseek-reasoner 端点已于 2026-07-24 退役', '⚠ V4-Pro 自 2026-09-14 起请求被路由到 V4.1-Flash'],
    needsCard: false, needsPhone: true,
    tags: ['reasoning','code','long-text'],
    confidence: 'disputed', source: '300万 vs 500万 / $5 vs ¥500 口径不一',
    url: 'https://platform.deepseek.com',
    note: '⚠ 全网教程里的 deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役，V4-Pro 自 2026-09-14 起自动路由到 V4.1-Flash。老脚本不报错，只会在你不知道的情况下换模型——这是「结果对不上」最常见的来源。网页版 chat.deepseek.com 仍完全免费。'
  },
  {
    id: 'longcat', name: '美团 LongCat', vendor: '美团', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '新户实名赠 1000 万 Token',
    freeTokensPerDay: null, tokensTotal: 10000000, reset: 'once', expiresAt: null,
    limits: '资源包 30 天有效；缓存命中不计入消耗',
    strengths: ['单笔礼包额度大', '缓存命中不扣额度'],
    caveats: ['内测期「每日免费」政策已失效', '30 天短'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','code'],
    confidence: 'reported', source: '2026-10 免费地图',
    url: 'https://longcat.chat/platform/',
    note: '适合在 30 天内集中跑一个项目。'
  },
  {
    id: 'modelscope', name: '魔搭 ModelScope', vendor: '阿里', region: 'cn', cat: 'api',
    quotaType: 'daily',
    headline: '每日 2000 次免费调用（开源模型）',
    freeTokensPerDay: null, reqPerDay: 2000, reset: 'daily', expiresAt: null,
    limits: '仅限开源模型；热门模型额度会动态下调',
    strengths: ['调用次数慷慨（2000 次/天）', '不用自己找权重'],
    caveats: ['热门模型额度会被调低', '定位是实验原型'],
    needsCard: false, needsPhone: true,
    tags: ['chat','code','batch','image','vision'],
    confidence: 'reported', source: '2026-09 攻略',
    url: 'https://modelscope.cn',
    note: '每日 250 魔粒 ≈ 125 次调用（旗舰每次约 2 魔粒）。可直接调 GLM-5.2、Kimi K3、MiniMax M3、DeepSeek V4 Flash——这是拿旗舰做小批量任务最省事的路子。'
  },

  {
    id: 'moonshot', name: 'Kimi 开放平台', vendor: '月之暗面', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: 'API 无免费档，预付费 $1 起；网页端免费不限',
    freeTokensPerDay: null, tokensTotal: null, reset: 'once', expiresAt: null,
    limits: 'Tier 0：1 并发 / 3 RPM / 1.5M TPD；Kimi K3 需充值 $1 才解锁',
    strengths: ['1M 上下文，国产最长', 'OpenAI + Anthropic 双兼容端点', '国内直连'],
    caveats: ['API 侧没有免费额度，别等', '⚠ kimi-k2.5 与 moonshot-v1 全系已退役', 'Kimi Code / 会员的 key 不能用于开放平台'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','reasoning','code'],
    confidence: 'verified', source: 'platform.moonshot.cn/docs/api/',
    url: 'https://platform.moonshot.cn',
    note: '想免费拿 Kimi K3 走商汤 SenseNova 或魔搭，别在官方 API 上等免费。老教程里的 moonshot-v1-8k/32k/128k 与 kimi-k2.5 已于 2026-08-31 16:00 退役，现在调用返回 404。'
  },
  {
    id: 'minimax', name: 'MiniMax 开放平台', vendor: 'MiniMax（稀宇）', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '注册赠约 ¥15 体验额度，无长期免费档',
    freeTokensPerDay: null, tokensTotal: null, reset: 'once', expiresAt: null,
    limits: '新户 ¥15；M2 发布期曾限时免费（2025-11-07 08:00 结束）',
    strengths: ['M2 系列编程/工具调用能力第一梯队', '百万级上下文', 'OpenAI + Anthropic 双兼容'],
    caveats: ['⚠ 国内版与国际版是两个独立账号体系，key 不通用', '免费额度很薄', '端点有三个版本并存'],
    needsCard: false, needsPhone: true,
    tags: ['chat','code','agent'],
    confidence: 'disputed', source: 'platform.minimaxi.com 文档 + 多源端点不一',
    url: 'https://platform.minimaxi.com',
    note: '⚠ 端点冲突：api.minimaxi.com/v1（国内现行）、api.minimax.io/v1（国际）、api.minimax.chat/v1（老）。必须对着自己控制台的域名确认，选错站点后面全白配。'
  },
  {
    id: 'spark', name: '讯飞星火', vendor: '科大讯飞', region: 'cn', cat: 'api',
    quotaType: 'gift',
    headline: '新户约 200 万 Token；Spark Lite 免费',
    freeTokensPerDay: null, tokensTotal: 2000000, reset: 'once', expiresAt: null,
    limits: '新户 200 万 Token，5 RPM；Spark Lite 免费使用',
    strengths: ['语音与方言能力业界领先', 'OpenAI 兼容 HTTP 接口', '教育/医疗场景积累深'],
    caveats: ['⚠ 控制台入口极易选错，见下方说明', '端点 v1 / v2 两种写法并存', '纯文本任务国产里有更省事的选择'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','code'],
    confidence: 'disputed', source: 'xfyun.cn 官方文档 vs 教程 /v1 写法',
    url: 'https://console.xfyun.cn',
    note: '⚠ 最大的坑不是端点而是入口：讯飞控制台里星火大模型与语音识别 / OCR / 语音合成混在一起。在语音类应用下申请的 key 调不通 Spark Chat，会一直鉴权失败，排查半天才发现入口找错了。要认准「星火认知大模型」这个产品。'
  },

  /* ================= 海外 API ================= */
  {
    id: 'openai', name: 'OpenAI API', vendor: 'OpenAI', region: 'global', cat: 'api',
    quotaType: 'trial',
    headline: '无长期免费档，$5 试用金的说法存疑',
    freeTokensPerDay: null, tokensTotal: null, reset: 'once', expiresAt: null,
    limits: '⚠ 三种说法互相矛盾：① 新户 $5 试用金（3 个月过期）② 2026 年起无免费额度 ③ 仅数据共享可换每日免费 token',
    strengths: ['模型能力与工具链最成熟', '生态与教程最多'],
    caveats: ['⚠ 是否有注册赠送无定论，别按「有 $5」做规划', '网页免费 ≠ API 免费', '从第一笔请求起就可能需要付款方式'],
    needsCard: true, needsPhone: false,
    tags: ['chat','writing','reasoning','code','vision'],
    confidence: 'disputed', source: '官方定价页 vs 多家第三方核对站',
    url: 'https://platform.openai.com',
    note: '⚠ 关键认知：chatgpt.com 网页端纯文本已从 2026-08-10 起不限量，但那是网页额度，脚本拿不到。想自动化调 GPT，目前没有可靠的免费路径——这也是本中台把它列为「需要付费」而不是「免费额度」的原因。'
  },
  {
    id: 'anthropic', name: 'Anthropic API', vendor: 'Anthropic', region: 'global', cat: 'api',
    quotaType: 'trial',
    headline: '一次性约 $5 试用金，无长期免费档',
    freeTokensPerDay: null, tokensTotal: null, reset: 'once', expiresAt: null,
    limits: '注册后约 $5（一次性，约 1 个月过期），需手机号短信验证；无速率限制的免费档',
    strengths: ['长上下文与指令遵循最强', 'Claude Code 生态成熟'],
    caveats: ['⚠ 不是 OpenAI 兼容格式，必须走 Anthropic 协议', '试用金用完后无免费回落档', '需短信验证'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','reasoning','code','long-text'],
    confidence: 'reported', source: '多家第三方核对站一致',
    url: 'https://console.anthropic.com',
    note: '$5 对质量验证够用（Sonnet 单次调用不到 1 美分），但它是「试用金」不是「免费档」——用完之后下一笔就是付费请求，没有限速免费的回落路径。当基准测试预算用，别当开发环境。'
  },
  {
    id: 'xai', name: 'xAI (Grok)', vendor: 'xAI', region: 'global', cat: 'api',
    quotaType: 'gift',
    headline: '注册 $25 赠送（30 天过期）+ 数据共享 $150/月（口径存疑）',
    freeTokensPerDay: null, tokensTotal: null, reset: 'monthly', expiresAt: null,
    limits: '$25 赠送 30 天过期不结转；数据共享 $150/月需先消费 $5，且不可撤销',
    strengths: ['若 $25 属实，是美元金额上最慷慨的注册赠送', 'OpenAI 兼容', 'grok-4.1-fast 定价极低'],
    caveats: ['⚠ 官方 quickstart / billing 页未列出任何免费额度', '数据共享计划开启后不可撤销', 'Anthropic 兼容端点已 deprecated'],
    needsCard: true, needsPhone: false,
    tags: ['chat','reasoning','code'],
    confidence: 'disputed', source: '多源称 $25 vs 官方文档未列免费额度',
    url: 'https://console.x.ai',
    note: '⚠ 冲突：$25 注册赠送的说法与「官方文档未列任何免费额度」直接矛盾。若为真，这是金额最大的注册赠送；但前提是你接受 30 天过期且可能需要绑卡。数据共享计划一旦开启不可撤销——正解是建两个 team，一个开数据共享跑非敏感任务。'
  },
  {
    id: 'gemini', name: 'Google AI Studio', vendor: 'Google', region: 'global', cat: 'api',
    quotaType: 'forever',
    headline: 'Gemini Flash / Flash-Lite 免费，Pro 已于 4/1 移出',
    freeTokensPerDay: 1200000, reqPerDay: 250, reset: 'daily', expiresAt: null,
    limits: '约 10~15 RPM；RPD 各来源冲突（20 / 250 / 500 / 1500）；每日太平洋时间零点重置；Flash/Flash-Lite 免费，Pro 免费层约 50 RPD',
    strengths: ['不用信用卡', '1M 上下文', '多模态（图/音/视频）', 'Imagen 100 图/天免费', 'Search grounding 5000/月免费'],
    caveats: ['Pro 系列已无免费档（4/1 起）', '免费层数据会被用于改进产品', '官方不再公布统一速率表，只能查控制台'],
    needsCard: false, needsPhone: false,
    tags: ['chat','writing','long-text','reasoning','code','vision','image','batch'],
    confidence: 'disputed', source: '官方定价页确认免费层存在；限速数字 4 家来源冲突',
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
    note: '免费层的存在已由官方定价页确认（Flash / Flash-Lite 标「免费」，Pro 免费层约 50 RPD）。但限速必须自己查 aistudio.google.com/rate-limit，别信任何二手表——Google 已不公布统一表。官方定价页同时写明：免费层数据「用于改进 Google 产品」= 是。'
  },
  {
    id: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter', region: 'global', cat: 'api',
    quotaType: 'forever',
    headline: '17 个 :free 模型，一个 Key 全调',
    freeTokensPerDay: null, reqPerDay: 50, reset: 'daily', expiresAt: null,
    limits: '固定 20 RPM；50 RPD（累计充值 <$10）→ 1000 RPD（累计充值 ≥$10，永久生效）',
    strengths: ['一个 Key 切换 17 个免费模型', '不用信用卡', 'openrouter/free 自动选模型', '余额为负会 402，注意别欠费'],
    caveats: ['免费名单每月在变（7 月 27 个 → 10 月 17 个）', 'Poolside Laguna 系列 10/31 到期', 'Dots3-Note 12/31 到期'],
    needsCard: false, needsPhone: false,
    tags: ['chat','writing','long-text','reasoning','code','vision','batch','agent'],
    confidence: 'verified', source: 'OpenRouter 模型 API 实测（10/05）',
    url: 'https://openrouter.ai',
    note: '充值 $10 一次即把日限从 50 提到 1000（20 倍），是全网性价比最高的「解锁」动作。免费模型已无 DeepSeek / Gemini / Mistral 的 :free 端点，老文章里的 ID 会报错。'
  },
  {
    id: 'groq', name: 'Groq', vendor: 'Groq', region: 'global', cat: 'api',
    quotaType: 'forever',
    headline: '30 RPM / 1000 RPD / 200K TPD，速度极快',
    freeTokensPerDay: 200000, reqPerDay: 1000, reset: 'daily', expiresAt: null,
    limits: 'gpt-oss-120b / gpt-oss-20b / qwen3.8-27b：30 RPM、1000 RPD、8K TPM、200K TPD；按组织计不计 Key',
    strengths: ['输出 500~1100 tok/s，全网最快', '不用信用卡', 'OpenAI 兼容', '缓存命中的 prompt 不计入限速'],
    caveats: ['8K TPM 很容易先撞上', 'Llama 全系 2026-08-16 已转 Enterprise，老教程 model 名失效', '多开 Key 不增加额度'],
    needsCard: false, needsPhone: false,
    tags: ['realtime','chat','code','batch','long-text'],
    confidence: 'verified', source: 'console.groq.com/settings/limits + 4 源一致',
    url: 'https://console.groq.com',
    note: '实时对话/语音场景首选。TPM 才是真瓶颈——长 prompt 一次就能吃掉一分钟的预算。'
  },
  {
    id: 'cerebras', name: 'Cerebras', vendor: 'Cerebras', region: 'global', cat: 'api',
    quotaType: 'forever',
    headline: '晶圆级芯片推理，免费层日额度高',
    freeTokensPerDay: 1000000, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '免费层每日约 100 万 Token（社区口径，官方页需自行核对）',
    strengths: ['吞吐极高', '适合大批量', '不用信用卡'],
    caveats: ['模型选择少', '免费额度口径未在官方页明确'],
    needsCard: false, needsPhone: false,
    tags: ['batch','code','chat','realtime'],
    confidence: 'reported', source: '社区攻略，未查到官方明确表',
    url: 'https://cloud.cerebras.ai',
    note: '批量任务（几千条分类/抽取）优先试这里，速度快等于省时间。'
  },
  {
    id: 'mistral', name: 'Mistral La Plateforme', vendor: 'Mistral AI', region: 'global', cat: 'api',
    quotaType: 'forever',
    headline: '无总量限制，只限速率',
    freeTokensPerDay: 600000, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '⚠ 速率口径两套：① 2 RPM / 500K TPM / 10 亿 Token 每月 ② 1 RPS / 30 RPM。无总量上限这一点各家一致',
    strengths: ['无总量上限，理论上长期免费', '欧洲合规友好'],
    caveats: ['速率限制严（1 RPS）', '英文场景强于中文'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','code','batch'],
    confidence: 'reported', source: '2026 年攻略，速率口径需核',
    url: 'https://console.mistral.ai',
    note: '「无总量限制」这点在小流量长期跑的场景很值钱，但要忍受低速率。'
  },
  {
    id: 'github-models', name: 'GitHub Models', vendor: 'GitHub', region: 'global', cat: 'api',
    quotaType: 'daily',
    headline: 'GitHub 账号直接用，40+ 模型',
    freeTokensPerDay: null, reqPerDay: 100, reset: 'daily', expiresAt: null,
    limits: '每天约 50~150 次请求（按模型档位不同）',
    strengths: ['有 GitHub 账号即可，零门槛', '覆盖主流模型'],
    caveats: ['额度小', '定位是实验/调试'],
    needsCard: false, needsPhone: false,
    tags: ['chat','code','batch'],
    confidence: 'reported', source: '多篇攻略区间 50~150',
    url: 'https://github.com/marketplace/models',
    note: '开发调试时的补充渠道，不要当主力。'
  },

  /* ================= 编程 Agent ================= */
  {
    id: 'trae', name: 'Trae', vendor: '字节跳动', region: 'cn', cat: 'coding',
    quotaType: 'forever',
    headline: '基础版免费，含 Doubao / DeepSeek / Kimi 多模型',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '基础版免费，含多款主流模型完整调用；Pro $15/月解锁私有技能市场等',
    strengths: ['免费档最厚道的 AI IDE', '中文界面与中文需求理解好', 'Work 模式可做 Agent 级自主开发'],
    caveats: ['高级模型额度仍有限', '生态相对年轻'],
    needsCard: false, needsPhone: true,
    tags: ['code','agent','chat','long-text'],
    confidence: 'reported', source: '多篇 2026 实测一致（评分最高）',
    url: 'https://trae.ai',
    note: '零预算写代码，这是当前首选。VS Code 同源，迁移成本低。'
  },
  {
    id: 'tongyi-lingma', name: '通义灵码', vendor: '阿里', region: 'cn', cat: 'coding',
    quotaType: 'forever',
    headline: '个人版基本无限制补全，500 次对话',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '基础功能免费、补全基本无限；对话约 500 次',
    strengths: ['免费档里补全几乎不设限', '中文注释理解好', 'IDE 插件形态，不用换编辑器'],
    caveats: ['Agent 能力弱于 Trae / Cursor', '对阿里技术栈有偏向'],
    needsCard: false, needsPhone: true,
    tags: ['code','chat'],
    confidence: 'reported', source: '多篇对比一致',
    url: 'https://lingma.aliyun.com',
    note: '「不想换 IDE」的人的最优解，装个插件就行。'
  },
  {
    id: 'copilot-free', name: 'GitHub Copilot Free', vendor: 'GitHub / Microsoft', region: 'global', cat: 'coding',
    quotaType: 'daily',
    headline: '2000 次补全 + 50 次对话/月',
    freeTokensPerDay: null, reqPerDay: null, reset: 'monthly', expiresAt: null,
    limits: '2000 补全 + 50 chat/agent 请求（每月，次月 1 日重置）；无超额付费选项',
    strengths: ['不用信用卡', 'IDE 覆盖最广（VS Code/JetBrains/Xcode/Eclipse）', 'Agent 模式含在免费档', '学生与开源维护者免费 Pro'],
    caveats: ['2000 次补全消耗极快（一个活跃工作日 100~200 次）', '仅自动选模型，不能挑', '云端 Agent 与代码审查是 Pro 专属'],
    needsCard: false, needsPhone: false,
    tags: ['code','chat'],
    confidence: 'verified', source: 'github.com/pricing（9/27 读取）',
    url: 'https://github.com/features/copilot',
    note: '学生认证通过后免费拿 Pro（$10/月档）——如果你或团队有在校身份，这是最值得走的一条路。'
  },
  {
    id: 'windsurf', name: 'Windsurf', vendor: 'Cognition', region: 'global', cat: 'coding',
    quotaType: 'forever',
    headline: '免费层无限 Tab 补全',
    freeTokensPerDay: null, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '免费档：Tab 补全不限 + 每日/每周 Agent 与 Chat 配额（额度很快用完）；Pro 已涨到 $20',
    strengths: ['补全真正不限量，重度补全用户最划算', 'Cascade 可做多文件自主修改'],
    caveats: ['免费 Agent 配额跑得很快', '2026-03 从 $15 涨到 $20 并改为配额制，口碑下滑', '归属 Cognition 后方向有不确定性'],
    needsCard: false, needsPhone: false,
    tags: ['code','agent'],
    confidence: 'reported', source: '官方定价页 + 对比评测',
    url: 'https://windsurf.com',
    note: '只想要「Tab 补全不要钱」的话选它；想要 Agent 干活选 Trae 或付费 Cursor。'
  },
  {
    id: 'cursor', name: 'Cursor', vendor: 'Anysphere', region: 'global', cat: 'coding',
    quotaType: 'trial',
    headline: 'Hobby 档额度「有限」，官方已不公布具体数字',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: 'Hobby：limited Agent requests + limited Tab completions（无固定公开数值）；注册送 7 天 Pro 试用',
    strengths: ['Composer 多文件 Agent 最成熟', '@ 上下文体系精细', '生态与教程最多'],
    caveats: ['免费档额度不透明，无法规划', '「2000 补全 / 50 慢速请求」是历史口径，官方页已不再写', 'Pro $20/月'],
    needsCard: false, needsPhone: false,
    tags: ['code','agent'],
    confidence: 'disputed', source: '官方页未公布 vs 全网红传 2000/50',
    url: 'https://cursor.com',
    note: '⚠ 全互联网都在复述「2000 次补全 + 50 次慢速请求」，但 2026-07 起官方定价页只写「limited」。把它当试用工具，不要当免费产能。'
  },
  {
    id: 'antigravity', name: 'Google Antigravity', vendor: 'Google', region: 'global', cat: 'coding',
    quotaType: 'forever',
    headline: '免费档 Tab 补全不限，Agent 按周限',
    freeTokensPerDay: null, reqPerDay: null, reset: 'weekly', expiresAt: null,
    limits: 'Tab 补全无上限；Agent 使用受每周限额约束；可切 Gemini / Claude 多模型',
    strengths: ['免费 Tab 不限', '能在会话中切 Gemini 3.1 Pro 与 Claude Sonnet'],
    caveats: ['Agent 周限额', '产品较新，稳定性待观察'],
    needsCard: false, needsPhone: false,
    tags: ['code','agent'],
    confidence: 'reported', source: '2026-09 核查文章',
    url: 'https://antigravity.google',
    note: 'Gemini CLI 个人免费额度在 2026-06-18 停止服务后，Antigravity 成为 Google 侧替代入口。'
  },
  {
    id: 'cline', name: 'Cline / Roo Code / Aider', vendor: '开源社区', region: 'global', cat: 'coding',
    quotaType: 'selfhost',
    headline: '开源工具本身免费，接任意 API（含免费额度）',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '工具无消息计数；成本完全取决于你接的模型来源',
    strengths: ['Apache 开源、无消息限制', '可接 OpenRouter / Groq / Gemini 免费 Key', '配合 Ollama 本地模型=真零成本'],
    caveats: ['要自己配模型与 Key', '本地模型质量受硬件限制', 'Ollama 默认上下文仅 4K，需手动调大'],
    needsCard: false, needsPhone: false,
    tags: ['code','agent'],
    confidence: 'verified', source: '项目仓库 + 2026-09 核查',
    url: 'https://github.com/cline/cline',
    note: '「无限量」的唯一正解：开源客户端 + 免费 API Key 组合。这是本中台推荐的高阶玩法。'
  },

  /* ================= Agent 编排平台 ================= */
  {
    id: 'n8n', name: 'n8n', vendor: 'n8n GmbH', region: 'global', cat: 'agent',
    quotaType: 'selfhost',
    headline: '社区版自托管永久免费，执行次数不限',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '工作流数、步骤数、执行次数、用户数全部不限；邮箱注册社区版另送 license key',
    strengths: ['唯一真正「无限」的平台', '500+ 集成，支持 MCP', '一次完整工作流只算 1 次执行'],
    caveats: ['自托管=服务器成本与运维归你', '学习曲线陡（节点画布思维）', 'Cloud 版 $20/月起'],
    needsCard: false, needsPhone: false,
    tags: ['agent','batch'],
    confidence: 'verified', source: 'n8n.io/pricing + 官方文档',
    url: 'https://n8n.io',
    note: '把「免费 API 额度」串成自动化流水线的最佳载体。配合 Ollama 可做全本地 Agent。'
  },
  {
    id: 'dify', name: 'Dify', vendor: 'LangGenius', region: 'global', cat: 'agent',
    quotaType: 'selfhost',
    headline: '开源自部署无限；云 Sandbox 送 200 次调用',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '自部署完全免费无限制；云端免费档 200 次模型调用（约 8~200 次响应，视模型）、5 个应用、50MB 知识库',
    strengths: ['RAG 知识库搭得最快', '自托管无限额度', '40+ 模型商'],
    caveats: ['云免费档额度很小', '自托管吃掉内存'],
    needsCard: false, needsPhone: false,
    tags: ['agent','long-text','batch'],
    confidence: 'verified', source: 'dify.ai/pricing',
    url: 'https://dify.ai',
    note: '要把一堆 PDF 研报做成可问答知识库，它是最快路径。'
  },
  {
    id: 'coze', name: '扣子 Coze', vendor: '字节跳动', region: 'cn', cat: 'agent',
    quotaType: 'freechat',
    headline: '国内版免费档，按「资源点」计量',
    freeTokensPerDay: null, reqPerDay: null, reset: 'monthly', expiresAt: null,
    limits: '个人版五档含免费档，按资源点计量；免费档具体资源点数官方未在可核实页面明示',
    strengths: ['200+ 插件', '零代码搭 Bot 并发布到飞书/微信', '国内直连'],
    caveats: ['免费档资源点数不透明', '进阶版 ¥39.9/月起', '复杂逻辑受平台能力约束'],
    needsCard: false, needsPhone: true,
    tags: ['agent','chat','writing'],
    confidence: 'reported', source: '官方未明示，第三方核对站记录',
    url: 'https://www.coze.cn',
    note: '做微信/飞书侧的自动化 Bot，国内没有更省事的。'
  },
  {
    id: 'manus', name: 'Manus', vendor: 'Butterfly Effect', region: 'global', cat: 'agent',
    quotaType: 'daily',
    headline: '每日 300 credits，仅 Lite 模型',
    freeTokensPerDay: null, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '每日重置 300 credits；1 并发任务；只能用 Lite 模型',
    strengths: ['自主完成多步任务（调研/报告/表格）', '每日刷新可再生'],
    caveats: ['仅 Lite 模型，复杂任务质量下降', '1 并发=跑一个任务时其他排队', '另有来源称免费 1000 credits（可能为首月政策）'],
    needsCard: false, needsPhone: false,
    tags: ['agent','research','writing'],
    confidence: 'disputed', source: '300/天 vs 1000 一次性',
    url: 'https://manus.im',
    note: '适合「丢一个任务让它自己跑完」的场景，但免费档模型偏弱，重要产出要复核。'
  },
  {
    id: 'make', name: 'Make', vendor: 'Make (Celonis)', region: 'global', cat: 'agent',
    quotaType: 'daily',
    headline: '每月 1000 credits + 2 个活跃场景',
    freeTokensPerDay: null, reqPerDay: null, reset: 'monthly', expiresAt: null,
    limits: '1000 credits/月、2 个 active scenarios、15 分钟最小间隔',
    strengths: ['可视化上手最快', '3000+ 集成'],
    caveats: ['按模块调用消耗 credits，迭代器会成倍放大消耗（新手最易翻车处）', '免费档只能 2 个场景'],
    needsCard: false, needsPhone: false,
    tags: ['agent','batch'],
    confidence: 'verified', source: 'make.com/en/pricing',
    url: 'https://make.com',
    note: '短期做一两个简单自动化够用，复杂流程会被 credits 卡死。'
  },
  {
    id: 'fastgpt', name: 'FastGPT', vendor: 'Sealos', region: 'cn', cat: 'agent',
    quotaType: 'selfhost',
    headline: '开源自部署免费；云免费档 100 AI 积分',
    freeTokensPerDay: null, reqPerDay: null, reset: 'monthly', expiresAt: null,
    limits: '云免费版：100 AI 积分、600 组知识库索引、1 成员、10 个 Agent、3 个知识库、30 QPM',
    strengths: ['知识库问答搭得快', '国内中文文档完善', '自部署无限制'],
    caveats: ['云免费档很紧', '复杂编排弱于 Dify'],
    needsCard: false, needsPhone: true,
    tags: ['agent','long-text'],
    confidence: 'verified', source: 'fastgpt.cn/price（2026-09-21 抓取）',
    url: 'https://fastgpt.cn',
    note: '国内做企业内部知识库的常见选择。'
  },

  /* ================= 对话 / 研究 ================= */
  {
    id: 'chatgpt-free', name: 'ChatGPT 免费版', vendor: 'OpenAI', region: 'global', cat: 'chat',
    quotaType: 'freechat',
    headline: '纯文本对话已无限（2026-08-10 起）',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '纯文本不限次数（GPT-5.6 Luna + Think 按钮）；图片生成、文件上传、语音模式仍有独立额度',
    strengths: ['纯文字聊天不要钱且不限量', '事实性错误率较上代降 62%'],
    caveats: ['加图片/文件就回到额度体系', '无免费 API（GPT-5.x 无免费档）'],
    needsCard: false, needsPhone: false,
    tags: ['chat','writing','reasoning'],
    confidence: 'verified', source: 'OpenAI 官方公告 + 多家媒体（8/10）',
    url: 'https://chatgpt.com',
    note: '重要认知：网页免费≠API 免费。OpenAI 至今没有免费 API 档，想自动化只能付费。'
  },
  {
    id: 'kimi', name: 'Kimi', vendor: '月之暗面', region: 'cn', cat: 'chat',
    quotaType: 'freechat',
    headline: '网页/App 完全免费，1M 上下文',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '网页与 App 免费，旗舰 1M 超长上下文（国产最长）',
    strengths: ['超长文档一次读完', '国内直连、中文强', '网页端免费不限'],
    caveats: ['无免费 API', '高峰期可能排队'],
    needsCard: false, needsPhone: true,
    tags: ['chat','writing','long-text','research'],
    confidence: 'reported', source: '2026-08 资讯 + 产品页',
    url: 'https://kimi.moonshot.cn',
    note: '读几百页研报/招股书的最省事入口——直接网页传，不用折腾 API。⚠ 注意与「平台库」里的「Kimi 开放平台」区分：那是 API 条目，这里是网页版。'
  },
  {
    id: 'perplexity', name: 'Perplexity 免费版', vendor: 'Perplexity', region: 'global', cat: 'research',
    quotaType: 'freechat',
    headline: '基础搜索无限，Pro 搜索 3~5 次/天',
    freeTokensPerDay: null, reqPerDay: 5, reset: 'daily', expiresAt: null,
    limits: '无限基础搜索；3~5 次 Pro Search/天；1~3 次 Deep Research/月；3 个文件上传/天',
    strengths: ['带编号引用的联网答案', '基础搜索不要钱', 'Focus 模式可限学术/Reddit/YouTube'],
    caveats: ['Pro 搜索与 Deep Research 很快用完', '免费档不能自选模型', '有独立测试指出其引用准确率有误差'],
    needsCard: false, needsPhone: false,
    tags: ['research','chat'],
    confidence: 'verified', source: '多源一致 + 定价页',
    url: 'https://perplexity.ai',
    note: '做「事实核查」比直接问聊天机器人可靠，但引用仍要自己点开看。'
  },
  {
    id: 'notebooklm', name: 'NotebookLM（Gemini Notebook）', vendor: 'Google', region: 'global', cat: 'research',
    quotaType: 'freechat',
    headline: '免费档最完整的文档研究工具',
    freeTokensPerDay: null, reqPerDay: 50, reset: 'daily', expiresAt: null,
    limits: '100 笔记本、每本 50 来源、50 次对话/天、音频概览 3/天、视频概览 3/天、深度研究 10/月',
    strengths: ['答案严格基于你上传的资料并给出处', '音频/视频概览可当播客听', '单来源可到 50 万词/200MB'],
    caveats: ['只答你给的资料，不适合开放式探索', '概览类每天仅 3 次，最先撞上限', '2026-09-02 起限额有调整'],
    needsCard: false, needsPhone: false,
    tags: ['research','long-text','writing'],
    confidence: 'verified', source: 'Google 官方支持文档',
    url: 'https://notebooklm.google',
    note: '投研场景的隐藏利器：把一堆研报/年报塞进去，让它只基于原文回答，幻觉显著低于通用聊天。'
  },

  /* ================= 图像 / 视频 ================= */
  {
    id: 'jimeng', name: '即梦 AI', vendor: '字节跳动', region: 'cn', cat: 'image',
    quotaType: 'daily',
    headline: '每日 60~66 积分（生图+生视频）',
    freeTokensPerDay: null, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '每日 60~66 积分；一条 5 秒视频约 40 积分、12 秒约 60 积分；720P 带水印、禁止商用',
    strengths: ['角色一致性最强（Seedream）', '一键导入剪映', '抖音生态'],
    caveats: ['带水印且禁商用', '免费分辨率上限 720P', '积分口径各来源 60/66/260 不一'],
    needsCard: false, needsPhone: true,
    tags: ['image','video'],
    confidence: 'disputed', source: '60 / 66 / 260 三种积分口径',
    url: 'https://jimeng.jianying.com',
    note: '短视频/封面配图的免费首选。要商用必须付费。'
  },
  {
    id: 'kling', name: '可灵 AI', vendor: '快手', region: 'cn', cat: 'video',
    quotaType: 'daily',
    headline: '每日 66 积分（约 6 条 720p 短片）',
    freeTokensPerDay: null, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '国内口径每日约 6 次 / 66 积分，当日清零；免费档 720P 带水印、禁商用',
    strengths: ['画面质感与动作/唇形最好', '角色连续性强，适合剧情片段'],
    caveats: ['带水印、禁商用', '批量生成排队久', '免费额度当日清零'],
    needsCard: false, needsPhone: true,
    tags: ['video'],
    confidence: 'reported', source: '多篇 2026-09 实测一致',
    url: 'https://klingai.com',
    note: '国内视频生成的画质天花板，免费档够做测试和分镜验证。'
  },
  {
    id: 'hailuo', name: '海螺 Hailuo', vendor: 'MiniMax', region: 'cn', cat: 'video',
    quotaType: 'daily',
    headline: '每日约 2~3 条（6s / 768p）',
    freeTokensPerDay: null, reqPerDay: 3, reset: 'daily', expiresAt: null,
    limits: '网页端每日免费次数，无需付款；带水印、仅个人非商用',
    strengths: ['写实风格与人物微表情强', '动漫/动作镜头流畅'],
    caveats: ['每日条数少', '中文生活化语义识别偏弱'],
    needsCard: false, needsPhone: true,
    tags: ['video'],
    confidence: 'reported', source: '多源一致',
    url: 'https://hailuoai.com',
    note: '写实人像短片优先试它。'
  },
  {
    id: 'wanxiang', name: '通义万相', vendor: '阿里', region: 'cn', cat: 'image',
    quotaType: 'forever',
    headline: '基础生成永久免费，无每日硬限',
    freeTokensPerDay: null, reqPerDay: null, reset: 'none', expiresAt: null,
    limits: '网页端基础生成免费；签到可领灵感值；720P 带水印、禁商用',
    strengths: ['基础生成不限次', '国风/水墨、电商产品图强', '模型开源可自部署'],
    caveats: ['免费档分辨率与商用受限', '排队'],
    needsCard: false, needsPhone: true,
    tags: ['image','video'],
    confidence: 'reported', source: '2026 攻略多源一致',
    url: 'https://tongyi.aliyun.com/wanxiang',
    note: '要大量出图练手，这个的「不限次」比积分制更耐用。'
  },
  {
    id: 'runway', name: 'Runway', vendor: 'Runway', region: 'global', cat: 'video',
    quotaType: 'trial',
    headline: '一次性 125 积分（约 5 条 4 秒）',
    freeTokensPerDay: null, reqPerDay: null, reset: 'once', expiresAt: null,
    limits: '注册送 125 积分，不刷新；4 秒 = 25 积分，旗舰模型 60 积分/5 秒',
    strengths: ['专业级可控性（可圈选局部改运动）', '画面质量顶级'],
    caveats: ['一次性积分，用完即止（经典陷阱）', '不重置，不能规划为产能', '需海外网络'],
    needsCard: false, needsPhone: false,
    tags: ['video'],
    confidence: 'verified', source: '多源一致',
    url: 'https://runwayml.com',
    note: '⚠ 典型的「看起来免费其实只够体验」。别把 Runway 列进日常产能。'
  },
  {
    id: 'veo', name: 'Google Veo 3.1 / Flow', vendor: 'Google', region: 'global', cat: 'video',
    quotaType: 'daily',
    headline: '每日小额度池，720p 带水印',
    freeTokensPerDay: null, reqPerDay: null, reset: 'daily', expiresAt: null,
    limits: '每天小额生成池，可出几条 720p；免费带水印',
    strengths: ['海外画质天花板', '原生音画同步'],
    caveats: ['额度很小', '需 Google 账号与海外网络'],
    needsCard: false, needsPhone: false,
    tags: ['video'],
    confidence: 'reported', source: '2026-09 免费内容速递',
    url: 'https://labs.google/flow',
    note: '当「偶尔需要一条高质量片子」的补充，不要当主力。'
  }
];

/* 政策变更时间线 —— 说明这类数据为什么会过期 */
const TIMELINE = [
  { date: '2026-04-01', level: 'warn', title: 'Gemini 免费层移除 Pro 系列',
    detail: 'Pro / Ultra 不再有免费档，只剩 Flash 与 Flash-Lite。大量依赖免费 Pro Key 的原型当天返回 403。' },
  { date: '2026-06-18', level: 'warn', title: 'Gemini CLI 停止服务个人免费额度',
    detail: 'Gemini CLI 与 Code Assist IDE 扩展不再为个人提供免费额度，配额入口转向 Antigravity CLI。' },
  { date: '2026-08-10', level: 'good', title: 'ChatGPT 免费版纯文本对话改为无限',
    detail: '默认模型换成 GPT-5.6 Luna，新增 Think 按钮。但图片生成、文件上传、语音仍各自有额度。' },
  { date: '2026-08-16', level: 'warn', title: 'Groq 下架 Llama 全系免费额度',
    detail: 'llama-3.3-70b-versatile 与 llama-3.1-8b-instant 转为 Enterprise，免费档只剩 gpt-oss 与 qwen3.8-27b。全网 Groq 教程的 model 名集体失效。' },
  { date: '2026-09-02', level: 'warn', title: 'NotebookLM 调整用量上限',
    detail: '官方公告限额有变动，旧文章数字开始对不上。免费档概览类每日仅 3 次。' },
  { date: '2026-10-05', level: 'warn', title: 'OpenRouter 免费模型从 27 个缩到 17 个',
    detail: 'DeepSeek / Gemini / Mistral 已无 :free 端点。Poolside Laguna 两个模型 10-31 到期，Dots3-Note 12-31 到期。' },
  { date: '2026-10', level: 'warn', title: '硅基流动取消小模型永久免费',
    detail: '「9B 以下永久免费」政策失效，现仅 embedding / 语音 / OCR / 翻译 / Kolors 免费，新户改送约 ¥16 券。' }
];

/* 避坑清单 */
const PITFALLS = [
  { title: '把「一次性礼包」当产能', body: '阿里百炼 7000 万、智谱 2000 万、LongCat 1000 万都是 30~90 天过期的一次性额度。拿它跑每日定时任务，第 91 天整个流水线会静默断掉。' },
  { title: '网页免费 ≠ API 免费', body: 'ChatGPT、Kimi、豆包网页端都可以免费用，但都没有免费 API。凡是要自动化、要批量、要接进代码的，必须走 API 那一栏。' },
  { title: '多开 Key 不增加额度', body: 'Groq、Gemini、Copilot 的限额都是「按组织/按项目」计，同账号多建 Key 共享同一池子。多注册账号则违反条款，有封号风险。' },
  { title: '只盯 RPD，不看 TPM/TPD', body: 'Groq 免费档 8K TPM 往往比 1000 RPD 先撞墙——一次长 prompt 就吃掉一分钟预算。Gemini 的 per-minute 限制同理。' },
  { title: '信二手限速表', body: 'Gemini 免费限速本轮调研出现 20 / 250 / 500 / 1500 四个互相冲突的数字，因为 Google 已不再公布统一表。唯一可靠做法：查自己控制台的 rate-limit 页，或读响应头 x-ratelimit-*。' },
  { title: '用免费模型跑生产', body: '免费层普遍设有反滥用机制，且平台保留随时调整权。关键业务要么付费，要么自托管开源模型（n8n + Ollama），别把命脉押在免费额度上。' },
  { title: '忽略「免费层的训练条款」', body: 'Gemini 免费层明确会说你的数据可能用于改进产品，付费层不会。涉密研报、未公开财报数据不要喂给免费层。' }
];

/* 我的额度初始状态（用户可编辑，存 localStorage） */
const DEFAULT_WALLET = {
  zhipu: { enabled: true, used: 0, note: '主力常驻' },
  volc: { enabled: true, used: 0, note: '每日定时任务' },
  gemini: { enabled: true, used: 0, note: '多模态/长文' },
  groq: { enabled: false, used: 0, note: '' },
  openrouter: { enabled: false, used: 0, note: '' }
};
