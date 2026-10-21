/* ============================================================
   用量登记 —— 纯函数，无 DOM / 无存储依赖
   目的：把「已用多少、还剩多少」从标签口号变成可算的数。
   这个文件单独抽出来是为了能直接单测（test-usage.js），
   而不是像早期测试那样把逻辑抄一遍——抄一遍的测试，代码改了它不会报错。
   ============================================================ */

/* 解析人手输入的 token 数：支持 3000 / 1.5万 / 2w / 200k / 1.2m / 3,000 / 空
   返回整数；无法解析返回 null（调用方据此回退，不要静默当 0）。 */
function parseTok(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[,，\s]/g, '').toLowerCase();
  if (!s) return 0;
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)(亿|万|w|k|千|m)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = m[2] || '';
  const mul = { '': 1, '千': 1e3, 'k': 1e3, '万': 1e4, 'w': 1e4, 'm': 1e6, '亿': 1e8 }[unit];
  if (!mul) return null;
  return Math.max(0, Math.round(n * mul));
}

/* 格式化回显：输入框里不要出现 15000，尽量还原成人写的 1.5万 */
function fmtTok(n) {
  if (n == null) return '';
  if (n >= 1e8) return trimZero(n / 1e8) + '亿';
  if (n >= 1e4) return trimZero(n / 1e4) + '万';
  return String(n);
  function trimZero(v) { return String(Math.round(v * 10) / 10); }
}

function todayKey(now) {
  const d = now ? new Date(now) : new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 单个平台的用量视图。
   mode:
     oneshot —— 一次性礼包/试用，used 累计扣减 tokensTotal，跨天不清零
     daily   —— 永久档/每日刷新，used 指「今天已用」，跨天自动归零
     none    —— 自托管/网页版/无明确额度数字，不显示用量条
   返回 { mode, cap, used, left, pct, over, resetDaily, unit } */
function usageOf(p, w, now) {
  const rec = w || {};
  const qt = p && p.quotaType;
  const none = { mode: 'none', cap: 0, used: 0, left: 0, pct: 0, over: false, resetDaily: false, unit: '' };

  if (qt === 'selfhost' || qt === 'freechat') return none;

  const isOneShot = (qt === 'gift' || qt === 'trial');
  const cap = isOneShot ? (p.tokensTotal || 0) : (p.freeTokensPerDay || 0);
  if (!cap) return none;

  let used = Number(rec.used);
  if (!isFinite(used) || used < 0) used = 0;

  /* 每日刷新型：换了日期就把「今日已用」归零，否则昨天的数字会一直挂着误导人 */
  if (!isOneShot && rec.usedDate && rec.usedDate !== todayKey(now)) used = 0;

  const left = Math.max(0, cap - used);
  return {
    mode: isOneShot ? 'oneshot' : 'daily',
    cap,
    used,
    left,
    pct: Math.min(100, Math.round((used / cap) * 100)),
    over: used > cap,
    resetDaily: !isOneShot,
    unit: isOneShot ? 'tok' : 'tok/日'
  };
}

/* 把一次登记写回 wallet 记录（返回新对象，不改入参） */
function applyUsage(p, w, raw, now) {
  const n = parseTok(raw);
  if (n == null) return null;                       /* 解析失败：调用方应回退输入框 */
  const u = usageOf(p, { used: n, usedDate: null }, now);
  if (u.mode === 'none') return null;               /* 该平台没有可记的额度 */
  const next = Object.assign({}, w || {});
  next.used = u.mode === 'daily' ? Math.min(n, u.cap) : n;
  if (u.mode === 'daily') next.usedDate = todayKey(now);
  return next;
}

/* 汇总：区分「可再生」与「一次性余量」。
   关键修正：一次性额度必须扣掉已用，否则「余量」两个字是假的。 */
function walletTotals(entries, byIdFn, now) {
  let renewCap = 0, oneShotCap = 0, oneShotLeft = 0, usedToday = 0;
  (entries || []).forEach(([id, w]) => {
    const p = byIdFn(id);
    if (!p) return;
    const u = usageOf(p, w, now);
    if (u.mode === 'daily') { renewCap += u.cap; usedToday += u.used; }
    if (u.mode === 'oneshot') { oneShotCap += u.cap; oneShotLeft += u.left; }
  });
  return {
    renewCap,
    usedToday,
    dailyPct: renewCap ? Math.round((usedToday / renewCap) * 1000) / 10 : 0,
    oneShotCap,
    oneShotLeft,
    burned: oneShotCap - oneShotLeft,
    monthly: renewCap * 30 + oneShotLeft
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTok, fmtTok, usageOf, applyUsage, walletTotals, todayKey };
}
