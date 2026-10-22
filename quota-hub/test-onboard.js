/* 接入向导 / 脚本生成单测：加载真实 onboard.js，并对生成的脚本做真语法检查 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');

const read = p => fs.readFileSync(path.join(__dirname, 'assets', p), 'utf8');

/* 真实厂商表（拿真实的 env / base / probe，避免用假数据自欺） */
const vSrc = read('verify.js').match(/const VENDOR_ACCESS = (\[[\s\S]*?\n\]);/)[1];
const VENDOR_ACCESS = eval(vSrc);
const byId = id => VENDOR_ACCESS.find(v => v.id === id);

const box = {};
new Function('box', read('onboard.js') + `
  ;Object.assign(box, { ONBOARD_GOALS, ONBOARD_COMFORT, recommendAccess,
                        buildVendorEnvScript, buildGatewayScript, vendorAuthMode,
                        probeTarget, shq, psq, interpretProbe, maskKey, CORS_HINT });`)(box);

const { ONBOARD_GOALS, ONBOARD_COMFORT, recommendAccess,
        buildVendorEnvScript, buildGatewayScript, vendorAuthMode, shq, psq,
        interpretProbe, maskKey, CORS_HINT } = box;

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}

/* ---------------- 推荐矩阵 ---------------- */
ok('3 × 3 组合全部有答案，且步骤不超过 3 条', () => {
  ONBOARD_GOALS.forEach(g => ONBOARD_COMFORT.forEach(c => {
    const r = recommendAccess(g.id, c.id);
    assert.ok(r && r.title && r.why, `${g.id}/${c.id} 缺内容`);
    assert.ok(Array.isArray(r.steps) && r.steps.length >= 1 && r.steps.length <= 3,
      `${g.id}/${c.id} 步骤数 ${r.steps.length}`);
    assert.ok(typeof r.minutes === 'number' && r.minutes >= 0);
    assert.ok(r.caveat && r.caveat.length > 5, `${g.id}/${c.id} 缺注意事项`);
  }));
});
ok('脚本 + 命令行 → 网关', () => {
  assert.strictEqual(recommendAccess('script', 'shell').pathId, 'gateway');
});
ok('脚本 + 能粘贴一条 → 先用聚合商', () => {
  assert.strictEqual(recommendAccess('script', 'onecmd').pathId, 'aggregator');
});
ok('脚本 + 不想碰命令行 → 网关，并给出 GUI 兜底', () => {
  const r = recommendAccess('script', 'nogui');
  assert.strictEqual(r.pathId, 'gateway');
  assert.ok(/GUI/.test(r.caveat), '应提示 GUI 客户端兜底：' + r.caveat);
});
ok('聊天 + 不想碰命令行 → 网页版，0 分钟', () => {
  const r = recommendAccess('chat', 'nogui');
  assert.strictEqual(r.pathId, 'web');
  assert.strictEqual(r.minutes, 0);
});
ok('写代码 → IDE 插件', () => {
  ONBOARD_COMFORT.forEach(c => {
    assert.strictEqual(recommendAccess('ide', c.id).pathId, 'ide');
  });
});
ok('推荐结果里不出现"自动注册"这类承诺', () => {
  ONBOARD_GOALS.forEach(g => ONBOARD_COMFORT.forEach(c => {
    const s = JSON.stringify(recommendAccess(g.id, c.id));
    assert.ok(!/自动注册|脚本注册|批量注册/.test(s), `${g.id}/${c.id} 出现了不该有的承诺`);
  }));
});

