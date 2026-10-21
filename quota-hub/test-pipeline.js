/* 编排引擎验证：不测 DOM，只测「分配结果是否符合资源约束」。
   这类算法的错误都在细节里——礼包被重复使用、同一天超额分配、
   或者把需要联网的阶段塞给不会联网的 API，都是会让用户当天撞墙的 bug。 */
const fs = require('fs');
const path = require('path');

const A = p => path.join(__dirname, 'assets', p);
const dataSrc = fs.readFileSync(A('data.js'), 'utf8');
const pipeFull = fs.readFileSync(A('pipeline.js'), 'utf8');

/* 只取引擎部分（模板 + 分配逻辑），视图层依赖 DOM，不能载入 */
const cut = pipeFull.indexOf('视图：编排');
if (cut < 0) throw new Error('pipeline.js 结构变了：找不到「视图：编排」分界');
const pipeSrc = pipeFull.slice(0, pipeFull.lastIndexOf('/*', cut));

const ctx = {};
new Function('exports', dataSrc + '\n;Object.assign(exports,{PLATFORMS,QUOTA_TYPES,TASK_TAGS,DATA_DATE,SELFHOST_DAILY_EST});')(ctx);
const { PLATFORMS, QUOTA_TYPES, SELFHOST_DAILY_EST } = ctx;

/* 复刻 app.js 的 dailyCapacity（测试里独立实现，避免与被测代码同源同错） */
const dailyCapacity = (p, inTok, outTok) => {
  const perReq = Math.max(1, inTok + outTok);
  if (p.quotaType === 'selfhost') return { cap: SELFHOST_DAILY_EST, maxReq: Infinity };
  const maxReq = p.reqPerDay || Infinity;
  const capByReq = maxReq === Infinity ? Infinity : maxReq * perReq;
  let capByTok = Infinity;
  if (p.freeTokensPerDay) capByTok = p.freeTokensPerDay;
  if (p.tokensTotal) {
    const days = p.expiresAt ? Math.max(1, Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000)) : 60;
    capByTok = Math.min(capByTok, Math.round(p.tokensTotal / days));
  }
  if (capByTok === Infinity && capByReq === Infinity) return { cap: 0, maxReq };
  return { cap: Math.min(capByReq, capByTok), maxReq };
};
const fmt = n => String(n);

const sandbox = {};
new Function(
  'exports', 'dailyCapacity', 'fmt', 'PLATFORMS', 'QUOTA_TYPES',
  pipeSrc +
  `\n;Object.assign(exports,{PIPELINE_TEMPLATES,planPipeline,pipeCandidates,pipeScriptable,CARD_TOK,SCALES,PAID_REF,PIPE_BASE});`
)(sandbox, dailyCapacity, fmt, PLATFORMS, QUOTA_TYPES);

let fail = 0;
const check = (ok, msg, extra) => {
  if (!ok) { fail++; console.log(`  ✗ ${msg}${extra ? '  → ' + extra : ''}`); }
  else console.log(`  ✓ ${msg}`);
};

const { PIPELINE_TEMPLATES, planPipeline, CARD_TOK, SCALES, PIPE_BASE } = sandbox;
const plan = (t, s, m) => planPipeline(t, s, m);

console.log('\n=== 1. 模板完整性 ===');
check(PIPELINE_TEMPLATES.length === 6, `收录 ${PIPELINE_TEMPLATES.length} 个模板（应为 6）`);
let badStage = [];
PIPELINE_TEMPLATES.forEach(t => t.stages.forEach(s => {
  if (!s.key || !s.name || !s.task || !s.prompt || !s.artifact) badStage.push(`${t.id}/${s.key}`);
  if (!s.inBase || !s.outBase) badStage.push(`${t.id}/${s.key} 缺预算`);
}));
check(badStage.length === 0, '每个阶段都有 key/name/task/prompt/artifact/预算', badStage.join(', '));

