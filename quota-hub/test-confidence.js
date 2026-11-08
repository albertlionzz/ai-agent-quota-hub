#!/usr/bin/env node
/* check-confidence.js 单测：规则、映射、漂移检出、CLI 退出码 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const C = require('./check-confidence.js');
const CC = require('./assets/crosscheck.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + e.message); }
}
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }

const platforms = C.loadPlatforms();
const rows = C.confidenceRows(platforms, CC.CROSSCHECK);
const byVerdict = k => CC.CROSSCHECK.filter(c => CC.ccVerdict(c).key === k);
const fakePlatform = (id, confidence) => [{ id, confidence }];

/* ---------- 真实数据 ---------- */
ok('平台库 48 家，confidence 取值合法', () => {
  eq(platforms.length, 48);
  const allowed = new Set(['verified', 'reported', 'disputed']);
  platforms.forEach(p => assert(allowed.has(p.confidence), p.id + ' -> ' + p.confidence));
});
ok('23 家比对 / 22 家可映射 / 唯一未映射是 llama', () => {
  eq(rows.length, 23);
  eq(rows.filter(r => r.mapped).length, 22);
  eq(rows.filter(r => !r.mapped).map(r => r.id).join(','), 'llama');
});
ok('真实数据当前零漂移（moonshot 已由 verified 改 disputed）', () => {
  const drifts = rows.filter(r => r.drift);
  eq(drifts.length, 0, drifts.map(d => d.id + ':' + d.confidence).join(','));
  eq(C.report(rows).driftCount, 0);
});
ok('两处 conflict 都标 disputed', () => {
  const cs = rows.filter(r => r.verdict === 'conflict');
  eq(cs.length, 2);
  cs.forEach(r => eq(r.confidence, 'disputed', r.id));
});

/* ---------- 规则表 ---------- */
ok('CONFIDENCE_RULES 覆盖五种判定', () => {
  ['conflict', 'gap', 'unknown', 'agree', 'solo'].forEach(k =>
    assert(C.CONFIDENCE_RULES[k], '缺规则 ' + k));
  eq(C.CONFIDENCE_RULES.conflict.forbidden[0], 'verified');
  eq(C.CONFIDENCE_RULES.agree.forbidden.length, 0);
});

/* ---------- 漂移检出（喂假 platform，不改源码） ---------- */
ok('conflict + verified 判漂移并给出改法', () => {
  const c = byVerdict('conflict')[0];
  const r = C.confidenceRows(fakePlatform(c.id, 'verified'), [c])[0];
  eq(r.drift, true);
  eq(r.suggestion, 'confidence: verified -> disputed');
});
ok('conflict + disputed 不漂移', () => {
  const c = byVerdict('conflict')[0];
  eq(C.confidenceRows(fakePlatform(c.id, 'disputed'), [c])[0].drift, false);
});
ok('unknown + verified 判漂移', () => {
  const c = byVerdict('unknown')[0];
  eq(C.confidenceRows(fakePlatform(c.id, 'verified'), [c])[0].drift, true);
});
ok('agree / solo + verified 不误伤（不同轴）', () => {
  ['agree', 'solo'].forEach(k => {
    const c = byVerdict(k)[0];
    eq(C.confidenceRows(fakePlatform(c.id, 'verified'), [c])[0].drift, false, k);
  });
});
ok('映射不上的厂商不算漂移', () => {
  const c = byVerdict('conflict')[0];
  const r = C.confidenceRows([], [c])[0];
  eq(r.mapped, false);
  eq(r.drift, false);
  eq(r.confidence, null);
});

/* ---------- 报告结构 ---------- */
ok('report 结构合法且漂移摘要字段齐全', () => {
  const rep = C.report(rows);
  eq(rep.schema, 1);
  eq(rep.total, 23);
  eq(rep.mapped, 22);
  eq(rep.unmapped.join(','), 'llama');
  eq(rep.rows.length, 23);
  assert(Array.isArray(rep.drifts));
});
ok('report 能汇总人为注入的漂移', () => {
  const c = byVerdict('conflict')[0];
  const bad = C.confidenceRows(fakePlatform(c.id, 'verified'), [c]);
  const rep = C.report(bad);
  eq(rep.driftCount, 1);
  eq(rep.drifts[0].id, c.id);
  assert(rep.drifts[0].suggestion.includes('disputed'));
});

/* ---------- CLI ---------- */
function silent(fn) {
  const orig = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = orig; }
}
ok('main(--check) 真实数据返回 0', () => eq(silent(() => C.main(['--check'])), 0));
ok('main(--out) 写出可解析的映射表', () => {
  const p = path.join(os.tmpdir(), 'qh-confidence-map.json');
  try {
    silent(() => C.main(['--out', p]));
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    eq(d.schema, 1);
    eq(d.total, 23);
    eq(d.driftCount, 0);
  } finally { if (fs.existsSync(p)) fs.unlinkSync(p); }
});
ok('main(--out) 缺路径返回 2', () => {
  const orig = console.error;
  console.error = () => {};
  try { eq(C.main(['--out']), 2); } finally { console.error = orig; }
});

console.log(`\nconfidence 门禁单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
