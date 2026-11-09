/* ============================================================
   跨平台找 Python
   ------------------------------------------------------------
   测试里原本把解释器绝对路径写死成
   C:/Users/zhouy/.workbuddy/binaries/python/envs/default/Scripts/python.exe，
   本地全绿、CI（ubuntu runner + setup-python）必然找不到 —— 这个模块
   就是补那个坑：按 PYTHON_BIN → 本机 venv → PATH 依次探测，并且真的
   跑一次 import 验证能用，而不是「路径存在就算数」。

   opts.yaml = true 时还要求 PyYAML（生成出来的 litellm_config.yaml
   要靠真解析器读，不能用正则糊）。
   ============================================================ */
const { execFileSync } = require('child_process');

const CANDIDATES = [
  process.env.PYTHON_BIN,
  process.env.PYTHON,
  process.platform === 'win32'
    ? 'C:/Users/zhouy/.workbuddy/binaries/python/envs/default/Scripts/python.exe'
    : null,
  process.platform === 'win32'
    ? 'C:/Users/zhouy/.workbuddy/binaries/python/versions/3.13.12/python.exe'
    : null,
  'python3',
  'python'
].filter(Boolean);

function usable(bin, needYaml) {
  try {
    execFileSync(bin, ['-c', needYaml ? 'import yaml' : 'import sys'],
      { stdio: 'pipe', timeout: 20000 });
    return true;
  } catch (e) {
    return false;   // 解释器不存在，或没装 PyYAML
  }
}

let cache = {};

function resolvePython(opts) {
  const needYaml = !!(opts && opts.yaml);
  const key = needYaml ? 'yaml' : 'plain';
  if (cache[key]) return cache[key];
  const hit = CANDIDATES.find(bin => usable(bin, needYaml));
  if (!hit) {
    throw new Error('找不到可用的 Python' + (needYaml ? '（要求能 import yaml）' : '') +
      '。候选：' + CANDIDATES.join(' , ') +
      '\n修法：设 PYTHON_BIN=/path/to/python，或先 pip install pyyaml。');
  }
  cache[key] = hit;
  return hit;
}

module.exports = { resolvePython, CANDIDATES };
