/* ============================================================
   全局跳转面板（Ctrl/Cmd + K）
   ------------------------------------------------------------
   解决的是「东西太多找不到」：10 个视图、48 个平台、23 家厂商、12 个模型，
   靠翻侧栏和肉眼扫卡片太慢。这里做一张统一索引，键入即筛，回车直达。

   索引在每次打开时重建（80 来条，成本可忽略），而不是在脚本加载时算死——
   因为 orchestrator / access / verify 是在 app.js 之后才往 VIEWS 里注册视图的，
   加载期建索引会漏掉后面几个视图。
   ============================================================ */

const CM_KIND_ORDER = { view: 0, platform: 1, vendor: 2, model: 3 };

let CM_INDEX = [];
let CM_ITEMS = [];
let CM_ACTIVE = 0;
let CM_OPEN = false;

/* ---------- 建索引 ---------- */
function cmBuildIndex() {
  const items = [];

  Object.keys(VIEWS).forEach(id => {
    const v = VIEWS[id];
    items.push({
      kind: 'view', id, title: v.title, sub: v.sub || '',
      hay: (v.title + ' ' + (v.sub || '') + ' ' + id).toLowerCase()
    });
  });

  PLATFORMS.forEach(p => {
    const qt = QUOTA_TYPES[p.quotaType] || {};
    const tags = (p.tags || []).map(t => TASK_TAGS[t] || t).join(' ');
    items.push({
      kind: 'platform', id: p.id, title: p.name,
      sub: [p.vendor, qt.label].filter(Boolean).join(' · '),
      hay: [p.name, p.vendor, p.headline, p.id, qt.label, tags, (p.strengths || []).join(' ')]
        .join(' ').toLowerCase()
    });
  });

  /* 厂商与模型来自后注入的模块，用 try 包住：单独加载某个模块做测试时会缺。 */
  try {
    if (typeof VENDOR_ACCESS !== 'undefined') {
      VENDOR_ACCESS.forEach(v => items.push({
        kind: 'vendor', id: v.id, title: v.name,
        sub: v.base || v.console || '',
        hay: [v.name, v.vendor, v.id, v.base, v.env, (v.models || []).join(' ')]
          .join(' ').toLowerCase()
      }));
    }
  } catch (e) { /* 无核验模块时不提供厂商条目 */ }

  try {
    if (typeof MODELS !== 'undefined') {
      MODELS.forEach(m => items.push({
        kind: 'model', id: m.id, title: m.name,
        sub: [m.vendor, m.params ? m.params + ' 参数' : '', m.ctx ? '上下文 ' + m.ctx : '']
          .filter(Boolean).join(' · '),
        hay: [m.name, m.vendor, m.id].join(' ').toLowerCase()
      }));
    }
  } catch (e) { /* 无能力画像模块时不提供模型条目 */ }

  return items;
}

/* ---------- 打分 ----------
   关键教训：子序列匹配只能作用在「名称」上。
   之前拿整条 hay（名称+厂商+base_url+env+模型列表）做子序列，
   输入 kimi 时 DeepSeek 也会命中——因为 "deepseek ... https://api.deepseek.com"
   里 k 后面依次能找到 i、m、i。这种假阳性比搜不到更烦人。 */
function cmScore(q, it) {
  if (!q) return 1;

  const name = it.title.toLowerCase();
  let i = name.indexOf(q);
  if (i === 0) return 1000;                    /* 名称前缀命中 */
  if (i > 0) return 820 - Math.min(i, 200);    /* 名称中间命中 */

  const h = it.hay.indexOf(q);
  if (h >= 0) {
    const before = it.hay[h - 1] || ' ';
    const boundary = before === ' ' || '·/('.indexOf(before) >= 0;
    return (boundary ? 620 : 520) - Math.min(h, 300);
  }

  /* 名称内的子序列兜底：'k3' 能命中 'Kimi K3'，但不会跨字段乱命中 */
  let p = 0;
  for (const ch of q.replace(/\s+/g, '')) {
    p = name.indexOf(ch, p);
    if (p < 0) return 0;
    p++;
  }
  return 220;
}

