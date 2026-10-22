/* ============================================================
   接入向导 + 一键配置脚本生成（纯函数）
   ------------------------------------------------------------
   为什么要重做：原来的接入通道是「矩阵」——3 类额度、5 条路径、3 种网关、
   23 家速查表全铺开，把判断权丢回给用户。用户要的是「我该怎么做」，
   不是「有这么多种做法」。

   这里做两件事：
     1. 两个问题 → 唯一推荐路径 + 最多 3 步 + 一条可复制命令
     2. 粘贴 key → 生成「写入环境变量 + 自检」的合并命令（bash / PowerShell）

   安全边界：key 只参与拼字符串，不落 localStorage、不发网络请求。
   自检命令本身用 GET /models，不消耗 token、不占生成额度。
   ============================================================ */

const ONBOARD_GOALS = [
  { id: 'script', label: '脚本 / 自动化', desc: '调度、批处理、跑项目流水线' },
  { id: 'chat',   label: '聊天 / 写作',   desc: '打开就能用，不写代码' },
  { id: 'ide',    label: '写代码时用',    desc: '编辑器里补全和问答' }
];

const ONBOARD_COMFORT = [
  { id: 'shell',  label: '命令行没问题' },
  { id: 'onecmd', label: '能粘贴一条命令' },
  { id: 'nogui',  label: '不想碰命令行' }
];

/* 推荐规则表。顺序有意义：先判「完全不想碰命令行」，因为这类用户
   无论目标是什么，答案都不该是「先装个网关」。 */
function recommendAccess(goal, comfort) {
  const g = goal || 'script';
  const c = comfort || 'onecmd';

  if (g === 'chat') {
    if (c === 'nogui') {
      return {
        pathId: 'web',
        title: '直接用网页版，零配置',
        minutes: 0,
        why: '聊天不需要 API。网页版额度跟账号走，不消耗 key、不产生对接环节。',
        steps: ['挑一个免费额度最大的网页版（总览页有排序）', '注册登录即可', '要长期用就把它加成浏览器书签'],
        caveat: '网页版不能被脚本调用。哪天要自动化，再回来看「脚本」这一栏。',
        command: ''
      };
    }
    return {
      pathId: 'web',
      title: '网页版为主，需要批量时再上 API',
      minutes: 0,
      why: '日常聊天用网页版最省事；只有「一次处理很多篇」时 API 才划算。',
      steps: ['先用网页版', '遇到要批量的场景，再用「粘贴 key 一次配好」生成配置', '自检通过后跑一次小样本'],
      caveat: '网页版和 API 的额度是两套，别把网页额度算进脚本产能。',
      command: ''
    };
  }

  if (g === 'ide') {
    return {
      pathId: 'ide',
      title: '用编辑器插件，登录就有额度',
      minutes: 5,
      why: 'IDE 插件是这类需求里环节最少的：装插件、登录，结束。不用管 base_url 和 key。',
      steps: ['装一个带免费档的插件（Copilot Free / Cursor / Trae / 通义灵码）', '用账号登录，免费额度自动生效', '在编辑器里直接用'],
      caveat: '额度锁在编辑器里，换工具作废，也没法被脚本调用。要脚本化必须走 API 或网关。',
      command: ''
    };
  }

  /* 剩下的都是「脚本 / 自动化」。脚本必然要跑命令，所以 comfort=nogui 时
     只能如实说清楚，并把环节压到「一次配置、以后不用碰」。 */
  if (c === 'shell') {
    return {
      pathId: 'gateway',
      title: '本地网关：N 个 key 收成 1 个端点',
      minutes: 15,
      why: '脚本只认一个 base_url + 一个 key。以后加平台改配置就行，脚本一行不用动——这是环节最少的长期方案。',
      steps: ['导出网关配置（本页下方按钮），把已有 key 填进去', '起 LiteLLM（一行命令，见生成脚本）', '脚本统一打 http://localhost:4000/v1'],
      caveat: '代价是要常驻一个进程。换来多 key 负载均衡、429 自动换家、按平台记账。',
      command: 'gateway'
    };
  }

  if (c === 'onecmd') {
    return {
      pathId: 'aggregator',
      title: '先用一个聚合 key 跑通，再决定要不要自建',
      minutes: 5,
      why: '一个 key 就能调几十家模型，第一步只花「注册 + 复制 key」的时间，不用一开始就搭网关。',
      steps: ['注册聚合商（如 OpenRouter）并生成一个 key', '用下面的「粘贴 key 一次配好」生成环境变量与自检命令', '跑通后再决定是否换直连或自建网关'],
      caveat: '聚合商的免费档有每日硬顶且会缩，关键任务别只押它。',
      command: 'agg'
    };
  }

  return {
    pathId: 'gateway',
    title: '一次性配好，之后不用碰命令行',
    minutes: 20,
    why: '脚本必须能被程序调用，这一步绕不开。但如果用网关，命令行只在「第一次搭」时出现一次，之后所有脚本只改一个端点。',
    steps: ['找一台常开的机器（或就用本机）', '跑一次生成的网关启动脚本', '以后新增平台只改 YAML，不再碰命令行'],
    caveat: '如果完全不想碰命令行，也可以先用 GUI 客户端（Cherry Studio / Chatbox 这类支持自定义端点的）顶着，等确有批处理需求再上网关。',
    command: 'gateway'
  };
}

