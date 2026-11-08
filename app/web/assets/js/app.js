/* 口算天天练 · 应用骨架：hash 路由、请求封装、主题、toast。
   ES5 语法，兼容老 WebView。全局命名空间 window.MM。
   设备端只加载练习页（index.html）；家长管理页是 /admin/（admin.html，见 manage.js 的 MM_ADMIN）。 */
(function () {
  'use strict';

  var LEVEL_BADGES = ['一', '二', '三', '四'];
  var KIND_NAMES = { 'built-in': '内置', 'file': '文件', 'url': 'URL', 'device': '设备' };

  function $(id) { return document.getElementById(id); }

  function request(method, path, body, cb) {
    var completed = false;
    function done(err, data) {
      if (completed) return;
      completed = true;
      cb(err, data);
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.timeout = 15000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || xhr.status === 0) return;
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300 && data && !data.error) done(null, data);
        else done((data && (data.message || data.error)) || ('请求失败 ' + xhr.status), data);
      };
      xhr.onerror = function () { done('连接中断，请重试'); };
      xhr.ontimeout = function () { done('请求超时，请重试'); };
      xhr.open(method, path, true);
      if (body !== undefined && body !== null) {
        xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        xhr.send(JSON.stringify(body));
      } else {
        xhr.send();
      }
    } catch (e) {
      done(String(e));
    }
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2600);
  }

  function fmtSeconds(value) {
    var s = Math.round(value * 10) / 10;
    return (s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)) + ' 秒';
  }

  function fmtTime(ts) {
    if (!ts) return '从未同步';
    var d = new Date(ts);
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (sameDay) return '今天 ' + hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 主题 ---------- */

  function systemDark() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch (e) { return false; }
  }

  function applyTheme(mode) {
    var effective = mode === 'dark' || (mode === 'system' && systemDark()) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-mode', effective);
    try { localStorage.setItem('mm_mode', effective); } catch (e) {}
  }

  /* ---------- 全局状态 ---------- */

  var state = {
    config: null,
    banks: [],
    today: null,
    version: ''
  };

  function loadState(cb) {
    request('GET', '/api/state', null, function (err, data) {
      if (!err) {
        state.config = data.config;
        state.banks = data.banks || [];
        state.today = data.today;
        state.version = data.version || '';
        if (data.config) applyTheme(data.config.theme || 'system');
      }
      if (cb) cb(err, data);
    });
  }

  function renderToday() {
    var pill = $('todayPill');
    if (!pill || !state.today) return;
    pill.textContent = state.today.answered > 0
      ? '今日 ' + state.today.answered + ' 题 · 正确率 ' + state.today.accuracy + '%'
      : '今日未开始';
  }

  function refreshState() {
    loadState(function (err) {
      renderToday();
      if (err) return;
      // 只轻量刷新题库列表（绝不能整屏重绘：练习轮进行中会抹掉判分反馈，题库页会清掉正在输入的表单）
      if ($('mmBankList') && window.MM_BANKS && MM_BANKS.refreshList) MM_BANKS.refreshList();
    });
  }

  /* ---------- 设备端路由（练习 / 记录 / 家长配对） ---------- */

  var SCREENS = ['practice', 'stats', 'pair', 'banks', 'settings'];

  function show(name) {
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $('screen-' + SCREENS[i]);
      if (el) el.className = 'screen' + (SCREENS[i] === name ? ' active' : '');
    }
    window.scrollTo(0, 0);
  }

  function route(force) {
    var hash = location.hash || '#/practice';
    if (hash.indexOf('#/') !== 0) hash = '#/practice';
    var name = hash.substring(2).split('?')[0];
    // 设备端白名单：练习 / 记录 / 配对；题库/设置只存在于 /admin/ 管理页
    if (name !== 'stats' && name !== 'pair') name = 'practice';
    show(name);
    if (name === 'practice') MM_PRACTICE.enter(force);
    else if (name === 'stats') MM_STATS.enter(force);
    else if (name === 'pair') MM_PAIR.enter(force);
  }

  function go(hash) {
    if (location.hash === hash) route(true);
    else location.hash = hash;
  }

  /* ---------- 启动（设备端 index.html 用；管理页用 MM_ADMIN.boot） ---------- */

  var bootListening = false;
  function boot() {
    if (!bootListening) {
      window.addEventListener('hashchange', function () { route(false); });
      bindPairGesture();
      bootListening = true;
    }
    loadState(function (err) {
      if (err) {
        toast('无法连接本地服务：' + err);
        show('practice');
        $('practiceHome').innerHTML = '<div class="card empty"><h1>暂时连不上本地服务</h1><p>请确认应用已正常启动，再试一次。</p><button class="btn btn-primary" id="mmRetry">重新连接</button></div>';
        $('mmRetry').onclick = boot;
        return;
      }
      renderToday();
      route(false);
      // 60 秒轻轮询：顶栏今日数据保持新鲜
      setInterval(refreshState, 60000);
    });
  }

  /* 家长入口手势：连点品牌 5 次（1.5 秒内）进入配对页；管理页不需要 */
  function bindPairGesture() {
    if (MM.ADMIN_MODE) return;
    var brand = $('brand');
    if (!brand) return;
    var taps = 0;
    var timer = null;
    brand.addEventListener('click', function () {
      taps++;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { taps = 0; }, 1500);
      if (taps >= 5) {
        taps = 0;
        go('#/pair');
      }
    });
  }

  window.MM = {
    $: $,
    request: request,
    toast: toast,
    go: go,
    route: route,
    boot: boot,
    state: state,
    loadState: loadState,
    refreshState: refreshState,
    renderToday: renderToday,
    applyTheme: applyTheme,
    fmtSeconds: fmtSeconds,
    fmtTime: fmtTime,
    escapeHtml: escapeHtml,
    LEVEL_BADGES: LEVEL_BADGES,
    KIND_NAMES: KIND_NAMES,
    ADMIN_MODE: false
  };
})();
