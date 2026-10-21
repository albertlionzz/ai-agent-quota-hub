/* ============================================================
   多模型分阶段编排（Pipeline）
   ------------------------------------------------------------
   解决的问题：一个完整项目要几十万 tokens，单一免费额度撑不住。
   做法：
     1) 把项目拆成「阶段」，每个阶段只做一件可验证的事；
     2) 每个阶段换一个平台，用掉它当天独立的免费额度；
     3) 阶段之间只传「交接卡」（≤420 tokens），不传全文。
   第 3 点才是省 token 的关键——真实项目里输入占 80%，
   全量上下文透传会让第二个阶段一次性烧光整天的额度。
   ============================================================ */

/* 交接卡预算：约 300 汉字。这是「压缩率」的锚点，不要随意放大 */
const CARD_TOK = 420;

/* 付费对照价（元 / 百万 tokens）：仅用于估算「本来要花多少钱」，
   取国内中型模型混合作业的粗略价位。这里是个假设，不是行情报价。 */
const PAID_REF = 2.0;

const SCALES = {
  small: { label: '小', mul: 1,   desc: '单页 / 单一问题 / Demo' },
  mid:   { label: '中', mul: 2.4, desc: '完整报告 / 可运行项目' },
  large: { label: '大', mul: 5.0, desc: '多模块 / 万字级 / 多标的' }
};

/* 阶段之间传递的强制格式。所有阶段提示词共用，避免把上一阶段全文带下去 */
const CARD_SPEC = `
【输出分为两部分】
第一部分：正文（按上面的要求写）。
第二部分：正文结束后，另起一行，输出一张「交接卡」，总长不超过 300 字，格式固定：

[交接卡]
已定结论（不可推翻，最多 5 条，每条一行，带关键数字）：
已排除方向（含排除理由，最多 3 条）：
待验证 / 风险（最多 3 条）：
下一阶段必需的输入（事实与数字，最多 8 条）：
需要下一阶段接手解决（最多 2 条）：

规则：交接卡之外的过程讨论、备选方案、自我检查全部留在本次会话内，不进卡片。
卡片里不许出现「如上所述」「参见上文」这类指向正文的表述——下一阶段看不到正文。`;

/* ============================================================
   项目模板
   ============================================================ */
