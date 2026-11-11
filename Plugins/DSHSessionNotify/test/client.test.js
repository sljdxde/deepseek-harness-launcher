import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE_URL = new URL('../client/client.js', import.meta.url);

/**
 * 会话跳转入口在 Workspace controller 服务 `uiWorkspace.openSession` 上，
 * 与「点侧边栏那一行会话」是同一个动作。Session controller（`ctx.sessions`，
 * ClientSessions）**没有** `open`——旧代码按 `ctx.sessions.open(...)` 调用，
 * 只会抛 TypeError 并被空 catch 吞掉，命令被 ack 而页面停在原会话（就是
 * 「点完成提醒不跳转」那个 bug）。所以这里的替身必须与真实客户端同形：
 * `sessions` 只给 `list`，跳转能力只挂在 `uiWorkspace` 上。
 * @param ids - 目录里可见的会话 id。
 * @param byId - 目录行（`retainedBy.mainView` 决定用户正在看哪一个会话）。
 */
function sessionList(ids, byId = {}) {
  return {
    getSnapshot: () => ({ phase: 'ready', ids, byId }),
    subscribe: () => () => {},
  };
}

/**
 * 用真实动态客户端包的 ctx 形态装载插件客户端：`ctx.sessions` 是已声明的
 * 服务，未声明的服务只能通过 `ctx.get(name)` 取。
 * @returns 装载结果（插件、ctx、沙箱窗口与请求记录）。
 */
async function loadClient({ sessions, services = {}, consoleSeat, visibility = 'visible', focus = true, embedded = true } = {}) {
  const source = await readFile(SOURCE_URL, 'utf8');
  let plugin;
  const timers = [];
  /** document 上的监听器（手势心跳 / visibilitychange），可手动派发。 */
  const documentListeners = new Map();
  const document = {
    visibilityState: visibility,
    hasFocus: () => focus,
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(callback);
    },
    removeEventListener(type, callback) {
      const list = documentListeners.get(type) || [];
      const index = list.indexOf(callback);
      if (index >= 0) list.splice(index, 1);
    },
    /** 派发一个事件；`trusted` 模拟真实用户操作（isTrusted=true）。 */
    dispatch(type, trusted = true) {
      for (const callback of [...(documentListeners.get(type) || [])]) callback({ type, isTrusted: trusted });
    },
  };
  const window = {
    focusCalls: 0,
    focus() { this.focusCalls += 1; },
    __ModuleLoader__: {
      load(record) { plugin = record.factory(); },
    },
  };
  // WKWebView 一定暴露 window.webkit.messageHandlers；Chrome/Chromium 没有。
  if (embedded) window.webkit = { messageHandlers: {} };
  const context = {
    window,
    document,
    navigator: {
      userAgent: embedded
        ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    },
    setInterval(callback) { timers.push(callback); return timers.length; },
    clearInterval() {},
  };
  if (consoleSeat !== undefined) context.console = consoleSeat;
  vm.runInNewContext(source, context);
  assert.ok(plugin, 'client half must register a plugin');
  const ctx = {
    sessions,
    get: name => services[name],
    effect(setup) { this.cleanup = setup(); return this.cleanup; },
  };
  return { plugin, ctx, context, window, document, timers };
}

