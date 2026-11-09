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
  { key: 'verified',  label: '多源核实', cls: 'green', desc: '多来源一致 / 官方页面明确' },
  { key: 'reported',  label: '单源报道', cls: 'amber', desc: '单一来源，未经二次交叉验证' },
  { key: 'disputed',  label: '口径冲突', cls: 'red',   desc: '多个来源给出互相冲突的数字' }
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONF_META, CONF_FILTERS,
    confBreakdown, confFilterMatch, confBarHtml
  };
}
