// 极简 React 运行时（测试替身）：只实现归档面板真正用到的 API ——
// createElement / Fragment / useState / useEffect / useRef —— 足以把
// client.js 真的渲染一遍并驱动交互（搜索、勾选、全选、删除确认、还原…）。
//
// 与真实 React 的差别只有一处，且只为了覆盖组件的另一种形态：
// `runtime.overrideProps(fn)` 允许测试覆写组件收到的 props。宿主当前把
// 面板挂在 main slot 上（autoOpen=true，面板直接展开），而同一个组件也
// 支持 autoOpen=false 的「侧栏触发按钮」形态；测试要把两种形态都渲染一遍。
//
// 组件状态按「组件实例」存放（与 React 的 hook 顺序语义一致）：同一个
// 组件在多次渲染间保留 useState 的值，useEffect 的依赖没变就不重跑。

export const FRAGMENT = Symbol('react.fragment');

/** 把 children 摊平成一维数组（去掉 null/undefined/boolean）。 */
export function flatten(children) {
  const out = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flatten(child));
    else if (child !== null && child !== undefined && child !== false && child !== true) out.push(child);
  }
  return out;
}

export class Runtime {
  constructor() {
    this.slots = new Map();
    this.current = null;
    this.pendingEffects = [];
    /** (type, props) => 覆写后的 props（返回 null 表示不覆写）。 */
    this.overrideProps = null;
  }

  slotFor(key) {
    if (!this.slots.has(key)) this.slots.set(key, { order: 0, states: [], deps: [], pending: [] });
    return this.slots.get(key);
  }

  component(element, parentKey, occurrence) {
    const key = `${parentKey}|${(element.type && element.type.name) || 'anon'}:${occurrence}`;
    const slot = this.slotFor(key);
    slot.order = 0;
    this.current = slot;
    const props = this.overrideProps
      ? { ...element.props, ...(this.overrideProps(element.type, element.props) || {}) }
      : element.props;
    const rendered = element.type(props);
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
        }];
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
        if (!stored || deps.length !== stored.deps.length || deps.some((dep, i) => dep !== stored.deps[i])) {
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

/** 找出树里所有满足条件的宿主节点。 */
export function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out; }
  if (typeof node.type === 'string' && predicate(node)) out.push(node);
  for (const child of node.children || []) findAll(child, predicate, out);
  return out;
}

/** 节点的可见文本。 */
export function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children || []).map(textOf).join('');
}

/** 按 class 名片段找节点。 */
export function byClass(tree, token) {
  return findAll(tree, node => String(node.props.className || '').split(/\s+/).includes(token));
}

/** 按可见文本精确找节点。 */
export function findByText(tree, tag, text) {
  return findAll(tree, node => node.type === tag && textOf(node) === text)[0];
}

/** 把 ref 挂到节点上（真实 React 会把 DOM 节点交给 ref，这里给个替身）。 */
export function applyRef(element, node) {
  const ref = element && element.props && element.props.ref;
  if (typeof ref === 'function') ref(node);
  else if (ref && typeof ref === 'object') ref.current = node;
}

export const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** 跑几轮「重绘 + 让 Promise 微任务落地」，等 fetch 之类的异步更新落进状态。 */
export async function settle(runtime, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await tick();
    runtime.repaint();
  }
  return runtime.tree;
}