/** 一条待领取命令的服务端响应；`claimed === false` 模拟 claim 被拒（非 200）。 */
function feedFetch({ commandId, sessionId, requests, claimed = true }) {
  return async (url, options = {}) => {
    requests.push([url, options]);
    const path = String(url).split('?')[0];
    if (path.endsWith('/commands')) {
      return { ok: true, json: async () => ({ items: [{ commandId, sessionId }] }) };
    }
    if (path.endsWith('/commands/claim')) {
      return claimed
        ? { ok: true, json: async () => ({ command: { commandId, sessionId } }) }
        : { ok: false, json: async () => ({ error: 'waiting for visible Harness tab' }) };
    }
    if (path.endsWith('/commands/ack')) return { ok: true, json: async () => ({ ok: true }) };
    return { ok: false, json: async () => ({}) };
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('前台页面领取命令后通过 uiWorkspace 打开目标会话并确认', async () => {
  const opened = [];
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    sessions: { list: sessionList(['target-session']) },
    services: { uiWorkspace: { openSession: sessionId => opened.push(sessionId) } },
  });
  context.fetch = feedFetch({ commandId: 'c1', sessionId: 'target-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  assert.deepEqual(opened, ['target-session']);
  // commands 轮询携带 clientId：服务端以此维护页面存活心跳。
  const commandsPoll = requests.find(([url]) => String(url).includes('/commands?'));
  assert.equal(requests.filter(([url]) => String(url).includes('clientId=')).length >= 1, true);
  // 同时上报标签页可见性：多实例不可达时启动器据此决定「前置浏览器」还是
  // 「在正确实例里新开标签」（看不见的页面只前置 = 点了没反应）。
  assert.match(String(commandsPoll[0]), /visible=1/);
  const claim = requests.find(([url]) => String(url).split('?')[0].endsWith('/commands/claim'));
  assert.equal(JSON.parse(claim[1].body).visible, true);
  // 同时上报焦点：命令入队后的一小段窗口里服务端只让焦点页面领取——
  // 另一个浏览器实例里的 Harness 页面可能也「可见」（窗口在后面），让它
  // 先领走会把会话切在用户看不见的窗口里（浏览器前置了却还是旧会话）。
  assert.equal(JSON.parse(claim[1].body).focused, true);
  assert.equal(requests.filter(([url]) => url.endsWith('/commands/ack')).length, 1);
  ctx.cleanup?.();
});

test('没有焦点的页面 claim 带 focused=false，被拒时不 ack（不抢可见页面的命令）', async () => {
  const opened = [];
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    sessions: { list: sessionList(['target-session']) },
    services: { uiWorkspace: { openSession: sessionId => opened.push(sessionId) } },
    // 另一个浏览器实例里的页面：标签页在它的窗口里是「可见」的，但那个窗口
    // 在后面，没有焦点。服务端在入队窗口内会拒绝它。
    visibility: 'visible',
    focus: false,
  });
  context.fetch = feedFetch({ commandId: 'c4', sessionId: 'target-session', requests, claimed: false });

  plugin.apply(ctx);
  await settle();
  await settle();

  const claim = requests.find(([url]) => String(url).split('?')[0].endsWith('/commands/claim'));
  assert.equal(JSON.parse(claim[1].body).focused, false);
  assert.equal(JSON.parse(claim[1].body).visible, true);
  assert.deepEqual(opened, []);
  assert.equal(requests.filter(([url]) => url.endsWith('/commands/ack')).length, 0);
  ctx.cleanup?.();
});

test('后台 Harness 页面也会打开会话并尝试聚焦自身', async () => {
  const opened = [];
  const requests = [];
  const { plugin, ctx, context, window } = await loadClient({
    sessions: { list: sessionList(['background-session']) },
    services: { uiWorkspace: { openSession: sessionId => opened.push(sessionId) } },
    visibility: 'hidden',
  });
  context.fetch = feedFetch({ commandId: 'c2', sessionId: 'background-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  assert.deepEqual(opened, ['background-session']);
  assert.ok(window.focusCalls >= 1);
  // 后台标签页必须上报 visible=0，否则启动器会误以为「前置浏览器就够」。
  const backgroundPoll = requests.find(([url]) => String(url).includes('/commands?'));
  assert.match(String(backgroundPoll[0]), /visible=0/);
  const claim = requests.find(([url]) => url.endsWith('/commands/claim'));
  assert.equal(JSON.parse(claim[1].body).visible, false);
  ctx.cleanup?.();
});

test('claim 被拒（等待前台标签页）时不 ack，命令留给可见页面', async () => {
  const opened = [];
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    sessions: { list: sessionList(['target-session']) },
    services: { uiWorkspace: { openSession: sessionId => opened.push(sessionId) } },
    visibility: 'hidden',
  });
  context.fetch = feedFetch({ commandId: 'c3', sessionId: 'target-session', requests, claimed: false });

  plugin.apply(ctx);
  await settle();
  await settle();

  assert.deepEqual(opened, []);
  assert.equal(requests.filter(([url]) => url.endsWith('/commands/ack')).length, 0);
  ctx.cleanup?.();
});

