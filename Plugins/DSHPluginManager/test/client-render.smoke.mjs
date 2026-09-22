// 插件管理客户端 UI 的渲染冒烟（scripts/test.sh 会跑）：用极简 React 运行时 +
// 假 fetch/document 把 client.js 真的渲染一遍。纯函数单测（client-updates.test.js）
// 覆盖不到"组件接线"——工具栏按钮、行内标记、批量轮询、多选与降级路径是否真的连上，
// 由这里兜住。断言失败会直接抛错，脚本以非 0 退出，回归即失败。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SOURCE = new URL('../client/client.js', import.meta.url);
const source = await readFile(SOURCE, 'utf8');

// ---------- 极简 React ----------
function flatten(children) {
  const out = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flatten(child));
    else if (child !== null && child !== undefined && child !== false && child !== true) out.push(child);
  }
  return out;
}
const FRAGMENT = Symbol('fragment');
class Runtime {
  constructor() { this.slots = new Map(); this.dirty = false; }
  slotFor(key) {
    if (!this.slots.has(key)) this.slots.set(key, { order: 0, states: [], deps: [], pending: [] });
    return this.slots.get(key);
  }
  component(element, parentKey, occurrence) {
    const key = `${parentKey}|${element.type.name || 'anon'}:${occurrence}`;
    const slot = this.slotFor(key);
    slot.order = 0;
    this.current = slot;
    const rendered = element.type(element.props);
    for (const effect of slot.pending) this.pendingEffects.push(effect);
    slot.pending = [];
    this.current = null;
    return this.expand(rendered, key);
  }
  expand(node, parentKey) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(child => this.expand(child, parentKey));
    const children = flatten(node.children || []);
    if (node.type === FRAGMENT) return children.map(child => this.expand(child, parentKey));
    if (typeof node.type === 'function') return this.component({ ...node, children }, parentKey, 0);
    const counts = new Map();
    const rendered = children.map(child => {
      if (child && typeof child === 'object' && typeof child.type === 'function') {
        const n = counts.get(child.type) || 0;
        counts.set(child.type, n + 1);
        return this.component(child, `${parentKey}>${node.type}`, n);
      }
      return this.expand(child, `${parentKey}>${node.type}`);
    });
    return { type: node.type, props: node.props || {}, children: rendered };
  }
  makeReact() {
    const runtime = this;
    return {
      Fragment: FRAGMENT,
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: flatten(children) }),
      useState(initial) {
        const slot = runtime.current;
        const index = slot.order++;
        if (slot.states.length <= index) slot.states[index] = typeof initial === 'function' ? initial() : initial;
        return [slot.states[index], next => {
          slot.states[index] = typeof next === 'function' ? next(slot.states[index]) : next;
          runtime.dirty = true;
        }];
      },
      useMemo(fn, deps = []) {
        const slot = runtime.current;
        const index = slot.order++;
        const stored = slot.deps[index];
        if (!stored || deps.length !== stored.deps.length || deps.some((d, i) => d !== stored.deps[i])) {
          slot.deps[index] = { deps, value: fn() };
        }
        return slot.deps[index].value;
      },
      useRef(initial) {
        const slot = runtime.current;
        const index = slot.order++;
        if (!slot.deps[index]) slot.deps[index] = { deps: [], value: { current: initial } };
        return slot.deps[index].value;
      },
      useEffect(fn, deps = []) {
        const slot = runtime.current;
        const index = slot.order++;
        const stored = slot.deps[index];
        if (!stored || deps.length !== stored.deps.length || deps.some((d, i) => d !== stored.deps[i])) {
          slot.deps[index] = { deps, value: true };
          slot.pending.push(fn);
        }
      },
    };
  }
  render(element) {
    this.pendingEffects = [];
    this.dirty = false;
    this.root = element;
    this.tree = this.expand(element, 'root');
    for (const effect of this.pendingEffects) effect();
    return this.tree;
  }
  repaint() { return this.render(this.root); }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle(runtime, rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    await tick();
    runtime.repaint();
  }
  return runtime.tree;
}
function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out; }
  if (typeof node.type === 'string' && predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}
