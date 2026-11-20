// client/client.js 覆盖缺口 G：串行队列的时序分支 + 行内 markdown 兜底 +
// 发布说明读取失败 + 停用回滚 + 面板 Root 挂载契约。
//
// 渲染冒烟（test/client-render.smoke.mjs）已经覆盖主流程；这里补的是它没碰的
// 分支与时序：
//   1. 安装队列状态条（排队期间的那条状态栏）
//   2. 「更新在途时点安装」——统一串行泵的安装分支（runOneInstall）
//   3. 「卸载在途时点更新」——waitWhileDestructive 的让行等待
//   4. 行内 markdown 的兜底分支（链接目标带括号时按纯文本渲染）
//   5. 发布说明接口**抛错**（不是返回 error JSON）时的错误提示
//   6. 停用失败回滚时「本来就没有该条目」的分支
//   7. 面板 Root 组件本体、老宿主 react-dom 渲染路径、main/sidebar 注册组件
//
// 这里的极简 React 运行时与冒烟脚本同一套语义（createElement/Fragment/
// useState/useMemo/useEffect/useRef），但独立实现一份：本文件要能单独跑，
// 也不能依赖正在改动的冒烟脚本。
//
// 顺带记录一个**已报作者的缺陷**（本文件不修生产代码，只如实覆盖现状）：
// 安装队列被两个泵共享——install() 走旧的 pumpInstalls，而统一串行泵
// pumpMutations 里也有一份安装分支（runOneInstall）。于是「更新在途时点安装」
// 时两个泵都会处理同一个安装任务，同一个插件发两次 /install 请求。
// 下面第 3 组用例把这条时序跑起来，覆盖统一泵的安装分支；作者把安装改走
// 统一泵之后，这里的请求次数会从 2 变 1（断言只要求「至少 1 次」）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE_PATH = fileURLToPath(new URL('../client/client.js', import.meta.url));
const source = await readFile(SOURCE_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 极简 React 运行时
// ---------------------------------------------------------------------------
const FRAGMENT = Symbol('fragment');

function flatten(children) {
  const out = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flatten(child));
    else if (child !== null && child !== undefined && child !== false && child !== true) out.push(child);
  }
  return out;
}

class Runtime {
  constructor() { this.slots = new Map(); this.pendingEffects = []; this.dirty = false; }
  slotFor(key) {
    if (!this.slots.has(key)) this.slots.set(key, { order: 0, states: [], deps: [], pending: [] });
    return this.slots.get(key);
  }
  component(element, parentKey, occurrence) {
    const key = `${parentKey}|${(element.type && element.type.name) || 'anon'}:${occurrence}`;
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
    this.root = element;
    this.tree = this.expand(element, 'root');
    for (const effect of this.pendingEffects) effect();
    return this.tree;
  }
  repaint() { return this.render(this.root); }
}

// ---------------------------------------------------------------------------
// 树查询助手
// ---------------------------------------------------------------------------
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle(runtime, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await tick();
    runtime.repaint();
  }
  return runtime.tree;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/**
 * 轮询等待条件成立（最多 timeoutMs）。
 *
 * 用它在时序相关的断言上代替固定延时：机器负载高时固定延时会偶发不够，
 * 轮询则只等「真的发生了」为止。
 *
 * 注意：这里**同时驱动重渲染**（runtime.repaint）——被测代码的串行泵是靠
 * setState → 重渲染才看到 busy 变化的，只等不重绘会死锁。
 */