/* ---------------- 环境变量脚本 ---------------- */
ok('生成的脚本带上真实环境变量名与端点', () => {
  const v = byId('zhipu');
  const s = buildVendorEnvScript(v, 'abc123', 'bash');
  assert.ok(s.includes('ZHIPUAI_API_KEY'), '缺环境变量名');
  assert.ok(s.includes(v.base), '缺 base_url');
  assert.ok(s.includes('abc123'));
});
ok('key 里的单引号在 bash 里被正确转义', () => {
  const s = buildVendorEnvScript(byId('openai'), "sk-a'b", 'bash');
  assert.ok(s.includes("sk-a'\\''b"), '转义不对：' + s.split('\n')[4]);
});
ok('key 里的单引号在 PowerShell 里翻倍转义', () => {
  const s = buildVendorEnvScript(byId('openai'), "sk-a'b", 'ps');
  assert.ok(s.includes("sk-a''b"), '转义不对');
});
ok('Anthropic 用 x-api-key + anthropic-version，不用 Bearer', () => {
  const v = byId('anthropic');
  assert.strictEqual(vendorAuthMode(v), 'anthropic');
  const b = buildVendorEnvScript(v, 'k', 'bash');
  assert.ok(b.includes('x-api-key'), '缺 x-api-key');
  assert.ok(b.includes('anthropic-version'), '缺 anthropic-version');
  assert.ok(!/Authorization: Bearer/.test(b), '不该出现 Bearer');
  const p = buildVendorEnvScript(v, 'k', 'ps');
  assert.ok(p.includes("'x-api-key'") && !/Bearer/.test(p));
});
ok('OpenAI 兼容平台用 Bearer', () => {
  ['openai', 'zhipu', 'deepseek', 'moonshot'].forEach(id => {
    assert.strictEqual(vendorAuthMode(byId(id)), 'bearer', id + ' 应走 Bearer');
    assert.ok(buildVendorEnvScript(byId(id), 'k', 'bash').includes('Authorization: Bearer'));
  });
});
ok('没有 /models 的平台如实说明会消耗一次请求', () => {
  const s = buildVendorEnvScript(byId('spark'), 'k', 'bash');
  assert.ok(/没有 \/models|会计 1 次请求/.test(s), '不应假装零成本自检');
});
ok('无固定端点的 llama 给出说明而不是错误命令', () => {
  const s = buildVendorEnvScript(byId('llama'), 'k', 'bash');
  assert.ok(s.includes('没有固定端点'), s);
  assert.ok(!s.includes('curl'), '不该生成 curl');
});
ok('两种 shell 版本都不为空且各含自己的语法', () => {
  const b = buildVendorEnvScript(byId('groq'), 'k', 'bash');
  const p = buildVendorEnvScript(byId('groq'), 'k', 'ps');
  assert.ok(b.includes('curl') && b.includes('cat >'));
  assert.ok(p.includes('Invoke-WebRequest') && p.includes('Set-Content'));
});
ok('23 家厂商都能生成脚本（无异常、无 undefined）', () => {
  VENDOR_ACCESS.forEach(v => {
    ['bash', 'ps'].forEach(sh => {
      const s = buildVendorEnvScript(v, 'k', sh);
      assert.ok(typeof s === 'string' && s.length > 20, `${v.id}/${sh} 太短`);
      assert.ok(!/undefined/.test(s), `${v.id}/${sh} 出现 undefined`);
    });
  });
});

