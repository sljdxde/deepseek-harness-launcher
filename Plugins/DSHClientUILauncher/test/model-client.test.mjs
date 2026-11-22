/**
 * 模型浮层接线（票 34）：确认 client.js 真用上了 lib/model-surface.js，
 * 且 model-from-lib 生成块能在桩作用域独立求值（兜住「内联函数引用了没一起内联的常量」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { withModelBlock } from '../tools/sync-contract.mjs'
import { closePopover, openPopover, togglePopover, setPopoverQuery, createPopoverState, pickModel, pickReason, createModelState } from '../lib/model-surface.js'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

function modelRegion() {
  const start = SOURCE.indexOf('  // #region model-from-lib')
  const end = SOURCE.indexOf('  // #endregion model-from-lib')
  assert.ok(start >= 0 && end > start, '找不到 model-from-lib 生成区')
  return SOURCE.slice(start, end)
}

test('模型浮层与状态来自 lib/model-surface.js（生成块与源一致，手改即红）', () => {
  // 不变量：生成区必须与「从 lib 重新生成」逐字节一致。
  assert.ok(SOURCE.includes('// #region model-from-lib'), '必须有生成的模型浮层块')
  assert.equal(withModelBlock(SOURCE), SOURCE, '跑 node tools/sync-contract.mjs 更新，别手改生成区')
})

test('浮层收起语义（行为）：点外/Esc/切页/选中都会回到关闭态', () => {
  const opened = openPopover(createPopoverState(), 'model')
  assert.equal(opened.kind, 'model')
  // Esc / 点外 / 切页：closePopover 无论从哪种打开态都回到 kind=null
  assert.equal(closePopover().kind, null)
  assert.equal(closePopover().query, '')
  // 再次点同一个开关 = toggle 关闭；点另一个 = 切换
  assert.equal(togglePopover(opened, 'model').kind, null)
  assert.equal(togglePopover(opened, 'reason').kind, 'reason')
  // 搜索词可控
  assert.equal(setPopoverQuery(opened, 'r1').query, 'r1')
  assert.equal(setPopoverQuery(opened, '').query, '')
})

test('选中即回写（行为）：pickModel/pickReason 改状态且保留另一维', () => {
  const state = createModelState()
  const afterModel = pickModel(state, 'DeepSeek R1')
  assert.equal(afterModel.model, 'DeepSeek R1')
  assert.equal(afterModel.reason, state.reason)
  const afterReason = pickReason(state, 'High')
  assert.equal(afterReason.reason, 'High')
  assert.equal(afterReason.model, state.model)
})

test('生成块可独立求值：渲染函数只引用已内联的常量（无 ReferenceError）', () => {
  const factory = new Function(
    `${modelRegion()}\nreturn { MODEL_GROUPS, REASON_LEVELS, MODEL_IDS, createModelState, pickModel, pickReason, createPopoverState, openPopover, closePopover, togglePopover, setPopoverQuery, filterModelGroups, modelTriggerLabel, modelRowLabel, popoverPlacement, renderModelTrigger, renderModelPopover, MODEL_CSS }`,
  )
  const api = factory()
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined) })

  assert.equal(api.MODEL_GROUPS.length, 2)
  assert.deepEqual(api.createModelState(), { model: 'DeepSeek V3.2', reason: 'Default', deep: false })
  assert.equal(api.pickReason(api.createModelState(), 'High').deep, true)
  assert.equal(api.modelRowLabel(api.createModelState()), 'deepseek v3.2 · routing group')
  assert.deepEqual(api.popoverPlacement({ triggerRect: { right: 900, top: 700 }, popWidth: 300, viewportWidth: 1000, viewportHeight: 800 }), { left: 600, bottom: 108 })

  const trigger = api.renderModelTrigger(h, { state: api.createModelState(), popover: 'model' })
  assert.equal(trigger.children.length, 3)
  assert.equal(trigger.children[0].props['aria-expanded'], true)

  const pop = api.renderModelPopover(h, { kind: 'reason', state: api.createModelState() })
  assert.equal(pop.props['data-model-popover'], 'reason')
  assert.match(api.MODEL_CSS, /launcher-model-pop/)
})

test('model-from-lib 无标记区时原样返回（withModelBlock 行为）', () => {
  const plain = 'no markers here\n'
  assert.equal(withModelBlock(plain), plain)
})

test('withModelBlock：没有标记区时原样返回（兼容旧 fixture）', () => {
  const plain = 'no markers here\n'
  assert.equal(withModelBlock(plain), plain)
})

test('设置→模型：模型/推理等级读绑定值，团队仍是 role=switch', async () => {
  const { renderSettings, SET_GROUPS, SET_SECTIONS } = await import('../lib/dock-settings.js')
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined) })
  const walk = function* (node) {
    if (node === null || node === undefined || typeof node !== 'object') return
    yield node
    for (const child of node.children ?? []) yield* walk(child)
  }
  const textOf = (node) => {
    if (node === null || node === undefined) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    return (node.children ?? []).map(textOf).join('')
  }
  const tree = renderSettings(h, {
    groups: SET_GROUPS,
    sections: SET_SECTIONS,
    active: 'model',
    values: { theme: 'light', density: 'cozy', dockOpen: false, team: true, model: 'deepseek r1 · routing group', reason: 'High' },
    onGroup: () => {}, onAction: () => {}, onClose: () => {},
  })
  const text = textOf(tree)
  assert.ok(text.includes('deepseek r1 · routing group'), '模型值读真实状态')
  assert.ok(text.includes('High'), '推理等级读真实状态')
  const sw = [...walk(tree)].find((node) => node.props.role === 'switch')
  assert.equal(sw.props['aria-checked'], true)
})
