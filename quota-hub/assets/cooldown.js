/* ============================================================
   限流冷却（cooldown）
   ------------------------------------------------------------
   额度表回答「这个平台有多少量」，不回答「它此刻肯不肯收你」。
   真实使用中最常见的状态是 429：余额还在，但这一段时间就是不接。
   旧版排产会继续把活派给一个正在拒你的通道，人只能对着失败反复重试。

   所以把「暂时不可用」做成带到期时间的状态：排产时按 0 计，
   到期自动恢复。它刻意不叫「停用」——停用是人的决定，
   冷却是平台的决定，混在一起会让人以为是自己关掉的。
   ============================================================ */

const COOL_PRESETS = [
  { min: 15, label: '15 分钟' },
  { min: 60, label: '1 小时' },
  { min: 360, label: '6 小时' },
  { min: 1440, label: '到明天' }
];

/* 到期时间戳；脏数据一律当「没有冷却」，不要因为一个坏字段把平台锁死 */
function coolUntil(w) {
  const t = w && w.cool;
  return typeof t === 'number' && isFinite(t) && t > 0 ? t : 0;
}

function coolLeft(w, now) {
  const n = now == null ? Date.now() : +now;
  const t = coolUntil(w);
  return t > n ? t - n : 0;
}

function isCooling(w, now) {
  return coolLeft(w, now) > 0;
}

/* 人话：42 分钟 / 3 小时 20 分 / 1 天 6 小时 */
function fmtCool(ms) {
  if (!(ms > 0)) return '已结束';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60), rh = m % 60;
  if (h < 24) return rh ? h + ' 小时 ' + rh + ' 分' : h + ' 小时';
  const d = Math.floor(h / 24), rd = h % 24;
  return rd ? d + ' 天 ' + rd + ' 小时' : d + ' 天';
}

/* 写入冷却，返回新对象（不改原对象，便于测试和撤销） */
function setCool(w, min, now) {
  const n = now == null ? Date.now() : +now;
  const base = w && typeof w === 'object' ? w : {};
  const m = Number(min);
  if (!(m > 0)) return clearCool(base);
  return Object.assign({}, base, { cool: n + m * 60000, coolMin: m });
}

function clearCool(w) {
  const out = Object.assign({}, w || {});
  delete out.cool;
  delete out.coolMin;
  return out;
}

/* 清掉已到期的冷却。
   不清也能用（isCooling 会返回 false），但字段会一直留在备份里，
   导出给人看时像还有效。返回 changed 让调用方决定是否落盘。 */
function pruneCool(wallet, now) {
  const n = now == null ? Date.now() : +now;
  const out = {};
  let changed = false;
  Object.keys(wallet || {}).forEach(id => {
    const w = wallet[id];
    if (w && typeof w === 'object' && coolUntil(w) && coolUntil(w) <= n) {
      out[id] = clearCool(w);
      changed = true;
    } else {
      out[id] = w;
    }
  });
  return { wallet: out, changed };
}

/* 下拉框该选中哪一项：'0' 不限流 / preset 的分钟数 / 'custom'（导入来的非标准时长） */
function coolSelectValue(w, now) {
  const left = coolLeft(w, now);
  if (!left) return '0';
  const m = Number(w && w.coolMin);
  return COOL_PRESETS.some(p => p.min === m) ? String(m) : 'custom';
}

/* 主方案里被跳过的平台要显式说出来。
   静默少算一个平台，比多算一个更坏——人会以为额度真的不够。 */
function coolSkipNote(wallet, byIdFn, now) {
  const skipped = [];
  Object.keys(wallet || {}).forEach(id => {
    const w = wallet[id];
    if (!w || !w.enabled) return;
    const left = coolLeft(w, now);
    if (!left) return;
    const p = byIdFn(id);
    if (!p) return;
    skipped.push({ id, name: p.name, left, label: fmtCool(left) });
  });
  return skipped.sort((a, b) => b.left - a.left);
}

if (typeof module === 'object' && module.exports) {
  module.exports = {
    COOL_PRESETS, coolUntil, coolLeft, isCooling, fmtCool,
    setCool, clearCool, pruneCool, coolSelectValue, coolSkipNote
  };
}