const textOf = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children || []).map(textOf).join('');
};
const byClass = (tree, token) => findAll(tree, node => String(node.props.className || '').includes(token));
const isRow = node => typeof node.type === 'string' && /(^| )dsh-pm-row( |$)/.test(String(node.props.className || ''));
const rowsOf = tree => findAll(tree, isRow);
const rectOf = (left, top, right, bottom) => ({ left, top, right, bottom });
const fakeEvent = over => ({ button: 0, target: null, preventDefault() {}, ...over });
// 真实 React 里 ref 可能是回调也可能是 {current} 对象，这里两种都照做。
const applyRef = (element, node) => {
  const ref = element && element.props && element.props.ref;
  if (typeof ref === 'function') ref(node);
  else if (ref && typeof ref === 'object') ref.current = node;
};
const findByText = (tree, tag, text) => findAll(tree, node => node.type === tag && textOf(node) === text)[0];
const toasts = tree => findAll(tree, node => /dsh-pm-toast dsh-pm-toast-/.test(String(node.props.className || ''))).map(node => ({
  kind: /toast-success/.test(node.props.className) ? 'success' : /toast-error/.test(node.props.className) ? 'error' : 'info',
  text: textOf(node.children && node.children[1] ? node.children[1] : node),
}));

// ---------- 场景装配 ----------
function makeDocument() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type, event) { const fn = listeners.get(type); if (fn) fn(event); },
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ set textContent(v) {} }),
  };
}
function boot({ fetchImpl, setTimeoutImpl }) {
  const runtime = new Runtime();
  const documentStub = makeDocument();
  let plugin;
  const window = { __ModuleLoader__: { load(record) { plugin = record.factory(name => {
    if (name === 'react') return runtime.makeReact();
    throw new Error('unexpected require ' + name);
  }); } } };
  vm.runInNewContext(source, {
    window,
    document: documentStub,
    fetch: fetchImpl,
    setTimeout: setTimeoutImpl || setTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
  });
  let trigger;
  plugin.apply({ slots: { inject(name, cb) { cb(); }, register(spec, component) { trigger = component; } } });
  assert.equal(typeof trigger, 'function');
  return { runtime, trigger, document: documentStub };
}

const installedItems = [
  { name: 'dsh-notify', version: '0.5.1', description: '通知插件' },
  { name: 'dsh-local', version: null, description: '本地插件' },
  { name: 'dsh-old', version: '2.0.0', description: '领先版本' },
  { name: 'dsh-builtin', version: '1.0.0', description: '内置', source: 'bundled' },
];
const entry = (name, over) => ({
  name, kind: 'git', spec: 'github:a/b', installedVersion: '1.0.0', installedCommit: 'c1',
  remote: { version: '1.0.0', commit: 'c1' }, status: 'up-to-date', latestVersion: '1.0.0',
  major: false, note: null, error: null, ...over,
});