/* 阶段引用的 task 必须在平台数据里真实存在，否则永远分配不到平台 */
const allTags = new Set(PLATFORMS.flatMap(p => p.tags || []));
const orphan = [];
PIPELINE_TEMPLATES.forEach(t => t.stages.forEach(s => {
  if (!PLATFORMS.some(p => (p.tags || []).includes(s.task))) orphan.push(`${s.key}:${s.task}`);
  if (!allTags.has(s.task)) orphan.push(`${s.key}:${s.task}(无标签)`);
}));
check(orphan.length === 0, '所有阶段的 task 标签都能在平台库里匹配到平台', orphan.join(', '));

console.log('\n=== 2. 资源约束（全部模板 × 规模 × 模式）===');
const combos = [];
for (const t of PIPELINE_TEMPLATES) for (const s of Object.keys(SCALES)) for (const m of ['script', 'manual']) {
  combos.push({ t: t.id, s, m, p: plan(t.id, s, m) });
}

check(combos.every(c => !c.p.infeasible), '所有组合都能排完，无「阶段放不下」',
  combos.filter(c => c.p.infeasible).map(c => `${c.t}/${c.s}/${c.m}`).join(', '));

check(combos.every(c => c.p.stages.every(s => s.assign)), '每个阶段都拿到了平台',
  combos.filter(c => c.p.stages.some(s => !s.assign)).map(c => `${c.t}/${c.s}/${c.m}`).join(', '));

/* 同日同平台累计不得超过其当日容量 */
let over = [];
combos.forEach(c => {
  const byDay = {};
  c.p.stages.forEach(st => {
    if (!st.assign) return;
    const k = st.assign.id + '@' + st.day;
    byDay[k] = (byDay[k] || 0) + st.total;
  });
  Object.entries(byDay).forEach(([k, v]) => {
    const [pid] = k.split('@');
    const p = PLATFORMS.find(x => x.id === pid);
    if (['gift', 'trial'].includes(p.quotaType)) return;      // 一次性额度按总量另测
    const st = c.p.stages.find(s => s.assign && s.assign.id === pid);
    const cap = dailyCapacity(p, st.inTok, st.outTok).cap;
    if (v > cap) over.push(`${c.t}/${c.s}/${c.m} ${k}: ${v} > ${cap}`);
  });
});
check(over.length === 0, '同一平台同一天的累计占用不超过其当日容量', over.slice(0, 3).join(' | '));

/* 一次性礼包：只能被当成一个资金池用一次，不能重复计入 */
let giftBad = [];
combos.forEach(c => {
  const seen = {};
  c.p.stages.forEach(st => {
    if (!st.assign) return;
    const p = PLATFORMS.find(x => x.id === st.assign.id);
    if (!['gift', 'trial'].includes(p.quotaType)) return;
    seen[st.assign.id] = (seen[st.assign.id] || 0) + st.total;
    if (seen[st.assign.id] > (p.tokensTotal || 0)) giftBad.push(`${c.t}/${c.s} ${p.id} 超额`);
  });
});
check(giftBad.length === 0, '一次性礼包不会被重复消耗', giftBad.slice(0, 3).join(' | '));

console.log('\n=== 3. 可再生的优先，一次性的靠后 ===');
const small = plan('research-report', 'small', 'script');
const giftStages = small.stages.filter(s => s.assign && ['gift', 'trial'].includes(s.assign.quotaType));
check(small.stages.indexOf(giftStages[0] || {}) === -1 || giftStages.length === 0 || true,
  `小规模投研：${giftStages.length} 个阶段动用了一次性额度（日额度够用时应为 0）`);
check(giftStages.length === 0, '小规模能用日额度跑完，没有提前烧掉一次性礼包');

console.log('\n=== 4. 脚本模式不得把需要联网的阶段交给 API ===');
const literature = plan('literature', 'small', 'script');
const webStage = literature.stages.find(s => s.webOnly);
check(!!webStage, '长文综述含联网检索阶段');
check(webStage && webStage.manual === true, '脚本模式下联网阶段被标记为「需人工」');
check(webStage && webStage.assign && ['research', 'chat'].includes(PLATFORMS.find(p => p.id === webStage.assign.id).cat),
  `联网阶段被分到网页类平台（实际：${webStage && webStage.assign && webStage.assign.name}）`);

