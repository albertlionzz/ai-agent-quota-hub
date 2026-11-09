/* ============================================================
   真实窄屏横向溢出回归
   ------------------------------------------------------------
   headless Chromium 有最小视口宽度（本机约 518px），--window-size=360
   实际按 518 渲染，run.js 的 mobile 场景测不到真窄屏。这里把产物
   塞进指定宽度的 iframe，读 iframe 内 documentElement.scrollWidth。
   每个宽度同时测「说明块收起 / 展开」两态 —— 只测收起态会漏掉
   展开后长英文串撑宽的那种溢出。

   用法：node smoke/narrow.js
   浏览器由 ./browser.js 跨平台解析，CI 上用 BROWSER_BIN 指向 runner 预装的 Chrome。
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBrowser, headlessArgs, fileUrl } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const ART = path.join(ROOT, 'AI-Agent免费额度调度中台.html');
const BROWSER = resolveBrowser();
const WIDTHS = [320, 360, 518, 768];

function hostHtml(w) {
  return `<!doctype html><html><body style="margin:0">
<iframe id="f" src="${fileUrl(ART)}" style="width:${w}px;height:900px;border:0"></iframe>
<pre id="__res__">PENDING</pre>
<script>
document.getElementById('f').addEventListener('load', function () {
  var self = this;
  setTimeout(function () {
    var d = self.contentDocument, w = self.contentWindow, out = { width: ${w} };
    try {
      var nav = d.querySelector('[data-v="registry"]'); if (nav) nav.click();
      var why = d.getElementById('cc-why');
      function snap() {
        var groups = [].slice.call(d.querySelectorAll('.cc-why-group'));
        var fb = d.getElementById('filter-bar');
        var cd = d.getElementById('conf-dist');
        var bar = cd ? cd.querySelector('.cd-bar') : null;
        return {
          innerWidth: w.innerWidth,
          docScroll: d.documentElement.scrollWidth,
          docClient: d.documentElement.clientWidth,
          groupOverflow: Math.max.apply(null, [0].concat(groups.map(function (g) {
            return g.scrollWidth - g.clientWidth; }))),
          confOverflow: cd ? cd.scrollWidth - cd.clientWidth : 0,
          barOverflow: bar ? bar.scrollWidth - bar.clientWidth : 0,
          groups: groups.length,
          filterRows: fb ? [].slice.call(fb.children).map(function (r) {
            return Math.round(r.getBoundingClientRect().top); }) : []
        };
      }
      if (why) why.open = false;
      out.closed = snap();
      if (why) why.open = true;
      out.opened = snap();
    } catch (e) { out.error = e.message; }
    document.getElementById('__res__').textContent = JSON.stringify(out);
  }, 400);
});
<\/script></body></html>`;
}

function measure(w) {
  const tmp = path.join(os.tmpdir(), 'qh-narrow-' + w + '.html');
  fs.writeFileSync(tmp, hostHtml(w), 'utf8');
  const dom = execFileSync(BROWSER, headlessArgs().concat([
    '--virtual-time-budget=6000', '--dump-dom', fileUrl(tmp),
  ]), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
  const m = dom.match(/<pre id="__res__">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error('未拿到测量结果');
  return JSON.parse(m[1].trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

let pass = 0, fail = 0;
function ok(name, cond, note) {
  if (cond) { pass++; console.log('  ok   ' + name + (note ? '  [' + note + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (note ? '  [' + note + ']' : '')); }
}

WIDTHS.forEach(w => {
  let r;
  try { r = measure(w); }
  catch (e) { ok(w + 'px 测量可执行', false, e.message); return; }
  if (r.error) { ok(w + 'px iframe 可读', false, r.error); return; }
  console.log('\n' + w + 'px 视口（iframe 实测 innerWidth=' + r.opened.innerWidth + '）');
  ok(w + 'px 真的是目标宽度（没被 headless 抬宽）',
    r.opened.innerWidth === w, r.opened.innerWidth);
  ['closed', 'opened'].forEach(state => {
    const s = r[state];
    const label = state === 'closed' ? '收起态' : '展开态';
    ok(label + ' 无横向溢出', s.docScroll <= s.docClient + 1,
      s.docScroll + '/' + s.docClient);
    if (state === 'opened') {
      ok('说明块分组卡片无内部溢出', s.groupOverflow <= 1, s.groupOverflow);
      ok('可信度分布条无内部溢出', s.confOverflow <= 1, s.confOverflow);
      ok('堆叠条本身无内部溢出', s.barOverflow <= 1, s.barOverflow);
      ok('6 个形态分组都在（补录两家后聚合组已清空）', s.groups === 6, s.groups);
      ok('筛选组分成 3 行', new Set(s.filterRows).size === 3, s.filterRows.join(','));
    }
  });
});

console.log('\n窄屏回归：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
