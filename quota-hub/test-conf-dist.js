#!/usr/bin/env node
/* 数据可信度分布：分级口径、facet 统计、筛选、HTML 结构与转义 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const C = require('./assets/confidence.js');
const d = {};
new Function('exports', fs.readFileSync(path.join(__dirname, 'assets', 'data.js'), 'utf8') +
  '\n;Object.assign(exports,{PLATFORMS});')(d);

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + e.message); }
}
const eq = (a, b, msg) => assert.strictEqual(a, b, msg);

/* ---------- 分级定义 ---------- */
ok('三档定义齐全、key 唯一、都有可读说明', () => {
  eq(C.CONF_META.length, 3);
  eq(C.CONF_META.map(m => m.key).join(','), 'verified,reported,disputed');
  eq(new Set(C.CONF_META.map(m => m.key)).size, 3);
  C.CONF_META.forEach(m => {
    assert(m.label && m.desc && m.cls, m.key + ' 元数据不全');
    assert(['green', 'amber', 'red'].includes(m.cls), m.cls);
  });
});
ok('筛选档位以「全部」开头且覆盖三档', () => {
  eq(C.CONF_FILTERS.length, 4);
  eq(C.CONF_FILTERS[0][0], 'all');
  eq(C.CONF_FILTERS.slice(1).map(f => f[0]).join(','), 'verified,reported,disputed');
});

/* ---------- 真实数据统计 ---------- */
ok('48 家真实数据：核实 15 / 单源 21 / 冲突 12，无未分级', () => {
  const bd = C.confBreakdown(d.PLATFORMS);
  eq(bd.total, 48);
  eq(bd.unknown, 0);
  eq(bd.rows.map(r => r.count).join(','), '15,21,12');
  eq(bd.rows.reduce((s, r) => s + r.count, 0), 48);
});
ok('占比保留一位小数且总和约等于 100', () => {
  const bd = C.confBreakdown(d.PLATFORMS);
  eq(bd.rows.map(r => r.share).join(','), '31.3,43.8,25');
  const sum = bd.rows.reduce((s, r) => s + r.share, 0);
  assert(Math.abs(sum - 100) < 0.2, '占比总和 ' + sum);
});
ok('空数据集不产生 NaN 或 Infinity', () => {
  const bd = C.confBreakdown([]);
  eq(bd.total, 0);
  eq(bd.unknown, 0);
  bd.rows.forEach(r => { eq(r.count, 0); eq(r.share, 0); });
});
ok('脏输入（null / 非数组 / 未知分级）不抛错且如实计入 unknown', () => {
  eq(C.confBreakdown(null).total, 0);
  const bd = C.confBreakdown([
    { confidence: 'verified' }, { confidence: 'rumor' }, null, { confidence: 'disputed' }
  ]);
  eq(bd.total, 4);
  eq(bd.unknown, 2);                    // 一个未知分级 + 一个 null 条目
  eq(bd.rows.map(r => r.count).join(','), '1,0,1');
});

/* ---------- 筛选语义 ---------- */
ok('all / 空值放行，未知档位不放行', () => {
  assert(C.confFilterMatch({ confidence: 'verified' }, 'all'));
  assert(C.confFilterMatch({ confidence: 'verified' }, null));
  eq(C.confFilterMatch({ confidence: 'verified' }, 'not-a-filter'), false);
  eq(C.confFilterMatch(null, 'verified'), false);
});
ok('三档各自只放行本级', () => {
  C.CONF_META.forEach(m => {
    eq(C.confFilterMatch({ confidence: m.key }, m.key), true, m.key);
    C.CONF_META.filter(x => x.key !== m.key).forEach(x =>
      eq(C.confFilterMatch({ confidence: x.key }, m.key), false, m.key + ' vs ' + x.key));
  });
});
ok('facet 语义：点选某档后，分布仍按完整结果集统计', () => {
  // 复刻 app.js：base 不看 conf，filtered 才按 conf 过滤
  const base = d.PLATFORMS;
  const filtered = base.filter(p => C.confFilterMatch(p, 'reported'));
  eq(filtered.length, 21);
  const bd = C.confBreakdown(base);
  eq(bd.total, 48);                    // 关键：不是 21
  eq(bd.rows.map(r => r.count).join(','), '15,21,12');
});
ok('与交叉校验档位联动时分布收敛到筛选后的集合', () => {
  // 模拟「交叉校验 = 冲突」两家的可信度分布
  const subset = d.PLATFORMS.filter(p => ['deepseek', 'moonshot'].includes(p.id));
  const bd = C.confBreakdown(subset);
  eq(bd.total, 2);
  assert(bd.rows.every(r => r.count === 0 || r.key === 'disputed'), '两家应都标 disputed');
});

/* ---------- HTML ---------- */
const bd48 = C.confBreakdown(d.PLATFORMS);
const html = C.confBarHtml(bd48, 'all');
ok('堆叠条恰好 3 段、图例恰好 4 个按钮（含清除）', () => {
  eq((html.match(/class="cd-seg /g) || []).length, 3);
  eq((html.match(/class="cd-key/g) || []).length, 4);
  eq((html.match(/data-conf="/g) || []).length, 7);
});
ok('三段宽度写入 style 且与占比一致', () => {
  assert(html.includes('width:31.3%') && html.includes('width:43.8%') && html.includes('width:25%'));
});
ok('默认态只高亮「清除筛选」，不误高亮某一档', () => {
  eq((html.match(/cd-seg [^"]*\bon\b/g) || []).length, 0);
  assert(/class="cd-key cd-clear on"/.test(html));
});
ok('选中 reported 时只高亮该段的段与图例', () => {
  const h = C.confBarHtml(bd48, 'reported');
  assert(/class="cd-seg cd-amber on"/.test(h));
  eq((h.match(/class="cd-seg [^"]*\bon\b/g) || []).length, 1);
  assert(/class="cd-key on" data-conf="reported"/.test(h));
  assert(!/class="cd-key cd-clear on"/.test(h));
});
ok('未知 current 回落成 all，不让条子进入无高亮状态', () => {
  const h = C.confBarHtml(bd48, 'bogus');
  assert(/class="cd-key cd-clear on"/.test(h));
});
ok('未分级会在标题与 aria 里如实说明', () => {
  const h = C.confBarHtml({ total: 4, rows: bd48.rows, unknown: 2 }, 'all');
  assert(/class="cd-head"[\s\S]*?未分级 2 条/.test(h), '标题缺未分级说明');
  assert(/aria-label="[^"]*未分级 2 条/.test(h), 'aria 缺未分级说明');
});
ok('自定义文案里的尖括号与引号会被转义', () => {
  const rows = [{ key: 'verified', label: '<img src=x>', cls: 'green', desc: 'a"b', count: 1, share: 100 }];
  const h = C.confBarHtml({ total: 1, rows, unknown: 0 }, 'all');
  assert(!h.includes('<img'), 'label 未转义');
  assert(h.includes('&lt;img src=x&gt;'), 'label 转义结果不对');
  assert(!h.includes('a"b'), 'title 里的双引号未转义');
  assert(!/<script/.test(h));
});
ok('空 breakdown 也能渲染出完整骨架', () => {
  const h = C.confBarHtml(null, 'all');
  eq((h.match(/class="cd-seg /g) || []).length, 0);
  assert(h.includes('基于当前其它筛选条件的 <b>0</b> 条'));
});

console.log(`\n可信度分布单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
