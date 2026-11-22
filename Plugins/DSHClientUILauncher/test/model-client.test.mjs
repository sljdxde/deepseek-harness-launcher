/**
 * 模型浮层接线（票 34）：确认 client.js 真用上了 lib/model-surface.js，
 * 且 model-from-lib 生成块能在桩作用域独立求值（兜住「内联函数引用了没一起内联的常量」）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { withModelBlock, modelBlock } from '../tools/sync-contract.mjs'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

function modelRegion() {
  const start = SOURCE.indexOf('  // #region model-from-lib')
  const end = SOURCE.indexOf('  // #endregion model-from-lib')
  assert.ok(start >= 0 && end > start, '找不到 model-from-lib 生成区')
  return SOURCE.slice(start, end)
}

test('client 接线：输入行触发按钮 / 浮层 / 状态回写都来自 lib/model-surface.js', () => {
  assert.match(SOURCE, /#region model-from-lib/, '必须有生成的模型浮层块')
  assert.match(SOURCE, /renderModelTrigger\(h, \{ state: props\.modelState/, '输入行右下角用 renderModelTrigger')
  assert.match(SOURCE, /renderModelPopover\(h, \{/, '浮层用 renderModelPopover')
  assert.match(SOURCE, /popoverPlacement\(\{/, '浮层定位用 popoverPlacement')
  assert.match(SOURCE, /createModelState\(\)/, '状态源用 createModelState')
  assert.match(SOURCE, /pickModel\(state, id\)/, '选中模型回写用 pickModel')
  assert.match(SOURCE, /pickReason\(state, id\)/, '选中等级回写用 pickReason')
  assert.match(SOURCE, /modelRowLabel\(modelState\)/, '设置→模型的模型值读真实状态')
  assert.match(SOURCE, /reason: modelState\.reason/, '设置→推理等级读真实状态')
  assert.match(SOURCE, /\$\{MODEL_CSS\}/, '样式要铺 MODEL_CSS')
})

test('client 浮层：点外/Esc/切页收起（监听器与 settingsOpen 关闸都在）', () => {
  assert.match(SOURCE, /addEventListener\('mousedown', onDown, true\)/, '点浮层外要收起')
  assert.match(SOURCE, /event\.key === 'Escape'[\s\S]{0,120}closePopover\(\)/, 'Esc 要收起')
  assert.match(SOURCE, /props\.settingsOpen === true\) setModelPopover\(closePopover\(\)\)/, '切到设置页要收起')
  assert.match(SOURCE, /props\.onPickModel\?\.\(id\); setModelPopover\(closePopover\(\)\)/, '选中即回写并关闭')
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

test('model-from-lib 是生成的，手改就会红', () => {
  assert.ok(SOURCE.includes('// #region model-from-lib'), 'client.js 必须有 model-from-lib 标记区')
  assert.equal(withModelBlock(SOURCE), SOURCE, '跑 node tools/sync-contract.mjs 更新，别手改')
  assert.match(modelBlock(), /const renderModelPopover = function renderModelPopover/)
  assert.match(modelBlock(), /const renderPopItem = function renderPopItem/)
})

test('withModelBlock：没有标记区时原样返回（兼容旧 fixture）', () => {
  const plain = 'no markers here\n'
  assert.equal(withModelBlock(plain), plain)
})
