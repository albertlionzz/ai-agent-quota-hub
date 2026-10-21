/* ============================================================
   总控调度舱（Chief Orchestrator）
   ------------------------------------------------------------
   与「项目编排」的区别：
     项目编排 = 静态流水线，阶段串行，交接卡单向传递。
     总控调度舱 = 带闭环的调度：Chief 始终持有全局状态，
     每个 Worker 完成后回传回执，Chief 更新状态卡 → 查一致性
     → 分派下一批 / 要求返工 / 升级裁决；全部完成后与总目标核对。
   三个不可省略的部件：
     1) 项目状态卡 —— 全局唯一真相源，每次循环都重写一遍
     2) 回执卡     —— Worker 只回结构化结果，不回全文
     3) 冲突登记册 —— 一致性检查的产物，不做「感觉不对」的判断
   ============================================================ */

/* ---------- 状态卡 ---------- */
const STATE_CARD_SPEC = `
【输出固定为一张项目状态卡，不要写正文】
[状态卡 v{n}]
GOAL ｜总体目的：<一句话，每次循环原样复述，不得改写>
LOCKED ｜已锁定结论：<最多 8 条，每条一行「结论（关键数字）— 来自哪个任务」；一旦锁定，后续任何阶段不得推翻，只能标注质疑>
DOING ｜进行中：<任务ID ｜ 负责模型 ｜ 状态（待执行/执行中/已回执/返工中）>
DONE ｜已完成：<任务ID ｜ 一句话成果>
CONFLICT ｜冲突登记：<类型（数字/术语/结论/范围/假设）｜ 具体描述 ｜ 处置（已裁决/待裁决/已升级）>
PENDING ｜待办队列：<按依赖顺序排列，标注每个的前置任务>
BLOCKED ｜需人工：<阻塞项与原因>
NEXT ｜本轮动作：<一次性最多派 3 个任务，写清每个的验收标准>

规则：
1. LOCKED 里的结论后续只能被质疑，不能被静默修改——要改必须走 CONFLICT 登记；
2. NEXT 派单时必须写验收标准，否则无法判定回执是否合格；
3. 状态卡之外的一切过程推理都留在本次会话，不进卡片。`;

/* ---------- 回执卡 ---------- */
const RECEIPT_SPEC = `
【正文写完后，另起一行输出回执卡，不超过 250 字】
[回执]
任务ID：
结论：<最多 5 条，每条一行，必须带关键数字>
关键数字：<指标名=数值=口径=来源，每行一条>
新增术语：<术语=本项目内的定义，每行一条；没有就写「无」>
与已锁定结论的冲突：<有则写「指标 + 两个值 + 各来自哪个任务」；无则写「无」>
未解决：<需要上级裁决或需要人工介入的项；无则写「无」>

规则：
1. 回执之外不写过程、不写备选方案、不复述上游内容；
2. 关键数字必须带口径——没有口径的数字下一阶段无法判断能否相加；
3. 发现自己与 LOCKED 冲突时，必须写进回执，不许自行「悄悄对齐」。`;

/* ---------- 一致性检查：五类冲突 ---------- */
const CONSISTENCY_CHECKS = [
  {
    id: 'num', label: '数字冲突', auto: true,
    detect: '同一指标在不同回执里出现两个不同数值',
    method: '脚本提取回执里的「指标名=数值=口径」，按指标名分组；同组内若口径相同而数值不同 → 冲突。',
    action: '交 Reviewer 裁决：采信口径更严的那个，另一个保留为「区间上/下限」并登记。',
    severity: 'high'
  },
  {
    id: 'term', label: '术语冲突', auto: true,
    detect: '同一术语在两个回执里定义不同，或同一概念用了两个名字',
    method: '提取各回执的「新增术语」段，按术语名比对定义文本；同名不同义 → 冲突。',
    action: 'Chief 统一为一张术语表，回写进状态卡 LOCKED，后续阶段强制引用。',
    severity: 'mid'
  },
  {
    id: 'claim', label: '结论冲突', auto: false,
    detect: '两个结论互斥（如一个说产能过剩、一个说供不应求）',
    method: '无法正则化，由 Reviewer 读两张回执的「结论」段做互斥判断。',
    action: '触发一次定向对抗：让第三个模型只针对这一条写反驳，Chief 据其裁决。',
    severity: 'high'
  },
  {
    id: 'scope', label: '范围越界', auto: true,
    detect: '产出包含任务单里没要求的内容，或超出边界声明',
    method: '比对回执条目数与任务单的验收标准条目数；超出 50% 判定越界。',
    action: '越界部分不进 LOCKED，标记为「冗余产出」；若连续两次越界，缩短该模型的任务粒度。',
    severity: 'low'
  },
  {
    id: 'assume', label: '假设冲突', auto: false,
    detect: '两个阶段的推理建立在互相矛盾的前提上',
    method: 'Reviewer 检查各回执隐含前提（增长率、政策延续、汇率等）是否一致。',
    action: '把冲突前提写进状态卡 CONFLICT，并在终审时作为「结论失效条件」列出。',
    severity: 'high'
  }
];

/* ---------- 经验库（Playbook）：三层 ---------- */
const PLAYBOOK_KINDS = {
  flow: { label: '流程优化', color: 'blue',  desc: '任务怎么拆、顺序怎么排、粒度多大' },
  mech: { label: '机制优化', color: 'purple', desc: '状态卡/回执/裁决这类规则本身的改进' },
  tech: { label: '技术优化', color: 'green',  desc: '哪个平台组合最稳、哪个模型在哪类任务翻过车' }
};

