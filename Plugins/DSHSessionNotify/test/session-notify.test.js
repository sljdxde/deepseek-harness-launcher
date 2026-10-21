import assert from 'node:assert/strict';
import test from 'node:test';
import { name, apply, summarizeTurnEnd, summarizeTurnStart, sessionLabelFromId, createPresenceTracker, PRESENCE_TTL_MS } from '../lib/index.js';

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
  const call = async (path, { method = 'GET', url = path, body: requestBody = undefined } = {}) => {
    const handler = routes.get(path);
    assert.ok(handler, `route ${path} registered`);
    let status = 0; let headers = null; let responseBody = null;
    const res = {
      writeHead: (code, head) => { status = code; headers = head; },
      end: payload => { responseBody = payload ?? ''; },
    };
    const request = { method, url };
    if (requestBody !== undefined) {
      request[Symbol.asyncIterator] = async function* () { yield Buffer.from(requestBody); };
    }
    await handler(request, res);
    return { status, headers, body: responseBody, json: () => JSON.parse(responseBody) };
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

test('被打断（aborted）的回合不算完成', () => {
  // 用户插话 / 排队消息 / 按停止都会让回合以 aborted 收尾，而会话往往立刻继续跑。
  assert.equal(summarizeTurnEnd(makeSession({ title: 'x' }), { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }), null);
  assert.equal(summarizeTurnEnd(makeSession({ title: 'x' }), { type: 'turn/end', data: { reason: { kind: 'aborted' } } }), null);
  // 真收尾仍然记录。
  assert.equal(summarizeTurnEnd(makeSession({ title: 'x' }), turnEnd('completed')).reason, 'completed');
  assert.equal(summarizeTurnEnd(makeSession({ title: 'x' }), turnEnd('error')).reason, 'error');
});

test('新一轮开始记为 resumed，用来撤销该会话的未读完成提醒', () => {
  const resumed = summarizeTurnStart(makeSession({ id: 'session-1335d7ff', title: '排队消息' }), { type: 'turn/start', data: { turn: 2 } });
  assert.deepEqual({ sessionId: resumed.sessionId, title: resumed.title, kind: resumed.kind }, {
    sessionId: 'session-1335d7ff', title: '排队消息', kind: 'resumed',
  });
  // 子会话与无关事件都不记。
  assert.equal(summarizeTurnStart(makeSession({ origin: 'subagent' }), { type: 'turn/start', data: {} }), null);
  assert.equal(summarizeTurnStart(makeSession(), { type: 'turn/end', data: {} }), null);

  const harness = makeHarness();
  apply(harness.ctx);
  harness.emit('session/event', makeSession({ id: 'session-aaaa', title: '长任务' }), turnEnd('completed'));
  harness.emit('session/event', makeSession({ id: 'session-aaaa', title: '长任务' }), { type: 'turn/start', data: { turn: 2 } });
  return harness.call('/dsh-session-notify/events').then(response => {
    assert.deepEqual(response.json().items.map(item => [item.seq, item.kind]), [[1, 'completion'], [2, 'resumed']]);
  });
});

test('summarizeTurnEnd 标题回退到会话 ID 前缀', () => {
  assert.equal(summarizeTurnEnd(makeSession({ id: 'abcdef123456' }), turnEnd()).title, 'abcdef12');
  assert.equal(summarizeTurnEnd(makeSession({ id: '' }), turnEnd()), null);
});

test('标题从 snapshotEvents() 读取，回退时剥掉 session-/sess- 前缀', () => {
  // 宿主会话的真实接口是 snapshotEvents()；标题是异步生成的，早一轮拿不到就回退。
  const titled = {
    header: { id: 'session-1335d7ff-aaaa' },
    snapshotEvents: () => [{ type: 'session/title', data: { title: '重构启动器' } }],
  };
  assert.equal(summarizeTurnEnd(titled, turnEnd()).title, '重构启动器');

  // 回退不能切成清一色的 "session-"（所有会话都会变成同一个标签）。
  assert.equal(sessionLabelFromId('session-1335d7ff-aaaa-bbbb'), '1335d7ff');
  assert.equal(sessionLabelFromId('sess-1234-abcd'), '1234-abc');
  assert.equal(sessionLabelFromId('abcdef123456'), 'abcdef12');
  assert.equal(sessionLabelFromId(''), '(未命名会话)');
  assert.equal(sessionLabelFromId(undefined), '(未命名会话)');

  // 只有 events 数组的老形态仍然可用。
  const legacy = { header: { id: 'session-9999' }, events: [{ type: 'session/title', data: { title: '旧形态标题' } }] };
  assert.equal(summarizeTurnEnd(legacy, turnEnd()).title, '旧形态标题');
  // snapshotEvents() 抛错时也不能把 completion 记录整个丢掉。
  const broken = { header: { id: 'session-7777' }, snapshotEvents: () => { throw new Error('no log'); } };
  assert.equal(summarizeTurnEnd(broken, turnEnd()).title, '7777');
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

test('open 命令可被浏览器 client 领取并确认，且同一会话去重', async () => {
  const harness = makeHarness();
  apply(harness.ctx);

  const first = await harness.call('/dsh-session-notify/open', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'root-1' }),
  });
  assert.equal(first.status, 200);
  const command = first.json().command;
  assert.equal(command.sessionId, 'root-1');
  assert.equal(typeof command.commandId, 'string');
  // Hidden Chromium tabs can be timer-throttled, so the client gets several
  // minutes rather than one polling interval to claim this command.
  assert.equal(command.expiresAt - command.createdAt, 5 * 60 * 1000);

  const duplicate = await harness.call('/dsh-session-notify/open', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'root-1' }),
  });
  assert.equal(duplicate.json().command.commandId, command.commandId);

  const listed = await harness.call('/dsh-session-notify/commands');
  assert.deepEqual(listed.json().items.map(item => item.commandId), [command.commandId]);

  const deferred = await harness.call('/dsh-session-notify/commands/claim', {
    method: 'POST',
    body: JSON.stringify({ commandId: command.commandId, clientId: 'background-browser', visible: false }),
  });
  assert.equal(deferred.status, 409);
  assert.match(deferred.json().error, /visible Harness tab/);

  const claimed = await harness.call('/dsh-session-notify/commands/claim', {
    method: 'POST',
    body: JSON.stringify({ commandId: command.commandId, clientId: 'browser-a', visible: true }),
  });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.json().command.sessionId, 'root-1');

  const busy = await harness.call('/dsh-session-notify/commands/claim', {
    method: 'POST',
    body: JSON.stringify({ commandId: command.commandId, clientId: 'browser-b', visible: true }),
  });
  assert.equal(busy.status, 409);

  const wrongAck = await harness.call('/dsh-session-notify/commands/ack', {
    method: 'POST',
    body: JSON.stringify({ commandId: command.commandId, clientId: 'browser-b' }),
  });
  assert.equal(wrongAck.status, 409);

  const ack = await harness.call('/dsh-session-notify/commands/ack', {
    method: 'POST',
    body: JSON.stringify({ commandId: command.commandId, clientId: 'browser-a' }),
  });
  assert.equal(ack.status, 200);
  assert.deepEqual((await harness.call('/dsh-session-notify/commands')).json().items, []);
});