test('没有任何跳转入口时留下告警，而不是静默 ack 掉命令', async () => {
  const warnings = [];
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    sessions: { list: sessionList(['orphan-session']) },
    consoleSeat: { warn: (...args) => warnings.push(args) },
  });
  context.fetch = feedFetch({ commandId: 'c5', sessionId: 'orphan-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  // 不能跳转也要 ack：命令留在队列里只会被反复重放，用户什么都看不到。
  assert.equal(requests.filter(([url]) => url.endsWith('/commands/ack')).length, 1);
  assert.equal(warnings.length >= 1, true);
  assert.equal(warnings.some(args => args.join(' ').includes('没有会话跳转入口')), true);
  ctx.cleanup?.();
});

test('沙箱没有 console 时告警不得炸掉轮询', async () => {
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    sessions: { list: sessionList(['no-console-session']) },
  });
  context.fetch = feedFetch({ commandId: 'c6', sessionId: 'no-console-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  assert.equal(requests.filter(([url]) => url.endsWith('/commands/ack')).length, 1);
  ctx.cleanup?.();
});

test('页面把「用户正在看的会话」随轮询上报（看过即已读的数据源）', async () => {
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    sessions: {
      list: sessionList(['view-session'], {
        'view-session': { id: 'view-session', retainedBy: { mainView: 1 } },
        'other-session': { id: 'other-session', retainedBy: {} },
      }),
    },
    services: { uiWorkspace: { openSession: () => {} } },
  });
  context.fetch = feedFetch({ commandId: 'c7', sessionId: 'view-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  // 主视图里 retainedBy.mainView > 0 的那一个就是用户正在看的会话。
  const polls = requests.map(([url]) => String(url)).filter(url => url.includes('/commands?'));
  assert.equal(polls.length >= 1, true);
  assert.match(polls[0], /clientId=[^&]+&viewing=view-session/);
  ctx.cleanup?.();
});

test('页面在后台或没焦点时不上报观看目标（后台标签页不该把会话钉成已读）', async () => {
  const scenarios = [
    { label: '不可见', options: { visibility: 'hidden', focus: true } },
    { label: '没焦点', options: { visibility: 'visible', focus: false } },
  ];
  for (const { label, options } of scenarios) {
    const requests = [];
    const { plugin, ctx, context } = await loadClient({
      sessions: { list: sessionList(['view-session'], { 'view-session': { id: 'view-session', retainedBy: { mainView: 1 } } }) },
      services: { uiWorkspace: { openSession: () => {} } },
      ...options,
    });
    context.fetch = feedFetch({ commandId: 'c8', sessionId: 'view-session', requests });

    plugin.apply(ctx);
    await settle();
    await settle();

    const poll = requests.map(([url]) => String(url)).find(url => url.includes('/commands?')) ?? '';
    assert.match(poll, /viewing=($|&)/, `${label} 时不该上报观看目标`);
    ctx.cleanup?.();
  }
});

test('外部 Chrome 页面没有真实用户操作时不上报观看目标（防自动化标签页把提醒标成已读）', async () => {
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    embedded: false,
    sessions: {
      list: sessionList(['view-session'], {
        'view-session': { id: 'view-session', retainedBy: { mainView: 1 } },
      }),
    },
    services: { uiWorkspace: { openSession: () => {} } },
    visibility: 'visible',
    // 实测 macOS：启动器在最前时，后台 Chrome 的 document.hasFocus() 仍可能
    // 返回 true。只看 hasFocus 会把「后台自动化标签页」当成用户正在看。
    focus: true,
  });
  context.fetch = feedFetch({ commandId: 'c9', sessionId: 'view-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  const poll = requests.map(([url]) => String(url)).find(url => url.includes('/commands?')) ?? '';
  assert.match(poll, /viewing=($|&)/, '非内置浏览器且没有真实用户操作时，不应上报观看目标');
  ctx.cleanup?.();
});