const PIPELINE_TEMPLATES = [
  {
    id: 'research-report',
    name: '投研报告',
    tagline: '个股 / 行业深度，含多空对抗与风控复核',
    badges: ['6 阶段', '推理密集'],
    brief: '研究对象：凯盛科技（600552.SH）。核心问题：UTG 国产替代能否在 2027 年前兑现为利润，当前估值是否已透支。时间维度 6~12 个月。',
    stages: [
      {
        key: 'frame', name: '命题拆解', task: 'reasoning',
        artifact: '研究框架卡（1 页）',
        inBase: 700, outBase: 900,
        why: '这一步决定后面所有阶段的边界，需要长上下文 + 强推理；用中文推理档最划算。',
        carry: ['3~5 个可证伪子命题', '盲点清单', '研究边界外声明'],
        prompt: `你是投资研究负责人。基于项目简报做「命题拆解」，不写正文、不给买卖建议。

必须输出：
1. 把核心问题拆成 3~5 个可以独立验证的子命题，每个子命题后面写清「靠什么数据、什么口径能证伪它」；
2. 指出这件事最容易被忽略的 2 个盲点（要具体，不要「需关注政策风险」这类套话）；
3. 说明本次研究明确不覆盖什么（边界声明）；
4. 列出后面阶段各自该产出什么，每项一句话。

禁止：行业概况堆砌、给目标价、用「有望」「或将」代替可验证表述。`
      },
      {
        key: 'gather', name: '证据检索', task: 'research', webOnly: true,
        artifact: '证据清单（带出处的条目表）',
        inBase: 2200, outBase: 2400,
        why: '免费 API 基本没有联网检索能力，这一段必须用带联网的网页版，人工把结果落盘。',
        carry: ['分级证据条目', '孤证标记', '反向证据'],
        prompt: `你是资料检索员。围绕交接卡里的每个子命题逐条检索，只摘录事实，不做分析。

每条证据写成一行固定格式：
[证据] 一句话结论 | 来源机构 + 发布时间 | 关键数字或原文片段 | 支撑哪个子命题 | 可信度(高/中/低)

要求：
1. 每个子命题至少 2 条互相独立的来源；只有单一来源的标「孤证」；
2. 必须包含至少 1 条与主流叙事相反的证据；确实找不到就写「未找到反证」并说明检索范围与关键词；
3. 每个数字都要标注统计口径和截止日期；
4. 不要写任何推论，不要合并不同口径的数字。`
      },
      {
        key: 'model-numbers', name: '数据核算', task: 'reasoning',
        artifact: '关键指标表 + 情景假设表',
        inBase: 1700, outBase: 1500,
        why: '纯计算与一致性检查，输出要短、要精确；换个模型复核能有效抓出上游数字错误。',
        carry: ['指标表', '矛盾数字裁决', '三情景假设'],
        prompt: `你是财务与估值核算员。只做计算和一致性检查，不写叙事，不做推荐。

输入是交接卡里的证据与数字。必须输出：
1. 关键指标表：指标 | 数值 | 口径 | 来源 | 与上期变化；
2. 挑 1~2 个最关键的结论数字，用两种互相独立的方法交叉验算，列出两法差异和可能原因；
3. 找出证据之间互相矛盾的数字，逐条列出，并说明你采信哪一个、为什么；
4. 建立悲观 / 中性 / 乐观三情景假设表，每个假设都要写清「什么条件下成立」。

禁止：不同口径的数字直接相除或相加；用「约」「左右」「大幅」含糊带过；编造未在证据中出现的数字。`
      },
      {
        key: 'debate', name: '多空对抗', task: 'reasoning',
        artifact: '空头备忘录',
        inBase: 1900, outBase: 1900,
        why: '专门用一份新上下文当反方。同一模型顺着自己的上一轮继续写，几乎不会真正反驳自己。',
        carry: ['致命反驳', '最脆弱的假设', '翻多条件'],
        prompt: `你是空头分析师。把交接卡里的成果当作「多头论证」来攻击，不要复述它的优点，不要做平衡表述。

必须输出：
1. 最致命的 3 个反驳，每个都要指向具体数字或具体假设，不许泛泛说「竞争加剧」；
2. 指出上述核算里最可能出错的那个前提，并说明如果它错了，结论会变成什么；
3. 什么样的可观测信号出现时，你会承认多头是对的（写成带阈值的翻多条件）；
4. 一句话：当前价格隐含了市场的什么假设。

禁止：为平衡而凑观点；写风险提示模板话术。`
      },
      {
        key: 'draft', name: '成稿', task: 'long-text',
        artifact: '报告初稿（完整正文）',
        inBase: 4200, outBase: 6000,
        why: '全文生成是整个项目最贵的一步，适合放在日额度最大或一次性礼包最厚的平台上。',
        carry: ['结论与目标区间', '逻辑链', '必须保留的限定条件'],
        prompt: `你是卖方研究报告主笔。把前四阶段的结论写成一份可直接交付的中文报告。

结构固定：
一、结论前置：3 句话说清观点、估值区间、时间维度
二、核心逻辑链：每一步都要挂具体数字与出处
三、反方观点与回应：逐条回应多空对抗阶段提出的致命反驳
四、关键假设与情景：悲观 / 中性 / 乐观，各写触发条件
五、无法证实的部分：明确列出，不许藏进正文

写作要求：中文书面语；数字必须带单位和口径；每段不超过 200 字；
所有形容词后面必须跟数字，否则删掉；不写「综上所述」这类空转过渡。
不要输出目录、不要输出 Markdown 表格以外的花哨排版。`
      },
      {
        key: 'audit', name: '风控复核', task: 'reasoning',
        artifact: '问题清单 + 发布判断',
        inBase: 3600, outBase: 1300,
        why: '质检必须用没参与写作的模型，否则会连带继承自己写作时的偏差。',
        carry: ['必须修改清单', '发布判断'],
        prompt: `你是风控复核人。你的任务是挑错，不是评价。对这份报告逐项检查：

1. 事实：每个数字能否追溯到上游证据？列出找不到出处的；
2. 逻辑：结论有没有超出证据能支撑的范围？指出最可能过度推断的 3 处原文；
3. 一致性：正文数字与核算表是否冲突？逐个对；
4. 合规：有没有绝对化表述、有没有把不可证实的写成已知；
5. 最后给判断：可发布 / 需修改后发布 / 不可发布，并列出必须修改项，按严重程度排序。

每条问题都要写清「原文位置 + 为什么错 + 怎么改」。没发现问题就明说，不要为了凑数编问题。`
      }
    ]
  },

  {
    id: 'software',
    name: '软件项目',
    tagline: '从需求冻结到可运行 Demo',
    badges: ['7 阶段', '代码密集'],
    brief: '目标：做一个本地运行的 A 股板块监控小工具。Python + 单一 HTML 前端，数据从公开接口拉，每天定时跑一次，异常时输出到本地文件。要求零云成本。',
    stages: [
      {
        key: 'spec', name: '需求冻结', task: 'reasoning',
        artifact: '需求边界表',
        inBase: 900, outBase: 900,
        why: '需求不清是项目返工的第一原因，先用推理档把边界定死，能省掉后面大量重写。',
        carry: ['功能清单（含不做清单）', '验收标准', '技术约束'],
        prompt: `你是技术负责人。把项目简报收敛成一份可以开工的需求边界，不写代码。

必须输出：
1. 功能清单：每条写「输入 → 处理 → 输出」，并标 P0/P1/P2；
2. 明确不做什么（至少 3 条），并说明为什么现在不做；
3. 验收标准：写成可执行的检查项，例如「跑一次命令能在 10 秒内产出 X 文件」；
4. 技术约束：运行环境、依赖上限、数据来源的合法性、失败时怎么办；
5. 列出 3 个最可能让项目卡住的技术风险，各给一个兜底方案。`
      },
      {
        key: 'arch', name: '架构与数据模型', task: 'code',
        artifact: '目录树 + 数据结构定义',
        inBase: 1400, outBase: 2000,
        why: '结构设计需要长输出、强代码能力，用代码档免费额度最大的平台。',
        carry: ['目录结构', '核心数据结构', '模块职责'],
        prompt: `你是架构师。基于需求边界，产出可以直接落盘的骨架设计，不写实现细节。

必须输出：
1. 目录树（树形，每个文件后面跟一句话职责，不许出现空文件凑数）；
2. 核心数据结构：用具体语言写法给出字段名、类型、约束、默认值；
3. 模块依赖方向（谁可以调谁，单向依赖，禁止循环）；
4. 数据流：从输入到落盘，逐步写清每一步的转换；
5. 明确哪些地方故意保持简单（并说明将来怎么扩展）。

禁止：引入未在需求里出现的第三方框架；设计分布式、微服务这类与规模不匹配的方案。`
      },
      {
        key: 'contract', name: '接口契约', task: 'code',
        artifact: '接口签名 + 错误码表',
        inBase: 2200, outBase: 2200,
        why: '契约先行，后续模块可以由不同模型并行写而不会互相打架。',
        carry: ['接口签名', '错误码', '调用示例'],
        prompt: `你是接口设计者。为上一阶段设计里的每个模块定义边界契约。

必须输出：
1. 每个对外函数的完整签名（参数、返回、可能的异常），并给一段 3~5 行的调用示例；
2. 错误码表：错误情形 | 错误码 | 抛出位置 | 调用方应该怎么处理；
3. 每个接口的正常路径和至少 2 个异常路径；
4. 输入校验规则（哪些字段必填、范围、非法值怎么处理）。

要求：签名必须与上一阶段的目录结构一一对应，不能凭空新增模块。
不要写函数体，函数体里只留一行注释说明实现要点。`
      },
      {
        key: 'impl-core', name: '核心实现', task: 'code',
        artifact: '核心模块源码',
        inBase: 2600, outBase: 5000,
        why: '产出最长，单独占一个平台，避免与界面代码抢同一份日额度。',
        carry: ['已实现文件清单', '关键取舍', '未实现部分'],
        prompt: `你是实现工程师。按接口契约写出核心模块的完整代码。

要求：
1. 直接输出可保存为文件的内容，每个文件用「=== 文件: 路径 ===」开头；
2. 只实现契约里定义的函数，不擅自增加接口；确实需要新增就单独列一节「契约变更建议」；
3. 错误处理必须落地：契约里每个错误码都要有对应的抛出点；
4. 复杂逻辑上方写 1~2 行注释说明为什么这样做（不是说明做了什么）；
5. 不要输出解释性段落，不要输出测试代码。

代码结束后，用 5 行以内说明：哪些地方你做了简化、哪些地方可能有性能或边界问题。`
      },
      {
        key: 'impl-ui', name: '界面实现', task: 'code',
        artifact: '前端文件',
        inBase: 2000, outBase: 3600,
        why: '前端与后端分离到两个平台，出错时能定位到底是契约问题还是实现问题。',
        carry: ['界面文件清单', '与契约的对接点'],
        prompt: `你是前端工程师。按接口契约实现界面，不修改契约。

要求：
1. 输出可直接运行的完整文件（单文件优先），每个文件用「=== 文件: 路径 ===」开头；
2. 所有数据都通过契约里定义的接口获取，不许在页面里写死假数据当成品；
3. 空状态、加载中、出错三种状态都要有界面，不许只做成功态；
4. 屏幕宽度 1280 和 768 两个档位不能出现横向滚动；
5. 不引入构建工具，不引 CDN 之外的依赖。

代码之后用 5 行以内说明：哪些交互还没做、哪些地方依赖后端行为。`
      },
      {
        key: 'debug', name: '联调排错', task: 'code',
        artifact: '故障树 + 修复补丁',
        inBase: 2400, outBase: 1600,
        why: '排错需要把两侧代码放在一起看，用上下文最长的平台，别用短上下文的。',
        carry: ['根因结论', '已修问题', '遗留问题'],
        prompt: `你是排错工程师。基于前面两个阶段的代码，做静态联调检查——找出它们配对时一定会出错的地方。

必须输出：
1. 按「症状 → 可能原因 → 判定方法 → 修复」写成故障树，先列最可能的 3 条；
2. 逐条对比：前端调用的字段名与后端返回的是否一致（列出不一致清单）；
3. 空值、超时、并发重复调用这三种情况分别会怎么坏；
4. 给出最小修复补丁（只给改动部分，标明改哪个文件哪一段）；
5. 列出修不好的、建议改设计的问题。

不要泛泛说「注意异常处理」，要指到具体行或具体字段。`
      },
      {
        key: 'doc', name: '交付文档', task: 'writing',
        artifact: 'README + 运行说明',
        inBase: 1600, outBase: 1500,
        why: '文档用中文写作档更自然，且这一步不消耗代码平台的额度。',
        carry: ['运行步骤', '已知限制'],
        prompt: `你是交付负责人。写一份让陌生人能在 10 分钟内跑起来的 README。

必须包含：
1. 一句话说明这个工具做什么、不做什么；
2. 环境要求与安装命令（逐条可复制，不许写「自行安装依赖」）；
3. 一次最小可运行的完整命令序列；
4. 输出在哪、长什么样（给出示例）；
5. 常见故障 3 条：症状 + 原因 + 解法；
6. 已知限制与后续可做项。

要求：中文，短句，步骤编号；不写项目背景故事，不写「本项目致力于」。`
      }
    ]
  },

  {
    id: 'content',
    name: '内容专栏',
    tagline: '公众号长文：从角度到成稿',
    badges: ['6 阶段', '写作'],
    brief: '公众号「小飞游山玩水」一篇长文。主题：一个人去川西自驾 7 天的真实成本与踩坑。读者是想去但还没去的人。要求 3500 字左右，有具体数字，不写攻略体的流水账。',
    stages: [
      {
        key: 'angle', name: '选题角度', task: 'writing',
        artifact: '角度卡（3 选 1）',
        inBase: 600, outBase: 700,
        why: '角度决定全文价值，用便宜的写作档就够，不需要贵的模型。',
        carry: ['选定角度', '读者画像', '差异化承诺'],
        prompt: `你是公众号主编。基于简报给出 3 个互相竞争的文章角度，然后选一个。

每个角度写：核心主张一句话 / 读者看完会改变什么行为 / 与同类文章的差异点 / 最大风险（为什么可能没人看）。
最后明确选定一个，并写清：目标读者的具体处境（不要「年轻人」这种），
以及本文承诺提供的、别人没写过的具体信息是什么。`
      },
      {
        key: 'material', name: '素材采集', task: 'research', webOnly: true,
        artifact: '素材清单（数字 + 细节）',
        inBase: 1800, outBase: 2000,
        why: '真实数字和细节只能靠联网查或你自己的记录，免费 API 拿不到。',
        carry: ['可用数字', '现场细节', '待核实项'],
        prompt: `你是素材编辑。为这篇文章收集可用的具体素材，不做成稿。

必须输出：
1. 数字清单：项目 | 数值 | 时间 | 来源或出处（油费、住宿、门票、海拔、里程、耗时等）；
2. 细节清单：至少 10 条只有去过的人才知道的具体细节（气味、声音、排队多久、哪个位置拍照最好）；
3. 反常识清单：3 条与大众认知相反的观察；
4. 待核实项：哪些数字你不确定，需要作者本人确认。

禁止：写抒情段落、写「川西很美」这类没有信息量的话。`
      },
      {
        key: 'outline', name: '结构骨架', task: 'writing',
        artifact: '段落级大纲',
        inBase: 2000, outBase: 1300,
        why: '骨架阶段输出短、输入多，适合拿日额度大的平台。',
        carry: ['段落大纲', '每段的任务', '字数分配'],
        prompt: `你是结构编辑。把素材组织成段落级大纲。

要求：
1. 每段写：这段要完成什么（一句话）/ 用哪些素材（列出编号）/ 字数预算；
2. 开头 3 句必须给出本文最硬的那个数字或最反常识的结论，不许铺垫；
3. 每个大段之间要有承接关系（上段留下的问题下段回答）；
4. 标注哪一段最容易写空，给出补救方向；
5. 全文总字数与各段加总要一致。`
      },
      {
        key: 'draft', name: '初稿', task: 'long-text',
        artifact: '初稿全文',
        inBase: 3000, outBase: 4800,
        why: '初稿是整个项目输出最长的一步，安排在日额度最大的平台。',
        carry: ['全文', '待补事实', '存疑段落'],
        prompt: `你是本文作者。按段落大纲写完整初稿，中文，第一人称。

要求：
1. 每段严格按大纲的字数预算写，偏差不超过 20%；
2. 所有数字必须来自素材清单，不许新编；缺失的地方写成「［待补：xxx］」占位；
3. 禁止：排比抒情、空洞总结段、「总之」「不得不说」；
4. 每个具体观察后面要跟一句它意味着什么，但不要升华成人生感悟；
5. 段落之间用事实衔接，不用过渡词堆砌。

直接输出正文，不要输出大纲、不要输出写作说明。`
      },
      {
        key: 'refine', name: '风格化', task: 'writing',
        artifact: '定稿',
        inBase: 5000, outBase: 4600,
        why: '润色换一个模型，能避免原作者的语感自我循环——这是质量考虑，不只是省钱。',
        carry: ['定稿', '删除项清单', '保留项声明'],
        prompt: `你是文字编辑。对初稿做减法，不要重写。

必须做：
1. 删掉所有可以删的形容词与副词（「非常」「十分」「极其」全部删）；
2. 合并重复表达同一意思的句子；
3. 把每段的最后一句检查一遍：如果是总结性废话就删掉；
4. 把被动句、名词化长句改成主动短句；
5. 标题与首段重写，确保第一句就有信息量。

必须保留：所有数字、所有具体细节、作者的判断和语气。
输出：修改后的全文 + 末尾附 5 行「改了什么、为什么」。`
      },
      {
        key: 'titles', name: '标题与封面', task: 'writing',
        artifact: '标题候选 + 封面文案',
        inBase: 1100, outBase: 800,
        why: '最后一步输出很短，用任何免费额度都够；封面图另走生图平台。',
        carry: ['选定标题', '封面文案'],
        prompt: `你是运营编辑。为这篇定稿产出标题和封面文案。

1. 给 8 个标题，分为三类：数字型 / 反常识型 / 场景型，每个标注它吸引的是哪类读者；
2. 从中选 1 个推荐，说明理由，并指出它可能让谁反感；
3. 封面文案：主标题 ≤ 12 字，副标题 ≤ 18 字，各给 3 组；
4. 摘要（公众号首屏那段）：≤ 60 字，不许出现「本文将」。

禁止使用「震惊」「必看」「干货」这类词。`
      }
    ]
  },

  {
    id: 'data-analysis',
    name: '数据分析',
    tagline: '从口径定义到结论 memo',
    badges: ['5 阶段', '批量'],
    brief: '手上有一份 2 万行的门店销售明细（CSV，含日期、门店、SKU、数量、金额、折扣）。目标：找出近 6 个月增长停滞的真实原因，输出给管理层的 2 页结论。',
    stages: [
      {
        key: 'metric', name: '口径定义', task: 'reasoning',
        artifact: '指标口径表',
        inBase: 900, outBase: 1100,
        why: '口径错则全盘错，这一步必须先用推理档把定义钉死，后面才不会反复重算。',
        carry: ['指标定义', '计算规则', '已知口径陷阱'],
        prompt: `你是数据分析负责人。在动数据之前，先把口径定义清楚。

必须输出：
1. 每个要用的指标：定义 / 计算式 / 分子分母口径 / 时间口径 / 含税与否 / 退货怎么算；
2. 列出这份数据最容易踩的 5 个口径陷阱（例如折扣重复计算、跨期归属、SKU 改名导致断档）；
3. 说明哪些问题这份数据回答不了，需要补什么数据；
4. 给出分析计划：先算什么、再算什么，每一步的判定规则是什么。

禁止：直接开始分析数据；给出没有计算式支撑的指标名。`
      },
      {
        key: 'clean', name: '清洗规则', task: 'code',
        artifact: '清洗脚本 + 数据质量报告',
        inBase: 1500, outBase: 1700,
        why: '清洗要写代码执行，用能吃代码的免费档，别用聊天档硬算。',
        carry: ['清洗规则', '丢弃量统计', '剩余数据画像'],
        prompt: `你是数据工程师。写数据清洗与校验的代码。

要求：
1. 先输出一份数据质量检查脚本：缺失率、重复行、异常值（超范围 / 超分布）、日期连续性、外键一致性；
2. 每条清洗规则写清「规则 / 影响行数 / 为什么这样处理 / 有没有替代方案」；
3. 清洗必须留下审计痕迹：不得原地覆盖原始数据，输出清洗后新文件 + 丢弃明细；
4. 给出去重与合并的判定逻辑（不是简单的 drop_duplicates）；
5. 代码可直接运行，依赖只用 pandas / numpy。

最后用 5 行说明：哪些处理是有争议的、可能让结论偏移。`
      },
      {
        key: 'compute', name: '计算与拆解', task: 'code',
        artifact: '结果表 + 归因结论',
        inBase: 1800, outBase: 2000,
        why: '计算密集、输出要精确，代码档比推理档更省 token 也更少算错。',
        carry: ['核心数字', '归因排序', '反直觉发现'],
        prompt: `你是分析员。基于清洗后的数据做计算与拆解。

必须输出：
1. 核心指标的趋势表（按周 / 按门店 / 按品类三个维度各一张）；
2. 增长停滞的归因拆解：把总变化拆成「量 / 价 / 结构 / 门店增减」四部分，每部分贡献绝对值与占比，加起来要等于总变化；
3. 反直觉发现至少 1 条（如果数据里确实没有就明说，不要硬造）；
4. 每个结论都标出「基于多少行数据、覆盖多大样本」；
5. 列出 3 个可能的替代解释，以及能区分它们的方法。

禁止：把相关性写成因果；用「略有下降」代替具体数字。`
      },
      {
        key: 'narrative', name: '图表叙事', task: 'writing',
        artifact: '图表清单 + 每图结论',
        inBase: 2200, outBase: 1600,
        why: '文字工作交给写作档，且这一步输入是数字不是代码，换平台能分散额度。',
        carry: ['图表清单', '每图一句话结论'],
        prompt: `你是数据可视化编辑。为这份分析设计 5 张图，并给每张图配结论。

每张图输出：
图名 / 图表类型（并说明为什么这个类型而不是别的）/ x 轴 y 轴定义 / 要突出的一条信息 / 图下方那行结论（≤ 30 字）/ 这张图可能被误读的地方。

要求：
1. 至少有一张图用来呈现「不看不知道」的部分，不要全是趋势线；
2. 删掉任何只是「看起来专业」但得不出结论的图；
3. 明确说明哪张图是给管理层看的（只有 1 张）；
4. 不要设计双 y 轴图。`
      },
      {
        key: 'memo', name: '结论 memo', task: 'writing',
        artifact: '2 页管理层备忘',
        inBase: 2600, outBase: 1400,
        why: '交付物短但要求高，用中文写作最强的免费档。',
        carry: ['结论与建议', '待决事项'],
        prompt: `你是分析负责人。写一份给管理层的 2 页备忘（约 800 字）。

结构：
1. 第一段就写结论与建议动作（谁、在多长时间内、做什么、预计影响多少）；
2. 支撑结论的 3 个关键数字，每个都写清口径；
3. 归因：主要原因是哪一项，占多少；
4. 不确定性：这份分析有哪些局限，什么情况下结论会反转；
5. 待决策事项：需要管理层拍板的 2~3 件事，每件给出选项与后果。

要求：不用图表术语，不用统计学术语，句子短；每个数字后面必须有单位；
不写「本报告旨在」「综上所述」。`
      }
    ]
  },

  {
    id: 'game-gdd',
    name: '游戏设计',
    tagline: 'GDD：核心循环到实现排期',
    badges: ['4 阶段', '数值'],
    brief: '项目：《星骸纪元》卡牌肉鸽的「星骸深渊」无限刷层模式。目标：一层 3~5 分钟，单局 40 分钟，30 层后难度进入失控式增长。需要给出核心循环、数值配平模型与首版内容表。',
    stages: [
      {
        key: 'loop', name: '核心循环', task: 'reasoning',
        artifact: '循环图（文字版）',
        inBase: 800, outBase: 1100,
        why: '设计判断靠推理，不需要长输出；用最便宜的推理档即可。',
        carry: ['核心循环', '决策点', '循环张力'],
        prompt: `你是游戏设计负责人。定义这个模式的核心循环，不写实现细节。

必须输出：
1. 单层循环（30 秒~5 分钟）与单局循环（40 分钟）分别写清楚，用「玩家做什么 → 得到什么 → 为什么还想再来一次」三段式；
2. 每层循环里玩家必须做的 2~3 个真实决策，每个决策写清「选项 / 代价 / 信息是否充分」；
3. 张力从哪来：风险收益的临界点在哪，玩家什么时候会想撤；
4. 明确指出这个循环最可能无聊的地方，以及用什么机制打断它；
5. 与《杀戮尖塔》《炉石》的循环差异点，一句话说清。`
      },
      {
        key: 'balance', name: '数值配平', task: 'reasoning',
        artifact: '数值模型 + 失控曲线',
        inBase: 1500, outBase: 2200,
        why: '数值推导需要长上下文和严谨性；本地有算力时更适合直接跑模拟脚本验证。',
        carry: ['数值公式', '难度曲线参数', '预期通关率'],
        prompt: `你是数值策划。为这个模式建立可以计算的数值模型。

必须输出：
1. 核心公式：每层敌人强度、玩家期望输出、资源获取的公式，全部用明确参数写出；
2. 30 层的难度曲线数值表（层数 / 敌人强度 / 玩家期望强度 / 比值）；
3. 说明「失控式增长」的触发条件与增长速率，并算出第几层开始玩家理论必死；
4. 三条不同流派（爆发 / 续航 / 资源）在 30 层的存活概率估算，写出假设；
5. 敏感度分析：哪个参数最影响平衡，改动 10% 会带来什么后果。

禁止：只给「大约」「差不多」；所有曲线都要能被 Excel 复算。`
      },
      {
        key: 'content', name: '内容表', task: 'long-text',
        artifact: '首批内容表',
        inBase: 1900, outBase: 3200,
        why: '内容表是纯输出工作量，放在输出额度最大的平台跑。',
        carry: ['内容表', '内容缺口'],
        prompt: `你是内容设计师。基于数值模型产出首版可玩内容表。

必须输出：
1. 20 个敌人：名称 / 层段 / 血量 / 攻击模式 / 克制关系 / 一句话设计意图；
2. 15 张卡牌：名称 / 费用 / 效果（用数值模型里的参数表达）/ 所属流派 / 稀有度；
3. 5 个事件节点：触发条件 / 两个选项 / 各自代价 / 设计意图；
4. 每个内容都要标出它服务于哪个决策点（对应上一阶段的决策清单），没有归属的删掉；
5. 明确列出首版故意不做的内容与原因。

要求：所有数值引用第一阶段公式里的参数名，不要自创单位。`
      },
      {
        key: 'roadmap', name: '实现排期', task: 'writing',
        artifact: '里程碑表 + 风险登记',
        inBase: 1600, outBase: 1400,
        why: '排期是判断与表达，不需要代码能力，用写作档更省钱。',
        carry: ['里程碑', '风险与兜底'],
        prompt: `你是制作人。把设计收敛成可执行的排期。

必须输出：
1. 里程碑表：阶段 / 交付物 / 验收标准（可玩的判定条件）/ 依赖前置；
2. 每个里程碑里「先做哪个功能才能最快验证核心循环」，标出可砍项；
3. 风险登记：风险 / 触发信号 / 兜底方案 / 决策点时间；
4. 明确写出「如果只有 1 周，先做什么」和「如果有 3 个月，加什么」；
5. 用一句话说明这个设计最大的未验证假设是什么。

不要给具体天数估算，只给阶段顺序与前置依赖——天数在独立开发里没有意义。`
      }
    ]
  },

  {
    id: 'literature',
    name: '长文综述',
    tagline: '检索、分章精读、综合与查证',
    badges: ['5 阶段', '可并行'],
    brief: '主题：本地大模型在 8GB 显存下的分层推理（strata / offload）方案综述。目标：讲清 2025~2026 年的主流做法、各自代价，以及哪些说法缺乏实测支撑。',
    stages: [
      {
        key: 'search', name: '文献检索', task: 'research', webOnly: true,
        artifact: '文献清单（含筛选理由）',
        inBase: 1600, outBase: 2000,
        why: '检索必须联网，用带搜索的网页版；免费 API 这段做不了，只能人工搬。',
        carry: ['入围文献', '排除理由', '证据等级'],
        prompt: `你是文献检索员。为目标主题建立一份可用的文献清单。

每条写：[编号] 标题 | 作者/机构 | 时间 | 类型(论文/博客/官方文档/实测分享) | 一句话结论 | 证据等级(A 有实测数据 / B 有描述无数据 / C 纯观点) | 是否入围及理由

要求：
1. 至少覆盖 3 类来源（学术、工程博客、官方文档），说明各类的偏向；
2. 明确列出被排除的文献与被排除的原因（避免后面重复劳动）；
3. 标出互相矛盾的说法，逐条对应到文献编号；
4. 不许把 C 级材料当作结论依据，但要保留它们作为「流行误解样本」。`
      },
      {
        key: 'outline', name: '综述骨架', task: 'reasoning',
        artifact: '章节骨架 + 论点分配',
        inBase: 2000, outBase: 1400,
        why: '结构判断需要推理能力，且输出短，适合推理档。',
        carry: ['章节骨架', '每章论点与用料'],
        prompt: `你是综述作者。基于文献清单搭建骨架。

必须输出：
1. 章节骨架：每章标题 / 要回答的问题 / 用到哪些文献编号 / 预期结论；
2. 全文主线一句话（读者读完应该带走的那个判断）；
3. 每章的「争议点」写清楚：谁说什么、依据是什么等级；
4. 明确哪些章节适合分章并行处理（互相不依赖），并给出每章的独立写作提示要点；
5. 指出骨架里最容易写成文献罗列的那一章，给出补救结构。`
      },
      {
        key: 'read', name: '分章精读', task: 'long-text', repeat: 3,
        artifact: '章节稿（3 章并行）',
        inBase: 2600, outBase: 2200,
        why: '这一阶段拆成 3 份并行跑，正好用掉 3 个不同平台的当日额度——这就是分阶段编排最大的收益点。',
        carry: ['本章结论', '本章引用的证据等级', '与其他章的冲突'],
        prompt: `你是综述写作组成员。只写指定的一章，不写其他章，不写引言和结论。

要求：
1. 开篇第一句直接给本章结论，不要「本章将讨论……」；
2. 每个论断后面用 [编号] 标注文献来源；A 级证据与 C 级证据必须分开表述（「实测显示」vs「有观点认为」）；
3. 遇到文献互相矛盾，把矛盾摆出来，说明你倾向哪一方及理由，不要和稀泥；
4. 每章控制在 1200~1600 字；
5. 章末用 3 行写：本章结论 / 本章没能证明的部分 / 与其他章可能冲突的地方。

禁止：写成文献列表；用「近年来」「随着……的发展」开头。`
      },
      {
        key: 'synth', name: '综合成文', task: 'long-text',
        artifact: '综述全文',
        inBase: 4200, outBase: 3600,
        why: '综合需要把各章拼成一条线，是全文输出的高峰，安排在日额度最大的平台。',
        carry: ['全文', '主线论证', '未解决争议'],
        prompt: `你是综述主笔。把各章稿综合成一篇有主线的完整综述。

必须做：
1. 写引言（≤ 400 字）：提出问题、说明为什么现在这个问题重要、给出全文主线判断；
2. 各章之间加过渡：上章留下的问题由下章回答，不要用「接下来讨论」；
3. 写结论（≤ 500 字）：回答主线问题，明确区分「已被实测支持的」「仍是推测的」「建议读者自己验证的」；
4. 消解各章之间的重复与冲突，冲突无法消解就保留并说明；
5. 全文统一术语，第一处出现时给中英文对照。

禁止：新增未在各章出现的文献或数据；把推测写成结论。`
      },
      {
        key: 'verify', name: '查证复核', task: 'reasoning',
        artifact: '查证清单',
        inBase: 2600, outBase: 1200,
        why: '复核交给没参与写作的模型，专门抓引用错位和过度归纳。',
        carry: ['必须修正项', '可信度判断'],
        prompt: `你是事实核查员。逐条核对这份综述，不做文字润色。

检查项：
1. 引用错位：每个 [编号] 标注的论断，是否真的由该文献支持？列出可疑的；
2. 过度归纳：把个别实测说成普遍结论的地方，指出原文并改写建议；
3. 证据等级错配：C 级材料被当作结论依据的地方；
4. 数字与单位是否准确、是否有时效性问题；
5. 最后给判断：可信 / 有小问题 / 有硬伤，并列出必须修正项（按严重程度）。

找不到问题就明确说「未发现」，不许凑数。`
      }
    ]
  }
];

