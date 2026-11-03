/* 双源交叉校验单测：require 真实源码 */
const assert = require('assert');
const {
  CROSSCHECK, ccStanceHub, ccStanceFt, ccStanceIntel,
  ccVerdict, ccStanceCls, CC_STANCE_LABEL, renderCrosscheck
} = require('./assets/crosscheck.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + e.message); }
}
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }

const VALID_HUB = ['yes', 'limited', 'no', 'disputed'];

/* ---------- 结构 ---------- */
ok('共 23 家厂商（接入总表全覆盖）', () => eq(CROSSCHECK.length, 23));
ok('id 唯一', () => {
  const ids = CROSSCHECK.map(c => c.id);
  eq(new Set(ids).size, ids.length);
});
ok('每条都有 hub 且 v 合法', () => {
  CROSSCHECK.forEach(c => assert(VALID_HUB.includes(c.hub.v), c.id + ' hub.v 非法'));
});
ok('每条都有 name / relay 字段', () => {
  CROSSCHECK.forEach(c => { assert(c.name, c.id + ' 缺 name'); assert('relay' in c, c.id + ' 缺 relay'); });
});
ok('ft 为对象或 null', () => {
  CROSSCHECK.forEach(c => {
    if (c.ft !== null) assert(typeof c.ft.kind === 'string' && 'verified' in c.ft && 'claim' in c.ft, c.id + ' ft 结构错');
  });
});
ok('intel 为对象或 null', () => {
  CROSSCHECK.forEach(c => {
    if (c.intel !== null) assert(typeof c.intel.free === 'boolean' && 'claim' in c.intel, c.id + ' intel 结构错');
  });
});

/* ---------- 立场归一 ---------- */
ok('hub 立场归一', () => {
  const m = { hub: { v: 'yes' } }, l = { hub: { v: 'limited' } }, n = { hub: { v: 'no' } }, d = { hub: { v: 'disputed' } };
  eq(ccStanceHub(m), 'free'); eq(ccStanceHub(l), 'trial'); eq(ccStanceHub(n), 'none'); eq(ccStanceHub(d), 'unknown');
});
ok('ft 立场归一（含未收录→na）', () => {
  eq(ccStanceFt({ ft: null }), 'na');
  eq(ccStanceFt({ ft: { kind: 'free' } }), 'free');
  eq(ccStanceFt({ ft: { kind: 'mixed' } }), 'trial');
  eq(ccStanceFt({ ft: { kind: 'paid' } }), 'none');
  eq(ccStanceFt({ ft: { kind: 'check' } }), 'unknown');
});
ok('intel 立场归一（含未覆盖→na）', () => {
  eq(ccStanceIntel({ intel: null }), 'na');
  eq(ccStanceIntel({ intel: { free: true } }), 'free');
  eq(ccStanceIntel({ intel: { free: false } }), 'none');
});
ok('立场标签完整', () => {
  ['free', 'trial', 'none', 'unknown', 'na'].forEach(s => assert(CC_STANCE_LABEL[s], '缺标签 ' + s));
  ['free', 'trial', 'none', 'unknown', 'na'].forEach(s => assert(ccStanceCls(s), '缺配色 ' + s));
});

/* ---------- 判定 ---------- */
ok('DeepSeek：本项目 trial vs intel none → 冲突', () => eq(ccVerdict(CROSSCHECK.find(c => c.id === 'deepseek')).key, 'conflict'));
ok('Kimi：本项目 none vs intel 赠金 → 冲突', () => eq(ccVerdict(CROSSCHECK.find(c => c.id === 'moonshot')).key, 'conflict'));
ok('Gemini：三方均有免费层 → 一致', () => eq(ccVerdict(CROSSCHECK.find(c => c.id === 'gemini')).key, 'agree'));
ok('Groq：三方均有免费层 → 一致', () => eq(ccVerdict(CROSSCHECK.find(c => c.id === 'groq')).key, 'agree'));
ok('Anthropic：仅本项目有数据 → solo', () => eq(ccVerdict(CROSSCHECK.find(c => c.id === 'anthropic')).key, 'solo'));
ok('OpenAI：外部亦无定论 → 待核(unknown)', () => eq(ccVerdict(CROSSCHECK.find(c => c.id === 'openai')).key, 'unknown'));

/* ---------- 汇总分布合理 ---------- */
ok('汇总分布加总为 23', () => {
  const cnt = { agree: 0, conflict: 0, gap: 0, solo: 0, unknown: 0 };
  CROSSCHECK.forEach(c => cnt[ccVerdict(c).key]++);
  const sum = cnt.agree + cnt.conflict + cnt.gap + cnt.solo + cnt.unknown;
  eq(sum, 23);
  eq(cnt.conflict, 2, '冲突应为 2（DeepSeek / Kimi）');
});

/* ---------- 渲染函数存在（DOM 调用在浏览器内） ---------- */
ok('renderCrosscheck 是可调用函数', () => eq(typeof renderCrosscheck, 'function'));

console.log(`\n交叉校验单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
