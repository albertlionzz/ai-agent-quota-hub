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

/* ============================================================
   判定 × 可信度 联合分布
   需要在同一作用域里同时拿到 data / crosscheck / confidence，
   否则 confJoint 找不到 ccVerdictOf，所有条目都会掉进「未覆盖」。
   ============================================================ */
const X = {};
new Function('exports', ['data.js', 'crosscheck.js', 'confidence.js']
  .map(f => fs.readFileSync(path.join(__dirname, 'assets', f), 'utf8')).join('\n') +
  '\n;Object.assign(exports,{PLATFORMS,confJoint,confJointHtml,confFocusCross,ccVerdictOf,CC_FILTERS});')(X);

ok('矩阵行定义与交叉校验档位对齐（5 行，pending 合并 gap+unknown）', () => {
  eq(C.CONF_CC_ROWS.length, 5);
  eq(C.CONF_CC_ROWS.map(r => r.cc).join(','), 'conflict,pending,agree,solo,none');
  eq(C.CONF_CC_ROWS[1].key, 'pending');
});

ok('48 家真实数据：行合计 2 / 3 / 9 / 10 / 24，加总 48', () => {
  const j = X.confJoint(d.PLATFORMS);
  eq(j.total, 48);
  eq(j.other, 0);
  eq(j.rows.map(r => r.total).join(','), '2,3,9,10,24');
  eq(j.rows.reduce((a, r) => a + r.total, 0), 48);
});

ok('列合计 15 / 21 / 12，与独立算出的可信度分布一致', () => {
  const j = X.confJoint(d.PLATFORMS);
  eq(j.colTotals.join(','), '15,21,12');
  const bd = C.confBreakdown(d.PLATFORMS);
  eq(j.colTotals.join(','), bd.rows.map(r => r.count).join(','));
});

ok('每个格子的横竖加总都闭合（无丢条、无重复计）', () => {
  const j = X.confJoint(d.PLATFORMS);
  j.rows.forEach(r => eq(r.cells.reduce((a, b) => a + b, 0) + r.other, r.total, r.label));
  j.cols.forEach((c, i) => {
    eq(j.rows.reduce((a, r) => a + r.cells[i], 0), j.colTotals[i], c.key);
  });
});

ok('实质结论：口径冲突全部落在「冲突」可信度上（不再有「冲突却已核实」）', () => {
  const j = X.confJoint(d.PLATFORMS);
  const row = j.rows.find(r => r.key === 'conflict');
  eq(row.cells[2], 2);                  // disputed
  eq(row.cells[0], 0);                  // verified
  eq(row.cells[1], 0);                  // reported
});

ok('实质结论：仅本项目覆盖以单源为主，不能当硬事实', () => {
  const j = X.confJoint(d.PLATFORMS);
  const row = j.rows.find(r => r.key === 'solo');
  eq(row.cells[1], 7);                  // reported 最多
  assert(row.cells[1] > row.cells[0], '单源应多于核实');
});

ok('未覆盖行仍有大量已核实条目：说明是轴的边界而非数据质量差', () => {
  const j = X.confJoint(d.PLATFORMS);
  const row = j.rows.find(r => r.key === 'none');
  eq(row.cells[0], 10);
  assert(row.cells[0] > 0);
});

ok('脏输入不抛错：非数组 / null / 未知可信度归 other', () => {
  eq(X.confJoint(null).total, 0);
  eq(X.confJoint('x').total, 0);
  const j = X.confJoint([{ id: 'openai', confidence: 'rumor' }, null]);
  eq(j.total, 2);
  eq(j.other, 2);
  eq(j.rows.reduce((a, r) => a + r.cells.reduce((x, y) => x + y, 0), 0), 0);
});

