import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

/** 用虚拟定时器加载 client.js 并取出 createToastStore（宿主只消费 inject/apply）。 */
async function loadToastStore() {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8');
  let plugin;
  const window = {
    __ModuleLoader__: {
      load(record) { plugin = record.factory(requireLike); },
    },
  };
  const requireLike = (name) => {
    if (name === 'react') {
      return { createElement: () => null, Fragment: 'fragment', useState: () => [null, () => {}], useMemo: fn => fn(), useEffect: () => {}, useRef: v => ({ current: v }) };
    }
    throw new Error('unexpected require: ' + name);
  };
  const timers = [];
  const schedule = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  vm.runInNewContext(source, { window, document: { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ set textContent(v) {} }) } });
  assert.ok(plugin, 'client factory 必须返回插件对象');
  assert.equal(typeof plugin.createToastStore, 'function', 'client 应导出 createToastStore 供单测');
  return { store: plugin.createToastStore(schedule), timers };
}

test('toast 入队即通知订阅者，成功 3.2s / 失败 6s 自动消失', async () => {
  const { store, timers } = await loadToastStore();
  const seen = [];
  const unsubscribe = store.subscribe(items => seen.push([...items]));
  try {
    store.push('success', '已安装 foo');
    store.push('error', '安装失败：bar');
    let snapshot = store.snapshot();
    assert.equal(snapshot.length, 2, '两条 toast 同时在场');
    // vm realm 里的数组原型与宿主不同，用 Array.from 转换后再严格比较
    assert.deepEqual(Array.from(snapshot, t => t.text), ['已安装 foo', '安装失败：bar']);
    assert.deepEqual(timers.map(t => t.ms), [3200, 6000], '成功短停留、失败长停留');

    // 到期顺序与时长匹配：先到期的是先入队的成功条
    timers[0].fn();
    snapshot = store.snapshot();
    assert.deepEqual(Array.from(snapshot, t => t.kind), ['error'], '成功条到期后只剩失败条');
    assert.ok(seen.length >= 3, '订阅者在入队与到期时都收到通知');
  } finally { unsubscribe(); }
});

test('dismiss 手动关闭只移除目标 toast', async () => {
  const { store, timers } = await loadToastStore();
  const first = store.push('info', '已安装过，无需重复安装');
  store.push('success', '已安装 baz');
  store.dismiss(first);
  const snapshot = store.snapshot();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].text, '已安装 baz');
  assert.equal(timers.length, 2, 'dismiss 不影响其余 toast 的自动消失');
});

test('订阅退订后不再收到通知', async () => {
  const { store } = await loadToastStore();
  let hits = 0;
  const unsubscribe = store.subscribe(() => { hits += 1 });
  unsubscribe();
  store.push('success', 'x');
  assert.equal(store.snapshot().length, 1);
  assert.equal(hits, 1, '只在 subscribe 的首次同步通知后命中，退订后 push 不再通知');
});