async function waitFor(predicate, { timeoutMs = 5000, stepMs = 25, runtime = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await wait(stepMs);
    if (runtime) runtime.repaint();
  }
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
// 队列状态条是 div；手动安装行也是 .dsh-pm-queue（但是 form），别混。
const queueStrips = tree => findAll(tree, node => node.type === 'div' && String(node.props.className || '').includes('dsh-pm-queue'));
const buttonsByText = (tree, text) => findAll(tree, node => node.type === 'button' && textOf(node).trim() === text);
const toasts = tree => findAll(tree, node => /dsh-pm-toast dsh-pm-toast-/.test(String(node.props.className || ''))).map(node => ({
  kind: /toast-success/.test(node.props.className) ? 'success' : /toast-error/.test(node.props.className) ? 'error' : 'info',
  text: textOf(node.children && node.children[1] ? node.children[1] : node),
}));
const toastTexts = tree => toasts(tree).map(item => item.text);

// ---------------------------------------------------------------------------
// 假 document / 假宿主
// ---------------------------------------------------------------------------
function makeDocument() {
  const listeners = new Map();
  const created = new Map();
  return {
    listeners,
    created,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch(type, event) { const fn = listeners.get(type); if (fn) fn(event); },
    head: { appendChild(node) { created.set(node.id, node); } },
    body: { appendChild(node) { created.set(node.id, node); } },
    getElementById: id => created.get(id) || null,
    createElement: () => ({ id: '', textContent: '' }),
  };
}

/**
 * 装载 client.js 并把面板入口（PluginTrigger）渲染出来。
 * 面板本体常驻挂在 body 上（mountPanel），这里用假的 react-dom 顶掉，
 * 真正的渲染由本文件的 Runtime 驱动。
 */
function boot({ fetchImpl, setTimeoutImpl } = {}) {
  const runtime = new Runtime();
  const documentStub = makeDocument();
  let plugin;
  const registrations = [];
  // 面板内的 ESC 关闭等 effect 会挂 window keydown 监听，stub 必须能接住。
  const windowEvents = new Map();
  const window = {
    __ModuleLoader__: {
      load(record) {
        plugin = record.factory(name => {
          if (name === 'react') return runtime.makeReact();
          if (name === 'react-dom/client') return { createRoot: () => ({ render() {} }) };
          if (name === 'react-dom') return { render() {} };
          throw new Error('unexpected require ' + name);
        });
      },
    },
    addEventListener(type, fn) { windowEvents.set(type, fn); },
    removeEventListener(type, fn) { if (windowEvents.get(type) === fn) windowEvents.delete(type); },
    dispatchWindowEvent(event) { const fn = windowEvents.get(event?.type); if (fn) fn(event); },
  };
  vm.runInNewContext(source, {
    window,
    document: documentStub,
    fetch: fetchImpl,
    // 真实 setTimeout：waitWhileDestructive 的 250ms 让行等待靠它推进。
    setTimeout: setTimeoutImpl || setTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    // vm 沙箱里没有 Web API 全集：流式检索要 ReadableStream/TextEncoder。
    ReadableStream,
    TextEncoder,
    TextDecoder,
    // 带 filename：node 的 coverage 才会把这段 vm 代码归到 client.js 名下。
  }, { filename: SOURCE_PATH });
  assert.ok(plugin, 'client factory 必须返回插件对象');
  const ctx = {
    slots: {
      inject(name, cb) { cb(); },
      register(spec, component) { registrations.push({ ...spec, component }); return () => {}; },
    },
    layout: { selectPanel() {} },
  };
  plugin.apply(ctx);
  return { runtime, plugin, ctx, registrations, document: documentStub };
}

/** 打开面板（点侧栏入口），可选再切到某个左栏页签。 */
async function openPanelOn(runtime, view) {
  findAll(runtime.tree, node => node.type === 'button')[0].props.onClick();
  await settle(runtime);
  if (view) await gotoView(runtime, view);
}
/** 切左栏页签（发现 / 内置 / 已安装 / 插件源）。 */
async function gotoView(runtime, label) {
  const item = findAll(runtime.tree, node => node.type === 'button' && textOf(node).includes(label))[0];
  assert.ok(item, '左栏有「' + label + '」页签');
  item.props.onClick();
  await settle(runtime, 8);
}

const respond = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const marketEntry = over => ({
  id: 'm1', name: 'alpha', repo: 'owner/alpha', author: 'owner', category: 'ui',
  descriptionEn: 'A plugin', descriptionZh: '甲插件', downloads: 10, stars: 1,
  version: '1.0.0', addedDate: null, ...over,
});

// ---------------------------------------------------------------------------
// 1. 行内 markdown 兜底：链接目标带括号时按纯文本渲染
// ---------------------------------------------------------------------------
test('行内 markdown：链接目标带括号时按纯文本兜底，不给截断的坏链接', async () => {
  const notes = '参见 [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) 的说明。';
  const fetchImpl = url => {
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: [{ name: 'dsh-md', version: '1.0.0', description: '插件' }] });
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      return respond({
        checkedAt: null, refreshing: false,
        inventory: [{ name: 'dsh-md', status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' }],
      });
    }
    if (url.startsWith('/dsh-plugin-manager/release-notes')) return respond({ ok: true, version: '2.0.0', title: 'v2.0.0', notes });
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '已安装');
  await settle(runtime, 6);

  const notesBtn = buttonsByText(runtime.tree, '更新内容')[0];
  assert.ok(notesBtn, '有「更新内容」入口');
  notesBtn.props.onClick({ stopPropagation() {} });
  await settle(runtime, 6);

  const anchors = findAll(runtime.tree, node => node.type === 'a');
  assert.equal(anchors.length, 0, '带括号的链接目标不再被当成链接（此前会截断成打不开的地址）');
  const text = textOf(runtime.tree);
  assert.ok(text.includes('Foo_(bar))'), '原文完整保留，实际：' + text.slice(-200));
});

