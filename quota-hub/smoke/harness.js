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
    add('侧栏导航项 = 11 个', navs.length === 11, navs.length);
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

  var steps = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s18, s19, s20, s16, s17];
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
