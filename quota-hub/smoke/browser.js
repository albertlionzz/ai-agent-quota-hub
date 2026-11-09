/* ============================================================
   无头浏览器解析（跨平台）
   ------------------------------------------------------------
   原先 run.js / narrow.js / shot.js 都把 Windows 版 Edge 的绝对路径
   写死，本地能跑、CI（ubuntu-latest）必然找不到。这里集中做三件事：
     1) 允许 BROWSER_BIN / EDGE / CHROME_BIN 显式覆盖（CI 用 which 探测后传入）
     2) 按平台探测常见安装路径，再从 PATH 里找一次
     3) 统一 headless 参数：Linux runner 必须带 --no-sandbox，否则
        Chrome 会以 root/受限命名空间启动失败，表现为「超时无输出」
   file:// 下的 iframe 需要 --allow-file-access-from-files，三个脚本都要。
   ============================================================ */
const fs = require('fs');
const { execFileSync } = require('child_process');

const WIN_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const POSIX_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];

function fromPath() {
  const commands = process.platform === 'win32'
    ? ['msedge', 'chrome']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  for (const cmd of commands) {
    try {
      const out = execFileSync(lookup, [cmd], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
      });
      const hit = String(out).split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      if (hit && fs.existsSync(hit)) return hit;
    } catch (e) { /* 该命令不存在或不在 PATH，继续试下一个 */ }
  }
  return null;
}

function resolveBrowser() {
  const override = process.env.BROWSER_BIN || process.env.EDGE || process.env.CHROME_BIN;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error('浏览器路径不存在：' + override + '（检查 BROWSER_BIN / EDGE / CHROME_BIN）');
    }
    return override;
  }
  const candidates = process.platform === 'win32' ? WIN_PATHS : POSIX_PATHS;
  for (const p of candidates) if (fs.existsSync(p)) return p;
  const found = fromPath();
  if (found) return found;
  throw new Error('未找到 Chromium 内核浏览器（Edge / Chrome / Chromium）。'
    + '请设置 BROWSER_BIN=<可执行文件绝对路径> 后重试。');
}

function headlessArgs() {
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--hide-scrollbars'
  ];
  // GitHub Actions 的 runner 里 Chrome 常因用户命名空间受限起不来；本机 Windows 不需要。
  if (process.platform !== 'win32') args.push('--no-sandbox', '--disable-dev-shm-usage');
  return args;
}

/* Windows: C:\a\b -> file:///C:/a/b   Linux: /home/a -> file:///home/a
   两种平台都恰好三个斜杠；无脑拼 'file:///' 会让 Linux 路径变成四个斜杠。 */
function fileUrl(p) {
  const norm = p.replace(/\\/g, '/');
  return 'file://' + (norm.startsWith('/') ? '' : '/') + norm;
}

module.exports = { resolveBrowser, headlessArgs, fileUrl };
