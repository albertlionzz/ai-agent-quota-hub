/* ============================================================
   接入通道模型：额度怎么兑现成可用能力
   ------------------------------------------------------------
   额度不等于可用。三类额度互不通用，这是最容易踩的坑：
     · 网页对话额度 —— 只能在网页里用，脚本拿不到
     · 订阅附赠 CLI 额度 —— OAuth 登录，不给 API key，第三方工具调不了
     · API 平台赠送 token —— 给 API key，可编程
   ============================================================ */

/* 三类额度的边界 */
const QUOTA_KINDS = {
  web: {
    label: '网页对话额度',
    desc: '在网页/App 里聊天用的额度。',
    scriptable: false,
    how: '打开网页直接聊',
    catch: '脚本完全拿不到。编排流水线里的检索阶段只能靠人工在这里跑完再贴回来。'
  },
  sub: {
    label: '订阅附赠 CLI 额度',
    desc: '跟着订阅/账号走，官方 CLI 用 OAuth 登录后直接扣这份额度。',
    scriptable: 'partial',
    how: '官方 CLI 登录，不给 key',
    catch: '登录存的是 OAuth token，不是 API key。第三方工具拿它调不通 api 端点——这是计费系统隔离，不是限制。'
  },
  api: {
    label: 'API token 额度',
    desc: '开放平台赠送的 token，凭 API key 调用。',
    scriptable: true,
    how: '控制台生成 API key',
    catch: '要自己管 key、管轮换、管限速。平台多了就很烦——这是需要网关的原因。'
  }
};

/* 五条接入路径，按省心程度排序（ease 越小越省心） */
const ACCESS_PATHS = [
  {
    id: 'cli-login',
    ease: 1,
    label: '账号登录的 CLI / Agent',
    tagline: '零 key。装完登录就能跑，额度跟账号走。',
    scriptable: false,
    setupMin: 3,
    best: '先动手做东西，不关心自动化',
    steps: [
      'npm i -g @openai/codex（或你选的 CLI）',
      'codex login —— 浏览器里用 ChatGPT 账号授权',
      'codex "你的任务" —— 额度直接扣 ChatGPT 计划'
    ],
    catch: '它是交互式 Agent，不是可编程 API。你的编排脚本没法把它当一个阶段调。想脚本化必须走网关或 API key。',
    note: '免费登录这条路 2026 年关掉了两个：Gemini CLI（6/18 停个人账号）和 Qwen Code（4/15 停 OAuth）。看到教程说「每天 1000 次免费」基本都是过时的。'
  },
  {
    id: 'ide',
    ease: 2,
    label: 'IDE / 编辑器内置额度',
    tagline: '装插件、登录，直接在编辑器里用。',
    scriptable: false,
    setupMin: 5,
    best: '写代码为主',
    steps: [
      '装 Copilot / Cursor / Trae / 通义灵码',
      '登录账号，免费档自动生效',
      '在编辑器里对话或补全'
    ],
    catch: '额度只能在这个编辑器里用。换工具就作废，且无法被脚本调用。',
    note: 'Copilot Free 的 2000 次补全/月是这类里最稳定的一个，因为它跟 GitHub 账号绑定且多年未变。'
  },
  {
    id: 'gateway',
    ease: 3,
    label: '本地统一网关（推荐给要脚本化的人）',
    tagline: '把 N 个 key 收成 1 个端点。脚本只认一个 base_url + 一个 key。',
    scriptable: true,
    setupMin: 15,
    best: '要用编排流水线跑项目',
    steps: [
      '起一个 LiteLLM 容器（Docker，MIT 自托管）',
      '在 config.yaml 里把你已有的各家 key 都填进去',
      '脚本统一打 http://localhost:4000/v1，只配一个 OPENAI_API_KEY'
    ],
    catch: '要自己跑一个进程。但换来的是：多 key 负载均衡、429 自动切下一家、按平台记账——这三点正好是编排流水线最需要的。',
    note: '这是「更简单」的真正答案：不是少配 key，而是只配一次。新增平台时改 yaml 就行，脚本一行不动。'
  },
  {
    id: 'aggregator',
    ease: 4,
    label: '聚合商一个 key 调多家',
    tagline: 'OpenRouter 这类：一个 key 访问几十家模型，含 :free 免费档。',
    scriptable: true,
    setupMin: 5,
    best: '想快速试很多模型',
    steps: [
      '注册 OpenRouter，生成一个 key',
      '模型名写成 openrouter:xxx，:free 后缀的是免费档',
      '一个 key 打天下'
    ],
    catch: '中间商。免费档有 50 RPD 硬顶，且 :free 列表会缩（一个月内从 27 个减到 17 个）。关键任务别只押它。',
    note: '适合探索期。一旦某条链路跑通并要长期用，把它换成直连或网关更稳。'
  },
  {
    id: 'raw-key',
    ease: 5,
    label: '逐平台 API key',
    tagline: '每家控制台各生成一个 key，脚本里各自配。',
    scriptable: true,
    setupMin: 30,
    best: '要压榨每一家的限速额度',
    steps: [
      '逐家注册、实名、进控制台生成 key',
      '每家抄下 base_url 和 model id',
      '脚本里一个环境变量一个 key'
    ],
    catch: '最灵活也最烦。model id 每月可能变，key 要轮换，限速各家不同。平台一多就失控。',
    note: '本工具默认导出的就是这个模式。平台少于 3 个时够用，超过就该上网关了。'
  }
];

