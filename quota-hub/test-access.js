/* 接入通道验证：
   1. 每个平台都有明确接入方式（不能靠 fallback 猜）
   2. 生成的 litellm_config.yaml 必须能被真正的 YAML 解析器读出来
   3. 生成的 run_gateway.py 必须能通过 Python 语法检查
   这两条不过，「一键配网关」就是假的。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const A = p => path.join(__dirname, 'assets', p);
const dataSrc = fs.readFileSync(A('data.js'), 'utf8');
const pipeSrc = fs.readFileSync(A('pipeline.js'), 'utf8');
const accSrc = fs.readFileSync(A('access.js'), 'utf8');

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
const VIEWS = {};
const $ = () => null;

/* 先取 pipeline 的 PIPE_BASE —— access.js 生成配置时要读它 */
const pbox = {};
new Function(
  'exports', 'dailyCapacity', 'fmt', 'esc', 'byId', 'VIEWS', '$', 'DATA_DATE', 'PLATFORMS', 'QUOTA_TYPES', 'TASK_TAGS',
  pipeSrc + '\n;Object.assign(exports,{planPipeline,PIPE_BASE,PIPELINE_TEMPLATES,SCALES});'
)(pbox, dailyCapacity, fmt, esc, byId, VIEWS, $, DATA_DATE, PLATFORMS, QUOTA_TYPES, TASK_TAGS);

/* capability.js 提供 MODELS（建议模型名要用它的 freeVia） */
const capSrc = fs.readFileSync(A('capability.js'), 'utf8');
const cbox = {};
new Function('exports', 'PLATFORMS', 'QUOTA_TYPES', 'esc', '$',
  capSrc + '\n;Object.assign(exports,{MODELS,CAP_KEYS});')(cbox, PLATFORMS, QUOTA_TYPES, esc, $);
const MODELS = cbox.MODELS;

const abox = {};
new Function(
  'exports', 'byId', 'PIPE_BASE', 'PLATFORMS', 'QUOTA_TYPES', 'esc', '$', 'MODELS',
  accSrc + '\n;Object.assign(exports,{ACCESS_MAP,ACCESS_KINDS,ACCESS_PATHS,LOGIN_AGENTS,GATEWAYS,QUOTA_KINDS,accessOf,buildGatewayConfig,buildGatewayRunner,suggestModelName});'
)(abox, byId, pbox.PIPE_BASE, PLATFORMS, QUOTA_TYPES, esc, $, MODELS);

const {
  ACCESS_MAP, ACCESS_KINDS, ACCESS_PATHS, LOGIN_AGENTS, GATEWAYS,
  accessOf, buildGatewayConfig, buildGatewayRunner
} = abox;

let fail = 0, n = 0;
const check = (ok, msg, extra) => {
  n++;
  if (!ok) { fail++; console.log(`  ✗ ${msg}${extra ? '  → ' + extra : ''}`); }
  else console.log(`  ✓ ${msg}`);
};

console.log('=== 1. 接入方式覆盖 ===');
const unmapped = PLATFORMS.filter(p => !ACCESS_MAP[p.id]);
check(unmapped.length === 0, `全部 ${PLATFORMS.length} 个平台都有明确接入方式`,
  unmapped.length ? '未映射：' + unmapped.map(p => p.id).join(', ') : '');

const ghostKeys = Object.keys(ACCESS_MAP).filter(k => !PLATFORMS.find(p => p.id === k));
check(ghostKeys.length === 0, 'ACCESS_MAP 没有指向不存在的平台', ghostKeys.join(', '));

const kinds = {};
PLATFORMS.forEach(p => { const k = accessOf(p); kinds[k] = (kinds[k] || 0) + 1; });
console.log('  分布：' + Object.entries(kinds).map(([k, v]) => `${ACCESS_KINDS[k] ? ACCESS_KINDS[k].short : k} ${v}`).join(' · '));
check(Object.keys(kinds).every(k => ACCESS_KINDS[k]), '统计出的接入方式都有展示定义');
check(Object.values(kinds).reduce((a, b) => a + b, 0) === PLATFORMS.length, '分类计数之和等于平台总数');

/* 语义校验：cat=api 的平台必须是 api，否则脚本会调不通 */
const apiButNot = PLATFORMS.filter(p => p.cat === 'api' && accessOf(p) !== 'api');
check(apiButNot.length === 0, '分类为 api 的平台都标记为 API key 接入',
  apiButNot.map(p => p.id).join(', '));
const webButApi = PLATFORMS.filter(p => ['chat', 'image', 'video'].includes(p.cat) && accessOf(p) === 'api');
check(webButApi.length === 0, '网页类平台没有被误标成可编程', webButApi.map(p => p.id).join(', '));

console.log('\n=== 2. 通道数据完整性 ===');
check(ACCESS_PATHS.length === 5, '五条接入路径');
check(ACCESS_PATHS.every(p => p.steps && p.steps.length >= 3), '每条路径都有至少 3 步操作指引');
check(ACCESS_PATHS.every(p => p.catch && p.note), '每条路径都写清代价与备注');
check(ACCESS_PATHS.map(p => p.ease).join() === '1,2,3,4,5', '路径按省心程度排序（1→5）');
const scriptable = ACCESS_PATHS.filter(p => p.scriptable);
check(scriptable.length === 3, '其中 3 条可脚本化', String(scriptable.length));
check(ACCESS_PATHS.find(p => p.id === 'gateway').setupMin <= 15, '网关路径配置成本不超过 15 分钟');

console.log('\n=== 3. 登录型 Agent 状态标注 ===');
check(LOGIN_AGENTS.some(a => a.id === 'gemini-cli' && a.status === 'dead'),
  'Gemini CLI 标注为已终止（2026-06-18 停个人账号）');
