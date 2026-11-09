/* ============================================================
   双源交叉校验（Cross-Check）
   ------------------------------------------------------------
   调研建议第 2 项：把「口径冲突清单」从单条冲突文字升级为
   多来源并列比对。本项目（hub）的接入结论，与两个独立社区
   追踪源逐家对照：
     - FreeToken        data/providers.json，2026-10-22 复核，含 verified 状态
     - free-llm-intel   每日巡检 70 家官网，2026-11-03 巡检
   另以 justjavac/free-models（仅收「有免费档」的中转站）作为
   「中转覆盖」补充维度（不同轴，不进冲突判定）。

   判定口径：把每个来源归一为 free / trial / none / unknown，
   只比对「有定论」的来源；两边定论互斥即标 conflict。
   ============================================================ */

const CROSSCHECK = [
  {
    id: 'openai', name: 'OpenAI (GPT)',
    hub:   { v: 'disputed', note: '三种说法矛盾：$5 试用金 / 无免费 / 数据共享换 token' },
    ft:    { kind: 'check', verified: false, claim: 'API 按独立计费账户；不保证所有新账号注册送 $5' },
    intel: null,
    relay: 'GPT 模型可经 agentrouter / siliconflow / opencode 等中转免费层调用'
  },
  {
    id: 'anthropic', name: 'Anthropic (Claude)',
    hub:   { v: 'limited', note: '注册约 $5 试用金（一次性，约 1 月过期），无长期免费速率档' },
    ft:    null,
    intel: null,
    relay: 'Claude 模型可经 agentrouter 等中转免费层调用'
  },
  {
    id: 'gemini', name: 'Google Gemini',
    hub:   { v: 'yes', note: 'Flash / Flash-Lite 免费层；RPD 各源冲突（20 / 250 / 500 / 1500）' },
    ft:    { kind: 'free', verified: true, claim: 'Gemini 2.5 Flash / Flash-Lite 部分模型有免费 token；RPM/TPM/RPD 按项目模型' },
    intel: { free: true, claim: '邮箱注册免信用卡；Gemini 3.x Flash 全系免费层，每日滚动重置' },
    relay: null
  },
  {
    id: 'deepseek', name: 'DeepSeek',
    hub:   { v: 'limited', note: '仅试用金；赠送 $5（≈500 万 token）与 ¥500 两种口径' },
    ft:    { kind: 'check', verified: false, claim: '原「注册送 500 万 Token」缺持续适用的官方证据；按量计费' },
    intel: { free: false, claim: '无免费模型层，全量按量计费（峰谷定价）；「500 万」不予采信' },
    relay: 'DeepSeek 模型广泛见于各中转免费层'
  },
  {
    id: 'bailian', name: '阿里云百炼（Qwen）',
    hub:   { v: 'limited', note: 'Token Factory 周额度折算；官方 4 款 Public Free 模型，未公示数字' },
    ft:    { kind: 'trial', verified: true, claim: '新人各模型通常赠 100 万 Token / 90 天，限北京，需实名' },
    intel: { free: true, claim: '独立 100 万 Token 免费 / 90 天（北京），需实名认证' },
    relay: null
  },
  {
    id: 'volc', name: '火山方舟（豆包）',
    hub:   { v: 'yes', note: 'Token Factory 折算；Doubao-Seed-2.1-pro 每日最高 500 万 vs 协作计划 200 万/日' },
    ft:    null,
    intel: null,
    relay: '豆包模型可经火山方舟 / 中转免费层调用'
  },
  {
    id: 'moonshot', name: 'Kimi（月之暗面）',
    hub:   { v: 'no', note: 'API 侧无免费额度；kimi-k2.5 / moonshot-v1 已退役；网页 ≠ API' },
    ft:    { kind: 'check', verified: false, claim: '旧「注册送 15 元」未找到可长期适用的公开说明' },
    intel: { free: true, claim: '实名送 15 元代金券（K3 / K3.1 Pro 不可用），属 B 类限时' },
    relay: 'Kimi 模型可经中转免费层调用'
  },
  {
    id: 'zhipu', name: '智谱 GLM',
    hub:   { v: 'yes', note: '4.x Flash 长期 0 元 + 2000 万新用户；总额口径 5000 万 / 7000 万冲突' },
    ft:    { kind: 'check', verified: false, claim: '部分历史活动或免费模型可能存在，暂无可统一适用结论' },
    intel: { free: true, claim: '4.x 代 Flash 长期 0 元 + 2000 万 tokens 新用户包' },
    relay: null
  },
  {
    id: 'minimax', name: 'MiniMax',
    hub:   { v: 'limited', note: '新户礼包 1 亿 / 2000 万 / 100 万三种；免费档并发 1 实测 vs 30 攻略' },
    ft:    null,
    intel: null,
    relay: 'MiniMax 模型可经中转免费层调用'
  },
  {
    id: 'xai', name: 'xAI (Grok)',
    hub:   { v: 'disputed', note: '$25 注册赠送 vs 官方文档未列任何免费额度' },
    ft:    { kind: 'check', verified: false, claim: '账户赠金和活动资格需以当前官方 Console 为准' },
    intel: null,
    relay: 'Grok 模型可经中转免费层调用'
  },
  {
    id: 'hunyuan', name: '腾讯混元',
    hub:   { v: 'limited', note: '新户礼包；另有来源赠 1 亿 / 100 万口径不一' },
    ft:    null,
    intel: { free: true, claim: '8 款模型共享 100 万 tokens + Embedding 100 万，需绑卡（C 类）' },
    relay: null
  },
  {
    id: 'qianfan', name: '百度千帆（文心）',
    hub:   { v: 'yes', note: '免费额度小且短命；「2000 补全 / 50 慢速请求」历史口径，官方页已不再写' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'spark', name: '讯飞星火',
    hub:   { v: 'limited', note: '端点 v1 / v2 并存；免费额度低，入口易选错' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'mistral', name: 'Mistral AI',
    hub:   { v: 'yes', note: 'Leanstral 免费端点；无新用户赠金' },
    ft:    { kind: 'check', verified: false, claim: '免费试用资格请以当前账号 Console 为准' },
    intel: { free: true, claim: '免费端点（非额度）：Leanstral / Labs 限时；无新用户赠金；旧 €5 无据' },
    relay: null
  },
  {
    id: 'llama', name: 'Meta Llama',
    hub:   { v: 'yes', note: 'Meta 无官方 API；经第三方 / 中转' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'sensenova', name: '商汤 SenseNova',
    hub:   { v: 'limited', note: 'compatible-mode/v1 存在（401）；老 /v1 返回 404' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'longcat', name: '美团 LongCat',
    hub:   { v: 'disputed', note: '速率 / 额度口径冲突' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'openrouter', name: 'OpenRouter',
    hub:   { v: 'yes', note: '免费模型 :free 档' },
    ft:    { kind: 'free', verified: true, claim: '免费模型 20 RPM / 50 请求日；$10 后至 1000 / 日' },
    intel: null,
    relay: null
  },
  {
    id: 'groq', name: 'Groq',
    hub:   { v: 'yes', note: '无付款方式永久免费层；30 RPM / 1000 RPD' },
    ft:    { kind: 'free', verified: true, claim: 'openai/gpt-oss-20b：30 RPM / 1000 RPD / 8000 TPM' },
    intel: { free: true, claim: '无需付款方式永久免费层：30 RPM / 1000 RPD' },
    relay: '本身是免费中继（部分模型不限量）'
  },
  {
    id: 'siliconflow', name: '硅基流动',
    hub:   { v: 'limited', note: '约 ¥16 券；小模型免费已取消' },
    ft:    { kind: 'mixed', verified: true, claim: '指定模型标记「免费」（Hunyuan-MT-7B / bge-m3 等）' },
    intel: null,
    relay: '本身是免费中继（新用户赠 14 元）'
  },
  {
    id: 'github-models', name: 'GitHub Models',
    hub:   { v: 'limited', note: 'GitHub Models 免费层（限量）' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'together', name: 'Together AI',
    hub:   { v: 'limited', note: '$1（publicapis）与 $5（getaiperks）两种注册赠送口径' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'cerebras', name: 'Cerebras',
    hub:   { v: 'yes', note: '官方 $5 / 30 天试用金（需绑卡）' },
    ft:    { kind: 'trial', verified: true, claim: '一次性 $5 试用金 / 30 天，需有效支付方式' },
    intel: { free: true, claim: '$5 赠金 / 30 天需绑卡' },
    relay: null
  },
  /* 2026-11-10 补录：这两家在平台库里是 daily/api、端点表也有 base_url，
     却没进接入总表，被 ccVerdictOf 判成「未覆盖」——那是轴的漏项，不是
     形态不同。FreeToken / free-llm-intel 都没收录它们，所以判定是「仅本项目覆盖」。 */
  {
    id: 'modelscope', name: '魔搭 ModelScope',
    hub:   { v: 'yes', note: 'API-Inference 开源模型每日免费调用；2000 次/日 与 250 魔粒/日 两套口径冲突' },
    ft:    null,
    intel: null,
    relay: null
  },
  {
    id: 'amd-radeon', name: 'AMD Radeon Cloud Token Factory',
    hub:   { v: 'yes', note: '官方列 4 款 Public Free 模型、按 points 每日重置；二手来源称含旗舰，官方不支持' },
    ft:    null,
    intel: null,
    relay: null
  }
];

/* 把来源归一为立场：free / trial / none / unknown / na */
function ccStanceHub(it) {
  return { yes: 'free', limited: 'trial', no: 'none', disputed: 'unknown' }[it.hub.v] || 'unknown';
}
function ccStanceFt(it) {
  if (!it.ft) return 'na';
  return { free: 'free', trial: 'trial', mixed: 'trial', paid: 'none', check: 'unknown' }[it.ft.kind] || 'unknown';
}
function ccStanceIntel(it) {
  if (!it.intel) return 'na';
  if (it.intel.free === true) return 'free';
  if (it.intel.free === false) return 'none';
  return 'unknown';
}
const CC_DEF = s => s === 'free' || s === 'trial' || s === 'none';

/* 计算逐项判定 */
function ccVerdict(it) {
  const h = ccStanceHub(it), f = ccStanceFt(it), n = ccStanceIntel(it);
  const defs = [h, f, n].filter(CC_DEF);
  const has = defs.some(s => s === 'free' || s === 'trial');
  const none = defs.some(s => s === 'none');
  if (has && none) return { key: 'conflict', label: '冲突', cls: 'red' };
  const hubDef = CC_DEF(h), ftDef = CC_DEF(f), inDef = CC_DEF(n);
  if (hubDef && !ftDef && !inDef) return { key: 'solo', label: '仅本项目覆盖', cls: 'ghost' };
  if (!hubDef && (ftDef || inDef)) return { key: 'gap', label: '外部有结论·本项目待核', cls: 'amber' };
  if (hubDef && (ftDef || inDef)) return { key: 'agree', label: '一致', cls: 'green' };
  return { key: 'unknown', label: '待核', cls: 'ghost' };
}

const CC_ORDER = { conflict: 0, gap: 1, unknown: 2, solo: 3, agree: 4 };
const CC_STANCE_LABEL = { free: '有免费层', trial: '试用/赠金', none: '无免费', unknown: '未核实', na: '未覆盖' };
function ccStanceCls(s) {
  return { free: 'green', trial: 'amber', none: 'red', unknown: 'ghost', na: 'ghost' }[s] || 'ghost';
}

/* ============================================================
   外部来源元数据与新鲜度
   ------------------------------------------------------------
   build.py 会把仓库根的 crosscheck-sources.json 内联成 CC_SOURCES_SNAPSHOT，
   由 probe.yml 每 6 小时重新抓一次三个来源的公开时间戳。抓不到就沿用
   CC_SOURCES_BASE 的基线日期，并把 status 标成 unreachable —— 不假装更新过。
   ============================================================ */
const CC_SOURCES_BASE = [
  { id: 'freetoken', name: 'FreeToken',          checkedAt: '2026-10-22', axis: '额度口径', url: 'https://github.com/AIPMAndy/FreeToken/blob/main/data/providers.json' },
  { id: 'intel',     name: 'free-llm-intel',    checkedAt: '2026-11-03', axis: '额度口径', url: 'https://github.com/rockbenben/free-llm-intel' },
  { id: 'relays',    name: 'justjavac/free-models', checkedAt: null,     axis: '中转覆盖', url: 'https://models.denohub.com/catalog.json' }
];

function ccEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 距今小时数；解析不了返回 null */
function ccHoursSince(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!t) return null;
  const base = now == null ? Date.now() : (typeof now === 'number' ? now : Date.parse(now));
  if (!base) return null;
  return (base - t) / 3600000;
}
function ccDaysSince(iso, now) {
  const h = ccHoursSince(iso, now);
  return h == null ? null : Math.floor(h / 24);
}

/* 连通性轴按小时、口径轴按天 —— 阈值不同才诚实 */
function ccFreshLevel(iso, axis, now) {
  const h = ccHoursSince(iso, now);
  if (h == null) return { cls: 'ghost', text: '时间不明' };
  if (h < 0) return { cls: 'ghost', text: '时间异常' };
  if (axis === '连通性') {
    if (h <= 8) return { cls: 'green', text: '新鲜' };
    if (h <= 24) return { cls: 'amber', text: '偏旧' };
    return { cls: 'red', text: '已过期' };
  }
  const d = h / 24;
  if (d <= 30) return { cls: 'green', text: '新鲜' };
  if (d <= 60) return { cls: 'amber', text: '偏旧' };
  return { cls: 'red', text: '已过期' };
}

/* 状态文案：只有 ok 才是「这轮真的复核过了」。
   其余一律明说日期从哪来，别拿基线的天数冒充新鲜度。 */
const CC_STATUS_NOTE = {
  unreachable: '本次联网复核失败，沿用基线',
  'no-date':   '本轮未取到时间戳，沿用基线',
  offline:     '离线基线，未经 CI 复核',
  baseline:    '人工核实，非自动更新',
  missing:     '尚未跑过探活'
};
function ccStatusNote(status) {
  return CC_STATUS_NOTE[status] || '';
}

/* 纯函数：生成新鲜度条的行，单测直接喂固定时间 */
function ccFreshnessRows(now, srcSnap, probeSnap, dataDate) {
  const snap = srcSnap && Array.isArray(srcSnap.sources) ? srcSnap.sources : [];
  const byId = {};
  snap.forEach(s => { if (s && s.id) byId[s.id] = s; });
  const rows = [
    { id: 'hub', name: '本项目额度口径', axis: '额度口径', checkedAt: dataDate || '2026-10-20', status: 'baseline', note: '人工核实，非自动更新' }
  ];
  CC_SOURCES_BASE.forEach(b => {
    const s = byId[b.id];
    const checkedAt = (s && s.checkedAt) || b.checkedAt;
    rows.push({
      id: b.id, name: b.name, axis: b.axis, url: b.url,
      checkedAt: checkedAt,
      status: s ? (s.status || 'ok') : 'baseline',
      note: s ? (s.note || '') : '基线日期，CI 未复核'
    });
  });
  rows.push({
    id: 'probe', name: '端点探活', axis: '连通性',
    checkedAt: probeSnap && probeSnap.generatedAt ? probeSnap.generatedAt : null,
    status: probeSnap ? 'ok' : 'missing',
    note: probeSnap ? 'GET /models，不消耗额度' : '尚未跑过探活'
  });
  return rows.map(r => {
    const h = ccHoursSince(r.checkedAt, now);
    return Object.assign({}, r, {
      hours: h,
      days: h == null ? null : Math.floor(h / 24),
      level: ccFreshLevel(r.checkedAt, r.axis, now)
    });
  });
}

function ccSourcesSnapshot() {
  return (typeof CC_SOURCES_SNAPSHOT !== 'undefined' && CC_SOURCES_SNAPSHOT) || null;
}
function ccProbeSnapshot() {
  return (typeof PROBE_SNAPSHOT !== 'undefined' && PROBE_SNAPSHOT) || null;
}

/* ============================================================
   联动：接入核验 ↔ 交叉校验
   ------------------------------------------------------------
   用 document.body.dataset 传「要聚焦谁」，避免引入跨模块全局变量；
   切视图后由目标 render 消费一次即清掉，不会残留误高亮。
   ============================================================ */
function ccFocusVerify(id) {
  if (typeof document === 'undefined' || !id) return;
  document.body.dataset.qhFocus = id;
  if (typeof switchView === 'function') switchView('verify');
}
function ccFocusCross(id) {
  if (typeof document === 'undefined' || !id) return;
  document.body.dataset.qhFocus = id;
  if (typeof switchView === 'function') switchView('crosscheck');
}
function ccApplyFocus(attr, cls) {
  if (typeof document === 'undefined') return '';
  const id = document.body.dataset.qhFocus || '';
  if (!id) return '';
  delete document.body.dataset.qhFocus;
  const el = document.querySelector('[' + attr + '="' + id.replace(/"/g, '') + '"]');
  if (el) {
    el.classList.add(cls || 'cc-focus');
    if (typeof setTimeout === 'function') {
      setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }, 90);
    }
  }
  return id;
}

/* 给接入核验卡片用：把三方说法结构化吐出去 */
function ccEvidenceFor(id) {
  const it = CROSSCHECK.find(c => c.id === id);
  if (!it) return null;
  const sources = [];
  if (it.ft) sources.push({ name: 'FreeToken', claim: it.ft.claim, stance: ccStanceFt(it), verified: !!it.ft.verified });
  if (it.intel) sources.push({ name: 'free-llm-intel', claim: it.intel.claim, stance: ccStanceIntel(it) });
  return { id, name: it.name, verdict: ccVerdict(it), hub: it.hub.note, sources, relay: it.relay };
}

const CC_BADGE_TEXT = { conflict: '冲突', gap: '待核', unknown: '待核', solo: '单源', agree: '一致' };
/* 给平台库卡片用的轻量角标：只给一个字 + title，不堆数据 */
function ccBadgeFor(id) {
  const it = CROSSCHECK.find(c => c.id === id);
  if (!it) return '';
  const v = ccVerdict(it);
  const tip = ccEvidenceFor(id);
  const detail = tip && tip.sources.length
    ? tip.sources.map(s => s.name + '：' + s.claim).join(' / ')
    : '外部追踪源未收录，本项目口径为唯一来源';
  return `<span class="cc-badge cc-badge-${ccEsc(v.key)}" data-ccgo="${ccEsc(it.id)}" ` +
    `title="交叉校验 · ${ccEsc(v.label)}｜${ccEsc(detail)}｜点此跳到三方比对">校验·${ccEsc(CC_BADGE_TEXT[v.key])}</span>`;
}

/* ============================================================
   平台库筛选与「未覆盖」说明
   ------------------------------------------------------------
   交叉校验比的是「厂商官方免费 API 层」这一根轴，接入总表收
   能拿 API key 直连的 25 家（2026-11-10 补入 modelscope / amd-radeon）。
   平台库另外 24 家是网页版 / IDE 工具 / 自托管 / 图像视频 /
   一次性礼包 —— 不是漏数据，是轴的边界。
   下面几个纯函数让筛选和说明都从数据推导，不手写名单。
   ============================================================ */

const CC_FILTERS = [
  ['all', '全部'], ['conflict', '冲突'], ['pending', '待核'],
  ['agree', '一致'], ['solo', '单源'], ['none', '未覆盖']
];

/* 不在接入总表里的平台判为 none（未覆盖），不假装给它一个定论 */
function ccVerdictOf(id) {
  const it = CROSSCHECK.find(c => c.id === id);
  return it ? ccVerdict(it).key : 'none';
}

function ccFilterMatch(id, filter) {
  if (!filter || filter === 'all') return true;
  const v = ccVerdictOf(id);
  if (filter === 'none') return v === 'none';
  if (filter === 'pending') return v === 'gap' || v === 'unknown';
  return v === filter;
}

/* 分组按优先级命中第一条；最后一条兜底，保证不丢条目 */
const CC_UNCOVERED_GROUPS = [
  { key: 'selfhost', label: '开源自托管',
    note: '软件本身免费，成本落在你自己的硬件 / 服务器上，没有厂商额度口径可比。',
    match: p => p.quotaType === 'selfhost' },
  { key: 'freechat', label: '网页 / 客户端免费版',
    note: '无开放 API、不能自动化调用；三个外部追踪源都只记录 API 层。',
    match: p => p.quotaType === 'freechat' },
  { key: 'onetime', label: '一次性礼包 / 试用金',
    note: '注册赠送、会过期，不是稳定免费层，口径随活动变动，不进常态比对。',
    match: p => p.quotaType === 'gift' || p.quotaType === 'trial' },
  { key: 'coding', label: 'IDE / 编程工具订阅',
    note: '额度挂在工具订阅或席位上，不是可路由的 API key。',
    match: p => p.cat === 'coding' },
  { key: 'media', label: '图像 / 视频生成产品',
    note: '按次数或时长计费，与 token 额度不是同一根轴。',
    match: p => p.cat === 'image' || p.cat === 'video' },
  { key: 'relay', label: '聚合 / 中转站',
    note: '非厂商官方 API 本体，或新收录尚未进接入总表，待补核验。',
    match: p => p.cat === 'api' },
  { key: 'product', label: '其它产品形态',
    note: '按任务 / 席位 / 会话给额度，无法与官方 API 免费层并列比对。',
    match: () => true }
];

function ccUncovered(platforms) {
  const rest = platforms.filter(p => ccVerdictOf(p.id) === 'none');
  const buckets = new Map(CC_UNCOVERED_GROUPS.map(g => [g.key, []]));
  const fallback = CC_UNCOVERED_GROUPS[CC_UNCOVERED_GROUPS.length - 1];
  rest.forEach(p => {
    const g = CC_UNCOVERED_GROUPS.find(x => x.match(p)) || fallback;
    buckets.get(g.key).push({ id: p.id, name: p.name });
  });
  const groups = CC_UNCOVERED_GROUPS
    .filter(g => buckets.get(g.key).length)
    .map(g => ({ key: g.key, label: g.label, note: g.note, items: buckets.get(g.key) }));
  return {
    total: platforms.length,
    covered: platforms.length - rest.length,
    uncovered: rest.length,
    groups
  };
}

let __ccFilter = 'all';

/* 视图渲染（仅浏览器内调用） */
function renderCrosscheck() {
  const wrap = document.getElementById('view-crosscheck');
  if (!wrap) return;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = CROSSCHECK.map(it => ({ it, v: ccVerdict(it) }))
    .sort((a, b) => (CC_ORDER[a.v.key] - CC_ORDER[b.v.key]) || a.it.name.localeCompare(b.it.name, 'zh'));

  const cnt = { agree: 0, conflict: 0, gap: 0, solo: 0, unknown: 0 };
  rows.forEach(r => cnt[r.v.key]++);

  /* 新鲜度：三源核实日期 + 最近一次探活，全部来自可复核的时间戳 */
  const srcSnap = ccSourcesSnapshot();
  const freshRows = ccFreshnessRows(
    Date.now(), srcSnap, ccProbeSnapshot(),
    (typeof DATA_DATE !== 'undefined' ? DATA_DATE : '2026-10-20')
  );
  const fetchedAt = srcSnap && srcSnap.fetchedAt ? srcSnap.fetchedAt : null;

  /* 必须返回完整 <td>：<div> 直接放进 <tr> 会被浏览器 foster-parent 到表格外，
     证据列会整片跑到表格下方，看起来像「列没对齐」。 */
  const cell = (stance, claim) => {
    const s = stance;
    return `<td><div class="cc-cell"><span class="chip ${ccStanceCls(s)}">${CC_STANCE_LABEL[s]}</span>` +
      (claim ? `<span class="cc-claim">${esc(claim)}</span>` : '<span class="cc-claim cc-muted">—</span>') + '</div></td>';
  };

  const filtered = __ccFilter === 'all' ? rows : rows.filter(r => r.v.key === __ccFilter);

  const filterBtn = (key, label, n) =>
    `<button class="cc-f ${__ccFilter === key ? 'on' : ''}" data-ccf="${key}">${label} <b>${n}</b></button>`;

  wrap.innerHTML = `
    <div class="sec-head">
      <h2>多来源口径交叉校验</h2>
      <span class="hint">本项目 vs FreeToken vs free-llm-intel · 点厂商名跳到接入核验</span>
    </div>

    <div class="card cc-fresh">
      <div class="cc-fresh-head">
        <b>数据新鲜度</b>
        <span>${fetchedAt ? 'CI 最近复核 ' + esc(fetchedAt.replace('T', ' ').replace('Z', ' UTC')) : '尚未联网复核，以下为基线日期'}</span>
      </div>
      <div class="cc-fresh-grid">
        ${freshRows.map(r => `
          <div class="cc-fresh-item" data-ccstatus="${ccEsc(r.status)}">
            <span class="chip ${r.level.cls}">${esc(r.level.text)}</span>
            <b>${esc(r.name)}</b>
            <span class="cc-fresh-meta">${esc(r.axis)} · ${esc(r.checkedAt || '时间不明')}${r.days != null ? ' · 距今 ' + r.days + ' 天' : ''}</span>
            ${ccStatusNote(r.status) ? `<em class="${r.status === 'baseline' ? 'cc-note-neutral' : ''}">${ccEsc(ccStatusNote(r.status))}</em>` : ''}
          </div>`).join('')}
      </div>
      <p class="cc-fresh-note"><b>别把两种新鲜度混为一谈：</b>探活只回答「端点接不接得通」，不更新任何额度口径；
        三源日期来自各自公开台账 / 巡检时间戳，CI 每 6 小时复核的是<b>时间戳</b>，不会替你重新核额度。
        口径超过 30 天的，仍请到平台控制台确认。</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="k-label">核验厂商</div><div class="k-val">${CROSSCHECK.length}</div><div class="k-foot">接入总表全覆盖</div></div>
      <div class="kpi"><div class="k-label">三方一致</div><div class="k-val k-green">${cnt.agree}</div><div class="k-foot">存在性无分歧</div></div>
      <div class="kpi"><div class="k-label">口径冲突</div><div class="k-val k-red">${cnt.conflict}</div><div class="k-foot">定论互斥，需控制台确认</div></div>
      <div class="kpi"><div class="k-label">仅本项目覆盖</div><div class="k-val">${cnt.solo}</div><div class="k-foot">外部追踪源未收录</div></div>
      <div class="kpi"><div class="k-label">待核</div><div class="k-val">${cnt.gap + cnt.unknown}</div><div class="k-foot">外部亦无定论</div></div>
    </div>

    <div class="card cc-joint" id="cc-joint">
      ${typeof confJointHtml === 'function'
        ? confJointHtml(confJoint(PLATFORMS), state.filters.cc, state.filters.conf)
        : ''}
    </div>

    <div class="cc-filters">
      ${filterBtn('all', '全部', CROSSCHECK.length)}
      ${filterBtn('conflict', '冲突', cnt.conflict)}
      ${filterBtn('gap', '缺口', cnt.gap)}
      ${filterBtn('solo', '仅本项目', cnt.solo)}
      ${filterBtn('agree', '一致', cnt.agree)}
    </div>

    <div class="card cc-wrap">
      <table class="cc-table">
        <thead><tr>
          <th>厂商</th><th>本项目</th><th>FreeToken</th><th>free-llm-intel</th><th>中转覆盖</th><th>判定</th>
        </tr></thead>
        <tbody>
          ${filtered.map(({ it, v }) => `
            <tr data-ccid="${esc(it.id)}" class="${v.key === 'conflict' ? 'cc-row-conflict' : ''}">
              <td class="cc-name"><button class="cc-link" data-ccv="${esc(it.id)}" title="到接入核验看端点 / 环境变量 / 出处">${esc(it.name)} <span>→</span></button></td>
              ${cell(ccStanceHub(it), it.hub.note)}
              ${cell(ccStanceFt(it), it.ft ? it.ft.claim : null)}
              ${cell(ccStanceIntel(it), it.intel ? it.intel.claim : null)}
              <td class="cc-relay">${it.relay ? esc(it.relay) : '<span class="cc-muted">—</span>'}</td>
              <td><span class="chip ${v.cls}">${esc(v.label)}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${filtered.length === 0 ? '<div class="sch-empty">该分类下暂无条目</div>' : ''}
    </div>

    <div class="cc-note">
      <b>怎么读这张表：</b>「冲突」= 本项目与外部追踪源对「有没有免费 API」给出互斥定论，以各平台控制台实际生效规则为准；
      「仅本项目覆盖」= FreeToken / free-llm-intel 未收录该厂商，本项目的口径是唯一来源，更新时优先复核；
      「中转覆盖」是 justjavac/free-models 维度（哪些中转站提供免费层），与「官方免费层」不是同一轴，仅供参考。
    </div>`;

  wrap.querySelectorAll('[data-ccf]').forEach(b => {
    b.addEventListener('click', () => { __ccFilter = b.dataset.ccf; renderCrosscheck(); });
  });
  wrap.querySelectorAll('[data-ccv]').forEach(b => {
    b.addEventListener('click', () => ccFocusVerify(b.dataset.ccv));
  });
  /* 联合分布：一个格子 = 两个筛选条件，图省事但要说清楚 */
  wrap.querySelectorAll('[data-jcc]').forEach(b => {
    b.addEventListener('click', () => {
      const parts = String(b.dataset.jcc).split('|');
      if (typeof confFocusCross === 'function') confFocusCross(parts[0], parts[1]);
    });
  });
  ccApplyFocus('data-ccid', 'cc-focus');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CROSSCHECK, CC_SOURCES_BASE, CC_BADGE_TEXT, CC_STATUS_NOTE,
    CC_FILTERS, CC_UNCOVERED_GROUPS,
    ccVerdictOf, ccFilterMatch, ccUncovered,
    ccStanceHub, ccStanceFt, ccStanceIntel, ccVerdict, ccStanceCls, CC_STANCE_LABEL,
    ccStatusNote,
    ccEsc, ccHoursSince, ccDaysSince, ccFreshLevel, ccFreshnessRows,
    ccSourcesSnapshot, ccProbeSnapshot, ccEvidenceFor, ccBadgeFor,
    ccFocusVerify, ccFocusCross, ccApplyFocus, renderCrosscheck
  };
}