// ---------------------------------------------------------------------------
// 2. 安装队列状态条
// ---------------------------------------------------------------------------
test('安装队列：排队期间显示状态条，装完给一条汇总 toast', async () => {
  const marketPlugins = [marketEntry()];
  const calls = [];
  let installedNow = false;
  let releaseInstall;
  const installGate = new Promise(resolve => { releaseInstall = resolve; });
  const fetchImpl = (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url.startsWith('/dsh-plugin-manager/installed')) {
      return respond({ items: installedNow ? [{ name: 'owner/alpha', version: '1.0.0' }] : [] });
    }
    if (url.startsWith('/dsh-plugin-manager/updates')) return respond({ checkedAt: null, refreshing: false, inventory: [] });
    if (url.startsWith('/dsh-plugin-manager/disabled')) return respond({ items: [] });
    if (url.startsWith('/dsh-plugin-manager/marketplace')) {
      return respond({
        ok: true, stale: false, total: 1, allTotal: 1, counts: [], categories: ['ui'],
        plugins: marketPlugins, sections: [], featured: marketPlugins, topDownloads: marketPlugins, topStars: marketPlugins,
      });
    }
    if (url.startsWith('/dsh-plugin-manager/install')) {
      // 安装请求先挂起：把「排队中」的状态条拍下来再放行。
      return installGate.then(() => { installedNow = true; return respond({ ok: true }); });
    }
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '发现');
  await settle(runtime, 6);

  const installBtn = buttonsByText(runtime.tree, '安装')[0];
  assert.ok(installBtn, '市场卡片有安装按钮');
  installBtn.props.onClick();
  await settle(runtime, 4);

  // 队列状态条：只在有安装任务时出现。
  const strip = queueStrips(runtime.tree)[0];
  assert.ok(strip, '安装排队期间出现队列状态条');
  const stripText = textOf(strip);
  assert.ok(stripText.includes('正在安装 1/1'), '状态条带进度序号，实际：' + stripText);
  assert.ok(stripText.includes('owner/alpha'), '状态条点名当前插件，实际：' + stripText);

  releaseInstall();
  await settle(runtime, 12);
  assert.ok(toastTexts(runtime.tree).some(text => text.includes('已安装')), '装完给汇总 toast，实际：' + toastTexts(runtime.tree).join(' | '));
  assert.equal(queueStrips(runtime.tree).length, 0, '装完状态条消失');
  assert.ok(calls.some(call => call.url.startsWith('/dsh-plugin-manager/install')), '确实发了安装请求');
});

// ---------------------------------------------------------------------------
// 2b. dsh 官方自带层：装上了但不在「已安装」列表里，不能误报安装未生效
// ---------------------------------------------------------------------------
test('安装官方自带层：coreLayer 结果给成功 toast，不报「安装未生效」', async () => {
  const marketPlugins = [marketEntry()];
  const fetchImpl = (url) => {
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: [] });
    if (url.startsWith('/dsh-plugin-manager/updates')) return respond({ checkedAt: null, refreshing: false, inventory: [] });
    if (url.startsWith('/dsh-plugin-manager/disabled')) return respond({ items: [] });
    if (url.startsWith('/dsh-plugin-manager/marketplace')) {
      return respond({
        ok: true, stale: false, total: 1, allTotal: 1, counts: [], categories: ['ui'],
        plugins: marketPlugins, sections: [], featured: marketPlugins, topDownloads: marketPlugins, topStars: marketPlugins,
      });
    }
    if (url.startsWith('/dsh-plugin-manager/install')) {
      return respond({ ok: true, installedAs: '@deepseek-ai/dsh-experimental-x', packageName: '@deepseek-ai/dsh-experimental-x', coreLayer: true });
    }
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '发现');
  await settle(runtime, 6);

  const installBtn = buttonsByText(runtime.tree, '安装')[0];
  assert.ok(installBtn, '市场卡片有安装按钮');
  installBtn.props.onClick();
  await settle(runtime, 12);

  const toasts = toastTexts(runtime.tree);
  assert.ok(toasts.some(text => text.includes('官方层')), '说明这是 dsh 官方层，实际：' + toasts.join(' | '));
  assert.ok(!toasts.some(text => text.includes('安装未生效')), '不把成功安装误报成未生效，实际：' + toasts.join(' | '));
});

