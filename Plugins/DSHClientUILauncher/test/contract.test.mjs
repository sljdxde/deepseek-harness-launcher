/**
 * 契约层单测：包内常量表必须与 contracts/host-baseline.json 逐条一致。
 *
 * 这是 §5 的第二道闸（第一道是 tools/contract-snapshot.mjs --check 与宿主的 d.ts 比）。
 * 两道都要，因为 baseline 与常量表各自可能被顺手改掉。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { SUB_SLOTS, ROOT_RENDER_SLOTS, SIDEBAR_SEATS, OVERLAY_IDS, DOCK_TABS, diffContract, describeDiff } from '../lib/contract.js'

const baseline = JSON.parse(readFileSync(new URL('../contracts/host-baseline.json', import.meta.url), 'utf8'))

test('六条子槽的名字与 kind 与宿主 baseline 一致', () => {
  const actual = baseline.slots.map((slot) => ({ name: slot.name, kind: slot.kind }))
  assert.deepEqual(SUB_SLOTS.map((slot) => ({ name: slot.name, kind: slot.kind })), actual)
})

test('root 的 renderSlots 就是这六条，不多不少', () => {
  assert.deepEqual([...ROOT_RENDER_SLOTS], baseline.rootRenderSlots)
})

test('侧栏席位表与宿主 ui-sidebar 的声明一致（§4.3 落法 A 的前提）', () => {
  const seats = (baseline.seats ?? []).map((seat) => seat.name)
  assert.deepEqual([...SIDEBAR_SEATS], seats)
})

test('baseline 记下了宿主包版本，供自测文档引用', () => {
  assert.equal(baseline.host.layoutPackage, '@deepseek-ai/dsh-client-ui-layout')
  assert.match(String(baseline.host.layoutVersion), /^\d+\.\d+\.\d+/)
})

test('overlay 条目 id 全部带 launcher. 前缀且互不相同', () => {
  const ids = Object.values(OVERLAY_IDS)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^launcher\./)
})

test('右栏 6 个标签，含浏览器，顺序固定', () => {
  assert.deepEqual([...DOCK_TABS], ['review', 'files', 'browser', 'terminal', 'tasks', 'side'])
})

test('diffContract 对一致的声明返回空数组', () => {
  const actual = {
    slots: SUB_SLOTS.map((slot) => ({ name: slot.name, kind: slot.kind })),
    renderSlots: [...ROOT_RENDER_SLOTS],
  }
  assert.deepEqual(diffContract(actual), [])
})

test('diffContract 能报出缺槽、kind 变化与多余槽', () => {
  const slots = SUB_SLOTS.filter((slot) => slot.name !== 'rightbar').map((slot) => ({ ...slot }))
  slots[1] = { name: 'main', kind: 'single' }
  slots.push({ name: 'shell.side', kind: 'single' })
  const found = diffContract({ slots, renderSlots: [...ROOT_RENDER_SLOTS] })
  const kinds = found.map((item) => item.kind).sort()
  assert.deepEqual(kinds, ['slot:extra', 'slot:kind-changed', 'slot:missing'])
  assert.match(describeDiff(found), /main 由 keyed 变 single/)
})

test('describeDiff 对空 diff 返回空串（不要一条空黄条）', () => {
  assert.equal(describeDiff([]), '')
  assert.equal(describeDiff(undefined), '')
})
