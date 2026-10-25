/* 截图小工具：切到指定视图、关掉动画、滚到指定元素，再截一张。
   用法：node shot.js <视图id> <输出png> [滚动到的元素id] [宽] [高] */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ART = path.join(ROOT, 'AI-Agent免费额度调度中台.html');
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const view = process.argv[2] || 'overview';
const out = process.argv[3] || path.join(os.tmpdir(), 'shot.png');
const anchor = process.argv[4] || '';
const W = process.argv[5] || '1400';
const H = process.argv[6] || '900';

const html = fs.readFileSync(ART, 'utf8');
const seed = `
<style>*{animation:none!important;transition:none!important}</style>
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var nav = document.querySelector('[data-v="${view}"]');
    if (nav) nav.click();
    var a = ${anchor ? `document.getElementById('${anchor}')` : 'null'};
    if (a) a.scrollIntoView({ block: 'center' });
  }, 260);
});
<\/script>`;

const tmp = path.join(os.tmpdir(), 'qh-shot-' + view + '.html');
fs.writeFileSync(tmp, html.replace('</body>', seed + '</body>'), 'utf8');
try { fs.unlinkSync(out); } catch (e) {}
execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  '--window-size=' + W + ',' + H, '--virtual-time-budget=5000',
  '--screenshot=' + out, 'file:///' + tmp.replace(/\\/g, '/'),
], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
console.log(out + '  ' + fs.statSync(out).size + 'B');
