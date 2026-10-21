/* 接入核验验证：
   1. 接入总表结构完整、id 唯一、端点格式合法
   2. 生成的 verify_all.py 必须能通过 Python 语法检查（且能被 import 级编译）
   3. 生成的 .env 模板必须覆盖表里每一家
   4. 与 PLATFORMS / PIPE_BASE 的交叉引用不能断
   这一页的价值全在「能不能真的跑起来」，所以脚本可编译是硬门槛。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const A = p => path.join(__dirname, 'assets', p);

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

/* ---------- 载入被测模块 ---------- */
const dataSrc = fs.readFileSync(A('data.js'), 'utf8');
const pipeSrc = fs.readFileSync(A('pipeline.js'), 'utf8');
const verifySrc = fs.readFileSync(A('verify.js'), 'utf8');

const ctx = {};
new Function('exports', dataSrc + '\n;Object.assign(exports,{PLATFORMS,QUOTA_TYPES,DATA_DATE});')(ctx);
const { PLATFORMS, QUOTA_TYPES, DATA_DATE } = ctx;

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = n => (n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n));
const byId = id => PLATFORMS.find(p => p.id === id);
const VIEWS = {};
const $ = () => null;
const $$ = () => [];
const downloadFile = () => {};

const pbox = {};
new Function('exports', 'dailyCapacity', 'fmt', 'esc', 'byId', 'VIEWS', '$', 'DATA_DATE', 'PLATFORMS', 'QUOTA_TYPES',
  pipeSrc + '\n;Object.assign(exports,{PIPE_BASE});'
)(pbox, () => ({ cap: 0 }), fmt, esc, byId, VIEWS, $, DATA_DATE, PLATFORMS, QUOTA_TYPES);
const PIPE_BASE = pbox.PIPE_BASE;

const vbox = {};
new Function('exports', 'esc', '$', '$$', 'downloadFile', 'VIEWS', 'DATA_DATE', 'PLATFORMS', 'PIPE_BASE',
  verifySrc + '\n;Object.assign(exports,{VENDOR_ACCESS,FREE_STATE,VERIFY_TIER,buildVerifyScript,buildEnvTemplate,buildVerifyMd});'
)(vbox, esc, $, $$, downloadFile, VIEWS, DATA_DATE, PLATFORMS, PIPE_BASE);
const { VENDOR_ACCESS, FREE_STATE, buildVerifyScript, buildEnvTemplate, buildVerifyMd } = vbox;

console.log('\n接入核验 · 共 ' + VENDOR_ACCESS.length + ' 家\n');

/* ============================================================
   1. 数据完整性
   ============================================================ */
console.log('[1] 数据完整性');

T('每家都有 id / name / vendor / tier', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(v.id, '缺 id');
    assert(v.name, '缺 name');
    assert(v.vendor, v.id + ' 缺 vendor');
    assert([1, 2, 3].includes(v.tier), v.id + ' tier 非法：' + v.tier);
  });
});

T('id 唯一', () => {
  const seen = {};
  VENDOR_ACCESS.forEach(v => {
    assert(!seen[v.id], 'id 重复：' + v.id);
    seen[v.id] = 1;
  });
});

T('环境变量名唯一（.env 不能有重名键）', () => {
  const seen = {};
  VENDOR_ACCESS.forEach(v => {
    assert(!seen[v.env], 'env 重复：' + v.env + '（' + v.id + '）');
    seen[v.env] = 1;
  });
});

T('free 状态值合法', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(FREE_STATE[v.free], v.id + ' free 状态非法：' + v.free);
  });
});

T('免费状态与文案自洽（disputed 必须给出冲突说明）', () => {
  VENDOR_ACCESS.forEach(v => {
    if (v.free === 'disputed') assert(v.conflict, v.id + ' 标了 disputed 但没有 conflict 说明');
    assert(v.freeText && v.freeText.length > 10, v.id + ' freeText 过短');
  });
});

T('每家都有官方出处与核实日期', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(/^https?:\/\//.test(v.src), v.id + ' src 不是合法 URL：' + v.src);
    assert(v.srcName, v.id + ' 缺 srcName');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(v.verifyDate), v.id + ' verifyDate 格式错：' + v.verifyDate);
  });
});

T('控制台地址合法', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(/^(https?:\/\/|（)/.test(v.console), v.id + ' console 地址不合法：' + v.console);
  });
});

/* ============================================================
   2. 端点格式（这是最容易出错、代价最高的部分）
   ============================================================ */
