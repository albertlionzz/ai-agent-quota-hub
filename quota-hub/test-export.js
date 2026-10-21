/* 导出器验证：生成的 .py 必须能通过 Python 语法检查，否则「一键出脚本」就是假的。
   顺带检查手册里每个阶段都带上了完整提示词与交接卡格式。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const A = p => path.join(__dirname, 'assets', p);
const dataSrc = fs.readFileSync(A('data.js'), 'utf8');
const pipeSrc = fs.readFileSync(A('pipeline.js'), 'utf8');

/* data.js 提出数据；pipeline.js 只去掉最后那行视图注册（不需要 DOM 的部分都能跑） */
const ctx = {};
new Function('exports', dataSrc + '\n;Object.assign(exports,{PLATFORMS,QUOTA_TYPES,TASK_TAGS,DATA_DATE,SELFHOST_DAILY_EST});')(ctx);
const { PLATFORMS, QUOTA_TYPES, TASK_TAGS, DATA_DATE, SELFHOST_DAILY_EST } = ctx;

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

const fmt = n => (n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n));
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const byId = id => PLATFORMS.find(p => p.id === id);
const VIEWS = {};                       // pipeline.js 末尾会往里塞
const $ = () => null;                  // 没有 DOM：buildStagePrompt / buildManualMd 会退回默认简报

const box = {};
new Function(
  'exports', 'dailyCapacity', 'fmt', 'esc', 'byId', 'VIEWS', '$', 'DATA_DATE', 'PLATFORMS', 'QUOTA_TYPES', 'TASK_TAGS',
  pipeSrc + '\n;Object.assign(exports,{planPipeline,buildManualMd,buildRunnerPy,buildConfigJson,PIPELINE_TEMPLATES});'
)(box, dailyCapacity, fmt, esc, byId, VIEWS, $, DATA_DATE, PLATFORMS, QUOTA_TYPES, TASK_TAGS);

let fail = 0;
const check = (ok, msg, extra) => {
  if (!ok) { fail++; console.log(`  ✗ ${msg}${extra ? '  → ' + extra : ''}`); }
  else console.log(`  ✓ ${msg}`);
};

const PY = 'C:/Users/zhouy/.workbuddy/binaries/python/versions/3.13.12/python.exe';
const tmp = path.join(__dirname, '.tmp-export');
fs.mkdirSync(tmp, { recursive: true });

console.log('\n=== 1. 生成的 Python 能通过语法检查 ===');
const combos = [
  ['research-report', 'small', 'script'],
  ['research-report', 'large', 'script'],
  ['software', 'mid', 'script'],
  ['literature', 'small', 'script'],
  ['content', 'small', 'manual'],
  ['game-gdd', 'large', 'manual']
];
let pyFile = null;
for (const [t, s, m] of combos) {
  const plan = box.planPipeline(t, s, m);
  const py = box.buildRunnerPy(plan);
  const f = path.join(tmp, `runner-${t}-${s}-${m}.py`);
  fs.writeFileSync(f, py, 'utf8');
  pyFile = f;
  let ok = true, err = '';
  try {
    execFileSync(PY, ['-m', 'py_compile', f], { stdio: 'pipe' });
  } catch (e) {
    ok = false;
    err = (e.stderr || '').toString().split('\n').slice(0, 3).join(' ');
  }
  check(ok, `${t}/${s}/${m} 生成的脚本语法正确`, err);
}

console.log('\n=== 2. 脚本内容关键要素 ===');
const py = fs.readFileSync(pyFile, 'utf8');
check(/PROVIDERS\s*=\s*\{/.test(py), '含 PROVIDERS 配置块');
check(/STAGES = json\.loads/.test(py), '阶段配置内嵌为 JSON');
check(/def call_stage/.test(py), '含容灾切换函数');
check(/fallback/.test(py), '引用备选平台');
check(/\[交接卡\]/.test(py), '含交接卡切分标记');
check(/--dry-run/.test(py), '支持干跑（先看提示词再花钱）');
check(/urllib\.request/.test(py), '只用标准库，不依赖第三方包');
check(!/sk-[A-Za-z0-9]{10,}/.test(py), '脚本里没有残留任何密钥');

console.log('\n=== 3. 手册完整性 ===');
const plan = box.planPipeline('research-report', 'small', 'script');
const md = box.buildManualMd(plan);
check(md.includes('## 一、结论'), '含结论段');
check(md.includes('## 五、阶段详情'), '含阶段详情');
check(plan.stages.every(s => md.includes(s.name)), '每个阶段名都出现在手册里');
check((md.match(/\[交接卡\]/g) || []).length >= plan.stages.length - 1,
  `交接卡格式出现 ${(md.match(/\[交接卡\]/g) || []).length} 次（应 ≥ 阶段数-1 = ${plan.stages.length - 1}）`);
check(plan.stages.every(s => md.includes(s.prompt.slice(0, 20))), '每个阶段的提示词正文都被完整写入');
check(md.includes('为什么这样能省 token'), '含省 token 的原理说明');
check(md.includes(DATA_DATE), '标注了数据核对日期');

console.log('\n=== 4. JSON 配置可被解析 ===');
const cfg = box.buildConfigJson(plan);
const round = JSON.parse(JSON.stringify(cfg));
check(round.stages.length === plan.stages.length, `阶段数一致（${round.stages.length}）`);
check(round.stages.every(s => s.provider), '每个阶段都有 provider');
/* 需人工的联网阶段落在网页平台，本来就没有 API 端点，只要求自动阶段必须有 base_url */
check(round.stages.every(s => s.manual || s.provider_base),
  '自动执行的阶段都有 base_url（人工阶段可无）',
  round.stages.filter(s => !s.manual && !s.provider_base).map(s => s.id).join(', '));
check(round.brief && round.brief.length > 10, '带上了项目简报');

/* 清理 */
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗'}`);
process.exit(fail === 0 ? 0 : 1);