/** 场景 1：单条更新 + 检查更新 */
{
  let updated = false;
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options });
    const respond = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const inventory = [
      updated
        ? entry('dsh-notify', { installedVersion: '0.6.0', latestVersion: '0.6.0', note: '远端有新提交（版本号未变）' })
        : entry('dsh-notify', { installedVersion: '0.5.1', status: 'update-available', latestVersion: '0.6.0' }),
      entry('dsh-local', { kind: 'local', installedVersion: null, status: 'unknown', note: '本地来源，无法自动检测', latestVersion: null }),
      entry('dsh-old', { installedVersion: '2.0.0', status: 'ahead', latestVersion: '1.0.0', note: '已安装版本比远端更高' }),
    ];
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: installedItems });
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      return respond({
        checkedAt: '2026-09-22T11:00:00.000Z', refreshing: false, lastBatch: null,
        summary: { total: inventory.length, updateAvailable: inventory.filter(item => item.status === 'update-available').length, failed: 0, unknown: 1 },
        inventory,
      });
    }
    if (url.startsWith('/dsh-plugin-manager/update')) {
      updated = true;
      return respond({ ok: true, updatedTo: '0.6.0', restartRequired: true, note: '已更新到 v0.6.0' });
    }
    return respond({});
  };
  const { runtime, trigger } = boot({ fetchImpl });

  // 1. 侧边栏入口 + 角标
  runtime.render(runtime.makeReact().createElement(trigger, { wide: true }));
  await settle(runtime);
  const triggerButton = findAll(runtime.tree, node => node.type === 'button')[0];
  assert.equal(triggerButton.props['aria-label'], '插件管理（1 个可更新）', '角标数量进入无障碍标签');
  assert.equal(textOf(byClass(runtime.tree, 'dsh-pm-trigger-badge')[0]), '1', '侧边栏入口显示可更新角标');
  runtime.render(runtime.makeReact().createElement(trigger, { wide: false }));
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-pm-trigger-badge').length, 1, '56px 窄栏也显示角标');
  runtime.render(runtime.makeReact().createElement(trigger, { wide: true }));
  await settle(runtime);

  // 2. 打开面板：工具栏 + 行内标记
  findAll(runtime.tree, node => node.type === 'button')[0].props.onClick();
  await settle(runtime);
  let tree = runtime.tree;
  const text = textOf(tree);
  assert.ok(findByText(tree, 'button', '检查更新'), '工具栏有「检查更新」');
  assert.ok(findByText(tree, 'button', '全部更新'), '工具栏有「全部更新」');
  const clock = (() => { const d = new Date('2026-09-22T11:00:00.000Z'); const pad = v => String(v).padStart(2, '0'); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; })();
  assert.ok(text.includes(`上次检测：${clock}`), '显示上次检测时间，期望：' + clock);
  assert.ok(text.includes('v0.5.1'), '行内显示已安装版本');
  assert.ok(text.includes('—'), '没有版本的插件显示 —');
  assert.equal(byClass(tree, 'dsh-pm-update-pill').length, 1, '只有可更新的插件有胶囊');
  assert.equal(textOf(byClass(tree, 'dsh-pm-update-pill')[0]), '可更新到 v0.6.0');
  assert.ok(text.includes('本地来源，无法自动检测'), 'unknown 显示服务端 note');
  assert.ok(text.includes('已安装版本比远端更高'), 'ahead 显示小字');
  assert.equal(findByText(tree, 'button', '全部更新').props.disabled, false, '有可更新项时「全部更新」可用');

  // 3. 单条更新
  findByText(tree, 'button', '更新').props.onClick();
  const updateCall = calls.find(call => call.url === '/dsh-plugin-manager/update');
  assert.equal(updateCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(updateCall.options.body), { name: 'dsh-notify' });
  assert.ok(textOf(runtime.repaint()).includes('更新中…'), '更新期间按钮显示「更新中…」');
  await settle(runtime);
  tree = runtime.tree;
  assert.ok(textOf(tree).includes('dsh-notify 已更新到 v0.6.0，重启 dsh 后生效'), '成功 toast 含 note 与重启提示');
  assert.deepEqual(toasts(tree).filter(item => item.kind === 'success').map(item => item.text), ['dsh-notify 已更新到 v0.6.0，重启 dsh 后生效']);
  assert.equal(byClass(tree, 'dsh-pm-update-pill').length, 0, '更新后胶囊消失');
  assert.equal(byClass(tree, 'dsh-pm-trigger-badge').length, 0, '更新后角标消失');
  assert.equal(findByText(tree, 'button', '全部更新').props.disabled, true, '没有可更新项时「全部更新」禁用');
  assert.ok(calls.some(call => call.url === '/dsh-plugin-manager/installed'), '更新后刷新已安装列表');
  assert.ok(calls.some(call => call.url === '/dsh-plugin-manager/updates?refresh=1'), '更新后重新检测');

  // 4. 检查更新
  findByText(runtime.tree, 'button', '检查更新').props.onClick();
  assert.ok(findByText(runtime.repaint(), 'button', '检测中…'), '检测期间按钮显示「检测中…」');
  await settle(runtime);
  assert.ok(calls.filter(call => call.url === '/dsh-plugin-manager/updates?refresh=1').length >= 2, '检查更新带 refresh=1');
  assert.ok(findByText(runtime.tree, 'button', '检查更新'), '检测结束后按钮复原');
  console.log('场景1（单条更新 + 检查更新）通过');
}

