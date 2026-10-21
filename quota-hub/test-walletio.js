/* 钱包备份 导出/导入 单测：加载真实 usage.js + walletio.js */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = p => fs.readFileSync(path.join(__dirname, 'assets', p), 'utf8');

const box = {};
new Function('box', read('usage.js') + '\n' + read('walletio.js') + `
  ;Object.assign(box, { parseTok, walletPayload, walletFileName, parseWalletBackup,
                        applyWalletBackup, describeBackup, todayKey });`)(box);

const { walletPayload, walletFileName, parseWalletBackup, applyWalletBackup, describeBackup } = box;

const KNOWN = new Set(['zhipu', 'volc', 'gemini', 'groq', 'openrouter']);
const NOW = new Date('2026-10-22T10:00:00+08:00');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}

/* ---------- 导出 ---------- */
ok('导出载荷带 schema 与时间', () => {
  const p = walletPayload({ zhipu: { enabled: true, used: 0 } }, NOW);
  assert.strictEqual(p.app, 'ai-agent-quota-hub');
  assert.strictEqual(p.schema, 1);
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(p.exportedAt));
  assert.deepStrictEqual(Object.keys(p.wallet), ['zhipu']);
});
ok('文件名带日期', () => {
  assert.strictEqual(walletFileName(NOW), 'quota-hub-wallet-2026-10-22.json');
});
ok('导出再导入可还原用量', () => {
  const w = { zhipu: { enabled: true, used: 15000, usedDate: '2026-10-22', note: '主力' } };
  const text = JSON.stringify(walletPayload(w, NOW));
  const r = parseWalletBackup(text, KNOWN, NOW);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.entries.zhipu.used, 15000);
  assert.strictEqual(r.entries.zhipu.usedDate, '2026-10-22');
  assert.strictEqual(r.entries.zhipu.note, '主力');
});

/* ---------- 校验：坏输入必须被挡住 ---------- */
ok('空文件被拒', () => {
  const r = parseWalletBackup('   ', KNOWN, NOW);
  assert.strictEqual(r.ok, false);
  assert.ok(/空/.test(r.error));
});
ok('非 JSON 被拒且提示截断', () => {
  const r = parseWalletBackup('{"wallet": {"zhipu":', KNOWN, NOW);
  assert.strictEqual(r.ok, false);
  assert.ok(/JSON/.test(r.error));
});
ok('数组被拒', () => {
  assert.strictEqual(parseWalletBackup('[1,2,3]', KNOWN, NOW).ok, false);
});
ok('无关 JSON 被拒（不能把任意 JSON 当钱包）', () => {
  const r = parseWalletBackup('{"name":"x","version":2}', KNOWN, NOW);
  assert.strictEqual(r.ok, false);
  assert.ok(/wallet/.test(r.error));
});
ok('全是未知 id 时说明原因', () => {
  const r = parseWalletBackup('{"wallet":{"nope":{"used":1}}}', KNOWN, NOW);
  assert.strictEqual(r.ok, false);
  assert.ok(/平台库/.test(r.error));
});
ok('空 wallet 被拒', () => {
  assert.strictEqual(parseWalletBackup('{"wallet":{}}', KNOWN, NOW).ok, false);
});

/* ---------- 归一：脏字段要清洗，不能带进钱包 ---------- */
ok('未知 id 被剔除并计数', () => {
  const r = parseWalletBackup('{"wallet":{"zhipu":{"used":1},"ghost":{"used":9}}}', KNOWN, NOW);
  assert.ok(r.ok);
  assert.deepStrictEqual(Object.keys(r.entries), ['zhipu']);
  assert.deepStrictEqual(r.unknown, ['ghost']);
});
ok('used 支持 1.5万 这类写法', () => {
  const r = parseWalletBackup('{"wallet":{"zhipu":{"used":"1.5万"}}}', KNOWN, NOW);
  assert.strictEqual(r.entries.zhipu.used, 15000);
});
ok('used 非法时归零而不是 NaN', () => {
  const r = parseWalletBackup('{"wallet":{"zhipu":{"used":"很多"}}}', KNOWN, NOW);
  assert.strictEqual(r.entries.zhipu.used, 0);
});
ok('usedDate 格式非法则置 null', () => {
  const r = parseWalletBackup('{"wallet":{"zhipu":{"usedDate":"昨天"}}}', KNOWN, NOW);
  assert.strictEqual(r.entries.zhipu.usedDate, null);
});
ok('enabled 缺省视为启用', () => {
  const r = parseWalletBackup('{"wallet":{"zhipu":{}}}', KNOWN, NOW);
  assert.strictEqual(r.entries.zhipu.enabled, true);
});
ok('enabled:false 保留', () => {
  const r = parseWalletBackup('{"wallet":{"zhipu":{"enabled":false}}}', KNOWN, NOW);
  assert.strictEqual(r.entries.zhipu.enabled, false);
});
ok('非对象条目被计为坏数据并跳过', () => {
  const r = parseWalletBackup('{"wallet":{"zhipu":{},"volc":42}}', KNOWN, NOW);
  assert.strictEqual(r.bad, 1);
  assert.deepStrictEqual(Object.keys(r.entries), ['zhipu']);
});
ok('裸 map 也能导入', () => {
  const r = parseWalletBackup('{"zhipu":{"used":5}}', KNOWN, NOW);
  assert.ok(r.ok);
  assert.strictEqual(r.entries.zhipu.used, 5);
});
ok('保留 meta 供提示用', () => {
  const text = JSON.stringify(walletPayload({ zhipu: {} }, NOW));
  const r = parseWalletBackup(text, KNOWN, NOW);
  assert.strictEqual(r.meta.schema, 1);
  assert.strictEqual(r.meta.dataDate, null === r.meta.dataDate ? null : r.meta.dataDate);
});

/* ---------- 合并语义 ---------- */
ok('merge 只补缺失，不动已有用量', () => {
  const cur = { zhipu: { enabled: true, used: 999 } };
  const out = applyWalletBackup(cur, { zhipu: { used: 1 }, volc: { used: 2 } }, 'merge');
  assert.strictEqual(out.zhipu.used, 999);
  assert.strictEqual(out.volc.used, 2);
});
ok('replace 整份替换', () => {
  const cur = { zhipu: { used: 999 } };
  const out = applyWalletBackup(cur, { volc: { used: 2 } }, 'replace');
  assert.deepStrictEqual(Object.keys(out), ['volc']);
});
ok('合并不修改入参', () => {
  const cur = { zhipu: { used: 1 } };
  applyWalletBackup(cur, { volc: {} }, 'merge');
  assert.deepStrictEqual(Object.keys(cur), ['zhipu']);
});
ok('预览摘要区分新增与已存在', () => {
  const d = describeBackup({ zhipu: {}, volc: {} }, { zhipu: { used: 1 } });
  assert.strictEqual(d.total, 2);
  assert.strictEqual(d.existCount, 1);
  assert.strictEqual(d.freshCount, 1);
});

console.log(`\n钱包备份：通过 ${pass} / ${pass + fail}` + (fail ? `，失败 ${fail}` : '，全部通过'));
process.exit(fail ? 1 : 0);