test('coreLayers（dsh 自带层）：卡片标「随 dsh 提供」而不是「已安装」，也不挂安装按钮', async () => {
  const marketPlugins = [marketEntry()];
  const fetchImpl = (url) => {
    if (url.startsWith('/dsh-plugin-manager/installed')) {
      // 官方自带层不在 items 里，但 coreLayers 说明它已经装了。
      return respond({ items: [], coreLayers: ['@deepseek-ai/dsh-experimental-alpha'] });
    }
    if (url.startsWith('/dsh-plugin-manager/updates')) return respond({ checkedAt: null, refreshing: false, inventory: [] });
    if (url.startsWith('/dsh-plugin-manager/disabled')) return respond({ items: [] });
    if (url.startsWith('/dsh-plugin-manager/marketplace')) {
      return respond({
        ok: true, stale: false, total: 1, allTotal: 1, counts: [], categories: ['ui'],
        plugins: marketPlugins, sections: [], featured: marketPlugins, topDownloads: marketPlugins, topStars: marketPlugins,
      });
    }
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '发现');
  await settle(runtime, 6);

  // 卡片上不能写「已安装」：那会让人去「已安装」页找，而那里按设计不列 dsh 自带层。
  const cards = findAll(runtime.tree, node => node.type === 'div' && /(^| )dsh-pm-card( |$)/.test(String(node.props.className || '')));
  assert.equal(cards.length, 1, '发现页有一张市场卡片');
  assert.ok(textOf(cards[0]).includes('随 dsh 提供'), '卡片标「随 dsh 提供」，实际：' + textOf(cards[0]));
  assert.equal(textOf(cards[0]).includes('已安装'), false, '卡片不再显示「已安装」');
  const coreTag = findAll(runtime.tree, node => String(node.props.className || '').includes('dsh-pm-core-tag'))[0];
  assert.ok(coreTag, '自带层有独立的灰色标记');
  assert.match(String(coreTag.props.title || ''), /不会出现在「已安装」列表/, 'title 说明为什么不在已安装列表');
  // 手动安装行的按钮也叫「安装」，所以只断言卡片本身不再挂安装按钮。
  assert.equal(buttonsByText(runtime.tree, '安装').length, 1, '只剩手动安装行那一个「安装」按钮');
});

// ---------------------------------------------------------------------------
// 3. 更新在途时点安装：统一串行泵的安装分支
// ---------------------------------------------------------------------------
/**
 * 「更新在途时点安装」这一串时序。
 *
 * 现状（已报作者）：安装队列被两个泵共享——install() 走旧的 pumpInstalls，
 * 统一串行泵 pumpMutations 里也有一份安装分支（runOneInstall）。更新在途时点安装，
 * 两个泵都会看到这个任务，于是同一个插件发两次 /install 请求。
 * 这里把这条时序跑起来，覆盖统一泵的安装分支与它的验收回读。
 *
 * @param listed 装完后已安装列表里有没有这个插件（决定验收回读走「通过」还是「缺席」）。
 */
async function updateThenInstall({ listed }) {
  const marketPlugins = [marketEntry()];
  const calls = [];
  let installedNow = false;
  let releaseUpdate;
  let releaseInstall;
  const updateGate = new Promise(resolve => { releaseUpdate = resolve; });
  const installGate = new Promise(resolve => { releaseInstall = resolve; });
  const fetchImpl = (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url.startsWith('/dsh-plugin-manager/installed')) {
      const items = [{ name: 'dsh-upd', version: '1.0.0' }];
      if (installedNow && listed) items.push({ name: 'owner/alpha', version: '1.0.0' });
      return respond({ items });
    }
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      return respond({
        checkedAt: null, refreshing: false,
        inventory: [{ name: 'dsh-upd', status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' }],
      });
    }
    if (url.startsWith('/dsh-plugin-manager/disabled')) return respond({ items: [] });
    if (url.startsWith('/dsh-plugin-manager/marketplace')) {
      return respond({
        ok: true, stale: false, total: 1, allTotal: 1, counts: [], categories: ['ui'],
        plugins: marketPlugins, sections: [], featured: marketPlugins, topDownloads: marketPlugins, topStars: marketPlugins,
      });
    }
    // 更新与安装都先挂起：时序由测试自己放行，不靠 sleep 赌先后。
    if (url.startsWith('/dsh-plugin-manager/update')) {
      return updateGate.then(() => respond({ ok: true, updatedTo: '2.0.0', verified: true }));
    }
    if (url.startsWith('/dsh-plugin-manager/install')) {
      return installGate.then(() => { installedNow = true; return respond({ ok: true }); });
    }
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '已安装');
  await settle(runtime, 6);

  // 先点更新：串行泵跑起来（updateOne → pumpMutations），更新请求挂着不回。
  const updateBtn = buttonsByText(runtime.tree, '更新')[0];
  assert.ok(updateBtn, '可更新的行有「更新」按钮');
  updateBtn.props.onClick();
  await settle(runtime, 2);
  assert.ok(calls.some(call => call.url.startsWith('/dsh-plugin-manager/update')), '更新请求已发出（还没回）');

  // 更新还在途时切到发现页点安装：安装进队列，但旧泵与统一泵都会看到它。
  await gotoView(runtime, '发现');
  const installBtn = buttonsByText(runtime.tree, '安装')[0];
  assert.ok(installBtn, '市场卡片有安装按钮');
  installBtn.props.onClick();
  await settle(runtime, 2);

  // 放行更新：更新一落地，串行泵就会回头看安装队列，并接手这个安装任务。
  releaseUpdate();
  await settle(runtime, 8);

  // 放行安装：两个安装请求都落地（现状：两个泵各发一次，见上面的说明）。
  releaseInstall();
  await settle(runtime, 16);

  return {
    calls,
    installCalls: calls.filter(call => call.url.startsWith('/dsh-plugin-manager/install')),
    toasts: toastTexts(runtime.tree),
  };
}

