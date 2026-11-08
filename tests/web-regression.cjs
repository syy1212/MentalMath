/* 仅测试使用 jsdom 与 acorn，应用运行及 APK 构建仍为零第三方依赖。
   npm install --prefix /tmp/mentalmath-web-tests --no-audit --no-fund jsdom@26 acorn@8
   NODE_PATH=/tmp/mentalmath-web-tests/node_modules node --test tests/web-regression.cjs */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { JSDOM } = require('jsdom');
const acorn = require('acorn');
const web = resolve(__dirname, '../app/web');
const source = name => readFileSync(resolve(web, 'assets/js', name + '.js'), 'utf8');
const state = () => ({ config: { roundSize: 10, levels: [1, 2, 3, 4], theme: 'light', autoSyncHours: 24 }, banks: [], today: { answered: 0 }, version: 'test' });
const question = (id = 'q1') => ({ id, q: '7 + 8 = ?', a: ['15', '14', '16', '17'], k: 0, type: 'single', bankId: 'test', level: '二年级', difficulty: 2 });
async function settle() { for (let i = 0; i < 5; i++) await new Promise(setImmediate); }
function setup(t, admin = false, respond) {
  const dom = new JSDOM(readFileSync(resolve(web, admin ? 'admin.html' : 'index.html'), 'utf8'), { url: 'http://mental.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.scrollTo = () => {};
  w.confirm = () => true;
  const calls = [];
  let config = state().config;
  function defaults(method, url, body) {
    if (url === '/api/state') return { ...state(), config };
    if (url === '/api/config') { config = { ...config, ...body }; return { config }; }
    if (url === '/api/hello') return { ip: '127.0.0.1', port: 8098 };
    if (url === '/api/questions/facets') return { levels: ['二年级'], subjects: [] };
    if (url.startsWith('/api/questions?')) return { items: [question()], total: 1 };
    if (url === '/api/questions/tag') return { updated: 1 };
    if (url.startsWith('/api/stats')) return { totals: { answered: 0 } };
    if (url === '/api/practice/round') return { sourceId: 'generator:1', sourceName: '20 以内加减', items: [question()] };
    if (url === '/api/practice/finish') return { ok: true };
    throw new Error('未实现的测试接口：' + method + ' ' + url);
  }
  class XHR {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(raw) {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: this.method, url: this.url, body });
      setImmediate(() => {
        const data = respond ? respond(this.method, this.url, body, defaults) : defaults(this.method, this.url, body);
        this.status = 200; this.readyState = 4; this.responseText = JSON.stringify(data);
        this.onreadystatechange();
      });
    }
  }
  w.XMLHttpRequest = XHR;
  w.eval(source('app'));
  if (!admin) w.eval(source('practice'));
  w.eval(source('manage'));
  return { w, d: w.document, calls, boot: () => admin ? w.MM_ADMIN.boot() : w.MM.boot() };
}

test('所有生产脚本保持 ES5 语法', () => {
  for (const name of ['app', 'practice', 'manage']) acorn.parse(source(name), { ecmaVersion: 5 });
});

test('HTTP 200 中的业务错误会报告失败', async t => {
  const { w } = setup(t, false, () => ({ error: 'bad_request', message: '题库已停用' }));
  let error;
  w.MM.request('GET', '/test', null, err => { error = err; });
  await settle();
  assert.equal(error, '题库已停用');
});

test('网络错误与超时回调只完成一次', t => {
  const { w } = setup(t);
  let xhr;
  w.XMLHttpRequest = function () { xhr = this; this.open = this.send = () => {}; };
  const errors = [];
  w.MM.request('GET', '/test', null, err => errors.push(err));
  xhr.readyState = 4; xhr.status = 0; xhr.onreadystatechange();
  xhr.ontimeout(); xhr.onerror();
  assert.deepEqual(errors, ['请求超时，请重试']);
});

test('开始按钮防止重复请求，答题进度与结算正确', async t => {
  const { w, d, calls, boot } = setup(t);
  boot(); await settle();
  const start = d.querySelector('[data-action="mm-start"]');
  start.click(); start.click();
  assert.equal(calls.filter(c => c.url === '/api/practice/round').length, 1);
  await settle();
  d.querySelector('.opt').click();
  assert.equal(d.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '1');
  assert.equal(d.querySelector('.q-progress-fill').style.width, '100%');
  assert.match(d.getElementById('mmQuestionHead').textContent, /已答对 1/);
  assert.match(d.querySelector('.opt.right').textContent, /✓/);
  d.querySelector('[data-action="mm-next"]').click();
  await settle();
  assert.equal(calls.filter(c => c.url === '/api/practice/finish').length, 1);
  assert.match(d.getElementById('mmSaveStatus').textContent, /已保存/);
  assert.equal(JSON.parse(w.localStorage.getItem('mm_best')).questions, 1);
});

