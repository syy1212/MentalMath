/* 口算天天练 · 练习页：入口列表 + 答题流程（计时/连对/多选确认/结算上报）。
   移植 StudyOnTV mental.js 的交互与计分逻辑，题目来源分生成器档位与题库两种。
   通过 window.MM_PRACTICE 与 app.js 的路由对接。ES5 语法。 */
(function () {
  'use strict';

  var BEST_KEY = 'mm_best';
  var LEVELS = [
    { id: 1, name: '20 以内加减', note: '入门' },
    { id: 2, name: '100 以内加减', note: '进位退位' },
    { id: 3, name: '表内乘除', note: '乘法口诀' },
    { id: 4, name: '两步混合', note: '稍有挑战' }
  ];

  var ISLANDS = [
    { name: '珊瑚湾', need: 0, mark: 'Ⅰ' },
    { name: '泡泡岛', need: 12, mark: 'Ⅱ' },
    { name: '海草森林', need: 30, mark: 'Ⅲ' },
    { name: '星光海', need: 60, mark: 'Ⅳ' },
    { name: '彩虹礁', need: 100, mark: 'Ⅴ' },
    { name: '鲸鱼乐园', need: 160, mark: 'Ⅵ' }
  ];
  var BADGES = [
    { name: '出发的小勇士', mark: '1', note: '完成第一轮', earned: function (b) { return b.rounds >= 1; } },
    { name: '连对小能手', mark: '✓', note: '连续答对 5 题', earned: function (b) { return b.streak >= 5; } },
    { name: '认真小达人', mark: '50', note: '累计完成 50 题', earned: function (b) { return b.questions >= 50; } },
    { name: '满分小船长', mark: '★', note: '一轮全部答对', earned: function (b) { return b.perfectRounds >= 1; } }
  ];

  var $ = MM.$;
  var cur = null; // 进行中的一轮
  var starting = false;

  function loadBest() {
    var empty = { streak: 0, avg: 0, rounds: 0, questions: 0, pearls: 0, perfectRounds: 0 };
    try {
      var raw = localStorage.getItem(BEST_KEY);
      if (!raw) return empty;
      var saved = JSON.parse(raw);
      for (var key in empty) {
        if (typeof saved[key] === 'number' && isFinite(saved[key]) && saved[key] >= 0) empty[key] = saved[key];
      }
    } catch (e) { MM.toast('成长记录读取失败，本次奖励暂时无法保存'); }
    return empty;
  }

  function saveBest(best) {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(best));
      return true;
    } catch (e) {
      return false;
    }
  }

  function islandIndex(pearls) {
    var index = 0;
    for (var i = 1; i < ISLANDS.length; i++) if (pearls >= ISLANDS[i].need) index = i;
    return index;
  }

  function whale(cls) {
    var picture = el('img', cls || 'whale-picture');
    picture.src = 'assets/img/icon.png';
    picture.alt = '陪你探险的小鲸鱼';
    return picture;
  }

  function renderJourney(best) {
    var journey = el('section', 'journey-card');
    var head = el('div', 'section-head');
    head.appendChild(el('h2', '', '我的海洋地图'));
    head.appendChild(el('span', 'pearl-count', best.pearls + ' 颗珍珠'));
    journey.appendChild(head);
    var current = islandIndex(best.pearls);
    var nextIsland = ISLANDS[current + 1];
    journey.appendChild(el('p', 'lead', nextIsland
      ? '再收集 ' + (nextIsland.need - best.pearls) + ' 颗珍珠，就能发现' + nextIsland.name
      : '六片海域都点亮啦！带着小鲸鱼继续巩固本领吧。'));
    var map = el('ol', 'island-map');
    for (var i = 0; i < ISLANDS.length; i++) {
      var stop = el('li', 'island-stop' + (i <= current ? ' unlocked' : '') + (i === current ? ' current' : ''));
      if (i === current) stop.setAttribute('aria-current', 'step');
      var icon = el('span', 'island-icon', ISLANDS[i].mark);
      icon.setAttribute('aria-hidden', 'true');
      stop.appendChild(icon);
      stop.appendChild(el('strong', '', ISLANDS[i].name));
      stop.appendChild(el('span', 'island-note', i === current ? '正在探索' : (i < current ? '已发现' : ISLANDS[i].need + ' 颗点亮')));
      map.appendChild(stop);
    }
    journey.appendChild(map);
    return journey;
  }

  function renderBadges(best) {
    var collection = el('section', 'badge-collection');
    var head = el('div', 'section-head');
    var count = 0;
    for (var j = 0; j < BADGES.length; j++) if (BADGES[j].earned(best)) count++;
    head.appendChild(el('h2', '', '我的勋章'));
    head.appendChild(el('span', 'muted', count + ' / ' + BADGES.length + ' 已获得'));
    collection.appendChild(head);
    var badges = el('div', 'badge-grid');
    for (var i = 0; i < BADGES.length; i++) {
      var badge = BADGES[i];
      var earned = badge.earned(best);
      var card = el('div', 'badge-card' + (earned ? ' earned' : ''));
      var symbol = el('span', 'badge-symbol', badge.mark);
      symbol.setAttribute('aria-hidden', 'true');
      card.appendChild(symbol);
      card.appendChild(el('strong', '', badge.name));
      card.appendChild(el('span', '', badge.note));
      card.appendChild(el('small', '', earned ? '已获得' : '未获得'));
      badges.appendChild(card);
    }
    collection.appendChild(badges);
    return collection;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function btn(label, action, data, primary) {
    var b = el('button', 'btn' + (primary ? ' btn-primary' : ''), label);
    b.setAttribute('data-action', action);
    if (data) {
      for (var k in data) b.setAttribute('data-' + k, data[k]);
    }
    return b;
  }

  function listen(container, action, handler) {
    container.addEventListener('click', function (ev) {
      var node = ev.target;
      while (node && node !== container) {
        if (node.getAttribute && node.getAttribute('data-action') === action) {
          handler(node);
          return;
        }
        node = node.parentNode;
      }
    });
  }

  /* ---------- 首页入口 ---------- */

  function enter() {
    if (cur && !cur.finished) return;
    cur = null;
    renderHome();
  }

  function renderHome() {
    $('practiceRound').className = 'hidden';
    var home = $('practiceHome');
    home.className = '';
    home.innerHTML = '';
    var config = MM.state.config || {};

    var intro = el('div', 'home-intro');
    intro.appendChild(el('p', 'eyebrow', '和小鲸鱼一起 · 口算探险记'));
    intro.appendChild(el('h1', 'home-title', '今天，去发现一座新海岛！'));
    intro.appendChild(el('p', 'lead', '动动脑筋，收集珍珠。每一份认真，都让你游得更远。'));
    home.appendChild(intro);

    var workspace = el('div', 'home-workspace');
    var hero = el('div', 'practice-hero');
    var best = loadBest();
    var todayRounds = (MM.state.today || {}).rounds || 0;
    hero.appendChild(el('span', 'hero-label', '小鲸鱼的寻宝之旅'));
    hero.appendChild(el('h2', '', '一起去' + ISLANDS[islandIndex(best.pearls)].name + '！'));
    hero.appendChild(el('p', 'hero-note', '每轮 ' + (config.roundSize || 10) + ' 题 · 答对 +1 珍珠 · 完成整轮 +2'));
    var scene = el('div', 'whale-scene');
    scene.appendChild(whale());
    scene.appendChild(el('span', 'whale-speech', todayRounds >= 2 ? '今天很认真！也记得休息哦。' : '准备好了吗？我们一起出发！'));
    hero.appendChild(scene);
    var startBtn = btn('开始探险  →', 'mm-start', { source: '', name: '开始练习', kind: 'auto', level: '0' }, true);
    startBtn.className = 'btn btn-primary btn-block start-btn';
    hero.appendChild(startBtn);
    hero.appendChild(el('p', 'hero-footnote', '认真想，不着急。答错也可以学到新本领。'));
    var mission = el('div', 'daily-mission');
    mission.appendChild(el('span', 'mission-mark', todayRounds >= 2 ? '✓' : '○'));
    mission.appendChild(el('span', '', todayRounds >= 2 ? '今日两轮小目标完成，休息一下吧' : '今日小目标：完成 2 轮（' + todayRounds + '/2）'));
    hero.appendChild(mission);
    workspace.appendChild(hero);

    var panel = el('div', 'levels-panel');
    var panelHead = el('div', 'section-head');
    panelHead.appendChild(el('h2', '', '专项练习'));
    panelHead.appendChild(el('span', 'muted', '按档位，慢慢进阶'));
    panel.appendChild(panelHead);
    var entries = el('div', 'level-entries');
    var levels = config.levels || [1, 2, 3, 4];
    var shown = 0;
    var symbols = ['＋', '－', '×', '÷'];
    for (var i = 0; i < LEVELS.length; i++) {
      var lv = LEVELS[i];
      if (levels.indexOf(lv.id) < 0) continue;
      shown++;
      var entry = el('button', 'entry level-' + lv.id);
      entry.setAttribute('data-action', 'mm-start');
      entry.setAttribute('data-source', 'generator:' + lv.id);
      entry.setAttribute('data-name', lv.name);
      entry.setAttribute('data-kind', 'generator');
      entry.setAttribute('data-level', String(lv.id));
      var badge = el('span', 'entry-badge', symbols[i]);
      badge.setAttribute('aria-hidden', 'true');
      var main = el('span', 'entry-main');
      main.appendChild(el('span', 'entry-name', lv.name));
      main.appendChild(el('span', 'entry-note', lv.note));
      entry.appendChild(badge);
      entry.appendChild(main);
      var arrow = el('span', 'entry-arrow', '↗');
      arrow.setAttribute('aria-hidden', 'true');
      entry.appendChild(arrow);
      entries.appendChild(entry);
    }
    if (!shown) entries.appendChild(el('p', 'lead', '专项档位暂未启用，可从今日练习开始。'));
    panel.appendChild(entries);
    workspace.appendChild(panel);
    home.appendChild(workspace);

    home.appendChild(renderJourney(best));
    home.appendChild(renderBadges(best));

    var record = el('div', 'personal-record');
    var recordHead = el('div', 'section-head');
    recordHead.appendChild(el('h2', '', '我的进步'));
    recordHead.appendChild(btn('练习记录 →', 'mm-go-stats', null, false));
    record.appendChild(recordHead);
    var metrics = el('div', 'record-metrics');
    var values = [[best.streak + ' 题', '最长连对'], [best.avg ? MM.fmtSeconds(best.avg) : '—', '最快平均用时'], [best.questions + ' 题', '累计练习']];
    for (var j = 0; j < values.length; j++) {
      var metric = el('div', 'record-metric');
      metric.appendChild(el('strong', '', values[j][0]));
      metric.appendChild(el('span', '', values[j][1]));
      metrics.appendChild(metric);
    }
    record.appendChild(metrics);
    home.appendChild(record);
  }

  /* ---------- 答题轮 ---------- */

  function startRound(sourceId, sourceName, kind, level) {
    if (starting) return;
    starting = true;
    var startButtons = document.querySelectorAll('[data-action="mm-start"], [data-action="mm-again"]');
    for (var i = 0; i < startButtons.length; i++) startButtons[i].disabled = true;
    MM.request('POST', '/api/practice/round',
      { sourceId: sourceId, count: (MM.state.config || {}).roundSize || 10 },
      function (err, data) {
        starting = false;
        for (var i = 0; i < startButtons.length; i++) startButtons[i].disabled = false;
        if (err) { MM.toast('出题失败：' + err); return; }
        if (!data.items || !data.items.length) { MM.toast('暂时没有可练的题目'); return; }
        cur = {
          sourceId: data.sourceId || sourceId || 'generator',
          sourceName: data.sourceName || sourceName,
          kind: kind === 'auto' ? (data.kind || 'generator') : kind,
          level: kind === 'generator' || kind === 'auto' ? (data.level || level || 0) : 0,
          items: data.items,
          index: 0,
          correct: 0,
          streak: 0,
          bestStreak: 0,
          times: [],
          locked: false,
          startAt: 0,
          finished: false,
          multi: []
        };
        renderRound();
      });
  }

  function renderRound() {
    $('practiceHome').className = 'hidden';
    var box = $('practiceRound');
    box.className = 'round-panel';
    box.innerHTML = '';
    var question = cur.items[cur.index];
    cur.locked = false;
    cur.multi = [];
    cur.startAt = Date.now();

    var exit = btn('‹ 退出本轮', 'mm-exit', null, false);
    exit.className = 'back-link';
    box.appendChild(exit);
    box.appendChild(el('p', 'round-source', cur.sourceName));
    var buddy = el('div', 'round-buddy');
    buddy.appendChild(whale('buddy-picture'));
    var bubble = el('span', 'buddy-speech', '认真想一想，完成整轮保存珍珠。');
    bubble.id = 'mmBuddySpeech';
    buddy.appendChild(bubble);
    var roundPearls = el('span', 'round-pearls', '本轮 0 颗珍珠');
    roundPearls.id = 'mmRoundPearls';
    roundPearls.textContent = '本轮 ' + cur.correct + ' 颗珍珠';
    buddy.appendChild(roundPearls);
    box.appendChild(buddy);

    var pct = Math.round(cur.index / cur.items.length * 100);
    var bar = el('div', 'q-progress-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', '答题进度');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(cur.items.length));
    bar.setAttribute('aria-valuenow', String(cur.index));
    bar.id = 'mmProgress';
    var fill = el('i', 'q-progress-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    box.appendChild(bar);

    var head = el('div', 'q-head');
    head.id = 'mmQuestionHead';
    head.appendChild(el('span', '', '第 ' + (cur.index + 1) + '/' + cur.items.length + ' 题'));
    head.appendChild(el('span', '', '已答对 ' + cur.correct + ' · 连对 ' + cur.streak));
    box.appendChild(head);

    var text = el('h1', 'q-text');
    text.tabIndex = -1;
    text.textContent = question.q || question.stem || '';
    if ((question.q || question.stem || '').length > 16) text.className += ' q-text-long';
    box.appendChild(text);

    var options = question.a || question.options || [];
    var isMulti = question.type === 'multiple';
    box.appendChild(el('p', 'question-hint', isMulti ? '选择所有正确答案，再确认' : '算一算，选出正确答案'));
    var opts = el('div', 'opts');
    for (var i = 0; i < options.length; i++) {
      var b = el('button', 'opt');
      b.setAttribute('data-action', isMulti ? 'mm-toggle' : 'mm-choose');
      b.setAttribute('data-index', String(i));
      b.appendChild(el('span', 'opt-letter', String.fromCharCode(65 + i)));
      b.appendChild(el('span', 'opt-value', String(options[i])));
      if (isMulti) b.setAttribute('aria-pressed', 'false');
      opts.appendChild(b);
    }
    box.appendChild(opts);

    var feedback = el('div', 'feedback');
    feedback.id = 'mmFeedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    box.appendChild(feedback);

    var actions = el('div', 'q-actions');
    actions.id = 'mmActions';
    if (isMulti) {
      actions.appendChild(el('p', 'muted mt0', '多选题：选好后点确认'));
      var confirm = btn('确认答案', 'mm-confirm', null, true);
      confirm.disabled = true;
      actions.appendChild(confirm);
    }
    box.appendChild(actions);
    window.scrollTo(0, 0);
    text.focus();
  }

  function correctIndices(question) {
    if (question.type === 'multiple') {
      var ci = question.correctIndices || [];
      return ci.slice().sort();
    }
    return [typeof question.k === 'number' ? question.k : 0];
  }

  function optionText(question, index) {
    var options = question.a || question.options || [];
    return options[index] !== undefined ? String(options[index]) : '';
  }

  function judge(chosen) {
    if (cur.locked) return;
    cur.locked = true;
    var question = cur.items[cur.index];
    var spent = (Date.now() - cur.startAt) / 1000;
    cur.times.push(spent);
    var right = sameSet(chosen, correctIndices(question));

    var optionButtons = document.querySelectorAll('#practiceRound .opt');
    var correctSet = correctIndices(question);
    for (var i = 0; i < optionButtons.length; i++) {
      var b = optionButtons[i];
      var idx = parseInt(b.getAttribute('data-index'), 10);
      b.disabled = true;
      if (correctSet.indexOf(idx) >= 0) b.className = 'opt right';
      else if (chosen.indexOf(idx) >= 0) b.className = 'opt wrong';
      else b.className = 'opt';
      if (correctSet.indexOf(idx) >= 0 || chosen.indexOf(idx) >= 0) {
        b.appendChild(el('span', 'opt-state', correctSet.indexOf(idx) >= 0 ? '✓' : '×'));
      }
    }

    $('mmProgress').setAttribute('aria-valuenow', String(cur.index + 1));
    $('mmProgress').firstChild.style.width = Math.round((cur.index + 1) / cur.items.length * 100) + '%';
    var feedback = $('mmFeedback');
    var actions = $('mmActions');
    actions.innerHTML = '';
    if (right) {
      cur.correct++;
      cur.streak++;
      if (cur.streak > cur.bestStreak) cur.bestStreak = cur.streak;
      var cheers = ['想得真仔细！', '又发现一颗珍珠！', '小脑袋很灵活！'];
      $('mmBuddySpeech').textContent = cheers[cur.index % cheers.length];
      $('mmRoundPearls').textContent = '本轮 ' + cur.correct + ' 颗珍珠';
      if (cur.streak === 3 || cur.streak === 5 || (cur.streak > 5 && cur.streak % 5 === 0)) {
        $('mmBuddySpeech').textContent = '连续答对 ' + cur.streak + ' 题，好样的！';
        $('mmRoundPearls').className = 'round-pearls pearl-pop';
      }
      feedback.className = 'feedback ok show';
      feedback.textContent = '答对啦！珍珠 +1 · 用时 ' + MM.fmtSeconds(spent) +
        (cur.streak >= 3 ? ' · 连对 ' + cur.streak + ' 题' : '');
    } else {
      cur.streak = 0;
      $('mmBuddySpeech').textContent = '没关系，学会这一题也是进步。';
      feedback.className = 'feedback no show';
      var answers = [];
      for (var j = 0; j < correctSet.length; j++) answers.push(optionText(question, correctSet[j]));
      feedback.textContent = '再想想～正确答案是 ' + answers.join('、') + '，用时 ' + MM.fmtSeconds(spent);
      if (question.tip) feedback.textContent += '。' + question.tip;
    }
    $('mmQuestionHead').lastChild.textContent = '已答对 ' + cur.correct + ' · 连对 ' + cur.streak;
    actions.appendChild(btn(cur.index + 1 >= cur.items.length ? '查看本轮成绩' : '下一题', 'mm-next', null, true));
    actions.lastChild.focus();
  }

  function sameSet(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var sa = a.slice().sort(), sb = b.slice().sort();
    for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  }

  function next() {
    cur.index++;
    if (cur.index >= cur.items.length) finish(); else renderRound();
  }

  function finish() {
    if (cur.finished) return;
    cur.finished = true;
    var sum = 0;
    for (var i = 0; i < cur.times.length; i++) sum += cur.times[i];
    var avg = cur.times.length ? sum / cur.times.length : 0;
    var seconds = Math.round(sum * 10) / 10;
    var round = cur;
    MM.request('POST', '/api/practice/finish', {
      sourceId: cur.sourceId,
      sourceName: cur.sourceName,
      level: cur.level || 0,
      total: cur.items.length,
      correct: cur.correct,
      bestStreak: cur.bestStreak,
      seconds: seconds
    }, function (err) {
      var status = cur === round ? $('mmSaveStatus') : null;
      if (err) {
        if (status) status.textContent = '记录保存失败：' + err;
        MM.toast('本轮记录保存失败：' + err);
        return;
      }
      if (status) status.textContent = '本轮记录已保存';
      MM.loadState(function () { MM.renderToday(); });
    });

    var best = loadBest();
    var previousIsland = islandIndex(best.pearls);
    var previousBadges = [];
    for (var j = 0; j < BADGES.length; j++) previousBadges.push(BADGES[j].earned(best));
    var newStreak = cur.bestStreak > best.streak;
    var newAvg = avg > 0 && (!best.avg || avg < best.avg);
    if (newStreak) best.streak = cur.bestStreak;
    if (newAvg) best.avg = avg;
    best.rounds++;
    best.questions += cur.times.length;
    var earnedPearls = cur.correct + 2;
    best.pearls += earnedPearls;
    if (cur.correct === cur.items.length) best.perfectRounds++;
    var growthSaved = saveBest(best);

    var box = $('practiceRound');
    box.innerHTML = '';
    var hero = el('div', 'result-hero');
    hero.appendChild(whale('result-whale'));
    hero.appendChild(el('p', 'eyebrow', '探险完成 · 每一份认真都有收获'));
    hero.appendChild(el('h1', 'result-title', cur.correct === cur.items.length ? '全答对了，真棒！' : '本轮练习完成！'));
    hero.appendChild(el('div', 'result-num', cur.correct + ' '));
    var small = el('small', '', '/ ' + cur.items.length);
    hero.lastChild.appendChild(small);
    var sub = el('div', 'result-sub');
    sub.textContent = cur.sourceName + ' · 平均 ' + MM.fmtSeconds(avg) +
      ' · 本轮最长连对 ' + cur.bestStreak + ' 题';
    hero.appendChild(sub);
    if (newStreak || newAvg) hero.appendChild(el('div', 'result-new', '刷新了历史纪录！'));
    var saveStatus = el('p', 'muted', '正在保存本轮记录…');
    saveStatus.id = 'mmSaveStatus';
    saveStatus.setAttribute('role', 'status');
    hero.appendChild(saveStatus);
    var reward = el('div', 'round-reward');
    reward.appendChild(el('strong', '', '收集了 ' + earnedPearls + ' 颗珍珠'));
    reward.appendChild(el('p', '', '答对 ' + cur.correct + ' 题 +' + cur.correct + ' · 完成整轮 +2'));
    var newIsland = islandIndex(best.pearls);
    if (newIsland > previousIsland) {
      reward.appendChild(el('p', 'reward-unlock', '新发现：' + ISLANDS[newIsland].name + '！'));
    } else if (ISLANDS[newIsland + 1]) {
      reward.appendChild(el('p', '', '再攒 ' + (ISLANDS[newIsland + 1].need - best.pearls) + ' 颗，就能点亮' + ISLANDS[newIsland + 1].name));
    } else {
      reward.appendChild(el('p', '', '海洋地图全部点亮，你是小鲸鱼的探险好伙伴！'));
    }
    for (var k = 0; k < BADGES.length; k++) {
      if (!previousBadges[k] && BADGES[k].earned(best)) reward.appendChild(el('p', 'reward-unlock', '获得勋章：' + BADGES[k].name));
    }
    if (!growthSaved) reward.appendChild(el('p', 'growth-error', '成长记录保存失败，本轮珍珠和勋章未保存。'));
    hero.appendChild(reward);
    var restDue = ((MM.state.today || {}).rounds || 0) + 1 >= 2;
    if (restDue) hero.appendChild(el('p', 'rest-note', '今天已经认真练习两轮啦，看看远处，让眼睛休息一下。'));
    box.appendChild(hero);

    var actions = el('div', 'q-actions');
    actions.appendChild(btn(restDue ? '休息一下，回到海湾' : '继续探险', restDue ? 'mm-home' : 'mm-again', null, true));
    actions.appendChild(btn(restDue ? '再练一轮' : '回到海湾，看看收藏', restDue ? 'mm-again' : 'mm-home'));
    actions.appendChild(btn('看练习记录', 'mm-go-stats'));
    box.appendChild(actions);
    window.scrollTo(0, 0);
  }

  /* ---------- 事件分发 ---------- */

  listen(document.body, 'mm-start', function (node) {
    startRound(node.getAttribute('data-source'), node.getAttribute('data-name'),
      node.getAttribute('data-kind'), parseInt(node.getAttribute('data-level'), 10) || 0);
  });
  listen(document.body, 'mm-exit', function () { cur = null; renderHome(); });
  listen(document.body, 'mm-choose', function (node) {
    if (!cur || cur.locked) return;
    judge([parseInt(node.getAttribute('data-index'), 10)]);
  });
  listen(document.body, 'mm-toggle', function (node) {
    if (!cur || cur.locked) return;
    var idx = parseInt(node.getAttribute('data-index'), 10);
    var pos = cur.multi.indexOf(idx);
    if (pos >= 0) { cur.multi.splice(pos, 1); node.className = 'opt'; }
    else { cur.multi.push(idx); node.className = 'opt selected'; }
    node.setAttribute('aria-pressed', pos < 0 ? 'true' : 'false');
    document.querySelector('[data-action="mm-confirm"]').disabled = !cur.multi.length;
  });
  listen(document.body, 'mm-confirm', function () {
    if (!cur || cur.locked || !cur.multi.length) return;
    judge(cur.multi.slice());
  });
  listen(document.body, 'mm-next', function () { if (cur && cur.locked && !cur.finished) next(); });
  listen(document.body, 'mm-again', function () {
    if (!cur) return;
    // 再来一轮：固定重刷同一来源（开始练习入口保持按配置出题）
    startRound(cur.sourceId, cur.sourceName, cur.kind, cur.level);
  });
  listen(document.body, 'mm-home', function () { cur = null; renderHome(); });
  listen(document.body, 'mm-go-stats', function () { MM.go('#/stats'); });

  /* ---------- 家长配对页（品牌连点 5 次进入）：地址 + 二维码 + 复制 ---------- */

  function backLink() {
    var b = btn('‹ 返回练习', 'mm-exit-pair', null, false);
    b.className = 'back-link';
    return b;
  }

  function pairEnter() {
    var wrap = $('pairWrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(backLink());
    wrap.appendChild(el('h1', 'page-title', '家长管理入口'));
    wrap.appendChild(el('p', 'lead', '手机/电脑连同一个 WiFi，用浏览器打开下面的地址（或扫码），就能管理题库、标签和练习设置。设备端不显示题库内容。'));

    var card = el('div', 'card pair-card');
    card.appendChild(el('div', 'pair-label', '管理地址'));
    var addr = el('div', 'pair-url', '获取中…');
    addr.id = 'mmPairUrl';
    card.appendChild(addr);
    card.appendChild(btn('复制地址', 'mm-copy-addr', null, 'btn btn-sm'));
    var tip = el('div', 'muted', '家长手机相机对准下方二维码即可直达');
    card.appendChild(tip);
    var qrBox = el('div', 'pair-qr');
    qrBox.id = 'mmPairQr';
    card.appendChild(qrBox);
    wrap.appendChild(card);

    listen(wrap, 'mm-exit-pair', function () { MM.go('#/practice'); });
    listen(wrap, 'mm-copy-addr', function () {
      var text = ($('mmPairUrl') || {}).textContent || '';
      if (text.indexOf('http') !== 0) { MM.toast('地址还没获取到'); return; }
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
      MM.toast(ok ? '已复制：' + text : '复制失败，请照屏幕手动输入');
    });

    MM.request('GET', '/api/hello', null, function (err, data) {
      var target = $('mmPairUrl');
      if (!target) return;
      if (err || !data || !data.ip) {
        target.textContent = '获取失败：请连接 WiFi 后重新打开本页';
        return;
      }
      var url = 'http://' + data.ip + ':' + data.port + '/admin/';
      target.textContent = url;
      var box = $('mmPairQr');
      if (!box) return;
      if (!window.qrcode) { box.textContent = '二维码组件缺失'; return; }
      try {
        var qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 6 });
      } catch (e) {
        box.textContent = '二维码生成失败';
      }
    });
  }

  window.MM_PRACTICE = { enter: enter };
  window.MM_PAIR = { enter: pairEnter };
})();