/* ---------------- 浏览器验活：状态码解读 ---------------- */
ok('200 且返回 data 数组 → 报出模型数', () => {
  const r = interpretProbe(200, JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
  assert.strictEqual(r.tone, 'ok');
  assert.ok(/3 个/.test(r.text), r.text);
});
ok('200 且返回 models 数组（Gemini 风格）也认', () => {
  const r = interpretProbe(200, JSON.stringify({ models: [{}, {}] }));
  assert.ok(/2 个/.test(r.text), r.text);
});
ok('200 但不是 JSON 也不炸，只说通了', () => {
  const r = interpretProbe(200, '<html>ok</html>');
  assert.strictEqual(r.tone, 'ok');
  assert.ok(/通了/.test(r.text));
});
ok('401 → 明确指向 key 本身', () => {
  const r = interpretProbe(401, JSON.stringify({ error: { code: '401', message: '令牌已过期或验证不正确' } }));
  assert.strictEqual(r.tone, 'err');
  assert.ok(/key 无效|过期/.test(r.text), r.text);
});
ok('403 → 提示未必是 key 的问题', () => {
  const r = interpretProbe(403, '{}');
  assert.strictEqual(r.tone, 'warn');
  assert.ok(/没开通|地域|白名单/.test(r.text), r.text);
});
ok('404 → 指向 base_url', () => {
  const r = interpretProbe(404, '');
  assert.strictEqual(r.tone, 'err');
  assert.ok(/base_url/.test(r.text));
});
ok('429 → 说明 key 是通的', () => {
  const r = interpretProbe(429, '');
  assert.strictEqual(r.tone, 'warn');
  assert.ok(/key 是通的/.test(r.text));
});
ok('5xx → 不赖用户', () => {
  const r = interpretProbe(503, '');
  assert.strictEqual(r.tone, 'warn');
  assert.ok(/不代表你的 key 有问题/.test(r.text));
});
ok('未知状态码不崩', () => {
  [0, 302, 418, 599].forEach(s => {
    assert.strictEqual(typeof interpretProbe(s, '').text, 'string');
  });
});

/* ---------------- 脱敏 ---------------- */
ok('maskKey 只露首尾四位', () => {
  assert.strictEqual(maskKey('sk-abcdefghijklmn'), 'sk-a****klmn');
});
ok('maskKey 短 key 全遮', () => {
  assert.strictEqual(maskKey('12345678'), '****');
  assert.strictEqual(maskKey(''), '');
});
ok('maskKey 不会把整串吐出来', () => {
  const k = 'sk-1234567890abcdef1234';
  assert.ok(!maskKey(k).includes('567890'));
});

/* ---------------- 白名单是「实测允许跨域」的提示，不是结论 ---------------- */
ok('跨域提示表里都是真实存在的厂商 id', () => {
  CORS_HINT.forEach(id => {
    assert.ok(VENDOR_ACCESS.some(v => v.id === id), id + ' 不在厂商表里');
  });
});
ok('智谱在跨域提示表里（实测 Access-Control-Allow-Origin 有返回）', () => {
  assert.ok(CORS_HINT.includes('zhipu'));
});

/* ---------------- 真语法检查 ---------------- */
const tmp = os.tmpdir();

ok('生成的 bash 脚本能通过 bash -n', () => {
  VENDOR_ACCESS.forEach(v => {
    const s = buildVendorEnvScript(v, "k'ey-test", 'bash');
    if (!s.includes('curl')) return;                 /* 说明性文本不需要检查 */
    const f = path.join(tmp, 'qb-' + v.id + '.sh');
    fs.writeFileSync(f, s, 'utf8');
    try {
      execFileSync('bash', ['-n', f], { stdio: 'pipe' });
    } catch (e) {
      throw new Error(v.id + ' 语法错误：' + String(e.stderr || e.message).slice(0, 200));
    } finally { try { fs.unlinkSync(f); } catch (e2) {} }
  });
});

ok('网关脚本能通过 bash -n', () => {
  const f = path.join(tmp, 'qb-gw.sh');
  fs.writeFileSync(f, buildGatewayScript('bash'), 'utf8');
  try { execFileSync('bash', ['-n', f], { stdio: 'pipe' }); }
  finally { try { fs.unlinkSync(f); } catch (e) {} }
});

ok('生成的 PowerShell 脚本能被 PS 解析器接受', () => {
  let ps = null;
  try { execFileSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'pipe' }); ps = 'powershell'; }
  catch (e) { try { execFileSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'pipe' }); ps = 'pwsh'; } catch (e2) {} }
  if (!ps) { console.log('    （本机无 PowerShell，跳过该项）'); return; }

  VENDOR_ACCESS.forEach(v => {
    const s = buildVendorEnvScript(v, "k'ey-test", 'ps');
    if (!s.includes('Invoke-WebRequest')) return;
    const f = path.join(tmp, 'qb-' + v.id + '.ps1');
    fs.writeFileSync(f, s, 'utf8');
    const cmd = `$errs=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${f.replace(/\\/g, '\\\\')}', [ref]$null, [ref]$errs); if ($errs.Count) { $errs[0].Message; exit 1 } else { exit 0 }`;
    try {
      execFileSync(ps, ['-NoProfile', '-Command', cmd], { stdio: 'pipe' });
    } catch (e) {
      throw new Error(v.id + ' PS 解析失败：' + String(e.stdout || e.message).slice(0, 200));
    } finally { try { fs.unlinkSync(f); } catch (e2) {} }
  });
});

ok('网关 PS 脚本能被解析', () => {
  const f = path.join(tmp, 'qb-gw.ps1');
  fs.writeFileSync(f, buildGatewayScript('ps'), 'utf8');
  let ps = null;
  try { execFileSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'pipe' }); ps = 'powershell'; } catch (e) {}
  if (!ps) return;
  const cmd = `$errs=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${f.replace(/\\/g, '\\\\')}', [ref]$null, [ref]$errs); if ($errs.Count) { $errs[0].Message; exit 1 } else { exit 0 }`;
  try { execFileSync(ps, ['-NoProfile', '-Command', cmd], { stdio: 'pipe' }); }
  finally { try { fs.unlinkSync(f); } catch (e) {} }
});

/* ---------------- 转义工具 ---------------- */
ok('shq / psq 边界', () => {
  assert.strictEqual(shq("a'b"), "'a'\\''b'");
  assert.strictEqual(psq("a'b"), "'a''b'");
  assert.strictEqual(shq(''), "''");
  assert.strictEqual(psq(undefined), "''");
});

console.log(`\n接入向导：通过 ${pass} / ${pass + fail}` + (fail ? `，失败 ${fail}` : '，全部通过'));
process.exit(fail ? 1 : 0);