/* ---------------- 脚本生成 ---------------- */

/* 单引号包裹：内部单引号用 '\'' 转义，避免 key 里带引号把命令截断 */
function shq(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "'\\''") + "'";
}

/* PowerShell 单引号字符串：内部单引号翻倍 */
function psq(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
}

/* 该厂商用哪种鉴权方式自检。
   Anthropic 不认 Bearer，必须 x-api-key + anthropic-version，
   按 Bearer 去测会拿到 401，让人误以为 key 错了。 */
function vendorAuthMode(v) {
  if (!v || !v.base) return 'none';
  if (v.probe === 'anthropic' || v.id === 'anthropic') return 'anthropic';
  return 'bearer';
}

/* 自检用哪个 URL。只有 probe === 'models' 才有 GET /models 这种零消耗探针；
   probe === 'chat' 的平台没有 models 端点，只能发一次最小对话（会消耗额度），
   所以这里如实标注，不假装能零成本自检。 */
function probeTarget(v) {
  const base = (v.base || '').replace(/\/$/, '');
  if (!base) return { url: '', kind: 'none' };
  if (v.probe === 'models') return { url: base + '/models', kind: 'models' };
  if (v.probe === 'anthropic') return { url: base + '/models', kind: 'anthropic' };
  return { url: base, kind: 'chat' };
}

