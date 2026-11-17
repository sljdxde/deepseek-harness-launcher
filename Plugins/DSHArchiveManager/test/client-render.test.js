// 归档管理客户端 UI 的渲染测试：用极简 React 运行时 + 假 fetch/document 把
// client.js 真的渲染一遍，覆盖列表 / 搜索 / 全选 / 还原 / 删除确认等交互。
// 纯函数单测覆盖不到「组件接线」——按钮点下去有没有真的发请求、列表有没有
// 真的更新——由这里兜住。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  Runtime, applyRef, byClass, findAll, findByText, settle, textOf,
} from './helpers/react-runtime.js';

const SOURCE_URL = new URL('../client/client.js', import.meta.url);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);

const ITEMS = [
  { id: 's1', title: '会话一', workspace: '项目', descendants: 1 },
  { id: 's2', title: '会话二', workspace: '其他', descendants: 0 },
];

/**
 * 装载浏览器半边。
 * @param options.fetchImpl - 假 fetch（记录调用，返回带 json() 的响应）。
 * @param options.overrideProps - 覆写组件 props（渲染组件的另一种形态）。
 */
async function boot({ fetchImpl, overrideProps = null } = {}) {
  const source = await readFile(SOURCE_URL, 'utf8');
  const runtime = new Runtime();
  runtime.overrideProps = overrideProps;
  const react = runtime.makeReact();
  const styles = new Map();
  const document = {
    getElementById: id => styles.get(id) || null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild(element) { styles.set(element.id, element); } },
  };
  let plugin;
  const window = {
    __ModuleLoader__: {
      load(record) {
        plugin = record.factory(name => {
          if (name === 'react') return react;
          throw new Error('unexpected require ' + name);
        });
      },
    },
  };
  // 带 filename：node 的 coverage 才会把这段 vm 代码算进 client.js 名下。
  vm.runInNewContext(source, { window, document, fetch: fetchImpl, setTimeout, clearTimeout }, { filename: SOURCE_PATH });
  assert.ok(plugin, 'client.js 必须注册插件');

  const registered = [];
  const closed = [];
  const ctx = {
    slots: {
      inject(name, callback) { callback(); },
      register(spec, component) { registered.push({ spec, component }); return { id: spec.key || spec.id }; },
    },
    layout: { selectPanel(id) { closed.push(id); } },
    locale: {},
  };
  plugin.apply(ctx);

  const main = registered.find(entry => entry.spec.name === 'main').component;
  const sidebar = registered.find(entry => entry.spec.name === 'sidebar.panellist').component;
  return { runtime, react, main, sidebar, styles, closed };
}