/* ============================================================
   编排引擎
   ============================================================ */

/* 该阶段能否被程序自动调用：只有 cat==='api' 的平台提供 API */
function pipeScriptable(p) {
  return p.cat === 'api';
}

/* 需要联网检索的阶段只能用网页版（免费 API 普遍无联网） */
const WEB_CATS = ['research', 'chat'];

function pipeCandidates(st, mode) {
  return PLATFORMS
    .filter(p => (p.tags || []).includes(st.task))
    /* 需要联网的阶段在脚本模式下也要给个落点：它会被标成「需人工」，
       由人在网页版跑完后把结果交给脚本。若这里排除网页版，
       这类阶段会直接分配不到平台，整条流水线卡死。 */
    .filter(p => (mode === 'script' && !st.webOnly) ? pipeScriptable(p) : true)
    .filter(p => !st.webOnly || WEB_CATS.includes(p.cat))
    .map(p => {
      const oneShot = p.quotaType === 'gift' || p.quotaType === 'trial';
      const cap = oneShot ? (p.tokensTotal || 0) : dailyCapacity(p, st.inTok, st.outTok).cap;
      return { p, oneShot, cap, weight: QUOTA_TYPES[p.quotaType].weight };
    })
    .filter(c => c.cap > 0);
}

/* 任务适配偏好：光看额度会把最关键的阶段分给能力偏基础的免费模型。
   这里按社区口碑给「更合适的平台」加权，权重刻意低于额度约束（30 < 60），
   所以额度不够时仍会被挤走——偏好是加分项，不是硬规则。 */
