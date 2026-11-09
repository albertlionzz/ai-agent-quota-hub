/* 截图小工具：切到指定视图、关掉动画、滚到指定元素，再截一张。
   用法：node shot.js <视图id> <输出png> [元素id] [宽] [高] [冷却张数] [只留该卡片]
   第 6 个参数把前 N 张额度卡设成限流，好看到冷却态的样子。
   第 7 个参数传 1 时，把同视图其他卡片藏掉——长页面（接入通道 >5000px）
   在无头浏览器里滚动后常常来不及重绘，截出来是一片空白，藏掉比滚动可靠。
   第 9 个参数传元素 id，会在切视图后把该 <details> 展开（默认收起的说明块）。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveBrowser, headlessArgs, fileUrl } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const ART = path.join(ROOT, 'AI-Agent免费额度调度中台.html');
const BROWSER = resolveBrowser();

const view = process.argv[2] || 'overview';
const out = process.argv[3] || path.join(os.tmpdir(), 'shot.png');
const anchor = process.argv[4] || '';
const W = process.argv[5] || '1400';
const H = process.argv[6] || '900';
const coolN = parseInt(process.argv[7] || '0', 10) || 0;
const focus = process.argv[8] === '1';
const openId = process.argv[9] || '';

const html = fs.readFileSync(ART, 'utf8');
const seed = `
<style>*{animation:none!important;transition:none!important}</style>
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var nav = document.querySelector('[data-v="${view}"]');
    if (nav) nav.click();
    if ('${openId}') { var d = document.getElementById('${openId}'); if (d) d.open = true; }
    if (${focus}) {
      var t = document.getElementById('${anchor}');
      if (t) {
        var keep = t.closest('.card') || t;
        var cards = document.querySelectorAll('.view.active .card');
        for (var i = 0; i < cards.length; i++) {
          if (!keep.contains(cards[i])) cards[i].style.display = 'none';
        }
      }
    }
    /* 每次改冷却都会重渲染整张列表，所以只能一次设一张、设完重新查 */
    var left = ${coolN};
    (function step() {
      if (left <= 0) {
        /* 内容多的视图（接入通道）在切换后还会继续撑高，
           太早滚会滚到「当时的底部」，截出来是一片空白。所以滚两次。 */
        scrollToAnchor();
        setTimeout(scrollToAnchor, 700);
        return;
      }
      var list = [].slice.call(document.querySelectorAll('[data-wc]'));
      var s = list.filter(function (x) {
        return !x.parentNode.classList.contains('on');
      })[0];
      if (s) { s.value = '60'; s.dispatchEvent(new Event('change', { bubbles: true })); }
      left--;
      setTimeout(step, 80);
    })();

    function scrollToAnchor() {
      var a = ${anchor ? `document.getElementById('${anchor}')` : 'null'};
      if (a) a.scrollIntoView({ block: 'center' });
    }
  }, 260);
});
<\/script>`;

const tmp = path.join(os.tmpdir(), 'qh-shot-' + view + '.html');
fs.writeFileSync(tmp, html.replace('</body>', seed + '</body>'), 'utf8');
try { fs.unlinkSync(out); } catch (e) {}
execFileSync(BROWSER, headlessArgs().concat([
  '--window-size=' + W + ',' + H, '--virtual-time-budget=5000',
  '--screenshot=' + out, fileUrl(tmp),
]), { stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
console.log(out + '  ' + fs.statSync(out).size + 'B');