/* ---------- 排序分组（纯函数，供单测直接调用） ---------- */
function cmRank(index, q) {
  q = (q || '').trim().toLowerCase();   /* 纯函数自己归一化，别指望调用方先转小写 */
  /* 空查询只给「视图 + 前 10 个平台」：58 个平台全铺出来会把视图挤没，
     而厂商/模型属于精确查找，本来就应该带着关键词来。 */
  if (!q) {
    const views = index.filter(i => i.kind === 'view');
    const plats = index.filter(i => i.kind === 'platform').slice(0, 10);
    const g = [];
    if (views.length) g.push({ kind: 'view', items: views });
    if (plats.length) g.push({ kind: 'platform', items: plats });
    return g;
  }

  const scored = [];
  index.forEach(it => {
    const s = cmScore(q, it);
    if (s > 0) scored.push({ it, s });
  });
  scored.sort((a, b) => b.s - a.s || CM_KIND_ORDER[a.it.kind] - CM_KIND_ORDER[b.it.kind]);

  const out = scored.slice(0, 40).map(x => x.it);
  /* 分组时按 视图/平台/厂商/模型 排，组内保持相关度顺序 */
  const groups = { view: [], platform: [], vendor: [], model: [] };
  out.forEach(it => groups[it.kind].push(it));
  return ['view', 'platform', 'vendor', 'model']
    .filter(k => groups[k].length)
    .map(k => ({ kind: k, items: groups[k] }));
}

function cmRender() {
  const qEl = $('#cmdk-q');
  const q = (qEl ? qEl.value : '').trim().toLowerCase();
  const groups = cmRank(CM_INDEX, q);
  CM_ITEMS = [];
  const list = $('#cmdk-list');

  if (!groups.length) {
    list.innerHTML = `<div class="cmdk-empty">
      <b>没有匹配「${esc(q)}」的结果</b>
      <span>试试平台名（kimi / 火山）、厂商（OpenAI）、模型（K3）或视图名（核验）</span>
    </div>`;
    return;
  }

  const LABEL = { view: '视图', platform: '平台', vendor: '厂商（接入核验）', model: '模型（能力画像）' };
  const ICON = {
    view: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 7h12"/>',
    platform: '<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M5 6h6M5 9h4"/>',
    vendor: '<path d="M8 1.8l5 2v4.4c0 3-2.1 5.4-5 6-2.9-.6-5-3-5-6V3.8z"/>',
    model: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v7M4.5 6.5h7M4.5 9.5h7"/>'
  };

  list.innerHTML = groups.map(g => `
    <div class="cmdk-group">
      <div class="cmdk-glabel">${LABEL[g.kind]}</div>
      ${g.items.map(it => {
        const i = CM_ITEMS.push(it) - 1;
        return `<button class="cmdk-item${i === CM_ACTIVE ? ' on' : ''}" data-i="${i}">
          <span class="cmdk-ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
            stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICON[it.kind]}</svg></span>
          <span class="cmdk-txt"><b>${esc(it.title)}</b><span>${esc(it.sub || '')}</span></span>
          <span class="cmdk-enter">↵</span>
        </button>`;
      }).join('')}
    </div>`).join('');

  $$('.cmdk-item', list).forEach(btn => {
    btn.addEventListener('mouseenter', () => cmSetActive(+btn.dataset.i, false));
    btn.addEventListener('click', () => cmRun(+btn.dataset.i));
  });

  if (!q) {
    const vn = CM_INDEX.filter(i => i.kind === 'vendor').length;
    const mn = CM_INDEX.filter(i => i.kind === 'model').length;
    list.insertAdjacentHTML('beforeend',
      `<div class="cmdk-tip">继续输入可搜 <b>${vn}</b> 家厂商的接入信息与 <b>${mn}</b> 个模型的能力画像</div>`);
  }

  if (CM_ACTIVE >= CM_ITEMS.length) CM_ACTIVE = Math.max(0, CM_ITEMS.length - 1);
  cmMark();
}