/* 账号登录即可用的 CLI / Agent（2026-10 核实，含已失效项的标注） */
const LOGIN_AGENTS = [
  {
    id: 'codex',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    login: 'ChatGPT 账号（Free / Go / Plus / Pro / Business 全档位）',
    free: true,
    quota: 'Free/Go 档：约 15–80 个本地任务 / 5 小时窗口，另有周上限',
    cmd: 'npm i -g @openai/codex && codex login',
    status: 'live',
    note: '当前真正的 $0 起点。2026-02 Codex app 上线时把 Free 和 Go 也纳进来，至今有效。/status 看剩余额度。'
  },
  {
    id: 'antigravity',
    name: 'Antigravity CLI（agy）',
    vendor: 'Google',
    login: 'Google 账号',
    free: true,
    quota: 'Individual 免费档：周限额，含 Gemini 3.x Flash / 3.1 Pro 及部分 Claude / GPT-OSS',
    cmd: '见官方安装指引；agy plugin import gemini 可迁移旧扩展',
    status: 'live',
    note: 'Gemini CLI 的官方替代。闭源许可，社区还小。多 Agent 编排是它的卖点（/goal 会拆出子 Agent 并行）。'
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    login: 'Claude 订阅（/login）或 Console API key',
    free: false,
    quota: '需付费订阅；无免费档',
    cmd: 'claude  # 然后 /login',
    status: 'paid',
    note: '订阅登录同样不给 API key。值得为「必须一次改对」的路径保留。'
  },
  {
    id: 'opencode',
    name: 'opencode',
    vendor: '开源（MIT）',
    login: '可用 GitHub Copilot 或 ChatGPT Plus 账号登录，也可用自己的 key',
    free: true,
    quota: 'Zen 网关有免费模型，阵容轮换',
    cmd: '见 opencode.ai；读 CLAUDE.md 和 ~/.claude/skills',
    status: 'live',
    note: '模型中立，75+ provider。能用现有 Copilot / ChatGPT 订阅额度，是少见的「订阅可复用」开源 Agent。'
  },
  {
    id: 'mimo-code',
    name: 'MiMo Code',
    vendor: '小米（MIT 开源）',
    login: '内置限时免费模型 MiMo-V2.5',
    free: true,
    quota: '限时免费，未公示长期额度',
    cmd: '2026-06 开源，基于 OpenCode 二次开发',
    status: 'live',
    note: '多模态，界面全汉化。SWE-Bench Pro V2 实测分数高于 Claude Code——但「限时免费」意味着随时可能收紧。'
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    vendor: 'Google',
    login: '原为 Google 账号 OAuth',
    free: false,
    quota: '免费层已于 2026-06-18 终止',
    cmd: 'npx @google/gemini-cli',
    status: 'dead',
    note: '5/19 宣布、6/18 硬切，个人 / AI Pro / Ultra 账号全部转 Antigravity CLI。企业 Code Assist 许可仍可用。README 里「1000 次/天」已过时。'
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    vendor: '阿里（Apache-2.0）',
    login: '原为 Qwen OAuth',
    free: false,
    quota: '免费 OAuth 已于 2026-04-15 终止',
    cmd: 'npm i -g @qwen-code/qwen-code',
    status: 'dead',
    note: '2 月从 2000 次/天降到 1000，4/15 彻底停，/auth 里已不可选。客户端仍开源免费，但推理要自备 key。注意：Qwen OAuth 的模型是硬编码的，改 modelProviders 也绕不过去。'
  }
];