test('多选确认随选择状态启用，判分后不能重复操作', async t => {
  const { d, boot } = setup(t, false, (method, url, body, defaults) => url === '/api/practice/round'
    ? { sourceId: 'test', sourceName: '多选测试', items: [{ ...question(), type: 'multiple', correctIndices: [0, 2] }] }
    : defaults(method, url, body));
  boot(); await settle(); d.querySelector('[data-action="mm-start"]').click(); await settle();
  const confirm = d.querySelector('[data-action="mm-confirm"]');
  assert.equal(confirm.disabled, true);
  const opts = d.querySelectorAll('.opt');
  opts[0].click(); assert.equal(confirm.disabled, false); assert.equal(opts[0].getAttribute('aria-pressed'), 'true');
  opts[0].click(); assert.equal(confirm.disabled, true);
  opts[0].click(); opts[2].click(); confirm.click();
  assert.match(d.getElementById('mmFeedback').textContent, /答对啦/);
  assert.equal(d.querySelectorAll('.opt.right').length, 2);
  assert.ok([...opts].every(o => o.disabled));
});

test('成绩保存失败会显示错误', async t => {
  const { d, boot } = setup(t, false, (method, url, body, defaults) => url === '/api/practice/finish'
    ? { error: 'server_error', message: '存储失败' } : defaults(method, url, body));
  boot(); await settle(); d.querySelector('[data-action="mm-start"]').click(); await settle();
  d.querySelector('.opt').click(); d.querySelector('[data-action="mm-next"]').click(); await settle();
  assert.match(d.getElementById('mmSaveStatus').textContent, /保存失败：存储失败/);
});

test('反复切换管理页后保存仅发一个请求并停留设置页', async t => {
  const { d, calls, boot } = setup(t, true);
  boot(); await settle();
  for (let i = 0; i < 3; i++) {
    d.querySelector('[data-tab="settings"]').click(); await settle();
    d.querySelector('[data-tab="banks"]').click(); await settle();
  }
  d.querySelector('[data-tab="settings"]').click(); await settle();
  d.querySelector('[data-action="mm-round"][data-value="20"]').click(); await settle();
  assert.equal(calls.filter(c => c.url === '/api/config').length, 1);
  assert.equal(d.querySelector('.screen.active').id, 'screen-settings');
  assert.equal(d.querySelector('#settingsWrap .seg .on').textContent, '20 题');
  assert.equal(d.querySelector('#mmLanUrl').textContent, '局域网管理地址：http://127.0.0.1:8098/admin/');
});

test('题目编辑、取消和清除年级正常工作', async t => {
  const { d, calls, boot } = setup(t, true);
  boot(); await settle();
  assert.ok([...d.querySelector('[aria-label="筛选年级"]').options].some(o => o.value === '二年级'));
  d.querySelector('[data-action="mm-edit"]').click();
  assert.ok(d.querySelector('.q-edit'));
  d.querySelector('[data-action="mm-cancel-edit"]').click();
  assert.equal(d.querySelector('.q-edit'), null);
  d.querySelector('[data-action="mm-edit"]').click();
  d.querySelector('.qedit-level').value = '';
  d.querySelector('[data-action="mm-save-tag"]').click(); await settle();
  assert.equal(calls.find(c => c.url === '/api/questions/tag').body.setLevel, '');
  assert.equal(d.querySelectorAll('.q-row').length, 1);
  d.querySelector('[aria-label="批量设置年级"]').value = '__clear__';
  d.querySelector('[data-action="mm-batch-tag"]').click(); await settle();
  assert.equal(calls.filter(c => c.url === '/api/questions/tag').length, 2);
});

test('分页不重复题目、翻页按钮和点击处理器', async t => {
  const { d, calls, boot } = setup(t, true, (method, url, body, defaults) => {
    if (url.startsWith('/api/questions?')) {
      const offset = Number(new URL(url, 'http://test').searchParams.get('offset'));
      return { items: Array.from({ length: 50 }, (_, i) => question('q' + (offset + i))), total: 150 };
    }
    return defaults(method, url, body);
  });
  boot(); await settle();
  const more = d.querySelector('[data-action="mm-more"]');
  more.click(); more.click(); await settle();
  assert.equal(calls.filter(c => c.url.startsWith('/api/questions?')).length, 2);
  assert.equal(d.querySelectorAll('.q-row').length, 100);
  assert.equal(d.querySelectorAll('[data-action="mm-more"]').length, 1);
  d.querySelector('[data-action="mm-edit"]').click();
  d.querySelector('[data-action="mm-cancel-edit"]').click();
  assert.equal(d.querySelectorAll('.q-row').length, 100);
});

test('完成整轮保存珍珠，重复回首页不会重复奖励', async t => {
  const { w, d, boot } = setup(t);
  boot(); await settle();
  d.querySelector('[data-action="mm-start"]').click(); await settle();
  d.querySelector('.opt').click();
  assert.equal(w.localStorage.getItem('mm_best'), null);
  d.querySelector('[data-action="mm-next"]').click(); await settle();
  let best = JSON.parse(w.localStorage.getItem('mm_best'));
  assert.equal(best.pearls, 3);
  assert.equal(best.perfectRounds, 1);
  assert.match(d.querySelector('.round-reward').textContent, /出发的小勇士/);
  assert.match(d.querySelector('.round-reward').textContent, /满分小船长/);
  w.MM_PRACTICE.enter(); w.MM_PRACTICE.enter();
  best = JSON.parse(w.localStorage.getItem('mm_best'));
  assert.equal(best.pearls, 3);
  assert.equal(d.querySelectorAll('.badge-card.earned').length, 2);
});

