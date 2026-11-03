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

  const cell = (stance, claim) => {
    const s = stance;
    return `<div class="cc-cell"><span class="chip ${ccStanceCls(s)}">${CC_STANCE_LABEL[s]}</span>` +
      (claim ? `<span class="cc-claim">${esc(claim)}</span>` : '<span class="cc-claim cc-muted">—</span>') + '</div>';
  };

  const filtered = __ccFilter === 'all' ? rows : rows.filter(r => r.v.key === __ccFilter);

  const filterBtn = (key, label, n) =>
    `<button class="cc-f ${__ccFilter === key ? 'on' : ''}" data-ccf="${key}">${label} <b>${n}</b></button>`;

  wrap.innerHTML = `
    <div class="sec-head">
      <h2>多来源口径交叉校验</h2>
      <span class="hint">本项目 vs FreeToken(2026-10-22) vs free-llm-intel(2026-11-03)</span>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="k-label">核验厂商</div><div class="k-val">${CROSSCHECK.length}</div><div class="k-foot">接入总表全覆盖</div></div>
      <div class="kpi"><div class="k-label">三方一致</div><div class="k-val k-green">${cnt.agree}</div><div class="k-foot">存在性无分歧</div></div>
      <div class="kpi"><div class="k-label">口径冲突</div><div class="k-val k-red">${cnt.conflict}</div><div class="k-foot">定论互斥，需控制台确认</div></div>
      <div class="kpi"><div class="k-label">仅本项目覆盖</div><div class="k-val">${cnt.solo}</div><div class="k-foot">外部追踪源未收录</div></div>
      <div class="kpi"><div class="k-label">待核</div><div class="k-val">${cnt.gap + cnt.unknown}</div><div class="k-foot">外部亦无定论</div></div>
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
            <tr class="${v.key === 'conflict' ? 'cc-row-conflict' : ''}">
              <td class="cc-name">${esc(it.name)}</td>
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CROSSCHECK, ccStanceHub, ccStanceFt, ccStanceIntel,
    ccVerdict, ccStanceCls, CC_STANCE_LABEL, renderCrosscheck
  };
}