test('命令路由拒绝缺失 sessionId 和非 POST 请求', async () => {
  const harness = makeHarness();
  apply(harness.ctx);
  assert.equal((await harness.call('/dsh-session-notify/open', { method: 'GET' })).status, 405);
  const invalid = await harness.call('/dsh-session-notify/open', { method: 'POST', body: '{}' });
  assert.equal(invalid.status, 400);
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

test('presence 追踪器：touch 生效、bye 即时离场、超时自动过期', () => {
  const tracker = createPresenceTracker(90_000);
  assert.equal(tracker.active(0), false);

  tracker.touch('page-a', 0);
  assert.equal(tracker.active(89_999), true);
  assert.equal(tracker.clients(89_999), 1);
  assert.equal(tracker.active(90_001), false);

  tracker.touch('page-a', 0);
  tracker.touch('page-b', 0);
  tracker.bye('page-a');
  assert.equal(tracker.clients(0), 1);
  tracker.bye('page-b');
  assert.equal(tracker.active(0), false);

  // 空/缺失 clientId 不产生心跳。
  tracker.touch('', 0);
  tracker.touch(undefined, 0);
  assert.equal(tracker.active(0), false);
  // TTL 必须高于后台标签页的定时器节流周期（隐藏标签页最低约 1 次/分钟）。
  assert.ok(PRESENCE_TTL_MS > 60_000);
});

test('commands 轮询即心跳，presence/bye 即离场（启动器判定依赖）', async () => {
  const harness = makeHarness();
  const { call } = harness;
  apply(harness.ctx);

  const presence = async () => (await call('/dsh-session-notify/presence')).json();

  assert.deepEqual((await presence()).active, false);

  // 页面轮询 commands 时带上 clientId → 服务端记为在线。
  await call('/dsh-session-notify/commands', { url: '/dsh-session-notify/commands?clientId=page-1' });
  assert.deepEqual(await presence(), { active: true, clients: 1 });

  await call('/dsh-session-notify/commands', { url: '/dsh-session-notify/commands?clientId=page-2' });
  assert.deepEqual((await presence()).clients, 2);

  // 页面关闭触发 pagehide → sendBeacon bye → 立即离场。
  const bye = await call('/dsh-session-notify/presence/bye', {
    method: 'POST',
    body: JSON.stringify({ clientId: 'page-1' }),
  });
  assert.deepEqual(bye.json(), { ok: true });
  assert.deepEqual((await presence()).clients, 1);

  await call('/dsh-session-notify/presence/bye', { method: 'POST', body: JSON.stringify({ clientId: 'page-2' }) });
  assert.deepEqual((await presence()).active, false);
});

test('presence 路由拒绝非 GET、bye 拒绝非 POST', async () => {
  const harness = makeHarness();
  const { call } = harness;
  apply(harness.ctx);
  assert.equal((await call('/dsh-session-notify/presence', { method: 'POST' })).status, 405);
  assert.equal((await call('/dsh-session-notify/presence/bye', { method: 'GET' })).status, 405);
});

test('presence 追踪器记录「正在看的会话」：切走/离场/超时都清掉', () => {
  const tracker = createPresenceTracker(90_000);
  assert.equal(tracker.watches('page-a'), '');
  tracker.touch('page-a', 0);
  tracker.watch('page-a', 'session-a');
  assert.equal(tracker.watches('page-a'), 'session-a');
  assert.deepEqual([...tracker.viewingNow(0)], ['session-a']);

  // 转到别的会话 / 离开页面（空值）都不再算「在看」。
  tracker.watch('page-a', 'session-b');
  assert.deepEqual([...tracker.viewingNow(0)], ['session-b']);
  tracker.watch('page-a', '');
  assert.equal(tracker.watches('page-a'), '');
  assert.deepEqual([...tracker.viewingNow(0)], []);

  // pagehide（bye）立刻清掉；心跳超时的页面同样不再算「在看」。
  tracker.watch('page-a', 'session-a');
  tracker.bye('page-a');
  assert.deepEqual([...tracker.viewingNow(0)], []);
  tracker.touch('page-b', 0);
  tracker.watch('page-b', 'session-b');
  assert.deepEqual([...tracker.viewingNow(89_999)], ['session-b']);
  assert.deepEqual([...tracker.viewingNow(90_001)], []);

  // 空 clientId 不产生观看记录。
  tracker.watch('', 'session-c');
  tracker.watch(undefined, 'session-c');
  assert.deepEqual([...tracker.viewingNow(0)], []);
});

test('用户正在看的会话：只有它挂着未读完成时才记一条 viewed', async () => {
  const harness = makeHarness();
  const { call } = harness;
  const view = target => call('/dsh-session-notify/commands', {
    url: `/dsh-session-notify/commands?clientId=page-1&viewing=${target}`
  });
  apply(harness.ctx);

  harness.emit('session/event', makeSession({ id: 'session-aaaa', title: '长任务' }), turnEnd('completed'));
  // 第一次看：跟着记一条 viewed（带上可读标题便于排查）。
  await view('session-aaaa');
  // 同一个目标反复上报（轮询 750ms 一次）不得重复记。
  await view('session-aaaa');
  let items = (await call('/dsh-session-notify/events')).json().items;
  assert.deepEqual(items.map(item => [item.seq, item.kind, item.sessionId]), [
    [1, 'completion', 'session-aaaa'],
    [2, 'viewed', 'session-aaaa'],
  ]);
  assert.equal(items[1].title, '长任务');

  // 切到没有未读完成的会话、再回到已经读过的会话：都不记——否则用户来回切会话会把
  // 50 条缓冲区占满，真正的完成提醒反而被挤出去。
  await view('session-bbbb');
  await view('session-aaaa');
  items = (await call('/dsh-session-notify/events')).json().items;
  assert.deepEqual(items.map(item => item.kind), ['completion', 'viewed']);

  // 另一个会话完成一轮 → 它重新挂上未读 → 此时看它才需要再记一条。
  harness.emit('session/event', makeSession({ id: 'session-bbbb', title: '后台任务' }), turnEnd('completed'));
  await view('session-aaaa');
  await view('session-bbbb');
  items = (await call('/dsh-session-notify/events')).json().items;
  assert.deepEqual(items.map(item => [item.kind, item.sessionId]), [
    ['completion', 'session-aaaa'],
    ['viewed', 'session-aaaa'],
    ['completion', 'session-bbbb'],
    ['viewed', 'session-bbbb'],
  ]);

  // 离开页面（viewing 缺失/为空＝没在看任何会话）不记事件。
  await view('');
  await call('/dsh-session-notify/commands', { url: '/dsh-session-notify/commands?clientId=page-1' });
  assert.equal((await call('/dsh-session-notify/events')).json().items.length, 4);
});

test('会话正在用户眼前收尾：completion 后紧跟一条 viewed，角标不该亮', async () => {
  const harness = makeHarness();
  const { call } = harness;
  apply(harness.ctx);

  // 先建立「正在看 session-live」；它还没有完成，所以这一步不记任何事件。
  await call('/dsh-session-notify/commands', { url: '/dsh-session-notify/commands?clientId=page-1&viewing=session-live' });
  harness.emit('session/event', makeSession({ id: 'session-live', title: '看着的长任务' }), turnEnd('completed'));
  const items = (await call('/dsh-session-notify/events')).json().items;
  assert.deepEqual(items.map(item => [item.kind, item.sessionId]), [
    ['completion', 'session-live'],
    ['viewed', 'session-live'],
  ]);

  // 没在看的会话收尾 → 只有 completion（角标该亮）。
  harness.emit('session/event', makeSession({ id: 'session-away', title: '后台任务' }), turnEnd('completed'));
  const after = (await call('/dsh-session-notify/events')).json().items;
  assert.deepEqual(after.slice(-1).map(item => [item.kind, item.sessionId]), [['completion', 'session-away']]);
});

test('health 探针：注册在 webServer effect 里、零依赖、dispose 后消失', async () => {
  const harness = makeHarness();
  apply(harness.ctx);
  // 启动器只凭这条路由判「插件是否随 dsh 加载」，它必须存在且不触碰任何会话状态。
  const response = await harness.call('/dsh-session-notify/health');
  assert.equal(response.status, 200);
  assert.equal(response.json().ok, true);
  assert.equal(typeof response.json().bootId, 'string');
  harness.dispose();
  assert.equal(harness.hasRoute('/dsh-session-notify/health'), false);
});
