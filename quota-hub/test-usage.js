/* 用量登记纯函数单测：直接 require 真实源码，不复制逻辑 */
const assert = require('assert');
const { parseTok, fmtTok, usageOf, applyUsage, walletTotals, todayKey } = require('./assets/usage.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

/* ---------- parseTok ---------- */
ok('空字符串当 0', () => eq(parseTok(''), 0));
ok('纯数字', () => eq(parseTok('3000'), 3000));
ok('带千分位', () => eq(parseTok('1,200,000'), 1200000));
ok('中文万', () => eq(parseTok('1.5万'), 15000));
ok('w 结尾', () => eq(parseTok('2w'), 20000));
ok('k 结尾', () => eq(parseTok('200k'), 200000));
ok('千字', () => eq(parseTok('3千'), 3000));
ok('m 结尾', () => eq(parseTok('1.2m'), 1200000));
ok('亿', () => eq(parseTok('0.5亿'), 50000000));
ok('前后空格', () => eq(parseTok('  2万 '), 20000));
ok('全角逗号', () => eq(parseTok('1，000'), 1000));
ok('无法解析返回 null 而不是 0', () => eq(parseTok('大约两千'), null));
ok('负数当非法', () => eq(parseTok('-5'), null));
ok('多个小数点非法', () => eq(parseTok('1.2.3'), null));
ok('单位重复非法', () => eq(parseTok('2kk'), null));
ok('null 输入', () => eq(parseTok(null), null));

/* ---------- fmtTok ---------- */
ok('fmtTok 1.5万', () => eq(fmtTok(15000), '1.5万'));
ok('fmtTok 整数万不出现 .0', () => eq(fmtTok(20000), '2万'));
ok('fmtTok 小数字原样', () => eq(fmtTok(3000), '3000'));
ok('fmtTok 亿', () => eq(fmtTok(1e8), '1亿'));

/* ---------- usageOf ---------- */
const NOW = new Date('2026-10-22T10:00:00+08:00');

ok('礼包：扣减后给余量', () => {
  const p = { quotaType: 'gift', tokensTotal: 1000000 };
  const u = usageOf(p, { used: 250000 }, NOW);
  eq(u.mode, 'oneshot'); eq(u.cap, 1000000); eq(u.used, 250000);
  eq(u.left, 750000); eq(u.pct, 25); eq(u.over, false);
});
ok('礼包：用超了 left 归零且 over 为真', () => {
  const u = usageOf({ quotaType: 'gift', tokensTotal: 100 }, { used: 150 }, NOW);
  eq(u.left, 0); eq(u.over, true); eq(u.pct, 100);
});
ok('每日型：同一天保留已用', () => {
  const p = { quotaType: 'daily', freeTokensPerDay: 2000000 };
  const u = usageOf(p, { used: 500000, usedDate: '2026-10-22' }, NOW);
  eq(u.mode, 'daily'); eq(u.used, 500000); eq(u.left, 1500000);
});
ok('每日型：跨天自动归零', () => {
  const p = { quotaType: 'daily', freeTokensPerDay: 2000000 };
  const u = usageOf(p, { used: 1900000, usedDate: '2026-10-21' }, NOW);
  eq(u.used, 0); eq(u.left, 2000000);
});
ok('永久档按每日额度算', () => {
  const u = usageOf({ quotaType: 'forever', freeTokensPerDay: 500000 }, { used: 1000 }, NOW);
  eq(u.mode, 'daily'); eq(u.cap, 500000);
});
ok('自托管不出用量条', () => eq(usageOf({ quotaType: 'selfhost' }, {}, NOW).mode, 'none'));
ok('网页版不出用量条', () => eq(usageOf({ quotaType: 'freechat' }, {}, NOW).mode, 'none'));
ok('没有额度数字的平台不出用量条', () => eq(usageOf({ quotaType: 'gift' }, {}, NOW).mode, 'none'));
ok('used 为脏数据时按 0 处理', () => {
  const u = usageOf({ quotaType: 'gift', tokensTotal: 1000 }, { used: 'x' }, NOW);
  eq(u.used, 0); eq(u.left, 1000);
});
ok('used 为负按 0', () => {
  const u = usageOf({ quotaType: 'gift', tokensTotal: 1000 }, { used: -50 }, NOW);
  eq(u.used, 0);
});

/* ---------- applyUsage ---------- */
ok('登记成功写回 used', () => {
  const p = { quotaType: 'gift', tokensTotal: 1000 };
  const w = applyUsage(p, {}, '400', NOW);
  eq(w.used, 400);
});
ok('每日型写回 used 并落日期', () => {
  const p = { quotaType: 'daily', freeTokensPerDay: 5000 };
  const w = applyUsage(p, {}, '1万', NOW);
  eq(w.used, 5000);            /* 超上限要夹住，避免出现「已用 > 日额度」的鬼数 */
  eq(w.usedDate, todayKey(NOW));
});
ok('解析失败返回 null', () => {
  eq(applyUsage({ quotaType: 'gift', tokensTotal: 1000 }, {}, '两千', NOW), null);
});
ok('无额度平台返回 null', () => {
  eq(applyUsage({ quotaType: 'selfhost' }, {}, '100', NOW), null);
});
ok('不改入参对象', () => {
  const w = { used: 10 };
  applyUsage({ quotaType: 'gift', tokensTotal: 1000 }, w, '20', NOW);
  eq(w.used, 10);
});

/* ---------- walletTotals ---------- */
ok('一次性余量扣掉已用（这正是原版标签错的地方）', () => {
  const P = { a: { quotaType: 'gift', tokensTotal: 1000 }, b: { quotaType: 'trial', tokensTotal: 2000 } };
  const t = walletTotals([['a', { used: 600 }], ['b', {}]], id => P[id], NOW);
  eq(t.oneShotCap, 3000);
  eq(t.oneShotLeft, 2400);
  eq(t.burned, 600);
});
ok('月度产能 = 可再生×30 + 一次性余量', () => {
  const P = { a: { quotaType: 'gift', tokensTotal: 1000 }, d: { quotaType: 'daily', freeTokensPerDay: 100 } };
  const t = walletTotals([['a', { used: 400 }], ['d', { used: 30, usedDate: '2026-10-22' }]], id => P[id], NOW);
  eq(t.monthly, 3000 + 600);
  eq(t.usedToday, 30);
  eq(t.dailyPct, 30);
});
ok('极低占比不显示成 0%（保留一位小数）', () => {
  const P = { d: { quotaType: 'daily', freeTokensPerDay: 6200000 } };
  const t = walletTotals([['d', { used: 15000, usedDate: '2026-10-22' }]], id => P[id], NOW);
  eq(t.dailyPct, 0.2);
});
ok('未知平台 id 被跳过', () => {
  const t = walletTotals([['ghost', { used: 1 }]], () => undefined, NOW);
  eq(t.oneShotCap, 0); eq(t.renewCap, 0);
});
ok('空清单', () => {
  const t = walletTotals([], () => undefined, NOW);
  eq(t.monthly, 0);
});

console.log(`\n用量登记：通过 ${pass} / ${pass + fail}` + (fail ? `，失败 ${fail}` : '，全部通过'));
process.exit(fail ? 1 : 0);
