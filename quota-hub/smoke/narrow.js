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
      /* 联合分布矩阵在另一个视图，切过去单独量一次 */
      var cn = d.querySelector('[data-v="crosscheck"]'); if (cn) cn.click();
      var jt = d.querySelector('.cj-table'), jc = d.querySelector('.cc-joint');
      out.joint = {
        docScroll: d.documentElement.scrollWidth,
        docClient: d.documentElement.clientWidth,
        tableOverflow: jt ? jt.scrollWidth - jt.clientWidth : -1,
        cardOverflow: jc ? jc.scrollWidth - jc.clientWidth : -1,
        cells: d.querySelectorAll('.cj-btn').length
      };
      /* 点一格落到平台库：量面包屑与高亮卡片在窄屏有没有撑宽。
         这里顺手验证「面包屑露出来 + 高亮张数 = 结果张数」，
         窄屏最容易出的事就是这行说明把整页顶出横向滚动。 */
      var cell0 = d.querySelector('.cj-btn');
      if (cell0) cell0.click();
      var jfb = d.getElementById('joint-focus');
      out.focus = {
        docScroll: d.documentElement.scrollWidth,
        docClient: d.documentElement.clientWidth,
        barOverflow: jfb ? jfb.scrollWidth - jfb.clientWidth : -1,
        shown: jfb ? !jfb.hidden : false,
        hits: d.querySelectorAll('#platform-grid .pcard.jf-hit').length,
        cards: d.querySelectorAll('#platform-grid .pcard').length
      };
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
  const j = r.joint || {};
  ok('联合分布矩阵无横向溢出', j.docScroll <= j.docClient + 1, j.docScroll + '/' + j.docClient);
  ok('矩阵表格与卡片都无内部溢出', j.tableOverflow <= 1 && j.cardOverflow <= 1,
    'table ' + j.tableOverflow + ' / card ' + j.cardOverflow);
  ok('窄屏下矩阵仍渲染 11 个可点格子', j.cells === 11, j.cells);

  const f = r.focus || {};
  ok('点格子在窄屏也能落到平台库并露出面包屑', f.shown === true, f.shown);
  ok('组合面包屑自身无横向溢出', f.barOverflow <= 1, f.barOverflow);
  ok('落地后整页仍无横向溢出', f.docScroll <= f.docClient + 1, f.docScroll + '/' + f.docClient);
  ok('高亮张数 = 结果张数（窄屏也没漏卡片）', f.hits > 0 && f.hits === f.cards,
    f.hits + '/' + f.cards);
});

console.log('\n窄屏回归：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