const TASK_PREFER = {
  'long-text': ['zhipu', 'kimi', 'gemini'],
  'writing':   ['zhipu', 'kimi'],
  'reasoning': ['deepseek', 'gemini', 'zhipu'],
  'code':      ['zhipu', 'gemini', 'deepseek'],
  'research':  ['perplexity', 'kimi'],
  'batch':     ['volc', 'qianfan'],
  'chat':      ['zhipu', 'gemini']
};

/* 打分：可再生 > 一次性；没用过的平台加分（分散额度、也避免串行依赖同一家）；
   任务适配偏好再加分；同类里偏好额度大的。 */
function pipeScore(c, touched, st) {
  const prefs = TASK_PREFER[(st && st.task) || ''] || [];
  const pi = prefs.indexOf(c.p.id);
  const pref = pi === 0 ? 30 : (pi > 0 ? 20 : 0);
  const renew = c.oneShot ? 0 : 60;
  const diverse = touched.has(c.p.id) ? 0 : 28;
  const w = c.weight * 0.15;
  const cap = Math.min(18, Math.log10(c.cap + 1) * 2.2);
  return renew + diverse + w + pref + cap;
}

function pipePick(st, usedToday, spentOnce, mode, exclude) {
  const list = pipeCandidates(st, mode)
    .filter(c => c.p.id !== exclude)
    .map(c => {
      const used = c.oneShot ? (spentOnce[c.p.id] || 0) : (usedToday[c.p.id] || 0);
      const room = c.cap - used;
      return { ...c, room, score: pipeScore(c, new Set(Object.keys(usedToday).concat(Object.keys(spentOnce))), st) };
    })
    .filter(c => c.room >= st.total)
    .sort((a, b) => b.score - a.score || b.room - a.room);
  return list[0] || null;
}

