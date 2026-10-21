/* 路由引擎冒烟测试：把 data.js 载入并复现调度逻辑，检查结果是否合理 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'assets', 'data.js'), 'utf8');
const ctx = {};
new Function('exports', src + '\n;Object.assign(exports,{PLATFORMS,QUOTA_TYPES,TASK_TAGS,DATA_DATE,SELFHOST_DAILY_EST});')(ctx);
const { PLATFORMS, QUOTA_TYPES, TASK_TAGS, SELFHOST_DAILY_EST } = ctx;

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n === Infinity) return 'Infinity';
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

function dailyCapacity(p, inTok, outTok) {
  const perReq = Math.max(1, inTok + outTok);
  if (p.quotaType === 'selfhost') return { cap: SELFHOST_DAILY_EST, basis: 'selfhost-est', maxReq: Infinity };

  const maxReq = p.reqPerDay || Infinity;
  const capByReq = maxReq === Infinity ? Infinity : maxReq * perReq;
  let capByTok = Infinity;
  let basis = '';
  if (p.freeTokensPerDay) { capByTok = p.freeTokensPerDay; basis = 'daily-quota'; }
  if (p.tokensTotal) {
    const days = p.expiresAt ? Math.max(1, Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000)) : 60;
    capByTok = Math.min(capByTok, Math.round(p.tokensTotal / days));
    basis = basis || 'amortized';
  }
  if (capByTok === Infinity && capByReq === Infinity) return { cap: 0, basis: 'n/a', maxReq };
  if (capByReq < capByTok) return { cap: capByReq, basis: 'req-bound', maxReq };
  if (capByTok === Infinity) return { cap: capByReq, basis, maxReq };
  return { cap: capByTok, basis, maxReq };
}

function route(task, reqs, inTok, outTok) {
  const perReq = inTok + outTok;
  const demand = reqs * perReq;
  const cands = PLATFORMS
    .filter(p => (p.tags || []).includes(task))
    .map(p => {
      const { cap, basis, maxReq } = dailyCapacity(p, inTok, outTok);
      return { p, cap, basis, maxReq, weight: QUOTA_TYPES[p.quotaType].weight };
    })
    .filter(c => c.cap > 0)
    .sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : b.cap - a.cap));

  const renewable = cands.filter(c => ['forever', 'daily', 'selfhost'].includes(c.p.quotaType));
  const oneShot = cands.filter(c => ['gift', 'trial'].includes(c.p.quotaType));
  let remaining = demand;
  let remReq = reqs;
  const plan = [];
  const fill = list => {
    for (const c of list) {
      if (remaining <= 0 || remReq <= 0) break;
      const reqRoom = c.maxReq === Infinity ? remReq : Math.min(remReq, c.maxReq);
      const tokRoom = Math.floor(c.cap / perReq);
      const takeReq = Math.min(reqRoom, tokRoom);
      if (takeReq <= 0) continue;
      const take = Math.min(remaining, takeReq * perReq);
      const realReq = Math.ceil(take / perReq);
      plan.push({ name: c.p.name, id: c.p.id, take, reqs: realReq, cap: c.cap, type: c.p.quotaType, maxReq: c.maxReq });
      remaining -= take;
      remReq -= realReq;
    }
  };
  fill(renewable);
  fill(oneShot);
  return { demand, plan, remaining, remReq, covered: demand - remaining };
}

let fail = 0;
const check = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fail++; } else { console.log('  ✓ ' + msg); } };

console.log('\n=== 1. 数据完整性 ===');
check(PLATFORMS.length >= 30, `平台数量 ${PLATFORMS.length} >= 30`);
const ids = new Set();
let dup = 0;
PLATFORMS.forEach(p => { if (ids.has(p.id)) { dup++; console.error('   重复 id: ' + p.id); } ids.add(p.id); });
check(dup === 0, '无重复 id');
const badType = PLATFORMS.filter(p => !QUOTA_TYPES[p.quotaType]);
check(badType.length === 0, '所有 quotaType 均合法' + (badType.length ? ' -> ' + badType.map(p => p.id).join(',') : ''));
const badTag = PLATFORMS.filter(p => (p.tags || []).some(t => !TASK_TAGS[t]));
check(badTag.length === 0, '所有 tags 均合法' + (badTag.length ? ' -> ' + badTag.map(p => p.id).join(',') : ''));
const noConf = PLATFORMS.filter(p => !['verified', 'reported', 'disputed'].includes(p.confidence));
check(noConf.length === 0, '所有条目都有可信度分级');

console.log('\n=== 2. 每个任务标签都有可用平台 ===');
for (const t of Object.keys(TASK_TAGS)) {
  const n = PLATFORMS.filter(p => (p.tags || []).includes(t)).length;
  check(n >= 2, `${TASK_TAGS[t]}(${t}) 有 ${n} 个平台`);
}

console.log('\n=== 3. 路由场景：投研长文分析（200 次/日，3K 入 800 出）===');
let r = route('long-text', 200, 3000, 800);
console.log(`  需求 ${fmt(r.demand)} tok/日，覆盖 ${fmt(r.covered)}，缺口 ${fmt(r.remaining)}`);
r.plan.slice(0, 6).forEach((s, i) => console.log(`   ${i + 1}. ${s.name} [${s.type}] 承担 ${fmt(s.take)}`));
check(r.plan.length > 0, '长文任务有方案');
check(r.remaining <= 0, '长文任务可被免费额度覆盖');
check(r.plan[0].type === 'forever' || r.plan[0].type === 'daily', '首选的是可再生额度（非一次性礼包）');

console.log('\n=== 4. 路由场景：代码生成（50 次/日，8K 入 2K 出）===');
r = route('code', 50, 8000, 2000);
console.log(`  需求 ${fmt(r.demand)} tok/日，缺口 ${fmt(r.remaining)}`);
r.plan.slice(0, 5).forEach((s, i) => console.log(`   ${i + 1}. ${s.name} [${s.type}] 承担 ${fmt(s.take)}`));
check(r.plan.length > 0, '代码任务有方案');

console.log('\n=== 5. 边界：巨额需求应出现缺口 ===');
r = route('long-text', 100000, 30000, 5000);
console.log(`  需求 ${fmt(r.demand)} tok/日，缺口 ${fmt(r.remaining)}`);
check(r.remaining > 0, '超大需求正确报告缺口（不虚报可覆盖）');

console.log('\n=== 6. 边界：小额需求不应溢出 ===');
r = route('chat', 5, 500, 300);
const totalTake = r.plan.reduce((s, x) => s + x.take, 0);
console.log(`  需求 ${fmt(r.demand)}，方案实际分配 ${fmt(totalTake)}`);
check(totalTake === r.demand, '小额需求的分配量恰好等于需求量（无过度分配）');

console.log('\n=== 7. 一次性礼包不得排在永久档之前 ===');
const orderBad = r.plan.length > 1 && ['gift', 'trial'].includes(r.plan[0].type) &&
  r.plan.some(x => ['forever', 'daily'].includes(x.type));
check(!orderBad, '可再生额度优先于一次性礼包');

console.log('\n=== 8. 请求次数硬顶必须生效（RPD 约束）===');
{
  const gem = PLATFORMS.find(p => p.id === 'gemini');
  const perReq = 3000 + 800;
  const { cap, maxReq, basis } = dailyCapacity(gem, 3000, 800);
  console.log(`  Gemini: cap=${fmt(cap)} maxReq=${maxReq} basis=${basis}`);
  check(maxReq === 250, `Gemini 的 RPD 硬顶被识别为 250（实际 ${maxReq}）`);
  check(cap === 250 * perReq, 'Gemini 的 cap 受 RPD 约束而非 token 额度（120万）');
  check(cap < gem.freeTokensPerDay, 'cap 小于原始 token 额度 → 说明次数确实成了瓶颈');
}
{
  /* 要 1000 次，看 Gemini 是否被限制在 250 次内 */
  const r2 = route('long-text', 1000, 3000, 800);
  const gemRow = r2.plan.find(x => x.id === 'gemini');
  if (gemRow) {
    console.log(`  需求 1000 次时，Gemini 实际承担 ${gemRow.reqs} 次`);
    check(gemRow.reqs <= 250, 'Gemini 承担次数未超过 250 RPD 上限');
  } else {
    check(true, 'Gemini 未被选入方案（额度已被更优平台覆盖）');
  }
}

console.log('\n=== 9. 总分配量绝不超过总需求 ===');
for (const sc of [['chat', 10, 200, 100], ['long-text', 5000, 5000, 1000], ['code', 1, 100, 100]]) {
  const rr = route(...sc);
  const sum = rr.plan.reduce((s, x) => s + x.take, 0);
  check(sum <= rr.demand, `${sc[0]}(${sc[1]}次) 分配 ${fmt(sum)} <= 需求 ${fmt(rr.demand)}`);
  check(rr.remaining >= 0, `${sc[0]} 缺口非负`);
}

console.log('\n' + (fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项失败`));
process.exit(fail === 0 ? 0 : 1);
