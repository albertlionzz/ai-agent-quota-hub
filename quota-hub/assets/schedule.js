/* ============================================================
   重置日程（纯函数）
   ------------------------------------------------------------
   数据里真实存在的只有 reset 字段：daily / weekly / monthly / once / none。
   没有一家平台公示「每周哪天重置」「每月几号重置」，全库 expiresAt 也是 0 条。
   所以这个视图只做三件有据可依的事：
     1. 今天会刷新的（reset=daily）——能算到本地 0 点的倒计时
     2. 周期性刷新但日期未公示的（weekly / monthly）——只标周期，不编日期
     3. 只减不增的（reset=once，含礼包/试用）——提醒优先烧
   算不出来的东西就不显示，这比给个假日期更有用。
   ============================================================ */

/* 距下一个本地 0 点的毫秒数 */
function msToMidnight(now) {
  const d = now ? new Date(now) : new Date();
  const next = new Date(d);
  next.setHours(24, 0, 0, 0);
  return Math.max(0, next - d);
}

/* 主函数：把平台 + 钱包记录整理成日程
   返回 {
     renew  : { items: [...] },   今天会刷新的
     cycle  : { items: [...] },   周期刷新但日期未公示
     once   : { items: [...] },   只减不增
     totals : { renewCap, renewUsed, renewLeft, onceCap, onceUsed, onceLeft },
     hidden : 因未开通 / 无额度 / 找不到而跳过的条数
   }
   每条 item: { id, name, reset, cap, used, left, pct, exhausted, hoursLeft, period } */
function scheduleOf(platforms, wallet, now) {
  const at = now ? new Date(now) : new Date();
  const ms = msToMidnight(at);
  const hoursLeft = Math.floor(ms / 3600000);
  const minsLeft = Math.floor((ms % 3600000) / 60000);

  const renew = [], cycle = [], once = [];
  const totals = { renewCap: 0, renewUsed: 0, renewLeft: 0, onceCap: 0, onceUsed: 0, onceLeft: 0 };
  const seen = {};
  let hidden = 0;

  (platforms || []).forEach(p => {
    const w = (wallet || {})[p.id];
    if (!w || w.enabled === false) { hidden++; return; }   /* 没开通或已停用，不进日程 */

    const reset = p.reset || 'none';
    if (reset === 'none' || p.quotaType === 'selfhost' || p.quotaType === 'freechat') {
      hidden++;
      return;
    }

    const u = usageOf(p, w, at);
    if (u.mode === 'none') { hidden++; return; }

    seen[p.id] = 1;
    const base = {
      id: p.id,
      name: p.name,
      reset,
      cap: u.cap,
      used: u.used,
      left: u.left,
      pct: u.pct,
      exhausted: u.left <= 0,
      hoursLeft,
      minsLeft,
      /* 日期是否真的已知——给渲染层用，避免 UI 上出现「下周二」这种编出来的说法 */
      dateKnown: reset === 'daily',
      period: reset === 'weekly' ? '每周刷新' : reset === 'monthly' ? '每月刷新' : ''
    };

    if (reset === 'daily') {
      renew.push(base);
      totals.renewCap += u.cap;
      totals.renewUsed += u.used;
      totals.renewLeft += u.left;
    } else if (reset === 'weekly' || reset === 'monthly') {
      cycle.push(base);
    } else {
      /* 其余（once，或礼包/试用）都按「只减不增」处理 */
      once.push(base);
      totals.onceCap += u.cap;
      totals.onceUsed += u.used;
      totals.onceLeft += u.left;
    }
  });

  /* 排序按「还剩多少」倒序：剩得多的先安排，快见底的也一眼能看到 */
  renew.sort((a, b) => b.left - a.left);
  cycle.sort((a, b) => b.left - a.left);
  once.sort((a, b) => b.left - a.left);

  return { renew: { items: renew }, cycle: { items: cycle }, once: { items: once }, totals, hidden };
}

/* 一句话行动建议：先烧不会回来的，再用每天回来的 */
function scheduleAdvice(totals) {
  if (totals.onceLeft > 0 && totals.renewLeft > 0) {
    return '先烧「只减不增」的那部分——每天刷新的明天还会回来，一次性的没了就是没了。';
  }
  if (totals.onceLeft > 0) return '当前只有一次性额度可用，没有可再生的，省着点规划。';
  if (totals.renewLeft > 0) return '当前全是可再生的日额度，今天用不完也不亏，明天照样满血。';
  return '清单里还没有登记可用的额度，先去「我的额度」把已开通的平台加进来。';
}
