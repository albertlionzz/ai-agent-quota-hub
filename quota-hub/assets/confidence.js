/* ============================================================
   数据可信度分布（confidence distribution）
   ------------------------------------------------------------
   平台库每条额度都带 confidence：verified / reported / disputed。
   此前它只以卡片角上一个「存疑」小字出现，用户看不出整张表到底
   有多少是硬事实、多少是单源说法。这里把它做成一条可点的堆叠条：
     - 段宽 = 该档在当前筛选结果里的占比
     - 点段或图例 = 按可信度筛平台库，状态随 UI 偏好持久化
     - 统计口径刻意**排除 conf 自己的筛选**（facet）：否则点一下
       「单源」分布条就只剩一整条，失去「看全貌」的意义

   纯函数 + 返回 HTML 字符串，不碰 DOM，方便单测直接 require。
   ============================================================ */

const CONF_META = [
  { key: 'verified',  label: '多源核实', short: '核实', cls: 'green', desc: '多来源一致 / 官方页面明确' },
  { key: 'reported',  label: '单源报道', short: '单源', cls: 'amber', desc: '单一来源，未经二次交叉验证' },
  { key: 'disputed',  label: '口径冲突', short: '冲突', cls: 'red',   desc: '多个来源给出互相冲突的数字' }
];

const CONF_FILTERS = [['all', '全部']].concat(CONF_META.map(m => [m.key, m.label]));

function confBreakdown(platforms) {
  const list = Array.isArray(platforms) ? platforms : [];
  const counts = {};
  CONF_META.forEach(m => { counts[m.key] = 0; });
  let unknown = 0;
  list.forEach(p => {
    const k = p && p.confidence;
    if (Object.prototype.hasOwnProperty.call(counts, k)) counts[k]++;
    else unknown++;
  });
  const total = list.length;
  const rows = CONF_META.map(m => ({
    key: m.key, label: m.label, cls: m.cls, desc: m.desc,
    count: counts[m.key],
    share: total ? Math.round(counts[m.key] * 1000 / total) / 10 : 0
  }));
  return { total, rows, unknown };
}

function confFilterMatch(p, filter) {
  if (!filter || filter === 'all') return true;
  return !!p && p.confidence === filter;
}

function confEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* current 是 state.filters.conf；只影响高亮，不影响统计数字 */
function confBarHtml(breakdown, current) {
  const bd = breakdown || { total: 0, rows: [], unknown: 0 };
  const cur = current || 'all';
  const active = CONF_META.some(m => m.key === cur) ? cur : 'all';
  const aria = '数据可信度分布：' + bd.rows.map(r => r.label + ' ' + r.count + ' 条').join('，')
    + (bd.unknown ? '，未分级 ' + bd.unknown + ' 条' : '');

  const segs = bd.rows.map(r => {
    const title = r.label + ' ' + r.count + ' 条（' + r.share + '%）· ' + r.desc;
    return `<button type="button" class="cd-seg cd-${r.cls}${active === r.key ? ' on' : ''}" ` +
      `data-conf="${r.key}" style="width:${r.share}%" title="${confEsc(title)}" ` +
      `aria-label="${confEsc(title)}">${r.count}</button>`;
  }).join('');

  const keys = bd.rows.map(r =>
    `<button type="button" class="cd-key${active === r.key ? ' on' : ''}" data-conf="${r.key}" ` +
      `title="${confEsc(r.desc)}"><i class="cd-dot cd-${r.cls}"></i>` +
      `<span>${confEsc(r.label)}</span><b>${r.count}</b><em>${r.share}%</em></button>`
  ).join('');

  return `<div class="cd-head">
      <b>数据可信度分布</b>
      <span>基于当前其它筛选条件的 <b>${bd.total}</b> 条${bd.unknown ? '（未分级 ' + bd.unknown + ' 条）' : ''} · 点色块筛选</span>
    </div>
    <div class="cd-bar" role="img" aria-label="${confEsc(aria)}">${segs}</div>
    <div class="cd-legend">${keys}
      <button type="button" class="cd-key cd-clear${active === 'all' ? ' on' : ''}" data-conf="all">清除筛选</button>
    </div>
    <p class="cd-note"><b>核实</b>= 多来源一致 / 官方明确，<b>单源</b>= 未二次交叉验证，
      <b>冲突</b>= 多来源数字打架。分布按<b>除可信度外</b>的其它条件统计，
      所以点选后仍看得到完整全貌；口径超过 30 天的，仍请到控制台复核。</p>`;
}

/* ============================================================
   判定 × 可信度：联合分布矩阵
   ------------------------------------------------------------
   前面的堆叠条只回答「这份数据有多可信」，交叉校验只回答「和外部
   源对不对得上」。两根轴分开看都容易误读：
     - 一致 × 单源  → 三家说法一样，但都只核过一次，别当硬事实
     - 未覆盖 × 核实 → 不是三方比对漏了，而是它压根不在 API 轴上
   5 × 3 的格子把这件事一次说清，点格子 = 同时套用两个筛选条件。
   统计口径与分布条一致：都用未套 conf / cc 的底表，所以矩阵永远
   显示全貌，选中格只是高亮。
   ============================================================ */

