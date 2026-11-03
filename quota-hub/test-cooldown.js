/* 限流冷却单测：require 真实源码 */
const assert = require('assert');
const {
  COOL_PRESETS, coolUntil, coolLeft, isCooling, fmtCool,
  setCool, clearCool, pruneCool, coolSelectValue, coolSkipNote
} = require('./assets/cooldown.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

const T0 = 1750000000000; // 固定基准时间，避免测试依赖真实时钟

/* ---------- 读取 ---------- */
ok('没有 cool 字段 → 不算冷却', () => eq(isCooling({}, T0), false));
ok('coolUntil 对脏数据返回 0', () => {
  eq(coolUntil({ cool: 'abc' }), 0);
  eq(coolUntil({ cool: -1 }), 0);
  eq(coolUntil({ cool: null }), 0);
  eq(coolUntil(null), 0);
});
ok('未到期 → 还在冷却', () => eq(isCooling({ cool: T0 + 60000 }, T0), true));
ok('刚好到期 → 已结束（边界按 > 算）', () => eq(isCooling({ cool: T0 }, T0), false));
ok('coolLeft 不会返回负数', () => eq(coolLeft({ cool: T0 - 99999 }, T0), 0));
ok('coolLeft 返回剩余毫秒', () => eq(coolLeft({ cool: T0 + 90000 }, T0), 90000));

/* ---------- 人话 ---------- */
ok('不到 1 分钟也显示 1 分钟（向上取整，别显示 0）', () => eq(fmtCool(1000), '1 分钟'));
ok('42 分钟', () => eq(fmtCool(42 * 60000), '42 分钟'));
ok('整小时不带零分', () => eq(fmtCool(60 * 60000), '1 小时'));
ok('3 小时 20 分', () => eq(fmtCool((3 * 60 + 20) * 60000), '3 小时 20 分'));
ok('跨天显示天+小时', () => eq(fmtCool(30 * 60 * 60000), '1 天 6 小时'));
ok('整2天不带零小时', () => eq(fmtCool(48 * 60 * 60000), '2 天'));
ok('0 毫秒显示已结束', () => eq(fmtCool(0), '已结束'));

/* ---------- 写入 ---------- */
ok('setCool 写到期时间与时长', () => {
  const w = setCool({ enabled: true, used: 10 }, 60, T0);
  eq(w.cool, T0 + 60 * 60000);
  eq(w.coolMin, 60);
});
ok('setCool 不改原对象', () => {
  const src = { enabled: true };
  setCool(src, 60, T0);
  eq(src.cool, undefined);
});
ok('setCool 保留原有字段', () => {
  const w = setCool({ enabled: false, used: 7, note: 'x' }, 15, T0);
  eq([w.enabled, w.used, w.note], [false, 7, 'x']);
});
ok('setCool 0 分钟等于清除', () => eq(coolUntil(setCool({ cool: T0 + 1000, coolMin: 60 }, 0, T0)), 0));
ok('setCool 传脏值等于清除', () => eq(coolUntil(setCool({ cool: T0 + 1000 }, 'abc', T0)), 0));
ok('setCool 对 null 也能用', () => eq(coolUntil(setCool(null, 60, T0)), T0 + 60 * 60000));
ok('clearCool 同时删掉 coolMin', () => {
  const w = clearCool({ enabled: true, cool: T0 + 1000, coolMin: 60 });
  eq(w.coolMin, undefined);
  eq(w.enabled, true);
});

/* ---------- 清理 ---------- */
ok('pruneCool 清掉到的、留下没到的', () => {
  const r = pruneCool({
    a: { cool: T0 - 1, coolMin: 60 },   // 已过期
    b: { cool: T0 + 60000, coolMin: 60 }, // 还有效
    c: { enabled: true }                // 无冷却
  }, T0);
  eq(r.changed, true);
  eq(r.wallet.a.cool, undefined);
  eq(r.wallet.b.coolMin, 60);
  eq(r.wallet.c.enabled, true);
});
ok('pruneCool 无可清时 changed=false（不要触发多余落盘）', () => {
  const r = pruneCool({ a: { cool: T0 + 60000 } }, T0);
  eq(r.changed, false);
});
ok('pruneCool 空钱包不炸', () => eq(pruneCool({}, T0).changed, false));
ok('pruneCool undefined 不炸', () => eq(pruneCool(undefined, T0).changed, false));

/* ---------- 下拉框取值 ---------- */
ok('无冷却 → 0', () => eq(coolSelectValue({}, T0), '0'));
ok('标准时长 → 该项', () => eq(coolSelectValue({ cool: T0 + 60000, coolMin: 60 }, T0), '60'));
ok('导入来的非标准时长 → custom', () => eq(coolSelectValue({ cool: T0 + 60000, coolMin: 45 }, T0), 'custom'));
ok('冷却到期但字段还在 → 回到 0', () => eq(coolSelectValue({ cool: T0 - 1, coolMin: 60 }, T0), '0'));
ok('四个预设都在下拉里', () => eq(COOL_PRESETS.map(p => p.min), [15, 60, 360, 1440]));

/* ---------- 排产跳过 ---------- */
const byId = id => ({ a: { name: '甲平台' }, b: { name: '乙平台' }, c: { name: '丙平台' } }[id]);
ok('只列启用且冷却中的，按剩余时间倒序', () => {
  const wallet = {
    a: { enabled: true, cool: T0 + 10 * 60000 },
    b: { enabled: true, cool: T0 + 60 * 60000 },
    c: { enabled: true },                       // 正常
    d: { enabled: false, cool: T0 + 999 * 60000 } // 已停用，不该算
  };
  const list = coolSkipNote(wallet, byId, T0);
  eq(list.map(x => x.id), ['b', 'a']);
  eq(list[0].label, '1 小时');
});
ok('冷却到期的不列出来', () => {
  eq(coolSkipNote({ a: { enabled: true, cool: T0 - 1 } }, byId, T0).length, 0);
});
ok('平台库里没有的 id 跳过而不是显示 id', () => {
  eq(coolSkipNote({ zz: { enabled: true, cool: T0 + 60000 } }, byId, T0).length, 0);
});

console.log(`\n合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