/** 场景 2：异步批量更新（202 + lastBatch 轮询） */
{
  const calls = [];
  const delays = [];
  let batchPolls = 0;
  let batchStarted = false;
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options });
    const respond = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const done = batchPolls >= 3;
    const inventory = ['dsh-b1', 'dsh-b2'].map(name => entry(name, {
      installedVersion: done ? '2.0.0' : '1.0.0',
      status: done ? 'up-to-date' : 'update-available',
      latestVersion: '2.0.0',
    }));
    if (url.startsWith('/dsh-plugin-manager/installed')) {
      return respond({ items: [{ name: 'dsh-b1', version: '1.0.0', description: '插件一' }, { name: 'dsh-b2', version: '1.0.0', description: '插件二' }] });
    }
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      let lastBatch = null;
      if (batchStarted) {
        batchPolls += 1;
        lastBatch = {
          startedAt: '2026-09-22T11:02:00.000Z',
          finishedAt: done ? '2026-09-22T11:02:05.000Z' : null,
          updated: done ? 2 : 0,
          failed: 0,
          results: done ? [{ name: 'dsh-b1', ok: true, updatedTo: '2.0.0', restartRequired: true, note: '已更新到 v2.0.0' }, { name: 'dsh-b2', ok: true, updatedTo: '2.0.0', restartRequired: true, note: '已更新到 v2.0.0' }] : [],
        };
      }
      return respond({
        checkedAt: '2026-09-22T11:00:00.000Z', refreshing: false, lastBatch,
        summary: { total: 2, updateAvailable: inventory.filter(item => item.status === 'update-available').length, failed: 0, unknown: 0 },
        inventory,
      });
    }
    if (url.startsWith('/dsh-plugin-manager/update-many')) {
      batchStarted = true;
      return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ ok: true, accepted: 2, names: JSON.parse(options.body).names }) });
    }
    return respond({});
  };
  const { runtime, trigger } = boot({
    fetchImpl,
    // 记录请求的延时，但仍立刻把控制权交还给事件循环：2 秒轮询在冒烟里不能真等。
    // 只把「轮询间隔」（<=2.5s）压成 0；toast 的 3.2s/6s 自动消失仍按真实时间走。
    setTimeoutImpl: (fn, ms) => { delays.push(ms); return setTimeout(fn, ms <= 2500 ? 0 : ms); },
  });

  runtime.render(runtime.makeReact().createElement(trigger, { wide: true }));
  await settle(runtime);
  findAll(runtime.tree, node => node.type === 'button')[0].props.onClick();
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-pm-update-pill').length, 2, '两个插件都可更新');

  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '全部更新')[0].props.onClick();
  const manyCall = calls.find(call => call.url === '/dsh-plugin-manager/update-many');
  assert.deepEqual(JSON.parse(manyCall.options.body), { names: ['dsh-b1', 'dsh-b2'] }, '提交所有 update-available 的名字');
  assert.ok(textOf(runtime.repaint()).includes('更新中…'), '批量期间按钮显示「更新中…」');
  await settle(runtime, 40);
  const afterStart = toasts(runtime.tree);
  assert.ok(afterStart.some(item => item.kind === 'info' && item.text === '已开始更新 2 个插件'), '受理后先提示「已开始更新 2 个插件」，实际：' + JSON.stringify(afterStart));
  assert.ok(delays.filter(ms => ms === 2000).length >= 2, '每 2 秒轮询一次 /updates，实际：' + JSON.stringify(delays));
  const batchToast = toasts(runtime.tree).filter(item => item.kind === 'success' && item.text.includes('已更新 2 个插件'));
  assert.equal(batchToast.length, 1, '批次结束后弹一条汇总 toast，实际：' + JSON.stringify(toasts(runtime.tree)));
  assert.equal(textOf(runtime.tree).includes('更新中…'), false, '批次结束后按钮复原');
  assert.equal(byClass(runtime.tree, 'dsh-pm-update-pill').length, 0, '批次结束后胶囊消失');
  assert.equal(byClass(runtime.tree, 'dsh-pm-trigger-badge').length, 0, '批次结束后角标消失');

  // 同一批次被再次读到（检查更新）时不重复弹汇总
  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '检查更新')[0].props.onClick();
  await settle(runtime, 40);
  assert.equal(toasts(runtime.tree).filter(item => item.kind === 'success' && item.text.includes('已更新 2 个插件')).length, 1, '重复读到同一批次不重复提示');
  console.log('场景2（异步批量更新）通过，批次轮询延时：' + JSON.stringify(delays.slice(0, 4)));
}