const CONF_CC_ROWS = [
  { key: 'conflict', cc: 'conflict', label: '口径冲突', note: '与外部源定论互斥' },
  { key: 'pending',  cc: 'pending',  label: '待核',     note: '外部亦无定论' },
  { key: 'agree',    cc: 'agree',    label: '三方一致', note: '存在性无分歧' },
  { key: 'solo',     cc: 'solo',     label: '仅本项目', note: '外部源未收录' },
  { key: 'none',     cc: 'none',     label: '未覆盖',   note: '不在 API 轴' }
];

/* 与 --green / --amber / --red 同色，只取 RGB 做半透明热力底 */
const CONF_RGB = { verified: '18,128,92', reported: '154,101,18', disputed: '184,52,44' };

function confJoint(platforms) {
  const list = Array.isArray(platforms) ? platforms : [];
  const colTotals = CONF_META.map(() => 0);
  const rows = CONF_CC_ROWS.map(r => ({
    key: r.key, cc: r.cc, label: r.label, note: r.note,
    cells: CONF_META.map(() => 0), other: 0, total: 0
  }));
  let other = 0;   // 可信度未分级的条目，单独计数不塞进某一格
  list.forEach(p => {
    /* 脏数据（null / 缺 id）不能把整张矩阵带崩，按「未覆盖 + 未分级」计入 */
    const v = typeof ccVerdictOf === 'function' && p && p.id ? ccVerdictOf(p.id) : 'none';
    const key = (v === 'gap' || v === 'unknown') ? 'pending' : v;
    const row = rows.find(r => r.key === key) || rows[rows.length - 1];
    const ci = CONF_META.findIndex(m => m.key === (p && p.confidence));
    row.total++;
    if (ci >= 0) { row.cells[ci]++; colTotals[ci]++; }
    else { row.other++; other++; }
  });
  const max = Math.max(1, ...rows.map(r => Math.max(...r.cells)), ...colTotals);
  const total = rows.reduce((a, r) => a + r.total, 0);
  return { total, rows, cols: CONF_META, colTotals, other, max };
}

function confJointHtml(joint, curCc, curConf) {
  const j = joint && Array.isArray(joint.rows) && joint.rows.length
    ? joint
    : { total: 0, rows: [], cols: CONF_META, colTotals: [0, 0, 0], other: 0, max: 1 };
  const ccCur = curCc || 'all';
  const cfCur = curConf || 'all';

  const head = j.cols.map(c =>
    `<th scope="col"><i class="cd-dot cd-${c.cls}"></i>` +
    `<span class="cj-hl">${confEsc(c.label)}</span>` +
    `<span class="cj-hs">${confEsc(c.short || c.label)}</span></th>`
  ).join('');

  const body = j.rows.map(r => {
    const tds = r.cells.map((n, i) => {
      const c = j.cols[i];
      const label = r.label + ' × ' + c.label + '：' + n + ' 条';
      if (!n) return `<td class="cj-cell cj-empty" title="${confEsc(label)}">0</td>`;
      const a = (0.08 + 0.42 * n / j.max).toFixed(3);
      const on = ccCur === r.cc && cfCur === c.key;
      return `<td class="cj-cell"><button type="button" class="cj-btn${on ? ' on' : ''}" ` +
        `style="background:rgba(${CONF_RGB[c.key]},${a})" data-jcc="${r.cc}|${c.key}" ` +
        `title="${confEsc(label + ' · 点此同时套用两个筛选')}" ` +
        `aria-label="${confEsc(label)}">${n}</button></td>`;
    }).join('');
    return `<tr${ccCur === r.cc ? ' class="cj-row-on"' : ''}>` +
      `<th scope="row"><b>${confEsc(r.label)}</b><em>${confEsc(r.note)}</em></th>` +
      `${tds}<td class="cj-tot">${r.total}</td></tr>`;
  }).join('');

  const foot = j.cols.map((c, i) => `<td class="cj-tot">${j.colTotals[i]}</td>`).join('');

  return `<div class="cd-head">
      <b>判定 × 可信度 联合分布</b>
      <span>行列交叉共 <b>${j.total}</b> 条${j.other ? '（另有 ' + j.other + ' 条可信度未分级）' : ''} · 点格子同时套用两个筛选</span>
    </div>
    <table class="cj-table" aria-label="交叉校验判定与数据可信度的联合分布">
      <thead><tr><th scope="col" class="cj-corner"><span class="cj-hl">交叉校验 ↓ / 可信度 →</span><span class="cj-hs">校验↓<br>可信→</span></th>${head}<th scope="col" class="cj-tot">合计</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><th scope="row">合计</th>${foot}<td class="cj-tot">${j.total}</td></tr></tfoot>
    </table>
    <p class="cd-note"><b>怎么读：</b>「三方一致 × 单源」= 三家说法一致，但都只核过一次，别当硬事实；
      「未覆盖 × 核实」= 它不在「官方免费 API」这根轴上，不是比对漏了。矩阵按<b>未套用</b>这两个筛选的底表统计，
      所以选中格子后仍看得到全貌。</p>`;
}

/* 点格子：两个筛选一起套上，再跳到平台库看结果 */
function confFocusCross(ccVal, confVal) {
  if (typeof state === 'object' && state && state.filters) {
    state.filters.cc = ccVal || 'all';
    state.filters.conf = confVal || 'all';
    if (typeof saveUI === 'function') saveUI();
  }
  if (typeof switchView === 'function') switchView('registry');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONF_META, CONF_FILTERS, CONF_CC_ROWS,
    confBreakdown, confFilterMatch, confBarHtml,
    confJoint, confJointHtml, confFocusCross
  };
}
