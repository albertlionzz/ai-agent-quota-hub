/* 总控调度舱回归测试。跑法：node test-orch.js */
const fs = require('fs');
const path = require('path');
const A = p => path.join(__dirname, 'assets', p);

function mkSandbox() {
  const ctx = {};
  new Function('exports',
    fs.readFileSync(A('data.js'), 'utf8') +
    '\n;Object.assign(exports,{PLATFORMS,QUOTA_TYPES,TASK_TAGS,DATA_DATE,SELFHOST_DAILY_EST});'
  )(ctx);
  return ctx;
}

const D = mkSandbox();
const { PLATFORMS, QUOTA_TYPES, TASK_TAGS, SELFHOST_DAILY_EST, DATA_DATE } = D;

const SH = SELFHOST_DAILY_EST;
function dailyCapacity(p, inTok, outTok) {
  const perReq = Math.max(1, inTok + outTok);
  if (p.quotaType === 'selfhost') return { cap: SH, maxReq: Infinity };
  const mr = p.reqPerDay || Infinity;
  const br = mr === Infinity ? Infinity : mr * perReq;
  let bt = Infinity;
  if (p.freeTokensPerDay) bt = p.freeTokensPerDay;
  if (p.tokensTotal) {
    const d = p.expiresAt
      ? Math.max(1, Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000)) : 60;
    bt = Math.min(bt, Math.round(p.tokensTotal / d));
  }
  if (bt === Infinity && br === Infinity) return { cap: 0, maxReq: mr };
  return { cap: Math.min(br, bt), maxReq: mr };
}

/* 加载 capability + pipeline + orchestrator，注入依赖 */
const capSrc = fs.readFileSync(A('capability.js'), 'utf8');
const pipeSrc = fs.readFileSync(A('pipeline.js'), 'utf8');
const orchSrc = fs.readFileSync(A('orchestrator.js'), 'utf8')
  .replace(/\$\('#orch-brief'\)/g, "dollar('#orch-brief')");

const store = {};
const localStorageMock = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};

const box = {};
new Function(
  'exports',
  'PLATFORMS', 'QUOTA_TYPES', 'TASK_TAGS', 'DATA_DATE',
  'dailyCapacity', 'fmt', 'esc', 'pipeScriptable',
  'dollar', 'VIEWS', 'localStorage', 'downloadFile', 'copyText',
  'renderAccess',   /* orchestrator.js 末尾注册 VIEWS.access 时会引用 */
  capSrc + '\n' + pipeSrc + '\n' + orchSrc +
  '\n;Object.assign(exports,{MODELS,ROLES,TASK_NEED,capFit,avgScore,modelsOnPlatform,CAP_DIMS,CAP_KEYS,SRC_TRUST,' +
  'planOrchestration,pickForRole,pickForTask,platformForModel,CONSISTENCY_CHECKS,' +
  'STATE_CARD_SPEC,RECEIPT_SPEC,PLAYBOOK_KINDS,DEFAULT_PLAYBOOK,loadPlaybook,pbMatch,' +
  'buildChiefSystem,buildWorkerPrompt,buildReviewerPrompt,buildOrchMd,buildChiefMd,SCALES,CARD_TOK,PIPELINE_TEMPLATES,PAID_REF});'
)(
  box,
  PLATFORMS, QUOTA_TYPES, TASK_TAGS, DATA_DATE,
  dailyCapacity, String, x => String(x == null ? '' : x),
  p => p.cat === 'api',
  () => ({ value: '研究对象示例：某上市公司。核心问题：某技术路线能否按期兑现为利润。' }),
  {}, localStorageMock, () => {}, () => {},
  () => {}          // renderAccess stub：orchestrator.js 注册 VIEWS.access 时会引用它
);