test('更新在途时点安装：统一串行泵的安装分支也会跑到（安装队列被两个泵共享）', async () => {
  const result = await updateThenInstall({ listed: true });
  assert.ok(result.installCalls.length >= 1, '安装请求发出，实际次数：' + result.installCalls.length);
  assert.ok(
    result.toasts.some(text => text.includes('已安装')),
    '安装走完给汇总 toast，实际：' + result.toasts.join(' | '),
  );
});

test('更新在途时点安装：统一串行泵的验收回读发现插件没出现就点名报错', async () => {
  const result = await updateThenInstall({ listed: false });
  assert.ok(result.installCalls.length >= 1, '安装请求发出，实际次数：' + result.installCalls.length);
  assert.ok(
    result.toasts.some(text => text.includes('安装未生效') && text.includes('owner/alpha')),
    '验收缺席要点名报错，实际：' + result.toasts.join(' | '),
  );
  assert.ok(!result.toasts.some(text => text.includes('已安装，重启')), '没验收通过就不给成功汇总');
});

// ---------------------------------------------------------------------------
// 4. 批量卸载在途时点更新：waitWhileDestructive 的让行等待
//    （单条卸载已改为入串行泵排队，不再直接占 busy；批量卸载仍是直接操作，
//     泵要在它写 profile 期间让行。）
// ---------------------------------------------------------------------------
test('批量卸载在途时点更新：串行泵等破坏性操作结束再动手', async () => {
  const installed = [
    { name: 'p1', version: '1.0.0', description: '待卸载' },
    { name: 'dsh-upd', version: '1.0.0', description: '可更新' },
  ];
  const calls = [];
  let uninstallFinished = false;
  let updateSentWhileUninstallRunning = null;
  let releaseUninstall;
  const uninstallGate = new Promise(resolve => { releaseUninstall = resolve; });
  const fetchImpl = (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: installed });
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      return respond({
        checkedAt: null, refreshing: false,
        inventory: [{ name: 'dsh-upd', status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' }],
      });
    }
    if (url.startsWith('/dsh-plugin-manager/disabled')) return respond({ items: [] });
    if (url.startsWith('/dsh-plugin-manager/uninstall-many')) {
      // 批量卸载挂着不放：更新必须等它结束（pnpm 串行红线：不能同时写 profile）。
      return uninstallGate.then(() => { uninstallFinished = true; return respond({ ok: true, results: [{ name: 'p1', ok: true }] }); });
    }
    if (url.startsWith('/dsh-plugin-manager/update')) {
      updateSentWhileUninstallRunning = !uninstallFinished;
      return respond({ ok: true, updatedTo: '2.0.0', verified: true });
    }
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '已安装');
  await settle(runtime, 6);

  // 先批量卸载 p1（走确认框），卸载请求在途。
  const checkbox = findAll(runtime.tree, node => node.type === 'input' && String(node.props.className).includes('dsh-pm-check'))[0];
  checkbox.props.onChange({ shiftKey: false });
  await settle(runtime, 4);
  const batchBtn = buttonsByText(runtime.tree, '批量卸载 (1)')[0];
  assert.ok(batchBtn, '选中一行后出现「批量卸载 (1)」');
  batchBtn.props.onClick();
  await settle(runtime, 4);
  const confirmBtn = buttonsByText(runtime.tree, '确认卸载')[0];
  assert.ok(confirmBtn, '弹出批量卸载确认框');
  confirmBtn.props.onClick();
  await settle(runtime, 2);

  // 卸载还在途时点更新：串行泵要先让行（waitWhileDestructive）。
  const updateBtn = buttonsByText(runtime.tree, '更新')[0];
  assert.ok(updateBtn, '可更新的行有「更新」按钮');
  updateBtn.props.onClick();
  await settle(runtime, 2);
  assert.equal(updateSentWhileUninstallRunning, null, '更新请求还没发出去（泵在让行）');

  // 放行卸载：泵的等待结束，更新才真正发出去。
  releaseUninstall();
  // 泵每 250ms 轮询一次 busy 状态，所以这里**轮询等**更新请求出现，
  // 而不是赌一个固定延时 —— 固定延时在机器负载高时会偶发失败。
  await waitFor(() => calls.some(call => call.url === '/dsh-plugin-manager/update'), { runtime });
  await settle(runtime, 12);

  assert.ok(calls.some(call => call.url.startsWith('/dsh-plugin-manager/uninstall-many')), '发了批量卸载请求');
  assert.ok(calls.some(call => call.url.startsWith('/dsh-plugin-manager/update')), '更新请求最终发出');
  assert.equal(updateSentWhileUninstallRunning, false, '更新请求必须在卸载结束之后才发出（否则就是并发写 profile）');
  assert.ok(uninstallFinished, '卸载已完成');
});

