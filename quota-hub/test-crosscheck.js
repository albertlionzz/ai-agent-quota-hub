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

/* ================= 新鲜度 ================= */
const {
  CC_SOURCES_BASE, CC_BADGE_TEXT, ccEsc, ccHoursSince, ccDaysSince,
  ccFreshLevel, ccFreshnessRows, ccStatusNote, CC_STATUS_NOTE,
  ccEvidenceFor, ccBadgeFor,
  ccFocusVerify, ccFocusCross, ccApplyFocus
} = require('./assets/crosscheck.js');
const T0 = Date.parse('2026-11-05T00:00:00Z');

ok('ccEsc 转义引号与尖括号', () => eq(ccEsc('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;'));
ok('ccHoursSince 按固定时钟算', () => eq(ccHoursSince('2026-11-04T00:00:00Z', T0), 24));
ok('ccHoursSince 坏日期返回 null', () => eq(ccHoursSince('不是日期', T0), null));
ok('ccDaysSince 向下取整', () => eq(ccDaysSince('2026-11-03T12:00:00Z', T0), 1));
ok('口径轴：16 天仍新鲜', () => eq(ccFreshLevel('2026-10-20', '额度口径', T0).cls, 'green'));
ok('口径轴：46 天偏旧', () => eq(ccFreshLevel('2026-09-20', '额度口径', T0).cls, 'amber'));
ok('口径轴：65 天已过期', () => eq(ccFreshLevel('2026-09-01', '额度口径', T0).cls, 'red'));
ok('连通性轴按小时，不用天的阈值', () => {
  eq(ccFreshLevel('2026-11-04T20:00:00Z', '连通性', T0).cls, 'green');   // 4h
  eq(ccFreshLevel('2026-11-04T12:00:00Z', '连通性', T0).cls, 'amber');   // 12h
  eq(ccFreshLevel('2026-11-03T12:00:00Z', '连通性', T0).cls, 'red');     // 36h
});
ok('时间不明 / 未来时间不误判', () => {
  eq(ccFreshLevel(null, '额度口径', T0).cls, 'ghost');
  eq(ccFreshLevel('2026-12-01', '额度口径', T0).text, '时间异常');
});

ok('新鲜度行 = 5 条，顺序固定', () => {
  const rows = ccFreshnessRows(T0, null, null, '2026-10-20');
  eq(rows.length, 5);
  eq(rows.map(r => r.id).join(','), 'hub,freetoken,intel,relays,probe');
});
ok('无快照时退回基线且标 baseline / missing', () => {
  const rows = ccFreshnessRows(T0, null, null, '2026-10-20');
  eq(rows[1].status, 'baseline');
  eq(rows[1].checkedAt, '2026-10-22');
  eq(rows[3].checkedAt, null);           // relays 基线没有日期，不编一个
  eq(rows[4].status, 'missing');
  eq(rows[4].level.cls, 'ghost');
});
ok('CI 快照覆盖基线日期，unreachable 沿用基线', () => {
  const snap = { sources: [
    { id: 'freetoken', checkedAt: '2026-10-22', status: 'ok' },
    { id: 'intel', checkedAt: '2026-11-04', status: 'ok' },
    { id: 'relays', checkedAt: null, status: 'unreachable' }
  ] };
  const rows = ccFreshnessRows(T0, snap, { generatedAt: '2026-11-04T22:00:00Z' }, '2026-10-20');
  eq(rows[2].checkedAt, '2026-11-04');          // 被快照更新
  eq(rows[3].status, 'unreachable');
  eq(rows[3].checkedAt, null);                   // 抓不到就不假装更新
  eq(rows[4].checkedAt, '2026-11-04T22:00:00Z');
  eq(rows[4].axis, '连通性');
  eq(rows[4].hours, 2);
});

/* ================= 联动 / 角标 ================= */
ok('ccEvidenceFor(deepseek) 带冲突判定与两方说法', () => {
  const e = ccEvidenceFor('deepseek');
  eq(e.verdict.key, 'conflict');
  eq(e.sources.length, 2);
  eq(e.sources[0].name, 'FreeToken');
  eq(e.sources[1].name, 'free-llm-intel');
  assert(e.hub && e.name === 'DeepSeek');
});
ok('ccEvidenceFor 未知 id 返回 null', () => eq(ccEvidenceFor('nope'), null));
ok('ccBadgeFor 冲突条目带跳转 id', () => {
  const b = ccBadgeFor('deepseek');
  assert(/cc-badge-conflict/.test(b), b);
  assert(/data-ccgo="deepseek"/.test(b), b);
});
ok('ccBadgeFor 对未覆盖厂商返回空（不硬套标记）', () => eq(ccBadgeFor('nope'), ''));
ok('CC_BADGE_TEXT 覆盖五种判定', () => {
  ['conflict', 'gap', 'unknown', 'solo', 'agree'].forEach(k => assert(CC_BADGE_TEXT[k], k));
});
ok('联动函数齐全', () => {
  [ccFocusVerify, ccFocusCross, ccApplyFocus].forEach(f => eq(typeof f, 'function'));
});

/* ---------- 非 ok 状态必须诚实标注（本轮修的语义糙点） ---------- */
ok('ccStatusNote 对 ok 不显示任何说明', () => eq(ccStatusNote('ok'), ''));
ok('ccStatusNote 覆盖全部非 ok 状态且文案互不相同', () => {
  const keys = Object.keys(CC_STATUS_NOTE);
  eq(keys.length, 5);
  assert(!keys.includes('ok'), 'ok 不该有「沿用基线」提示');
  const notes = keys.map(k => ccStatusNote(k));
  notes.forEach(n => assert(n && n.length > 3, '缺文案: ' + n));
  eq(new Set(notes).size, 5, '不同状态不能共用同一句托词');
});
ok('未知状态返回空串，不编文案', () => eq(ccStatusNote('whatever'), ''));
ok('无快照时每一行都能说明日期出处（不会冒充新鲜）', () => {
  const rows = ccFreshnessRows(T0, null, null, '2026-10-20');
  eq(rows.length, 5);
  rows.forEach(r => assert(ccStatusNote(r.status), r.id + ' 状态 ' + r.status + ' 缺说明'));
});

/* ================= 平台库 id 映射（任务 2） ================= */
const fs = require('fs');
const path = require('path');
const dctx = {};
new Function('exports', fs.readFileSync(path.join(__dirname, 'assets', 'data.js'), 'utf8') +
  '\n;Object.assign(exports,{PLATFORMS});')(dctx);
const pids = new Set(dctx.PLATFORMS.map(p => p.id));
ok('平台库共 48 家', () => eq(dctx.PLATFORMS.length, 48));
ok('23 家交叉校验中 22 家能映射到平台库', () =>
  eq(CROSSCHECK.filter(c => pids.has(c.id)).length, 22));
ok('唯一映射不上的只有 llama（Meta 无官方 API）', () =>
  eq(CROSSCHECK.filter(c => !pids.has(c.id)).map(c => c.id).join(','), 'llama'));
ok('两处冲突在平台库里都有对应卡片', () =>
  eq(CROSSCHECK.filter(c => pids.has(c.id) && ccVerdict(c).key === 'conflict').length, 2));

/* ================= 平台库筛选 / 未覆盖说明（本轮） ================= */
const ccx = require('./assets/crosscheck.js');
const unc = ccx.ccUncovered(dctx.PLATFORMS);

ok('CC_FILTERS 提供 6 档且以「全部」开头', () => {
  eq(ccx.CC_FILTERS.length, 6);
  eq(ccx.CC_FILTERS[0][0], 'all');
  eq(new Set(ccx.CC_FILTERS.map(f => f[0])).size, 6);
  ccx.CC_FILTERS.forEach(f => assert(f[1] && f[1].length > 0, '缺标签: ' + f[0]));
});
ok('ccVerdictOf 对冲突 / 待核厂商给出正确定论', () => {
  eq(ccx.ccVerdictOf('deepseek'), 'conflict');
  eq(ccx.ccVerdictOf('moonshot'), 'conflict');
  ['openai', 'xai', 'longcat'].forEach(id => eq(ccx.ccVerdictOf(id), 'unknown'));
});
ok('ccVerdictOf 对未进接入总表的条目返回 none', () => {
  eq(ccx.ccVerdictOf(unc.groups[0].items[0].id), 'none');
  eq(ccx.ccVerdictOf('不存在的平台'), 'none');
});
ok('llama 有定论但不在平台库（覆盖 22 而非 23 的原因）', () => {
  assert(ccx.ccVerdictOf('llama') !== 'none');
  assert(!pids.has('llama'));
});
ok('ccFilterMatch：all / 空值放行全部', () => {
  assert(dctx.PLATFORMS.every(p => ccx.ccFilterMatch(p.id, 'all')));
  assert(dctx.PLATFORMS.every(p => ccx.ccFilterMatch(p.id, null)));
});
ok('ccFilterMatch：未知档位不误放行', () =>
  eq(ccx.ccFilterMatch('deepseek', 'not-a-filter'), false));
ok('ccFilterMatch：pending 合并 gap + unknown', () => {
  ['openai', 'xai', 'longcat'].forEach(id => eq(ccx.ccFilterMatch(id, 'pending'), true, id));
  eq(ccx.ccFilterMatch('deepseek', 'pending'), false);
});
ok('各档位数量 2 / 3 / 9 / 8 / 26，加总 48', () => {
  const counts = {};
  ['conflict', 'pending', 'agree', 'solo', 'none'].forEach(f => {
    counts[f] = dctx.PLATFORMS.filter(p => ccx.ccFilterMatch(p.id, f)).length;
  });
  eq(counts.conflict, 2);
  eq(counts.pending, 3);
  eq(counts.agree, 9);
  eq(counts.solo, 8);
  eq(counts.none, 26);
  eq(Object.values(counts).reduce((a, b) => a + b, 0), 48);
});
ok('档位互斥：每个平台只落进一个档位', () => {
  dctx.PLATFORMS.forEach(p => {
    const hit = ['conflict', 'pending', 'agree', 'solo', 'none']
      .filter(f => ccx.ccFilterMatch(p.id, f));
    eq(hit.length, 1, p.id + ' 命中 ' + hit.join(','));
  });
});
ok('ccUncovered：22 覆盖 / 26 未覆盖 / 总 48', () => {
  eq(unc.total, 48);
  eq(unc.covered, 22);
  eq(unc.uncovered, 26);
  eq(unc.covered + unc.uncovered, unc.total);
});
ok('未覆盖分组完整、无重复、无遗漏', () => {
  const ids = unc.groups.flatMap(g => g.items.map(it => it.id));
  eq(ids.length, 26);
  eq(new Set(ids).size, 26);
  const coveredIds = dctx.PLATFORMS.filter(p => ccx.ccVerdictOf(p.id) !== 'none').map(p => p.id);
  coveredIds.forEach(id => assert(!ids.includes(id), id + ' 被误归未覆盖'));
});
ok('每个分组都有可读说明与非空名单', () => {
  assert(unc.groups.length >= 5, '分组太少: ' + unc.groups.length);
  eq(new Set(unc.groups.map(g => g.key)).size, unc.groups.length);
  unc.groups.forEach(g => {
    assert(g.label && g.label.length > 2, g.key + ' 缺标题');
    assert(g.note && g.note.length > 10, g.key + ' 缺说明');
    assert(g.items.length > 0, g.key + ' 空组');
    g.items.forEach(it => assert(it.name, g.key + ' 条目缺名称'));
  });
});

console.log(`\n交叉校验单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