test('外部 Chrome 页面收到真实用户操作后恢复上报观看目标', async () => {
  const requests = [];
  const { plugin, ctx, context, document } = await loadClient({
    embedded: false,
    sessions: {
      list: sessionList(['view-session'], {
        'view-session': { id: 'view-session', retainedBy: { mainView: 1 } },
      }),
    },
    services: { uiWorkspace: { openSession: () => {} } },
  });
  context.fetch = feedFetch({ commandId: 'c10', sessionId: 'view-session', requests });

  plugin.apply(ctx);
  await settle();
  // 真实用户操作后，用 visibilitychange 触发一次立即重报（等价于下一次轮询）。
  document.dispatch('pointerdown', true);
  document.dispatch('visibilitychange');
  await settle();
  await settle();

  const polls = requests.map(([url]) => String(url)).filter(url => url.includes('/commands?'));
  const last = polls[polls.length - 1] ?? '';
  assert.match(last, /viewing=view-session/, '真实用户操作后应恢复上报观看目标');
  ctx.cleanup?.();
});

test('Safari 风格 UA（WKWebView 的实际 UA）没有 window.webkit 也按内置页面处理', async () => {
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    // WKWebView 未注册消息处理器时 window.webkit.messageHandlers 是 undefined，
    // 只剩 UA 可判断；这里模拟真实内置窗口。
    embedded: false,
    sessions: {
      list: sessionList(['view-session'], {
        'view-session': { id: 'view-session', retainedBy: { mainView: 1 } },
      }),
    },
    services: { uiWorkspace: { openSession: () => {} } },
  });
  context.navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  context.fetch = feedFetch({ commandId: 'c11', sessionId: 'view-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  const poll = requests.map(([url]) => String(url)).find(url => url.includes('/commands?')) ?? '';
  assert.match(poll, /viewing=view-session/, '内置 WKWebView 应继续上报观看目标');
  ctx.cleanup?.();
});

test('外部 Chrome 页面没有真实用户操作时不领取跳转命令（命令留给内置窗口）', async () => {
  const opened = [];
  const requests = [];
  const { plugin, ctx, context } = await loadClient({
    embedded: false,
    sessions: { list: sessionList(['target-session']) },
    services: { uiWorkspace: { openSession: sessionId => opened.push(sessionId) } },
    visibility: 'visible',
    // document.hasFocus() 对后台 Chrome 会谎报 true；不能再让它决定领取资格。
    focus: true,
  });
  context.fetch = feedFetch({ commandId: 'c12', sessionId: 'target-session', requests });

  plugin.apply(ctx);
  await settle();
  await settle();

  assert.deepEqual(opened, [], '后台 Chrome 不能把跳转命令执行在看不见的窗口里');
  assert.equal(
    requests.filter(([url]) => String(url).split('?')[0].endsWith('/commands/claim')).length,
    0,
    '没有真实用户操作时不应发起 claim',
  );
  ctx.cleanup?.();
});

test('外部 Chrome 页面收到真实用户操作后才领取跳转命令', async () => {
  const opened = [];
  const requests = [];
  const { plugin, ctx, context, document } = await loadClient({
    embedded: false,
    sessions: { list: sessionList(['target-session']) },
    services: { uiWorkspace: { openSession: sessionId => opened.push(sessionId) } },
  });
  context.fetch = feedFetch({ commandId: 'c13', sessionId: 'target-session', requests });

  plugin.apply(ctx);
  await settle();
  document.dispatch('pointerdown', true);
  document.dispatch('visibilitychange');
  await settle();
  await settle();

  assert.deepEqual(opened, ['target-session'], '用户确实在操作外部 Chrome 时，跳转照常生效');
  ctx.cleanup?.();
});
