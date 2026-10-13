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
 */
function sessionList(ids) {
  return {
    getSnapshot: () => ({ phase: 'ready', ids }),
    subscribe: () => () => {},
  };
}

/**
 * 用真实动态客户端包的 ctx 形态装载插件客户端：`ctx.sessions` 是已声明的
 * 服务，未声明的服务只能通过 `ctx.get(name)` 取。
 * @returns 装载结果（插件、ctx、沙箱窗口与请求记录）。
 */
async function loadClient({ sessions, services = {}, consoleSeat, visibility = 'visible' } = {}) {
  const source = await readFile(SOURCE_URL, 'utf8');
  let plugin;
  const timers = [];
  const window = {
    focusCalls: 0,
    focus() { this.focusCalls += 1; },
    __ModuleLoader__: {
      load(record) { plugin = record.factory(); },
    },
  };
  const context = {
    window,
    document: { visibilityState: visibility },
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
  return { plugin, ctx, context, window, timers };
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
  assert.equal(requests.filter(([url]) => String(url).includes('clientId=')).length >= 1, true);
  const claim = requests.find(([url]) => String(url).split('?')[0].endsWith('/commands/claim'));
  assert.equal(JSON.parse(claim[1].body).visible, true);
  assert.equal(requests.filter(([url]) => url.endsWith('/commands/ack')).length, 1);
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