function planPipeline(tplId, scaleKey, mode) {
  const tpl = PIPELINE_TEMPLATES.find(t => t.id === tplId) || PIPELINE_TEMPLATES[0];
  const mul = (SCALES[scaleKey] || SCALES.small).mul;

  /* 展开 repeat：并行章节各自独立占额度 */
  const raw = [];
  tpl.stages.forEach(s => {
    const n = s.repeat || 1;
    for (let i = 1; i <= n; i++) {
      raw.push({ ...s, inst: n > 1 ? i : 0, instTotal: n, key: n > 1 ? `${s.key}-${i}` : s.key });
    }
  });

  const usedToday = {};   // 当日已用（可再生平台，次日清零）
  const spentOnce = {};   // 一次性额度累计消耗（不清零）
  let day = 1;
  const stages = [];
  let infeasible = null;

  let si = 0;
  for (const st of raw) {
    /* 第一阶段没有上游，不该摊交接卡的输入成本，提示词里也不该提「上游」 */
    const isFirst = si === 0;
    si += 1;
    const cardIn = (st.card === false || isFirst) ? 0 : CARD_TOK;
    const inTok = Math.round(st.inBase * mul) + cardIn;
    const outTok = Math.round(st.outBase * mul);
    const s = { ...st, inTok, outTok, cardIn, total: inTok + outTok };

    let pick = pipePick(s, usedToday, spentOnce, mode);
    if (!pick) {
      /* 今天放不下：推进到下一天，日额度重置（一次性额度不重置） */
      day += 1;
      for (const k of Object.keys(usedToday)) delete usedToday[k];
      pick = pipePick(s, usedToday, spentOnce, mode);
      if (!pick) {
        infeasible = infeasible || `${st.name}（${fmt(s.total)} tokens）超过任何单一免费档的单日可承接量`;
      }
    }

    const fallback = pick ? pipePick(s, {}, {}, mode, pick.p.id) : null;

    if (pick) {
      if (pick.oneShot) spentOnce[pick.p.id] = (spentOnce[pick.p.id] || 0) + s.total;
      else usedToday[pick.p.id] = (usedToday[pick.p.id] || 0) + s.total;
      s.assign = { id: pick.p.id, name: pick.p.name, quotaType: pick.p.quotaType, cap: pick.cap, room: pick.room };
    } else {
      s.assign = null;
    }
    s.fallback = fallback ? { id: fallback.p.id, name: fallback.p.name, cap: fallback.cap } : null;
    s.day = day;
    s.manual = mode === 'script' && st.webOnly;
    stages.push(s);
  }

  const totalTokens = stages.reduce((a, s) => a + s.total, 0);
  const byPlat = {};
  stages.forEach(s => {
    if (!s.assign) return;
    const k = s.assign.id;
    byPlat[k] = byPlat[k] || { id: k, name: s.assign.name, quotaType: s.assign.quotaType, tokens: 0, count: 0, cap: s.assign.cap };
    byPlat[k].tokens += s.total;
    byPlat[k].count += 1;
  });

  return {
    tpl, scaleKey, mode, mul, stages,
    days: day,
    totalTokens,
    cardTotal: stages.reduce((a, s) => a + (s.cardIn || 0), 0),
    cost: (totalTokens / 1e6) * PAID_REF,
    infeasible,
    byPlat: Object.values(byPlat).sort((a, b) => b.tokens - a.tokens)
  };
}

/* 各平台的 OpenAI 兼容端点（2026-10 核对；模型 id 必须自己对着控制台填）
   注意：xai 的 Anthropic 兼容端点 /v1/messages 已标记 deprecated，新项目不要依赖。
   moonshot 另提供 https://api.moonshot.cn/anthropic（Anthropic Messages 兼容）。
   minimax 国内版与国际版（api.minimax.io/v1）账号不通用，别混用。 */
const PIPE_BASE = {
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  volc: 'https://ark.cn-beijing.volces.com/api/v3',
  bailian: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  deepseek: 'https://api.deepseek.com/v1',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  qianfan: 'https://qianfan.baidubce.com/v2',
  longcat: 'https://api.longcat.chat/openai/v1',
  modelscope: 'https://api-inference.modelscope.cn/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  'github-models': 'https://models.github.ai/inference',
  sensenova: 'https://api.sensenova.cn/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  minimax: 'https://api.minimaxi.com/v1',
  spark: 'https://spark-api-open.xf-yun.com/v1',
  xai: 'https://api.x.ai/v1',
  openai: 'https://api.openai.com/v1',
  'amd-radeon': 'https://developer.amd.com.cn/radeon/api/v1',
  together: 'https://api.together.xyz/v1',
};

/* ============================================================
   视图：编排
   ============================================================ */
const PIPE_DEFAULT = { tpl: 'research-report', scale: 'small', mode: 'script' };

