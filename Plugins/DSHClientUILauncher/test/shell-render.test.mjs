/**
 * 壳层渲染（票 30）：把图标栏 / 状态条渲染成 vnode，供 client 单文件里复用。
 *
 * 为什么渲染函数也进 lib：浏览器半区是宿主模块加载器加载的单文件，不能 import；
 * 这里用「传入 h」的纯渲染函数，Node 侧用假 h 就能断言结构（S2 缝），sync 再内联进 client。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderRail, renderStatusbar, shellIcon } from '../lib/shell-render.js'
import { SHELL_ICONS } from '../lib/icons.js'

/** 最小假 createElement：产出可断言的 vnode 树。 */
function makeH() {
  return (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
}

/** 深度优先找所有满足条件的节点。 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

const ENTRIES = [
  { id: 'conversation', label: '会话', icon: 'conversation', active: true, badge: 0 },
  { id: 'plugins', label: '插件', icon: 'plugins', active: false, badge: 2 },
  { id: 'approvals', label: '待审批', icon: 'approvals', active: false, badge: 0, disabled: true, title: '本版未接' },
]

test('图标栏：外壳根 + logo + 每个入口一个按钮（aria-label/角标/当前态/置灰）', () => {
  const h = makeH()
  const tree = renderRail(h, { entries: ENTRIES, theme: 'light' })
  assert.equal(tree.type, 'nav')
  assert.equal(tree.props.className, 'launcher-rail')
  const buttons = findAll(tree, (n) => n.type === 'button')
  assert.equal(buttons.find((b) => b.props.className === 'launcher-rail__logo') !== undefined, true)
  const conv = buttons.find((b) => b.props['aria-label'] === '会话')
  assert.equal(conv.props['aria-pressed'], true)
  assert.match(conv.props.className, /on/)
  const plugins = buttons.find((b) => b.props['aria-label'] === '插件')
  assert.equal(plugins.props['aria-pressed'], false)
  const badge = findAll(plugins, (n) => n.props.className === 'launcher-rail__badge')
  assert.equal(badge.length, 1)
  assert.equal(badge[0].children[0], '2')
  const approvals = buttons.find((b) => b.props['aria-label'] === '待审批')
  assert.equal(approvals.props['aria-disabled'], true)
})

test('图标栏：日夜开关按主题换图标与文案', () => {
  const h = makeH()
  const light = renderRail(h, { entries: [], theme: 'light' })
  const dark = renderRail(h, { entries: [], theme: 'dark' })
  const themeBtn = (tree) => findAll(tree, (n) => n.props['data-rail-action'] === 'theme')[0]
  assert.match(themeBtn(light).props['aria-label'], /夜间/)
  assert.match(themeBtn(dark).props['aria-label'], /日间/)
  const lightSvg = findAll(themeBtn(light), (n) => n.type === 'svg')[0]
  assert.match(lightSvg.props.dangerouslySetInnerHTML.__html, /M12 3c/)
})

test('图标栏：leading 槽位节点被包含；窄窗渲染抽屉按钮', () => {
  const h = makeH()
  const leading = { type: 'span', props: { id: 'lead' }, children: [] }
  const tree = renderRail(h, { entries: [], leading, narrow: true, drawerOpen: false })
  const spans = findAll(tree, (n) => n.props.id === 'lead')
  assert.equal(spans.length, 1)
  const drawer = findAll(tree, (n) => n.props['data-rail-action'] === 'drawer')
  assert.equal(drawer.length, 1)
  assert.equal(drawer[0].props['aria-expanded'], false)
  const wide = renderRail(h, { entries: [] })
  assert.equal(findAll(wide, (n) => n.props['data-rail-action'] === 'drawer').length, 0)
})

test('图标栏：无 entries 也能渲染（空页面不 throw）', () => {
  const h = makeH()
  assert.doesNotThrow(() => renderRail(h, {}))
  assert.equal(renderRail(h, undefined).type, 'nav')
})

test('状态条：三段文本 + 底部槽位', () => {
  const h = makeH()
  const bottom = { type: 'span', props: { id: 'bottom' }, children: [] }
  const tree = renderStatusbar(h, { page: '会话', mode: '自动批准安全命令', running: '2 个任务在跑' }, { bottom })
  assert.equal(tree.type, 'footer')
  assert.equal(tree.props.className, 'launcher-statusbar')
  const text = JSON.stringify(tree)
  assert.match(text, /会话/)
  assert.match(text, /自动批准安全命令/)
  assert.match(text, /2 个任务在跑/)
  assert.equal(findAll(tree, (n) => n.props.id === 'bottom').length, 1)
})

test('shellIcon：命中名字内联 SVG，未知名字给空体内不抛', () => {
  const h = makeH()
  const known = shellIcon(h, 'sun')
  assert.equal(known.type, 'svg')
  assert.ok(known.props.dangerouslySetInnerHTML.__html.includes(SHELL_ICONS.sun.slice(0, 24)))
  const unknown = shellIcon(h, 'nope')
  assert.equal(unknown.props.dangerouslySetInnerHTML.__html, '')
})