function buildVendorEnvScript(v, key, shell) {
  if (!v) return '';
  const mode = vendorAuthMode(v);
  const t = probeTarget(v);
  const envName = v.env || 'API_KEY';
  const k = key || '在这里粘贴你的 key';
  const sh = shell === 'ps' ? 'ps' : 'bash';

  if (mode === 'none') {
    return sh === 'ps'
      ? `# ${v.name}：没有固定端点（取决于你选的推理服务商），无法生成一键自检命令。\n# 请先确定推理商，再用它的 base_url 配置。`
      : `# ${v.name}：没有固定端点（取决于你选的推理服务商），无法生成一键自检命令。\n# 请先确定推理商，再用它的 base_url 配置。`;
  }

  if (sh === 'bash') {
    const lines = [
      `# ${v.name} · 一次配好（重复执行只覆盖，不会重复追加）`,
      `mkdir -p "$HOME/.config/quota-hub"`,
      `cat > "$HOME/.config/quota-hub/${v.id}.env" <<'QUOTA_HUB_ENV'`,
      `export ${envName}=${shq(k)}`,
      `QUOTA_HUB_ENV`,
      `. "$HOME/.config/quota-hub/${v.id}.env"`,
      ``,
      `# 自检（${t.kind === 'models' || t.kind === 'anthropic' ? 'GET /models，不消耗 token、不占生成额度' : '该平台没有 /models 端点，下面这条只验证连通性'}）`
    ];
    if (t.kind === 'anthropic') {
      lines.push(
        `curl -sS -o /dev/null -w 'HTTP %{http_code}\\n' \\`,
        `  -H "x-api-key: $${envName}" -H "anthropic-version: 2023-06-01" \\`,
        `  ${t.url}`
      );
    } else {
      lines.push(
        `curl -sS -o /dev/null -w 'HTTP %{http_code}\\n' \\`,
        `  -H "Authorization: Bearer $${envName}" \\`,
        `  ${t.url}`
      );
    }
    if (t.kind === 'chat') {
      lines.push(`# 注意：这个端点没有 /models，测连通只能发一次最小对话，会计 1 次请求`);
    }
    lines.push(`# 200=通 / 401=key 无效 / 403=没开通该模型或地域不对 / 404=base_url 写错`);
    return lines.join('\n');
  }

  /* PowerShell 分支刻意全用 ASCII，这不是偷懒，是踩出来的：
     Windows PowerShell 5.1 读取「无 BOM 的 UTF-8」文件时按 ANSI 解码，
     中文被拆成乱码字节，落在字符串里会把结尾引号吃掉 → 整个脚本解析失败
     （实测报「字符串缺少终止符」，且错误指向 catch 那一行，极难联想）。
     用户从网页复制到 .ps1 时拿不到 BOM，所以这里不赌编码；
     bash 侧是 UTF-8 原生，中文注释不受影响。 */
  const psLines = [
    `# ${v.id} - writes an env file, then self-tests (safe to re-run)`,
    `New-Item -ItemType Directory -Force "$env:USERPROFILE\\.config\\quota-hub" | Out-Null`,
    `@'`,
    `$env:${envName} = ${psq(k)}`,
    `'@ | Set-Content -Encoding utf8 "$env:USERPROFILE\\.config\\quota-hub\\${v.id}.ps1"`,
    `. "$env:USERPROFILE\\.config\\quota-hub\\${v.id}.ps1"`,
    ``,
    `# Self-test: GET /models does not consume tokens`
  ];
  if (t.kind === 'anthropic') {
    psLines.push(
      `$headers = @{ 'x-api-key' = $env:${envName}; 'anthropic-version' = '2023-06-01' }`
    );
  } else {
    psLines.push(`$headers = @{ Authorization = "Bearer $env:${envName}" }`);
  }
  psLines.push(
    `try {`,
    `  $r = Invoke-WebRequest -Uri ${psq(t.url)} -Headers $headers -UseBasicParsing`,
    `  "HTTP $($r.StatusCode) OK"`,
    `} catch {`,
    `  "HTTP $($_.Exception.Response.StatusCode.value__) FAIL: 401 bad key / 403 not enabled / 404 wrong base_url"`,
    `}`
  );
  if (t.kind === 'chat') psLines.push(`# NOTE: no /models endpoint here, the check above costs 1 request`);
  return psLines.join('\n');
}