/** 场景 3：批量更新有失败 */
{
  const fetchImpl = (url, options = {}) => {
    const respond = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const lastBatch = { startedAt: 't1', finishedAt: 't2', updated: 1, failed: 1, results: [{ name: 'a', ok: true }, { name: 'b', ok: false, error: 'git ls-remote 超时' }] };
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: [{ name: 'dsh-b1', version: '1.0.0', description: '插件一' }] });
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      return respond({ checkedAt: '2026-09-22T11:00:00.000Z', refreshing: false, lastBatch, summary: { total: 1, updateAvailable: 1, failed: 0, unknown: 0 }, inventory: [entry('dsh-b1', { status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' })] });
    }
    if (url.startsWith('/dsh-plugin-manager/update-many')) return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ ok: true, accepted: 1, names: ['dsh-b1'] }) });
    return respond({});
  };
  const { runtime, trigger } = boot({ fetchImpl, setTimeoutImpl: (fn, ms) => setTimeout(fn, ms <= 2500 ? 0 : ms) });
  runtime.render(runtime.makeReact().createElement(trigger, { wide: true }));
  await settle(runtime);
  findAll(runtime.tree, node => node.type === 'button')[0].props.onClick();
  await settle(runtime, 40);
  const failure = toasts(runtime.tree).find(item => item.kind === 'error');
  assert.ok(failure, '失败批次要有红色汇总，实际：' + JSON.stringify(toasts(runtime.tree)));
  assert.equal(failure.text, '1 个更新成功、1 个失败：git ls-remote 超时', '失败批次红色汇总');
  console.log('场景3（批量失败汇总）通过');
}

/** 场景 4：降级（/updates 404） */
{
  const calls = [];
  const fetchImpl = url => {
    calls.push(url);
    if (url.startsWith('/dsh-plugin-manager/installed')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: installedItems }) });
    if (url.startsWith('/dsh-plugin-manager/updates')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };
  const { runtime, trigger } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(trigger, { wide: true }));
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-pm-trigger-badge').length, 0, '降级时没有角标');
  findAll(runtime.tree, node => node.type === 'button')[0].props.onClick();
  await settle(runtime);
  const text = textOf(runtime.tree);
  assert.ok(text.includes('dsh-notify'), '降级时仍显示已安装列表');
  assert.ok(text.includes('v0.5.1'), '降级时仍显示已安装版本（退回 installed.version）');
  assert.ok(!text.includes('检查更新'), '降级时不显示更新工具栏');
  assert.ok(!text.includes('可更新到'), '降级时没有任何更新标记');
  assert.ok(!text.includes('检测失败'), '降级时不报错');
  assert.equal(toasts(runtime.tree).length, 0, '降级时不弹 toast');
  console.log('场景4（接口 404 静默降级）通过，请求：' + calls.join(', '));
}

