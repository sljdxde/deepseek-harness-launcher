/**
 * 模型与推理等级浮层（票 34）的纯逻辑与渲染单测。
 *
 * 缝（S2）：模块导出「输入 → 数据/vnode」的纯函数；浏览器半区只调用。
 * 视觉与定位像素由客户端 canary 兜底，这里断言结构、可访问性与定位数值。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MODEL_GROUPS,
  REASON_LEVELS,
  MODEL_IDS,
  REASON_IDS,
  DEFAULT_MODEL,
  DEFAULT_REASON,
  POPOVER_KINDS,
  isDeepReason,
  createModelState,
  pickModel,
  pickReason,
  createPopoverState,
  openPopover,
  closePopover,
  togglePopover,
  setPopoverQuery,
  filterModelGroups,
  modelTriggerLabel,
  modelMeta,
  modelRowLabel,
  popoverPlacement,
  MODEL_ICONS,
  modelIcon,
  renderPopItem,
  renderModelTrigger,
  renderModelPopover,
  modelCss,
} from '../lib/model-surface.js'

/** 最小假 createElement。 */
function makeH() {
  return (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined) })
}

/** 深度优先遍历。 */
function* walk(node) {
  if (node === null || node === undefined || typeof node !== 'object') return
  yield node
  for (const child of node.children ?? []) yield* walk(child)
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return (node.children ?? []).map(textOf).join('')
}

// ---------- 数据 ----------

test('MODEL_GROUPS：DeepSeek + 路由组两组，id 唯一，路由组标记 routing', () => {
  assert.deepEqual(MODEL_GROUPS.map((group) => group.id), ['deepseek', 'routing'])
  assert.deepEqual(MODEL_GROUPS.map((group) => group.label), ['DeepSeek', '路由组'])
  assert.equal(new Set(MODEL_IDS).size, MODEL_IDS.length)
  assert.equal(MODEL_IDS.includes(DEFAULT_MODEL), true)
  const routing = MODEL_GROUPS[1].models[0]
  assert.equal(routing.routing, true)
  assert.equal(modelMeta(routing.id), routing)
})

test('REASON_LEVELS：Default/Low/High/Max 四项', () => {
  assert.deepEqual(REASON_IDS, ['Default', 'Low', 'High', 'Max'])
  assert.equal(REASON_LEVELS.length, 4)
  assert.equal(REASON_IDS.includes(DEFAULT_REASON), true)
})

test('isDeepReason：只有 High/Max 是深入开', () => {
  assert.equal(isDeepReason('High'), true)
  assert.equal(isDeepReason('Max'), true)
  assert.equal(isDeepReason('Default'), false)
  assert.equal(isDeepReason('Low'), false)
  assert.equal(isDeepReason(undefined), false)
})

test('modelMeta：找不到返回 null', () => {
  assert.equal(modelMeta('不存在'), null)
  assert.equal(modelMeta(undefined), null)
})

// ---------- 选择状态 ----------

test('createModelState：默认值、合法值、非法值回退', () => {
  assert.deepEqual(createModelState(), { model: DEFAULT_MODEL, reason: DEFAULT_REASON, deep: false })
  assert.deepEqual(createModelState({ model: 'DeepSeek R1', reason: 'Max' }), { model: 'DeepSeek R1', reason: 'Max', deep: true })
  assert.deepEqual(createModelState({ model: '不存在', reason: 'Ultra' }), { model: DEFAULT_MODEL, reason: DEFAULT_REASON, deep: false })
  assert.deepEqual(createModelState(null), { model: DEFAULT_MODEL, reason: DEFAULT_REASON, deep: false })
})

test('pickModel：合法就换、非法保持、返回新对象', () => {
  const before = createModelState()
  const after = pickModel(before, 'DeepSeek V3.2 mini')
  assert.equal(after.model, 'DeepSeek V3.2 mini')
  assert.notEqual(after, before)
  assert.equal(before.model, DEFAULT_MODEL)
  assert.equal(pickModel(before, '不存在').model, DEFAULT_MODEL)
})