function renderPipeline() {
  const t = PIPE_DEFAULT.tpl;
  $('#pipe-tpls').innerHTML = PIPELINE_TEMPLATES.map(x => `
    <button class="tpl-chip ${x.id === t ? 'on' : ''}" data-tpl="${x.id}">
      <b>${esc(x.name)}</b>
      <span>${esc(x.tagline)}</span>
    </button>`).join('');

  $('#pipe-scales').innerHTML = Object.entries(SCALES).map(([k, v]) => `
    <button class="seg ${k === PIPE_DEFAULT.scale ? 'on' : ''}" data-scale="${k}">${v.label}<i>${esc(v.desc)}</i></button>`).join('');

  $('#pipe-modes').innerHTML = `
    <button class="seg ${PIPE_DEFAULT.mode === 'script' ? 'on' : ''}" data-mode="script">脚本自动<i>导出可运行编排器，API 直连</i></button>
    <button class="seg ${PIPE_DEFAULT.mode === 'manual' ? 'on' : ''}" data-mode="manual">手动网页<i>含网页版，人工搬运</i></button>`;

  const brief = PIPELINE_TEMPLATES.find(x => x.id === t).brief;
  $('#pipe-brief').value = brief;

  $$('[data-tpl]').forEach(b => b.addEventListener('click', () => {
    PIPE_DEFAULT.tpl = b.dataset.tpl;
    $('#pipe-brief').value = PIPELINE_TEMPLATES.find(x => x.id === b.dataset.tpl).brief;
    $$('[data-tpl]').forEach(x => x.classList.toggle('on', x.dataset.tpl === PIPE_DEFAULT.tpl));
    renderPipelinePlan();
  }));
  $$('[data-scale]').forEach(b => b.addEventListener('click', () => {
    PIPE_DEFAULT.scale = b.dataset.scale;
    $$('[data-scale]').forEach(x => x.classList.toggle('on', x.dataset.scale === PIPE_DEFAULT.scale));
    renderPipelinePlan();
  }));
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => {
    PIPE_DEFAULT.mode = b.dataset.mode;
    $$('[data-mode]').forEach(x => x.classList.toggle('on', x.dataset.mode === PIPE_DEFAULT.mode));
    renderPipelinePlan();
  }));

  renderPipelinePlan();
}

function renderPipelinePlan() {
  const plan = planPipeline(PIPE_DEFAULT.tpl, PIPE_DEFAULT.scale, PIPE_DEFAULT.mode);
  window.__pipe = plan;   /* 接入通道页据此导出网关配置 */

  window.__plan = plan; // 导出按钮用

  const renewDays = plan.days;
  const cardSave = plan.stages.reduce((a, s) => a + (s.inTok - s.cardIn) * 0, 0);

  $('#pipe-summary').innerHTML = `
    <div class="kpi">
      <div class="k-label">项目总消耗</div>
      <div class="k-val k-accent">${fmt(plan.totalTokens)}<small>tok</small></div>
      <div class="k-foot">${plan.stages.length} 个阶段 · 规模 ${SCALES[plan.scaleKey].label}（×${plan.mul}）</div>
    </div>
    <div class="kpi">
      <div class="k-label">需跨几天完成</div>
      <div class="k-val ${renewDays > 1 ? 'k-amber' : 'k-green'}">${renewDays}<small>天</small></div>
      <div class="k-foot">${renewDays > 1 ? '受日额度限制，需等重置' : '当天即可跑完'}</div>
    </div>
    <div class="kpi">
      <div class="k-label">付费对照成本</div>
      <div class="k-val ${plan.cost < 1 ? 'k-green' : 'k-amber'}">¥${plan.cost.toFixed(2)}</div>
      <div class="k-foot">按 ¥${PAID_REF}/百万 tokens 估（假设值）</div>
    </div>
    <div class="kpi">
      <div class="k-label">交接卡占比</div>
      <div class="k-val">${Math.round(plan.cardTotal / plan.totalTokens * 100)}<small>%</small></div>
      <div class="k-foot">阶段间传递的全部上下文 · ${fmt(plan.cardTotal)} tok</div>
    </div>`;

  /* 平台分配表 */
  $('#pipe-alloc').innerHTML = plan.byPlat.map(a => {
    const qt = QUOTA_TYPES[a.quotaType];
    const oneShot = a.quotaType === 'gift' || a.quotaType === 'trial';
    const web = a.quotaType === 'freechat';
    /* 一次性额度和网页版都没有「日额度」概念，硬算百分比会误导 */
    const pct = (oneShot || web) ? null : Math.max(2, Math.min(100, Math.round(a.tokens / a.cap * 100)));
    return `<tr>
      <td><b>${esc(a.name)}</b></td>
      <td><span class="chip ${qt.color}" style="font-size:10px;padding:2px 6px">${qt.short}</span></td>
      <td class="mono">${a.count}</td>
      <td class="mono">${fmt(a.tokens)}</td>
      <td>${pct === null
        ? `<span style="color:var(--ink-3)">${oneShot ? '一次性额度' : '网页版 · 人工'}</span>`
        : `<div class="bar"><i style="width:${pct}%"></i></div><span class="mono" style="font-size:11px">${pc(a.tokens, a.cap)}</span>`}</td>
    </tr>`;
  }).join('');

  /* 阶段流水线 */
  $('#pipe-stages').innerHTML = plan.stages.map((s, i) => {
    const qt = s.assign ? QUOTA_TYPES[s.assign.quotaType] : null;
    return `<div class="stage ${s.assign ? '' : 'bad'}" data-stage="${esc(s.key)}">
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
            ${s.assign ? `<span class="plat-pill">${esc(s.assign.name)}</span>` : '<span class="chip red">无可用额度</span>'}
            <span class="mono stage-tok">${fmt(s.total)} tok</span>
          </div>
        </div>
        <div class="stage-meta">
          <span class="chip ghost" style="font-size:10.5px;padding:2px 7px">${esc(TASK_TAGS[s.task] || s.task)}</span>
          ${qt ? `<span class="chip ${qt.color}" style="font-size:10.5px;padding:2px 7px">${esc(qt.label)}</span>` : ''}
          <span class="stage-mday">D${s.day}</span>
          <span class="stage-in">输入 ${fmt(s.inTok)} · 输出 ${fmt(s.outTok)}</span>
          ${s.manual ? '<span class="chip amber" style="font-size:10.5px;padding:2px 7px">需人工完成</span>' : ''}
          ${s.fallback ? `<span class="stage-fb">429 备选：${esc(s.fallback.name)}</span>` : ''}
        </div>
        <div class="stage-foot">
          <div class="stage-why">${esc(s.why)}</div>
          <button class="mini-btn" data-open="${esc(s.key)}">看提示词</button>
        </div>
      </div>
    </div>`;
  }).join('');

  $$('[data-open]').forEach(b => b.addEventListener('click', () => openStageDrawer(b.dataset.open)));

  /* 结论条 */
  const warn = plan.infeasible
    ? `<div class="pipe-warn"><b>有阶段放不下：</b>${esc(plan.infeasible)}。需要拆分阶段、缩小规模，或让某一段走付费兜底。</div>`
    : `<div class="pipe-ok"><b>可以零成本跑完。</b>${plan.days === 1
        ? `全部 ${plan.stages.length} 个阶段当天完成，不消耗任何付费额度。`
        : `分 ${plan.days} 天完成——不是时间不够，而是日额度必须等重置。这就是为什么「可再生额度」比「一次性礼包」更值得依赖。`}
      </div>`;
  $('#pipe-verdict').innerHTML = warn;

  /* 导出按钮 */
  $('#pipe-export').innerHTML = `
    <button class="run-btn" id="ex-md" style="width:auto;padding:8px 18px">导出执行手册 .md</button>
    <button class="run-btn ghost-btn" id="ex-py" style="width:auto;padding:8px 18px">导出编排脚本 .py</button>
    <button class="run-btn ghost-btn" id="ex-json" style="width:auto;padding:8px 18px">导出阶段配置 .json</button>`;
  $('#ex-md').addEventListener('click', () => downloadFile(runName(plan, 'md'), buildManualMd(plan), 'text/markdown'));
  $('#ex-py').addEventListener('click', () => downloadFile(runName(plan, 'py'), buildRunnerPy(plan), 'text/x-python'));
  $('#ex-json').addEventListener('click', () => downloadFile(runName(plan, 'json'), JSON.stringify(buildConfigJson(plan), null, 2), 'application/json'));
}

/* 阶段详情抽屉 */
function openStageDrawer(key) {
  const plan = window.__plan;
  const s = plan && plan.stages.find(x => x.key === key);
  if (!s) return;
  const prompt = buildStagePrompt(s, plan);
  const qt = s.assign ? QUOTA_TYPES[s.assign.quotaType] : null;

  $('#drawer').innerHTML = `
    <div class="drawer-head">
      <div style="min-width:0">
        <h3>${esc(s.name)}</h3>
        <div class="dv">${esc(s.artifact)} · D${s.day} · ${fmt(s.total)} tokens</div>
      </div>
      <button class="drawer-close" id="drawer-x" aria-label="关闭">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
    </div>
    <div class="drawer-body">
      <div class="dblock" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px">
        ${s.assign ? `<span class="chip green"><i class="dot"></i>${esc(s.assign.name)}</span>` : '<span class="chip red">无可用额度</span>'}
        ${qt ? `<span class="chip ${qt.color}">${esc(qt.label)}</span>` : ''}
        <span class="chip ghost">${esc(TASK_TAGS[s.task] || s.task)}</span>
        ${s.manual ? '<span class="chip amber">需人工</span>' : ''}
      </div>

      <div class="dblock">
        <h4>为什么分配给这个平台</h4>
        <p>${esc(s.why)}</p>
        ${s.assign ? `<p style="margin-top:6px;font-size:12px;color:var(--ink-3)">${s.assign.quotaType === 'freechat'
          ? `网页版按次使用，没有可精确计量的日额度；本阶段按 ${fmt(s.total)} tokens 估算占位`
          : `该平台当日可承接 ${fmt(s.assign.cap)} tokens，本阶段占用 ${pc(s.total, s.assign.cap)}`}${
          s.fallback ? `；主通道 429 时切换到 <b>${esc(s.fallback.name)}</b>` : ''}</p>` : ''}
      </div>

      <div class="dblock">
        <h4>预算</h4>
        <p class="mono" style="font-size:12px">输入 ${fmt(s.inTok)}（其中交接卡 ${fmt(s.cardIn)}） + 输出 ${fmt(s.outTok)} = ${fmt(s.total)}</p>
      </div>

      <div class="dblock">
        <h4>本阶段必须产出的交接内容</h4>
        <ul>${(s.carry || []).map(c => `<li class="plus">${esc(c)}</li>`).join('')}</ul>
      </div>

      <div class="dblock">
        <h4>可直接粘贴的提示词</h4>
        <div class="pw-wrap"><pre class="pw" id="pw-text">${esc(prompt)}</pre></div>
        <button class="mini-btn" id="copy-pw" style="margin-top:8px">复制提示词</button>
      </div>
    </div>`;

  $('#drawer-mask').classList.add('on');
  $('#drawer').classList.add('on');
  $('#drawer-x').addEventListener('click', closeDrawer);
  $('#copy-pw').addEventListener('click', () => copyText(prompt, $('#copy-pw')));
}

