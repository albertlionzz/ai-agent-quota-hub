/* ============================================================
   模型能力画像（Capability Matrix）
   ------------------------------------------------------------
   解决的问题：「按擅长方面分配任务」这句话是空的，
   除非能回答「凭什么说它擅长」。
   所以这里的每个维度得分都挂着原始评测数字与来源，
   并且对来源本身分级——不同来源的可信度差得很远。
   数据截止：2026-10-20
   ============================================================ */

/* 能力维度 */
const CAP_DIMS = {
  reason:   { label: '逻辑推理', short: '推理' },
  code:     { label: '代码工程', short: '代码' },
  zh:       { label: '中文写作', short: '中文' },
  long:     { label: '长文/上下文', short: '长文' },
  fact:     { label: '事实准确', short: '抗幻觉' },
  instruct: { label: '指令遵循', short: '遵循' },
  math:     { label: '数学计算', short: '数学' },
  plan:     { label: '任务规划', short: '规划' },
  speed:    { label: '响应速度', short: '速度' }
};
const CAP_KEYS = Object.keys(CAP_DIMS);

/* 评测来源可信度分级 —— 这个分级比分数本身更重要 */
const SRC_TRUST = {
  arena:     { label: 'LMArena 盲测', trust: 'high', weight: 1.0,
               desc: '人类匿名 A/B 投票 Elo。相对排名最可信，但偏「人喜欢哪个」，不测事实准确性。' },
  superclue: { label: 'SuperCLUE', trust: 'high', weight: 1.0,
               desc: '中文权威综合基准，含独立的「幻觉控制」「精确指令遵循」分项，中文场景首选。' },
  bench:     { label: '标准 Benchmark', trust: 'high', weight: 0.9,
               desc: 'SWE-bench Verified / GPQA / AIME 等。测单项硬能力，但容易被针对性刷分。' },
  field:     { label: '社区实测', trust: 'mid', weight: 0.6,
               desc: '开发者或自媒体实测，样本小、口径不统一，只做佐证。' },
  vendor:    { label: '官方自述', trust: 'low', weight: 0.3,
               desc: '厂商自己发布，通常挑对自己有利的口径。' },
  infer:     { label: '推断', trust: 'low', weight: 0.2,
               desc: '本站依据同系列或同量级模型推算，无直接数据。最不可信，仅用于填空。' }
};

/* ------------------------------------------------------------
   模型画像
   score：0~100 归一化（不是原始分，原始分写在 evid 里）
   freeVia：能通过哪些「免费额度平台」拿到（指向 PLATFORMS.id）
   ------------------------------------------------------------ */