const j48 = X.confJoint(d.PLATFORMS);
const jh = X.confJointHtml(j48, 'all', 'all');
ok('表格渲染 5 个数据行、恰好 11 个非空格子', () => {
  eq((jh.match(/<tr[ >]/g) || []).length, 7);            // 表头 + 5 行 + 表尾
  eq((jh.match(/class="cj-btn/g) || []).length, 11);
  eq((jh.match(/class="cj-cell cj-empty"/g) || []).length, 4);
});
ok('每个可点格子带两个筛选值，格式 cc|conf', () => {
  const cells = [...jh.matchAll(/data-jcc="([^"]+)"/g)].map(m => m[1]);
  eq(cells.length, 11);
  cells.forEach(c => {
    assert(/^(conflict|pending|agree|solo|none)\|(verified|reported|disputed)$/.test(c), c);
  });
});
ok('默认态不高亮任何格子，也不高亮任何行', () => {
  eq((jh.match(/cj-btn on/g) || []).length, 0);
  eq((jh.match(/cj-row-on/g) || []).length, 0);
});
ok('选中格子与所属行同时高亮，且只有一个格子被选中', () => {
  const h = X.confJointHtml(j48, 'conflict', 'disputed');
  eq((h.match(/cj-btn on/g) || []).length, 1);
  eq((h.match(/cj-row-on/g) || []).length, 1);
  assert(/cj-btn on"[^>]*data-jcc="conflict\|disputed"/.test(h));
});
ok('未分级的条目在标题里如实说明，不塞进任何格子', () => {
  const h = X.confJointHtml(X.confJoint([{ id: 'x', confidence: 'rumor' }]), 'all', 'all');
  assert(h.includes('另有 1 条可信度未分级'), h.slice(0, 200));
});
ok('空矩阵也能渲染出完整骨架且不出现 NaN', () => {
  const h = X.confJointHtml(null, 'all', 'all');
  assert(h.includes('<table class="cj-table"'));
  assert(!/NaN|undefined/.test(h));
  eq((h.match(/class="cj-btn/g) || []).length, 0);
});
ok('矩阵 HTML 不引入脚本注入面', () => {
  const h = X.confJointHtml(j48, '<img src=x>', '" onload="alert(1)');
  assert(!h.includes('<img'), 'cc 值被拼进 HTML');
  assert(!/onload="alert/.test(h), 'conf 值被拼进属性');
  assert(!/<script/.test(h));
});
ok('窄屏短标签：每档都有 ≤2 字的 short，且长短两套都渲染', () => {
  C.CONF_META.forEach(m => {
    assert(m.short && [...m.short].length <= 2, m.key + ' 缺短标签');
  });
  /* 3 个列标签 + 1 个左上角 = 各 4 处 */
  eq((jh.match(/class="cj-hl"/g) || []).length, 4);
  eq((jh.match(/class="cj-hs"/g) || []).length, 4);
  assert(jh.includes('多源核实') && jh.includes('核实'), '长短标签应同时存在');
});
ok('角标也给了窄屏替身，避免表头挤成竖排单字', () => {
  assert(/class="cj-corner"><span class="cj-hl">交叉校验 ↓ \/ 可信度 →<\/span><span class="cj-hs">/.test(jh));
});

/* ============================================================
   点格子 → 平台库：命中集合、组合文案、筛选落地

   最容易出的事故是「格子写 10 条、结果只有 3 条」——统计口径和筛选
   口径各写一套，就会在最需要信任的地方对不上账。这里逐格核对。
   ============================================================ */
const H = {};
new Function('exports', ['data.js', 'crosscheck.js', 'confidence.js']
  .map(f => fs.readFileSync(path.join(__dirname, 'assets', f), 'utf8')).join('\n') +
  '\n;Object.assign(exports,{confJoint,confJointHits,confJointCombo,ccVerdictOf});')(H);

ok('confJointCombo：5 × 3 组合都能还原成可读文案', () => {
  C.CONF_CC_ROWS.forEach(r => C.CONF_META.forEach(m => {
    const c = H.confJointCombo(r.cc, m.key);
    assert(c, r.cc + '|' + m.key + ' 取不到文案');
    eq(c.cc, r.cc);
    eq(c.conf, m.key);
    eq(c.rowLabel, r.label);
    eq(c.colLabel, m.label);
    assert(c.rowNote && c.colShort, '文案缺备注或短标签');
  }));
});

ok('confJointCombo：非法组合返回 null（不生成半截面包屑）', () => {
  eq(H.confJointCombo('bogus', 'verified'), null);
  eq(H.confJointCombo('conflict', 'bogus'), null);
  eq(H.confJointCombo(null, null), null);
  eq(H.confJointCombo('gap', 'verified'), null);      /* gap 已并入 pending，非矩阵行 */
  eq(H.confJointCombo('pending', undefined), null);
});

ok('每个格子的条数 = 平台库命中条数（15 格逐一核对）', () => {
  const j = H.confJoint(d.PLATFORMS);
  j.rows.forEach(r => j.cols.forEach((c, i) => {
    const hits = H.confJointHits(d.PLATFORMS, r.cc, c.key);
    eq(hits.length, r.cells[i], r.label + ' × ' + c.label);
  }));
});

ok('命中集合互斥、加总 = 矩阵总数，无重复无遗漏', () => {
  const j = H.confJoint(d.PLATFORMS);
  const seen = new Map();
  let sum = 0;
  j.rows.forEach(r => j.cols.forEach(c => {
    H.confJointHits(d.PLATFORMS, r.cc, c.key).forEach(p => {
      assert(!seen.has(p.id), p.id + ' 被两个格子同时命中');
      seen.set(p.id, 1);
      sum++;
    });
  }));
  eq(sum, j.total - j.other);
  eq(seen.size, 48);
});

ok('命中的条目确实落在该格（判定与可信度都对得上）', () => {
  const j = H.confJoint(d.PLATFORMS);
  j.rows.forEach(r => j.cols.forEach(c => {
    H.confJointHits(d.PLATFORMS, r.cc, c.key).forEach(p => {
      eq(p.confidence, c.key, p.id + ' 可信度不匹配');
      const v = H.ccVerdictOf(p.id);
      const key = (v === 'gap' || v === 'unknown') ? 'pending' : v;
      eq(key, r.cc, p.id + ' 判定不匹配');
    });
  }));
});

ok('confJointHits：脏输入不抛错，null 条目被剔除', () => {
  eq(H.confJointHits(null, 'conflict', 'verified').length, 0);
  eq(H.confJointHits([null, undefined], 'conflict', 'verified').length, 0);
  eq(H.confJointHits([{ id: 'not-in-crosscheck', confidence: 'verified' }], 'none', 'verified').length, 1);
});

/* ---------- 点格子这个动作本身 ---------- */
function focusSandbox(search) {
  const st = {
    search: search || '',
    filters: { region: 'all', cat: 'all', qtype: 'all', cc: 'all', conf: 'all' }
  };
  const calls = { save: 0, view: null };
  const F = {};
  new Function('state', 'saveUI', 'switchView', 'exports',
    ['crosscheck.js', 'confidence.js']
      .map(f => fs.readFileSync(path.join(__dirname, 'assets', f), 'utf8')).join('\n') +
    '\n;Object.assign(exports,{confFocusCross});')(
      st, () => { calls.save++; }, v => { calls.view = v; }, F);
  return { st, calls, focus: F.confFocusCross };
}

ok('点格子：两个筛选落地、跳到平台库、记下组合', () => {
  const s = focusSandbox();
  s.focus('none', 'verified');
  eq(s.st.filters.cc, 'none');
  eq(s.st.filters.conf, 'verified');
  eq(s.st.jointFocus.cc, 'none');
  eq(s.st.jointFocus.conf, 'verified');
  eq(s.calls.view, 'registry');
  eq(s.calls.save, 1);
});

ok('点格子会清掉其它维度，避免条数对不上账', () => {
  const s = focusSandbox('kimi');
  s.st.filters.region = 'cn';
  s.st.filters.cat = 'api';
  s.st.filters.qtype = 'daily';
  s.focus('agree', 'reported');
  eq(s.st.filters.region, 'all');
  eq(s.st.filters.cat, 'all');
  eq(s.st.filters.qtype, 'all');
  eq(s.st.search, '');
  eq(s.st.jointFocus.cleared.join('/'), '区域/类型/额度形态/搜索');
});

ok('其它条件本来就是「全部」时不谎报重置', () => {
  const s = focusSandbox();
  s.focus('solo', 'reported');
  eq(s.st.jointFocus.cleared.length, 0);
});

ok('残缺入参回落到 all，不把 undefined 写进筛选', () => {
  const s = focusSandbox();
  s.focus();
  eq(s.st.filters.cc, 'all');
  eq(s.st.filters.conf, 'all');
  eq(s.st.jointFocus.cc, 'all');
  eq(s.st.jointFocus.conf, 'all');
});

ok('第二次点格子覆盖上一次的组合，不叠加', () => {
  const s = focusSandbox();
  s.focus('none', 'verified');
  s.focus('conflict', 'disputed');
  eq(s.st.jointFocus.cc, 'conflict');
  eq(s.st.jointFocus.conf, 'disputed');
  eq(s.st.jointFocus.cleared.length, 0);
});

console.log(`\n可信度分布单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
