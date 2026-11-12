/* 注入到产物末尾的冒烟脚本：跑完把结果塞进 <pre id="__smoke__">，供 --dump-dom 抓取。
   只依赖 DOM 与用户手势等价的操作，不碰内部变量——测的是真实交互，不是内部函数。 */
(function () {
  var R = { url: location.href, w: window.innerWidth, errors: [], checks: [] };
  window.addEventListener('error', function (e) {
    R.errors.push('onerror: ' + (e.message || e) + ' @' + (e.lineno || '?'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    R.errors.push('rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });
  var _err = console.error;
  console.error = function () {
    R.errors.push('console.error: ' + Array.prototype.join.call(arguments, ' '));
    _err.apply(console, arguments);
  };

  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function txt(el) { return el ? String(el.innerText || el.textContent || '').trim() : ''; }
  function num(v) { var m = String(v).match(/-?\d+/); return m ? parseInt(m[0], 10) : 0; }
  function add(n, pass, note) { R.checks.push({ n: n, p: !!pass, note: note === undefined ? '' : String(note) }); }

  function navTo(v) {
    var b = qa('.nav-item[data-v]').filter(function (x) { return x.getAttribute('data-v') === v; })[0];
    if (!b) return null;
    b.click();
    return document.getElementById('view-' + v);
  }

  /* ---------- 1. 十一个视图全部可达，且只有一个处于激活态 ---------- */
  function s1() {
    var navs = qa('.nav-item[data-v]');
    add('侧栏导航项 = 12 个', navs.length === 12, navs.length);
    var bad = [];
    navs.forEach(function (b) {
      var v = b.getAttribute('data-v');
      var view = navTo(v);
      var nActive = qa('.view.active').length;
      var len = txt(view).length;
      if (!view || !view.classList.contains('active') || nActive !== 1 || len < 80) {
        bad.push(v + '[act=' + (view && view.classList.contains('active')) + ',n=' + nActive + ',len=' + len + ']');
      }
    });
    add('11 个视图均能独占激活且内容非空', bad.length === 0, bad.join(' '));
  }

  /* ---------- 2. 顶栏标题随视图切换 ---------- */
  function s2() {
    navTo('schedule');
    var t = txt(q('#page-title'));
    var sub = txt(q('#page-sub'));
    add('切到重置日程后标题已更新', t.length > 1 && t !== '总览', t + ' / ' + sub);
  }

  /* ---------- 3. Ctrl+K 命令面板 ---------- */
  function s3() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
    var mask = q('#cmdk');
    add('Ctrl+K 打开面板', !!mask && mask.classList.contains('on'), mask ? mask.className : 'missing');
    var qel = q('#cmdk-q');
    if (qel) {
      qel.value = 'deepseek';
      qel.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var n = qa('.cmdk-item').length;
    add('搜 deepseek 有结果', n > 0, n + ' 条');
    add('结果里含 DeepSeek', qa('.cmdk-item').some(function (b) { return /deepseek/i.test(txt(b)); }),
      qa('.cmdk-item').slice(0, 3).map(function (b) { return txt(b).replace(/\s+/g, ' ').slice(0, 24); }).join(' | '));
  }

  /* ---------- 4. 面板回车能跳转 ---------- */
  function s4() {
    var qel = q('#cmdk-q');
    if (qel) {
      qel.value = '重置日程';
      qel.dispatchEvent(new Event('input', { bubbles: true }));
      qel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    var active = q('.view.active');
    add('回车跳转到重置日程', active && active.id === 'view-schedule', active ? active.id : 'none');
    add('跳转后面板已关闭', !q('#cmdk') || !q('#cmdk').classList.contains('on'));
  }

  /* ---------- 5. 我的额度：连续添加 3 个平台 ---------- */
  function s5() {
    navTo('wallet');
    var badge0 = num(txt(q('#nav-count-wallet')));
    var added = 0;
    for (var i = 0; i < 3; i++) {
      var btn = q('#wadd-btn');
      if (!btn) break;
      btn.click();
      added++;
    }
    var badge1 = num(txt(q('#nav-count-wallet')));
    add('添加 3 个平台成功', added === 3, 'added=' + added);
    add('侧栏角标随增删同步', badge1 === badge0 + added, badge0 + ' -> ' + badge1);
    var raw = null, parseOk = false, keys = 0;
    try {
      raw = localStorage.getItem('quotaHub.wallet.v1');
      var o = JSON.parse(raw);
      parseOk = !!o && typeof o === 'object';
      keys = o ? Object.keys(o).length : 0;
    } catch (e) { R.errors.push('read wallet: ' + e.message); }
    add('额度写入 localStorage 且结构合法', parseOk && keys >= 3, 'keys=' + keys);
    add('KPI 卡片已渲染', qa('#wallet-summary .kpi').length >= 4, qa('#wallet-summary .kpi').length);
  }

  /* ---------- 6. 导出备份真的产生下载 ---------- */
  function s6() {
    var dl = null;
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { dl = this.download || this.href.slice(0, 24); };
    var ok = true;
    try { q('#wallet-export').click(); } catch (e) { ok = false; R.errors.push('export: ' + e.message); }
    HTMLAnchorElement.prototype.click = origClick;
    add('导出备份触发下载', ok && !!dl, dl ? String(dl) : 'no download');
  }

  /* ---------- 7. 删除已添加的平台，角标回退 ---------- */
  function s7() {
    var before = num(txt(q('#nav-count-wallet')));
    var del = q('#wallet-list [data-wd]');
    if (del) del.click();
    var after = num(txt(q('#nav-count-wallet')));
    add('删除按钮存在且角标回退', !!del && after === before - 1, before + ' -> ' + after + (del ? '' : ' (无删除控件)'));
  }

  /* ---------- 8. 任务路由：正常值能出方案 ---------- */
  function s8() {
    navTo('router');
    q('#run-route').click();
    var out = txt(q('#route-out'));
    add('路由计算有输出', out.length > 60, out.replace(/\s+/g, ' ').slice(0, 60));
  }

  /* ---------- 9. 路由边界：0 与负数不能算出假方案 ---------- */
  function s9() {
    var bad = [];
    [[0, 3000, 800], [-9, 3000, 800], [200, 0, 0], ['', '', '']].forEach(function (v) {
      [['#r-reqs', v[0]], ['#r-inTok', v[1]], ['#r-outTok', v[2]]].forEach(function (pair) {
        var el = q(pair[0]);
        el.value = pair[1];
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      q('#run-route').click();
      var out = txt(q('#route-out'));
      if (!out || out.length < 20) bad.push(JSON.stringify(v) + ' -> 空输出');
      // 回显值必须被纠正回正整数，否则页面上的数字与计算结果不一致
      var shown = q('#r-reqs').value;
      if (num(shown) < 1) bad.push(JSON.stringify(v) + ' -> 回显仍是 ' + JSON.stringify(shown));
    });
    add('路由输入边界会纠正回正值', bad.length === 0, bad.join(' | '));
  }

  /* ---------- 10. 平台库搜索过滤 ---------- */
  function s10() {
    navTo('registry');
    var total0 = num(txt(q('#result-count')));
    var s = q('#search');
    s.value = '硅基';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    var n1 = num(txt(q('#result-count')));
    add('搜索「硅基」收窄结果', n1 > 0 && n1 < total0, total0 + ' -> ' + n1);
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    var n2 = num(txt(q('#result-count')));
    add('清空搜索后结果恢复', n2 === total0, total0 + ' -> ' + n2);

    /* ---------- 交叉校验筛选维度 ---------- */
    var ccBtns = qa('#filter-bar .fbtn[data-g="cc"]');
    add('新增「交叉校验」筛选组 = 6 档', ccBtns.length === 6, ccBtns.length);
    var pick = function (v) {
      var b = ccBtns.filter(function (x) { return x.getAttribute('data-v') === v; })[0];
      if (b) b.click();
      return num(txt(q('#result-count')));
    };
    var nConflict = pick('conflict');
    add('筛「冲突」= 2 家', nConflict === 2, nConflict);
    var nPending = pick('pending');
    add('筛「待核」= 3 家', nPending === 3, nPending);
    var nAgree = pick('agree');
    add('筛「一致」= 9 家', nAgree === 9, nAgree);
    var nSolo = pick('solo');
    add('筛「单源」= 10 家', nSolo === 10, nSolo);
    var nNone = pick('none');
    add('筛「未覆盖」= 24 家', nNone === 24, nNone);
    add('五档加总 = 48（互斥且无遗漏）',
      nConflict + nPending + nAgree + nSolo + nNone === 48,
      [nConflict, nPending, nAgree, nSolo, nNone].join('+'));
    add('「未覆盖」结果里没有硬套交叉角标',
      qa('#platform-grid .cc-badge').length === 0,
      qa('#platform-grid .cc-badge').length);
    var nAll = pick('all');
    add('复位「全部」恢复 48', nAll === 48, nAll);

    /* ---------- 未覆盖 24 家的说明 ---------- */
    var why = q('#cc-why');
    add('说明块已渲染且默认收起', !!why && !why.open && txt(why).length > 0);
    var whyBtn = q('#cc-cover-why');
    if (whyBtn) whyBtn.click();
    add('「为什么？」能展开说明', !!why && why.open, why ? String(why.open) : 'missing');
    var whyTxt = txt(why);
    var groups = qa('#cc-why .cc-why-group');
    add('说明按形态分成 6 组（补录两家后「聚合中转站」组已清空）', groups.length === 6, groups.length);
    add('说明写清 25 / 24 / 48 三个数字',
      /25/.test(whyTxt) && /24/.test(whyTxt) && /48/.test(whyTxt));
    add('补录的两家不再出现在未覆盖名单里',
      !/魔搭 ModelScope|AMD Radeon Cloud/.test(whyTxt));
    add('说明明说「不是漏数据，是轴的边界」', /轴的边界/.test(whyTxt));
    add('分组里列出真实平台名', /Trae|通义灵码|Dify|可灵/.test(whyTxt),
      whyTxt.replace(/\s+/g, ' ').slice(0, 60));
    /* 展开态必须单独查横向溢出：后面 s16 跑的是收起后的状态，覆盖不到这里 */
    add('说明块展开后无横向溢出（' + window.innerWidth + 'px）',
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth);
    if (why) why.open = false;
  }

  /* ---------- 11. 项目编排 / 总控：换模板要重算 ---------- */
  function s11() {
    var res = [];
    ['pipeline', 'orch'].forEach(function (v) {
      var view = navTo(v);
      var chips = qa('.tpl-chips button, .tpl-chips [data-tpl]', view);
      if (chips.length < 2) { res.push(v + ':模板按钮不足'); return; }
      var sig0 = txt(view).length;
      chips[1].click();
      var sig1 = txt(view).length;
      var kpis = qa('.kpi', view).length;
      res.push(v + ':' + chips.length + '模板/' + kpis + 'KPI/' + sig0 + '->' + sig1);
      if (kpis < 3) res.push(v + ' KPI 缺失');
    });
    add('编排与总控模板可切换且 KPI 齐备', res.every(function (x) { return !/不足|缺失/.test(x); }), res.join(' | '));
  }

  /* ---------- 12. 接入通道：向导两问一出结论 ---------- */
  function s12() {
    var view = navTo('access');
    var goals = qa('#ob-goals button, #ob-goals [data-g]');
    var comf = qa('#ob-comforts button, #ob-comforts [data-c]');
    add('向导两组选项已渲染', goals.length >= 2 && comf.length >= 2, goals.length + '/' + comf.length);
    if (goals.length) goals[0].click();
    if (comf.length) comf[0].click();
    var out = txt(q('#ob-result'));
    add('向导给出结论', out.length > 40, out.replace(/\s+/g, ' ').slice(0, 70));
    var sel = q('#ob-vendor');
    add('平台下拉已填充', sel && sel.options.length >= 15, sel ? sel.options.length : 0);
  }

  /* ---------- 13. 接入通道：粘贴 key 生成命令，且不落盘 ---------- */
  function s13() {
    var sel = q('#ob-vendor'), key = q('#ob-key'), gen = q('#ob-gen');
    if (sel && key && gen) {
      sel.selectedIndex = 0;
      key.value = 'sk-test-abcdef1234567890abcdef1234567890';
      gen.click();
      var out = txt(q('#ob-out'));
      add('生成命令非空', out.length > 40, out.replace(/\s+/g, ' ').slice(0, 60));
      add('命令里出现 key 占位或真实值', /sk-test-abcdef|YOUR_?KEY|API_KEY|\$\{/.test(out), out.slice(0, 40));
      var leaked = false;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (String(localStorage.getItem(k)).indexOf('sk-test-abcdef') >= 0) leaked = true;
        }
      } catch (e) {}
      add('key 未被写入 localStorage', !leaked);
    } else {
      add('接入通道表单控件齐全', false, 'sel/key/gen 有缺失');
    }
  }

  /* ---------- 14. 接入核验：列表与四类错误说明 ---------- */
  function s14() {
    var view = navTo('verify');
    var rows = qa('#verify-list .vcard', view);
    add('核验总表有内容', rows.length >= 10, rows.length + ' 行');
    var filters = qa('#verify-filters button, #verify-filters [data-f]');
    if (filters.length > 1) {
      var n0 = qa('#verify-list .vcard').length;
      filters[1].click();
      var n1 = qa('#verify-list .vcard').length;
      add('核验筛选器生效', n1 > 0 && n1 <= n0, n0 + ' -> ' + n1);
    } else {
      add('核验筛选器存在', false, filters.length);
    }
  }

  /* ---------- 15. 重置日程：三桶都有内容 ---------- */
  function s15() {
    navTo('schedule');
    var a = qa('#sch-renew > *').length, b = qa('#sch-cycle > *').length, c = qa('#sch-once > *').length;
    add('重置日程三桶均有条目', a > 0 && b > 0 && c > 0, a + '/' + b + '/' + c);
    add('日程页有建议卡片', txt(q('#sch-advice')).length > 20, txt(q('#sch-advice')).replace(/\s+/g, ' ').slice(0, 40));
  }

  /* ---------- 16. 横向溢出（当前视口宽度下） ---------- */
  function s16() {
    var over = [];
    qa('.nav-item[data-v]').forEach(function (b) {
      navTo(b.getAttribute('data-v'));
      var de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) {
        over.push(b.getAttribute('data-v') + '=' + (de.scrollWidth - de.clientWidth) + 'px');
      }
    });
    add('无横向溢出（' + window.innerWidth + 'px）', over.length === 0, over.join(' '));
    R.scrollW = document.documentElement.scrollWidth;
    R.clientW = document.documentElement.clientWidth;
  }

  /* ---------- 17. 刷新后额度仍在（持久化） ---------- */
  function s17() {
    R.persist = (function () {
      try {
        var o = JSON.parse(localStorage.getItem('quotaHub.wallet.v1') || 'null');
        return o ? Object.keys(o).length : 0;
      } catch (e) { return -1; }
    })();
    add('刷新后额度条目数 > 0', R.persist > 0, R.persist);
  }

  /* ---------- 18. 接入核验的探活卡片 ---------- */
  function s18() {
    navTo('verify');
    var body = q('#probe-body');
    var items = qa('.probe-item');
    var h = txt(body);
    add('探活卡片已渲染', !!body, body ? 'ok' : 'missing');
    add('探活条目 >= 20 家', items.length >= 20, items.length);
    add('显示执行环境与数据来源', /执行环境/.test(h) && /来源/.test(h), h.replace(/\s+/g, ' ').slice(0, 44));
    add('不是空态（快照已内联）', h.indexOf('还没有探活数据') === -1);
    add('每条都有状态点', qa('.probe-item .probe-dot').length === items.length, qa('.probe-item .probe-dot').length + '/' + items.length);
    /* 告警条只该在「404 / key 无效」出现——这两类才是配置错。
       所以断言的不是「有没有告警条」，而是「告警条和计数一致」。 */
    function lastInt(t) { var m = String(t).match(/\d+/g); return m ? parseInt(m[m.length - 1], 10) : 0; }
    var alertN = qa('#probe-body .probe-alert').length;
    var badN = qa('#probe-body .probe-c').filter(function (x) { return /404|key 无效/.test(txt(x)); })
      .reduce(function (a, x) { return a + lastInt(txt(x)); }, 0);
    add('告警条与 404/key 无效 计数一致', (alertN > 0) === (badN > 0), 'alert=' + alertN + ', bad=' + badN);
  }

  /* ---------- 19. 限流冷却 ---------- */
  function s19() {
    var view = navTo('wallet');
    var sels = qa('[data-wc]', view);
    add('每张额度卡都有冷却下拉', sels.length > 0 && sels.length === qa('.witem', view).length,
      sels.length + ' / ' + qa('.witem', view).length);
    if (!sels.length) return;

    var id = sels[0].getAttribute('data-wc');
    var name = q('#wallet-list .winfo b') ? txt(q('#wallet-list .winfo b')) : id;

    /* 设 1 小时 */
    sels[0].value = '60';
    sels[0].dispatchEvent(new Event('change', { bubbles: true }));
    var on = qa('.wcool.on', view);
    add('选时长后进入冷却态', on.length === 1, on.length);
    add('冷却卡显示剩余时间', /限流 · 剩/.test(txt(on[0] || document.body)),
      (on[0] ? txt(on[0]) : '').replace(/\s+/g, ' ').slice(0, 30));
    add('KPI 汇总出现「限流中」', /限流中/.test(txt(q('#wallet-summary'))), '');
    add('冷却写进 localStorage', (function () {
      try {
        var w = JSON.parse(localStorage.getItem('quotaHub.wallet.v1')) || {};
        return typeof w[id].cool === 'number' && w[id].cool > Date.now() && w[id].coolMin === 60;
      } catch (e) { return false; }
    })(), '');

    /* 排产要跳过它，并且说出来 */
    navTo('router');
    q('#run-route').click();
    var note = q('#route-out .cool-note');
    add('路由页给出跳过说明', !!note, note ? txt(note).replace(/\s+/g, ' ').slice(0, 40) : 'missing');
    add('跳过说明里点到具体平台', !!(note && txt(note).indexOf(name) >= 0), name);
    add('被限流的平台不在主方案里', (function () {
      var rows = qa('#route-out .route-plan .route-name');
      for (var i = 0; i < rows.length; i++) if (txt(rows[i]).indexOf(name) === 0) return false;
      return true;
    })(), name);

    /* 恢复 */
    view = navTo('wallet');
    var self = null;
    qa('[data-wc]', view).forEach(function (x) { if (x.getAttribute('data-wc') === id) self = x; });
    add('恢复前下拉仍指向 60', !!self && self.value === '60', self ? self.value : 'missing');
    if (self) { self.value = '0'; self.dispatchEvent(new Event('change', { bubbles: true })); }
    add('选不限流后冷却态清空', qa('.wcool.on', view).length === 0, qa('.wcool.on', view).length);
    add('恢复后汇总不再提限流', !/限流中/.test(txt(q('#wallet-summary'))), '');
    add('恢复后 localStorage 里没有残留字段', (function () {
      try {
        var w = JSON.parse(localStorage.getItem('quotaHub.wallet.v1')) || {};
        return w[id].cool === undefined && w[id].coolMin === undefined;
      } catch (e) { return false; }
    })(), '');
  }

  /* ---------- 20. 接入通道：网关清单与三种导出 ---------- */
  function s20() {
    var view = navTo('access');
    var cards = qa('.gw-card', view);
    add('网关卡片 >= 5 家', cards.length >= 5, cards.length);
    add('列了 OmniRoute 与 FreeLLMAPI',
      /OmniRoute/.test(txt(view)) && /FreeLLMAPI/.test(txt(view)), '');

    var exp = q('#acc-export');
    add('导出区有三个入口', exp && qa('button', exp).length === 3,
      exp ? qa('button', exp).length : 'missing');

    /* 不臆造别家配置这件事必须写在页面上，否则下一个人会以为漏做了 */
    var adapt = q('.gw-adapt', exp);
    add('说明为什么不导别家原生配置', !!adapt && /\.env/.test(txt(adapt)),
      adapt ? txt(adapt).replace(/\s+/g, ' ').slice(0, 34) : 'missing');

    var dl = null, err = null;
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { dl = this.download || ''; };
    var envBtn = q('#gw-env', exp);
    try { if (envBtn) envBtn.click(); } catch (e) { err = e.message; }
    HTMLAnchorElement.prototype.click = origClick;
    add('导出通用 .env 触发下载', !!envBtn && dl === 'gateway.env', dl || err || 'no download');
  }

  /* ---------- 21. 交叉校验：表 / 冲突高亮 / 过滤 ---------- */
  function s21() {
    var view = navTo('crosscheck');
    var rows = qa('#view-crosscheck .cc-table tbody tr', view);
    add('交叉校验表渲染 25 行', rows.length === 25, rows.length);
    /* 回归：cell() 曾返回裸 <div>，被浏览器踢出表格，每行只剩 3 个 td。
       只看行数查不出来，必须逐行核列数。 */
    var badCols = rows.filter(function (r) { return qa('td', r).length !== 6; }).length;
    add('每行恰好 6 个 <td>（证据列没被踢出表格）', badCols === 0, badCols + ' 行异常');
    add('表格外没有游离的 .cc-cell', qa('#view-crosscheck .cc-wrap > .cc-cell', view).length === 0,
      qa('#view-crosscheck .cc-wrap > .cc-cell', view).length);
    var conflict = qa('#view-crosscheck .cc-row-conflict', view);
    add('冲突行高亮 = 2（DeepSeek / Kimi）', conflict.length === 2, conflict.length);
    var kpis = qa('#view-crosscheck .kpi', view);
    add('KPI 卡片齐全（5 个）', kpis.length === 5, kpis.length);
    var fbtn = qa('#view-crosscheck .cc-f', view).filter(function (x) {
      return x.getAttribute('data-ccf') === 'conflict';
    })[0];
    var fresh = q('#view-crosscheck .cc-fresh', view);
    add('数据新鲜度条已渲染', !!fresh);
    add('新鲜度条列出本项目 + 三源 + 探活', (function () {
      if (!fresh) return false;
      var t = txt(fresh);
      return /本项目额度口径/.test(t) && /FreeToken/.test(t) && /free-llm-intel/.test(t) &&
        /free-models/.test(t) && /端点探活/.test(t);
    })(), fresh ? txt(fresh).replace(/\s+/g, ' ').slice(0, 60) : 'missing');
    add('新鲜度条明说「探活不更新额度口径」', /不更新/.test(txt(fresh)));
    /* 状态语义回归：只有 ok 才敢不写说明；其余一律注明日期从哪来。
       用 data-ccstatus 判定，别写死「三源全 ok」，CI 数据变了也不误报。 */
    var fItems = qa('#view-crosscheck .cc-fresh-item', view);
    var badNote = fItems.filter(function (it) {
      var has = qa('em', it).length > 0;
      return it.getAttribute('data-ccstatus') === 'ok' ? has : !has;
    });
    add('新鲜度：ok 不提示 / 非 ok 全都有出处说明', fItems.length === 5 && badNote.length === 0,
      fItems.length + ' 卡, ' + badNote.length + ' 异常');
    var neutral = q('#view-crosscheck [data-ccstatus="baseline"] em', view);
    add('本项目中性说明用 ink-3 而非警示色', !!neutral &&
      neutral.className.indexOf('cc-note-neutral') >= 0, neutral ? neutral.className : 'missing');
    if (fbtn) fbtn.click();
    var after = qa('#view-crosscheck .cc-table tbody tr', view);
    add('「冲突」过滤只留 2 行', after.length === 2, after.length);
    /* 复位，别把过滤态带给后面的横向溢出检查 */
    var allBtn = qa('#view-crosscheck .cc-f', view).filter(function (x) {
      return x.getAttribute('data-ccf') === 'all';
    })[0];
    if (allBtn) allBtn.click();

    /* ---------- 判定 × 可信度 联合分布 ---------- */
    var joint = q('#view-crosscheck .cc-joint', view);
    add('联合分布矩阵已渲染', !!joint && !!q('.cj-table', joint));
    add('矩阵数据行 = 5（冲突/待核/一致/单源/未覆盖）',
      qa('#view-crosscheck .cj-table tbody tr', view).length === 5,
      qa('#view-crosscheck .cj-table tbody tr', view).length);
    add('矩阵可点格子 = 11（5×3 里的非零格）',
      qa('#view-crosscheck .cj-btn', view).length === 11,
      qa('#view-crosscheck .cj-btn', view).length);
    add('矩阵标题写清 48 条并说明「点格子同时套用两个筛选」', (function () {
      if (!joint) return false;
      var t = txt(joint);
      return /共\s*48\s*条/.test(t) && /点格子同时套用两个筛选/.test(t);
    })(), joint ? txt(joint).replace(/\s+/g, ' ').slice(0, 50) : 'missing');
    /* 矩阵不随 conf/cc 筛选收缩，否则点一次就只剩一格 */
    add('默认态没有任何格子/行被高亮',
      qa('#view-crosscheck .cj-btn.on', view).length === 0 &&
      qa('#view-crosscheck .cj-row-on', view).length === 0);

    var jcell = q('#view-crosscheck [data-jcc="none|verified"]');
    add('「未覆盖 × 核实」格子存在', !!jcell);
    add('没点格子时平台库不显示组合面包屑',
      !!q('#joint-focus') && q('#joint-focus').hidden === true,
      q('#joint-focus') ? String(q('#joint-focus').hidden) : 'missing');
    if (jcell) {
      /* 先在平台库把「区域」收窄：点格子必须把这类条件清掉，否则会出现
         「格子写 10 条、结果只剩 3 条」的对不上账。面包屑要如实说明。 */
      navTo('registry');
      var rgBtn = q('#filter-bar .fbtn[data-g="region"][data-v="cn"]');
      if (rgBtn) rgBtn.click();
      var rcNarrow = q('#result-count');
      add('先在平台库按区域收窄（准备验证条件重置）',
        !!rcNarrow && rcNarrow.textContent.indexOf('48 /') !== 0,
        rcNarrow ? rcNarrow.textContent : 'missing');
      navTo('crosscheck');

      jcell.click();
      var rcAfter = q('#result-count');
      add('点格子落到平台库 10 条（两个筛选同时生效，旧条件被清掉）',
        !!rcAfter && rcAfter.textContent.indexOf('10 /') === 0,
        rcAfter ? rcAfter.textContent : 'missing');
      var onCc = q('#filter-bar .fbtn.on[data-g="cc"]');
      var onConf = q('.cd-key.on[data-conf]');
      add('交叉校验筛选被设成「未覆盖」',
        !!onCc && onCc.getAttribute('data-v') === 'none',
        onCc ? onCc.getAttribute('data-v') : 'missing');
      add('可信度筛选被设成「多源核实」',
        !!onConf && onConf.getAttribute('data-conf') === 'verified',
        onConf ? onConf.getAttribute('data-conf') : 'missing');

      /* ---------- 组合高亮：面包屑 + 命中卡片描边 ---------- */
      var jfBar = q('#joint-focus');
      add('落地页出现组合面包屑',
        !!jfBar && jfBar.hidden === false && jfBar.getAttribute('data-jf') === 'none|verified',
        jfBar ? jfBar.getAttribute('data-jf') + ' hidden=' + jfBar.hidden : 'missing');
      add('面包屑写明「未覆盖 × 多源核实 · 共 10 条」', (function () {
        if (!jfBar) return false;
        var t = txt(jfBar);
        return /未覆盖/.test(t) && /多源核实/.test(t) && /共\s*10\s*条/.test(t);
      })(), jfBar ? txt(jfBar).replace(/\s+/g, ' ').slice(0, 60) : 'missing');
      var hits = qa('#platform-grid .pcard.jf-hit');
      add('命中 10 张卡片全部高亮', hits.length === 10, hits.length);
      add('高亮卡片数 = 结果卡片数（格子条数对得上账）',
        hits.length === qa('#platform-grid .pcard').length,
        hits.length + ' / ' + qa('#platform-grid .pcard').length);
      add('高亮卡片带 data-jf-hit 标记（供筛选与断言定位）',
        qa('#platform-grid .pcard[data-jf-hit="1"]').length === 10,
        qa('#platform-grid .pcard[data-jf-hit="1"]').length);
      add('面包屑如实说明被重置的其它条件',
        !!jfBar && /已重置区域/.test(txt(jfBar)),
        jfBar ? txt(jfBar).replace(/\s+/g, ' ').slice(0, 80) : 'missing');

      /* 回矩阵：走面包屑上的按钮，确认组合态能来回 */
      var back = q('#jf-back');
      add('面包屑提供「回矩阵」', !!back);
      if (back) back.click();
      var actBack = q('.view.active');
      add('「回矩阵」回到交叉校验', !!actBack && actBack.id === 'view-crosscheck',
        actBack ? actBack.id : 'none');
      add('矩阵统计不随自身筛选收缩（仍 48 条）',
        /共\s*48\s*条/.test(txt(q('#view-crosscheck .cc-joint'))),
        txt(q('#view-crosscheck .cc-joint')).replace(/\s+/g, ' ').slice(0, 40));
      add('矩阵选中态只高亮一格', qa('#view-crosscheck .cj-btn.on').length === 1,
        qa('#view-crosscheck .cj-btn.on').length);
      add('对应行也高亮', qa('#view-crosscheck .cj-row-on').length === 1,
        qa('#view-crosscheck .cj-row-on').length);

      /* 再点一次同一格，然后用「退出组合筛选」整体复位（这套组合会污染 s23 的计数） */
      var jcell2 = q('#view-crosscheck [data-jcc="none|verified"]');
      if (jcell2) jcell2.click();
      var rcAgain = q('#result-count');
      add('再次点同一格仍落到 10 条', !!rcAgain && rcAgain.textContent.indexOf('10 /') === 0,
        rcAgain ? rcAgain.textContent : 'missing');
      var jfClear = q('#jf-clear');
      add('面包屑提供「退出组合筛选」', !!jfClear);
      if (jfClear) jfClear.click();
      var rcReset = q('#result-count');
      add('退出组合筛选后回到 48 条', !!rcReset && rcReset.textContent.indexOf('48 /') === 0,
        rcReset ? rcReset.textContent : 'missing');
      add('退出后面包屑收起', q('#joint-focus').hidden === true);
      add('退出后卡片不再带高亮', qa('#platform-grid .pcard.jf-hit').length === 0,
        qa('#platform-grid .pcard.jf-hit').length);
      var ccNow = q('#filter-bar .fbtn.on[data-g="cc"]');
      add('退出后交叉校验筛选回到「全部」',
        !!ccNow && ccNow.getAttribute('data-v') === 'all',
        ccNow ? ccNow.getAttribute('data-v') : 'missing');
    }
  }

  /* ---------- 22. 交叉校验 ↔ 接入核验 双向联动 ---------- */
  function s22() {
    /* 先把核验页筛选复位，保证 DeepSeek 卡片在列表里 */
    navTo('verify');
    var vt = q('#verify-filters [data-vt="all"]'), vf = q('#verify-filters [data-vf="all"]');
    if (vt) vt.click();
    if (vf) vf.click();

    navTo('crosscheck');
    var link = q('#view-crosscheck [data-ccv="deepseek"]');
    add('交叉校验行有「到核验」入口', !!link);
    if (link) link.click();
    var active = q('.view.active');
    add('点厂商名跳到接入核验', !!active && active.id === 'view-verify', active ? active.id : 'none');
    var card = q('#verify-list .vcard[data-vid="deepseek"]');
    add('核验卡片按 id 可定位', !!card);
    add('跳过来后卡片被高亮', !!card && card.classList.contains('cc-focus'));
    add('冲突厂商卡片显示外部证据块', !!card && !!q('.vcc', card));
    add('外部证据块列出两个外部来源', (function () {
      if (!card) return false;
      var t = txt(q('.vcc', card));
      return /FreeToken/.test(t) && /free-llm-intel/.test(t);
    })(), card ? txt(q('.vcc', card)).replace(/\s+/g, ' ').slice(0, 60) : 'missing');
    add('卡片带「交叉校验 · 冲突」角标', !!card && /交叉校验 · 冲突/.test(txt(card)));

    var back = card ? q('[data-ccgo]', card) : null;
    add('核验卡片有跳回三方比对的按钮', !!back);
    if (back) back.click();
    var backView = q('.view.active');
    add('跳回交叉校验视图', !!backView && backView.id === 'view-crosscheck', backView ? backView.id : 'none');
    var row = q('#view-crosscheck tr[data-ccid="deepseek"]');
    add('跳回后对应行高亮', !!row && row.classList.contains('cc-focus'));
    var allBtn2 = q('#verify-cc-all');
    add('核验 KPI 有「三方比对」出口', !!allBtn2);
  }

  /* ---------- 23. 平台库轻量交叉标记 ---------- */
  function s23() {
    var view = navTo('registry');
    var badges = qa('#platform-grid .cc-badge', view);
    add('平台库出现交叉校验角标', badges.length > 0, badges.length);
    add('角标 = 24 个（25 家减 Meta Llama）', badges.length === 24, badges.length);
    var cover = q('#cc-cover');
    add('覆盖统计条写明 24 / 48', !!cover && /24/.test(txt(cover)) && /48/.test(txt(cover)),
      cover ? txt(cover).replace(/\s+/g, ' ').slice(0, 50) : 'missing');
    add('覆盖统计标出 2 处冲突', !!cover && /2 处冲突/.test(txt(cover)));
    var cBadges = qa('#platform-grid .cc-badge-conflict', view);
    add('冲突角标 = 2 个', cBadges.length === 2, cBadges.length);
    if (cBadges.length) {
      cBadges[0].click();
      var v = q('.view.active');
      add('点角标跳到交叉校验', !!v && v.id === 'view-crosscheck', v ? v.id : 'none');
      add('点角标不会打开详情抽屉', !q('#drawer') || !q('#drawer').classList.contains('on'));
    }
    /* s16 会遍历所有视图，留个干净的过滤态 */
    var allBtn = q('#view-crosscheck .cc-f[data-ccf="all"]');
    if (allBtn && allBtn.classList.contains('on') === false) allBtn.click();
  }

  /* ---------- 24. 数据可信度分布条：堆叠条 / 筛选 / facet / 联动 ---------- */
  function s24() {
    var view = navTo('registry');
    /* 前面若干步骤动过筛选，先把四组筛选复位，别让遗留状态污染计数 */
    ['region', 'cat', 'qtype', 'cc'].forEach(function (g) {
      var b = q('#filter-bar .fbtn[data-g="' + g + '"][data-v="all"]', view);
      if (b) b.click();
    });
    var box = q('#conf-dist', view);
    add('可信度分布条已渲染', !!box && txt(box).length > 40, txt(box).slice(0, 40));
    if (!box) return;
    var segs = qa('#conf-dist .cd-seg', view);
    var keys = qa('#conf-dist .cd-key', view);
    add('堆叠条 3 段 / 图例 4 键（含清除）', segs.length === 3 && keys.length === 4,
      segs.length + '/' + keys.length);
    var counts = segs.map(function (b) { return num(txt(b)); });
    add('三段数字 15 / 21 / 12，加总 48',
      counts.join(',') === '15,21,12' && counts.reduce(function (a, b) { return a + b; }, 0) === 48,
      counts.join(','));
    add('默认不高亮任何档位，只高亮「清除筛选」',
      qa('#conf-dist .cd-seg.on', view).length === 0 && !!q('#conf-dist .cd-clear.on', view));

    var reported = q('#conf-dist .cd-key[data-conf="reported"]', view);
    if (reported) reported.click();
    add('点「单源报道」筛出 21 家', num(txt(q('#result-count'))) === 21, txt(q('#result-count')));
    var cards = qa('#platform-grid .pcard', view);
    add('筛出的卡片 data-conf 全为 reported',
      cards.length === 21 && cards.every(function (c) { return c.getAttribute('data-conf') === 'reported'; }),
      cards.length);
    var segs2 = qa('#conf-dist .cd-seg', view);
    add('facet：点选后分布仍按 48 条全貌统计',
      /条件的\s*48\s*条/.test(txt(q('#conf-dist .cd-head', view))) &&
      segs2.map(function (b) { return num(txt(b)); }).join(',') === '15,21,12',
      txt(q('#conf-dist .cd-head', view)));
    add('选中档在段与图例上各高亮一次',
      qa('#conf-dist .cd-seg.on', view).length === 1 &&
      !!q('#conf-dist .cd-key.on[data-conf="reported"]', view));
    var ui = null;
    try { ui = JSON.parse(localStorage.getItem('quotaHub.ui.v1')); } catch (e) {}
    add('可信度筛选随 UI 偏好持久化', !!ui && ui.filters && ui.filters.conf === 'reported',
      ui && ui.filters ? ui.filters.conf : 'none');

    /* 与其它筛选联动：交叉校验「冲突」两家应全部落在「口径冲突」档 */
    var ccBtn = q('#filter-bar .fbtn[data-g="cc"][data-v="conflict"]', view);
    if (ccBtn) ccBtn.click();
    add('与交叉校验联动：冲突 2 家时分布收敛为 2 条',
      /条件的\s*2\s*条/.test(txt(q('#conf-dist .cd-head', view))),
      txt(q('#conf-dist .cd-head', view)));
    var clr = q('#conf-dist .cd-clear', view);
    if (clr) clr.click();
    add('两家冲突平台全为「口径冲突」档',
      num(txt(q('#conf-dist .cd-seg[data-conf="disputed"]', view))) === 2,
      txt(q('#conf-dist .cd-seg[data-conf="disputed"]', view)));
    var ccAll = q('#filter-bar .fbtn[data-g="cc"][data-v="all"]', view);
    if (ccAll) ccAll.click();
    add('复位后回到 48 个结果', num(txt(q('#result-count'))) === 48, txt(q('#result-count')));
  }

  var steps = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s18, s19, s20, s21, s22, s23, s24, s16, s17];
  var i = 0;
  function next() {
    if (i >= steps.length) return finish();
    try { steps[i](); } catch (e) { R.errors.push('step' + (i + 1) + ': ' + e.message); }
    i++;
    setTimeout(next, 30);
  }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = '__smoke__';
    pre.style.display = 'none';
    pre.textContent = JSON.stringify(R);
    document.body.appendChild(pre);
  }
  window.addEventListener('load', function () { setTimeout(next, 500); });
})();
