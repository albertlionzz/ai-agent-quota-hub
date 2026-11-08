#!/usr/bin/env node
/* ============================================================
   交叉校验结论 ↔ 平台库 confidence 一致性门禁
   ------------------------------------------------------------
   两份数据各管一件事，但会互相打脸：
     - CROSSCHECK  三方比对「有没有免费层」得出的定论
     - PLATFORMS   confidence 人工标注「这条额度数字有多可信」

   规则只卡一条硬逻辑：三方比对已经出现定论互斥（conflict），
   或外部与本项目都没定论（gap / unknown）时，平台库不能标
   verified（其定义是「多来源一致 / 官方页面明确」）——那是自相矛盾。

   不自动改写 data.js：confidence 是人工判断，脚本只报告漂移，
   --check 让 CI 红，由人去裁定。agree / solo 不做约束，
   因为「存在性一致」与「限速数字有分歧」是两根不同的轴。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');
const { CROSSCHECK, ccVerdict } = require('./assets/crosscheck.js');

/* verdict -> 禁止的 confidence / 建议值 */
const CONFIDENCE_RULES = {
  conflict: { forbidden: ['verified'], preferred: 'disputed' },
  gap:      { forbidden: ['verified'], preferred: 'reported' },
  unknown:  { forbidden: ['verified'], preferred: 'reported' },
  agree:    { forbidden: [],           preferred: null },
  solo:     { forbidden: [],           preferred: null }
};

function loadPlatforms() {
  const src = fs.readFileSync(path.join(ASSETS, 'data.js'), 'utf8');
  const bag = {};
  // data.js 是浏览器脚本（const 声明），用 Function 包一层把 PLATFORMS 取出来。
  new Function('exports', src + '\n;Object.assign(exports,{PLATFORMS});')(bag);
  return bag.PLATFORMS;
}

/* 纯函数，单测可直接喂假数据 */
function confidenceRows(platforms, rows) {
  const byId = new Map(platforms.map(p => [p.id, p]));
  return rows.map(c => {
    const verdict = ccVerdict(c).key;
    const p = byId.get(c.id);
    const rule = CONFIDENCE_RULES[verdict] || { forbidden: [], preferred: null };
    const confidence = p ? (p.confidence || null) : null;
    const mapped = !!p;
    const drift = mapped && rule.forbidden.includes(confidence);
    return {
      id: c.id,
      name: c.name,
      verdict,
      mapped,
      confidence,
      forbidden: rule.forbidden.slice(),
      preferred: rule.preferred,
      drift,
      suggestion: drift ? 'confidence: ' + confidence + ' -> ' + rule.preferred : null
    };
  });
}

function report(rows) {
  const mapped = rows.filter(r => r.mapped);
  const drifts = rows.filter(r => r.drift);
  return {
    schema: 1,
    total: rows.length,
    mapped: mapped.length,
    unmapped: rows.filter(r => !r.mapped).map(r => r.id),
    driftCount: drifts.length,
    drifts: drifts.map(r => ({ id: r.id, verdict: r.verdict, confidence: r.confidence, suggestion: r.suggestion })),
    rows
  };
}

function main(argv) {
  const check = argv.includes('--check');
  const jsonOut = argv.includes('--json');
  const outIdx = argv.indexOf('--out');
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;
  if (outIdx >= 0 && !outPath) {
    console.error('--out 需要一个路径');
    return 2;
  }

  const rep = report(confidenceRows(loadPlatforms(), CROSSCHECK));

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(rep, null, 2) + '\n', 'utf8');
  }
  if (jsonOut) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    console.log('交叉校验 ↔ 平台库 confidence：%d 家比对，%d 家可映射，%d 处漂移',
      rep.total, rep.mapped, rep.driftCount);
    if (rep.unmapped.length) console.log('  未映射（正常，非官方 API 轴）：' + rep.unmapped.join(', '));
    rep.drifts.forEach(d => console.log('  ✗ ' + d.id + ' [' + d.verdict + '] ' + d.suggestion));
    if (!rep.driftCount) console.log('  无漂移');
  }
  return check && rep.driftCount ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { CONFIDENCE_RULES, loadPlatforms, confidenceRows, report, main };