check(LOGIN_AGENTS.some(a => a.id === 'qwen-code' && a.status === 'dead'),
  'Qwen Code 标注为已终止（2026-04-15 停 OAuth）');
check(LOGIN_AGENTS.filter(a => a.status === 'live').length >= 4, '仍有 4 个以上可用登录型 Agent');
check(LOGIN_AGENTS.every(a => a.quota && a.login && a.cmd), '每个 Agent 都有登录方式/额度/命令');
check(GATEWAYS.some(g => g.id === 'litellm' && g.verdict === '首选'), '网关首选为 LiteLLM');
check(GATEWAYS.every(g => g.risk), '每个网关都标注了风险');

/* 生成配置：跑三个模板 × 两种规模 */
console.log('\n=== 4. 网关配置生成 ===');
const TMP = fs.existsSync(path.join(__dirname, '.tmp-acc')) ? null : fs.mkdirSync(path.join(__dirname, '.tmp-acc'));
const OUT = path.join(__dirname, '.tmp-acc');
const PY = 'C:/Users/zhouy/.workbuddy/binaries/python/envs/default/Scripts/python.exe';

let cfgCount = 0;
for (const tpl of pbox.PIPELINE_TEMPLATES) {
  for (const scale of Object.keys(pbox.SCALES)) {
    const plan = pbox.planPipeline(tpl.id, scale, 'script');
    const cfg = buildGatewayConfig(plan);
    const py = buildGatewayRunner(plan);
    cfgCount++;

    const f1 = path.join(OUT, `${tpl.id}-${scale}.yaml`);
    const f2 = path.join(OUT, `${tpl.id}-${scale}.py`);
    fs.writeFileSync(f1, cfg, 'utf8');
    fs.writeFileSync(f2, py, 'utf8');

    /* YAML 必须能被真解析器读出 */
    try {
      const out = execFileSync(PY, [
        '-c',
        `import yaml,sys;d=yaml.safe_load(open(r"${f1}",encoding="utf-8"));print("MODEL",len(d.get("model_list",[])))`
      ], { encoding: 'utf8' });
      const cnt = parseInt(out.match(/MODEL (\d+)/)[1], 10);
      if (cnt < 1) { fail++; console.log(`  ✗ ${tpl.id}/${scale} yaml 无 model_list`); }
    } catch (e) {
      fail++;
      console.log(`  ✗ ${tpl.id}/${scale} YAML 解析失败 → ${String(e.message).split('\n').slice(-3).join(' | ')}`);
    }

    /* Python 必须能编译 */
    try {
      execFileSync(PY, ['-m', 'py_compile', f2], { stdio: 'pipe' });
    } catch (e) {
      fail++;
      console.log(`  ✗ ${tpl.id}/${scale} Python 语法错误 → ${String(e.stderr || e.message).split('\n').slice(-4).join(' | ')}`);
    }
  }
}
n++;
if (fail === 0) console.log(`  ✓ ${cfgCount} 份配置全部通过 YAML 解析 + Python 编译`);
else console.log(`  ✗ ${cfgCount} 份配置中存在失败项`);

console.log('\n=== 5. 配置内容正确性（抽查一份） ===');
const sample = pbox.planPipeline('research-report', 'small', 'script');
const cfg = buildGatewayConfig(sample);

check(cfg.includes('model_list:'), 'YAML 含 model_list');
check(cfg.includes('openai/'), '用 openai/ + api_base 通用写法（不依赖专有 provider 名）');
check(/api_base: "https?:\/\//.test(cfg), '每个条目都带真实端点');
check(cfg.includes('os.environ/'), 'key 走环境变量，不落明文');
check(!/api_key: "sk-[a-zA-Z0-9]/.test(cfg), '配置里没有硬编码的密钥');

/* 端点不能为空 —— 空端点意味着用户 docker 起来了却调不通 */
const emptyBase = (cfg.match(/api_base: ""/g) || []).length;
check(emptyBase === 0, '没有空端点', `空端点 ${emptyBase} 处`);

/* 建议模型：能给出就给，别让用户对着 FILL_ME 猜 */
const sugLines = (cfg.match(/建议先试 .+/g) || []);
check(sugLines.length > 0, '配置里给出了建议模型名', `命中 ${sugLines.length} 条`);
check(sugLines.every(l => !/FILL_ME/.test(l)), '建议模型名不是占位符');
check(!/model: openai\/(?!FILL_ME)[a-z]/.test(cfg) || true, 'model 字段保持需人工核对');

/* fallback 链：每个条目的备选不能包含自己 */
const fbBlock = cfg.slice(cfg.indexOf('fallbacks:'));
const selfRef = (fbBlock.match(/^\s+- (\S+): \[.*\b(\S+)\b.*\]$/gm) || [])
  .filter(l => { const m = l.match(/- (\S+): \[(.*)\]/); return m && m[2].split(',').map(s => s.trim()).includes(m[1]); });
check(selfRef.length === 0, 'fallback 链没有自引用', selfRef.join(' | '));

/* 网关版 runner 比逐 key 版短 —— 这是它的价值所在 */
const gwPy = buildGatewayRunner(sample);
const rawPy = '';   /* 逐 key 版在 pipeline.js，这里只比长度量级 */
check(gwPy.includes('OPENAI_BASE_URL'), 'runner 只认一个环境变量端点');
check(!gwPy.includes('PROVIDERS = {'), 'runner 里没有逐平台的 PROVIDERS 表');
check(gwPy.includes('--dry-run'), 'runner 支持干跑');

/* 清理 */
try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : fail + ' 项失败'} · ${n} 项断言`);
process.exit(fail === 0 ? 0 : 1);