/* 内置经验：一部分来自本次调研与设计，一部分是这类流程的通用教训。
   hit 字段记录命中次数，运行时按相似度排序呈现。 */
const DEFAULT_PLAYBOOK = [
  {
    id: 'pb-flow-01', kind: 'flow', hit: 0,
    trigger: ['长文', '报告', '综述', '成稿'],
    lesson: '成稿阶段把前面所有阶段的全文带进去，单次输入会到 3 万+ token，一天额度一次就烧穿。',
    action: '成稿只给交接卡 + 各阶段结论条目，不给正文。需要引用原文时让成稿阶段自己重写，而不是粘贴。',
    gain: '输入侧降约 3.4 倍'
  },
  {
    id: 'pb-flow-02', kind: 'flow', hit: 0,
    trigger: ['对抗', '复核', '审查', 'debate'],
    lesson: '让同一个模型顺着自己的上一轮继续写反方观点，它几乎不会真正反驳自己，只会写一份「平衡表述」。',
    action: '对抗与复核阶段必须换模型，且要求它只攻击、不许做平衡表述。',
    gain: '反驳有效率显著提升'
  },
  {
    id: 'pb-mech-01', kind: 'mech', hit: 0,
    trigger: ['一致性', '冲突', '汇总'],
    lesson: '只说「保持一致性」，模型不知道该查什么，会回一句「已保持一致」就交差。',
    action: '一致性检查必须落到可判定的五类：数字/术语/结论/范围/假设，每类给出判定方法与处置动作。',
    gain: '从不可验证变成可验收'
  },
  {
    id: 'pb-mech-02', kind: 'mech', hit: 0,
    trigger: ['锁定', 'LOCKED', '状态卡'],
    lesson: '后续阶段会「悄悄」把上游结论改掉，因为它在自己的上下文里觉得那样更顺。',
    action: '已锁定结论只能被质疑、不能被修改——修改必须走冲突登记，由 Chief 显式裁决。',
    gain: '杜绝静默漂移'
  },
  {
    id: 'pb-tech-01', kind: 'tech', hit: 0,
    trigger: ['联网', '检索', 'research'],
    lesson: '免费 API 普遍没有联网能力，把检索阶段交给自动化脚本会静默返回编造的「来源」。',
    action: '检索阶段强制标为「需人工」，在带联网的网页版跑完后把结果落盘，脚本再接着走。',
    gain: '避免整条流水线建立在假证据上'
  },
  {
    id: 'pb-tech-02', kind: 'tech', hit: 0,
    trigger: ['代码', 'code', '工程'],
    lesson: 'GLM-5.2 速度快但规划分只有 65.27，让它做长程多步工程会中途跑偏。',
    action: '长程工程交给规划分高的模型（Kimi K3 84.35 / GLM-5.3 91.15）；GLM-5.2 只接单文件、单函数的活。',
    gain: '减少返工轮次'
  },
  {
    id: 'pb-tech-03', kind: 'tech', hit: 0,
    trigger: ['事实', '核查', '数字', 'reviewer'],
    lesson: '用执行模型自己审查自己的数字，等于没审——它会认为自己上一轮是对的。',
    action: '审查角色强制与执行者不同模型，且优先选抗幻觉分高的（DeepSeek V4 Pro 89.73）。',
    gain: '数字错误检出率提升'
  },
  {
    id: 'pb-flow-03', kind: 'flow', hit: 0,
    trigger: ['并行', '批量', 'repeat'],
    lesson: '并行任务如果都压在同一个平台，会被 RPD / TPM 限流卡住，看上去是「并行」实际在排队。',
    action: '并行阶段强制分派到限制维度不同的平台（一个卡 RPD、一个卡 TPM、一个卡并发）。',
    gain: '总吞吐翻倍'
  }
];

const PB_STORE_KEY = 'quota-hub-playbook-v1';