test('连续答对可解锁勋章和海岛，勋章只提示首次获得', async t => {
  const { w, d, boot } = setup(t, false, (method, url, body, defaults) => url === '/api/practice/round'
    ? { sourceId: 'test', sourceName: '测试', items: Array.from({ length: 5 }, (_, i) => question('q' + i)) }
    : defaults(method, url, body));
  boot(); await settle();
  for (let round = 0; round < 2; round++) {
    d.querySelector('[data-action="mm-start"]').click(); await settle();
    for (let i = 0; i < 5; i++) {
      d.querySelector('.opt').click();
      if (i === 4) assert.match(d.getElementById('mmBuddySpeech').textContent, /连续答对 5 题/);
      d.querySelector('[data-action="mm-next"]').click();
    }
    await settle();
    const reward = d.querySelector('.round-reward').textContent;
    if (round === 0) assert.match(reward, /连对小能手/);
    else { assert.match(reward, /新发现：泡泡岛/); assert.doesNotMatch(reward, /获得勋章/); }
    w.MM_PRACTICE.enter();
  }
  assert.equal(JSON.parse(w.localStorage.getItem('mm_best')).pearls, 14);
  assert.match(d.querySelector('.island-stop.current').textContent, /泡泡岛/);
  assert.equal(d.querySelectorAll('.badge-card.earned').length, 3);
});

test('答错不扣已有珍珠，整轮完成仍有奖励', async t => {
  const { w, d, boot } = setup(t);
  w.localStorage.setItem('mm_best', JSON.stringify({ pearls: 10, rounds: 1, questions: 10, streak: 1 }));
  boot(); await settle(); d.querySelector('[data-action="mm-start"]').click(); await settle();
  d.querySelectorAll('.opt')[1].click();
  assert.match(d.getElementById('mmBuddySpeech').textContent, /也是进步/);
  d.querySelector('[data-action="mm-next"]').click(); await settle();
  assert.equal(JSON.parse(w.localStorage.getItem('mm_best')).pearls, 12);
  assert.match(d.querySelector('.round-reward').textContent, /完成整轮 \+2/);
});

test('中途退出不发整轮奖励，也不改旧记录', async t => {
  const { w, d, boot } = setup(t, false, (method, url, body, defaults) => url === '/api/practice/round'
    ? { sourceId: 'test', sourceName: '测试', items: [question(), question('q2')] }
    : defaults(method, url, body));
  boot(); await settle(); d.querySelector('[data-action="mm-start"]').click(); await settle();
  d.querySelector('.opt').click(); d.querySelector('[data-action="mm-exit"]').click();
  assert.equal(w.localStorage.getItem('mm_best'), null);
  assert.equal(d.querySelector('.pearl-count').textContent, '0 颗珍珠');
});

test('旧版练习记录可以继续使用，并保留原有成绩', async t => {
  const { w, d, boot } = setup(t);
  w.localStorage.setItem('mm_best', JSON.stringify({ streak: 8, avg: 2.5, questions: 60, rounds: 6 }));
  boot(); await settle();
  assert.equal(d.querySelector('.pearl-count').textContent, '0 颗珍珠');
  assert.equal(d.querySelectorAll('.badge-card.earned').length, 3);
  d.querySelector('[data-action="mm-start"]').click(); await settle();
  d.querySelector('.opt').click(); d.querySelector('[data-action="mm-next"]').click(); await settle();
  const best = JSON.parse(w.localStorage.getItem('mm_best'));
  assert.equal(best.streak, 8); assert.equal(best.rounds, 7); assert.equal(best.questions, 61); assert.equal(best.pearls, 3);
});

test('达到每日两轮目标后，主要操作提供休息入口', async t => {
  const { d, boot } = setup(t, false, (method, url, body, defaults) => {
    const data = defaults(method, url, body);
    if (url === '/api/state') data.today.rounds = 1;
    return data;
  });
  boot(); await settle(); d.querySelector('[data-action="mm-start"]').click(); await settle();
  d.querySelector('.opt').click(); d.querySelector('[data-action="mm-next"]').click(); await settle();
  assert.match(d.querySelector('.rest-note').textContent, /休息/);
  assert.equal(d.querySelector('.q-actions .btn-primary').getAttribute('data-action'), 'mm-home');
});

test('成长记录保存失败会明确提示奖励未保存', async t => {
  const { w, d, boot } = setup(t);
  const save = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (key, value) {
    if (key === 'mm_best') throw new Error('存储空间不足');
    return save.call(this, key, value);
  };
  boot(); await settle(); d.querySelector('[data-action="mm-start"]').click(); await settle();
  d.querySelector('.opt').click(); d.querySelector('[data-action="mm-next"]').click(); await settle();
  assert.match(d.querySelector('.growth-error').textContent, /珍珠和勋章未保存/);
});