const O = box;
let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('\n=== 1. 能力画像数据完整性 ===');
check(O.MODELS.length >= 10, `模型画像 ${O.MODELS.length} 条`);
check(O.CAP_KEYS.length === 9, '九个能力维度');
const noEvid = O.MODELS.filter(m => !m.evid || !m.evid.length);
check(noEvid.length === 0, '每个模型都有评测依据（无凭空打分）');
const badDim = [];
O.MODELS.forEach(m => m.evid.forEach(e => {
  if (!O.CAP_DIMS[e.dim]) badDim.push(`${m.id}:${e.dim}`);
  if (!O.SRC_TRUST[e.src]) badDim.push(`${m.id}:${e.src}`);
}));
check(badDim.length === 0, `所有 evid 的 dim/src 都合法${badDim.length ? ' → ' + badDim.join(',') : ''}`);
const badScore = O.MODELS.filter(m => O.CAP_KEYS.some(k => typeof m.score[k] !== 'number'));
check(badScore.length === 0, '每个模型的九个维度都有数值');
const badVia = [];
O.MODELS.forEach(m => m.freeVia.forEach(pid => {
  if (!PLATFORMS.find(p => p.id === pid)) badVia.push(`${m.id}→${pid}`);
}));
check(badVia.length === 0, `freeVia 都指向真实平台${badVia.length ? ' → ' + badVia.join(',') : ''}`);

console.log('\n=== 2. 来源分级：高可信来源应占多数 ===');
let evTotal = 0, evHigh = 0;
O.MODELS.forEach(m => m.evid.forEach(e => {
  evTotal++;
  if (O.SRC_TRUST[e.src].trust === 'high') evHigh++;
}));
check(evHigh / evTotal >= 0.6, `高可信依据占比 ${Math.round(evHigh / evTotal * 100)}%（${evHigh}/${evTotal}），推断类不得主导`);

console.log('\n=== 3. 角色选模型 ===');
const chief = O.pickForRole('chief', 'script', [], 4000);
check(!!chief, `Chief 选出 ${chief ? chief.m.name : '无'}`);
check(chief && chief.fit >= O.ROLES.chief.minScore, `Chief 匹配度 ${chief ? chief.fit.toFixed(1) : '—'} ≥ 门槛 ${O.ROLES.chief.minScore}`);
check(chief && chief.m.freeVia.length > 0, 'Chief 必须有免费额度入口，否则整个方案不成立');
const rev = O.pickForRole('reviewer', 'script', [chief.m.id], 3000);
check(rev && rev.m.id !== chief.m.id, `审查者 ${rev ? rev.m.name : '—'} 与总控不同模型`);
const syn = O.pickForRole('synthesizer', 'script', [], 8000);
check(!!syn && syn.fit >= O.ROLES.synthesizer.minScore, `汇总 ${syn ? syn.m.name : '—'} 匹配 ${syn ? syn.fit.toFixed(1) : '—'}`);

console.log('\n=== 4. 编排计划：异模型审查（核心不变量） ===');
for (const tpl of O.PIPELINE_TEMPLATES) {
  for (const mode of ['script', 'manual']) {
    const plan = O.planOrchestration(tpl.id, 'small', mode);
    const selfAudit = plan.stages.filter(s => s.worker && s.reviewer && s.worker.modelId === s.reviewer.modelId);
    check(selfAudit.length === 0,
      `${tpl.name}/${mode}：无自审（${plan.stages.length} 任务）${selfAudit.length ? ' → ' + selfAudit.map(s => s.name).join(',') : ''}`);
  }
}

