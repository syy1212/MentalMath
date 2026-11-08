/* 口算天天练 · 管理端：题库管理（导入/URL 源/设备/同步/删除）、练习记录、设置。
   管理界面只在网页 /admin/ 提供（对齐 StudyOnTV：设备端只答题），局域网浏览器访问。
   ES5 语法。 */
(function () {
  'use strict';

  var $ = MM.$;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function btn(label, action, data, cls) {
    var b = el('button', cls || 'btn', label);
    b.setAttribute('data-action', action);
    if (data) for (var k in data) b.setAttribute('data-' + k, data[k]);
    return b;
  }

  function listen(container, action, handler) {
    // 容器会重复渲染，同一操作始终只保留一个委托处理器。
    if (!container.mmHandlers) container.mmHandlers = {};
    if (container.mmHandlers[action]) container.removeEventListener('click', container.mmHandlers[action]);
    var delegate = function (ev) {
      var node = ev.target;
      while (node && node !== container) {
        if (node.getAttribute && node.getAttribute('data-action') === action) {
          handler(node);
          return;
        }
        node = node.parentNode;
      }
    };
    container.mmHandlers[action] = delegate;
    container.addEventListener('click', delegate);
  }

  function backLink() {
    var b = el('button', 'back-link', '‹ 返回练习');
    b.setAttribute('data-action', 'mm-back');
    return b;
  }

  /* ================= 题库管理（Agent API 添加 + 标签管理） ================= */

  var GRADES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
  var TYPE_NAMES = { single: '单选', multiple: '多选', boolean: '判断' };
  var qFilter = { bankId: '', level: '', difficulty: '' };
  var qOffset = 0;
  var qTotal = 0;
  var qEditing = null; // 当前展开编辑的题目 id
  var facets = { levels: [], subjects: [] };
  var questionItems = [];
  var questionRequest = 0;
  var questionsLoading = false;
  var activeAdminTab = 'banks';
  var savingConfig = false;

  function banksEnter() {
    var wrap = $('banksWrap');
    wrap.innerHTML = '';
    if (!MM.ADMIN_MODE) wrap.appendChild(backLink());
    wrap.appendChild(el('h1', 'page-title', '题库管理'));
    wrap.appendChild(el('p', 'lead', '管理练习题目，为题目设置年级和难度。练习使用的题库可在设置中选择。'));

    wrap.appendChild(el('div', 'section-title', '我的题库'));
    var list = el('div', 'card');
    list.id = 'mmBankList';
    wrap.appendChild(list);

    wrap.appendChild(el('div', 'section-title', '题目管理 · 打标签'));
    var mgr = el('div', 'card');
    mgr.id = 'mmQuestionMgr';
    mgr.appendChild(el('div', 'empty', '正在加载筛选项…'));
    wrap.appendChild(mgr);

    listen(wrap, 'mm-back', function () { MM.go('#/practice'); });
    listen(wrap, 'mm-del', function (node) {
      var id = node.getAttribute('data-id');
      if (!window.confirm('删除这个题库会同时删除其中的题目，确定？')) return;
      MM.request('POST', '/api/banks/delete', { id: id }, function (err) {
        if (err) { MM.toast('删除失败：' + err); return; }
        MM.toast('已删除题库');
        reloadBanks();
      });
    });
    listen(wrap, 'mm-sync', function (node) {
      node.disabled = true;
      MM.request('POST', '/api/banks/sync', { id: node.getAttribute('data-id') }, function (err) {
        node.disabled = false;
        if (err) { MM.toast('同步失败：' + err); return; }
        MM.toast('同步完成');
        reloadBanks();
      });
    });
    renderBankList();
    MM.request('GET', '/api/questions/facets', null, function (err, data) {
      if (mgr !== $('mmQuestionMgr')) return;
      if (err) {
        mgr.innerHTML = '';
        mgr.appendChild(el('div', 'empty', '筛选项加载失败：' + err));
        return;
      }
      facets = data;
      renderQuestionMgr();
    });
  }

  /* ---------- 题目管理与打标签 ---------- */

  function starText(d) {
    var n = Math.max(0, Math.min(5, d || 0));
    var out = '';
    for (var i = 1; i <= 5; i++) out += i <= n ? '★' : '☆';
    return out;
  }

  function optionList(sel, placeholder, values, current) {
    sel.innerHTML = '';
    sel.appendChild(new Option(placeholder, ''));
    for (var i = 0; i < values.length; i++) {
      var o = new Option(values[i][1], values[i][0]);
      if (current && current === values[i][0]) o.selected = true;
      sel.appendChild(o);
    }
  }

  function renderQuestionMgr() {
    var mgr = $('mmQuestionMgr');
    if (!mgr) return;
    mgr.innerHTML = '';

    // 筛选行
    var filters = el('div', 'q-filters');
    var bankSel = el('select', 'select');
    var bankVals = [];
    var banks = MM.state.banks || [];
    for (var b = 0; b < banks.length; b++) bankVals.push([banks[b].id, banks[b].name]);
    optionList(bankSel, '全部题库', bankVals, qFilter.bankId);
    bankSel.value = qFilter.bankId;
    bankSel.setAttribute('aria-label', '筛选题库');
    var levelSel = el('select', 'select');
    var levelVals = [['__none__', '未设年级']].concat((facets.levels || []).map(function (l) { return [l, l]; }));
    optionList(levelSel, '全部年级', levelVals, qFilter.level);
    levelSel.value = qFilter.level;
    levelSel.setAttribute('aria-label', '筛选年级');
    var diffSel = el('select', 'select');
    var diffVals = [[1, '★ 1 星'], [2, '★★ 2 星'], [3, '★★★ 3 星'], [4, '★★★★ 4 星'], [5, '★★★★★ 5 星']];
    optionList(diffSel, '全部难度', diffVals, qFilter.difficulty);
    diffSel.value = qFilter.difficulty;
    diffSel.setAttribute('aria-label', '筛选难度');
    filters.appendChild(bankSel);
    filters.appendChild(levelSel);
    filters.appendChild(diffSel);
    mgr.appendChild(filters);
    bankSel.addEventListener('change', function () { qFilter.bankId = bankSel.value; qOffset = 0; qEditing = null; loadQuestions(); });
    levelSel.addEventListener('change', function () { qFilter.level = levelSel.value; qOffset = 0; qEditing = null; loadQuestions(); });
    diffSel.addEventListener('change', function () { qFilter.difficulty = diffSel.value; qOffset = 0; qEditing = null; loadQuestions(); });

    // 批量打标
    var batch = el('div', 'q-batch');
    var batchLevel = el('select', 'select');
    var batchLevelVals = GRADES.concat(facets.levels.filter(function (l) { return GRADES.indexOf(l) < 0; }))
      .map(function (g) { return [g, g]; });
    batchLevelVals.unshift(['__clear__', '清除年级']);
    optionList(batchLevel, '年级（不修改）', batchLevelVals, '');
    var batchDiff = el('select', 'select');
    optionList(batchDiff, '难度（不修改）', diffVals, '');
    batchLevel.setAttribute('aria-label', '批量设置年级');
    batchDiff.setAttribute('aria-label', '批量设置难度');
    batch.appendChild(batchLevel);
    batch.appendChild(batchDiff);
    batch.appendChild(btn('应用到筛选结果', 'mm-batch-tag', null, 'btn btn-sm btn-primary'));
    batch.appendChild(el('div', 'muted', '按上面的筛选条件批量设置（含未加载出来的题目）'));
    mgr.appendChild(batch);

    var list = el('div', '');
    list.id = 'mmQList';
    mgr.appendChild(list);
    listen(mgr, 'mm-batch-tag', function () {
      if (!batchLevel.value && !batchDiff.value) { MM.toast('先选择要设置的年级或难度'); return; }
      if (!window.confirm('把筛选结果（' + qTotal + ' 道）的年级/难度按所选修改？')) return;
      var patch = {};
      if (batchLevel.value !== '') patch.setLevel = batchLevel.value === '__clear__' ? '' : batchLevel.value;
      if (batchDiff.value !== '') patch.setDifficulty = parseInt(batchDiff.value, 10);
      patch.bankId = qFilter.bankId || undefined;
      if (qFilter.level === '__none__') patch.untagged = true;
      else patch.level = qFilter.level || undefined;
      patch.difficulty = qFilter.difficulty ? parseInt(qFilter.difficulty, 10) : undefined;
      MM.request('POST', '/api/questions/tag', patch, function (err, res) {
        if (err) { MM.toast('打标失败：' + err); return; }
        MM.toast('已更新 ' + res.updated + ' 道题');
        batchLevel.value = ''; batchDiff.value = '';
        loadQuestions();
      });
    });
    listen(mgr, 'mm-edit', function (node) {
      qEditing = node.getAttribute('data-id');
      renderQuestionList();
    });
    listen(mgr, 'mm-save-tag', function (node) {
      var id = node.getAttribute('data-id');
      var panel = document.getElementById('qedit-' + id);
      if (!panel) return;
      var level = panel.querySelector('.qedit-level').value;
      var diff = panel.querySelector('.qedit-diff').value;
      var patch = { ids: [id] };
      patch.setLevel = level; // 空串=清除年级
      if (diff !== '') patch.setDifficulty = parseInt(diff, 10);
      MM.request('POST', '/api/questions/tag', patch, function (err) {
        if (err) { MM.toast('保存失败：' + err); return; }
        MM.toast('已保存');
        qEditing = null;
        loadQuestions();
      });
    });
    listen(mgr, 'mm-cancel-edit', function () { qEditing = null; renderQuestionList(); });
    listen(mgr, 'mm-more', function () {
      if (questionsLoading) return;
      qOffset = questionItems.length;
      loadQuestions(true);
    });

    qOffset = 0;
    qEditing = null;
    loadQuestions();
  }

  function loadQuestions(append) {
    var list = $('mmQList');
    if (!list) return;
    if (!append) qOffset = 0;
    var query = '?limit=50&offset=' + qOffset +
      (qFilter.bankId ? '&bankId=' + encodeURIComponent(qFilter.bankId) : '') +
      (qFilter.level === '__none__' ? '&untagged=1' :
        (qFilter.level ? '&level=' + encodeURIComponent(qFilter.level) : '')) +
      (qFilter.difficulty ? '&difficulty=' + qFilter.difficulty : '');
    var requestId = ++questionRequest;
    questionsLoading = true;
    if (!append) list.innerHTML = '<div class="empty" role="status">正在加载题目…</div>';
    MM.request('GET', '/api/questions' + query, null, function (err, data) {
      if (requestId !== questionRequest || list !== $('mmQList')) return;
      questionsLoading = false;
      if (err) {
        list.innerHTML = '';
        list.appendChild(el('div', 'empty', '加载失败：' + err));
        return;
      }
      qTotal = data.total || 0;
      questionItems = append ? questionItems.concat(data.items || []) : (data.items || []);
      renderQuestionList();
    });
  }

  function renderQuestionList() {
    var list = $('mmQList');
    if (!list) return;
    list.innerHTML = '';
    if (!questionItems.length) list.appendChild(el('div', 'empty', '当前筛选下没有题目'));
    for (var i = 0; i < questionItems.length; i++) list.appendChild(questionRow(questionItems[i]));
    if (questionItems.length < qTotal) {
      var more = el('div', 'btn-row');
      more.appendChild(btn('加载更多（已显示 ' + questionItems.length + '/' + qTotal + '）', 'mm-more', null, 'btn btn-sm'));
      list.appendChild(more);
    }
  }

  function questionRow(q) {
    var row = el('div', 'q-row');
    var stem = el('div', 'q-stem', q.q || '');
    row.appendChild(stem);
    var tags = el('div', 'q-tags');
    tags.appendChild(el('span', 'q-tag q-tag-grade', q.level ? q.level : '未设年级'));
    tags.appendChild(el('span', 'q-tag q-tag-star' + (q.difficulty >= 4 ? ' hot' : ''), starText(q.difficulty) + ' ' + (q.difficulty || 0) + ' 星'));
    tags.appendChild(el('span', 'q-tag', TYPE_NAMES[q.type] || q.type));
    tags.appendChild(el('span', 'q-tag q-tag-bank', (MM.state.banks.filter(function (b) { return b.id === q.bankId; })[0] || {}).name || q.bankId));
    row.appendChild(tags);
    if (qEditing === q.id) {
      var panel = el('div', 'q-edit');
      panel.id = 'qedit-' + q.id;
      var levelSel = el('select', 'select qedit-level');
      var lvVals = GRADES.concat(facets.levels.filter(function (l) { return GRADES.indexOf(l) < 0; }))
        .map(function (g) { return [g, g]; });
      lvVals.unshift(['', '未设年级']);
      optionList(levelSel, '未设年级', lvVals, q.level || '');
      levelSel.value = q.level || '';
      levelSel.setAttribute('aria-label', '题目年级');
      var diffSel = el('select', 'select qedit-diff');
      var dv = [[1, '★ 1 星'], [2, '★★ 2 星'], [3, '★★★ 3 星'], [4, '★★★★ 4 星'], [5, '★★★★★ 5 星']];
      optionList(diffSel, '保持不变', dv, '');
      diffSel.setAttribute('aria-label', '题目难度');
      var line = el('div', 'q-filters');
      line.appendChild(levelSel);
      line.appendChild(diffSel);
      panel.appendChild(line);
      var acts = el('div', 'btn-row');
      acts.appendChild(btn('保存', 'mm-save-tag', { id: q.id }, 'btn btn-sm btn-primary'));
      acts.appendChild(btn('取消', 'mm-cancel-edit', null, 'btn btn-sm'));
      panel.appendChild(acts);
      row.appendChild(panel);
    } else {
      var edit = btn('编辑', 'mm-edit', { id: q.id }, 'btn btn-sm');
      row.appendChild(edit);
    }
    return row;
  }

  function field(label, input) {
    var f = el('div', 'field');
    var labelNode = el('label', '', label);
    labelNode.htmlFor = input.id;
    f.appendChild(labelNode);
    f.appendChild(input);
    return f;
  }

  function renderBankList() {
    var list = $('mmBankList');
    if (!list) return;
    list.innerHTML = '';
    var banks = MM.state.banks || [];
    if (!banks.length) {
      list.appendChild(el('div', 'empty', '还没有题库'));
      return;
    }
    for (var i = 0; i < banks.length; i++) {
      var bank = banks[i];
      var card = el('div', 'card');
      var head = el('div', 'bank-head');
      var kind = el('span', 'bank-kind k-' + bank.kind, MM.KIND_NAMES[bank.kind] || bank.kind);
      head.appendChild(kind);
      head.appendChild(el('div', 'bank-name', bank.name));
      card.appendChild(head);
      var meta = el('div', 'bank-meta');
      meta.textContent = bank.itemCount + ' 题 · 最近同步 ' + MM.fmtTime(bank.lastSync) +
        (bank.enabled === false ? ' · 已停用' : '');
      card.appendChild(meta);
      if (bank.lastError) card.appendChild(el('div', 'bank-error', bank.lastError));
      var actions = el('div', 'bank-actions');
      if (bank.kind === 'url' || bank.kind === 'device') {
        actions.appendChild(btn('立即同步', 'mm-sync', { id: bank.id }, 'btn btn-sm'));
      }
      if (bank.kind !== 'built-in') {
        actions.appendChild(btn('删除', 'mm-del', { id: bank.id }, 'btn btn-sm btn-danger'));
      }
      if (actions.children.length) card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function reloadBanks() {
    MM.loadState(function (err) {
      if (err) { MM.toast('刷新失败：' + err); return; }
      MM.renderToday();
      renderBankList();
      // 题库列表变化后（Agent 建新库等）同步刷新筛选项与题目列表
      if ($('mmQuestionMgr')) renderQuestionMgr();
    });
  }

  /* ================= 练习记录 ================= */

  var statsDays = 7;

  function statsEnter() {
    var wrap = $('statsWrap');
    wrap.innerHTML = '';
    if (!MM.ADMIN_MODE) wrap.appendChild(backLink());
    wrap.appendChild(el('h1', 'page-title', '练习记录'));
    wrap.appendChild(el('p', 'lead', '每轮练习的题数、正确率与用时都会记在这里，只保存在设备上。'));

    var seg = el('div', 'seg');
    seg.appendChild(segBtn('近 7 天', 7));
    seg.appendChild(segBtn('近 30 天', 30));
    wrap.appendChild(seg);

    var body = el('div', '');
    body.id = 'mmStatsBody';
    wrap.appendChild(body);

    listen(wrap, 'mm-back', function () { MM.go('#/practice'); });
    listen(wrap, 'mm-days', function (node) {
      statsDays = parseInt(node.getAttribute('data-days'), 10) || 7;
      renderStats();
    });
    renderStats();
  }

  function segBtn(label, days) {
    var b = btn(label, 'mm-days', { days: String(days) });
    if (days === statsDays) b.className = 'on';
    return b;
  }

  /* ---------- 渲染 ---------- */

  function renderStats() {
    var seg = $('statsWrap').querySelector('.seg');
    var buttons = seg.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var selected = parseInt(buttons[i].getAttribute('data-days'), 10) === statsDays;
      buttons[i].className = selected ? 'on' : '';
      buttons[i].setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    var requestedDays = statsDays;
    var body = $('mmStatsBody');
    body.innerHTML = '<div class="empty">加载中…</div>';
    MM.request('GET', '/api/stats?days=' + statsDays, null, function (err, data) {
      if (requestedDays !== statsDays || body !== $('mmStatsBody')) return;
      if (err) { body.innerHTML = ''; body.appendChild(el('div', 'empty', '加载失败：' + err)); return; }
      body.innerHTML = '';
      renderTotals(body, data);
      renderInsights(body, data);
      if ((data.totals || {}).answered > 0) {
        renderVolumeChart(body, data);
        renderTrendChart(body, data, 'accuracy', '正确率走势（%）');
        renderTrendChart(body, data, 'perQ', '每题用时走势（秒）');
        renderBySource(body, data);
        renderRecent(body, data);
      } else {
        body.appendChild(emptyCard('这段时间还没有练习记录，去刷一轮吧！'));
      }
    });
  }

  function emptyCard(text) {
    var c = el('div', 'card');
    c.appendChild(el('div', 'empty', text));
    return c;
  }

  function renderTotals(body, data) {
    var t = data.totals || {};
    var card = el('div', 'card');
    var row = el('div', 'stat-total');
    row.appendChild(statCell(t.rounds || 0, '轮次'));
    row.appendChild(statCell(t.answered || 0, '做题'));
    row.appendChild(statCell((t.accuracy || 0) + '%', '正确率'));
    row.appendChild(statCell((t.perQ || 0) + ' 秒', '每题均时'));
    card.appendChild(row);
    body.appendChild(card);
  }

  /* 小结：简单数据分析，自动生成几句话 */
  function renderInsights(body, data) {
    var t = data.totals || {};
    var lines = [];
    if (data.dayStreak >= 2) lines.push('连续练习 ' + data.dayStreak + ' 天，保持得很好！');
    var prev = data.prev || {};
    if (prev.answered >= 10 && (t.answered || 0) >= 10) {
      var dAcc = (t.accuracy || 0) - (prev.accuracy || 0);
      lines.push('正确率 ' + t.accuracy + '%，比上个周期' + (dAcc >= 0 ? '提高了 ' : '下降了 ') + Math.abs(dAcc) + ' 个点');
      if (t.perQ > 0 && prev.perQ > 0) {
        var dQ = Math.round((t.perQ - prev.perQ) * 10) / 10;
        if (Math.abs(dQ) >= 0.1) lines.push('平均每题 ' + t.perQ + ' 秒，比上期' + (dQ < 0 ? '快了 ' : '慢了 ') + Math.abs(dQ) + ' 秒');
        else lines.push('平均每题 ' + t.perQ + ' 秒，速度和上期持平');
      }
    }
    var sources = data.bySource || [];
    var best = null, weak = null;
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if ((s.answered || 0) < 10) continue;
      if (!best || s.accuracy > best.accuracy) best = s;
      if (!weak || s.accuracy < weak.accuracy) weak = s;
    }
    if (best && weak && best !== weak) {
      lines.push('表现最好：' + best.name + '（正确率 ' + best.accuracy + '%）');
      lines.push('建议加强：' + weak.name + '（正确率 ' + weak.accuracy + '%）');
    }
    if (!lines.length) {
      lines.push((t.answered || 0) > 0 ? '继续练习，积累更多数据后这里会有分析。' : '开始第一次练习吧！');
    }
    var card = el('div', 'card insight-card');
    var title = el('div', 'insight-title', '小结');
    card.appendChild(title);
    for (var j = 0; j < lines.length; j++) {
      var line = el('div', 'insight-line');
      line.textContent = '· ' + lines[j];
      card.appendChild(line);
    }
    body.appendChild(card);
  }

  /* 每日做题量（横向条，保持原有样式） */
  function renderVolumeChart(body, data) {
    var days = data.days || [];
    var max = 1;
    for (var d = 0; d < days.length; d++) if (days[d].answered > max) max = days[d].answered;
    var card = el('div', 'card');
    card.appendChild(el('div', 'chart-title', '每日做题量'));
    var any = false;
    for (var j = 0; j < days.length; j++) {
      var row = days[j];
      if (row.answered <= 0) continue;
      any = true;
      var line = el('div', 'stat-row');
      line.appendChild(el('span', 'stat-day', row.label));
      var bar = el('span', 'stat-bar');
      var fill = document.createElement('i');
      fill.style.width = Math.max(4, Math.round(row.answered / max * 100)) + '%';
      bar.appendChild(fill);
      line.appendChild(bar);
      line.appendChild(el('span', 'stat-val', row.answered + ' 题 · ' + row.accuracy + '%'));
      card.appendChild(line);
    }
    if (!any) card.appendChild(el('div', 'empty', '暂无数据'));
    body.appendChild(card);
  }

  /* 纵向走势图（正确率 / 每题用时共用） */
  function renderTrendChart(body, data, key, title) {
    var days = data.days || [];
    var card = el('div', 'card');
    card.appendChild(el('div', 'chart-title', title));
    var box = el('div', 'vchart');
    var max = 0;
    var vals = [];
    for (var i = 0; i < days.length; i++) {
      var v = days[i].answered > 0 ? days[i][key] : null;
      vals.push(v);
      if (v !== null && v > max) max = v;
    }
    var cap = key === 'accuracy' ? 100 : Math.max(max * 1.15, 1);
    for (var j = 0; j < vals.length; j++) {
      var col = el('div', 'vchart-col');
      var bar = document.createElement('i');
      bar.className = 'vchart-bar';
      var v = vals[j];
      col.setAttribute('role', 'img');
      col.setAttribute('aria-label', days[j].label + '：' + (v === null ? '未练习' : (v + (key === 'accuracy' ? '%' : ' 秒'))));
      bar.style.height = (v === null ? 0 : Math.max(2, Math.round(v / cap * 100))) + '%';
      if (key === 'accuracy') bar.style.background = v >= 90 ? '#33d17a' : (v >= 70 ? '#ffb020' : '#f2545b');
      col.appendChild(bar);
      box.appendChild(col);
    }
    card.appendChild(box);
    var labels = el('div', 'vchart-labels');
    var step = Math.max(1, Math.ceil(days.length / 5));
    for (var k = 0; k < days.length; k++) {
      labels.appendChild(el('span', '', k % step === 0 ? days[k].label : ''));
    }
    card.appendChild(labels);
    body.appendChild(card);
  }

  /* 来源/档位分析 */
  function renderBySource(body, data) {
    var sources = data.bySource || [];
    if (!sources.length) return;
    var card = el('div', 'card');
    card.appendChild(el('div', 'chart-title', '来源与档位分析'));
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var row = el('div', 'src-row');
      var line = el('div', 'src-line');
      line.appendChild(el('span', 'src-name', s.name || s.sourceId || '未知来源'));
      line.appendChild(el('span', 'src-count', s.answered + ' 题'));
      row.appendChild(line);
      var bar = el('div', 'src-bar');
      var fill = document.createElement('i');
      fill.style.width = Math.max(2, s.accuracy || 0) + '%';
      fill.style.background = (s.accuracy || 0) >= 90 ? '#33d17a' : ((s.accuracy || 0) >= 70 ? '#ffb020' : '#f2545b');
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('div', 'src-meta', '正确率 ' + s.accuracy + '% · 平均 ' + s.perQ +
        ' 秒/题 · 最长连对 ' + (s.bestStreak || 0) + ' 题'));
      card.appendChild(row);
    }
    body.appendChild(card);
  }

  /* 最近练习 */
  function renderRecent(body, data) {
    var recent = data.recent || [];
    if (!recent.length) return;
    var card = el('div', 'card');
    card.appendChild(el('div', 'chart-title', '最近练习'));
    for (var i = 0; i < recent.length; i++) {
      var r = recent[i];
      var time = MM.fmtTime(r.ts);
      var row = el('div', 'recent-row');
      row.appendChild(el('span', 'recent-time', time));
      var main = el('span', 'recent-main');
      main.appendChild(el('span', 'recent-name', r.name || '练习'));
      main.appendChild(el('span', 'recent-sub', '答对 ' + r.correct + '/' + r.total + ' · 连对 ' + (r.bestStreak || 0)));
      row.appendChild(main);
      row.appendChild(el('span', 'recent-val', r.accuracy + '% · ' + r.perQ + ' 秒'));
      card.appendChild(row);
    }
    body.appendChild(card);
  }

  function statCell(num, label) {
    var cell = el('div', 'st');
    cell.appendChild(el('div', 'st-num', String(num)));
    cell.appendChild(el('div', 'st-label', label));
    return cell;
  }

  /* ================= 设置 ================= */

  function settingsEnter() {
    var wrap = $('settingsWrap');
    wrap.innerHTML = '';
    if (!MM.ADMIN_MODE) wrap.appendChild(backLink());
    wrap.appendChild(el('h1', 'page-title', '练习设置'));
    wrap.appendChild(el('p', 'lead', '根据孩子的练习节奏调整，修改后自动保存。'));
    var config = MM.state.config || {};

    wrap.appendChild(el('div', 'section-title', '每轮题数'));
    var sizeSeg = el('div', 'seg');
    var sizes = [10, 15, 20, 30];
    for (var i = 0; i < sizes.length; i++) {
      var sb = el('button', config.roundSize === sizes[i] ? 'on' : '', String(sizes[i]) + ' 题');
      sb.setAttribute('aria-pressed', config.roundSize === sizes[i] ? 'true' : 'false');
      sb.setAttribute('data-action', 'mm-round');
      sb.setAttribute('data-value', String(sizes[i]));
      sizeSeg.appendChild(sb);
    }
    wrap.appendChild(sizeSeg);

    wrap.appendChild(el('div', 'section-title', '练习出题来源'));
    var srcCard = el('div', 'card');
    var srcSel = document.createElement('select');
    srcSel.className = 'select';
    srcSel.id = 'mmPracticeSource';
    var optGen = el('option', '', '内置出题器（按启用档位随机）');
    optGen.value = 'generator';
    srcSel.appendChild(optGen);
    var banks = MM.state.banks || [];
    for (var s = 0; s < banks.length; s++) {
      var bank = banks[s];
      var opt = el('option', '', bank.name + '（' + bank.itemCount + ' 题 · ' + (MM.KIND_NAMES[bank.kind] || bank.kind) + '）');
      opt.value = bank.id;
      if (config.practiceSource === bank.id) opt.selected = true;
      srcSel.appendChild(opt);
    }
    if (!config.practiceSource || config.practiceSource === 'generator') optGen.selected = true;
    srcCard.appendChild(field('设备端「开始练习」使用的题目来源', srcSel));
    srcCard.appendChild(el('div', 'muted', '想让孩子练导入的题库，就在这里选它；换成内置出题器则永远有题可刷。'));
    wrap.appendChild(srcCard);
    srcSel.addEventListener('change', function () {
      saveConfig({ practiceSource: srcSel.value });
    });

    wrap.appendChild(el('div', 'section-title', 'Agent 默认年级'));
    var dlCard = el('div', 'card');
    var dlSel = document.createElement('select');
    dlSel.className = 'select';
    dlSel.id = 'mmDefaultLevel';
    var dlVals = [['', '不自动补标（漏标保持未设年级）']].concat(GRADES.map(function (g) { return [g, g]; }));
    optionList(dlSel, '不自动补标（漏标保持未设年级）', dlVals.slice(1), config.defaultLevel || '');
    dlSel.value = config.defaultLevel || '';
    dlCard.appendChild(field('Agent 推题未写年级时自动补为', dlSel));
    dlCard.appendChild(el('div', 'muted', '保证题库里所有题都有年级标签；Agent 也可以在题目里自带 level 字段覆盖这个默认值。'));
    wrap.appendChild(dlCard);
    dlSel.addEventListener('change', function () {
      saveConfig({ defaultLevel: dlSel.value });
    });

    wrap.appendChild(el('div', 'section-title', '启用的档位'));
    var levelsCard = el('div', 'card');
    var levels = config.levels || [1, 2, 3, 4];
    var LEVEL_META = [[1, '20 以内加减', '入门'], [2, '100 以内加减', '进位退位'], [3, '表内乘除', '乘法口诀'], [4, '两步混合', '稍有挑战']];
    for (var j = 0; j < LEVEL_META.length; j++) {
      var lv = LEVEL_META[j];
      var row = el('button', 'stat-row level-toggle');
      row.setAttribute('aria-pressed', levels.indexOf(lv[0]) >= 0 ? 'true' : 'false');
      row.setAttribute('data-action', 'mm-level');
      row.setAttribute('data-value', String(lv[0]));
      row.appendChild(el('span', 'stat-day', (levels.indexOf(lv[0]) >= 0 ? '✓' : '—')));
      var main = el('span', '');
      main.className = 'level-toggle-name';
      main.textContent = lv[1] + ' · ' + lv[2];
      row.appendChild(main);
      levelsCard.appendChild(row);
    }
    wrap.appendChild(levelsCard);

    wrap.appendChild(el('div', 'section-title', '题库自动同步'));
    var syncSeg = el('div', 'seg');
    var hours = [12, 24, 48, 72];
    for (var k = 0; k < hours.length; k++) {
      var hb = el('button', config.autoSyncHours === hours[k] ? 'on' : '', hours[k] + ' 小时');
      hb.setAttribute('aria-pressed', config.autoSyncHours === hours[k] ? 'true' : 'false');
      hb.setAttribute('data-action', 'mm-sync-hours');
      hb.setAttribute('data-value', String(hours[k]));
      syncSeg.appendChild(hb);
    }
    wrap.appendChild(syncSeg);
    wrap.appendChild(el('p', 'muted', '打开 app 时，超过该间隔的 URL / 设备源会自动重新拉取。'));

    wrap.appendChild(el('div', 'section-title', '主题'));
    var themeSeg = el('div', 'seg');
    var themes = [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']];
    for (var t = 0; t < themes.length; t++) {
      var tb = el('button', (config.theme || 'system') === themes[t][0] ? 'on' : '', themes[t][1]);
      tb.setAttribute('aria-pressed', (config.theme || 'system') === themes[t][0] ? 'true' : 'false');
      tb.setAttribute('data-action', 'mm-theme');
      tb.setAttribute('data-value', themes[t][0]);
      themeSeg.appendChild(tb);
    }
    wrap.appendChild(themeSeg);

    var about = el('div', 'card');
    about.style.marginTop = '22px';
    var version = MM.state.version || '';
    about.appendChild(el('div', 'muted mt0', '口算天天练 v' + version));
    var lan = el('div', 'muted');
    lan.id = 'mmLanUrl';
    lan.textContent = '局域网管理地址：加载中…';
    about.appendChild(lan);
    wrap.appendChild(about);

    wrap.appendChild(el('div', 'section-title', '数据'));
    var dataCard = el('div', 'card');
    dataCard.appendChild(el('div', 'muted mt0', '清空后练习记录不可恢复，图表与小结会重新累计。'));
    dataCard.appendChild(btn('清空练习记录', 'mm-reset-stats', null, 'btn btn-sm btn-danger'));
    wrap.appendChild(dataCard);
    listen(wrap, 'mm-reset-stats', function () {
      if (!window.confirm('确定清空全部练习记录？此操作不可恢复。')) return;
      MM.request('POST', '/api/practice/reset', {}, function (err, res) {
        if (err) { MM.toast('清空失败：' + err); return; }
        MM.toast('已清空 ' + (res.deleted || 0) + ' 轮记录');
        MM.loadState(function () {
          // 设备端刷新当前屏；管理页停留在设置页即可
          if (window.MM_PRACTICE) MM.route(true);
        });
      });
    });

    listen(wrap, 'mm-back', function () { MM.go('#/practice'); });
    listen(wrap, 'mm-round', function (node) { saveConfig({ roundSize: parseInt(node.getAttribute('data-value'), 10) }); });
    listen(wrap, 'mm-level', function (node) {
      var id = parseInt(node.getAttribute('data-value'), 10);
      var current = (MM.state.config || {}).levels || [1, 2, 3, 4];
      var next = current.slice();
      var pos = next.indexOf(id);
      if (pos >= 0 && next.length > 1) next.splice(pos, 1);
      else if (pos < 0) next.push(id);
      else MM.toast('至少保留一个档位');
      if (pos >= 0 && next.length === current.length) return;
      next.sort();
      saveConfig({ levels: next });
    });
    listen(wrap, 'mm-sync-hours', function (node) { saveConfig({ autoSyncHours: parseInt(node.getAttribute('data-value'), 10) }); });
    listen(wrap, 'mm-theme', function (node) {
      var mode = node.getAttribute('data-value');
      saveConfig({ theme: mode });
    });

    MM.request('GET', '/api/hello', null, function (err, data) {
      var target = $('mmLanUrl');
      if (!target) return;
      if (err || !data || !data.ip) { target.textContent = '局域网管理地址：获取失败'; return; }
      target.textContent = '局域网管理地址：http://' + data.ip + ':' + data.port + '/admin/';
    });
  }

  function saveConfig(patch) {
    if (savingConfig) return;
    savingConfig = true;
    var controls = $('settingsWrap').querySelectorAll('button, select');
    for (var i = 0; i < controls.length; i++) controls[i].disabled = true;
    MM.request('PUT', '/api/config', patch, function (err, data) {
      savingConfig = false;
      for (var i = 0; i < controls.length; i++) controls[i].disabled = false;
      if (err) { MM.toast('保存失败：' + err); return; }
      MM.state.config = data.config;
      MM.toast('已保存');
      MM.applyTheme(data.config.theme || 'system');
      if (MM.ADMIN_MODE) {
        if (activeAdminTab === 'settings') settingsEnter();
      }
      else MM.route(true);
    });
  }

  window.MM_BANKS = { enter: banksEnter, refreshList: renderBankList };
  window.MM_STATS = { enter: statsEnter };
  window.MM_SETTINGS = { enter: settingsEnter };

  /* ---------- 家长管理页入口（/admin/，标签切换） ---------- */

  function adminBoot() {
    MM.ADMIN_MODE = true;
    var tabs = $('adminTabs');
    function activate(name) {
      activeAdminTab = name;
      var buttons = tabs.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].className = buttons[i].getAttribute('data-tab') === name ? 'on' : '';
        if (buttons[i].getAttribute('data-tab') === name) buttons[i].setAttribute('aria-current', 'page');
        else buttons[i].removeAttribute('aria-current');
      }
      var names = ['banks', 'stats', 'settings'];
      for (var j = 0; j < names.length; j++) {
        var sec = $('screen-' + names[j]);
        if (sec) sec.className = 'screen' + (names[j] === name ? ' active' : '');
      }
      window.scrollTo(0, 0);
      if (name === 'banks') banksEnter();
      else if (name === 'stats') statsEnter();
      else settingsEnter();
    }
    tabs.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== tabs) {
        if (node.getAttribute && node.getAttribute('data-tab')) {
          activate(node.getAttribute('data-tab'));
          return;
        }
        node = node.parentNode;
      }
    });
    MM.loadState(function (err) {
      MM.renderToday();
      if (err) {
        $('banksWrap').innerHTML = '<div class="card empty"><h1>暂时连不上设备</h1><p>请确认设备与当前浏览器连接同一网络。</p><button class="btn btn-primary" id="mmAdminRetry">重新连接</button></div>';
        $('mmAdminRetry').onclick = function () { location.reload(); };
        MM.toast('无法连接设备：' + err);
        return;
      }
      // 支持 #banks #stats #settings 深链直达
      var initial = (location.hash || '#banks').replace('#', '');
      if (initial !== 'banks' && initial !== 'stats' && initial !== 'settings') initial = 'banks';
      activate(initial);
      setInterval(MM.refreshState, 60000);
    });
  }

  window.MM_ADMIN = { boot: adminBoot };
})();