console.log('\n[2] 端点格式');

T('base_url 一律 https 且不以斜杠结尾', () => {
  VENDOR_ACCESS.forEach(v => {
    if (!v.base) return;
    assert(v.base.startsWith('https://'), v.id + ' base 不是 https：' + v.base);
    assert(!v.base.endsWith('/'), v.id + ' base 以斜杠结尾，拼接会出 //：' + v.base);
    assert(!/\s/.test(v.base), v.id + ' base 含空白字符：' + v.base);
  });
});

T('base_url 不含路径尾部的具体接口名', () => {
  VENDOR_ACCESS.forEach(v => {
    if (!v.base) return;
    assert(!/chat\/completions|messages$/.test(v.base),
      v.id + ' base_url 不该包含具体接口名：' + v.base);
  });
});

T('alt 端点同样格式合法', () => {
  VENDOR_ACCESS.forEach(v => {
    (v.alt || []).forEach(a => {
      assert(a.url.startsWith('https://'), v.id + ' alt 不是 https：' + a.url);
      assert(a.note, v.id + ' alt 缺说明：' + a.url);
    });
  });
});

T('至少覆盖各家一线主流厂商', () => {
  const must = ['openai', 'anthropic', 'gemini', 'deepseek', 'bailian', 'volc', 'moonshot', 'zhipu', 'minimax', 'xai'];
  const ids = VENDOR_ACCESS.map(v => v.id);
  const missing = must.filter(m => !ids.includes(m));
  assert(missing.length === 0, '缺一线厂商：' + missing.join(', '));
});

T('每家都有 retired 字段且一线厂商必须写清退役 id', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(Array.isArray(v.retired), v.id + ' retired 不是数组');
  });
  const t1noRetired = VENDOR_ACCESS.filter(v => v.tier === 1 && !v.retired.length);
  assert(t1noRetired.length === 0,
    '一线厂商底蕴-D 未标注退役 id：' + t1noRetired.map(v => v.id).join(', '));
});

T('probe 取值合法', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(['models', 'chat', 'anthropic'].includes(v.probe), v.id + ' probe 非法：' + v.probe);
  });
});

/* ============================================================
   3. 与既有数据的交叉引用
   ============================================================ */
console.log('\n[3] 交叉引用');

T('核验表里每家都能在 PLATFORMS 或 PIPE_BASE 里找到落点', () => {
  const platIds = PLATFORMS.map(p => p.id);
  const pipeIds = Object.keys(PIPE_BASE);
  const orphans = VENDOR_ACCESS.filter(v => !platIds.includes(v.id) && !pipeIds.includes(v.id));
  // 允许 llama 这种「无官方 API」的条目没有落点
  const bad = orphans.filter(v => v.id !== 'llama');
  assert(bad.length === 0, '孤立条目（平台库与端点表都找不到）：' + bad.map(v => v.id).join(', '));
});

T('有 base 的厂商，端点表 PIPE_BASE 里的写法必须与核验表一致', () => {
  const diffs = [];
  VENDOR_ACCESS.forEach(v => {
    if (!v.base) return;
    if (!PIPE_BASE[v.id]) return;          // 平台库里有但端点表还没收的，不算错
    if (PIPE_BASE[v.id] !== v.base) diffs.push(v.id + '：核验表 ' + v.base + ' vs 端点表 ' + PIPE_BASE[v.id]);
  });
  assert(diffs.length === 0, '端点不一致：\n       ' + diffs.join('\n       '));
});

T('新增的四家已进 PLATFORMS 与 PIPE_BASE', () => {
  ['moonshot', 'minimax', 'spark', 'xai'].forEach(id => {
    assert(PLATFORMS.find(p => p.id === id), 'PLATFORMS 缺 ' + id);
    assert(PIPE_BASE[id], 'PIPE_BASE 缺 ' + id);
  });
});

T('PLATFORMS 里 quotaType 全部有定义（防止补丁引入未定义枚举）', () => {
  PLATFORMS.forEach(p => {
    assert(QUOTA_TYPES[p.quotaType], p.id + ' quotaType 未定义：' + p.quotaType);
  });
});

/* ============================================================
   4. 导出产物
   ============================================================ */
console.log('\n[4] 导出产物');

const script = buildVerifyScript();
const env = buildEnvTemplate();
const md = buildVerifyMd();