function loadPlaybook() {
  try {
    const raw = localStorage.getItem(PB_STORE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) {}
  return DEFAULT_PLAYBOOK.slice();
}
function savePlaybook(list) {
  try { localStorage.setItem(PB_STORE_KEY, JSON.stringify(list)); } catch (e) {}
}

/* 相似度：命中 trigger 关键词的数量 */
function pbMatch(list, keywords) {
  const kw = (keywords || []).map(x => String(x).toLowerCase());
  return list
    .map(p => {
      let hit = 0;
      for (const t of (p.trigger || [])) {
        if (kw.some(k => k.includes(String(t).toLowerCase()) || String(t).toLowerCase().includes(k))) hit += 1;
      }
      return { p, hit };
    })
    .filter(x => x.hit > 0)
    .sort((a, b) => b.hit - a.hit);
}

/* ============================================================
   角色选模型
   ============================================================ */

/* 某模型在指定模式下可用的平台（返回最合适的一个） */
function platformForModel(m, mode, needTok) {
  const cands = [];
  for (const pid of m.freeVia) {
    const p = PLATFORMS.find(x => x.id === pid);
    if (!p) continue;
    if (mode === 'script' && !pipeScriptable(p)) continue;
    const cap = dailyCapacity(p, needTok || 2000, 1500).cap;
    if (cap <= 0) continue;
    cands.push({ p, cap, qt: QUOTA_TYPES[p.quotaType] });
  }
  if (!cands.length) return null;
  /* 优先可再生额度，其次容量大 */
  cands.sort((a, b) => (b.qt.weight - a.qt.weight) || (b.cap - a.cap));
  return cands[0];
}

/* 为角色挑模型：能力匹配优先，额度可用性兜底 */
function pickForRole(roleKey, mode, excludeModelIds, needTok) {
  const role = ROLES[roleKey];
  const ex = excludeModelIds || [];
  const list = MODELS
    .filter(m => !ex.includes(m.id))
    .map(m => {
      const fit = capFit(m, role.need);
      const pf = platformForModel(m, mode, needTok);
      return { m, fit, pf };
    })
    .filter(x => x.pf && x.fit >= (role.minScore || 0))
    .sort((a, b) => b.fit - a.fit);
  return list[0] || null;
}

/* 为 Worker 挑模型：按任务标签的能力权重 */
function pickForTask(task, mode, excludeModelIds, needTok) {
  const need = TASK_NEED[task] || TASK_NEED.chat;
  const ex = excludeModelIds || [];
  const list = MODELS
    .filter(m => !ex.includes(m.id))
    .map(m => {
      const fit = capFit(m, need);
      const pf = platformForModel(m, mode, needTok);
      return { m, fit, pf };
    })
    .filter(x => x.pf)
    .sort((a, b) => b.fit - a.fit);
  return list[0] || null;
}

/* ============================================================
   编排计划
   ============================================================ */
function planOrchestration(tplId, scaleKey, mode) {
  const tpl = PIPELINE_TEMPLATES.find(t => t.id === tplId) || PIPELINE_TEMPLATES[0];
  const mul = (SCALES[scaleKey] || SCALES.small).mul;

  /* 展开 repeat */
  const raw = [];
  tpl.stages.forEach(s => {
    const n = s.repeat || 1;
    for (let i = 1; i <= n; i++) {
      raw.push({ ...s, inst: n > 1 ? i : 0, instTotal: n, key: n > 1 ? `${s.key}-${i}` : s.key });
    }
  });

  /* ---- 1. 选 Chief ---- */
  const chiefPick = pickForRole('chief', mode, [], 4000)
    || pickForRole('chief', 'manual', [], 4000);

  /* ---- 2. 逐个阶段选 Worker ---- */
  const usedToday = {};
  const spentOnce = {};
  const stages = [];
  let day = 1;
  let infeasible = null;
  const modelUse = {};   /* 模型被用了几次，用于分散 */

  raw.forEach((st, idx) => {
    const isFirst = idx === 0;
    const cardIn = (st.card === false || isFirst) ? 0 : CARD_TOK;
    const inTok = Math.round(st.inBase * mul) + cardIn;
    const outTok = Math.round(st.outBase * mul);
    const s = { ...st, inTok, outTok, cardIn, total: inTok + outTok };

    /* 优先选没被反复使用的模型，避免全流水线依赖同一家 */
    const sortedCands = MODELS
      .map(m => {
        const fit = capFit(m, TASK_NEED[st.task] || TASK_NEED.chat);
        const pf = platformForModel(m, mode, s.total);
        if (!pf) return null;
        const used = pf.p.quotaType === 'gift' || pf.p.quotaType === 'trial'
          ? (spentOnce[pf.p.id] || 0) : (usedToday[pf.p.id] || 0);
        if (pf.cap - used < s.total) return null;
        const penalty = (modelUse[m.id] || 0) * 6;
        return { m, pf, fit: fit - penalty };
      })
      .filter(Boolean)
      .sort((a, b) => b.fit - a.fit);

    let chosen = sortedCands[0] || null;
    if (!chosen) {
      day += 1;
      for (const k of Object.keys(usedToday)) delete usedToday[k];
      const retry = MODELS.map(m => {
        const fit = capFit(m, TASK_NEED[st.task] || TASK_NEED.chat);
        const pf = platformForModel(m, mode, s.total);
        if (!pf) return null;
        const used = pf.p.quotaType === 'gift' || pf.p.quotaType === 'trial'
          ? (spentOnce[pf.p.id] || 0) : 0;
        if (pf.cap - used < s.total) return null;
        return { m, pf, fit };
      }).filter(Boolean).sort((a, b) => b.fit - a.fit);
      chosen = retry[0] || null;
      if (!chosen) {
        infeasible = infeasible || `${st.name}（${fmt(s.total)} tokens）超过任何单一免费档单日可承接量`;
      }
    }

    if (chosen) {
      const pid = chosen.pf.p.id;
      const oneShot = ['gift', 'trial'].includes(chosen.pf.p.quotaType);
      if (oneShot) spentOnce[pid] = (spentOnce[pid] || 0) + s.total;
      else usedToday[pid] = (usedToday[pid] || 0) + s.total;
      modelUse[chosen.m.id] = (modelUse[chosen.m.id] || 0) + 1;

      /* 审查者：必须与本阶段执行者不同模型，且抗幻觉优先 */
      const revPick = pickForRole('reviewer', mode, [chosen.m.id], 3000);

      s.worker = {
        model: chosen.m.name, modelId: chosen.m.id,
        platform: chosen.pf.p.name, platformId: pid,
        quotaType: chosen.pf.p.quotaType, cap: chosen.pf.cap,
        fit: Math.round(capFit(chosen.m, TASK_NEED[st.task] || TASK_NEED.chat))
      };
      s.reviewer = revPick ? {
        model: revPick.m.name, modelId: revPick.m.id,
        platform: revPick.pf.p.name, platformId: revPick.pf.p.id,
        fit: Math.round(capFit(revPick.m, ROLES.reviewer.need)),
        factScore: revPick.m.score.fact
      } : null;
      s.fallback = sortedCands[1] ? {
        model: sortedCands[1].m.name, platform: sortedCands[1].pf.p.name
      } : null;
    } else {
      s.worker = null; s.reviewer = null; s.fallback = null;
    }
    s.day = day;
    s.manual = mode === 'script' && st.webOnly;
    s.batch = Math.floor(idx / 3) + 1;   /* 每批最多 3 个任务 */
    stages.push(s);
  });

  /* ---- 3. 汇总与终审 ---- */
  const synthPick = pickForRole('synthesizer', mode, [], 8000);
  const auditChief = chiefPick;   /* 终审回到 Chief，保持目标一致性 */

  const totalTokens = stages.reduce((a, s) => a + s.total, 0);
  const loops = Math.max(...stages.map(s => s.batch), 1);

  /* 经验命中 */
  const kw = [tpl.name].concat(tpl.stages.map(s => s.name)).concat(tpl.stages.map(s => s.task));
  const pbHits = pbMatch(loadPlaybook(), kw);

  return {
    tpl, scaleKey, mode, mul, stages, days: day, loops,
    totalTokens,
    cost: (totalTokens / 1e6) * PAID_REF,
    infeasible,
    chief: chiefPick ? {
      model: chiefPick.m.name, modelId: chiefPick.m.id,
      platform: chiefPick.pf.p.name, platformId: chiefPick.pf.p.id,
      fit: Math.round(capFit(chiefPick.m, ROLES.chief.need)),
      note: chiefPick.m.note
    } : null,
    synth: synthPick ? {
      model: synthPick.m.name, modelId: synthPick.m.id,
      platform: synthPick.pf.p.name, platformId: synthPick.pf.p.id,
      fit: Math.round(capFit(synthPick.m, ROLES.synthesizer.need))
    } : null,
    audit: auditChief ? { model: auditChief.m.name, platform: auditChief.pf.p.name } : null,
    pbHits: pbHits.slice(0, 5),
    checks: CONSISTENCY_CHECKS
  };
}

/* ============================================================
   提示词构建
   ============================================================ */
function buildChiefSystem(plan) {
  const goal = (($('#orch-brief') && $('#orch-brief').value) || plan.tpl.brief).trim();
  const stages = plan.stages.map((s, i) => `${i + 1}. ${s.key} — ${s.name}（产出：${s.artifact}）`).join('\n');

  return `你是本项目的总控（Chief）。你不写正文，你做的是：分解、分派、审查、督促、终审。

【总体目的】
${goal}

【你的权限边界】
- 你可以：拆分任务、指定验收标准、要求返工、裁决冲突、调整任务顺序。
- 你不可以：自己下场写正文、在缺少回执的情况下替 Worker 补结论、修改已锁定结论（只能走冲突登记）。

【候选任务池】（你可以增删，但增删要说明理由）
${stages}

【每轮循环你必须做的事，按顺序】
1. 原样复述总体目的，确认本轮没有偏离；
2. 读上一轮的状态卡，检查每个「已回执」的任务是否真的满足了它的验收标准；
3. 执行一致性检查，逐类过：数字冲突 / 术语冲突 / 结论冲突 / 范围越界 / 假设冲突；
   每类都要写明「检了什么、结论是什么」，不许写「已保持一致」；
4. 更新状态卡（版本号 +1）；
5. 派出下一批任务，每批不超过 3 个，每个都要写验收标准；
6. 对超过一轮没有回执的任务，明确标注「督促」并说明它卡在哪。

【分派原则】
- 一个任务只交给一个模型，不搞「大家各写一版」；
- 审查任务必须交给与执行者不同的模型；
- 需要联网检索的任务不要派给没有联网能力的通道。

【状态卡格式】
${STATE_CARD_SPEC}

【结束条件】
所有任务进入 DONE 且 CONFLICT 里没有「待裁决」项时，进入终审：
逐条比对最终成果与总体目的，回答三件事——
① 目的里的每个问题是否都被回答了（逐条对照，没回答的明确写「未回答」）；
② 结论之间是否还有互斥；
③ 列出结论失效的触发条件（什么情况出现时本报告作废）。`;
}

function buildWorkerPrompt(s, plan) {
  const goal = (($('#orch-brief') && $('#orch-brief').value) || plan.tpl.brief).trim();
  const isFirst = plan.stages.indexOf(s) === 0;
  return `【项目总体目的】
${goal}

【你这一环的任务】${s.name}
【产出物】${s.artifact}
【任务要求】
${s.prompt}

【验收标准】（总控按这四条判定你是否合格，缺一条即返工）
1. 覆盖了要求里的每一项，没有遗漏编号；
2. 每个关键数字都带口径与来源；
3. 没有越界去写不属于本任务的内容；
4. 结尾有回执卡。

${isFirst ? '' : `【上游交接】上游的交接卡会附在下面。注意：
- 标为「已定结论」的部分你不得推翻，只能质疑；
- 交接卡里没有的内容，就当作不存在，不要自行脑补。`}

${RECEIPT_SPEC}`;
}

function buildReviewerPrompt(s, plan) {
  return `你是独立审查员（Reviewer）。你没有参与上面的执行，不知道执行者的推理过程——这是刻意的。

【你要审查的任务】${s.name}（由 ${s.worker ? s.worker.model : '—'} 执行）

【审查清单】逐项过，每项都要写结论，不许写「未发现问题」了事：
1. 数字冲突：回执里的关键数字与上游锁定结论是否一致？口径是否可比？
2. 术语冲突：新增术语的定义与既有术语表是否冲突？
3. 结论冲突：本回执的结论与已锁定结论是否互斥？
4. 范围越界：是否写了任务单没要求的内容？
5. 假设冲突：本回执隐含的前提与上游前提是否一致？

【输出】
[审查结论]
通过 / 返工 / 升级裁决（三选一，必须明确）
[问题清单]
类型 ｜ 具体描述 ｜ 你的处置建议（每条一行；没问题就写「无」）

规则：你不改写内容，只判定。发现执行者「悄悄对齐」了上游数字，直接判返工。`;
}

/* ============================================================
   导出：完整流程手册
   ============================================================ */
function buildOrchMd(plan) {
  const goal = (($('#orch-brief') && $('#orch-brief').value) || plan.tpl.brief).trim();
  const L = [];
  L.push(`# ${plan.tpl.name} — 总控调度执行手册`);
  L.push('');
  L.push(`> 生成时间：${DATA_DATE} ｜ 规模：${SCALES[plan.scaleKey].label}（×${plan.mul}）｜ 模式：${plan.mode === 'script' ? '脚本自动' : '手动网页'}`);
  L.push(`> 总消耗估算 ${fmt(plan.totalTokens)} tokens ｜ 需 ${plan.days} 天 ｜ ${plan.loops} 轮循环 ｜ 付费对照 ¥${plan.cost.toFixed(2)}`);
  L.push('');
  L.push('## 0. 总体目的（GOAL）');
  L.push('');
  L.push(goal);
  L.push('');
  L.push('> 这一行是全局锚点。每一轮循环开始时，总控都要原样复述它。改了它，整个项目的验收标准就变了。');
  L.push('');

  L.push('## 1. 角色分配');
  L.push('');
  L.push('| 角色 | 模型 | 通过哪个免费额度 | 匹配度 | 为什么是它 |');
  L.push('|---|---|---|---|---|');
  if (plan.chief) {
    L.push(`| **总控 Chief** | ${plan.chief.model} | ${plan.chief.platform} | ${plan.chief.fit} | ${ROLES.chief.why} |`);
  }
  if (plan.synth) {
    L.push(`| **汇总 Synthesizer** | ${plan.synth.model} | ${plan.synth.platform} | ${plan.synth.fit} | ${ROLES.synthesizer.why} |`);
  }
  if (plan.audit) {
    L.push(`| **终审** | ${plan.audit.model} | ${plan.audit.platform} | — | 回到总控，保证与总体目的的一致性由同一双眼睛把关 |`);
  }
  L.push('');
  L.push('> 审查（Reviewer）不固定为一个模型，而是**每个阶段临时指派，且强制与执行者不同**——用执行者自己审自己等于没审。');
  L.push('');

  L.push('## 2. 循环机制');
  L.push('');
  L.push('```');
  L.push('  ┌─────────────────────────────────────────┐');
  L.push('  │  总控读状态卡 → 复述 GOAL → 一致性检查  │');
  L.push('  └──────────────┬──────────────────────────┘');
  L.push('                 │ 派单（每批 ≤3，带验收标准）');
  L.push('                 ▼');
  L.push('  ┌─────────────────────────────────────────┐');
  L.push('  │  Worker 执行 → 回传回执卡（不回全文）   │');
  L.push('  └──────────────┬──────────────────────────┘');
  L.push('                 │');
  L.push('                 ▼');
  L.push('  ┌─────────────────────────────────────────┐');
  L.push('  │  Reviewer（异模型）五类冲突检查         │');
  L.push('  └──────────────┬──────────────────────────┘');
  L.push('          通过 ──┴── 返工/升级');
  L.push('                 │');
  L.push('                 ▼  更新状态卡 v+1，回到顶部');
  L.push('```');
  L.push('');

  L.push('## 3. 项目状态卡');
  L.push('');
  L.push('```');
  L.push(STATE_CARD_SPEC.trim());
  L.push('```');
  L.push('');

  L.push('## 4. 回执卡格式');
  L.push('');
  L.push('```');
  L.push(RECEIPT_SPEC.trim());
  L.push('```');
  L.push('');

  L.push('## 5. 一致性检查规则');
  L.push('');
  L.push('| 类型 | 判定方法 | 处置动作 | 可否脚本自动 |');
  L.push('|---|---|---|---|');
  CONSISTENCY_CHECKS.forEach(c => {
    L.push(`| ${c.label} | ${c.method} | ${c.action} | ${c.auto ? '可以' : '需人工/异模型'} |`);
  });
  L.push('');

  L.push('## 6. 阶段清单');
  L.push('');
  plan.stages.forEach((s, i) => {
    L.push(`### ${i + 1}. ${s.name}${s.inst ? `（第 ${s.inst}/${s.instTotal} 份）` : ''}`);
    L.push('');
    L.push(`- **批次**：第 ${s.batch} 轮 ｜ **第 ${s.day} 天 ｜ 预算 ${fmt(s.total)} tokens（输入 ${fmt(s.inTok)} + 输出 ${fmt(s.outTok)}）`);
    L.push(`- **执行 Worker**：${s.worker ? `${s.worker.model}（匹配度 ${s.worker.fit}）· 走 ${s.worker.platform}` : '⚠ 无可用免费额度'}`);
    L.push(`- **审查 Reviewer**：${s.reviewer ? `${s.reviewer.model}（抗幻觉 ${s.reviewer.factScore}）· 走 ${s.reviewer.platform}` : '—'}`);
    if (s.fallback) L.push(`- **429 备选**：${s.fallback.model} · ${s.fallback.platform}`);
    if (s.manual) L.push(`- **需人工**：这一步要联网，免费 API 代不了，请在网页版跑完把结果落盘`);
    L.push(`- **产出物**：${s.artifact}`);
    L.push(`- **为什么这样分**：${s.why}`);
    L.push('');
    L.push('<details><summary>执行提示词</summary>');
    L.push('');
    L.push('```');
    L.push(buildWorkerPrompt(s, plan));
    L.push('```');
    L.push('');
    L.push('</details>');
    L.push('');
  });

  L.push('## 7. 终审核对');
  L.push('');
  L.push('全部任务 DONE 且无「待裁决」冲突后，总控必须回答三件事：');
  L.push('');
  L.push('1. 总体目的里的每个问题是否都被回答了？逐条对照，没回答的明确写「未回答」，不许回避。');
  L.push('2. 最终成果内部是否还有互斥结论？');
  L.push('3. 列出结论失效的触发条件——什么情况出现时，这份成果应当作废重做。');
  L.push('');

  if (plan.pbHits && plan.pbHits.length) {
    L.push('## 8. 命中经验（来自经验库）');
    L.push('');
    plan.pbHits.forEach(h => {
      L.push(`### [${PLAYBOOK_KINDS[h.p.kind].label}] ${h.p.trigger.join(' / ')}`);
      L.push('');
      L.push(`- **过去的问题**：${h.p.lesson}`);
      L.push(`- **这次怎么做**：${h.p.action}`);
      if (h.p.gain) L.push(`- **收益**：${h.p.gain}`);
      L.push('');
    });
  }

  L.push('---');
  L.push('');
  L.push('*本手册由「AI Agent 免费额度调度中台」生成。能力匹配基于 LMArena（2026-10）、SuperCLUE（2026-07）、SWE-bench Verified 的公开数据；额度数据以各平台控制台为准。*');
  return L.join('\n');
}

/* ============================================================
   导出：总控提示词（单独一份，最常用）
   ============================================================ */
function buildChiefMd(plan) {
  return buildChiefSystem(plan);
}

/* ============================================================
   视图：总控调度舱
   ============================================================ */
const ORCH_DEFAULT = { tpl: 'research-report', scale: 'small', mode: 'script' };

/* 供引擎读取项目简报（buildChiefSystem / buildWorkerPrompt 用） */
function renderOrchestrator() {
  const t = ORCH_DEFAULT.tpl;
  $('#orch-tpls').innerHTML = PIPELINE_TEMPLATES.map(x => `
    <button class="tpl-chip ${x.id === t ? 'on' : ''}" data-otpl="${x.id}">
      <b>${esc(x.name)}</b><span>${esc(x.tagline)}</span>
    </button>`).join('');

  $('#orch-scales').innerHTML = Object.entries(SCALES).map(([k, v]) => `
    <button class="seg ${k === ORCH_DEFAULT.scale ? 'on' : ''}" data-oscale="${k}">${v.label}<i>${esc(v.desc)}</i></button>`).join('');

  $('#orch-modes').innerHTML = `
    <button class="seg ${ORCH_DEFAULT.mode === 'script' ? 'on' : ''}" data-omode="script">脚本自动<i>API 直连，检索段人工</i></button>
    <button class="seg ${ORCH_DEFAULT.mode === 'manual' ? 'on' : ''}" data-omode="manual">手动网页<i>含网页版，全人工</i></button>`;

  $('#orch-brief').value = PIPELINE_TEMPLATES.find(x => x.id === t).brief;

  $$('[data-otpl]').forEach(b => b.addEventListener('click', () => {
    ORCH_DEFAULT.tpl = b.dataset.otpl;
    $('#orch-brief').value = PIPELINE_TEMPLATES.find(x => x.id === b.dataset.otpl).brief;
    $$('[data-otpl]').forEach(x => x.classList.toggle('on', x.dataset.otpl === ORCH_DEFAULT.tpl));
    renderOrchPlan();
  }));
  $$('[data-oscale]').forEach(b => b.addEventListener('click', () => {
    ORCH_DEFAULT.scale = b.dataset.oscale;
    $$('[data-oscale]').forEach(x => x.classList.toggle('on', x.dataset.oscale === ORCH_DEFAULT.scale));
    renderOrchPlan();
  }));
  $$('[data-omode]').forEach(b => b.addEventListener('click', () => {
    ORCH_DEFAULT.mode = b.dataset.omode;
    $$('[data-omode]').forEach(x => x.classList.toggle('on', x.dataset.omode === ORCH_DEFAULT.mode));
    renderOrchPlan();
  }));

  renderOrchPlan();
}

function renderOrchPlan() {
  const plan = planOrchestration(ORCH_DEFAULT.tpl, ORCH_DEFAULT.scale, ORCH_DEFAULT.mode);
  window.__orch = plan;

  /* ---- KPI ---- */
  const autoChecks = plan.checks.filter(c => c.auto).length;
  $('#orch-summary').innerHTML = `
    <div class="kpi">
      <div class="k-label">循环轮次</div>
      <div class="k-val k-accent">${plan.loops}<small>轮</small></div>
      <div class="k-foot">${plan.stages.length} 个任务 · 每轮最多派 3 个</div>
    </div>
    <div class="kpi">
      <div class="k-label">总消耗</div>
      <div class="k-val">${fmt(plan.totalTokens)}<small>tok</small></div>
      <div class="k-foot">需 ${plan.days} 天 · ${plan.mode === 'script' ? '脚本自动' : '手动网页'}</div>
    </div>
    <div class="kpi">
      <div class="k-label">可自动的一致性检查</div>
      <div class="k-val ${autoChecks >= 3 ? 'k-green' : 'k-amber'}">${autoChecks}<small>/ ${plan.checks.length}</small></div>
      <div class="k-foot">其余需异模型人工判定</div>
    </div>
    <div class="kpi">
      <div class="k-label">命中经验</div>
      <div class="k-val">${plan.pbHits.length}<small>条</small></div>
      <div class="k-foot">来自经验库，已注入本方案</div>
    </div>`;

  /* ---- 角色卡 ---- */
  const roleCard = (r, role, extra) => r ? `
    <div class="role-card">
      <div class="rc-head">
        <span class="rc-icon">${role.icon}</span>
        <div>
          <div class="rc-role">${role.label}</div>
          <div class="rc-model">${esc(r.model)}</div>
        </div>
        <div class="rc-fit">${r.fit}<small>匹配</small></div>
      </div>
      <div class="rc-plat">走 <b>${esc(r.platform)}</b> 的免费额度</div>
      <div class="rc-why">${esc(extra || role.why)}</div>
      ${r.note ? `<div class="rc-note">${esc(r.note)}</div>` : ''}
    </div>` : `<div class="role-card bad"><div class="rc-role">${role.label}</div><div class="rc-why">当前模式下没有满足最低能力门槛（${role.minScore}）的免费模型。放宽到手动网页模式可解锁更多。</div></div>`;

  $('#orch-roles').innerHTML =
    roleCard(plan.chief, ROLES.chief, plan.chief ? '总控要拆得对、看得住全局。它不写正文，只做分解、分派、审查、督促、终审。' : '') +
    roleCard(plan.synth, ROLES.synthesizer) +
    (plan.audit ? `
      <div class="role-card">
        <div class="rc-head">
          <span class="rc-icon">✓</span>
          <div><div class="rc-role">终审</div><div class="rc-model">${esc(plan.audit.model)}</div></div>
          <div class="rc-fit">—</div>
        </div>
        <div class="rc-plat">走 <b>${esc(plan.audit.platform)}</b> 的免费额度</div>
        <div class="rc-why">终审回到总控自己，不换人。目的是让「与总体目的核对」这最后一关由同一双眼睛把关——换个人反而容易放过偏离。</div>
      </div>` : '');

  /* ---- 阶段清单 ---- */
  $('#orch-stages').innerHTML = plan.stages.map((s, i) => `
    <div class="stage ${s.worker ? '' : 'bad'}" data-ostage="${esc(s.key)}">
      <div class="stage-rail">
        <div class="stage-no">${i + 1}</div>
        <div class="stage-line"></div>
      </div>
      <div class="stage-card">
        <div class="stage-head">
          <div>
            <div class="stage-name">${esc(s.name)}${s.inst ? `<span class="inst">第 ${s.inst}/${s.instTotal} 份</span>` : ''}</div>
            <div class="stage-art">产出：${esc(s.artifact)}</div>
          </div>
          <div class="stage-right">
            <span class="stage-mday">第 ${s.batch} 轮</span>
            <span class="mono stage-tok">${fmt(s.total)} tok</span>
          </div>
        </div>
        <div class="wc-row">
          <div class="wc wc-worker">
            <div class="wc-tag">执行</div>
            <div class="wc-model">${s.worker ? esc(s.worker.model) : '—'}</div>
            <div class="wc-plat">${s.worker ? esc(s.worker.platform) : '无可用额度'}</div>
            ${s.worker ? `<div class="wc-fit">匹配 ${s.worker.fit}</div>` : ''}
          </div>
          <div class="wc-arrow">→</div>
          <div class="wc wc-review">
            <div class="wc-tag">审查</div>
            <div class="wc-model">${s.reviewer ? esc(s.reviewer.model) : '—'}</div>
            <div class="wc-plat">${s.reviewer ? esc(s.reviewer.platform) : '无可用额度'}</div>
            ${s.reviewer ? `<div class="wc-fit">抗幻觉 ${s.reviewer.factScore}</div>` : ''}
          </div>
        </div>
        <div class="stage-meta">
          <span class="chip ghost" style="font-size:10.5px;padding:2px 7px">${esc(TASK_TAGS[s.task] || s.task)}</span>
          <span class="stage-mday">D${s.day}</span>
          ${s.manual ? '<span class="chip amber" style="font-size:10.5px;padding:2px 7px">需人工：要联网</span>' : ''}
          ${s.fallback ? `<span class="stage-fb">429 备选：${esc(s.fallback.model)}</span>` : ''}
          ${s.worker && s.reviewer && s.worker.modelId === s.reviewer.modelId
            ? '<span class="chip red" style="font-size:10.5px;padding:2px 7px">⚠ 自审</span>' : ''}
        </div>
        <div class="stage-foot">
          <div class="stage-why">${esc(s.why)}</div>
          <button class="mini-btn" data-oopen="${esc(s.key)}">看提示词</button>
        </div>
      </div>
    </div>`).join('');

  $$('[data-oopen]').forEach(b => b.addEventListener('click', () => openOrchDrawer(b.dataset.oopen)));

  /* ---- 一致性规则 ---- */
  $('#orch-checks').innerHTML = plan.checks.map(c => `
    <div class="chk-row">
      <div class="chk-name">
        <span class="chip ${c.severity === 'high' ? 'red' : (c.severity === 'mid' ? 'amber' : 'green')}" style="font-size:10px;padding:2px 6px">${c.severity === 'high' ? '高' : (c.severity === 'mid' ? '中' : '低')}</span>
        ${esc(c.label)}
      </div>
      <div class="chk-detect">判定：${esc(c.method)}</div>
      <div class="chk-action">处置：${esc(c.action)}</div>
      <div class="chk-auto">${c.auto ? '<span class="chip green" style="font-size:10px;padding:2px 6px">脚本可自动</span>' : '<span class="chip slate" style="font-size:10px;padding:2px 6px">需异模型判定</span>'}</div>
    </div>`).join('');

  /* ---- 经验库命中 ---- */
  const pbList = loadPlaybook();
  const hits = plan.pbHits;
  $('#orch-pb').innerHTML = hits.length
    ? hits.map(h => `
      <div class="pb-hit">
        <div class="pb-kind ${h.p.kind}">${PLAYBOOK_KINDS[h.p.kind].label}</div>
        <div class="pb-body">
          <div class="pb-lesson"><b>过去的问题：</b>${esc(h.p.lesson)}</div>
          <div class="pb-action"><b>这次怎么做：</b>${esc(h.p.action)}</div>
          ${h.p.gain ? `<div class="pb-gain">收益：${esc(h.p.gain)}</div>` : ''}
        </div>
      </div>`).join('')
    : `<div style="font-size:12px;color:var(--ink-3)">当前模板未命中经验库条目。跑完一轮后把遇到的问题加进去，下次同类项目会自动带上。</div>`;

  $('#orch-pb-count').textContent = pbList.length;

  /* ---- 结论 ---- */
  const selfAudit = plan.stages.filter(s => s.worker && s.reviewer && s.worker.modelId === s.reviewer.modelId).length;
  $('#orch-verdict').innerHTML = plan.infeasible
    ? `<div class="pipe-warn"><b>有任务放不下：</b>${esc(plan.infeasible)}。需要拆细任务、缩小规模，或让这一段走付费兜底。</div>`
    : `<div class="pipe-ok"><b>可以零成本跑完，且带一致性闭环。</b>
        总控 ${plan.chief ? esc(plan.chief.model) : '—'} 分 ${plan.loops} 轮派单，
        每个任务由一个模型执行、另一个模型审查，回执只回结构化结果不回全文。
        ${selfAudit ? `<br>⚠ 有 ${selfAudit} 个任务出现「执行者与审查者同模型」，会退化成自审，建议切到手动网页模式解锁更多模型。` : ''}
      </div>`;

  /* ---- 导出 ---- */
  $('#orch-export').innerHTML = `
    <button class="run-btn" id="ox-chief" style="width:auto;padding:8px 18px">导出总控提示词 .md</button>
    <button class="run-btn ghost-btn" id="ox-md" style="width:auto;padding:8px 18px">导出执行手册 .md</button>
    <button class="run-btn ghost-btn" id="ox-pb" style="width:auto;padding:8px 18px">导出经验库 .json</button>`;
  $('#ox-chief').addEventListener('click', () => downloadFile(orchName(plan, 'chief.md'), buildChiefMd(plan), 'text/markdown'));
  $('#ox-md').addEventListener('click', () => downloadFile(orchName(plan, 'md'), buildOrchMd(plan), 'text/markdown'));
  $('#ox-pb').addEventListener('click', () => downloadFile('playbook.json', JSON.stringify(loadPlaybook(), null, 2), 'application/json'));
}

function orchName(plan, ext) {
  return `总控调度-${plan.tpl.name}-${SCALES[plan.scaleKey].label}.${ext}`;
}

/* 阶段抽屉：执行提示词 + 审查提示词 */
function openOrchDrawer(key) {
  const plan = window.__orch;
  const s = plan.stages.find(x => x.key === key);
  if (!s) return;
  const wp = buildWorkerPrompt(s, plan);
  const rp = buildReviewerPrompt(s, plan);
  $('#drawer-title').textContent = `${s.name} — 提示词`;
  $('#drawer-body').innerHTML = `
    <div class="pw-sec">
      <div class="pw-label">执行提示词 · 发给 ${s.worker ? esc(s.worker.model) : '—'}</div>
      <div class="pw-wrap"><pre class="pw" id="pw-w">${esc(wp)}</pre></div>
      <button class="mini-btn" id="cp-w" style="margin-top:8px">复制</button>
    </div>
    <div class="pw-sec">
      <div class="pw-label">审查提示词 · 发给 ${s.reviewer ? esc(s.reviewer.model) : '—'}（必须与执行者不同）</div>
      <div class="pw-wrap"><pre class="pw" id="pw-r">${esc(rp)}</pre></div>
      <button class="mini-btn" id="cp-r" style="margin-top:8px">复制</button>
    </div>`;
  $('#drawer').classList.add('open');
  $('#drawer-mask').classList.add('open');
  $('#cp-w').addEventListener('click', e => copyText(wp, e.target));
  $('#cp-r').addEventListener('click', e => copyText(rp, e.target));
}

/* 注册视图 */
VIEWS.orch = {
  title: '总控调度舱',
  sub: '一个总控模型拆任务、按能力分派、异模型审查、闭环对齐总目标',
  render: renderOrchestrator
};

/* 能力画像视图的注册也放这里（capability.js 注入点在 VIEWS 声明之前） */
VIEWS.capability = {
  title: '能力画像',
  sub: '九维评分，每条都挂原始评测数字与来源',
  render: renderCapability
};

/* 接入通道视图的注册也放这里（access.js 注入点在 VIEWS 声明之前） */
VIEWS.access = {
  title: '接入通道',
  sub: '额度怎么兑现成可用能力：三类额度、五条路径、网关配置',
  render: renderAccess
};