/* 网关一键启动脚本 */
function buildGatewayScript(shell) {
  if (shell === 'ps') {
    /* 同样保持 ASCII：见 buildVendorEnvScript 里的说明 */
    return [
      `# 1) install (pip is the simpler path)`,
      `pip install "litellm[proxy]"`,
      `# or Docker:`,
      `# docker run -d --name litellm -p 4000:4000 -v "\${PWD}\\litellm_config.yaml:/app/config.yaml" ghcr.io/berriai/litellm:main-latest --config /app/config.yaml`,
      ``,
      `# 2) start it (foreground, Ctrl+C to stop)`,
      `litellm --config .\\litellm_config.yaml --port 4000`,
      ``,
      `# 3) in another window: if this lists models, the gateway is up`,
      `(Invoke-WebRequest -Uri "http://localhost:4000/v1/models" -UseBasicParsing).StatusCode`,
      ``,
      `# from now on every script only needs these two values:`,
      `$env:OPENAI_BASE_URL = "http://localhost:4000/v1"`,
      `$env:OPENAI_API_KEY  = "sk-placeholder"   # the gateway forwards the real keys from config`
    ].join('\n');
  }
  return [
    `# 1) 安装（二选一，pip 更简单）`,
    `pip install 'litellm[proxy]'`,
    `# 或者用 Docker：`,
    `# docker run -d --name litellm -p 4000:4000 \\`,
    `#   -v "$PWD/litellm_config.yaml:/app/config.yaml" \\`,
    `#   ghcr.io/berriai/litellm:main-latest --config /app/config.yaml`,
    ``,
    `# 2) 启动（前台运行，Ctrl+C 停止）`,
    `litellm --config ./litellm_config.yaml --port 4000`,
    ``,
    `# 3) 另开一个终端自检：能列出模型就说明网关通了`,
    `curl -sS http://localhost:4000/v1/models | head -c 300`,
    ``,
    `# 之后所有脚本只认这两个值：`,
    `export OPENAI_BASE_URL="http://localhost:4000/v1"`,
    `export OPENAI_API_KEY="sk-任意占位值"   # 网关按 config 里的 key 转发`
  ].join('\n');
}

/* 给向导结果配一条可复制的命令（只有需要命令的路径才有） */
function recommendCommand(rec) {
  if (!rec || !rec.command) return '';
  if (rec.command === 'gateway') return buildGatewayScript('bash');
  return '';
}

/* ============================================================
   渲染：接入向导 + 一键配置
   （供 access.js 的 renderAccess 调用）
   ============================================================ */

const OB_STATE = { goal: 'script', comfort: 'onecmd', vendor: 'openai', shell: 'bash' };

function obVendors() {
  try {
    return (typeof VENDOR_ACCESS !== 'undefined' && VENDOR_ACCESS) || [];
  } catch (e) { return []; }
}

function renderObResult() {
  const box = $('#ob-result');
  if (!box) return;

  const rec = recommendAccess(OB_STATE.goal, OB_STATE.comfort);
  const raw = (typeof ACCESS_PATHS !== 'undefined')
    ? ACCESS_PATHS.find(p => p.id === 'raw-key') : null;
  const compare = (raw && rec.minutes > 0)
    ? ` · 对照：逐平台各配一份 key 约 ${raw.setupMin} 分钟` : '';

  const cmd = rec.command === 'gateway' ? buildGatewayScript(OB_STATE.shell) : recommendCommand(rec);
  const shellLabel = OB_STATE.shell === 'ps' ? 'PowerShell' : 'bash';
  const cmdBlock = cmd ? `
    <div class="ob-out">
      <div class="ob-outhead">
        <b>${shellLabel}</b>
        <button class="ghost-btn" data-ob-copy>复制</button>
        <button class="ghost-btn" data-ob-dl="${OB_STATE.shell === 'ps' ? 'setup-gateway.ps1' : 'setup-gateway.sh'}">下载</button>
      </div>
      <pre class="ob-code"><code>${esc(cmd)}</code></pre>
    </div>` : '';

  box.innerHTML = `
    <div class="ob-rec">
      <div class="ob-rechead">
        <span class="ob-badge">推荐</span>
        <b>${esc(rec.title)}</b>
        <span class="ob-min">约 ${rec.minutes} 分钟${esc(compare)}</span>
      </div>
      <p class="ob-why">${esc(rec.why)}</p>
      <ol class="ob-steps">${rec.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="ob-caveat"><b>注意</b>${esc(rec.caveat)}</p>
      ${cmdBlock}
    </div>`;

  const copyBtn = box.querySelector('[data-ob-copy]');
  if (copyBtn) copyBtn.addEventListener('click', () => copyText(cmd, copyBtn));
  const dlBtn = box.querySelector('[data-ob-dl]');
  if (dlBtn) dlBtn.addEventListener('click', () => downloadFile(dlBtn.dataset.obDl, cmd, 'text/plain'));
}

