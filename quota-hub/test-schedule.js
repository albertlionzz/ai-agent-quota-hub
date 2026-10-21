/* 重置日程单测：加载真实 usage.js + schedule.js */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = p => fs.readFileSync(path.join(__dirname, 'assets', p), 'utf8');
const box = {};
new Function('box', read('usage.js') + '\n' + read('schedule.js') + `
  ;Object.assign(box, { scheduleOf, scheduleAdvice, msToMidnight });`)(box);
const { scheduleOf, scheduleAdvice, msToMidnight } = box;

const NOW = new Date('2026-10-22T22:30:00+08:00');   /* 距 0 点还有 1.5 小时 */

const P = [
  { id: 'a', name: 'A 每日', quotaType: 'forever', reset: 'daily', freeTokensPerDay: 1000 },
  { id: 'b', name: 'B 每日', quotaType: 'daily', reset: 'daily', freeTokensPerDay: 2000 },
  { id: 'c', name: 'C 每周', quotaType: 'daily', reset: 'weekly', freeTokensPerDay: 500 },
  { id: 'd', name: 'D 每月', quotaType: 'daily', reset: 'monthly', freeTokensPerDay: 400 },
  { id: 'e', name: 'E 礼包', quotaType: 'gift', reset: 'once', tokensTotal: 5000 },
  { id: 'f', name: 'F 自托管', quotaType: 'selfhost', reset: 'none' },
  { id: 'g', name: 'G 网页', quotaType: 'freechat', reset: 'none' },
  { id: 'h', name: 'H 无 reset', quotaType: 'daily' }
];

const W = {
  a: { enabled: true, used: 200, usedDate: '2026-10-22' },
  b: { enabled: true, used: 2000, usedDate: '2026-10-22' },   /* 用满 */
  c: { enabled: true, used: 100 },
  d: { enabled: false },                                       /* 停用 */
  e: { enabled: true, used: 1000 },
  f: { enabled: true },
  g: { enabled: true },
  h: { enabled: true }
};

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}

const S = scheduleOf(P, W, NOW);

/* ---------- 分桶 ---------- */
ok('每日型进 renew', () => {
  assert.deepStrictEqual(S.renew.items.map(i => i.id), ['a', 'b']);
});
ok('每周/每月进 cycle', () => {
  assert.deepStrictEqual(S.cycle.items.map(i => i.id), ['c']);
});
ok('一次性进 once', () => {
  assert.deepStrictEqual(S.once.items.map(i => i.id), ['e']);
});
ok('自托管/网页/无 reset 被跳过', () => {
  const all = [...S.renew.items, ...S.cycle.items, ...S.once.items].map(i => i.id);
  ['f', 'g', 'h'].forEach(id => assert.ok(!all.includes(id), id + ' 不该出现'));
});
ok('停用的平台不进日程', () => {
  const all = [...S.renew.items, ...S.cycle.items, ...S.once.items].map(i => i.id);
  assert.ok(!all.includes('d'));
});
ok('未开通的平台被计入 hidden', () => {
  const s2 = scheduleOf(P, { a: { enabled: true } }, NOW);
  assert.ok(s2.hidden >= 7);
});

/* ---------- 数值 ---------- */
ok('每日型算出剩余', () => {
  const a = S.renew.items.find(i => i.id === 'a');
  assert.strictEqual(a.cap, 1000);
  assert.strictEqual(a.used, 200);
  assert.strictEqual(a.left, 800);
  assert.strictEqual(a.pct, 20);
});
ok('用满的标记 exhausted', () => {
  const b = S.renew.items.find(i => i.id === 'b');
  assert.strictEqual(b.left, 0);
  assert.strictEqual(b.exhausted, true);
});
ok('一次性额度扣已用', () => {
  const e = S.once.items.find(i => i.id === 'e');
  assert.strictEqual(e.left, 4000);
});
ok('合计只统计各桶', () => {
  assert.strictEqual(S.totals.renewCap, 3000);
  assert.strictEqual(S.totals.renewUsed, 2200);
  assert.strictEqual(S.totals.renewLeft, 800);
  assert.strictEqual(S.totals.onceCap, 5000);
  assert.strictEqual(S.totals.onceLeft, 4000);
});
ok('排序按剩余倒序', () => {
  const lefts = S.renew.items.map(i => i.left);
  for (let i = 1; i < lefts.length; i++) assert.ok(lefts[i - 1] >= lefts[i]);
});

/* ---------- 不编造日期 ---------- */
ok('只有 daily 的日期算已知', () => {
  S.renew.items.forEach(i => assert.strictEqual(i.dateKnown, true));
  S.cycle.items.forEach(i => assert.strictEqual(i.dateKnown, false));
  S.once.items.forEach(i => assert.strictEqual(i.dateKnown, false));
});
ok('周期项带周期标签但不带具体日', () => {
  const c = S.cycle.items[0];
  assert.strictEqual(c.period, '每周刷新');
  assert.ok(!/周[一二三四五六日天]/.test(JSON.stringify(c)), '不该出现具体星期');
});
ok('倒计时算到本地 0 点', () => {
  const ms = msToMidnight(NOW);
  assert.strictEqual(Math.round(ms / 60000), 90);
  assert.strictEqual(S.renew.items[0].hoursLeft, 1);
  assert.strictEqual(S.renew.items[0].minsLeft, 30);
});
ok('正好 0 点时倒计时为 0 而不是负数', () => {
  const t = new Date('2026-10-22T00:00:00+08:00');
  assert.ok(msToMidnight(t) >= 0);
  assert.strictEqual(Math.round(msToMidnight(t) / 3600000), 24);
});

/* ---------- 建议文案 ---------- */
ok('两类都有时建议先烧一次性', () => {
  assert.ok(/先烧/.test(scheduleAdvice({ onceLeft: 100, renewLeft: 100 })));
});
ok('只有可再生时说明不亏', () => {
  assert.ok(/明天照样满血/.test(scheduleAdvice({ onceLeft: 0, renewLeft: 100 })));
});
ok('空清单给出去登记的指引', () => {
  assert.ok(/我的额度/.test(scheduleAdvice({ onceLeft: 0, renewLeft: 0 })));
});

/* ---------- 边界 ---------- */
ok('空平台列表不崩', () => {
  const s = scheduleOf([], {}, NOW);
  assert.deepStrictEqual(s.renew.items, []);
  assert.strictEqual(s.totals.renewCap, 0);
});
ok('没有可用额度的平台不会进桶', () => {
  const s = scheduleOf([{ id: 'x', name: 'X', quotaType: 'gift', reset: 'once' }],
    { x: { enabled: true } }, NOW);
  assert.deepStrictEqual(s.once.items, []);
});

console.log(`\n重置日程：通过 ${pass} / ${pass + fail}` + (fail ? `，失败 ${fail}` : '，全部通过'));
process.exit(fail ? 1 : 0);
