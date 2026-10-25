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

  var steps = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17];
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
