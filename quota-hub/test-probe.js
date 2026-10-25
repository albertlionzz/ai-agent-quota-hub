/* probe.js（前端探活卡片）测试：时间表述、状态排序、转义、空态、file:// 行为 */
const fs = require('fs');
const path = require('path');

const A = p => path.join(__dirname, 'assets', p);

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const src = fs.readFileSync(A('probe.js'), 'utf8');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function load(snapshot, opts) {
  const o = opts || {};
  const els = {};
  const mk = id => {
    els['#' + id] = {
      id, innerHTML: '', files: null,
      addEventListener() {}, click() {}, classList: { toggle() {}, add() {}, remove() {} },
    };
    return els['#' + id];
  };
  const body = mk('probe-body');
  const api = {};
  const prologue = `
    const __els = arguments[0], __doc = arguments[1], __loc = arguments[2];
    const $ = s => __els[s] || null;
    const PROBE_SNAPSHOT = ${JSON.stringify(snapshot)};
    const VENDOR_ACCESS = ${JSON.stringify(o.vendors || [
      { id: 'a', name: '甲平台' }, { id: 'b', name: '乙平台' }, { id: 'c', name: '丙平台' },
    ])};
    const location = __loc;
    const document = __doc;
    const FileReader = function () {};
    const esc = arguments[4];
  `;
  const epilogue = `
    Object.assign(arguments[3], { renderProbe, probeFetch, probeAgo, probeFreshness,
      PROBE_STATUS, PROBE_ORDER, PROBE_STATE, probeShortName });
  `;
  const fn = new Function(prologue + src + epilogue);
  fn(els, { body }, { protocol: o.protocol || 'file:' }, api, esc);
  return { api, body, els };
}

