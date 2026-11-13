import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE_URL = new URL('../client/client.js', import.meta.url);

/** 极简 DOM：只实现插件用到的那几个成员。 */
class FakeElement {
  constructor(tag = 'span') {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.children = [];
  }

  get firstElementChild() {
    return this.children[0] ?? null;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

/** 一行会话：行首格子 + DSH 的状态点（`state` 为空表示没有点）。 */
function sessionRow(state, extra = {}) {
  const row = new FakeElement('div');
  const cell = row.appendChild(new FakeElement('span'));
  if (state !== undefined) {
    const dot = cell.appendChild(new FakeElement('span'));
    dot.setAttribute('data-state', state);
  }
  row.id = extra.id;
  return { row, cell };
}

/**
 * 装载浏览器半边。
 * @param options - 会话行、宿主状态、时钟等替身。
 */
async function loadClient({ rows = {}, failed = [], clock = 1_000_000 } = {}) {
  const source = await readFile(SOURCE_URL, 'utf8');
  let plugin;
  const timers = [];
  const resetListeners = [];
  const subscribers = new Set();
  const selectors = new Map();
  for (const [sessionId, entry] of Object.entries(rows)) {
    selectors.set(`[data-row-key="session:${sessionId}"]`, entry.row);
  }
  const treeRoot = new FakeElement('div');
  const observers = [];

  const document = {
    querySelector(selector) {
      if (selector === '[role="tree"]') return treeRoot;
      return selectors.get(selector) ?? null;
    },
  };
  const window = {
    __ModuleLoader__: { load(record) { plugin = record.factory(); } },
  };
  const time = { now: clock };
  const context = {
    window,
    document,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    },
    Date: { now: () => time.now },
    setInterval(callback) { timers.push(callback); return timers.length; },
    clearInterval() {},
    async fetch() {
      return { ok: true, json: async () => ({ revision: 1, failed }) };
    },
  };
  vm.runInNewContext(source, context);
  assert.ok(plugin, 'client half must register a plugin');

  let snapshot = { phase: 'ready', ids: [], byId: {} };
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
      },
    },
    on(name, callback) {
      if (name === 'connection/reset') resetListeners.push(callback);
      return () => {};
    },
    effect(setup) { this.cleanup = setup(); return this.cleanup; },
  };

  const api = {
    plugin,
    ctx,
    timers,
    time,
    /** 更新列表快照并通知订阅者（等价于客户端收到会话列表变化）。 */
    update(next) {
      snapshot = { phase: 'ready', ids: Object.keys(next), byId: next };
      for (const callback of subscribers) callback();
    },
    /** 模拟宿主重启后的重连。 */
    reconnect() {
      for (const callback of resetListeners) callback();
    },
    /** 触发一次 1.5s 轮询并等宿主状态落地。 */
    async tick() {
      for (const callback of [...timers]) callback();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    },
    dot(sessionId) {
      return rows[sessionId].cell.firstElementChild;
    },
    /** 触发侧栏会话树的节点变化（React 换了状态点元素）。 */
    mutate() {
      for (const observer of [...observers]) observer.callback([]);
    },
  };
  return api;
}

test('重连窗口内「运行中 → 不运行」的会话：DSH 的绿点被染红', async () => {
  const rows = { s1: sessionRow('done') };
  const client = await loadClient({ rows });
  client.plugin.apply(client.ctx);

  client.update({ s1: { id: 's1', running: true, retainedBy: {} } });
  client.reconnect();
  client.time.now += 1200;
  client.update({ s1: { id: 's1', running: false, retainedBy: {} } });

  const dot = client.dot('s1');
  assert.equal(dot.getAttribute('data-state'), 'error');
  assert.equal(dot.getAttribute('title'), '异常结束：本轮没有正常收尾');
  client.ctx.cleanup?.();
});

test('没有重连的正常收尾不改色（保持绿色完成点）', async () => {
  const rows = { s1: sessionRow('done') };
  const client = await loadClient({ rows });
  client.plugin.apply(client.ctx);

  client.update({ s1: { id: 's1', running: true, retainedBy: {} } });
  client.time.now += 60_000;
  client.update({ s1: { id: 's1', running: false, retainedBy: {} } });

  assert.equal(client.dot('s1').getAttribute('data-state'), 'done');
  client.ctx.cleanup?.();
});

test('重连过去很久才收尾的不算崩溃', async () => {
  const rows = { s1: sessionRow('done') };
  const client = await loadClient({ rows });
  client.plugin.apply(client.ctx);

  client.update({ s1: { id: 's1', running: true, retainedBy: {} } });
  client.reconnect();
  client.time.now += 30_000;
  client.update({ s1: { id: 's1', running: false, retainedBy: {} } });

  assert.equal(client.dot('s1').getAttribute('data-state'), 'done');
  client.ctx.cleanup?.();
});

test('宿主报告的「本轮报错」同样染红，会话重新开跑后恢复', async () => {
  const rows = { s1: sessionRow('done') };
  const client = await loadClient({ rows, failed: ['s1'] });
  client.plugin.apply(client.ctx);

  client.update({ s1: { id: 's1', running: false, retainedBy: {} } });
  await client.tick();
  assert.equal(client.dot('s1').getAttribute('data-state'), 'error');

  client.update({ s1: { id: 's1', running: true, retainedBy: {} } });
  assert.equal(client.dot('s1').getAttribute('data-state'), 'done');
  assert.equal(client.dot('s1').getAttribute('title'), null);
  client.ctx.cleanup?.();
});

test('没有状态点（空闲会话）时不新增任何节点', async () => {
  const rows = { s1: sessionRow(undefined) };
  const client = await loadClient({ rows, failed: ['s1'] });
  client.plugin.apply(client.ctx);

  client.update({ s1: { id: 's1', running: false, retainedBy: {} } });
  await client.tick();

  assert.equal(client.dot('s1'), null);
  assert.equal(rows.s1.cell.children.length, 0);
  client.ctx.cleanup?.();
});

test('被用户打开过（主视图）的会话不再保留崩溃标记', async () => {
  const rows = { s1: sessionRow('done') };
  const client = await loadClient({ rows });
  client.plugin.apply(client.ctx);

  client.update({ s1: { id: 's1', running: true, retainedBy: {} } });
  client.reconnect();
  client.time.now += 500;
  client.update({ s1: { id: 's1', running: false, retainedBy: {} } });
  assert.equal(client.dot('s1').getAttribute('data-state'), 'error');

  // 用户点开这个会话：DSH 会撤掉完成点；这里给点回来的情形，标记必须已经清掉。
  client.update({ s1: { id: 's1', running: false, retainedBy: { mainView: 1 } } });
  assert.equal(client.dot('s1').getAttribute('data-state'), 'done');
  client.ctx.cleanup?.();
});

test('React 换掉状态点元素后，树变更会就近重画（不留一秒绿）', async () => {
  const rows = { s1: sessionRow('done') };
  const client = await loadClient({ rows, failed: ['s1'] });
  client.plugin.apply(client.ctx);

  client.update({ s1: { id: 's1', running: false, retainedBy: {} } });
  await client.tick();
  assert.equal(client.dot('s1').getAttribute('data-state'), 'error');

  // React 重建这一格：旧点被换成新的绿点，插回监听那一刻的旧引用已经失效。
  rows.s1.cell.children = [];
  const fresh = new FakeElement('span');
  fresh.setAttribute('data-state', 'done');
  rows.s1.cell.appendChild(fresh);

  client.mutate();
  assert.equal(client.dot('s1').getAttribute('data-state'), 'error');
  client.ctx.cleanup?.();
});