/** 场景 5：多选、Shift 连选、橡皮筋框选、「更新选中」 */
{
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    calls.push({ url, options });
    const respond = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    const inventory = ['dsh-a', 'dsh-b', 'dsh-c', 'dsh-d'].map((name, i) => entry(name, {
      installedVersion: '1.0.0', latestVersion: '2.0.0',
      status: i < 3 ? 'update-available' : 'up-to-date',
    }));
    if (url.startsWith('/dsh-plugin-manager/installed')) {
      return respond({ items: ['dsh-a', 'dsh-b', 'dsh-c', 'dsh-d'].map(name => ({ name, version: '1.0.0', description: name })) });
    }
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      return respond({ checkedAt: '2026-09-22T11:00:00.000Z', refreshing: false, lastBatch: null, progress: null, summary: { total: 4, updateAvailable: 3, failed: 0, unknown: 0 }, inventory });
    }
    if (url.startsWith('/dsh-plugin-manager/update-many')) {
      return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ ok: true, accepted: JSON.parse(options.body).names.length, names: JSON.parse(options.body).names }) });
    }
    return respond({});
  };
  const { runtime, trigger, document: doc } = boot({ fetchImpl, setTimeoutImpl: (fn, ms) => setTimeout(fn, ms <= 2500 ? 0 : ms) });
  runtime.render(runtime.makeReact().createElement(trigger, { wide: true }));
  await settle(runtime);
  findAll(runtime.tree, node => node.type === 'button')[0].props.onClick();
  await settle(runtime);
  let tree = runtime.tree;
  assert.ok(textOf(tree).includes('已选 0 个'), '工具栏显示已选计数');
  assert.equal(findByText(tree, 'button', '更新选中').props.disabled, true, '没选中时「更新选中」禁用');
  assert.equal(findByText(tree, 'button', '取消选择').props.disabled, true);

  // 复选框点击切换 + 无障碍标签
  let rows = rowsOf(tree);
  assert.equal(rows.length, 4, '四行已安装插件，实际：' + rows.length);
  const checkboxes = () => findAll(runtime.tree, node => node.type === 'input' && String(node.props.className).includes('dsh-pm-check'));
  checkboxes()[0].props.onChange({ shiftKey: false });
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 1 个'), '点复选框选中 1 个');
  assert.equal(findByText(runtime.tree, 'button', '更新选中').props.disabled, false, '选中可更新项后「更新选中」可用');

  // Shift 点复选框：从上次位置区间选中
  checkboxes()[2].props.onChange({ shiftKey: true });
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 3 个'), 'Shift 连选 0..2 三行，实际：' + textOf(runtime.tree).slice(0, 120));

  // 行点击：普通点击切换（点行标题文字）
  rows = rowsOf(runtime.tree);
  rows[3].props.onClick(fakeEvent({ target: null }));
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 4 个'), '点行也能切换选中');

  // 点按钮不切换：target 命中 button 时直接返回
  rows = rowsOf(runtime.tree);
  rows[0].props.onClick(fakeEvent({ target: { closest: () => ({}) } }));
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 4 个'), '点行内按钮不改变选择');

  // 取消选择
  findByText(runtime.tree, 'button', '取消选择').props.onClick();
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 0 个'), '「取消选择」清空选择');

  // 橡皮筋框选：接上假的 getBoundingClientRect
  tree = runtime.tree;
  const area = findAll(tree, node => String(node.props.className || '') === 'dsh-pm-selectarea')[0];
  assert.ok(area, '列表区域存在');
  applyRef(area, { getBoundingClientRect: () => rectOf(0, 0, 200, 140) });
  const rects = [[0, 0, 200, 40], [0, 44, 200, 84], [0, 88, 200, 128], [0, 132, 200, 172]];
  rowsOf(tree).forEach((row, i) => applyRef(row, { getBoundingClientRect: () => rectOf(...rects[i]) }));

  area.props.onMouseDown(fakeEvent({ clientX: 10, clientY: 5 }));
  doc.dispatch('mousemove', { clientX: 190, clientY: 60 });
  let bandEl = byClass(runtime.repaint(), 'dsh-pm-band')[0];
  assert.ok(bandEl, '拖动时出现橡皮筋覆盖层');
  assert.deepEqual([bandEl.props.style.left, bandEl.props.style.top, bandEl.props.style.width, bandEl.props.style.height], ['10px', '5px', '180px', '55px'], '覆盖层矩形随鼠标更新');
  assert.ok(textOf(runtime.tree).includes('已选 2 个'), '实时选中相交的前两行，实际：' + textOf(runtime.tree).slice(0, 120));
  doc.dispatch('mouseup', {});
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-pm-band').length, 0, '松开后覆盖层消失');
  assert.ok(textOf(runtime.tree).includes('已选 2 个'), '松开后保留框选结果');

  // 拖动刚结束时，行的点击不应该再顺带切换（避免「开始拖动时触发行的点击」）
  rows = rowsOf(runtime.tree);
  rows[3].props.onClick(fakeEvent({ target: null }));
  assert.ok(textOf(runtime.tree).includes('已选 2 个'), '拖动后的点击被抑制');

  // Shift 拖动：追加而不是替换
  findByText(runtime.tree, 'button', '取消选择').props.onClick();
  await settle(runtime);
  rows = rowsOf(runtime.tree);
  rows[3].props.onClick(fakeEvent({ target: null }));
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 1 个'), '先只选第 4 行');
  tree = runtime.tree;
  const area2 = findAll(tree, node => String(node.props.className || '') === 'dsh-pm-selectarea')[0];
  applyRef(area2, { getBoundingClientRect: () => rectOf(0, 0, 200, 140) });
  rowsOf(tree).forEach((row, i) => applyRef(row, { getBoundingClientRect: () => rectOf(...rects[i]) }));
  area2.props.onMouseDown(fakeEvent({ clientX: 10, clientY: 5, shiftKey: true }));
  doc.dispatch('mousemove', { clientX: 190, clientY: 60 });
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 3 个'), 'Shift 框选追加到已有选择，实际：' + textOf(runtime.tree).slice(0, 120));
  doc.dispatch('mouseup', {});
  await settle(runtime);

  // 更新选中：只提交选中且可更新的名字（第 4 行 up-to-date 不提交）
  findByText(runtime.tree, 'button', '更新选中').props.onClick();
  await settle(runtime, 20);
  const selectedCall = calls.find(call => call.url === '/dsh-plugin-manager/update-many');
  assert.deepEqual(JSON.parse(selectedCall.options.body), { names: ['dsh-a', 'dsh-b'] }, '只提交选中且可更新的插件（第 4 行 up-to-date 不提交）');
  assert.ok(toasts(runtime.tree).some(item => item.text === '已开始更新 2 个插件'), '复用异步受理提示');
  console.log('场景5（多选 + Shift 连选 + 橡皮筋框选 + 更新选中）通过');
}