test('pickReason：选中即回写，High/Max 置 deep', () => {
  const base = createModelState()
  assert.equal(pickReason(base, 'Low').deep, false)
  assert.equal(pickReason(base, 'High').deep, true)
  assert.equal(pickReason(base, 'Max').deep, true)
  assert.equal(pickReason(base, 'Nope').reason, DEFAULT_REASON)
})

// ---------- 浮层状态 ----------

test('浮层开合：open/toggle/close/setQuery 都是纯函数', () => {
  assert.deepEqual(createPopoverState(), { kind: null, query: '' })
  assert.deepEqual(openPopover(createPopoverState(), 'model'), { kind: 'model', query: '' })
  assert.deepEqual(openPopover(createPopoverState(), 'reason'), { kind: 'reason', query: '' })
  assert.deepEqual(openPopover(createPopoverState(), 'nope'), { kind: null, query: '' })
  assert.deepEqual(closePopover(), { kind: null, query: '' })
})

test('togglePopover：点同一个收起，点另一个切换（含空状态）', () => {
  const model = openPopover(createPopoverState(), 'model')
  assert.deepEqual(togglePopover(model, 'model'), { kind: null, query: '' })
  assert.deepEqual(togglePopover(model, 'reason'), { kind: 'reason', query: '' })
  assert.deepEqual(togglePopover(undefined, 'model'), { kind: 'model', query: '' })
  assert.deepEqual(togglePopover(null, 'reason'), { kind: 'reason', query: '' })
})

test('setPopoverQuery：字符串原样、非字符串归空、保留 kind', () => {
  const pop = openPopover(createPopoverState(), 'model')
  assert.deepEqual(setPopoverQuery(pop, 'r1'), { kind: 'model', query: 'r1' })
  assert.deepEqual(setPopoverQuery(pop, 42), { kind: 'model', query: '' })
  assert.deepEqual(setPopoverQuery(undefined, 'x'), { kind: null, query: 'x' })
})

// ---------- 搜索过滤 ----------

test('filterModelGroups：空关键词返回全部、命中分组、命中单个、无匹配为空', () => {
  assert.equal(filterModelGroups('').length, 2)
  assert.equal(filterModelGroups(undefined).length, 2)
  assert.deepEqual(filterModelGroups('r1').map((group) => group.id), ['deepseek'])
  assert.deepEqual(filterModelGroups('R1')[0].models.map((model) => model.id), ['DeepSeek R1'])
  assert.deepEqual(filterModelGroups('  mini  ')[0].models.map((model) => model.id), ['DeepSeek V3.2 mini'])
  assert.deepEqual(filterModelGroups('routing').map((group) => group.id), ['routing'])
  assert.deepEqual(filterModelGroups('zzz'), [])
})

// ---------- 文案 ----------

test('modelTriggerLabel / modelRowLabel：触发按钮小写，设置条目带 routing group', () => {
  const state = createModelState({ model: 'DeepSeek V3.2' })
  assert.equal(modelTriggerLabel(state), 'deepseek v3.2')
  assert.equal(modelRowLabel(state), 'deepseek v3.2 · routing group')
  const routing = createModelState({ model: 'deepseek 爽用 · routing group' })
  assert.equal(modelRowLabel(routing), 'deepseek 爽用 · routing group', '路由组本身不重复后缀')
  assert.equal(modelTriggerLabel(undefined), DEFAULT_MODEL.toLowerCase())
})

// ---------- 定位 ----------