/* 拼接阶段实际提示词：简报 + （上游交接卡占位）+ 本阶段指令 + 交接卡格式 */
function buildStagePrompt(s, plan) {
  const card = (s.carry || []).map(c => `- ${c}`).join('\n');
  return `【项目简报】
${$('#pipe-brief') ? $('#pipe-brief').value.trim() : plan.tpl.brief}

【执行方式】
这是分阶段流水线的第 ${plan.stages.indexOf(s) + 1}/${plan.stages.length} 步。你只做这一步，不要替后面阶段写内容。
${s.cardIn ? '上游阶段的结论以「交接卡」形式附在下面，除此之外你不需要知道上游的完整过程。' : ''}
${card ? `本阶段需要向下一阶段交出：\n${card}` : ''}

【本阶段任务】
${s.prompt}
${s.cardIn ? CARD_SPEC : ''}`;
}

function pc(a, b) {
  if (!b || b === Infinity) return '—';
  const r = a / b;
  if (r > 0 && r < 0.01) return '不足 1%';   /* 写 0% 会让人以为没分配 */
  return Math.round(r * 100) + '%';
}

function runName(plan, ext) {
  return `${plan.tpl.name}-流水线-${plan.scaleKey}.${ext}`;
}

/* ============================================================
   导出：执行手册
   ============================================================ */
function buildManualMd(plan) {
  const L = [];
  L.push(`# ${plan.tpl.name} · 多模型分阶段执行手册`);
  L.push('');
  L.push(`> 生成时间 ${new Date().toLocaleString('zh-CN')} ｜ 额度数据核对至 ${DATA_DATE}`);
  L.push(`> 规模：${SCALES[plan.scaleKey].label}（×${plan.mul}） ｜ 模式：${plan.mode === 'script' ? '脚本自动（仅 API 平台）' : '手动网页（含网页版）'}`);
  L.push('');
  L.push('## 一、结论');
  L.push('');
  L.push(`- 项目总消耗：**${plan.totalTokens.toLocaleString()} tokens**，拆成 **${plan.stages.length} 个阶段**`);
  L.push(`- 需跨 **${plan.days} 天** 完成${plan.days > 1 ? '（受日额度限制，需等重置，不是时间不够）' : '（当天可跑完）'}`);
  L.push(`- 若走付费：约 **¥${plan.cost.toFixed(2)}**（按 ¥${PAID_REF}/百万 tokens 假设估价）`);
  L.push(`- 阶段间传递的上下文合计仅 ${plan.cardTotal.toLocaleString()} tokens，占总消耗 ${Math.round(plan.cardTotal / plan.totalTokens * 100)}%`);
  if (plan.infeasible) L.push(`- ⚠ **有阶段放不下**：${plan.infeasible}`);
  L.push('');
  L.push('## 二、项目简报');
  L.push('');
  L.push('```text');
  L.push((($('#pipe-brief') && $('#pipe-brief').value.trim()) || plan.tpl.brief));
  L.push('```');
  L.push('');
  L.push('## 三、平台分配');
  L.push('');
  L.push('| 平台 | 额度形态 | 承担阶段 | tokens | 占其日额度 |');
  L.push('| --- | --- | --- | --- | --- |');
  plan.byPlat.forEach(a => {
    const qt = QUOTA_TYPES[a.quotaType];
    const pct = (a.quotaType === 'gift' || a.quotaType === 'trial') ? '一次性' : pc(a.tokens, a.cap) + '%';
    L.push(`| ${a.name} | ${qt.label} | ${a.count} | ${a.tokens.toLocaleString()} | ${pct} |`);
  });
  L.push('');
  L.push('## 四、阶段清单');
  L.push('');
  L.push('| # | 阶段 | 平台 | D | 输入 | 输出 | 产出物 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  plan.stages.forEach((s, i) => {
    L.push(`| ${i + 1} | ${s.name}${s.inst ? ` (${s.inst}/${s.instTotal})` : ''} | ${s.assign ? s.assign.name : '无'} | D${s.day} | ${s.inTok.toLocaleString()} | ${s.outTok.toLocaleString()} | ${s.artifact} |`);
  });
  L.push('');
  L.push('## 五、阶段详情');
  plan.stages.forEach((s, i) => {
    L.push('');
    L.push(`### ${i + 1}. ${s.name}${s.inst ? `（第 ${s.inst}/${s.instTotal} 份）` : ''}`);
    L.push('');
    L.push(`- 平台：**${s.assign ? s.assign.name : '无可用额度'}**${s.fallback ? `（429 时切 ${s.fallback.name}）` : ''}`);
    L.push(`- 排期：第 ${s.day} 天 ｜ 预算：输入 ${s.inTok.toLocaleString()} + 输出 ${s.outTok.toLocaleString()} = ${s.total.toLocaleString()} tokens`);
    L.push(`- 产出物：${s.artifact}`);
    L.push(`- 选型依据：${s.why}`);
    L.push(`- 必须交出：${(s.carry || []).join('；')}`);
    if (s.manual) L.push('- ⚠ 本阶段需人工在网页完成，结果存为 `in/' + String(i + 1).padStart(2, '0') + '-' + s.key + '.md`');
    L.push('');
    L.push('```text');
    L.push(buildStagePrompt(s, plan));
    L.push('```');
  });
  L.push('');
  L.push('## 六、为什么这样能省 token');
  L.push('');
  L.push('1. **只传交接卡，不传全文。** 真实项目里输入占 token 的 80% 以上。若第 5 阶段把前 4 阶段全文一起带上，单次输入会从 4 千涨到 3 万以上，一天额度直接见底。');
  L.push('2. **每阶段换一个平台。** 各平台的免费额度相互独立，限制维度也不同（有的卡每日次数、有的卡每分钟 tokens、有的卡并发）。按阶段分派后，总吞吐是相加而不是取最小。');
  L.push('3. **生成与复核分离。** 复核阶段必须用没参与写作的模型，否则它会顺着自己上一轮的措辞确认自己——省 token 只是副作用，主要收益是质量。');
  L.push('4. **一次性礼包只用在最贵的阶段。** 日额度用在小阶段（检索、核算、润色），礼包留给成稿这种单次输出最大的步骤。');
  L.push('');
  L.push('## 七、风险与使用须知');
  L.push('');
  L.push('- 免费档随时收紧，本手册里的平台分配按 ' + DATA_DATE + ' 的政策推算，一个月后可能需要重排。');
  L.push('- 免费 API 普遍不支持联网检索，所有「检索」阶段都要人工在网页版完成；脚本会自动跳过并提示。');
  L.push('- 免费档的并发与 QPS 很低，阶段之间不要并发跑，串行最稳。');
  L.push('- 交接卡如果缺失或写得太长，下一阶段质量会明显下降。用脚本跑时，缺失交接卡会退化为「截取前 400 字」，务必人工看一眼。');
  L.push('');
  return L.join('\n');
}

/* ============================================================
   导出：编排脚本（Python，零依赖，urllib 直连）
   ============================================================ */