/** 假 fetch：按 URL 分发固定响应，并记录调用。 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    for (const [prefix, respond] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) {
        const value = typeof respond === 'function' ? await respond(String(url), options) : respond;
        return { ok: true, status: 200, json: async () => value };
      }
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

const rowsOf = tree => findAll(tree, node => node.type === 'div' && /(^| )dsh-archive-row( |$)/.test(String(node.props.className || '')));
const checkboxesOf = tree => findAll(tree, node => node.type === 'input' && String(node.props['aria-label'] || '').startsWith('选择 '));
const selectAllOf = tree => findAll(tree, node => node.type === 'input' && /^(全选|取消全选)$/.test(String(node.props['aria-label'] || '')))[0];
const buttonOf = (tree, text) => findByText(tree, 'button', text);
const buttonByLabel = (tree, label) => findAll(tree, node => node.type === 'button' && node.props['aria-label'] === label)[0];

test('主面板形态：加载归档列表，行、计数与元信息都渲染出来', async () => {
  const { calls, fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  assert.equal(calls[0].url, '/dsh-archive-manager/archives', '打开面板即拉列表');
  assert.equal(calls[0].options.cache, 'no-store', '列表请求不走缓存');
  const tree = runtime.tree;
  assert.equal(rowsOf(tree).length, 2, '两条归档会话各一行');
  const text = textOf(tree);
  assert.ok(text.includes('归档管理'), '面板有标题');
  assert.ok(text.includes('2 个归档会话'), '头部显示归档数量');
  assert.ok(text.includes('会话一') && text.includes('会话二'), '行里显示标题');
  assert.ok(text.includes('项目') && text.includes('其他'), '行里显示所属工作区');
  assert.ok(text.includes('1 个后代'), '行里显示后代数量');
  assert.equal(byClass(tree, 'dsh-archive-empty').length, 0, '有数据时不显示空态');
});

test('搜索：按标题与工作区本地过滤，计数同步', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  const search = findAll(runtime.tree, node => node.type === 'input' && node.props['aria-label'] === '搜索归档会话')[0];
  assert.ok(search, '面板有搜索框');
  search.props.onChange({ target: { value: '会话一' } });
  await settle(runtime);
  assert.equal(rowsOf(runtime.tree).length, 1, '按标题过滤只剩一条');
  assert.ok(textOf(runtime.tree).includes('2 个归档会话 · 匹配 1 个'), '计数带上匹配数');

  search.props.onChange({ target: { value: '项目' } });
  await settle(runtime);
  assert.equal(rowsOf(runtime.tree).length, 1, '按工作区过滤也命中');

  search.props.onChange({ target: { value: '不存在的关键词' } });
  await settle(runtime);
  assert.equal(rowsOf(runtime.tree).length, 0, '无匹配时没有行');
  assert.ok(textOf(runtime.tree).includes('没有匹配的归档会话'), '无匹配时给的是搜索空态');
  assert.ok(textOf(runtime.tree).includes('换个关键词试试'), '空态有说明文案');
});

test('全选与逐行勾选：选中计数、按钮可用性与半选态', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  assert.equal(selectAllOf(runtime.tree).props.disabled, false, '有数据时全选可用');
  assert.equal(buttonOf(runtime.tree, '还原选中').props.disabled, true, '没选中时「还原选中」禁用');
  assert.equal(buttonOf(runtime.tree, '删除选中').props.disabled, true, '没选中时「删除选中」禁用');

  // 真实 React 会把 DOM 节点交给 ref；这里给个替身，让「半选」效果有落点。
  const refTarget = { indeterminate: false };
  applyRef(selectAllOf(runtime.tree), refTarget);

  selectAllOf(runtime.tree).props.onChange();
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 2 个'), '全选后显示已选 2 个');
  assert.ok(textOf(runtime.tree).includes('还原选中 (2)'), '按钮文案带数量');
  assert.equal(buttonOf(runtime.tree, '还原选中 (2)').props.disabled, false, '选中后「还原选中」可用');
  assert.equal(buttonOf(runtime.tree, '删除选中 (2)').props.disabled, false, '选中后「删除选中」可用');

  // 再点一次全选 → 清空
  selectAllOf(runtime.tree).props.onChange();
  await settle(runtime);
  assert.equal(buttonOf(runtime.tree, '还原选中').props.disabled, true, '再点全选清空选择');
  assert.equal(textOf(runtime.tree).includes('已选 2 个'), false, '清空后不再显示选中数');

  // 逐行勾选：半选态（选中数少于总数）
  checkboxesOf(runtime.tree)[0].props.onChange();
  await settle(runtime);
  assert.ok(textOf(runtime.tree).includes('已选 1 个'), '勾选一行后计数为 1');
  assert.equal(refTarget.indeterminate, true, '部分选中时全选框是半选态');
  checkboxesOf(runtime.tree)[0].props.onChange();
  await settle(runtime);
  assert.equal(refTarget.indeterminate, false, '没有选中时不再是半选态');
  assert.equal(buttonOf(runtime.tree, '还原选中').props.disabled, true, '取消勾选后又回到未选中');
});

test('删除：就地确认 → 取消 → 再确认，确认后真的发请求并更新列表', async () => {
  const { calls, fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': { items: ITEMS },
    '/dsh-archive-manager/delete': { roots: ['s1'], deleted: ['s1'], directories: 1, cleanupPending: false },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  // 行内「删除」：先弹就地确认，不发请求
  const rowDelete = findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '删除')[0];
  rowDelete.props.onClick();
  await settle(runtime);
  assert.equal(calls.filter(call => call.url === '/dsh-archive-manager/delete').length, 0, '点「删除」只弹确认，不发请求');
  assert.ok(textOf(runtime.tree).includes('确认删除 1 个归档会话？'), '确认块有标题');
  assert.ok(textOf(runtime.tree).includes('共 2 个会话'), '确认块算出连后代在内的总数');
  assert.equal(byClass(runtime.tree, 'dsh-archive-confirm').length, 1, '确认块渲染出来了');

  // 取消：确认块消失，仍不发请求
  buttonOf(runtime.tree, '取消').props.onClick();
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-archive-confirm').length, 0, '取消后确认块消失');
  assert.equal(calls.filter(call => call.url === '/dsh-archive-manager/delete').length, 0, '取消不发请求');

  // 再确认：发请求，成功后行从列表里消失（顺便勾一行，让「已选集合」也一起被清掉）
  checkboxesOf(runtime.tree)[0].props.onChange();
  await settle(runtime);
  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '删除')[0].props.onClick();
  await settle(runtime);
  buttonOf(runtime.tree, '确认删除').props.onClick();
  await settle(runtime);
  const del = calls.find(call => call.url === '/dsh-archive-manager/delete');
  assert.ok(del, '确认后发出删除请求');
  assert.equal(del.options.method, 'POST');
  assert.deepEqual(JSON.parse(del.options.body), { sessionIds: ['s1'] }, '请求体带上要删的会话 id');
  assert.equal(rowsOf(runtime.tree).length, 1, '删除成功后该行从列表消失');
  assert.ok(textOf(runtime.tree).includes('会话二'), '剩下的是没删的那条');
  assert.equal(buttonOf(runtime.tree, '还原选中').props.disabled, true, '删除后已选集合也被清空');
});

test('删除进行中：按钮禁用并显示「删除中…」，此时点背景不关闭面板', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { calls, fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': { items: ITEMS },
    '/dsh-archive-manager/delete': async () => { await pending; return { roots: ['s1'], deleted: ['s1'], directories: 1, cleanupPending: false }; },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '删除')[0].props.onClick();
  await settle(runtime);
  buttonOf(runtime.tree, '确认删除').props.onClick();
  await settle(runtime, 2);

  assert.ok(textOf(runtime.tree).includes('删除中…'), '删除进行中按钮文案变成「删除中…」');
  assert.equal(buttonOf(runtime.tree, '删除中…').props.disabled, true, '删除进行中按钮禁用');
  assert.equal(buttonOf(runtime.tree, '取消').props.disabled, true, '删除进行中「取消」也禁用');
  assert.equal(buttonByLabel(runtime.tree, '关闭').props.disabled, undefined, '关闭按钮没有 disabled 属性');

  // 进行中点背景：不应关闭（busy 时 backdrop 的点击被忽略）
  const backdrop = byClass(runtime.tree, 'dsh-archive-backdrop')[0];
  backdrop.props.onClick();
  await settle(runtime, 2);
  assert.equal(byClass(runtime.tree, 'dsh-archive-modal').length, 1, '删除进行中点背景不关闭面板');

  release();
  await settle(runtime);
  assert.equal(calls.filter(call => call.url === '/dsh-archive-manager/delete').length, 1, '删除请求只发一次');
  assert.equal(rowsOf(runtime.tree).length, 1, '删除完成后列表少一行');
});

test('删除失败：服务端报错时显示错误条，列表不变', async () => {
  const { fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': { items: ITEMS },
    '/dsh-archive-manager/delete': { error: '删除失败：会话正在运行' },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '删除')[0].props.onClick();
  await settle(runtime);
  buttonOf(runtime.tree, '确认删除').props.onClick();
  await settle(runtime);

  const error = byClass(runtime.tree, 'dsh-archive-error')[0];
  assert.ok(error, '删除失败显示错误条');
  assert.equal(textOf(error), '删除失败：会话正在运行', '错误条显示服务端给的错误');
  assert.equal(rowsOf(runtime.tree).length, 2, '删除失败时列表保持原样');
});

test('还原：行内还原与「还原选中」都走 /restore，成功后行消失', async () => {
  const { calls, fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': { items: ITEMS },
    '/dsh-archive-manager/restore': { roots: ['s1'], restored: 1, attached: [] },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  // 行内「还原」
  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '还原')[0].props.onClick();
  await settle(runtime);
  const restore = calls.find(call => call.url === '/dsh-archive-manager/restore');
  assert.ok(restore, '点「还原」发出请求');
  assert.deepEqual(JSON.parse(restore.options.body), { sessionIds: ['s1'] }, '请求体带上会话 id');
  assert.equal(rowsOf(runtime.tree).length, 1, '还原成功后该行从列表消失');

  // 「还原选中」：先勾选再点
  checkboxesOf(runtime.tree)[0].props.onChange();
  await settle(runtime);
  buttonOf(runtime.tree, '还原选中 (1)').props.onClick();
  await settle(runtime);
  const restores = calls.filter(call => call.url === '/dsh-archive-manager/restore');
  assert.equal(restores.length, 2, '两个还原动作各发一次请求');
  assert.deepEqual(JSON.parse(restores[1].options.body), { sessionIds: ['s2'] }, '批量还原带上选中的 id');
  assert.equal(rowsOf(runtime.tree).length, 0, '都还原完后列表空了');
});

test('还原失败：服务端报错时显示错误条', async () => {
  const { fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': { items: ITEMS },
    '/dsh-archive-manager/restore': { error: '还原失败' },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '还原')[0].props.onClick();
  await settle(runtime);
  const error = byClass(runtime.tree, 'dsh-archive-error')[0];
  assert.ok(error, '还原失败显示错误条');
  assert.equal(textOf(error), '还原失败');
});

test('空态：没有归档会话时给引导文案', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: [] } });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  assert.equal(byClass(runtime.tree, 'dsh-archive-empty').length, 1, '没有归档时显示空态');
  assert.ok(textOf(runtime.tree).includes('暂无归档会话'), '空态主句');
  assert.ok(textOf(runtime.tree).includes('在会话列表里归档的会话会出现在这里'), '空态说明');
  assert.ok(textOf(runtime.tree).includes('0 个归档会话'), '头部显示 0 个');
  assert.equal(selectAllOf(runtime.tree).props.disabled, true, '空列表时全选禁用');
});

test('接口没有返回 items 字段时按空列表处理', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { total: 0 } });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);
  assert.equal(rowsOf(runtime.tree).length, 0, '没有 items 就当空列表');
  assert.equal(byClass(runtime.tree, 'dsh-archive-empty').length, 1, '显示空态');
});

test('请求直接失败（抛的不是 Error 对象）时错误条也能显示出来', async () => {
  const { fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': () => { throw '网络断了'; },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);
  const error = byClass(runtime.tree, 'dsh-archive-error')[0];
  assert.ok(error, '请求失败显示错误条');
  assert.equal(textOf(error), '网络断了', '不是 Error 对象的失败也能显示出来');
});

test('删除/还原失败（抛的不是 Error 对象）时错误条也能显示出来', async () => {
  const { fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': { items: ITEMS },
    '/dsh-archive-manager/delete': () => { throw '删除请求炸了'; },
    '/dsh-archive-manager/restore': () => { throw '还原请求炸了'; },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '还原')[0].props.onClick();
  await settle(runtime);
  assert.equal(textOf(byClass(runtime.tree, 'dsh-archive-error')[0]), '还原请求炸了');

  findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '删除')[0].props.onClick();
  await settle(runtime);
  buttonOf(runtime.tree, '确认删除').props.onClick();
  await settle(runtime);
  assert.equal(textOf(byClass(runtime.tree, 'dsh-archive-error')[0]), '删除请求炸了');
});

test('工具栏按钮：没有选中任何会话时点了也不发请求', async () => {
  const { calls, fetchImpl } = fakeFetch({
    '/dsh-archive-manager/archives': { items: ITEMS },
    '/dsh-archive-manager/restore': { roots: [], restored: 0, attached: [] },
  });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  // 「还原选中」：选中为空 → 直接返回，不发请求
  buttonOf(runtime.tree, '还原选中').props.onClick();
  await settle(runtime);
  assert.equal(calls.filter(call => call.url === '/dsh-archive-manager/restore').length, 0, '没有选中就不发还原请求');

  // 「删除选中」：选中为空 → 什么都不做
  buttonOf(runtime.tree, '删除选中').props.onClick();
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-archive-confirm').length, 0, '没有选中就不弹删除确认');
  assert.equal(calls.filter(call => call.url === '/dsh-archive-manager/delete').length, 0, '没有选中就不发删除请求');
});

test('接口报错：列表接口返回 error 时显示错误条', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { error: '读取失败' } });
  const { runtime, react, main } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  const error = byClass(runtime.tree, 'dsh-archive-error')[0];
  assert.ok(error, '接口报错时显示错误条');
  assert.equal(textOf(error), '读取失败', '错误条显示服务端给的错误');
  assert.equal(rowsOf(runtime.tree).length, 0, '报错时没有行');
});

test('触发按钮形态（autoOpen=false）：点触发器才打开面板', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, main } = await boot({
    fetchImpl,
    // 组件支持两种形态：宿主当前挂的是 autoOpen=true 的主面板，
    // 这里渲染 autoOpen=false 的「侧栏触发按钮」形态。
    overrideProps: (type) => (type && type.name === 'ArchivePanel' ? { autoOpen: false } : null),
  });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);

  const trigger = findAll(runtime.tree, node => node.type === 'button' && node.props['aria-label'] === '归档管理')[0];
  assert.ok(trigger, '触发按钮渲染出来了');
  assert.ok(textOf(trigger).includes('归档'), '宽栏触发按钮带文字');
  assert.equal(byClass(runtime.tree, 'dsh-archive-modal').length, 0, '点之前面板没打开');
  assert.equal(byClass(runtime.tree, 'dsh-archive-trigger').length, 1, '触发按钮用了触发器样式');

  trigger.props.onClick();
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-archive-modal').length, 1, '点触发器后面板打开');
  assert.equal(rowsOf(runtime.tree).length, 2, '打开后加载出两条归档');
});

test('触发按钮形态（窄栏）：只显示图标，不带文字', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, main } = await boot({
    fetchImpl,
    overrideProps: (type) => (type && type.name === 'ArchivePanel' ? { autoOpen: false, wide: false } : null),
  });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);
  const trigger = findAll(runtime.tree, node => node.type === 'button' && node.props['aria-label'] === '归档管理')[0];
  assert.ok(trigger, '窄栏也有触发按钮');
  assert.ok(String(trigger.props.className).includes('dsh-archive-trigger-rail'), '窄栏用圆形样式');
  assert.equal(textOf(trigger).includes('归档'), false, '窄栏不显示文字');
});

test('关闭：宿主给了 onClose 就交给宿主关，没给就自己收起', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const withHostClose = await boot({
    fetchImpl,
    overrideProps: (type) => (type && type.name === 'ArchivePanel' ? { autoOpen: false } : null),
  });
  withHostClose.runtime.render(withHostClose.react.createElement(withHostClose.main, {}));
  await settle(withHostClose.runtime);
  findAll(withHostClose.runtime.tree, node => node.type === 'button' && node.props['aria-label'] === '归档管理')[0].props.onClick();
  await settle(withHostClose.runtime);
  buttonByLabel(withHostClose.runtime.tree, '关闭').props.onClick();
  await settle(withHostClose.runtime);
  assert.deepEqual(withHostClose.closed, [null], '有 onClose 时通知宿主收起面板');
  assert.equal(byClass(withHostClose.runtime.tree, 'dsh-archive-modal').length, 1, '组件自己不关（等宿主摘掉面板）');

  // 没有 onClose 的形态：组件自己收起
  const standalone = await boot({
    fetchImpl,
    overrideProps: (type) => (type && type.name === 'ArchivePanel' ? { autoOpen: false, onClose: undefined } : null),
  });
  standalone.runtime.render(standalone.react.createElement(standalone.main, {}));
  await settle(standalone.runtime);
  findAll(standalone.runtime.tree, node => node.type === 'button' && node.props['aria-label'] === '归档管理')[0].props.onClick();
  await settle(standalone.runtime);
  assert.equal(byClass(standalone.runtime.tree, 'dsh-archive-modal').length, 1, '面板已打开');
  buttonByLabel(standalone.runtime.tree, '关闭').props.onClick();
  await settle(standalone.runtime);
  assert.equal(byClass(standalone.runtime.tree, 'dsh-archive-modal').length, 0, '没有 onClose 时组件自己收起面板');
});

test('点背景也能收起面板', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, main } = await boot({
    fetchImpl,
    overrideProps: (type) => (type && type.name === 'ArchivePanel' ? { autoOpen: false, onClose: undefined } : null),
  });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);
  findAll(runtime.tree, node => node.type === 'button' && node.props['aria-label'] === '归档管理')[0].props.onClick();
  await settle(runtime);
  byClass(runtime.tree, 'dsh-archive-backdrop')[0].props.onClick();
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-archive-modal').length, 0, '点背景收起面板');
});

test('侧栏入口：sidebar.panellist 渲染的是图标，不是面板', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, sidebar } = await boot({ fetchImpl });
  runtime.render(react.createElement(sidebar, {}));
  await settle(runtime);
  assert.equal(byClass(runtime.tree, 'dsh-archive-trigger-icon').length, 1, '侧栏入口是触发器图标');
  assert.equal(byClass(runtime.tree, 'dsh-archive-modal').length, 0, '侧栏入口本身不是面板');
});

test('样式只注入一次', async () => {
  const { fetchImpl } = fakeFetch({ '/dsh-archive-manager/archives': { items: ITEMS } });
  const { runtime, react, main, styles } = await boot({ fetchImpl });
  runtime.render(react.createElement(main, {}));
  await settle(runtime);
  assert.equal(styles.size, 1, '样式表注入一次');
  assert.ok(styles.get('dsh-archive-manager-style').textContent.includes('.dsh-archive-modal'), '样式内容是面板样式');
  runtime.repaint();
  await settle(runtime);
  assert.equal(styles.size, 1, '重复渲染不会重复注入样式');
});