const MODELS = [
  {
    id: 'kimi-k3', name: 'Kimi K3', vendor: '月之暗面', params: '2.8T', ctx: '1M',
    score: { reason: 91, code: 93, zh: 84, long: 95, fact: 84, instruct: 82, math: 84, plan: 88, speed: 68 },
    evid: [
      { dim: 'code', src: 'arena', raw: 'Coding Arena 1682 · 开源第一 / 全场第 2（仅次于 Claude Opus 5 的 1712）' },
      { dim: 'reason', src: 'arena', raw: 'Text Arena 1487 ± 5（32,795 票）' },
      { dim: 'fact', src: 'superclue', raw: 'SuperCLUE 幻觉控制 83.85' },
      { dim: 'plan', src: 'superclue', raw: 'SuperCLUE 智能体任务规划 84.35 · 总分 70.68（国产第 3）' },
      { dim: 'long', src: 'vendor', raw: '官方标称 1M 上下文；自带前缀缓存，长文档省输入成本' },
      { dim: 'code', src: 'bench', raw: 'Agentic Coding 75.79' }
    ],
    freeVia: ['sensenova', 'modelscope'],
    note: '免费额度里能拿到的最强综合模型。2.8T 参数 + 1M 上下文 + 原生多模态，做总控（Chief）最合适——任务规划强、看得住全局。'
  },
  {
    id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vendor: '深度求索', params: '未公开', ctx: '1M',
    score: { reason: 88, code: 84, zh: 80, long: 88, fact: 95, instruct: 86, math: 86, plan: 79, speed: 66 },
    evid: [
      { dim: 'fact', src: 'superclue', raw: 'SuperCLUE 幻觉控制 89.73 —— 参测国产模型里最高' },
      { dim: 'code', src: 'bench', raw: 'SWE-bench Verified 80.60 · 国产第一' },
      { dim: 'math', src: 'superclue', raw: '数学推理 77.19' },
      { dim: 'instruct', src: 'superclue', raw: '精确指令遵循 42.86' },
      { dim: 'reason', src: 'arena', raw: 'Text Arena 1462（DeepSeek V4 Pro 条目）' }
    ],
    freeVia: ['sensenova'],
    note: '抗幻觉 89.73 是全场最高。做一致性审查（Reviewer）和事实核查的不二人选——它最不容易顺着前文编。'
  },
  {
    id: 'deepseek-v41-flash', name: 'DeepSeek V4.1 Flash', vendor: '深度求索', params: '蒸馏', ctx: '1M',
    score: { reason: 86, code: 87, zh: 83, long: 82, fact: 87, instruct: 80, math: 90, plan: 80, speed: 88 },
    evid: [
      { dim: 'math', src: 'superclue', raw: '数学推理 84.21 —— 参测模型最高' },
      { dim: 'fact', src: 'superclue', raw: '幻觉控制 87.16' },
      { dim: 'code', src: 'superclue', raw: 'Agentic Coding 71.58' },
      { dim: 'zh', src: 'superclue', raw: 'SuperCLUE 总分 71.81 —— 开源阵营第一' }
    ],
    freeVia: ['sensenova', 'modelscope', 'amd-radeon'],
    note: '数学 84.21 与总分 71.81 都是开源第一。蒸馏版里文字能力最强，速度又快，适合当高频 Worker。'
  },
  {
    id: 'glm-52', name: 'GLM-5.2', vendor: '智谱 AI', params: '开源 MIT', ctx: '1M',
    score: { reason: 82, code: 90, zh: 80, long: 86, fact: 81, instruct: 78, math: 78, plan: 72, speed: 95 },
    evid: [
      { dim: 'code', src: 'arena', raw: 'Coding Arena 1593 · 开源第 2（在 Kimi K3 之后）' },
      { dim: 'speed', src: 'field', raw: '第三方实测生成速度约 168 tok/s，三款旗舰里最快' },
      { dim: 'fact', src: 'superclue', raw: 'SuperCLUE 幻觉控制 80.66 · 总分 63.27' },
      { dim: 'code', src: 'superclue', raw: 'Agentic Coding 64.13' },
      { dim: 'plan', src: 'superclue', raw: '智能体任务规划 65.27 —— 明显弱于 GLM-5.3 的 91.15' }
    ],
    freeVia: ['sensenova', 'together', 'modelscope'],
    note: '速度是最大优势（~168 tok/s），长程 Coding 手感「跟手」。但规划能力 65.27 明显弱——别让它当总控，适合当执行代码的 Worker。'
  },
  {
    id: 'glm-53', name: 'GLM-5.3', vendor: '智谱 AI', params: '开源', ctx: '1M',
    score: { reason: 90, code: 94, zh: 87, long: 90, fact: 79, instruct: 84, math: 80, plan: 96, speed: 80 },
    evid: [
      { dim: 'plan', src: 'superclue', raw: '智能体任务规划 91.15 —— 参测模型最高' },
      { dim: 'code', src: 'superclue', raw: 'Agentic Coding 76.84 —— 参测模型最高' },
      { dim: 'zh', src: 'superclue', raw: 'SuperCLUE 总分 71.29（国内第 3）' },
      { dim: 'reason', src: 'bench', raw: 'Terminal-Bench 3.0 得分 28.3，而 GLM-5.2 仅 4.6 —— 长程推理跃升最大' },
      { dim: 'fact', src: 'superclue', raw: '幻觉控制 79.35 —— 是它的短板，比自家 5.2 还低' }
    ],
    freeVia: [],
    note: '规划 91.15 与编程 76.84 双第一，理论上是最理想的 Chief。但目前没有稳定的免费 API 入口，只能走付费或等待上架——这里列出作为对照基准。'
  },
  {
    id: 'qwen38-max', name: 'Qwen3.8 Max', vendor: '阿里巴巴', params: '闭源', ctx: '1M',
    score: { reason: 92, code: 86, zh: 95, long: 88, fact: 86, instruct: 96, math: 88, plan: 92, speed: 74 },
    evid: [
      { dim: 'zh', src: 'superclue', raw: 'SuperCLUE 总分 72.62 —— 参测模型第一；LMArena 中文榜 Elo 1538±18，全球第 12 / 国产第一' },
      { dim: 'instruct', src: 'superclue', raw: '精确指令遵循 43.81 —— 参测模型最高' },
      { dim: 'fact', src: 'superclue', raw: '幻觉控制 86.19' },
      { dim: 'plan', src: 'superclue', raw: '智能体任务规划 89.53' },
      { dim: 'reason', src: 'bench', raw: 'GPQA Diamond 92.6 · PaperBench 93.0（第三方引用）' }
    ],
    freeVia: ['bailian'],
    note: '中文写作与指令遵循双第一。做汇总成稿（Synthesizer）最合适——它能严格按格式输出，不会自作主张改结构。百炼礼包可拿。'
  },
  {
    id: 'doubao-seed21', name: 'Doubao-Seed-2.1-pro', vendor: '字节跳动', params: '闭源', ctx: '256K',
    score: { reason: 82, code: 74, zh: 88, long: 78, fact: 79, instruct: 86, math: 84, plan: 85, speed: 90 },
    evid: [
      { dim: 'zh', src: 'superclue', raw: 'SuperCLUE 科学推理 77.19；总分 65.94' },
      { dim: 'instruct', src: 'superclue', raw: '精确指令遵循 42.86' },
      { dim: 'fact', src: 'superclue', raw: '幻觉控制 78.85' },
      { dim: 'math', src: 'superclue', raw: '数学推理 75.44' }
    ],
    freeVia: ['volc'],
    note: '火山方舟每日 200 万自动刷新，是容量最大的免费档。能力在中间档，适合跑量大的常规阶段。'
  },
  {
    id: 'ernie-51', name: 'ERNIE 5.1', vendor: '百度', params: '闭源', ctx: '128K',
    score: { reason: 74, code: 62, zh: 82, long: 72, fact: 83, instruct: 84, math: 74, plan: 72, speed: 88 },
    evid: [
      { dim: 'fact', src: 'superclue', raw: '幻觉控制 83.02' },
      { dim: 'instruct', src: 'superclue', raw: '精确指令遵循 41.90' },
      { dim: 'zh', src: 'superclue', raw: 'SuperCLUE 总分 54.56' },
      { dim: 'code', src: 'superclue', raw: 'Agentic Coding 27.37 —— 明显短板' }
    ],
    freeVia: ['qianfan'],
    note: '抗幻觉 83.02 不错，但编程 27.37 是硬伤。千帆免费档并发 50 QPS 国内最高，适合批量文本处理而非代码。'
  },
  {
    id: 'hy3', name: '混元 Hy3', vendor: '腾讯', params: '开源', ctx: '256K',
    score: { reason: 80, code: 62, zh: 80, long: 76, fact: 79, instruct: 70, math: 82, plan: 67, speed: 84 },
    evid: [
      { dim: 'math', src: 'superclue', raw: '数学推理 77.19' },
      { dim: 'fact', src: 'superclue', raw: '幻觉控制 79.20' },
      { dim: 'zh', src: 'superclue', raw: 'SuperCLUE 总分 62.13' },
      { dim: 'code', src: 'superclue', raw: 'Agentic Coding 47.37' }
    ],
    freeVia: ['hunyuan'],
    note: '腾讯生态内可用，数学推理不错。作为国内备选通道。'
  },
  {
    id: 'gemini-flash', name: 'Gemini 3.8 Flash', vendor: 'Google', params: '闭源', ctx: '1M',
    score: { reason: 88, code: 84, zh: 76, long: 92, fact: 80, instruct: 84, math: 82, plan: 84, speed: 92 },
    evid: [
      { dim: 'reason', src: 'arena', raw: 'Text Arena 1496 ± 5（37,454 票）—— 免费档里最高' },
      { dim: 'long', src: 'arena', raw: 'Gemini 3 Pro 1485；Flash 系同为 1M 上下文' },
      { dim: 'speed', src: 'field', raw: 'Flash 系主打低延迟' }
    ],
    freeVia: ['gemini', 'openrouter'],
    note: '免费层能拿到的最强海外模型（Pro 系列已于 2026-04-01 移出免费档）。1M 上下文 + 1496 Elo，长文档精读首选。注意 250 RPD 硬顶。'
  },
  {
    id: 'claude-opus55', name: 'Claude Opus 5.5', vendor: 'Anthropic', params: '闭源', ctx: '1M',
    score: { reason: 96, code: 98, zh: 82, long: 92, fact: 92, instruct: 94, math: 90, plan: 95, speed: 70 },
    evid: [
      { dim: 'code', src: 'arena', raw: 'Coding Arena 1712（Claude Opus 5）· 全场第一；SWE-bench Verified 96.00' },
      { dim: 'reason', src: 'arena', raw: 'Text Arena 1508 ± 7' },
      { dim: 'plan', src: 'bench', raw: 'Design Arena 1391 · 第一' }
    ],
    freeVia: [],
    note: '全场最强基准（编程 1712 / SWE 96.00 / 文本 1508）。但没有任何免费 API 入口——列在这里是作为「能力天花板」参照，用来判断免费模型差多远。'
  },
  {
    id: 'ernie-speed', name: 'ERNIE-Speed', vendor: '百度', params: '轻量', ctx: '8K',
    score: { reason: 58, code: 42, zh: 70, long: 45, fact: 66, instruct: 72, math: 50, plan: 50, speed: 98 },
    evid: [
      { dim: 'speed', src: 'vendor', raw: '千帆免费档并发最高 50 QPS' },
      { dim: 'reason', src: 'infer', raw: '轻量模型，能力偏基础，无公开基准数据' }
    ],
    freeVia: ['qianfan'],
    note: '能力弱但并发 50 QPS 国内最高。只适合「几千条同格式文本的批量清洗」这类不在乎质量只在乎吞吐的活。'
  }
];