function renderOnboard() {
  const goals = $('#ob-goals');
  const comforts = $('#ob-comforts');
  if (!goals || !comforts) return;

  const chip = (id, label, cur, name) =>
    `<button class="ob-chip${id === cur ? ' on' : ''}" data-ob-${name}="${id}">${esc(label)}</button>`;

  goals.innerHTML = ONBOARD_GOALS.map(g => chip(g.id, g.label, OB_STATE.goal, 'goal')).join('');
  comforts.innerHTML = ONBOARD_COMFORT.map(c => chip(c.id, c.label, OB_STATE.comfort, 'comfort')).join('');

  $$('[data-ob-goal]').forEach(b => b.addEventListener('click', () => {
    OB_STATE.goal = b.dataset.obGoal;
    $$('[data-ob-goal]').forEach(x => x.classList.toggle('on', x === b));
    renderObResult();
  }));
  $$('[data-ob-comfort]').forEach(b => b.addEventListener('click', () => {
    OB_STATE.comfort = b.dataset.obComfort;
    $$('[data-ob-comfort]').forEach(x => x.classList.toggle('on', x === b));
    renderObResult();
  }));

  /* 平台下拉：只用有接入硬事实的厂商表，不用 48 个平台表 */
  const sel = $('#ob-vendor');
  const list = obVendors();
  if (sel && !sel.dataset.ready) {
    sel.innerHTML = list.map(v =>
      `<option value="${esc(v.id)}">${esc(v.name)}${v.base ? '' : '（端点取决于推理商）'}</option>`).join('');
    sel.dataset.ready = '1';
    if (list.some(v => v.id === OB_STATE.vendor)) sel.value = OB_STATE.vendor;
    else if (list.length) OB_STATE.vendor = list[0].id;
    sel.addEventListener('change', () => { OB_STATE.vendor = sel.value; });
  }

  /* 终端切换 */
  const sh = $('#ob-shell');
  if (sh && !sh.dataset.ready) {
    sh.dataset.ready = '1';
    const opts = [['bash', 'bash'], ['ps', 'PowerShell']];
    sh.innerHTML = opts.map(([id, label]) => chip(id, label, OB_STATE.shell, 'shell')).join('');
    $$('[data-ob-shell]').forEach(b => b.addEventListener('click', () => {
      OB_STATE.shell = b.dataset.obShell;
      $$('[data-ob-shell]').forEach(x => x.classList.toggle('on', x === b));
      renderObResult();
    }));
  }

  /* 生成命令 */
  const gen = $('#ob-gen');
  if (gen && !gen.dataset.ready) {
    gen.dataset.ready = '1';
    gen.addEventListener('click', () => {
      const v = obVendors().find(x => x.id === OB_STATE.vendor);
      const keyEl = $('#ob-key');
      const key = (keyEl && keyEl.value.trim()) || '';
      const out = $('#ob-out');
      if (!out) return;

      const use = key || '在这里粘贴你的 key';
      const code = buildVendorEnvScript(v, use, OB_STATE.shell);
      const shellLabel = OB_STATE.shell === 'ps' ? 'PowerShell' : 'bash';
      const fname = 'setup-' + (v ? v.id : 'vendor') + (OB_STATE.shell === 'ps' ? '.ps1' : '.sh');

      out.innerHTML = `
        <div class="ob-out">
          <div class="ob-outhead">
            <b>${esc(v ? v.name : '')} · ${shellLabel}</b>
            ${key ? '' : '<span class="ob-warn">未填 key，下面是模板</span>'}
            <button class="ghost-btn" data-ob-copy2>复制</button>
            <button class="ghost-btn" data-ob-dl2="${esc(fname)}">下载 ${esc(fname)}</button>
          </div>
          <pre class="ob-code"><code>${esc(code)}</code></pre>
        </div>`;

      const cb = out.querySelector('[data-ob-copy2]');
      if (cb) cb.addEventListener('click', () => copyText(code, cb));
      const db = out.querySelector('[data-ob-dl2]');
      if (db) db.addEventListener('click', () => downloadFile(db.dataset.obDl2, code, 'text/plain'));
    });
  }

  renderObResult();
}