test('popoverPlacement：右对齐触发按钮、不越界、向上展开', () => {
  const spot = popoverPlacement({ triggerRect: { right: 900, top: 700 }, popWidth: 300, viewportWidth: 1000, viewportHeight: 800 })
  assert.deepEqual(spot, { left: 600, bottom: 108 })
  // 触发按钮太靠左：贴左边距
  assert.equal(popoverPlacement({ triggerRect: { right: 100, top: 700 }, popWidth: 300, viewportWidth: 1000, viewportHeight: 800 }).left, 8)
  // 视口比浮层还窄：仍然从左边距开始，不出屏
  assert.equal(popoverPlacement({ triggerRect: { right: 50, top: 700 }, popWidth: 400, viewportWidth: 300, viewportHeight: 800 }).left, 8)
  // 非法尺寸走兜底（不 NaN）
  assert.deepEqual(popoverPlacement(), { left: 8, bottom: 8 })
  assert.deepEqual(popoverPlacement({ popWidth: -1, viewportWidth: 0, viewportHeight: 0, gap: 8, margin: 8 }), { left: 8, bottom: 8 })
})

// ---------- 渲染 ----------

test('modelIcon：已知图标有路径、未知给空体且不 throw', () => {
  const h = makeH()
  const search = modelIcon(h, 'search')
  assert.equal(search.props.className, 'launcher-ic')
  assert.equal(search.props.dangerouslySetInnerHTML.__html, MODEL_ICONS.search)
  assert.equal(modelIcon(h, '不存在').props.dangerouslySetInnerHTML.__html, '')
})

test('renderModelTrigger：模型名 + 等级 + 箭头，aria-expanded 随浮层开合', () => {
  const h = makeH()
  const closed = renderModelTrigger(h, { state: createModelState(), popover: null })
  assert.equal(closed.props['data-model-trigger'], '')
  const buttons = closed.children
  assert.equal(buttons.length, 3)
  assert.equal(textOf(buttons[0]), 'deepseek v3.2')
  assert.equal(buttons[0].props['aria-expanded'], false)
  assert.equal(textOf(buttons[1]), 'Default')
  assert.equal(buttons[1].props['aria-expanded'], false)
  assert.equal(buttons[2].props['aria-label'], '模型与推理等级')

  const modelOpen = renderModelTrigger(h, { state: createModelState(), popover: 'model' })
  assert.equal(modelOpen.children[0].props['aria-expanded'], true)
  assert.equal(modelOpen.children[2].props['aria-expanded'], true)
  const reasonOpen = renderModelTrigger(h, { state: createModelState({ reason: 'High' }), popover: 'reason' })
  assert.equal(reasonOpen.children[1].props['aria-expanded'], true)
  assert.equal(textOf(reasonOpen.children[1]), 'High')
})

test('renderModelTrigger：点击回调拿得到 kind，默认回调不 throw', () => {
  const h = makeH()
  const acts = []
  const node = renderModelTrigger(h, { state: createModelState(), onAct: (kind) => acts.push(kind) })
  node.children[0].props.onClick()
  node.children[1].props.onClick()
  node.children[2].props.onClick()
  assert.deepEqual(acts, ['model', 'reason', 'model'])
  assert.doesNotThrow(() => renderModelTrigger(h, {}).children[0].props.onClick())
})

test('renderPopItem：选中有勾 + aria-checked，note 可选，点击回传 id', () => {
  const h = makeH()
  const picked = []
  const on = renderPopItem(h, { key: 'DeepSeek R1', label: 'DeepSeek R1', note: '想久一点', checked: true, onPick: (id) => picked.push(id) })
  assert.equal(on.props.role, 'menuitemradio')
  assert.equal(on.props['aria-checked'], true)
  assert.equal(on.props['data-model-pick'], 'DeepSeek R1')
  assert.ok(on.children.some((child) => child !== null && child.props?.className === 'chk'))
  assert.ok(textOf(on).includes('想久一点'))
  on.props.onClick()
  assert.deepEqual(picked, ['DeepSeek R1'])

  const off = renderPopItem(h, { key: 'Low', label: 'Low', checked: false, onPick: () => {} })
  assert.equal(off.props['aria-checked'], false)
  assert.ok(!off.children.some((child) => child !== null && child.props?.className === 'chk'))
  assert.ok(!textOf(off).includes('undefined'))
})