console.log('\n=== 5. 编排计划：额度约束 ===');
for (const tpl of O.PIPELINE_TEMPLATES) {
  for (const scale of ['small', 'mid', 'large']) {
    for (const mode of ['script', 'manual']) {
      const plan = O.planOrchestration(tpl.id, scale, mode);
      const noWorker = plan.stages.filter(s => !s.worker);
      check(noWorker.length === 0,
        `${tpl.name}/${scale}/${mode}：全部任务都有执行者${noWorker.length ? ' → ' + noWorker.map(s => s.name).join(',') : ''}`);

      /* 同一天同一平台，可再生额度不得超额 */
      const byDay = {};
      plan.stages.forEach(s => {
        if (!s.worker) return;
        const k = s.day + '|' + s.worker.platformId;
        byDay[k] = (byDay[k] || 0) + s.total;
      });
      let over = null;
      for (const [k, used] of Object.entries(byDay)) {
        const [d, pid] = k.split('|');
        const p = PLATFORMS.find(x => x.id === pid);
        const oneShot = ['gift', 'trial'].includes(p.quotaType);
        if (oneShot) continue;
        const cap = dailyCapacity(p, 2000, 1500).cap;
        if (used > cap) over = `${p.name} D${d} 用 ${used} > ${cap}`;
      }
      check(!over, `${tpl.name}/${scale}/${mode}：同日同平台不超额${over ? ' → ' + over : ''}`);
    }
  }
}

console.log('\n=== 6. 一致性检查规则 ===');
check(O.CONSISTENCY_CHECKS.length === 5, '五类冲突');
check(O.CONSISTENCY_CHECKS.filter(c => c.auto).length >= 3, '至少三类可脚本自动判定');
check(O.CONSISTENCY_CHECKS.every(c => c.detect && c.method && c.action), '每类都写了判定方法与处置动作');
check(/GOAL/.test(O.STATE_CARD_SPEC) && /LOCKED/.test(O.STATE_CARD_SPEC), '状态卡含 GOAL 与 LOCKED');
check(/冲突/.test(O.RECEIPT_SPEC), '回执卡要求主动上报与上游的冲突');

console.log('\n=== 7. 经验库 ===');
const pb = O.loadPlaybook();
check(pb.length >= 6, `经验条目 ${pb.length} 条`);
check(Object.keys(O.PLAYBOOK_KINDS).length === 3, '三层：流程 / 机制 / 技术');
check(pb.every(p => ['flow', 'mech', 'tech'].includes(p.kind)), '每条经验都归属三层之一');
const hits = O.pbMatch(pb, ['投研报告', '证据检索', 'research']);
check(hits.length > 0, `相似度命中 ${hits.length} 条`);
const plan0 = O.planOrchestration('research-report', 'small', 'script');
check(plan0.pbHits.length > 0, `编排计划自动带入 ${plan0.pbHits.length} 条经验`);

console.log('\n=== 8. 导出内容 ===');
const md = O.buildOrchMd(plan0);
check(md.length > 3000, `执行手册 ${md.length} 字符`);
['## 0. 总体目的', '## 1. 角色分配', '## 2. 循环机制', '## 3. 项目状态卡',
 '## 5. 一致性检查规则', '## 7. 终审核对'].forEach(h => {
  check(md.includes(h), `手册含章节 ${h}`);
});
const cm = O.buildChiefMd(plan0);
check(cm.includes('【总体目的】'), '总控提示词含总体目的');
check(cm.includes('【你的权限边界】'), '总控提示词含权限边界（防止它自己下场写正文）');
check(/终审|结束条件/.test(cm), '总控提示词含终审环节');
const wp = O.buildWorkerPrompt(plan0.stages[0], plan0);
check(!/上游交接/.test(wp), '首个任务不提上游交接（它没有上游）');
const wp2 = O.buildWorkerPrompt(plan0.stages[1], plan0);
check(/上游交接/.test(wp2), '后续任务带上游交接说明');
check(/验收标准/.test(wp2), '执行提示词含验收标准');

console.log('\n=== 9. 批次与循环 ===');
const planBig = O.planOrchestration('research-report', 'large', 'manual');
const perBatch = {};
planBig.stages.forEach(s => { perBatch[s.batch] = (perBatch[s.batch] || 0) + 1; });
check(Object.values(perBatch).every(n => n <= 3), `每批不超过 3 个任务（实际 ${JSON.stringify(perBatch)}）`);
check(planBig.loops === Math.max(...Object.keys(perBatch).map(Number)), '循环轮次 = 最大批次号');

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