const snap = {
  schema: 1,
  generatedAt: new Date(Date.now() - 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z'),
  runner: 'github-actions',
  total: 3,
  probed: 3,
  counts: { ok: 1, notfound: 1, auth: 1 },
  results: {
    a: { status: 'ok', http: 200, ms: 120, models: 5, keyed: true, at: 'x' },
    b: { status: 'notfound', http: 404, ms: 90, keyed: false, detail: 'no Route matched with those values', at: 'x' },
    c: { status: 'auth', http: 401, ms: 80, keyed: false, detail: 'Header中未收到Authorization', at: 'x' },
  },
};

console.log('时间表述');
{
  const { api } = load(null);
  const now = new Date().toISOString();
  T('刚生成 → 刚刚', () => assert(api.probeAgo(now) === '刚刚', api.probeAgo(now)));
  T('30 分钟前', () => {
    const t = new Date(Date.now() - 30 * 60000).toISOString();
    assert(api.probeAgo(t) === '30 分钟前', api.probeAgo(t));
  });
  T('5 小时前', () => {
    const t = new Date(Date.now() - 5 * 3600000).toISOString();
    assert(/^5 小时前$/.test(api.probeAgo(t)), api.probeAgo(t));
  });
  T('3 天前', () => {
    const t = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
    assert(/^3 天前$/.test(api.probeAgo(t)), api.probeAgo(t));
  });
  T('空值 → 时间不明', () => assert(api.probeAgo(null) === '时间不明'));
  T('垃圾值 → 时间不明', () => assert(api.probeAgo('not a date') === '时间不明'));
}

console.log('新鲜度分档');
{
  const { api } = load(null);
  const h = n => new Date(Date.now() - n * 3600000).toISOString();
  T('2 小时 → 新鲜/green', () => assert(api.probeFreshness(h(2)).cls === 'green', JSON.stringify(api.probeFreshness(h(2)))));
  T('12 小时 → 偏旧/amber', () => assert(api.probeFreshness(h(12)).cls === 'amber', JSON.stringify(api.probeFreshness(h(12)))));
  T('40 小时 → 已过期/red', () => assert(api.probeFreshness(h(40)).cls === 'red', JSON.stringify(api.probeFreshness(h(40)))));
  T('无时间戳 → 时间不明/ghost', () => assert(api.probeFreshness(null).cls === 'ghost'));
}

console.log('渲染');
T('没有数据时给出可操作的空态', () => {
  const { api, body } = load(null);
  api.renderProbe();
  assert(body.innerHTML.indexOf('还没有探活数据') >= 0, '缺空态标题');
  assert(body.innerHTML.indexOf('probe.json') >= 0, '空态没告诉用户怎么办');
  assert(body.innerHTML.indexOf('选择本地') >= 0, '缺本地载入入口');
});

T('有数据时渲染计数与来源', () => {
  const { api, body } = load(snap);
  api.renderProbe();
  const h = body.innerHTML;
  assert(/需鉴权/.test(h), '缺「需鉴权」');
  assert(/来源 · 构建时内联的快照/.test(h), '缺来源标注');
  assert(/执行环境 · github-actions/.test(h), '缺执行环境标注');
  assert(/探到 3 \/ 3/.test(h), '缺探到/总数');
  assert(/401|1 家|需鉴权 <b>1/.test(h), '缺计数');
});

T('问题项排在正常项前面', () => {
  const { api, body } = load(snap);
  api.renderProbe();
  const h = body.innerHTML;
  const i404 = h.indexOf('>404<');
  const iOk = h.indexOf('>可访问<');
  assert(i404 >= 0 && iOk >= 0, '两种状态都要出现');
  assert(i404 < iOk, '404 应该排在可访问之前，实际 ' + i404 + ' vs ' + iOk);
});

T('detail 进 title，鼠标悬停能看到原因', () => {
  const { api, body } = load(snap);
  api.renderProbe();
  assert(body.innerHTML.indexOf('no Route matched with those values') >= 0, '缺 detail');
});

T('有 404/key 无效时给出提示条', () => {
  const { api, body } = load(snap);
  api.renderProbe();
  assert(body.innerHTML.indexOf('probe-alert') >= 0, '缺告警条');
  assert(/endpoint 写错/.test(body.innerHTML), '告警条没说清 404 的含义');
});

T('没有坏消息时不显示告警条', () => {
  const clean = JSON.parse(JSON.stringify(snap));
  clean.counts = { ok: 3 };
  clean.results = { a: { status: 'ok', http: 200, ms: 1 }, b: { status: 'ok', http: 200, ms: 1 }, c: { status: 'ok', http: 200, ms: 1 } };
  const { api, body } = load(clean);
  api.renderProbe();
  assert(body.innerHTML.indexOf('probe-alert') === -1, '不该出现告警条');
});

T('平台名里的 HTML 被转义（不放 XSS）', () => {
  const evil = JSON.parse(JSON.stringify(snap));
  const { api, body } = load(evil, { vendors: [{ id: 'a', name: '<img src=x onerror=alert(1)>' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }] });
  api.renderProbe();
  assert(body.innerHTML.indexOf('<img src=x') === -1, '原始标签被直接插入');
  assert(body.innerHTML.indexOf('&lt;img') >= 0, '应当被转义后显示');
});

T('source 切到 live 时文案跟着变', () => {
  const { api, body } = load(snap);
  api.PROBE_STATE.source = 'live';
  api.renderProbe();
  assert(/线上实时读取/.test(body.innerHTML), '来源文案没更新');
});


T('长名字去掉括号补语显示短名，全名留在 title', () => {
  const vs = [{ id: 'a', name: 'Anthropic (Claude)' }, { id: 'b', name: '百度千帆（文心）' }, { id: 'c', name: '丙' }];
  const { api, body } = load(snap, { vendors: vs });
  api.renderProbe();
  const h = body.innerHTML;
  assert(/>Anthropic<\/span>/.test(h), '应显示 Anthropic，实际没匹配到');
  assert(/>百度千帆<\/span>/.test(h), '应显示百度千帆');
  assert(/title="Anthropic \(Claude\)/.test(h), '全名应保留在 title 里');
  assert(api.probeShortName('Kimi（月之暗面）') === 'Kimi', api.probeShortName('Kimi（月之暗面）'));
  assert(api.probeShortName('（全是括号）') === '（全是括号）', '去光了要退回原名');
  assert(api.probeShortName(null) === '', 'null 应返回空串');
});

console.log('file:// 行为');
T('本地打开不发起 fetch，直接用快照', () => {
  const { api, body } = load(snap);
  let called = 0;
  const oldFetch = global.fetch;
  global.fetch = () => { called++; return Promise.resolve(); };
  api.probeFetch();
  global.fetch = oldFetch;
  assert(called === 0, 'file:// 下不该发请求，实际发了 ' + called + ' 次');
  assert(api.PROBE_STATE.source === 'snapshot', '应为 snapshot，实际 ' + api.PROBE_STATE.source);
  assert(body.innerHTML.length > 0, '应当已经渲染');
});

T('本地打开且无快照时明确说明原因', () => {
  const { api, body } = load(null);
  api.probeFetch();
  assert(api.PROBE_STATE.source === 'none', '应为 none，实际 ' + api.PROBE_STATE.source);
  assert(/本地打开无法读取/.test(api.PROBE_STATE.err || ''), 'err 没说明原因：' + api.PROBE_STATE.err);
  assert(body.innerHTML.indexOf('还没有探活数据') >= 0, '缺空态');
});

T('重复调用不会重复请求（tried 闸门）', () => {
  const { api } = load(snap, { protocol: 'https:' });
  let called = 0;
  const old = global.fetch;
  global.fetch = () => { called++; return Promise.resolve({ ok: true, json: () => Promise.resolve(snap) }); };
  api.PROBE_STATE.tried = false;
  api.probeFetch();
  api.probeFetch();
  global.fetch = old;
  assert(called <= 1, '只应发起一次，实际 ' + called);
});

console.log('\n合计 ' + (pass + fail) + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
