import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('client 领取命令后打开目标会话并确认', async () => {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8');
  let plugin;
  const timers = [];
  const window = {
    __ModuleLoader__: {
      load(record) { plugin = record.factory(); },
    },
  };
  const context = {
    window,
    document: { visibilityState: 'visible' },
    setInterval(callback) { timers.push(callback); return timers.length; },
    clearInterval() {},
  };
  vm.runInNewContext(source, context);
  assert.ok(plugin);

  const opened = [];
  const requests = [];
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ phase: 'ready', ids: ['target-session'] }),
        subscribe: () => () => {},
      },
      open: id => opened.push(id),
    },
    effect(setup) {
      this.cleanup = setup();
      return this.cleanup;
    },
  };
  context.fetch = async (url, options = {}) => {
    requests.push([url, options]);
    if (url.endsWith('/commands')) return { ok: true, json: async () => ({ items: [{ commandId: 'c1', sessionId: 'target-session' }] }) };
    if (url.endsWith('/commands/claim')) return { ok: true, json: async () => ({ command: { commandId: 'c1', sessionId: 'target-session' } }) };
    if (url.endsWith('/commands/ack')) return { ok: true, json: async () => ({ ok: true }) };
    return { ok: false, json: async () => ({}) };
  };

  plugin.apply(ctx);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, ['target-session']);
  assert.equal(requests.filter(([url]) => url.endsWith('/commands/claim')).length, 1);
  assert.equal(requests.filter(([url]) => url.endsWith('/commands/ack')).length, 1);
  const claim = requests.find(([url]) => url.endsWith('/commands/claim'));
  assert.equal(JSON.parse(claim[1].body).visible, true);
  ctx.cleanup?.();
});

test('后台 Harness 页面也会领取命令并尝试聚焦自身', async () => {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8');
  let plugin;
  const window = {
    focusCalls: 0,
    focus() { this.focusCalls += 1; },
    __ModuleLoader__: {
      load(record) { plugin = record.factory(); },
    },
  };
  const context = {
    window,
    document: { visibilityState: 'hidden', hasFocus: () => false },
    setInterval(callback) { callback(); return 1; },
    clearInterval() {},
  };
  vm.runInNewContext(source, context);
  assert.ok(plugin);

  const opened = [];
  const requests = [];
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ phase: 'ready', ids: ['background-session'] }),
        subscribe: () => () => {},
      },
      open: id => opened.push(id),
    },
    effect(setup) {
      this.cleanup = setup();
      return this.cleanup;
    },
  };
  context.fetch = async (url, options = {}) => {
    requests.push([url, options]);
    if (url.endsWith('/commands')) return { ok: true, json: async () => ({ items: [{ commandId: 'c2', sessionId: 'background-session' }] }) };
    if (url.endsWith('/commands/claim')) return { ok: true, json: async () => ({ command: { commandId: 'c2', sessionId: 'background-session' } }) };
    if (url.endsWith('/commands/ack')) return { ok: true, json: async () => ({ ok: true }) };
    return { ok: false, json: async () => ({}) };
  };

  plugin.apply(ctx);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, ['background-session']);
  assert.ok(window.focusCalls >= 1);
  const claim = requests.find(([url]) => url.endsWith('/commands/claim'));
  assert.equal(JSON.parse(claim[1].body).visible, false);
  ctx.cleanup?.();
});