/* 免费额度平台 → 该平台上能拿到的最佳模型（取画像里最强的） */
function modelsOnPlatform(pid) {
  return MODELS
    .filter(m => m.freeVia.includes(pid))
    .sort((a, b) => avgScore(b) - avgScore(a));
}
function avgScore(m) {
  const v = CAP_KEYS.map(k => m.score[k] || 0);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/* ============================================================
   角色定义：总控调度舱的四个角色
   ============================================================ */
const ROLES = {
  chief: {
    key: 'chief', label: '总控 Chief', icon: '◎',
    desc: '分解任务、分配、审查一致性、督促进度、终审核对。整个流程唯一持有全局状态的角色。',
    need: { plan: 0.26, reason: 0.22, long: 0.18, instruct: 0.18, fact: 0.10, zh: 0.06 },
    why: '总控最怕两件事：拆错任务（规划弱）和看不住全局（上下文短）。指令遵循差会导致输出格式漂移，后面的自动解析全崩。',
    minScore: 80
  },
  worker: {
    key: 'worker', label: '执行 Worker', icon: '▸',
    desc: '按分派的子任务单条执行，只回传结构化回执，不自行扩展范围。',
    need: null, /* 由子任务的 task 标签动态决定 */
    why: '按任务类型匹配能力维度，不追求全能。'
  },
  reviewer: {
    key: 'reviewer', label: '审查 Reviewer', icon: '⌗',
    desc: '独立于执行者，检查数字冲突、术语冲突、结论冲突、范围越界。',
    need: { fact: 0.40, reason: 0.24, instruct: 0.20, math: 0.16 },
    why: '审查的核心能力是「不顺着前文编」。抗幻觉分数是硬指标，比推理分更重要。',
    minScore: 78,
    mustDifferFrom: 'worker' /* 必须与执行者不同模型，否则等于自我审查 */
  },
  synthesizer: {
    key: 'synthesizer', label: '汇总 Synthesizer', icon: '≡',
    desc: '把各子任务成果合并成一致的整体交付物，统一术语与口径。',
    need: { zh: 0.34, long: 0.24, instruct: 0.24, reason: 0.12, fact: 0.06 },
    why: '汇总最怕自由发挥。指令遵循与中文表达是第一位——它必须严格按既定结构填，不能自己改大纲。',
    minScore: 78
  }
};

/* 任务标签 → 能力权重（Worker 分配用） */
const TASK_NEED = {
  reasoning: { reason: 0.34, math: 0.22, fact: 0.20, instruct: 0.14, plan: 0.10 },
  code:      { code: 0.44, reason: 0.22, instruct: 0.18, plan: 0.10, long: 0.06 },
  'long-text': { zh: 0.34, long: 0.28, instruct: 0.22, reason: 0.10, fact: 0.06 },
  writing:   { zh: 0.42, instruct: 0.24, reason: 0.18, fact: 0.10, long: 0.06 },
  research:  { fact: 0.34, reason: 0.24, long: 0.22, instruct: 0.12, zh: 0.08 },
  batch:     { speed: 0.40, instruct: 0.28, zh: 0.16, fact: 0.10, code: 0.06 },
  chat:      { zh: 0.34, speed: 0.26, reason: 0.20, instruct: 0.12, fact: 0.08 },
  agent:     { plan: 0.34, instruct: 0.24, code: 0.20, reason: 0.14, long: 0.08 },
  vision:    { long: 0.30, reason: 0.26, instruct: 0.24, fact: 0.12, zh: 0.08 },
  image:     { instruct: 0.40, zh: 0.24, reason: 0.20, speed: 0.16 },
  video:     { instruct: 0.38, zh: 0.24, reason: 0.22, speed: 0.16 },
  realtime:  { speed: 0.52, instruct: 0.22, reason: 0.16, zh: 0.10 }
};

/* 角色/任务 → 加权能力分 */
function capFit(model, need) {
  let s = 0, w = 0;
  for (const [k, wt] of Object.entries(need)) {
    s += (model.score[k] || 0) * wt;
    w += wt;
  }
  return w ? s / w : 0;
}

/* ============================================================
   视图：能力画像
   注意：VIEWS 注册放在 orchestrator.js 里，因为 capability.js
   注入点在 VIEWS 声明之前，这里直接赋值会踩 TDZ。
   ============================================================ */
function renderCapability() {
  const rows = MODELS.slice().sort((a, b) => avgScore(b) - avgScore(a));
  const head = `<thead><tr>
    <th style="min-width:150px">模型</th>
    ${CAP_KEYS.map(k => `<th style="min-width:46px;text-align:center">${CAP_DIMS[k].short}</th>`).join('')}
    <th style="min-width:190px">免费额度入口</th>
  </tr></thead>`;

  const body = rows.map(m => {
    const best = Math.max(...CAP_KEYS.map(k => m.score[k] || 0));
    const worst = Math.min(...CAP_KEYS.map(k => m.score[k] || 0));
    const via = m.freeVia.length
      ? m.freeVia.map(pid => {
          const p = PLATFORMS.find(x => x.id === pid);
          return p ? `<span class="chip ${QUOTA_TYPES[p.quotaType].color}" style="font-size:9.5px;padding:1px 5px;margin:1px 2px 1px 0">${esc(p.name)}</span>` : '';
        }).join('')
      : '<span style="font-size:10.5px;color:var(--ink-3)">无免费入口</span>';

    const evid = m.evid.map(e =>
      `<div class="ev"><span class="ev-dim">${CAP_DIMS[e.dim].short}</span>
       <span class="ev-src ${SRC_TRUST[e.src].trust}">${SRC_TRUST[e.src].label}</span>
       <span class="ev-raw">${esc(e.raw)}</span></div>`).join('');

    return `<tr data-model="${esc(m.id)}">
      <td>
        <div class="cap-name">${esc(m.name)}</div>
        <div class="cap-vendor">${esc(m.vendor)} · ${esc(m.params)} · ${esc(m.ctx)}</div>
        <details class="cap-ev"><summary>依据 ${m.evid.length} 条</summary>${evid}
          <div class="cap-note">${esc(m.note)}</div>
        </details>
      </td>
      ${CAP_KEYS.map(k => {
        const v = m.score[k] || 0;
        const cls = v >= 90 ? 'v-hi' : (v >= 80 ? 'v-mid' : (v >= 70 ? 'v-ok' : 'v-lo'));
        const mark = (v === best && best >= 85) ? ' cap-best' : '';
        return `<td class="cap-cell ${cls}${mark}">${v}</td>`;
      }).join('')}
      <td>${via}</td>
    </tr>`;
  }).join('');

  $('#cap-table').innerHTML = head + `<tbody>${body}</tbody>`;

  $('#cap-src').innerHTML = Object.entries(SRC_TRUST).map(([k, v]) => `
    <div class="src-row">
      <span class="src-tag ${v.trust}">${v.trust === 'high' ? '高' : (v.trust === 'mid' ? '中' : '低')}</span>
      <div>
        <div class="src-label">${esc(v.label)}</div>
        <div class="src-desc">${esc(v.desc)}</div>
      </div>
    </div>`).join('');

  $('#cap-role').innerHTML = Object.values(ROLES).filter(r => r.need).map(r => {
    const w = Object.entries(r.need).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="rw"><b>${CAP_DIMS[k].label}</b> ${Math.round(v * 100)}%</span>`).join('');
    return `<div class="cap-role-row">
      <div class="cap-role-head"><span class="rc-icon">${r.icon}</span> ${esc(r.label)}
        <span class="cap-role-min">最低门槛 ${r.minScore}</span></div>
      <div class="cap-role-weights">${w}</div>
      <div class="cap-role-why">${esc(r.why)}</div>
    </div>`;
  }).join('');
}