/* 网关方案对比 */
const GATEWAYS = [
  {
    id: 'litellm',
    name: 'LiteLLM',
    license: 'MIT（enterprise/ 目录除外）',
    deploy: 'Docker 自托管',
    providers: '100+ provider',
    keyFeature: '多 key 负载均衡 + 自动 fallback + 按 key 记账',
    cost: '$0',
    risk: '2026-03 有两次投毒版本在 PyPI 存活约 40 分钟。必须用官方镜像并固定版本、及时打补丁。',
    fit: '要脚本化、平台多、想自动 failover',
    verdict: '首选'
  },
  {
    id: 'oneapi',
    name: 'One API / New API',
    license: '开源',
    deploy: 'Docker 自托管',
    providers: '主流国内外平台',
    keyFeature: '多渠道聚合 + 令牌分发，中文界面，对国内平台支持好',
    cost: '$0',
    risk: '社区项目，维护节奏不稳定。',
    fit: '平台以国内为主（百炼、智谱、火山、DeepSeek）',
    verdict: '国内平台为主时更顺手'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    license: '商业服务',
    deploy: '云端，不用自己部署',
    providers: '几十家，含 :free 档',
    keyFeature: '一个 key 调多家，零运维',
    cost: '$0 起步（免费档）',
    risk: '免费档 50 RPD 硬顶；:free 模型列表会缩。',
    fit: '探索期、想快速试模型',
    verdict: '零运维，但别押关键链路'
  }
];

/* 平台 → 接入方式映射。key 为 data.js 里的平台 id */
const ACCESS_MAP = {
  /* —— API key 类（可编程）—— */
  zhipu: 'api', sensenova: 'api', 'amd-radeon': 'api', together: 'api',
  'zhipu-gift': 'api', volc: 'api', bailian: 'api', siliconflow: 'api',
  hunyuan: 'api', qianfan: 'api', deepseek: 'api', longcat: 'api',
  modelscope: 'api', gemini: 'api', openrouter: 'api', groq: 'api',
  cerebras: 'api', mistral: 'api', 'github-models': 'api',
  /* 一线大厂自有 API（2026-10 补入；其中 anthropic 非 OpenAI 格式，
     网关走 anthropic/ provider，不填 api_base，见 verify 的 pitfall） */
  moonshot: 'api', minimax: 'api', spark: 'api',
  openai: 'api', anthropic: 'api', xai: 'api',
  /* —— IDE / 编辑器（订阅登录）—— */
  trae: 'ide', 'tongyi-lingma': 'ide', 'copilot-free': 'ide',
  windsurf: 'ide', cursor: 'ide', antigravity: 'cli',
  cline: 'ide',
  /* —— 智能体平台：网页为主，部分可 API —— */
  n8n: 'self', dify: 'self', coze: 'web', manus: 'web',
  make: 'web', fastgpt: 'self',
  /* —— 网页对话 —— */
  'chatgpt-free': 'web', kimi: 'web', perplexity: 'web', notebooklm: 'web',
  /* —— 图像视频 —— */
  jimeng: 'web', kling: 'web', hailuo: 'web', wanxiang: 'web',
  runway: 'web', veo: 'web'
};

/* 接入方式的展示信息 */
const ACCESS_KINDS = {
  api: { short: 'API key', color: 'green', desc: '控制台生成 key，可编程调用' },
  cli: { short: 'CLI 登录', color: 'blue', desc: '账号 OAuth 登录，官方 CLI 专属' },
  ide: { short: 'IDE 内置', color: 'purple', desc: '编辑器插件内使用' },
  web: { short: '网页', color: 'slate', desc: '只能在网页里用，脚本拿不到' },
  self: { short: '自托管', color: 'teal', desc: '自己部署，自带模型或自备 key' }
};

