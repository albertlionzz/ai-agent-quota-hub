/* 全局跳转面板单测：加载真实 palette.js，用桩数据替代浏览器环境 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const D = p => fs.readFileSync(path.join(__dirname, 'assets', p), 'utf8');

/* ---- 真实数据层 ---- */
const dataCtx = {};
new Function('exports', D('data.js') +
  '\n;Object.assign(exports,{PLATFORMS,QUOTA_TYPES,TASK_TAGS});')(dataCtx);
const { PLATFORMS, QUOTA_TYPES, TASK_TAGS } = dataCtx;

/* ---- 真实厂商表与模型表 ---- */
const vCtx = {};
new Function('exports', D('verify.js').match(/const VENDOR_ACCESS = (\[[\s\S]*?\n\]);/)[0] +
  '\n;Object.assign(exports,{VENDOR_ACCESS});')(vCtx);
const capCtx = {};
new Function('exports', D('capability.js').match(/const MODELS = (\[[\s\S]*?\n\];)/)[0] +
  '\n;Object.assign(exports,{MODELS});')(capCtx);

/* ---- 加载 palette.js（它只声明函数，不执行 DOM 操作） ---- */
const box = {};
const VIEWS = {
  overview: { title: '总览', sub: '免费额度全景与关键判断' },
  registry: { title: '平台库', sub: '按形态、区域、类型筛选' },
  verify: { title: '接入核验', sub: '主流模型的端点、密钥、model id' },
  capability: { title: '能力画像', sub: '12 模型 × 9 维' }
};
new Function('VIEWS', 'PLATFORMS', 'QUOTA_TYPES', 'TASK_TAGS',
  'VENDOR_ACCESS', 'MODELS', 'esc', 'box',
  D('palette.js') + '\n;Object.assign(box,{cmScore,cmBuildIndex,cmRank});'
)(VIEWS, PLATFORMS, QUOTA_TYPES, TASK_TAGS, vCtx.VENDOR_ACCESS, capCtx.MODELS,
  s => String(s == null ? '' : s), box);

const { cmBuildIndex, cmRank } = box;
const IDX = cmBuildIndex();

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}
function flatten(groups) { return groups.flatMap(g => g.items); }

/* ---------- 索引 ---------- */
ok('索引包含四类条目且数量正确', () => {
  const by = {};
  IDX.forEach(i => by[i.kind] = (by[i.kind] || 0) + 1);
  assert.strictEqual(by.view, 4, '视图数');
  assert.strictEqual(by.platform, PLATFORMS.length, '平台数');
  assert.strictEqual(by.vendor, vCtx.VENDOR_ACCESS.length, '厂商数');
  assert.strictEqual(by.model, capCtx.MODELS.length, '模型数');
});
ok('每条目都有 hay 且为小写', () => {
  IDX.forEach(i => {
    assert.ok(i.hay && i.hay.length > 0, i.title + ' 缺 hay');
    assert.strictEqual(i.hay, i.hay.toLowerCase());
  });
});

/* ---------- 假阳性回归：这是改之前真实存在的 bug ---------- */
ok('kimi 不会把 DeepSeek 拖出来（子序列跨字段假阳性）', () => {
  const titles = flatten(cmRank(IDX, 'kimi')).map(i => i.title);
  assert.ok(titles.some(t => /kimi/i.test(t)), '应命中 Kimi 相关条目');
  assert.ok(!titles.some(t => /deepseek/i.test(t)), 'DeepSeek 不该出现：' + titles.join(','));
  assert.ok(!titles.some(t => /minimax/i.test(t)), 'MiniMax 不该出现');
});
ok('kimi 结果全部与 kimi 沾边', () => {
  flatten(cmRank(IDX, 'kimi')).forEach(i => {
    assert.ok(/kimi/i.test(i.title) || /kimi/i.test(i.hay), i.title + ' 属于误命中');
  });
});

/* ---------- 排序 ---------- */
ok('前缀命中排在前面', () => {
  const g = flatten(cmRank(IDX, 'kimi'));
  assert.ok(/^kimi/i.test(g[0].title), '首位应为 Kimi 开头，实际 ' + g[0].title);
});
ok('视图名精确命中排第一', () => {
  const g = flatten(cmRank(IDX, '接入核验'));
  assert.strictEqual(g[0].title, '接入核验');
  assert.strictEqual(g[0].kind, 'view');
});
ok('中文可搜视图', () => {
  const g = flatten(cmRank(IDX, '能力'));
  assert.ok(g.some(i => i.title === '能力画像'));
});
ok('model id 可搜', () => {
  const g = flatten(cmRank(IDX, 'k3'));
  assert.ok(g.some(i => i.kind === 'model' && /K3/i.test(i.title)), '应命中 Kimi K3');
});
ok('厂商域名可搜', () => {
  const g = flatten(cmRank(IDX, 'api.moonshot'));
  assert.ok(g.some(i => i.kind === 'vendor' && /Kimi/i.test(i.title)));
});

/* ---------- 边界 ---------- */
ok('空查询只给视图+平台，不铺厂商', () => {
  const groups = cmRank(IDX, '');
  assert.deepStrictEqual(groups.map(g => g.kind), ['view', 'platform']);
  assert.ok(groups[1].items.length <= 10, '平台最多 10 条');
});
ok('无匹配返回空数组', () => {
  assert.deepStrictEqual(cmRank(IDX, 'zzzzqq'), []);
});
ok('结果上限 40 条', () => {
  assert.ok(flatten(cmRank(IDX, 'a')).length <= 40);
});
ok('分组顺序固定', () => {
  const order = cmRank(IDX, 'a').map(g => g.kind);
  const rank = { view: 0, platform: 1, vendor: 2, model: 3 };
  for (let i = 1; i < order.length; i++) {
    assert.ok(rank[order[i - 1]] < rank[order[i]], '分组顺序乱了：' + order.join(','));
  }
});
ok('大小写不敏感', () => {
  const a = flatten(cmRank(IDX, 'kimi')).map(i => i.title).join('|');
  const b = flatten(cmRank(IDX, 'KIMI')).map(i => i.title).join('|');
  assert.strictEqual(a, b);
});

console.log(`\n全局跳转：通过 ${pass} / ${pass + fail}` + (fail ? `，失败 ${fail}` : '，全部通过'));
process.exit(fail ? 1 : 0);