function buildRunnerPy(plan) {
  const stages = plan.stages.map((s, i) => {
    const pid = s.assign ? s.assign.id : '';
    const fb = s.fallback ? [s.fallback.id] : [];
    return {
      id: String(i + 1).padStart(2, '0') + '-' + s.key,
      name: s.name,
      task: s.task,
      provider: pid,
      fallback: fb,
      manual: !!s.manual,
      day: s.day,
      max_in: s.inTok,
      max_out: s.outTok,
      prompt: buildStagePrompt(s, plan).replace(/\r\n/g, '\n'),
      artifact: s.artifact
    };
  });

  const providers = {};
  plan.stages.forEach(s => {
    [s.assign, s.fallback].forEach(a => {
      if (a && a.id && !providers[a.id]) {
        const p = byId(a.id);
        providers[a.id] = {
          base: PIPE_BASE[a.id] || '',
          model: '',
          key_env: a.id.toUpperCase().replace(/-/g, '_') + '_API_KEY',
          note: p ? p.name : a.id
        };
      }
    });
  });

  const py = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
${plan.tpl.name} · 多模型分阶段编排器（自动生成 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}）

设计要点
  1. 每个阶段换一个平台，各自吃自己的免费额度；
  2. 阶段之间只传「交接卡」，不传全文——输入侧才是 token 大头；
  3. 主平台失败（429 / 超时 / 报错）自动按 fallback 顺序切换；
  4. 零第三方依赖，只用标准库 urllib，避免装包。

使用步骤
  1. 把每个平台的 model id 填进 PROVIDERS（免费模型的 id 每月都可能变，必须对着控制台抄）；
  2. 把 API Key 放进环境变量（脚本不落地密钥）：
       export ZHIPU_API_KEY=xxx        # Windows: set ZHIPU_API_KEY=xxx
  3. 先干跑看提示词：  python run_pipeline.py --dry-run
  4. 正式跑：          python run_pipeline.py
  5. 标了 manual 的阶段（需要联网检索的），人工在网页版跑完，
     把结果存到 in/<阶段id>.md，再跑一次会自动接着往下走。

产出
  out/<阶段id>.md      每个阶段的完整产出
  out/_card.md         最新的交接卡
  out/_log.json        每阶段用量与耗时
"""
import json, os, sys, time, pathlib, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out"; OUT.mkdir(exist_ok=True)
IN  = ROOT / "in";  IN.mkdir(exist_ok=True)

CARD_MARK = "[交接卡]"

# ---------------- provider 配置（需你填写 model）----------------
# key_env 指向环境变量名；base 是 OpenAI 兼容端点。
PROVIDERS = {
${Object.entries(providers).map(([id, c]) => `    "${id}": {"base": "${c.base}", "model": "", "key_env": "${c.key_env}"},  # ${c.note}`).join('\n')}
}

STAGES = json.loads(r'''
${JSON.stringify(stages, null, 1)}
''')


def chat(cfg, key, sys_msg, user_msg, max_out):
    """一次 OpenAI 兼容调用，返回 (文本, usage)"""
    body = json.dumps({
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.7,
        "max_tokens": max_out,
    }).encode("utf-8")
    req = urllib.request.Request(
        cfg["base"].rstrip("/") + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read().decode("utf-8"))
    text = data["choices"][0]["message"].get("content") or ""
    return text, data.get("usage", {})


def call_stage(st, sys_msg, user_msg):
    """按 provider -> fallback 依次尝试，每个重试 2 次"""
    chain = [st["provider"]] + st.get("fallback", [])
    errs = []
    for pid in chain:
        cfg = PROVIDERS.get(pid)
        if not cfg or not cfg.get("base"):
            errs.append(f"{pid}: 未配置 base"); continue
        if not cfg.get("model"):
            errs.append(f"{pid}: 未填 model"); continue
        key = os.environ.get(cfg["key_env"])
        if not key:
            errs.append(f"{pid}: 环境变量 {cfg['key_env']} 未设置"); continue
        for attempt in range(3):
            try:
                text, usage = chat(cfg, key, sys_msg, user_msg, st["max_out"])
                if not text.strip():
                    raise RuntimeError("空响应")
                return text, usage, pid
            except urllib.error.HTTPError as e:
                detail = e.read()[:200].decode("utf-8", "ignore")
                errs.append(f"{pid}: HTTP {e.code} {detail}")
                if e.code in (401, 403, 404):
                    break                      # 权限/模型不存在，换下一个平台
                time.sleep(2 ** attempt)       # 429 / 5xx 退避
            except Exception as e:
                errs.append(f"{pid}: {type(e).__name__} {e}")
                time.sleep(2 ** attempt)
    raise RuntimeError("所有平台均失败：\\n" + "\\n".join(errs))


def split_card(text):
    """把正文与交接卡分开：卡片是下一阶段的唯一输入"""
    i = text.rfind(CARD_MARK)
    if i < 0:
        return text, text[:400]           # 没写卡片 -> 退化为截断，会有质量损失
    return text[:i].strip(), text[i:].strip()


def main():
    dry = "--dry-run" in sys.argv
    brief = (ROOT / "brief.md")
    print(f"共 {len(STAGES)} 个阶段，起始简报来自项目配置。" + ("  [干跑模式]" if dry else ""))
    card = ""
    log = []
    for i, st in enumerate(STAGES, 1):
        tag = f"[{i}/{len(STAGES)}] {st['name']}"
        prev = OUT / (st["id"] + ".md")
        if prev.exists() and not dry:
            txt = prev.read_text(encoding="utf-8")
            _, card = split_card(txt)
            print(f"{tag} 已存在，跳过（沿用其交接卡）")
            continue

        user_msg = st["prompt"]
        if card:
            user_msg = "【上游交接卡】\\n" + card + "\\n\\n" + user_msg

        if st.get("manual"):
            hint = IN / (st["id"] + ".md")
            if hint.exists():
                txt = hint.read_text(encoding="utf-8")
                prev.write_text(txt, encoding="utf-8")
                _, card = split_card(txt)
                print(f"{tag} 读取人工结果并继续")
                continue
            pf = OUT / (st["id"] + ".prompt.md")
            pf.write_text(user_msg, encoding="utf-8")
            print(f"{tag} 需人工完成：这一步要联网，免费 API 代不了。")
            print(f"        提示词已写入 out/{st['id']}.prompt.md")
            print(f"        在带联网的网页版跑完后，结果存到 in/{st['id']}.md ，再重新运行本脚本。")
            if not dry:
                return 0
            continue

        if dry:
            (OUT / (st["id"] + ".prompt.md")).write_text(user_msg, encoding="utf-8")
            print(f"{tag} 干跑：提示词已存 out/{st['id']}.prompt.md  （预计输出 ≤{st['max_out']} tok）")
            continue

        t0 = time.time()
        try:
            text, usage, pid = call_stage(st, "你是流水线中的一个执行环节，只完成当前阶段的任务。", user_msg)
        except Exception as e:
            print(f"{tag} 失败：{e}")
            return 1
        body, card = split_card(text)
        (OUT / (st["id"] + ".md")).write_text(text, encoding="utf-8")
        (OUT / "_card.md").write_text(card, encoding="utf-8")
        dt = time.time() - t0
        rec = {"stage": st["id"], "provider": pid,
               "in": usage.get("prompt_tokens"), "out": usage.get("completion_tokens"), "sec": round(dt, 1)}
        log.append(rec)
        print(f"{tag} 完成 · {pid} · in {rec['in']} / out {rec['out']} · {dt:.0f}s")

    (OUT / "_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    if dry:
        print(f"\\n干跑结束：{len(STAGES)} 个阶段，提示词都在 out/ 下，没有发出任何请求。")
        return 0
    tot_in = sum(x["in"] or 0 for x in log); tot_out = sum(x["out"] or 0 for x in log)
    print(f"\\n全部完成：{len(log)} 个阶段，输入 {tot_in} + 输出 {tot_out} = {tot_in + tot_out} tokens")
    print(f"产出目录：{OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;
  return py;
}

function buildConfigJson(plan) {
  return {
    project: plan.tpl.name,
    generated_at: new Date().toISOString(),
    data_date: DATA_DATE,
    scale: plan.scaleKey,
    mode: plan.mode,
    total_tokens: plan.totalTokens,
    days: plan.days,
    brief: ($('#pipe-brief') && $('#pipe-brief').value.trim()) || plan.tpl.brief,
    stages: plan.stages.map((s, i) => ({
      order: i + 1,
      id: String(i + 1).padStart(2, '0') + '-' + s.key,
      name: s.name,
      task: s.task,
      day: s.day,
      provider: s.assign ? s.assign.id : null,
      fallback: s.fallback ? s.fallback.id : null,
      provider_base: s.assign ? (PIPE_BASE[s.assign.id] || null) : null,
      manual: !!s.manual,
      budget: { input: s.inTok, output: s.outTok, total: s.total },
      artifact: s.artifact,
      handoff_fields: s.carry
    }))
  };
}

/* ============================================================
   小工具：下载 & 复制
   ============================================================ */
function downloadFile(name, text, mime) {
  try {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } catch (e) {
    alert('浏览器阻止了下载，请改用复制方式。');
  }
}

function copyText(text, btn) {
  const done = () => {
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = old; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { alert('复制失败，请手动选择文本。'); }
    ta.remove();
  }
}

/* 注册视图 */
VIEWS.pipeline = { title: '项目编排', sub: '多模型分阶段，把免费额度拼成一条产线', render: renderPipeline };