// ---------------------------------------------------------------------------
// 4b. 单条卸载失败：走串行泵执行，失败要 toast 报错
// ---------------------------------------------------------------------------
test('单条卸载失败：泵里执行卸载，失败如实报错', async () => {
  const installed = [{ name: 'bad-one', version: '1.0.0', description: '删不掉' }];
  const fetchImpl = url => {
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: installed });
    if (url.startsWith('/dsh-plugin-manager/updates')) return respond({ checkedAt: null, refreshing: false, inventory: [] });
    if (url.startsWith('/dsh-plugin-manager/disabled')) return respond({ items: [] });
    if (url === '/dsh-plugin-manager/uninstall') return respond({ error: '删不掉' });
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '已安装');
  await settle(runtime, 6);

  buttonsByText(runtime.tree, '卸载')[0].props.onClick();
  await settle(runtime, 4);
  buttonsByText(runtime.tree, '确认卸载')[0].props.onClick();
  await settle(runtime, 20);
  assert.ok(
    toastTexts(runtime.tree).some(text => text.includes('卸载失败：删不掉')),
    '卸载失败要 toast 报错，实际：' + toastTexts(runtime.tree).join(' | '),
  );
});

// ---------------------------------------------------------------------------
// 5. 发布说明读取失败（接口抛错，不是返回 error JSON）
// ---------------------------------------------------------------------------
test('发布说明读取失败：接口抛错时弹错误而不是空白', async () => {
  const fetchImpl = url => {
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: [{ name: 'dsh-notes', version: '1.0.0', description: '插件' }] });
    if (url.startsWith('/dsh-plugin-manager/updates')) {
      return respond({
        checkedAt: null, refreshing: false,
        inventory: [{ name: 'dsh-notes', status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0' }],
      });
    }
    if (url.startsWith('/dsh-plugin-manager/release-notes')) return Promise.reject(new Error('GitHub 连不上'));
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '已安装');
  await settle(runtime, 6);

  const notesBtn = buttonsByText(runtime.tree, '更新内容')[0];
  assert.ok(notesBtn, '有「更新内容」入口');
  notesBtn.props.onClick({ stopPropagation() {} });
  await settle(runtime, 8);

  const text = textOf(runtime.tree);
  assert.ok(text.includes('GitHub 连不上'), '发布说明失败给出错误原因，实际：' + text.slice(-200));
  assert.ok(text.includes('dsh-notes v2.0.0 的更新内容'), '弹窗仍然打开，实际：' + text.slice(0, 120));
});