T('verify_all.py 非空且含关键结构', () => {
  assert(script.length > 3000, '脚本过短，可能生成失败');
  ['TARGETS', 'def probe_get_models', 'def probe_post_chat', 'def check_one', 'def main',
   'DIAG', 'load_env_file', 'sys.exit(main())'].forEach(k => {
    assert(script.includes(k), '脚本缺少 ' + k);
  });
});

T('verify_all.py 能通过 Python 语法检查', () => {
  const tmp = path.join(os.tmpdir(), 'verify_all_test_' + Date.now() + '.py');
  fs.writeFileSync(tmp, script, 'utf8');
  try {
    execFileSync(process.platform === 'win32' ? 'python' : 'python3',
      ['-m', 'py_compile', tmp], { stdio: 'pipe' });
  } catch (e) {
    throw new Error('Python 编译失败：' + (e.stderr ? e.stderr.toString() : e.message));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
});

T('verify_all.py 内嵌的 TARGETS 是合法 JSON', () => {
  const m = script.match(/TARGETS = (\[[\s\S]*?\n\s*\])\n\nTIMEOUT/);
  assert(m, '找不到 TARGETS 块');
  const arr = JSON.parse(m[1]);
  assert(arr.length === VENDOR_ACCESS.filter(v => v.base).length,
    'TARGETS 数量 ' + arr.length + ' 与有端点的厂商数不一致');
  arr.forEach(t => {
    assert(t.id && t.env && t.base && t.probe, 'TARGETS 条目字段不全：' + JSON.stringify(t));
  });
});

T('脚本里 --only 过滤逻辑存在', () => {
  assert(script.includes('--only'), '缺少 --only 参数');
  assert(script.includes('t["id"] in only'), '缺少 id 过滤实现');
});

T('.env 模板覆盖每一家', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(env.includes(v.env + '='), '.env 模板缺 ' + v.env);
  });
});

T('.env 模板带安全提醒与用法说明', () => {
  assert(env.includes('.gitignore'), '缺少安全提醒');
  assert(env.includes('python verify_all.py'), '缺少用法说明');
  assert(env.includes('401') || env.includes('用法'), '缺少错误码说明');
});

T('Markdown 速查表结构完整', () => {
  assert(md.startsWith('# 主流大模型接入核验速查表'), '标题不对');
  VENDOR_ACCESS.forEach(v => {
    assert(md.includes('### ' + v.name), 'md 缺 ' + v.name);
  });
  assert(md.includes('三条通用铁律'), '缺少结尾总结');
});

T('Markdown 里每家都有 base_url 与环境变量', () => {
  VENDOR_ACCESS.forEach(v => {
    assert(md.includes(v.env), 'md 缺环境变量 ' + v.env);
    if (v.base) assert(md.includes('`' + v.base + '`'), 'md 缺 base_url ' + v.base);
  });
});

/* ============================================================
   5. 视图注册
   ============================================================ */
console.log('\n[5] 视图注册');

T('VIEWS.verify 已注册', () => {
  assert(VIEWS.verify, 'VIEWS.verify 未注册');
  assert(VIEWS.verify.title === '接入核验', '标题不对：' + VIEWS.verify.title);
  assert(typeof VIEWS.verify.render === 'function', 'render 不是函数');
});

T('视图引用的 DOM id 在模板里都存在', () => {
  const tpl = fs.readFileSync(A('template.html'), 'utf8');
  ['verify-summary', 'verify-filters', 'verify-list', 'verify-export',
   'verify-conflicts', 'verify-retired'].forEach(id => {
    assert(tpl.includes('id="' + id + '"'), '模板缺 #' + id);
  });
  assert(tpl.includes('id="view-verify"'), '模板缺 #view-verify');
  assert(tpl.includes('data-v="verify"'), '模板缺导航项 data-v="verify"');
});

T('verify.js 已接入构建脚本', () => {
  const bp = fs.readFileSync(path.join(__dirname, 'build.py'), 'utf8');
  assert(bp.includes('verify.js'), 'build.py 未读取 verify.js');
  assert(bp.includes('/*__VERIFY__*/'), 'build.py 未注入占位符');
  const app = fs.readFileSync(A('app.js'), 'utf8');
  assert(app.includes('/*__VERIFY__*/'), 'app.js 缺少注入点');
});

/* ---------- 汇总 ---------- */
console.log('\n' + '-'.repeat(56));
console.log('  通过 ' + pass + ' / 失败 ' + fail);
console.log('-'.repeat(56) + '\n');
process.exit(fail ? 1 : 0);
