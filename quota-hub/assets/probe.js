/* ============================================================
   自动探活结果展示（Probe）
   ------------------------------------------------------------
   解决的问题：整站最弱的一环是「数据的日期」。别人每 6 小时探活、
   每天巡检，而这里的额度表停在「核对至某日」。
   probe.json 由 GitHub Actions 定时生成，这一页只做两件事：
     1) 告诉你这份数据有多新（以及是不是本地快照）
     2) 告诉你哪些端点是通的、哪些 base_url 已经 404
   两种数据源：构建时内联的快照（离线可用）+ 运行时 fetch 同目录
   probe.json（线上版拿最新的）。file:// 下 fetch 会被浏览器拦，
   所以必须有快照兜底，否则本地打开永远是一片空白。
   ============================================================ */

const PROBE_STATUS = {
  ok:          { label: '可访问',  cls: 'green', why: '带 key 拿到 200，端点和密钥都对' },
  auth:        { label: '需鉴权',  cls: 'slate', why: '端点存在且要求鉴权（401/403）。没配 key 时这是正常结果——路是对的' },
  badkey:      { label: 'key 无效', cls: 'red',   why: '带了 key 仍 401/403，去控制台重新生成' },
  forbidden:   { label: '被拒绝',  cls: 'red',   why: '403：服务器拒绝了请求。多半是地域封锁或 IP 限制，也可能 key 没有该模型权限——换 key 未必有用' },
  notfound:    { label: '404',     cls: 'red',   why: '端点不存在：base_url 或路径写错了，跟 key 无关' },
  ratelimited: { label: '限流',    cls: 'amber', why: '429：配置没问题，只是额度或频率到了' },
  server:      { label: '5xx',     cls: 'amber', why: '对方服务端故障，隔一轮再看' },
  unreachable: { label: '未连通',  cls: 'ghost', why: '执行环境到不了这个地址。可能是网络或地域限制，不等于平台挂了' },
  error:       { label: '异常',    cls: 'ghost', why: '' },
  skipped:     { label: '未探',    cls: 'ghost', why: '本次没有发起请求' }
};

/* 有问题的排前面：探活的意义就是先看坏消息 */
const PROBE_ORDER = ['notfound', 'badkey', 'forbidden', 'ratelimited', 'server', 'unreachable', 'error', 'auth', 'ok', 'skipped'];

const PROBE_STATE = {
  data: (typeof PROBE_SNAPSHOT !== 'undefined' ? PROBE_SNAPSHOT : null),
  source: 'snapshot',
  err: '',
  tried: false
};

function probeHours(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!t) return null;
  return (Date.now() - t) / 3600000;
}

function probeAgo(iso) {
  const h = probeHours(iso);
  if (h == null) return '时间不明';
  if (h < 0.08) return '刚刚';
  if (h < 1) return Math.round(h * 60) + ' 分钟前';
  if (h < 24) return Math.round(h) + ' 小时前';
  return Math.round(h / 24) + ' 天前';
}

function probeFreshness(iso) {
  const h = probeHours(iso);
  if (h == null) return { cls: 'ghost', text: '时间不明' };
  if (h <= 8) return { cls: 'green', text: '新鲜' };
  if (h <= 24) return { cls: 'amber', text: '偏旧' };
  return { cls: 'red', text: '已过期' };
}

/* 卡片一行放不下「百度千帆（文心）」这种全名，去掉括号补语显示，全名放 title。
   不直接截断是因为截断会把 Anthropic (Claude) 变成 "Anthropic (Clau..."，
   括号开着更难看，也不易辨认。 */
function probeShortName(n) {
  const s = String(n == null ? '' : n).replace(/[（(][^）)]*[）)]/g, '').trim();
  return s.length >= 2 ? s : String(n == null ? '' : n);
}

function probeNames() {
  const m = {};
  (typeof VENDOR_ACCESS !== 'undefined' ? VENDOR_ACCESS : []).forEach(v => { m[v.id] = v.name; });
  return m;
}

