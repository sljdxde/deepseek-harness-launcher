/**
 * 宿主形状探测（A2）：版本 / slots / layoutMembers 三条判定的行为断言。
 *
 * 只测纯函数输入→输出，再用真实 guardHost 证明确实"参与判定"：
 * layoutMembers 从宿主服务实测后，缺成员会变成 layout-member-missing blocker。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveHostVersion, resolveSlots, probeLayoutMembers } from '../lib/host-shape.js'
import { guardHost } from '../lib/guard.js'

const baseline = {
  hostVersion: '0.2.2-rc.4',
  themePrefix: '--dsh-',
  slots: [
    { name: 'sidebar', kind: 'single', scope: 'root' },
    { name: 'main', kind: 'keyed', scope: 'root' },
    { name: 'rightbar', kind: 'single', scope: 'root' },
    { name: 'shell.bottom', kind: 'single', scope: 'root' },
    { name: 'shell.overlay', kind: 'list', scope: 'root' },
    { name: 'shell.leading', kind: 'single', scope: 'root' },
  ],
  rootRenderSlots: ['sidebar', 'main', 'rightbar', 'shell.bottom', 'shell.overlay', 'shell.leading'],
  layoutMembers: ['panelInfo', 'selectPanel', 'beginNavigation', 'toggleSidebar', 'openRightbar', 'closeRightbar'],
}

function shape(overrides = {}) {
  return {
    hostVersion: baseline.hostVersion,
    baseline,
    slots: baseline.slots.map((slot) => ({ ...slot })),
    renderSlots: [...baseline.rootRenderSlots],
    layoutMembers: [...baseline.layoutMembers],
    themePrefix: baseline.themePrefix,
    ...overrides,
  }
}

test('resolveHostVersion：读不到就是空串，不回退 baseline', () => {
  assert.equal(resolveHostVersion('  0.2.2-rc.4 '), '0.2.2-rc.4')
  assert.equal(resolveHostVersion(undefined), '')
  assert.equal(resolveHostVersion(null), '')
  assert.equal(resolveHostVersion(42), '')
  assert.equal(resolveHostVersion(''), '')
})

test('resolveSlots：能读到就原样返回；读不到默认 undefined（交给 guard 判 slots-unreadable）', () => {
  const declared = [{ name: 'main', kind: 'keyed', scope: 'root' }]
  assert.deepEqual(resolveSlots(declared), declared)
  assert.equal(resolveSlots(undefined), undefined)
  assert.equal(resolveSlots({ not: 'array' }), undefined)
})

test('resolveSlots：显式白名单 allowLegacy 时用 baseline 形状兜底（仅旧宿主兼容）', () => {
  const fallback = resolveSlots(undefined, { baselineSlots: baseline.slots, allowLegacy: true })
  assert.deepEqual(fallback, baseline.slots)
  assert.notEqual(fallback, baseline.slots, '返回副本，不共享引用')
  assert.deepEqual(fallback[0], baseline.slots[0])
})

test('probeLayoutMembers：只返回基线里宿主确实暴露的成员，读不到返回 undefined', () => {
  const service = { panelInfo: {}, selectPanel() {}, beginNavigation() {}, toggleSidebar() {} }
  assert.deepEqual(
    probeLayoutMembers(service, baseline.layoutMembers),
    ['panelInfo', 'selectPanel', 'beginNavigation', 'toggleSidebar'],
  )
  assert.equal(probeLayoutMembers(undefined, baseline.layoutMembers), undefined)
  assert.equal(probeLayoutMembers(null, baseline.layoutMembers), undefined)
})

test('probeLayoutMembers：服务上的额外键不产生噪音（只比基线成员）', () => {
  const service = {
    panelInfo: {}, selectPanel() {}, beginNavigation() {}, toggleSidebar() {}, openRightbar() {}, closeRightbar() {},
    panels: {}, navigation: {}, dispose() {},
  }
  assert.deepEqual(probeLayoutMembers(service, baseline.layoutMembers), baseline.layoutMembers)
})

test('layoutMembers 参与判定：宿主少一个 ILayout 成员 → layout-member-missing blocker', () => {
  const service = { panelInfo: {}, selectPanel() {}, beginNavigation() {}, toggleSidebar() {}, openRightbar() {} }
  const verdict = guardHost(shape({ layoutMembers: probeLayoutMembers(service, baseline.layoutMembers) }))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.blockers.some((item) => item.code === 'layout-member-missing' && item.name === 'closeRightbar'))
})

test('版本读不到（resolveHostVersion 返回空串）→ version-unreadable blocker，不回退 baseline', () => {
  const verdict = guardHost(shape({ hostVersion: resolveHostVersion(undefined) }))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.blockers.some((item) => item.code === 'version-unreadable'))
})

test('slots 读不到（resolveSlots 返回 undefined）→ slots-unreadable blocker，不再盲注册', () => {
  const verdict = guardHost(shape({ slots: resolveSlots(undefined) }))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.blockers.some((item) => item.code === 'slots-unreadable'))
})

test('probeLayoutMembers：读成员时服务探测抛错不崩，按未知成员处理', () => {
  const hostile = new Proxy({}, { has() { throw new Error('boom') } })
  assert.deepEqual(probeLayoutMembers(hostile, ['a', 'b']), [])
})
