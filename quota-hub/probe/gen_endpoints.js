/* 从 assets/verify.js 的 VENDOR_ACCESS 抽出端点清单 → probe/endpoints.json
   为什么要多这一步：探活脚本要在 CI 里跑，不该去解析 JS 源码；
   而端点表只能有一个真相源，否则两边必然漂移。
   test-probe.js 会重新生成一次并与已提交的文件比对，漂移就报错。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const A = p => path.join(__dirname, '..', 'assets', p);
const OUT = path.join(__dirname, 'endpoints.json');

const src = fs.readFileSync(A('verify.js'), 'utf8');

/* 从 `const VENDOR_ACCESS = [` 开始做括号配对，字符串里的括号不计入 */
function extractArray(text, startMarker) {
  const at = text.indexOf(startMarker);
  if (at < 0) throw new Error('找不到 ' + startMarker);
  const open = text.indexOf('[', at);
  let depth = 0, i = open, quote = null;
  for (; i < text.length; i++) {
    const ch = text[i], prev = text[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  throw new Error('括号未闭合');
}

const arrText = extractArray(src, 'const VENDOR_ACCESS = [');
const rows = new Function('return ' + arrText + ';')();

if (!Array.isArray(rows) || rows.length < 15) throw new Error('解析出的条目数异常：' + (rows && rows.length));

const PROBE_PATH = {
  models: '/models',
  anthropic: '/models',
  chat: '/chat/completions',
};

const skipped = [];
const items = [];
for (const v of rows) {
  /* llama 这类自托管条目没有公网端点，探活无意义——记下来但不算漏测 */
  if (!v.base) { skipped.push({ id: v.id, name: v.name, reason: '自托管 / 无公网端点' }); continue; }
  const p = PROBE_PATH[v.probe];
  if (!p) throw new Error(v.id + ' 的 probe 类型未知：' + v.probe);
  if (!/^https:\/\//.test(v.base)) throw new Error(v.id + ' 的 base 不是 https：' + v.base);
  if (!/^[A-Z0-9_]+$/.test(v.env || '')) throw new Error(v.id + ' 的 env 不合法：' + v.env);
  items.push({
    id: v.id,
    name: v.name,
    vendor: v.vendor,
    region: v.region,
    env: v.env,
    base: v.base.replace(/\/+$/, ''),
    /* 少数平台（商汤）的兼容端点没实现 /models，探活要换到原生端点 */
    probeBase: v.probeBase ? v.probeBase.replace(/\/+$/, '') : null,
    probePath: v.probePath || null,
    probe: v.probe,
    path: v.probePath || p,
    /* chat 型探针需要一个真实 model id，否则必然 400，测出来的是假故障 */
    model: v.probe === 'chat' ? (v.models || [])[0] || null : null,
  });
}

const ids = new Set();
for (const it of items) {
  if (ids.has(it.id)) throw new Error('id 重复：' + it.id);
  ids.add(it.id);
}

const payload = {
  schema: 1,
  generatedFrom: 'assets/verify.js#VENDOR_ACCESS',
  sourceHash: crypto.createHash('sha256').update(arrText).digest('hex').slice(0, 16),
  count: items.length,
  skipped,
  note: '本文件由 quota-hub/probe/gen_endpoints.js 生成，不要手改。改端点请改 assets/verify.js。',
  endpoints: items,
};

const text = JSON.stringify(payload, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old !== text) {
    console.error('endpoints.json 与 verify.js 不一致，请重新运行：node probe/gen_endpoints.js');
    process.exit(1);
  }
  console.log('endpoints.json 与 verify.js 一致（' + items.length + ' 家）');
} else {
  fs.writeFileSync(OUT, text, 'utf8');
  console.log('写入 ' + OUT + '，' + items.length + ' 家端点');
}