test('renderModelPopover：非法 kind 返回 null', () => {
  const h = makeH()
  assert.equal(renderModelPopover(h, { kind: null }), null)
  assert.equal(renderModelPopover(h), null)
})

test('renderModelPopover：模型浮层有搜索框、分组、当前项勾选，搜索无结果给空态', () => {
  const h = makeH()
  const tree = renderModelPopover(h, { kind: 'model', state: createModelState({ model: 'DeepSeek R1' }) })
  assert.equal(tree.props.role, 'menu')
  assert.equal(tree.props['data-model-popover'], 'model')
  const input = [...walk(tree)].find((node) => node.type === 'input')
  assert.equal(input.props['aria-label'], '搜索模型')
  const items = [...walk(tree)].filter((node) => node.props.role === 'menuitemradio')
  assert.equal(items.length, MODEL_IDS.length)
  const checked = items.filter((node) => node.props['aria-checked'] === true)
  assert.equal(checked.length, 1)
  assert.equal(checked[0].props['data-model-pick'], 'DeepSeek R1')
  assert.ok(textOf(tree).includes('DeepSeek'))
  assert.ok(textOf(tree).includes('路由组'))

  const empty = renderModelPopover(h, { kind: 'model', query: 'zzz' })
  assert.ok(textOf(empty).includes('没有匹配的模型'))
})

test('renderModelPopover：等级浮层四项带说明、当前项勾选', () => {
  const h = makeH()
  const tree = renderModelPopover(h, { kind: 'reason', state: createModelState({ reason: 'Max' }) })
  assert.equal(tree.props['data-model-popover'], 'reason')
  const items = [...walk(tree)].filter((node) => node.props.role === 'menuitemradio')
  assert.equal(items.length, 4)
  const checked = items.filter((node) => node.props['aria-checked'] === true)
  assert.equal(checked.length, 1)
  assert.equal(checked[0].props['data-model-pick'], 'Max')
  assert.ok(textOf(tree).includes('最长推理，慢'))
})

test('renderModelPopover：搜索/选中回调接上，默认回调不 throw', () => {
  const h = makeH()
  const queries = []
  const picks = []
  const tree = renderModelPopover(h, {
    kind: 'model',
    onQuery: (value) => queries.push(value),
    onPickModel: (id) => picks.push(id),
  })
  const input = [...walk(tree)].find((node) => node.type === 'input')
  input.props.onChange({ target: { value: 'mini' } })
  assert.deepEqual(queries, ['mini'])
  const item = [...walk(tree)].filter((node) => node.props.role === 'menuitemradio')[0]
  item.props.onClick()
  assert.equal(picks.length, 1)
  assert.doesNotThrow(() => {
    const fallback = renderModelPopover(h, { kind: 'reason' })
    ;[...walk(fallback)].find((node) => node.type === 'input') // reason 无输入框，不触发
    const reasonItem = [...walk(fallback)].filter((node) => node.props.role === 'menuitemradio')[0]
    reasonItem.props.onClick()
  })
  // 输入框 onChange 在无回调时也安全
  assert.doesNotThrow(() => [...walk(renderModelPopover(h, { kind: 'model' }))].find((node) => node.type === 'input').props.onChange({ target: {} }))
})

test('modelCss：关键类齐全且全部 launcher- 前缀', () => {
  const css = modelCss()
  for (const cls of ['.launcher-cm-modelwrap', '.launcher-cm-t', '.launcher-model-pop', '.launcher-pop-search', '.launcher-pop-item']) {
    assert.ok(css.includes(cls), `缺 ${cls}`)
  }
  assert.ok(!/position:fixed/.test(css), '浮层用 absolute 挂在 pane 内，避免 fixed 被 contain:paint 夹住')
  assert.ok(POPOVER_KINDS.model === 'model' && POPOVER_KINDS.reason === 'reason')
})
