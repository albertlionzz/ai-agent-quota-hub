/* ============================================================
   AI Agent 免费额度调度中台 — 应用逻辑
   ============================================================ */
(function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const LS_KEY = 'quotaHub.wallet.v1';
  const UI_KEY = 'quotaHub.ui.v1';

  /* 上次停在哪一页、筛了什么，刷新后要还在。
     单文件工具最常见的毛病是每次打开都回首页，等于每天重新找一遍。 */
  function loadUI() {
    try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveUI() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        view: state.view, search: state.search, filters: state.filters
      }));
    } catch (e) {}
  }

  const ui = loadUI();

  const state = {
    view: 'overview',
    search: typeof ui.search === 'string' ? ui.search : '',
    filters: Object.assign({ region: 'all', cat: 'all', qtype: 'all' }, ui.filters || {}),
    route: { task: 'long-text', reqs: 200, inTok: 3000, outTok: 800 },
    wallet: loadWallet()
  };

  /* ---------------- 工具 ---------------- */
  function fmt(n) {
    if (n === null || n === undefined) return '—';
    if (n === Infinity) return '∞';
    if (n >= 1e8) return (n / 1e8).toFixed(n % 1e8 === 0 ? 0 : 1) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(n % 1e4 === 0 ? 0 : 1) + '万';
    return n.toLocaleString('zh-CN');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function loadWallet() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 忽略损坏数据 */ }
    return JSON.parse(JSON.stringify(DEFAULT_WALLET));
  }

  function saveWallet() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.wallet)); } catch (e) {}
  }

  const byId = id => PLATFORMS.find(p => p.id === id);

  /* 距离下一次重置的毫秒数 & 人类可读文本
     注意顺序：必须优先看 reset 字段。"永久免费档"的模型（Groq、Gemini Flash）
     同样是每天重置配额，先判 quotaType 会把它们误标成「无重置」。 */
  function resetInfo(p) {
    const now = new Date();
    if (p.quotaType === 'selfhost') return { text: '不适用', sub: '自托管无额度' };

    if (p.reset === 'daily') {
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      const h = Math.floor((next - now) / 3600000);
      const m = Math.floor(((next - now) % 3600000) / 60000);
      return { text: `${h}h ${m}m`, sub: '次日 0 点重置' };
    }
    if (p.reset === 'monthly') {
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const days = Math.ceil((next - now) / 86400000);
      return { text: `${days} 天`, sub: '次月 1 日重置' };
    }
    if (p.reset === 'weekly') {
      const next = new Date(now);
      const dow = next.getDay() || 7;
      next.setDate(next.getDate() + (8 - dow));
      next.setHours(0, 0, 0, 0);
      const days = Math.ceil((next - now) / 86400000);
      return { text: `${days} 天`, sub: '下周一重置' };
    }
    if (p.reset === 'once') {
      if (p.expiresAt) {
        const d = new Date(p.expiresAt + 'T23:59:59');
        const days = Math.ceil((d - now) / 86400000);
        return days >= 0
          ? { text: `剩 ${days} 天`, sub: '一次性额度' }
          : { text: '已过期', sub: '一次性额度' };
      }
      return { text: '一次性', sub: '用完即止' };
    }

    if (p.quotaType === 'forever') return { text: '长期', sub: '无重置' };
    return { text: '—', sub: '' };
  }

  /* 每日可用 token 容量（用于路由）。返回 {cap, basis, maxReq}
     关键：token 额度和请求次数上限是两个独立约束，谁先耗尽谁说了算，
     所以 cap 取两者的较小值，maxReq 单独返回给路由做次数扣减。 */
  function dailyCapacity(p, inTok, outTok) {
    const perReq = Math.max(1, inTok + outTok);
    if (p.quotaType === 'selfhost') {
      /* 关键：自托管不是无限产能，受本地硬件吞吐约束 */
      return { cap: SELFHOST_DAILY_EST, basis: '按单机自托管满载估算', maxReq: Infinity };
    }

    const maxReq = p.reqPerDay || Infinity;
    const capByReq = maxReq === Infinity ? Infinity : maxReq * perReq;
    let capByTok = Infinity;
    let basis = '';

    if (p.freeTokensPerDay) {
      capByTok = p.freeTokensPerDay;
      basis = p.unlimited ? '不限量 · 按并发约束折算' : '官方日额度';
    }
    if (p.tokensTotal) {
      const days = p.expiresAt
        ? Math.max(1, Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000))
        : 60; // 无明确到期日时按 60 天摊
      capByTok = Math.min(capByTok, Math.round(p.tokensTotal / days));
      basis = basis || `${fmt(p.tokensTotal)} 摊到 ${days} 天`;
    }

    if (capByTok === Infinity && capByReq === Infinity) return { cap: 0, basis: '额度不可量化', maxReq };

    /* 谁更紧就按谁算，并在说明里点出瓶颈是哪一头 */
    if (capByReq < capByTok) {
      return { cap: capByReq, basis: `${maxReq} 次/日 × 单次 ${fmt(perReq)}（次数是瓶颈）`, maxReq };
    }
    if (capByTok === Infinity) return { cap: capByReq, basis, maxReq };
    return { cap: capByTok, basis: basis + (maxReq !== Infinity ? ` · 另限 ${maxReq} 次/日` : ''), maxReq };
  }

  /* ============================================================
     视图：总览
     ============================================================ */
  function renderOverview() {
    const total = PLATFORMS.length;
    const forever = PLATFORMS.filter(p => p.quotaType === 'forever').length;
    const daily = PLATFORMS.filter(p => p.quotaType === 'daily').length;

    /* 每日可再生 token 总量：只看 daily + forever 里有明确日额度的 */
    const renewable = PLATFORMS
      .filter(p => p.quotaType === 'daily' || p.quotaType === 'forever')
      .reduce((s, p) => s + (p.freeTokensPerDay || 0), 0);

    const disputed = PLATFORMS.filter(p => p.confidence === 'disputed').length;

    /* 一次性额度总池：这部分会过期，是应该优先烧掉的 */
    const giftPool = PLATFORMS
      .filter(p => ['gift', 'trial'].includes(p.quotaType))
      .reduce((s, p) => s + (p.tokensTotal || 0), 0);

    $('#kpi-row').innerHTML = `
      <div class="kpi">
        <div class="k-label">已收录平台 / 工具</div>
        <div class="k-val">${total}<small>个</small></div>
        <div class="k-foot">国内 ${PLATFORMS.filter(p => p.region === 'cn').length} · 海外 ${PLATFORMS.filter(p => p.region === 'global').length}</div>
      </div>
      <div class="kpi">
        <div class="k-label">永久免费档</div>
        <div class="k-val k-green">${forever}<small>个</small></div>
        <div class="k-foot">无总量上限，可作为长期基本盘</div>
      </div>
      <div class="kpi">
        <div class="k-label">每日刷新型</div>
        <div class="k-val k-accent">${daily}<small>个</small></div>
        <div class="k-foot">配额每天再生，适合常驻任务</div>
      </div>
      <div class="kpi">
        <div class="k-label">可再生日额度合计</div>
        <div class="k-val k-accent">${fmt(renewable)}<small>tok/日</small></div>
        <div class="k-foot">仅统计有明确日额度的平台</div>
      </div>
      <div class="kpi">
        <div class="k-label">一次性礼包合计</div>
        <div class="k-val k-amber">${fmt(giftPool)}<small>tok</small></div>
        <div class="k-foot">会过期，应优先消耗</div>
      </div>
      <div class="kpi">
        <div class="k-label">口径存疑</div>
        <div class="k-val k-amber">${disputed}<small>个</small></div>
        <div class="k-foot">来源冲突，用前须自行核验</div>
      </div>`;

    /* 额度形态说明 */
    $('#quota-legend').innerHTML = Object.entries(QUOTA_TYPES).map(([k, v]) => {
      const n = PLATFORMS.filter(p => p.quotaType === k).length;
      return `<div class="qtype ${v.color}">
        <b>${esc(v.label)} <span style="float:right;font-family:var(--mono);font-weight:500;color:var(--ink-3)">${n}</span></b>
        <p>${esc(v.desc)}</p>
      </div>`;
    }).join('');

    /* 三大结论 */
    $('#insight-row').innerHTML = `
      <div class="stg">
        <div class="stg-tag">趋势判断</div>
        <h4>免费午餐在缩水，但结构在变好</h4>
        <p style="font-size:12.5px;color:var(--ink-2);line-height:1.65">
        2026 年这一轮的真实变化：Gemini 在 4/1 移走了 Pro 免费档、Groq 在 8/16 下架 Llama 全系、
        硅基流动取消了小模型永久免费、Windsurf 从 credits 改配额制。
        但另一边，火山方舟做到每日 200 万 token 自动刷新、OpenRouter 充 $10 就把日限从 50 提到 1000。
        <b>结论：押「每日刷新」和「永久档」，不要押「一次性礼包」。</b></p>
      </div>
      <div class="stg">
        <div class="stg-tag">组合原则</div>
        <h4>三个平台叠加 > 一个平台死磕</h4>
        <p style="font-size:12.5px;color:var(--ink-2);line-height:1.65">
        单看任何一家免费档都很紧：Groq 8K TPM、Gemini 10 RPM、OpenRouter 50 RPD。
        但它们限制的维度不同——有的限并发、有的限总量、有的限速率。
        把任务按「长文/短请求/实时/批量」拆开，分派到限制维度不同的平台上，总吞吐能翻 5~10 倍。</p>
      </div>
      <div class="stg">
        <div class="stg-tag">高阶玩法</div>
        <h4>开源客户端 + 免费 Key = 真无限</h4>
        <p style="font-size:12.5px;color:var(--ink-2);line-height:1.65">
        Cline / Aider / Roo Code 这类开源工具本身不计算消息数，成本 100% 由你接的模型决定。
        配 OpenRouter 免费 Key 可以白跑；配 Ollama 本地模型则连 Key 都不要。
        这是唯一能真正绕开「每月 2000 次」这类硬顶的路径。</p>
      </div>`;

    /* 快到期提醒 */
    const expiring = PLATFORMS.filter(p => {
      if (!p.expiresAt) return false;
      const d = Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000);
      return d >= 0 && d <= 45;
    });

    /* 会过期但官方未公示具体日期的一次性额度 —— 空状态没有价值，这里给出需要自查的清单 */
    const oneShotOpen = PLATFORMS.filter(p =>
      ['gift', 'trial'].includes(p.quotaType) && !p.expiresAt
    );

    $('#expiring-row').innerHTML = `
      ${expiring.length ? `<div style="margin-bottom:12px">
        <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:7px">已公示到期日</div>
        ${expiring.map(p => `<span class="chip amber" style="font-size:11.5px;padding:5px 9px;margin-right:4px">
          ${esc(p.name)} · 剩 ${Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000)} 天</span>`).join('')}
      </div>` : ''}
      <div>
        <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:7px">
          一次性额度、但官方未公示到期日（共 ${oneShotOpen.length} 个）—— 注册后须到控制台「资源包管理」自查
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${oneShotOpen.map(p => `<span class="chip amber" style="font-size:11px;padding:3.5px 8px">
            ${esc(p.name)}${p.tokensTotal ? ' · ' + fmt(p.tokensTotal) : ''}</span>`).join('')}
        </div>
        <div style="font-size:11.5px;color:var(--ink-3);margin-top:9px;line-height:1.6">
          这些额度合计 ${fmt(oneShotOpen.reduce((s, p) => s + (p.tokensTotal || 0), 0))} tokens。
          <b style="color:var(--ink-2)">策略：先烧它们，再烧每日刷新型</b>——因为每日额度明天还会回来，一次性额度过期就是零。
        </div>
      </div>`;
  }

  /* ============================================================
     视图：平台库
     ============================================================ */
  function filteredPlatforms() {
    const q = state.search.trim().toLowerCase();
    return PLATFORMS.filter(p => {
      if (state.filters.region !== 'all' && p.region !== state.filters.region) return false;
      if (state.filters.cat !== 'all' && p.cat !== state.filters.cat) return false;
      if (state.filters.qtype !== 'all' && p.quotaType !== state.filters.qtype) return false;
      if (!q) return true;
      const hay = [p.name, p.vendor, p.headline, p.note, p.limits,
                   (p.strengths || []).join(' '), (p.caveats || []).join(' '),
                   (p.tags || []).map(t => TASK_TAGS[t] || t).join(' ')
                  ].join(' ').toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => QUOTA_TYPES[b.quotaType].weight - QUOTA_TYPES[a.quotaType].weight);
  }

  const CAT_LABEL = { api: 'API', coding: '编程', agent: 'Agent 平台', chat: '对话', research: '研究', image: '图像', video: '视频' };

  function renderRegistry() {
    /* 筛选按钮只渲染一次 */
    if (!$('#filter-bar').dataset.ready) {
      const mk = (group, items, cur) => items.map(([val, label]) =>
        `<button class="fbtn${cur === val ? ' on' : ''}" data-g="${group}" data-v="${val}">${esc(label)}</button>`
      ).join('');

      $('#filter-bar').innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:7px">
          <span class="fl-label">区域</span>
          ${mk('region', [['all','全部'],['cn','国内'],['global','海外']], state.filters.region)}
          <span class="fl-label" style="margin-left:10px">类型</span>
          ${mk('cat', [['all','全部'],['api','API'],['coding','编程'],['agent','Agent 平台'],['chat','对话'],['research','研究'],['image','图像'],['video','视频']], state.filters.cat)}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
          <span class="fl-label">额度形态</span>
          ${mk('qtype', [['all','全部']].concat(Object.entries(QUOTA_TYPES).map(([k, v]) => [k, v.label])), state.filters.qtype)}
        </div>`;

      $('#filter-bar').dataset.ready = '1';
      $('#filter-bar').addEventListener('click', e => {
        const b = e.target.closest('.fbtn');
        if (!b) return;
        state.filters[b.dataset.g] = b.dataset.v;
        $$('.fbtn', $('#filter-bar')).forEach(x => {
          if (x.dataset.g === b.dataset.g) x.classList.toggle('on', x === b);
        });
        saveUI();
        renderRegistry();
      });
    }

    const list = filteredPlatforms();
    $('#result-count').textContent = `${list.length} / ${PLATFORMS.length}`;

    if (!list.length) {
      $('#platform-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div>没有匹配的平台，试试放宽筛选或清空搜索。</div></div>`;
      return;
    }

    $('#platform-grid').innerHTML = list.map(p => {
      const qt = QUOTA_TYPES[p.quotaType];
      const flags = [
        p.needsCard ? '' : `<span class="ital" title="无需信用卡">免卡</span>`,
        p.confidence === 'disputed' ? `<span class="ital" title="口径存疑" style="background:var(--amber-soft);color:var(--amber)">存疑</span>` : ''
      ].join('');
      return `<div class="pcard" data-id="${p.id}">
        <div class="pcard-top">
          <div style="min-width:0">
            <div class="pcard-name">${esc(p.name)}</div>
            <div class="pcard-vendor">${esc(p.vendor)}</div>
          </div>
          <div class="pcard-flags">${flags}</div>
        </div>
        <div class="pcard-head">${esc(p.headline)}</div>
        <div class="pcard-meta">
          <span class="chip ${qt.color}"><i class="dot"></i>${esc(qt.short)}</span>
          <span class="chip ghost">${esc(CAT_LABEL[p.cat] || p.cat)}</span>
          <span class="chip ghost">${p.region === 'cn' ? '国内' : '海外'}</span>
        </div>
      </div>`;
    }).join('');

    $$('#platform-grid .pcard').forEach(c => {
      c.addEventListener('click', () => openDrawer(c.dataset.id));
    });
  }

  /* ---------------- 详情抽屉 ---------------- */
  function openDrawer(id) {
    const p = byId(id);
    if (!p) return;
    const qt = QUOTA_TYPES[p.quotaType];
    const conf = { verified: ['已验证', 'green'], reported: ['单一来源', 'amber'], disputed: ['口径存疑', 'red'] }[p.confidence];

    $('#drawer').innerHTML = `
      <div class="drawer-head">
        <div style="min-width:0">
          <h3>${esc(p.name)}</h3>
          <div class="dv">${esc(p.vendor)} · ${p.region === 'cn' ? '国内直连' : '海外'}</div>
        </div>
        <button class="drawer-close" id="drawer-x" aria-label="关闭">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
      <div class="drawer-body">
        <div class="dblock" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:16px">
          <span class="chip ${qt.color}"><i class="dot"></i>${esc(qt.label)}</span>
          <span class="chip ghost">${esc(CAT_LABEL[p.cat] || p.cat)}</span>
          <span class="chip ${conf[1]}">可信度：${conf[0]}</span>
          ${p.needsCard ? '<span class="chip red">需信用卡</span>' : '<span class="chip green">无需信用卡</span>'}
        </div>

        <div class="dblock">
          <h4>免费额度</h4>
          <p style="font-size:14px;font-weight:550;color:var(--ink)">${esc(p.headline)}</p>
        </div>

        <div class="dblock">
          <h4>限制与规则</h4>
          <p>${esc(p.limits)}</p>
        </div>

        <div class="dblock">
          <h4>重置节奏</h4>
          <p>${esc(resetInfo(p).text)} · ${esc(resetInfo(p).sub)}</p>
        </div>

        <div class="dblock">
          <h4>优势</h4>
          <ul>${(p.strengths || []).map(s => `<li class="plus">${esc(s)}</li>`).join('')}</ul>
        </div>

        <div class="dblock">
          <h4>局限</h4>
          <ul>${(p.caveats || []).map(s => `<li class="minus">${esc(s)}</li>`).join('')}</ul>
        </div>

        ${p.note ? `<div class="dblock"><h4>调度备注</h4><div class="dnote">${esc(p.note)}</div></div>` : ''}

        <div class="dblock">
          <h4>适合任务</h4>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${(p.tags || []).map(t => `<span class="ital" style="font-size:11px">${esc(TASK_TAGS[t] || t)}</span>`).join('')}
          </div>
        </div>

        <div class="dblock">
          <h4>来源</h4>
          <p class="mono" style="font-size:11.5px;color:var(--ink-3)">${esc(p.source)} · 核对于 ${DATA_DATE}</p>
        </div>

        <a class="btn-link" href="${esc(p.url)}" target="_blank" rel="noopener">
          打开控制台
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.5 8.5l5-5M4.5 3.5h4v4"/></svg>
        </a>
      </div>`;

    $('#drawer-mask').classList.add('on');
    $('#drawer').classList.add('on');
    $('#drawer-x').addEventListener('click', closeDrawer);
  }

  function closeDrawer() {
    $('#drawer-mask').classList.remove('on');
    $('#drawer').classList.remove('on');
  }

  /* ============================================================
     视图：任务路由（核心）
     ============================================================ */
  function renderRouterForm() {
    const tags = Object.entries(TASK_TAGS).filter(([k]) => k !== 'agent');
    $('#task-chips').innerHTML = tags.map(([k, v]) =>
      `<button class="task-chip${state.route.task === k ? ' on' : ''}" data-t="${k}">${esc(v)}</button>`
    ).join('');

    $$('#task-chips .task-chip').forEach(b => {
      b.addEventListener('click', () => {
        state.route.task = b.dataset.t;
        $$('#task-chips .task-chip').forEach(x => x.classList.toggle('on', x === b));
        runRoute();
      });
    });

    ['reqs', 'inTok', 'outTok'].forEach(k => {
      const el = $('#r-' + k);
      el.value = state.route[k];
      el.addEventListener('input', () => {
        state.route[k] = Math.max(1, parseInt(el.value, 10) || 1);
        runRoute();
      });
    });
  }

  function runRoute() {
    const { task, reqs, inTok, outTok } = state.route;
    const perReq = inTok + outTok;
    const demand = reqs * perReq;

    /* 候选：支持该任务、且额度可量化 */
    const cands = PLATFORMS
      .filter(p => (p.tags || []).includes(task))
      .map(p => {
        const { cap, basis, maxReq } = dailyCapacity(p, inTok, outTok);
        const qt = QUOTA_TYPES[p.quotaType];
        return { p, cap, basis, maxReq, qt, weight: qt.weight };
      })
      .filter(c => c.cap > 0)
      .sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return b.cap - a.cap;
      });

    /* 组合方案：优先可再生，最后才动一次性礼包
       注意要同时扣减「剩余 token」和「剩余请求次数」——
       只算 token 会高估可用平台（Gemini 这类 RPD 硬顶的会被算多）。 */
    const renewable = cands.filter(c => ['forever', 'daily', 'selfhost'].includes(c.p.quotaType));
    const oneShot = cands.filter(c => ['gift', 'trial'].includes(c.p.quotaType));

    let remaining = demand;
    let remReq = reqs;
    const plan = [];

    const fill = list => {
      for (const c of list) {
        if (remaining <= 0 || remReq <= 0) break;
        const reqRoom = c.maxReq === Infinity ? remReq : Math.min(remReq, c.maxReq);
        const tokRoom = Math.floor(c.cap / perReq);          // 该平台 token 额度能支撑的次数
        const takeReq = Math.min(reqRoom, tokRoom);
        if (takeReq <= 0) continue;
        const take = Math.min(remaining, takeReq * perReq);
        const realReq = Math.ceil(take / perReq);
        plan.push({ ...c, take, reqs: realReq });
        remaining -= take;
        remReq -= realReq;
      }
    };
    fill(renewable);
    fill(oneShot);

    const covered = demand - remaining;
    const pct = Math.round((covered / demand) * 100);

    /* 容灾备选：没被排进主方案、但同样能扛这类任务的平台。
       排除试用积分——一次性额度不适合当故障转移通道。 */
    const usedIds = new Set(plan.map(x => x.p.id));
    const standby = cands.filter(c =>
      !usedIds.has(c.p.id) && c.p.quotaType !== 'trial' && c.cap > 0
    ).slice(0, 4);

    let verdictCls, verdictHtml;
    if (remaining <= 0) {
      verdictCls = 'ok';
      verdictHtml = `<b>可以完全免费跑。</b>下面这 ${plan.length} 个平台叠加即可覆盖每日 ${fmt(demand)} tokens 的需求，
        不需要任何付费。注意它们限制的维度不同（速率 / 总量 / 并发），需要按顺序分派。`;
    } else if (pct >= 60) {
      verdictCls = 'warn';
      verdictHtml = `<b>免费额度覆盖 ${pct}%，还差 ${fmt(remaining)} tokens/日。</b>
        把剩余部分拆到更长尾的免费档，或降低单次输入体积（先做摘要再喂给模型），通常能把缺口补上。
        实在不够时，DeepSeek 这类低价 API 的边际成本极低（百万 token 几元），不一定要上订阅。`;
    } else {
      verdictCls = 'bad';
      verdictHtml = `<b>免费档只够 ${pct}%，缺口 ${fmt(remaining)} tokens/日。</b>
        这个量级已经超出「白嫖」范畴。要么把任务拆细、分批跑（用每日刷新型额度慢慢消化），
        要么换低价 API 按量付费——按 DeepSeek 的定价，这个量级月成本通常是几元到几十元。
        <b>不要为此买 $20/月 的订阅。</b>`;
    }

    $('#route-out').innerHTML = `
      <div class="demand-box">
        <div class="db-item"><b>${fmt(demand)}</b><span>每日需求 tokens</span></div>
        <div class="db-item"><b>${reqs}</b><span>次 / 日</span></div>
        <div class="db-item"><b>${fmt(perReq)}</b><span>单次 tokens</span></div>
        <div class="db-item"><b>${cands.length}</b><span>可选平台</span></div>
        <div class="db-item"><b>${fmt(covered)}</b><span>免费可覆盖</span></div>
      </div>
      <div class="verdict ${verdictCls}">${verdictHtml}</div>
      <div class="route-plan">
        ${plan.length ? plan.map((c, i) => {
          const pctOfDemand = Math.round((c.take / demand) * 100);
          return `<div class="route-row">
            <div class="route-idx">${i + 1}</div>
            <div style="min-width:0;flex:1">
              <div class="route-name">${esc(c.p.name)}
                <span class="chip ${c.qt.color}" style="margin-left:4px;font-size:9.5px;padding:1px 5px">${esc(c.qt.short)}</span>
              </div>
              <div class="route-sub">${esc(c.basis)}</div>
              <div class="bar"><i style="width:${Math.min(100, pctOfDemand)}%"></i></div>
            </div>
            <div class="route-cap">
              <b>${fmt(c.take)}</b><br>
              <span style="font-size:10px;color:var(--ink-3)">${c.reqs} 次 · 占 ${pctOfDemand}%</span>
            </div>
          </div>`;
        }).join('') : `<div class="empty-state">没有平台能承担这类任务的可量化额度，试试把单次 token 调小。</div>`}
      </div>
      ${remaining > 0 ? `<div style="margin-top:14px;padding:11px 13px;background:var(--red-soft);border-radius:8px;font-size:12px;color:#8a221c">
        <b>缺口 ${fmt(remaining)} tokens</b> — 建议：① 用 <kbd>先摘要后处理</kbd> 把单次输入压到 1/5；② 拆成多天分批跑；③ 接一个低价 API 兜底。
      </div>` : ''}
      ${standby.length ? `
        <div style="display:flex;align-items:baseline;gap:8px;margin:20px 0 8px">
          <h4 style="font-size:12.5px;font-weight:650">容灾备选</h4>
          <span style="font-size:11px;color:var(--ink-3)">主通道限速、429 或宕机时切这里</span>
        </div>
        <div class="route-plan">
          ${standby.map(c => `<div class="route-row" style="padding:8px 12px">
            <div style="min-width:0;flex:1">
              <div class="route-name" style="font-weight:550">${esc(c.p.name)}
                <span class="chip ${c.qt.color}" style="margin-left:4px;font-size:9.5px;padding:1px 5px">${esc(c.qt.short)}</span>
              </div>
              <div class="route-sub">${esc(c.basis)} · 独立限速池</div>
            </div>
            <div class="route-cap" style="font-size:12px">${c.cap === Infinity ? '∞' : fmt(c.cap)}</div>
          </div>`).join('')}
        </div>` : ''}
      ${plan.length === 1 ? `
        <div style="margin-top:12px;padding:10px 13px;background:var(--bg);border-radius:8px;font-size:11.5px;color:var(--ink-2);line-height:1.55">
          <b>单点依赖提醒：</b>当前方案只有一个平台承担全部流量。
          免费档普遍设有反滥用机制且政策随时可调，建议至少再配一个上面列出的备选，
          把一半请求量切过去做灰度——否则该平台一旦收紧额度，你的流水线会整体停摆。
        </div>` : ''}
    `;
  }

  /* ============================================================
     视图：我的额度
     ============================================================ */
  function renderWallet() {
    const entries = Object.entries(state.wallet).filter(([id]) => byId(id));

    if (!entries.length) {
      $('#wallet-list').innerHTML = `<div class="empty-state">还没有添加任何平台。</div>`;
    } else {
      $('#wallet-list').innerHTML = entries.map(([id, w]) => {
        const p = byId(id);
        const qt = QUOTA_TYPES[p.quotaType];
        const ri = resetInfo(p);
        const u = usageOf(p, w);
        const usage = u.mode === 'none' ? '' : `
          <div class="wu${u.over ? ' over' : ''}">
            <div class="wu-bar"><i style="width:${u.pct}%"></i></div>
            <div class="wu-line">
              <span class="wu-k">${u.mode === 'oneshot' ? '已用' : '今日已用'}</span>
              <input class="wu-input" data-wu="${id}" value="${esc(fmtTok(u.used))}"
                     inputmode="decimal" spellcheck="false"
                     aria-label="${esc(p.name)} 已用 token，可填 1.5万 / 200k">
              <span class="wu-total">/ ${esc(fmt(u.cap))}</span>
              <span class="wu-left">剩 ${esc(fmt(u.left))}${u.over ? ' · 已超额' : ''}</span>
            </div>
          </div>`;
        return `<div class="witem ${w.enabled ? '' : 'off'}">
          <button class="wtoggle ${w.enabled ? 'on' : ''}" data-wt="${id}" aria-label="启用/停用"></button>
          <div class="winfo">
            <b>${esc(p.name)}</b>
            <span>${esc(p.headline)}</span>
          </div>
          <div class="wright">
            <span class="chip ${qt.color}">${esc(qt.short)}</span>
            <div class="wreset">${esc(ri.text)}<small>${esc(ri.sub)}</small></div>
            <button class="drawer-close" data-wd="${id}" aria-label="移除" style="width:24px;height:24px;flex:0 0 24px">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="width:11px;height:11px"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
          </div>${usage}
        </div>`;
      }).join('');
    }

    /* 可添加的候选 */
    const avail = PLATFORMS.filter(p => !state.wallet[p.id]);
    $('#wallet-add').innerHTML = avail.length
      ? `<select id="wadd-sel">
           ${avail.map(p => `<option value="${p.id}">${esc(p.name)} — ${esc(QUOTA_TYPES[p.quotaType].short)}</option>`).join('')}
         </select>
         <button class="run-btn" id="wadd-btn" style="width:auto;padding:7px 16px">添加</button>`
      : `<span style="font-size:12px;color:var(--ink-3)">全部平台都已在清单中。</span>`;

    /* 汇总：一次性额度必须扣掉已用，否则「余量」两个字是假的（旧版按 tokensTotal 直接显示） */
    const activeEntries = entries.filter(([, w]) => w.enabled);
    const t = walletTotals(activeEntries, byId);

    $('#wallet-summary').innerHTML = `
      <div class="kpi"><div class="k-label">已启用</div>
        <div class="k-val">${activeEntries.length}<small>个</small></div>
        <div class="k-foot">清单共 ${entries.length} 个</div></div>
      <div class="kpi"><div class="k-label">可再生日额度</div>
        <div class="k-val k-green">${fmt(t.renewCap)}<small>tok/日</small></div>
        <div class="k-foot">每天回到满血的部分</div></div>
      <div class="kpi"><div class="k-label">今日已用</div>
        <div class="k-val">${fmt(t.usedToday)}<small>tok · ${t.dailyPct}%</small></div>
        <div class="k-foot">手动登记，跨天自动归零</div></div>
      <div class="kpi"><div class="k-label">一次性余量</div>
        <div class="k-val k-amber">${t.oneShotCap ? fmt(t.oneShotLeft) : '—'}${t.oneShotCap ? '<small>tok</small>' : ''}</div>
        <div class="k-foot">${t.oneShotCap ? `总量 ${fmt(t.oneShotCap)}，已烧掉 ${fmt(t.burned)}` : '清单里暂无礼包 / 试用额度'}</div></div>
      <div class="kpi"><div class="k-label">月度理论产能</div>
        <div class="k-val k-accent">${fmt(t.monthly)}<small>tok</small></div>
        <div class="k-foot">可再生 × 30 + 一次性余量</div></div>`;

    /* 事件 */
    $$('[data-wt]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.wt;
      state.wallet[id].enabled = !state.wallet[id].enabled;
      saveWallet(); renderWallet();
    }));
    $$('[data-wd]').forEach(b => b.addEventListener('click', () => {
      delete state.wallet[b.dataset.wd];
      saveWallet(); renderWallet();
    }));
    /* 用量登记：失焦或回车提交。解析不了就回退原值并闪一下红框，
       绝不静默当 0——静默清零会让「余量」凭空变多，比不填更误导。 */
    $$('[data-wu]').forEach(inp => {
      const id = inp.dataset.wu;
      const p = byId(id);
      const commit = () => {
        const next = applyUsage(p, state.wallet[id], inp.value);
        if (!next) {
          inp.value = fmtTok(usageOf(p, state.wallet[id]).used);
          inp.classList.add('bad');
          setTimeout(() => inp.classList.remove('bad'), 1000);
          return;
        }
        state.wallet[id] = next;
        saveWallet(); renderWallet();
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      });
    });
    const addBtn = $('#wadd-btn');
    if (addBtn) addBtn.addEventListener('click', () => {
      const id = $('#wadd-sel').value;
      state.wallet[id] = { enabled: true, used: 0, note: '' };
      saveWallet(); renderWallet();
    });
  }

  /* ============================================================
     钱包备份：导出 / 导入
     数据只存在浏览器里，换设备或清缓存就没了。导入必须先出预览，
     让人看清「会写入几个、覆盖几个」再动手，不能选完文件就直接写。
     ============================================================ */
  function walletIoMsg(html, kind) {
    const box = $('#wallet-io-msg');
    if (!box) return;
    if (!html) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="wio-msg ${kind || ''}">${html}</div>`;
  }

  function walletIoPreview(text) {
    const known = new Set(PLATFORMS.map(p => p.id));
    const r = parseWalletBackup(text, known);
    if (!r.ok) { walletIoMsg('导入失败：' + esc(r.error), 'err'); return; }

    const d = describeBackup(r.entries, state.wallet);
    const names = d.ids.slice(0, 6).map(id => (byId(id) || {}).name || id).join('、');
    const more = d.ids.length > 6 ? ` 等 ${d.ids.length} 个` : '';

    const box = $('#wallet-io-msg');
    box.innerHTML = `<div class="wio-card">
      <b>导入预览</b>
      <p>备份里有 <b>${d.total}</b> 个平台：${esc(names)}${esc(more)}。
        其中 <b>${d.existCount}</b> 个已在当前清单，<b style="color:var(--green)">${d.freshCount}</b> 个是新增。
        ${r.unknown.length ? `<br>另有 ${r.unknown.length} 个 id 不在平台库里，将被忽略。` : ''}
        ${r.bad ? `<br>有 ${r.bad} 条记录格式不对，已跳过。` : ''}</p>
      <div class="wio-actions">
        <button class="run-btn" data-wio="merge" style="width:auto;padding:7px 14px">合并（保留现有用量）</button>
        <button class="ghost-btn" data-wio="replace">覆盖（用备份替换全部）</button>
        <button class="ghost-btn" data-wio="cancel">取消</button>
      </div>
    </div>`;

    $$('[data-wio]').forEach(btn => btn.addEventListener('click', () => {
      const mode = btn.dataset.wio;
      if (mode === 'cancel') { walletIoMsg('已取消，数据没有变化。', 'mute'); return; }
      state.wallet = applyWalletBackup(state.wallet, r.entries, mode);
      saveWallet();
      renderWallet();
      $('#nav-count-wallet').textContent = Object.keys(state.wallet).length;
      walletIoMsg(mode === 'merge'
        ? `已合并：新增 ${d.freshCount} 个平台，原有用量保持不变。`
        : `已用备份替换全部清单，共 ${Object.keys(state.wallet).length} 个平台。`, 'ok');
    }));
  }

  function initWalletIO() {
    const exp = $('#wallet-export');
    if (exp) exp.addEventListener('click', () => {
      const text = JSON.stringify(walletPayload(state.wallet), null, 2);
      downloadFile(walletFileName(), text, 'application/json');
      walletIoMsg(`已导出 ${Object.keys(state.wallet).length} 个平台的备份（含用量登记）。`, 'ok');
    });

    const imp = $('#wallet-import');
    const file = $('#wallet-file');
    if (!imp || !file) return;

    imp.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) { walletIoMsg('文件超过 1 MB，多半不是本工具导出的备份。', 'err'); return; }
      const reader = new FileReader();
      reader.onload = () => { file.value = ''; walletIoPreview(String(reader.result)); };
      reader.onerror = () => { file.value = ''; walletIoMsg('读取文件失败，请重新导出后再试。', 'err'); };
      reader.readAsText(f);
    });
  }

  /* ============================================================
     视图：情报
     ============================================================ */
  function renderIntel() {
    $('#timeline').innerHTML = TIMELINE.slice().reverse().map(t => `
      <div class="tl-item ${t.level}">
        <div class="tl-date">${esc(t.date)}</div>
        <div class="tl-title">${esc(t.title)}</div>
        <div class="tl-body">${esc(t.detail)}</div>
      </div>`).join('');

    $('#pitfalls').innerHTML = PITFALLS.map(p => `
      <div class="pit"><b>${esc(p.title)}</b><p>${esc(p.body)}</p></div>`).join('');
  }

  /* ============================================================
     视图：重置日程
     ============================================================ */
  function renderSchedule() {
    const s = scheduleOf(PLATFORMS, state.wallet, new Date());
    const t = s.totals;
    const h = s.renew.items.length ? s.renew.items[0].hoursLeft : 0;
    const m = s.renew.items.length ? s.renew.items[0].minsLeft : 0;

    $('#sch-kpis').innerHTML = `
      <div class="kpi"><div class="k-label">今日可刷新</div>
        <div class="k-val k-green">${fmt(t.renewCap)}<small>tok/日</small></div>
        <div class="k-foot">${s.renew.items.length} 个每日型平台</div></div>
      <div class="kpi"><div class="k-label">今日已用</div>
        <div class="k-val">${fmt(t.renewUsed)}<small>tok</small></div>
        <div class="k-foot">今日还剩 ${fmt(t.renewLeft)}</div></div>
      <div class="kpi"><div class="k-label">一次性余量</div>
        <div class="k-val k-amber">${t.onceCap ? fmt(t.onceLeft) : '—'}${t.onceCap ? '<small>tok</small>' : ''}</div>
        <div class="k-foot">${t.onceCap ? `已用掉 ${fmt(t.onceUsed)}` : '清单里暂无礼包 / 试用'}</div></div>
      <div class="kpi"><div class="k-label">距离重置</div>
        <div class="k-val">${s.renew.items.length ? h + '<small>h</small> ' + m + '<small>m</small>' : '—'}</div>
        <div class="k-foot">按本地时间估算</div></div>`;

    $('#sch-advice').innerHTML = `<b>先做什么</b><span>${esc(scheduleAdvice(t))}</span>`;

    const row = (it, mode) => {
      let chip;
      if (mode === 'renew') {
        chip = it.exhausted
          ? '<span class="chip red">今天用完</span>'
          : `<span class="chip green">剩 ${esc(fmt(it.left))}</span>`;
      } else if (mode === 'cycle') {
        chip = `<span class="chip ghost">${esc(it.period)}</span>`;
      } else {
        chip = `<span class="chip ${it.left > 0 ? 'amber' : 'ghost'}">剩 ${esc(fmt(it.left))}</span>`;
      }
      const p = byId(it.id);
      const qt = p ? QUOTA_TYPES[p.quotaType] : { short: '' };
      return `<div class="sch-row${it.exhausted ? ' out' : ''}">
        <div class="sch-name">
          <b>${esc(it.name)}</b>
          <span>${esc(qt.short)} · 额度 ${esc(fmt(it.cap))}</span>
        </div>
        <div class="sch-meter"><i style="width:${it.pct}%"></i></div>
        <div class="sch-num"><span>已用 ${esc(fmt(it.used))}</span>${chip}</div>
      </div>`;
    };

    const fill = (sel, items, mode, emptyText) => {
      $(sel).innerHTML = items.length
        ? items.map(it => row(it, mode)).join('')
        : `<div class="sch-empty">${esc(emptyText)}</div>`;
    };

    fill('#sch-renew', s.renew.items, 'renew', '清单里还没有每日刷新的平台，先去「我的额度」把已开通的加进来。');
    fill('#sch-cycle', s.cycle.items, 'cycle', '当前清单里没有每周 / 每月刷新的平台。');
    fill('#sch-once', s.once.items, 'once', '当前清单里没有礼包或试用额度——没有会过期的东西，压力小一点。');
  }

  /* ============================================================
     路由 & 初始化
     ============================================================ */
  const VIEWS = {
    overview: { title: '总览', sub: '免费额度全景与关键判断', render: renderOverview },
    registry: { title: '平台库', sub: '按形态、区域、类型筛选', render: renderRegistry },
    router:   { title: '任务路由', sub: '按需求量算出免费方案', render: () => { renderRouterForm(); runRoute(); } },
    wallet:   { title: '我的额度', sub: '已开通清单与重置节奏', render: renderWallet },
    schedule: { title: '重置日程', sub: '谁今天刷新、谁只减不增', render: renderSchedule },
    intel:    { title: '情报与避坑', sub: '政策变更时间线', render: renderIntel }
  };

  function switchView(v) {
    if (!VIEWS[v]) return;
    state.view = v;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    $('#page-title').textContent = VIEWS[v].title;
    $('#page-sub').textContent = VIEWS[v].sub;
    VIEWS[v].render();
    saveUI();
    /* 可分享 / 可书签的视图地址；replaceState 在 file:// 下可能受限，忽略失败 */
    try { history.replaceState(null, '', '#' + v); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* 数据新鲜度：免费政策基本按月变，超过 30 天就该重新核。
     与其在文档里写一句「数据可能过期」然后靠人记，不如把它算出来挂在页脚。 */
  function renderFreshness() {
    const el = $('#data-age');
    if (!el) return;
    const days = Math.round((new Date() - new Date(DATA_DATE + 'T00:00:00')) / 86400000);
    if (!isFinite(days) || days < 0) { el.textContent = ''; return; }
    const stale = days > 30;
    el.textContent = days === 0 ? '（今天）' : `（${days} 天前）`;
    el.className = 'age' + (stale ? ' stale' : '');
    el.title = stale
      ? `数据距今 ${days} 天。免费政策通常按月调整，建议先到各平台控制台重新核对再决策。`
      : `数据距今 ${days} 天，仍在 30 天建议复核周期内。`;
  }

  /*__USAGE__*/

  /*__SCHEDULE__*/

  /*__WALLETIO__*/

  /*__CAP__*/

  /*__PIPE__*/

  /*__ORCH__*/
  /*__ACCESS__*/
  /*__VERIFY__*/

  /*__PALETTE__*/

  function init() {
    /* 侧栏计数 */
    $('#nav-count-reg').textContent = PLATFORMS.length;
    $('#nav-count-wallet').textContent = Object.keys(state.wallet).length;
    $('#data-date').textContent = DATA_DATE;
    renderFreshness();
    initPalette();
    initWalletIO();

    $$('.nav-item').forEach(b => b.addEventListener('click', () => switchView(b.dataset.v)));

    const searchEl = $('#search');
    if (searchEl) {
      searchEl.value = state.search;
      searchEl.addEventListener('input', e => {
        state.search = e.target.value;
        if (state.view !== 'registry') switchView('registry');
        else { renderRegistry(); saveUI(); }
      });
    }

    $('#drawer-mask').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDrawer();
    });

    /* 优先级：URL hash（可分享链接） > 上次停留的视图 > 总览 */
    const hash = (location.hash || '').replace('#', '');
    const initial = hash || (VIEWS[ui.view] ? ui.view : '');
    switchView(VIEWS[initial] ? initial : 'overview');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
