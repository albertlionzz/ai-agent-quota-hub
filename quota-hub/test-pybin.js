#!/usr/bin/env node
/* 跨平台解释器解析 + 「别再写死本机路径」回归
   起因：CI 第一次跑单测就红，因为 test-access / test-export 把
   Python 的 Windows 绝对路径写死，本地全绿、runner 全挂。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolvePython, CANDIDATES } = require('./pybin');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n    ' + e.message); }
}

ok('能解析出一个可用的解释器', () => {
  const py = resolvePython();
  assert(typeof py === 'string' && py.length, '返回值不是字符串');
  execFileSync(py, ['-c', 'import sys'], { stdio: 'pipe' });
});

ok('要求 PyYAML 时也能解析出来（YAML 校验靠它）', () => {
  const py = resolvePython({ yaml: true });
  execFileSync(py, ['-c', 'import yaml'], { stdio: 'pipe' });
});

ok('解析结果被缓存，重复调用返回同一个', () => {
  assert.strictEqual(resolvePython(), resolvePython());
});

ok('PYTHON_BIN 指向不存在的路径时会跳过，而不是直接抛错', () => {
  const old = process.env.PYTHON_BIN;
  process.env.PYTHON_BIN = path.join(__dirname, 'no-such-python');
  try {
    /* 清掉模块缓存，逼它重新探测 */
    delete require.cache[require.resolve('./pybin')];
    const fresh = require('./pybin');
    const py = fresh.resolvePython();
    assert(py && py !== process.env.PYTHON_BIN, '不该返回不存在的路径：' + py);
    execFileSync(py, ['-c', 'import sys'], { stdio: 'pipe' });
  } finally {
    if (old === undefined) delete process.env.PYTHON_BIN;
    else process.env.PYTHON_BIN = old;
    delete require.cache[require.resolve('./pybin')];
  }
});

ok('候选清单里没有重复项', () => {
  assert.strictEqual(new Set(CANDIDATES).size, CANDIDATES.length);
});

/* 真正的回归防线：不许再有测试写死本机绝对路径 */
ok('所有 test-*.js 都不含写死的本机 Python 路径', () => {
  const dir = __dirname;
  const bad = fs.readdirSync(dir)
    .filter(f => /^test-.*\.js$/.test(f))
    .filter(f => /C:[\\/]+Users[\\/]+[^'"\s]+python/i.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter(f => f !== 'test-pybin.js');   // 本文件要提到那个模式才能断言
  assert.deepStrictEqual(bad, [], '这些文件写死了本机路径：' + bad.join(', '));
});

console.log(`\n解释器解析单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
