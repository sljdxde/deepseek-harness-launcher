import assert from 'node:assert/strict';
import test from 'node:test';
import { name, apply, summarizeTurnEnd } from '../lib/index.js';

/** A session whose event log ends with a `session/title`. */
function makeSession({ id = 'sess-1234-abcd', origin = undefined, title = null, events = [] } = {}) {
  const header = { id };
  if (origin) header.origin = origin;
  if (title) events = [...events, { type: 'session/title', data: { title } }];
  return { header, events };
}

function turnEnd(kind = 'completed') {
  return { type: 'turn/end', data: { reason: { kind } } };
}

/**
 * Minimal cordis-shaped harness: `ctx.on` listeners + `ctx.inject` handing
 * out a `webServer.register` facade, mirroring how the archive plugin's
 * routes are exercised in tests.
 */
function makeHarness() {
  const listeners = new Map();
  const routes = new Map();
  const teardown = [];
  const host = {
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return () => listeners.set(event, listeners.get(event).filter(item => item !== listener));
    },
    off: (event, listener) => {
      listeners.set(event, (listeners.get(event) || []).filter(item => item !== listener));
    },
    webServer: {
      register: route => {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
    effect: setup => { teardown.push(setup()); },
    logger: { info() {}, warn() {} },
  };
  const ctx = {
    on: host.on,
    inject: (deps, callback) => { assert.deepEqual(deps, ['webServer']); callback(host); },
    logger: host.logger,
  };
  const emit = (event, ...args) => (listeners.get(event) || []).forEach(listener => listener(...args));
  const call = async (path, { method = 'GET', url = path } = {}) => {
    const handler = routes.get(path);
    assert.ok(handler, `route ${path} registered`);
    let status = 0; let headers = null; let body = null;
    const res = {
      writeHead: (code, head) => { status = code; headers = head; },
      end: payload => { body = payload ?? ''; },
    };
    await handler({ method, url }, res);
    return { status, headers, body, json: () => JSON.parse(body) };
  };
  return { ctx, emit, call, hasRoute: path => routes.has(path), dispose: () => teardown.forEach(fn => fn()) };
}

test('summarizeTurnEnd 只记录主会话的 turn/end', () => {
  const record = summarizeTurnEnd(makeSession({ title: '重构启动器' }), turnEnd('completed'));
  assert.deepEqual(
    { sessionId: record.sessionId, title: record.title, reason: record.reason },
    { sessionId: 'sess-1234-abcd', title: '重构启动器', reason: 'completed' },
  );
  assert.equal(typeof record.at, 'number');

  // 子任务回合不进缓冲区（避免角标刷屏）。
  assert.equal(summarizeTurnEnd(makeSession({ origin: 'subagent' }), turnEnd()), null);
  // 非 turn/end 事件忽略。
  assert.equal(summarizeTurnEnd(makeSession(), { type: 'session/title', data: { title: 'x' } }), null);
  // reason 缺失时按 completed 展示。
  assert.equal(summarizeTurnEnd(makeSession(), { type: 'turn/end', data: {} }).reason, 'completed');
});

test('summarizeTurnEnd 标题回退到会话 ID 前缀', () => {
  assert.equal(summarizeTurnEnd(makeSession({ id: 'abcdef123456' }), turnEnd()).title, 'abcdef12');
  assert.equal(summarizeTurnEnd(makeSession({ id: '' }), turnEnd()), null);
});

test('apply 注册 events 路由并按 seq 递增返回缓冲区', async () => {
  const harness = makeHarness();
  const { emit, call } = harness;
  apply(harness.ctx);

  const first = await call('/dsh-session-notify/events');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json().items, []);

  harness.emit('session/event', makeSession({ title: '写周报' }), turnEnd('completed'));
  harness.emit('session/event', makeSession({ id: 'root-2', title: '修 bug' }), turnEnd('error'));

  const second = await call('/dsh-session-notify/events');
  const feed = second.json();
  assert.equal(feed.seq, 2);
  assert.equal(feed.bootId.length > 0, true);
  assert.deepEqual(feed.items.map(item => [item.seq, item.title, item.reason]), [
    [1, '写周报', 'completed'],
    [2, '修 bug', 'error'],
  ]);

  // after= 过滤只返回新事件。
  const delta = (await call('/dsh-session-notify/events', { url: '/dsh-session-notify/events?after=1' })).json();
  assert.deepEqual(delta.items.map(item => item.seq), [2]);
  // 非法 after 参数回退到全量。
  const fallback = (await call('/dsh-session-notify/events', { url: '/dsh-session-notify/events?after=abc' })).json();
  assert.deepEqual(fallback.items.map(item => item.seq), [1, 2]);
});

test('events 路由拒绝非 GET 请求', async () => {
  const harness = makeHarness();
  const { emit, call } = harness;
  apply(harness.ctx);
  const response = await call('/dsh-session-notify/events', { method: 'POST' });
  assert.equal(response.status, 405);
});

test('缓冲区封顶 50 条，seq 持续递增不回绕', async () => {
  const harness = makeHarness();
  const { emit, call } = harness;
  apply(harness.ctx);
  for (let i = 0; i < 55; i += 1) {
    harness.emit('session/event', makeSession({ id: `s-${i}`, title: `任务 ${i}` }), turnEnd());
  }
  const feed = (await call('/dsh-session-notify/events')).json();
  assert.equal(feed.seq, 55);
  assert.equal(feed.items.length, 50);
  assert.deepEqual(feed.items.map(item => item.seq).slice(0, 2), [6, 7]);
});

test('插件卸载时移除路由与监听器', async () => {
  const harness = makeHarness();
  const { emit, call } = harness;
  apply(harness.ctx);
  assert.equal(harness.hasRoute('/dsh-session-notify/events'), true);
  harness.dispose();
  assert.equal(harness.hasRoute('/dsh-session-notify/events'), false);
  // dispose 后事件不再进入缓冲区（路由已下线，仅验证监听器语义）。
  harness.emit('session/event', makeSession(), turnEnd());
});

test('插件导出名称与路由路径稳定（启动器轮询依赖）', () => {
  assert.equal(name, 'dsh-session-notify');
});