/** 场景 6：服务端进程进度（progress）行内呈现 + 退出后回到普通状态 */
{
  let progressOn = true;
  let progressPolls = 0;
  const fetchImpl = url => {
    const respond = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (url.startsWith('/dsh-plugin-manager/installed')) {
      return respond({ items: [{ name: 'dsh-b1', version: '1.0.0', description: '插件一' }, { name: 'dsh-b2', version: '1.0.0', description: '插件二' }] });
    }
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      if (progressOn) progressPolls += 1;
      return respond({
        checkedAt: '2026-09-22T11:00:00.000Z', refreshing: false, lastBatch: null,
        progress: progressOn ? { active: true, kind: 'npm', total: 2, done: 0, current: 'dsh-b1', step: '正在下载并安装' } : null,
        summary: { total: 2, updateAvailable: 2, failed: 0, unknown: 0 },
        inventory: [entry('dsh-b1', { status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' }), entry('dsh-b2', { status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' })],
      });
    }
    return respond({});
  };
  const delays = [];
  const { runtime, trigger } = boot({ fetchImpl, setTimeoutImpl: (fn, ms) => { delays.push(ms); return setTimeout(fn, ms <= 2500 ? 0 : ms); } });
  runtime.render(runtime.makeReact().createElement(trigger, { wide: true }));
  await settle(runtime, 4);
  findAll(runtime.tree, node => node.type === 'button')[0].props.onClick();
  await settle(runtime, 4);
  const text = textOf(runtime.tree);
  assert.ok(text.includes('正在下载并安装 v2.0.0…'), '当前更新行显示步骤，实际：' + text.slice(0, 400));
  assert.ok(text.includes('等待中'), '其余待更新行显示「等待中」');
  assert.equal(byClass(runtime.tree, 'dsh-pm-row-progress').length, 2, '两行都显示进度小字');
  assert.equal(findByText(runtime.tree, 'button', '更新中…').props.disabled, true, '批次进行中「全部更新」变成「更新中…」并禁用');
  assert.equal(findByText(runtime.tree, 'button', '更新选中').props.disabled, true, '批次进行中「更新选中」禁用');
  assert.ok(progressPolls >= 2, '面板会跟随进度轮询 /updates，实际：' + progressPolls);
  assert.ok(delays.includes(2000), '跟随进度用 2 秒间隔');

  // 批次结束（progress 清空）后回到普通状态
  progressOn = false;
  await settle(runtime, 6);
  const after = textOf(runtime.tree);
  assert.equal(after.includes('等待中'), false, '批次结束后不再显示「等待中」');
  assert.equal(after.includes('正在下载并安装'), false, '批次结束后不再显示步骤');
  assert.ok(findByText(runtime.tree, 'button', '全部更新'), '按钮文案复原为「全部更新」');
  console.log('场景6（progress 行内步骤 + 退出恢复）通过，跟随轮询 ' + progressPolls + ' 次');
}

console.log('== 冒烟全部通过 ==');