// ---------------------------------------------------------------------------
// 6. 停用失败回滚：本来就没有该条目 → 删掉乐观写进去的那条
// ---------------------------------------------------------------------------
test('停用失败回滚：本来没有该条目时把乐观写进去的条目删掉', async () => {
  const installed = [{ name: 'dsh-plain', version: '1.0.0', description: '普通插件' }];
  const calls = [];
  const fetchImpl = (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url.startsWith('/dsh-plugin-manager/installed')) return respond({ items: installed });
    if (url.startsWith('/dsh-plugin-manager/updates')) return respond({ checkedAt: null, refreshing: false, inventory: [] });
    // 服务端没回这个插件的停用状态 → 开关读不到状态，置灰不猜。
    if (url.startsWith('/dsh-plugin-manager/disabled')) return respond({ items: [] });
    // 停用请求慢一点：先把「乐观切状态」拍下来，再看回滚。
    if (url.startsWith('/dsh-plugin-manager/set-disabled')) return wait(200).then(() => respond({ error: '停用失败：dsh 拒绝了' }));
    return respond({});
  };
  const { runtime, plugin } = boot({ fetchImpl });
  runtime.render(runtime.makeReact().createElement(plugin.PluginTrigger, { wide: true }));
  await settle(runtime);
  await openPanelOn(runtime, '已安装');
  await settle(runtime, 6);

  const switches = () => findAll(runtime.tree, node => node.type === 'input' && node.props.role === 'switch');
  const switchLabel = () => {
    const labels = findAll(runtime.tree, node => node.type === 'label' && String(node.props.className || '').includes('dsh-pm-switch'));
    return labels[0] ? textOf(labels[0]) : '';
  };
  assert.equal(switches().length, 1, '已安装插件有一个开关（内置插件不再出现在这页）');
  assert.equal(switches()[0].props.disabled, true, '读不到停用状态时开关置灰');
  assert.equal(switchLabel(), '状态未知', '读不到状态时如实显示');

  // 开关是置灰的（UI 不会让用户点），但回滚分支仍必须正确：
  // 乐观写进去的条目在失败后要删掉，不能留下幽灵条目。
  switches()[0].props.onChange();
  await settle(runtime, 3);
  assert.ok(calls.some(call => call.url.startsWith('/dsh-plugin-manager/set-disabled')), '发了停用请求');
  assert.notEqual(switchLabel(), '状态未知', '点完先乐观切状态，实际：' + switchLabel());

  await wait(400);
  await settle(runtime, 10);
  assert.equal(switchLabel(), '状态未知', '失败回滚后回到「状态未知」（条目被删掉），实际：' + switchLabel());
  assert.equal(switches()[0].props.disabled, true, '回滚后开关仍置灰');
  assert.ok(
    toastTexts(runtime.tree).some(text => /dsh-plain 失败/.test(text)),
    '失败要 toast 报错，实际：' + toastTexts(runtime.tree).join(' | '),
  );
});

// ---------------------------------------------------------------------------
// 7. 面板 Root 挂载契约（常驻挂载 + window 事件打开 + main/sidebar 注册）
// ---------------------------------------------------------------------------
/**
 * 面板挂载这一段需要真的把 Root 组件跑起来（useState/useEffect），
 * 所以这里用一份带真实 hook 语义的迷你 React；组件本体不渲染（那是冒烟的活）。
 */
function bootMount({ legacy = false } = {}) {
  const documentStub = makeDocument();
  const windowHandlers = new Map();
  const hosts = [];
  const renderedElements = [];
  const legacyRenders = [];
  const registrations = [];
  const hookStates = [];
  const hookDeps = [];
  const pendingEffects = [];
  let hookIndex = 0;

  const reactStub = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookStates)) hookStates[index] = typeof initial === 'function' ? initial() : initial;
      const setState = next => { hookStates[index] = typeof next === 'function' ? next(hookStates[index]) : next; };
      return [hookStates[index], setState];
    },
    useMemo: fn => fn(),
    useEffect(fn, deps = []) {
      const index = hookIndex++;
      const stored = hookDeps[index];
      if (!stored || deps.length !== stored.deps.length || deps.some((d, i) => d !== stored.deps[i])) {
        hookDeps[index] = { deps };
        pendingEffects.push(fn);
      }
    },
    useRef: initial => ({ current: initial }),
  };

  let plugin;
  const windowStub = {
    __ModuleLoader__: {
      load(record) {
        plugin = record.factory(name => {
          if (name === 'react') return reactStub;
          if (name === 'react-dom/client') {
            // 老宿主没有 react-dom/client：挂载要走 require('react-dom').render。
            if (legacy) throw new Error('no react-dom/client');
            return { createRoot: host => { hosts.push(host); return { render: el => renderedElements.push(el) }; } };
          }
          if (name === 'react-dom') return { render: (el, host) => legacyRenders.push({ el, host }) };
          throw new Error('unexpected require ' + name);
        });
      },
    },
    addEventListener(type, fn) { windowHandlers.set(type, fn); },
    removeEventListener(type, fn) { if (windowHandlers.get(type) === fn) windowHandlers.delete(type); },
  };
  vm.runInNewContext(source, {
    window: windowStub,
    document: documentStub,
    fetch: () => respond({}),
    setTimeout: () => 0,
    setInterval: () => 0,
    clearInterval: () => {},
    ReadableStream,
    TextEncoder,
    TextDecoder,
  }, { filename: SOURCE_PATH });
  assert.ok(plugin, 'client factory 必须返回插件对象');

  const ctx = {
    slots: {
      inject(name, cb) { cb(); },
      register(spec, component) { registrations.push({ ...spec, component }); return () => {}; },
    },
    layout: { selectPanel() {} },
  };

  /** 渲染一次 Root 组件（组件本体跑起来，children 不展开）。 */
  function renderRoot() {
    hookIndex = 0;
    const element = renderedElements[0];
    const out = element.type(element.props);
    const effects = pendingEffects.splice(0);
    for (const effect of effects) effect();
    return out;
  }

  return {
    plugin, ctx, registrations, hosts, renderedElements, legacyRenders, windowHandlers, document: documentStub,
    renderRoot,
    apply() { plugin.apply(ctx); },
  };
}