function renderProbe() {
  const host = $('#probe-body');
  if (!host) return;
  const d = PROBE_STATE.data;

  if (!d || !d.results) {
    host.innerHTML = `
      <div class="probe-empty">
        <b>还没有探活数据</b>
        <p>仓库根的 <code class="mono">probe.json</code> 由 GitHub Actions 每 6 小时更新一次。
           浏览器在本地打开文件时不允许读同目录文件，所以这里读不到——用线上版，或者选一份你本地的 probe.json。</p>
        <div class="probe-acts">
          <button class="ghost-btn" id="probe-reload">重新读取</button>
          <button class="ghost-btn" id="probe-pick">选择本地 probe.json</button>
          <input type="file" id="probe-file" accept="application/json,.json" hidden>
        </div>
      </div>`;
    probeBind();
    return;
  }

  const results = d.results;
  const ids = Object.keys(results);
  const names = probeNames();
  const fresh = probeFreshness(d.generatedAt);
  const c = d.counts || {};
  const bad = (c.notfound || 0) + (c.badkey || 0);
  const srcText = PROBE_STATE.source === 'live' ? '线上实时读取'
    : PROBE_STATE.source === 'file' ? '你选择的本地文件'
    : '构建时内联的快照';

  const items = ids.slice().sort((a, b) => {
    const ra = PROBE_ORDER.indexOf((results[a] || {}).status);
    const rb = PROBE_ORDER.indexOf((results[b] || {}).status);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });

  host.innerHTML = `
    <div class="probe-top">
      <div class="probe-when">
        <span class="chip ${fresh.cls}">${esc(fresh.text)}</span>
        <b>${esc(probeAgo(d.generatedAt))}</b>
        <span class="probe-at">${esc(String(d.generatedAt || '').replace('T', ' ').replace('Z', ' UTC'))}</span>
      </div>
      <div class="probe-chips">
        <span class="chip ghost">来源 · ${esc(srcText)}</span>
        <span class="chip ghost">执行环境 · ${esc(d.runner || '未知')}</span>
        <span class="chip ghost">探到 ${esc(String(d.probed != null ? d.probed : ids.length))} / ${esc(String(d.total || ids.length))}</span>
      </div>
    </div>

    <div class="probe-counts">
      ${PROBE_ORDER.filter(s => c[s]).map(s => `
        <span class="probe-c"><i class="probe-dot ${PROBE_STATUS[s].cls}"></i>${PROBE_STATUS[s].label} <b>${c[s]}</b></span>`).join('')}
    </div>

    ${bad ? `<div class="probe-alert">有 ${bad} 家需要你看一眼：${(c.notfound ? `404 ${c.notfound} 家（endpoint 写错）` : '')}${c.notfound && c.badkey ? '，' : ''}${(c.badkey ? `key 无效 ${c.badkey} 家` : '')}。这两类都是「配置错」，不是「平台挂了」。</div>` : ''}

    <div class="probe-grid">
      ${items.map(id => {
        const r = results[id] || {};
        const st = PROBE_STATUS[r.status] || PROBE_STATUS.error;
        const bits = [];
        if (r.http) bits.push('HTTP ' + r.http);
        if (r.ms) bits.push(r.ms + 'ms');
        if (r.models) bits.push(r.models + ' 个模型');
        const full = names[id] || id;
        return `<div class="probe-item st-${st.cls}" title="${esc(full + ' · ' + st.why + (r.detail ? '：' + r.detail : ''))}">
          <i class="probe-dot ${st.cls}"></i>
          <span class="probe-name">${esc(probeShortName(full))}</span>
          <span class="probe-st">${esc(st.label)}</span>
          <span class="probe-sub">${esc(bits.join(' · '))}</span>
        </div>`;
      }).join('')}
    </div>

    <div class="probe-foot">
      <p><b>401/403 不是故障。</b>没配 key 时探到「需鉴权」说明端点存在、路径正确——真正要修的是 404（base_url 写错）和「key 无效」（带 key 仍 401）。</p>
      <p><b>探的是「路」，不是「量」。</b>用 <code class="mono">GET /models</code>，不消耗 token、不占生成额度，所以它只能证明接得通，证明不了还剩多少。</p>
      <p><b>执行环境会影响结果。</b>GitHub Actions 是海外 runner，境内平台在那边可能慢或被拦，表现为「未连通」——这代表公网可达性，不代表你在境内访问的真实质量。想拿到本地视角，就在自己机器上跑 <code class="mono">python quota-hub/probe/probe.py</code>。</p>
      ${PROBE_STATE.err ? `<p class="probe-err">读取线上 probe.json 失败：${esc(PROBE_STATE.err)}，当前显示的是${esc(srcText)}。</p>` : ''}
    </div>

    <div class="probe-acts">
      <button class="ghost-btn" id="probe-reload">重新读取线上数据</button>
      <button class="ghost-btn" id="probe-pick">载入本地 probe.json</button>
      <input type="file" id="probe-file" accept="application/json,.json" hidden>
    </div>`;

  probeBind();
}

function probeBind() {
  const re = $('#probe-reload');
  if (re) re.addEventListener('click', () => { PROBE_STATE.tried = false; probeFetch(); });

  const pick = $('#probe-pick');
  const file = $('#probe-file');
  if (pick && file) {
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const j = JSON.parse(rd.result);
          if (!j || !j.results) throw new Error('这不是 probe.json（缺 results 字段）');
          PROBE_STATE.data = j;
          PROBE_STATE.source = 'file';
          PROBE_STATE.err = '';
        } catch (e) {
          PROBE_STATE.err = e.message;
        }
        renderProbe();
      };
      rd.readAsText(f);
    });
  }
}

function probeFetch() {
  if (PROBE_STATE.tried) return;
  PROBE_STATE.tried = true;
  if (typeof fetch !== 'function' || location.protocol === 'file:') {
    /* 本地打开时不必发请求，浏览器一定会拦，直接用快照 */
    PROBE_STATE.source = PROBE_STATE.data ? 'snapshot' : 'none';
    PROBE_STATE.err = PROBE_STATE.data ? '' : '本地打开无法读取 probe.json';
    renderProbe();
    return;
  }
  fetch('./probe.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => {
      if (!j || !j.results) throw new Error('格式不对');
      PROBE_STATE.data = j;
      PROBE_STATE.source = 'live';
      PROBE_STATE.err = '';
      renderProbe();
    })
    .catch(e => {
      PROBE_STATE.err = e.message || String(e);
      PROBE_STATE.source = PROBE_STATE.data ? 'snapshot' : 'none';
      renderProbe();
    });
}