function accessOf(p) {
  return ACCESS_MAP[p.id] || (p.cat === 'api' ? 'api' : 'web');
}

/* ============================================================
   网关配置生成：把 N 个 key 收成 1 个端点
   ------------------------------------------------------------
   用 openai/ 前缀 + api_base 而不是各家专有 provider 名。
   原因：绝大多数国内外平台都是 OpenAI 兼容端点，openai/ + api_base
   是 LiteLLM 里唯一 100% 通用、不会因为 provider 命名变化而失效的写法。
   ============================================================ */

/* 建议模型：能力画像里该平台免费可得的最强模型。
   注意这是「人可读的模型名」，不是 API model id——真实 id 每月可能变，
   必须对着控制台抄。所以只写进注释，不写进 model: 字段。 */
function suggestModelName(platformId) {
  const list = (typeof MODELS === 'undefined' ? [] : MODELS)
    .filter(m => (m.freeVia || []).includes(platformId));
  if (!list.length) return '';
  const best = list.slice().sort((a, b) => {
    const av = m => {
      const v = Object.values(m.score || {});
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
    };
    return av(b) - av(a);
  })[0];
  return best ? best.name : '';
}

function buildGatewayConfig(plan) {
  /* 编排方案用 assign/fallback，总控方案用 worker/reviewer。
     网关两种都得能调，所以一并收进 model_list。 */
  const seen = [];
  const add = a => {
    if (a && a.id && !seen.find(x => x.id === a.id)) seen.push(a);
  };
  plan.stages.forEach(s => {
    add(s.assign); add(s.fallback); add(s.worker); add(s.reviewer);
  });
  /* fallback 链只按「执行」通道排，审查通道不应拿来兜底 */
  const execChain = plan.stages
    .map(s => s.assign || s.worker)
    .filter(Boolean)
    .map(a => a.id)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  /* 只有「可编程 + 有真实端点」的平台才进网关。
     Perplexity / Kimi 这类网页平台被编排引擎分到需人工的阶段是对的，
     但把它们写进 model_list 会生成一份看起来能用、实际调不通的配置。 */
  const canProxy = a => {
    const p = byId(a.id);
    return !!PIPE_BASE[a.id] && (!p || accessOf(p) === 'api');
  };
  const items = seen.filter(canProxy).map(a => {
    const p = byId(a.id);
    const env = a.id.toUpperCase().replace(/-/g, '_') + '_API_KEY';
    const base = PIPE_BASE[a.id] || '';
    const model = (a.model && /^[A-Za-z0-9._:\-\/]+$/.test(a.model)) ? a.model : a.modelId || 'FILL_ME';
    return { id: a.id, name: p ? p.name : a.id, env, base, model };
  });
  const skipped = seen.filter(a => !canProxy(a)).map(a => {
    const p = byId(a.id);
    return { id: a.id, name: p ? p.name : a.id, kind: p ? accessOf(p) : 'web' };
  });

  const lines = [];
  lines.push('# LiteLLM 配置 · 由「AI Agent 免费额度调度中台」自动生成');
  lines.push('# ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
  lines.push('#');
  lines.push('# 用法：');
  lines.push('#   docker run -d --name litellm -p 4000:4000 \\');
  lines.push('#     -v $(pwd)/litellm_config.yaml:/app/config.yaml \\');
  lines.push('#     ghcr.io/berriai/litellm:main-latest --config /app/config.yaml');
  lines.push('#');
  lines.push('# 然后你的脚本只需要认这一个端点：');
  lines.push('#   OPENAI_BASE_URL=http://localhost:4000/v1');
  lines.push('#   OPENAI_API_KEY=sk-anything   # 网关自己的 master key，随便填');
  lines.push('#');
  lines.push('# 安全：务必用官方镜像并固定版本（不要用 latest 跑生产）。');
  lines.push('#      2026-03 曾有投毒版本在 PyPI 存活约 40 分钟。');
  lines.push('');
  lines.push('model_list:');
  items.forEach(it => {
    const sug = suggestModelName(it.id);
    lines.push(`  # ${it.name}${sug ? ` — 建议先试 ${sug}` : ''}`);
    lines.push(`  - model_name: ${it.id}`);
    lines.push('    litellm_params:');
    lines.push(`      model: openai/${it.model}`);
    lines.push(`      api_base: "${it.base}"`);
    lines.push(`      api_key: "os.environ/${it.env}"`);
    lines.push('');
  });

  /* fallback 链：按顺序切下一家 */
  const okIds = items.map(i => i.id);
  const chain = (execChain.length ? execChain : okIds).filter(id => okIds.includes(id));
  if (chain.length > 1) {
    lines.push('router_settings:');
    lines.push('  # 主通道 429 / 超时，自动按这个顺序切下一家');
    lines.push('  fallbacks:');
    chain.forEach((id, i) => {
      const rest = chain.filter(x => x !== id);
      lines.push(`    - ${id}: [${rest.join(', ')}]   # ${i + 1}/${chain.length}`);
    });
    lines.push('  # 同一 model_name 下可挂多份 key 做负载均衡（重复 - model_name 条目即可）');
    lines.push('');
  }

  if (skipped.length) {
    const manual = skipped.filter(s => s.kind !== 'api');
    const altProto = skipped.filter(s => s.kind === 'api');
    lines.push('# ---- 下面这些不进网关 ----');
    if (manual.length) {
      lines.push('# ① 网页 / IDE / 自托管类：没有 OpenAI 兼容端点，脚本调不通。');
      lines.push('#    它们在方案里本来就标了「需人工」——请到网页版跑完，结果存进 in/ 再继续。');
      manual.forEach(it => lines.push(`#   ${it.id}  (${it.name})`));
    }
    if (altProto.length) {
      lines.push('# ② 有官方 API，但不是 OpenAI 格式，塞进 openai/ + api_base 只会 401。');
      lines.push('#    这类要在 LiteLLM 里写各自的 provider 名（如 anthropic/），并直接给 key，');
      lines.push('#    不要给 api_base —— 本文件的统一写法对它们不适用。');
      altProto.forEach(it => lines.push(`#   ${it.id}  (${it.name})`));
    }
    lines.push('');
  }

  lines.push('# ---- 需要你填的两件事 ----');
  lines.push('# 1. model id：所有 FILL_ME 都要对着各家控制台抄。上面注释给了建议模型，');
  lines.push('#    但那是人可读的名字，不是 API id——免费模型 id 每月都可能变，别照抄旧教程。');
  lines.push('# 2. 环境变量：');
  items.forEach(it => lines.push(`#    export ${it.env}=xxx`));
  lines.push('');

  return lines.join('\n');
}

/* 网关版 runner：只认一个端点，比逐 key 版本短一半 */
function buildGatewayRunner(plan) {
  const stages = plan.stages.map((s, i) => ({
    id: String(i + 1).padStart(2, '0') + '-' + s.key,
    name: s.name,
    model: ((s.assign || s.worker) || {}).id || '',
    in: s.inTok,
    out: s.outTok,
    card: s.cardIn > 0,
    manual: !!s.manual
  }));

  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
${plan.tpl.name} · 网关版编排器（自动生成 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}）

和逐 key 版的区别：本脚本只认一个端点。
多平台的 key、限速、failover 全部交给本地 LiteLLM 网关处理，
所以这里没有 PROVIDERS 表，也没有 fallback 顺序——网关替你做了。

前置
  1. 起网关：  docker run -d --name litellm -p 4000:4000 \\
                 -v $(pwd)/litellm_config.yaml:/app/config.yaml \\
                 ghcr.io/berriai/litellm:main-latest --config /app/config.yaml
  2. 配环境：  export OPENAI_BASE_URL=http://localhost:4000/v1
               export OPENAI_API_KEY=sk-anything
  3. 各家真实 key 按 litellm_config.yaml 里的注释 export 好

使用
  python run_gateway.py --dry-run     # 只落提示词，不发请求
  python run_gateway.py               # 正式跑
"""
import json, os, sys, time, pathlib, urllib.request, urllib.error

BASE = os.environ.get("OPENAI_BASE_URL", "http://localhost:4000/v1").rstrip("/")
GKEY = os.environ.get("OPENAI_API_KEY", "sk-anything")

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out"; OUT.mkdir(exist_ok=True)
IN  = ROOT / "in";  IN.mkdir(exist_ok=True)

STAGES = json.loads(r'''
${JSON.stringify(stages, null, 1)}
''')


def call(model, prompt, max_out):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_out,
    }
    req = urllib.request.Request(
        BASE + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + GKEY},
    )
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.loads(r.read().decode("utf-8"))
            return d["choices"][0]["message"]["content"], d.get("usage", {})
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503):
                time.sleep(5 * (attempt + 1))   # 网关会自动换一家，这里只是退避
                continue
            break
        except Exception as e:
            last = str(e)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"调用失败 {model}: {last}")


def main():
    dry = "--dry-run" in sys.argv
    log = []
    for i, st in enumerate(STAGES):
        tag = f"[{i + 1}/{len(STAGES)}] {st['name']}"
        prev = OUT / "_card.md"
        card = prev.read_text(encoding="utf-8") if st.get("card") and prev.exists() else ""

        if st.get("manual"):
            pf = OUT / (st["id"] + ".prompt.md")
            pf.write_text(card, encoding="utf-8")
            print(f"{tag} 需人工：要联网，免费 API 代不了。提示词在 out/{st['id']}.prompt.md")
            if not dry:
                print(f"        结果存到 in/{st['id']}.md 后重跑。")
                return 0
            continue

        user_msg = (card + "\\n\\n" if card else "") + st["name"]
        print(f"{tag} -> {st['model']}")
        if dry:
            (OUT / (st["id"] + ".prompt.md")).write_text(user_msg, encoding="utf-8")
            continue

        text, usage = call(st["model"], user_msg, st["out"])
        (OUT / (st["id"] + ".md")).write_text(text, encoding="utf-8")
        log.append({"stage": st["id"], "model": st["model"],
                    "in": usage.get("prompt_tokens"), "out": usage.get("completion_tokens")})
        print(f"        {usage.get('prompt_tokens', 0)} in + {usage.get('completion_tokens', 0)} out")

    (OUT / "_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    if dry:
        print(f"\\n干跑结束：{len(STAGES)} 个阶段，提示词都在 out/ 下。")
        return 0
    ti = sum(x["in"] or 0 for x in log); to = sum(x["out"] or 0 for x in log)
    print(f"\\n完成：{len(log)} 阶段，{ti} + {to} = {ti + to} tokens")


if __name__ == "__main__":
    main()
`;
}

/* ============================================================
   视图：接入通道
   ============================================================ */
function renderAccess() {
  /* —— 三类额度的边界 —— */
  $('#acc-kinds').innerHTML = Object.entries(QUOTA_KINDS).map(([k, v]) => `
    <div class="kind-card ${k}">
      <div class="kc-head">
        <span class="kc-name">${esc(v.label)}</span>
        <span class="chip ${v.scriptable === true ? 'green' : (v.scriptable === 'partial' ? 'amber' : 'slate')}"
              style="font-size:10px;padding:2px 7px">
          ${v.scriptable === true ? '可编程' : (v.scriptable === 'partial' ? '半可编程' : '不可编程')}
        </span>
      </div>
      <div class="kc-desc">${esc(v.desc)}</div>
      <div class="kc-how"><b>怎么用：</b>${esc(v.how)}</div>
      <div class="kc-catch"><b>坑：</b>${esc(v.catch)}</div>
    </div>`).join('');

  /* —— 五条路径 —— */
  $('#acc-paths').innerHTML = ACCESS_PATHS.map(p => `
    <div class="path-card" data-apath="${p.id}">
      <div class="pc-head">
        <span class="pc-ease">省心 ${p.ease}/5</span>
        <span class="pc-setup">约 ${p.setupMin} 分钟</span>
        <span class="chip ${p.scriptable ? 'green' : 'slate'}" style="font-size:10px;padding:2px 7px">
          ${p.scriptable ? '可脚本化' : '不可脚本化'}
        </span>
      </div>
      <div class="pc-name">${esc(p.label)}</div>
      <div class="pc-tag">${esc(p.tagline)}</div>
      <div class="pc-best"><b>适合：</b>${esc(p.best)}</div>
      <div class="pc-steps">${p.steps.map((s, i) => `<div class="pc-step"><span>${i + 1}</span>${esc(s)}</div>`).join('')}</div>
      <div class="pc-catch"><b>代价：</b>${esc(p.catch)}</div>
      <div class="pc-note">${esc(p.note)}</div>
    </div>`).join('');

  /* —— 账号登录的 Agent —— */
  const live = LOGIN_AGENTS.filter(a => a.status !== 'dead');
  const dead = LOGIN_AGENTS.filter(a => a.status === 'dead');
  const agentRow = a => `
    <div class="ag-row ${a.status}">
      <div class="ag-main">
        <div class="ag-name">${esc(a.name)}
          <span class="ag-vendor">${esc(a.vendor)}</span>
          <span class="chip ${a.status === 'live' ? 'green' : (a.status === 'paid' ? 'blue' : 'red')}"
                style="font-size:10px;padding:2px 7px;margin-left:6px">
            ${a.status === 'live' ? '可用' : (a.status === 'paid' ? '需付费' : '已终止')}
          </span>
        </div>
        <div class="ag-login"><b>登录方式：</b>${esc(a.login)}</div>
        <div class="ag-quota"><b>额度：</b>${esc(a.quota)}</div>
        <div class="ag-note">${esc(a.note)}</div>
      </div>
      <div class="ag-cmd"><code>${esc(a.cmd)}</code></div>
    </div>`;

  $('#acc-agents').innerHTML =
    live.map(agentRow).join('') +
    `<div class="ag-dead-hd">已终止（见到教程推荐请直接跳过）</div>` +
    dead.map(agentRow).join('');

  /* —— 网关对比 —— */
  $('#acc-gw').innerHTML = GATEWAYS.map(g => `
    <div class="gw-card">
      <div class="gw-head">
        <span class="gw-name">${esc(g.name)}</span>
        <span class="gw-verdict ${g.verdict === '首选' ? 'hi' : ''}">${esc(g.verdict)}</span>
      </div>
      <div class="gw-row"><b>部署</b><span>${esc(g.deploy)} · ${esc(g.license)}</span></div>
      <div class="gw-row"><b>覆盖</b><span>${esc(g.providers)}</span></div>
      <div class="gw-row"><b>关键</b><span>${esc(g.keyFeature)}</span></div>
      <div class="gw-row"><b>成本</b><span>${esc(g.cost)}</span></div>
      <div class="gw-row"><b>适合</b><span>${esc(g.fit)}</span></div>
      <div class="gw-risk"><b>风险：</b>${esc(g.risk)}</div>
    </div>`).join('');

  /* —— 平台接入速查 —— */
  const groups = {};
  PLATFORMS.forEach(p => {
    const k = accessOf(p);
    (groups[k] = groups[k] || []).push(p);
  });
  $('#acc-plat').innerHTML = Object.entries(ACCESS_KINDS).map(([k, v]) => {
    const list = groups[k] || [];
    if (!list.length) return '';
    return `<div class="ap-group">
      <div class="ap-head"><span class="chip ${v.color}" style="font-size:10px;padding:2px 7px">${v.short}</span>
        <span class="ap-desc">${esc(v.desc)}</span><span class="ap-n">${list.length} 个</span></div>
      <div class="ap-list">${list.map(p =>
        `<span class="ap-item">${esc(p.name)}</span>`).join('')}</div>
    </div>`;
  }).join('');

  /* —— 导出网关配置 —— */
  const plan = window.__pipe || window.__orch;
  const btn = $('#acc-export');
  if (plan && plan.stages) {
    btn.innerHTML = `
      <button class="run-btn" id="gw-cfg" style="width:auto;padding:8px 18px">导出 litellm_config.yaml</button>
      <button class="run-btn ghost-btn" id="gw-py" style="width:auto;padding:8px 18px">导出网关版 run_gateway.py</button>
      <span class="ap-hint">基于当前编排方案（${esc(plan.tpl.name)}）生成</span>`;
    $('#gw-cfg').addEventListener('click', () =>
      downloadFile('litellm_config.yaml', buildGatewayConfig(plan), 'text/yaml'));
    $('#gw-py').addEventListener('click', () =>
      downloadFile('run_gateway.py', buildGatewayRunner(plan), 'text/x-python'));
  } else {
    btn.innerHTML = `<span class="ap-hint">先去「项目编排」或「总控调度舱」生成一版方案，这里就能按方案导出网关配置。</span>`;
  }
}