function cmMark() {
  $$('.cmdk-item').forEach(b => b.classList.toggle('on', +b.dataset.i === CM_ACTIVE));
  const cur = $(`.cmdk-item[data-i="${CM_ACTIVE}"]`);
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function cmSetActive(i, scroll = true) {
  CM_ACTIVE = i;
  if (scroll) cmMark();
  else {
    $$('.cmdk-item').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
  }
}

/* ---------- 执行 ---------- */
function cmRun(i) {
  const it = CM_ITEMS[i];
  if (!it) return;
  cmClose();

  if (it.kind === 'view') { switchView(it.id); return; }

  if (it.kind === 'platform') { openDrawer(it.id); return; }

  if (it.kind === 'vendor') {
    /* 跳到接入核验并把搜索框直接填成这家厂商 */
    switchView('verify');
    const q = $('#verify-q');
    if (q) {
      q.value = it.title;
      q.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  if (it.kind === 'model') {
    switchView('capability');
    /* 视图渲染完再定位到对应卡片 */
    requestAnimationFrame(() => {
      const card = $(`[data-model="${it.id}"]`) || $(`#cap-${it.id}`);
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
}

/* ---------- 开 / 关 ---------- */
function cmOpen() {
  CM_INDEX = cmBuildIndex();
  CM_ITEMS = [];
  CM_ACTIVE = 0;
  const mask = $('#cmdk');
  if (!mask) return;
  mask.classList.add('on');
  mask.setAttribute('aria-hidden', 'false');
  const q = $('#cmdk-q');
  if (q) { q.value = ''; }
  cmRender();
  if (q) setTimeout(() => q.focus(), 20);
  CM_OPEN = true;
}

function cmClose() {
  const mask = $('#cmdk');
  if (!mask) return;
  mask.classList.remove('on');
  mask.setAttribute('aria-hidden', 'true');
  CM_OPEN = false;
}

function cmToggle() {
  if (CM_OPEN) cmClose(); else cmOpen();
}

/* ---------- 初始化 ---------- */
function initPalette() {
  if ($('#cmdk')) return;

  const mask = document.createElement('div');
  mask.className = 'cmdk-mask';
  mask.id = 'cmdk';
  mask.setAttribute('aria-hidden', 'true');
  mask.innerHTML = `
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="全局跳转">
      <div class="cmdk-bar">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14 14"/></svg>
        <input id="cmdk-q" type="text" autocomplete="off" spellcheck="false"
               placeholder="搜索视图、平台、厂商、模型…" aria-label="搜索">
        <kbd>Esc</kbd>
      </div>
      <div class="cmdk-list" id="cmdk-list"></div>
      <div class="cmdk-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>↵</kbd> 打开</span>
        <span><kbd>Ctrl</kbd><kbd>K</kbd> 开关</span>
      </div>
    </div>`;
  document.body.appendChild(mask);

  mask.addEventListener('mousedown', e => { if (e.target === mask) cmClose(); });

  const q = $('#cmdk-q');
  q.addEventListener('input', () => { CM_ACTIVE = 0; cmRender(); });

  document.addEventListener('keydown', e => {
    /* IME 组字期间的回车交给输入法，别抢 */
    if (e.isComposing) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      cmToggle();
      return;
    }
    if (!CM_OPEN) return;

    if (e.key === 'Escape') { e.preventDefault(); cmClose(); }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (CM_ITEMS.length) cmSetActive((CM_ACTIVE + 1) % CM_ITEMS.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (CM_ITEMS.length) cmSetActive((CM_ACTIVE - 1 + CM_ITEMS.length) % CM_ITEMS.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      cmRun(CM_ACTIVE);
    }
  });

  /* 顶栏入口按钮：快捷键要能被发现，不能只藏在文档里 */
  const hint = $('#cmdk-open');
  if (hint) hint.addEventListener('click', cmOpen);
}
