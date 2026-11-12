import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE_URL = new URL('../client/client.js', import.meta.url);

const settle = () => new Promise(resolve => setImmediate(resolve));

/** 一条侧栏会话行的测试替身（与 dsh 真实行交互的形状一致）。 */
function fakeRow(key, { className = '', ariaSelected = null, spans = [] } = {}) {
  const children = spans.map(text => ({ tagName: 'span', textContent: text, className: '' }));
  const row = {
    getAttribute: name => {
      if (name === 'data-row-key') return key;
      if (name === 'aria-selected') return ariaSelected;
      return null;
    },
    className,
    querySelector: sel => children.find(child => `.${child.className}` === sel) || null,
    querySelectorAll: sel => (sel === 'span' ? children.filter(child => child.tagName === 'span') : []),
    appendChild: child => { children.push(child); },
    removeChild: child => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
    },
  };
  row.children = children;
  return row;
}

const dotOf = row => row.querySelector('.dhl-completed-dot');

/**
 * 装载客户端并驱动红点逻辑：假 document + sessionStorage，fetch 桩返回
 * 可变的 completedIds（模拟服务端开关与完成集合的变化）。
 */
async function loadDotClient({ rows, embedded = true } = {}) {
  const source = await readFile(SOURCE_URL, 'utf8');
  let plugin;
  const timers = [];
  const listeners = new Map();
  const storage = new Map();
  let feed = { items: [] };
  const documentStub = {
    visibilityState: 'visible',
    hasFocus: () => true,
    body: {},
    querySelectorAll: sel => (sel === '[data-row-key]' ? [...rows] : []),
    createElement: tag => ({ tagName: tag, className: '', style: {}, setAttribute() {}, textContent: undefined }),
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    removeEventListener() {},
  };
  const windowStub = {
    focus() {},
    __ModuleLoader__: { load(record) { plugin = record.factory(); } },
  };
  if (embedded) windowStub.webkit = { messageHandlers: {} };
  const sessionList = {
    getSnapshot: () => ({ phase: 'ready', ids: ['s1', 's2'], byId: {} }),
    subscribe: () => () => {},
  };
  const context = {
    window: windowStub,
    document: documentStub,
    sessionStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    },
    setInterval(callback) { timers.push(callback); return timers.length; },
    clearInterval() {},
    fetch: async () => ({ ok: true, json: async () => feed }),
  };
  vm.runInNewContext(source, context);
  assert.ok(plugin, 'client half must register a plugin');
  const ctx = {
    sessions: { list: sessionList },
    get: () => undefined,
    effect(setup) { this.cleanup = setup(); return this.cleanup; },
  };
  return {
    plugin,
    ctx,
    timers,
    storage,
    /** 改变下一轮轮询响应（completedIds 缺省＝开关没开）。 */
    setFeed(next) { feed = next; },
    /** 等当前这轮 poll（含 apply 时的首次 poll）落定。 */
    async tick() {
      await settle();
      await settle();
    },
    async nextTick() {
      await timers[0]();
      await this.tick();
    },
    /** 派发一次带目标的点击。 */
    click(target) {
      for (const callback of [...(listeners.get('click') || [])]) callback({ target });
    },
  };
}

test('开关打开：完成会话画红点，无关行与非会话行不动；集合里消失则移除', async () => {
  const rows = [fakeRow('session:s1'), fakeRow('session:s2'), fakeRow('workspace:x')];
  const client = await loadDotClient({ rows });
  client.setFeed({ items: [], completedIds: ['s1'] });
  client.plugin.apply(client.ctx);
  await client.tick();

  assert.ok(dotOf(rows[0]), 's1 画红点');
  assert.equal(dotOf(rows[1]), null, '不在完成集合里的行不画');
  assert.equal(dotOf(rows[2]), null, '非 session 行不画');

  // 同一行加上选中样式类（非 aria-selected）也算已看语义——这里只验证样式匹配不炸。
  rows[1].className = 'is-selected-row';
  client.setFeed({ items: [], completedIds: [] });
  await client.nextTick();
  assert.equal(dotOf(rows[0]), null, '完成集合里消失后红点移除');
});

test('选中即已看：aria-selected 行不画红点并记住（sessionStorage）', async () => {
  const rows = [fakeRow('session:s1', { ariaSelected: 'true' }), fakeRow('session:s2')];
  const client = await loadDotClient({ rows });
  client.setFeed({ items: [], completedIds: ['s1', 's2'] });
  client.plugin.apply(client.ctx);
  await client.tick();

  assert.equal(dotOf(rows[0]), null, '选中的会话不画');
  assert.ok(dotOf(rows[1]), '未选中的照画');
  assert.deepEqual(JSON.parse(client.storage.get('dhl-completed-dismissed')), ['s1'], '选中即已看被记住');

  // 下一轮仍然完成中：已看的不复发。
  await client.nextTick();
  assert.equal(dotOf(rows[0]), null);
  assert.ok(dotOf(rows[1]));
});

test('点击该行视为已看；id 消失再重现（再次完成）时红点重现任', async () => {
  const rows = [fakeRow('session:s1')];
  const client = await loadDotClient({ rows });
  client.setFeed({ items: [], completedIds: ['s1'] });
  client.plugin.apply(client.ctx);
  await client.tick();
  assert.ok(dotOf(rows[0]));

  // 点击 → 已看，红点消失。
  client.click({ closest: sel => (sel === '[data-row-key]' ? rows[0] : null) });
  assert.equal(dotOf(rows[0]), null, '点击后红点消失');
  assert.deepEqual(JSON.parse(client.storage.get('dhl-completed-dismissed')), ['s1']);

  // 下轮仍在完成集合里：已看不复发。
  await client.nextTick();
  assert.equal(dotOf(rows[0]), null);

  // id 离开集合（老记录挤出）→ 红点无；重新完成 → 清掉已看，红点重现任。
  client.setFeed({ items: [], completedIds: [] });
  await client.nextTick();
  client.setFeed({ items: [], completedIds: ['s1'] });
  await client.nextTick();
  assert.ok(dotOf(rows[0]), '再次完成后红点重现任');
});

test('dsh 自己显示「已完成」时不重复画；开关没开时 DOM 完全不动', async () => {
  const rows = [fakeRow('session:s1', { spans: ['已完成'] }), fakeRow('session:s2')];
  const client = await loadDotClient({ rows });
  client.setFeed({ items: [], completedIds: ['s1', 's2'] });
  client.plugin.apply(client.ctx);
  await client.tick();

  assert.equal(dotOf(rows[0]), null, '原生完成标记在场时不画');
  assert.ok(dotOf(rows[1]));

  // 开关关闭（响应没有 completedIds 字段）：客户端不碰 DOM。
  const before = rows.map(row => row.children.length);
  client.setFeed({ items: [] });
  await client.nextTick();
  assert.deepEqual(rows.map(row => row.children.length), before, '开关没开时不动 DOM');
});