test('面板挂载契约：常驻挂一次、由 window 事件打开、main 与 sidebar 都注册', () => {
  const mount = bootMount();
  mount.apply();

  assert.equal(mount.hosts.length, 1, '面板挂到 body 一次');
  assert.equal(mount.renderedElements.length, 1, 'Root 组件被渲染一次');
  assert.equal(mount.hosts[0].id, 'dsh-plugin-manager-root', '挂在固定的 root 节点上');

  // Root：初始关闭 → window 事件打开 → 渲染面板本体。
  const closed = mount.renderRoot();
  assert.equal(closed, null, 'Root 默认不显示面板');
  assert.ok(mount.windowHandlers.has('dsh-plugin-manager:open'), 'Root 监听打开事件');
  mount.windowHandlers.get('dsh-plugin-manager:open')();
  const opened = mount.renderRoot();
  assert.ok(opened && typeof opened.type === 'function', '打开后渲染面板本体');
  assert.equal(opened.type.name, 'PluginManagerPage', '打开的是插件管理页');
  assert.equal(opened.props.wide, true, '面板本体是宽屏形态');

  // 再 apply 一次：面板已经挂过，不再挂第二份（否则两份状态、事件只开一份）。
  mount.apply();
  assert.equal(mount.hosts.length, 1, '重复 apply 不会挂第二份面板');
  assert.equal(mount.document.getElementById('dsh-plugin-manager-root') !== null, true, 'root 节点还在');

  // main slot 注册的是页面本体。
  const mainSpec = mount.registrations.find(spec => spec.name === 'main');
  assert.ok(mainSpec, 'main slot 注册了页面');
  assert.equal(mainSpec.key, 'dsh-plugin-manager');
  const mainElement = mainSpec.component();
  assert.ok(mainElement && typeof mainElement.type === 'function', 'main 注册的是组件');
  assert.equal(mainElement.type.name, 'PluginManagerPage', 'main 组件渲染插件管理页');
  assert.equal(mainElement.props.wide, true);

  // sidebar.panellist 注册的是入口图标。
  const sidebarSpec = mount.registrations.find(spec => spec.name === 'sidebar.panellist');
  assert.ok(sidebarSpec, 'sidebar 注册了入口');
  assert.equal(sidebarSpec.label, '插件管理');
  const entryElement = sidebarSpec.component();
  assert.equal(entryElement.type, 'span', '入口渲染成一个图标节点');
  assert.equal(entryElement.props.className, 'dsh-pm-trigger-icon');
  assert.equal(entryElement.props['aria-hidden'], true, '纯装饰图标对读屏隐藏');
});

test('面板挂载契约：老宿主没有 react-dom/client 时走 require("react-dom").render', () => {
  const mount = bootMount({ legacy: true });
  mount.apply();

  assert.equal(mount.document.created.has('dsh-plugin-manager-root'), true, '面板照样挂到 body');
  assert.equal(mount.legacyRenders.length, 1, '走了老宿主的 react-dom.render');
  assert.equal(mount.renderedElements.length, 0, '没有走 createRoot');
  const legacy = mount.legacyRenders[0];
  assert.ok(legacy.el && typeof legacy.el.type === 'function', '渲染的是 Root 组件');
  assert.equal(legacy.el.type.name, 'Root', '渲染的是面板 Root');
  assert.equal(legacy.host.id, 'dsh-plugin-manager-root', '渲染到挂载节点上');
});