/* 反过来：手动模式下不该出现「需人工」，因为全部能在网页做 */
const manualPlan = plan('literature', 'small', 'manual');
check(manualPlan.stages.every(s => !s.manual), '手动模式下没有阶段被标为需人工（全部可网页完成）');

console.log('\n=== 5. 预算与汇总守恒 ===');
let sumBad = [];
combos.forEach(c => {
  const sum = c.p.stages.reduce((a, s) => a + s.total, 0);
  if (sum !== c.p.totalTokens) sumBad.push(`${c.t}/${c.s}/${c.m}`);
  c.p.stages.forEach(s => {
    if (s.inTok + s.outTok !== s.total) sumBad.push(`${c.t}/${s.key} 相加不符`);
    if (s.total <= 0 || !Number.isFinite(s.total)) sumBad.push(`${c.t}/${s.key} 预算非法`);
  });
});
check(sumBad.length === 0, '总消耗 = 各阶段之和，且每阶段 input+output 自洽', sumBad.slice(0, 3).join(' | '));

const expectCard = small.stages.filter(s => s.cardIn > 0).length * CARD_TOK;
check(small.cardTotal === expectCard, `交接卡合计 = 有上游的阶段数 × ${CARD_TOK}（${small.cardTotal}）`);
check(small.stages[0].cardIn === 0, '第一阶段不计上游交接卡的输入成本');
check(small.stages.slice(1).every(s => s.cardIn === CARD_TOK), '后续每阶段都预留一份交接卡输入');
check(small.cardTotal / small.totalTokens < 0.15,
  `交接卡占总消耗 ${(small.cardTotal / small.totalTokens * 100).toFixed(1)}%（应 < 15%，否则压缩没生效）`);

console.log('\n=== 6. 排期单调 & 天数合理 ===');
let dayBad = [];
combos.forEach(c => {
  let prev = 1;
  c.p.stages.forEach(s => {
    if (s.day < prev) dayBad.push(`${c.t}/${s.key} 回到了第 ${s.day} 天`);
    prev = s.day;
  });
  if (c.p.days < 1) dayBad.push(`${c.t} days=${c.p.days}`);
});
check(dayBad.length === 0, '阶段排期只向前推进，不会回到过去的日子', dayBad.slice(0, 3).join(' | '));
check(small.days >= 1 && small.days <= 3, `小规模投研需 ${small.days} 天（1~3 天属正常）`);

console.log('\n=== 7. 规模放大后成本与消耗同步放大 ===');
const s1 = plan('software', 'small', 'script');
const s3 = plan('software', 'large', 'script');
check(s3.totalTokens > s1.totalTokens * 3, `大规模(${s3.totalTokens}) 明显大于小规模(${s1.totalTokens})`);
check(Math.abs(s3.cost - (s3.totalTokens / 1e6) * 2) < 1e-9, '付费对照成本与总消耗一致');

console.log('\n=== 8. 端点表覆盖 ===');
const usedIds = new Set();
combos.forEach(c => c.p.stages.forEach(s => {
  if (s.assign) usedIds.add(s.assign.id);
  if (s.fallback) usedIds.add(s.fallback.id);
}));
const noBase = [...usedIds].filter(id => {
  const p = PLATFORMS.find(x => x.id === id);
  return p && p.cat === 'api' && !PIPE_BASE[id];
});
check(noBase.length === 0, '所有被分配到、且属于 API 类的平台都有 base_url（导出脚本要用）', noBase.join(', '));

console.log('\n=== 9. 抽样：投研小规模的分配结果 ===');
small.stages.forEach((s, i) => {
  console.log(`  ${i + 1}. ${s.name} → ${s.assign ? s.assign.name : '无'}  D${s.day}  ${s.total} tok` +
    (s.fallback ? `  [备选 ${s.fallback.name}]` : ''));
});

console.log(`\n${fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗'}`);
process.exit(fail === 0 ? 0 : 1);
