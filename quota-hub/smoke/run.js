/* 冒烟测试执行器：把 harness 注入产物 → Edge 无头跑 → --dump-dom 抓结果。
   用法：node run.js
   环境变量：EDGE 浏览器路径可覆盖 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ART = path.join(ROOT, 'AI-Agent免费额度调度中台.html');
const HARNESS = fs.readFileSync(path.join(__dirname, 'harness.js'), 'utf8');
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const html = fs.readFileSync(ART, 'utf8');

/* 种子：在 data 脚本末尾追加，保证早于 app.js 执行 */
function seed(code) {
  const parts = html.split('<script>');
  if (parts.length < 3) throw new Error('产物里找不到两段 <script>');
  parts[1] = parts[1] + '\n/*__SEED__*/\ntry{' + code + '}catch(e){document.title="SEEDFAIL:"+e.message}\n';
  return parts.join('<script>');
}

function build(seedCode) {
  let s = seedCode ? seed(seedCode) : html;
  const inject = '<script>\n' + HARNESS + '\n</script>\n</body>';
  if (s.split('</body>').length !== 2) throw new Error('</body> 应恰好一处');
  return s.replace('</body>', inject);
}

function run(name, seedCode, width, height) {
  const file = path.join(os.tmpdir(), 'qh-smoke-' + name + '.html');
  fs.writeFileSync(file, build(seedCode), 'utf8');
  const out = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--hide-scrollbars',
    '--window-size=' + width + ',' + height,
    '--virtual-time-budget=12000',
    '--dump-dom',
    'file:///' + file.replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });

  /* 注入的脚本源码里也含这个标签文本，必须锚定 JSON 开头才是真实结果 */
  const all = [...out.matchAll(/<pre id="__smoke__"[^>]*>\s*(\{"url"[\s\S]*?)<\/pre>/g)];
  const m = all.length ? all[all.length - 1] : null;
  if (!m) {
    const title = (out.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    return { name, fatal: '页面未产出结果（title=' + title + '）', raw: out.length };
  }
  const json = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return Object.assign({ name }, JSON.parse(json));
}

const CASES = [
  ['desktop', null, 1440, 900],
  ['mobile', null, 360, 780],
  ['corrupt', "localStorage.setItem('quotaHub.wallet.v1','null');localStorage.setItem('quotaHub.ui.v1','{bad json')", 1440, 900],
  ['foreign', "localStorage.setItem('quotaHub.wallet.v1',JSON.stringify({ghost:{name:'幽灵',enabled:true,tokensTotal:'9亿'},__proto__:{x:1}}))", 1440, 900],
];

let fail = 0, total = 0;
const t0 = Date.now();
for (const [name, seedCode, w, h] of CASES) {
  const r = run(name, seedCode, w, h);
  console.log('\n═══ ' + name + '  ' + w + '×' + h + ' ═══');
  if (r.fatal) { console.log('  ✗ ' + r.fatal); fail++; continue; }
  const errs = (r.errors || []).filter(e => !/SEEDFAIL/.test(e));
  for (const c of r.checks) {
    total++;
    if (!c.p) fail++;
    console.log((c.p ? '  ✓ ' : '  ✗ ') + c.n + (c.note ? '  [' + c.note + ']' : ''));
  }
  if (errs.length) { console.log('  ⚠ 运行时错误 ' + errs.length + ':'); errs.forEach(e => console.log('     - ' + e)); fail++; }
  else console.log('  ✓ 无运行时错误');
}
console.log('\n合计 ' + total + ' 项断言，失败 ' + fail + ' 项，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exit(fail ? 1 : 0);
