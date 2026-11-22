/**
 * HostGuard 判定表（票 29，缝合点 S2）。
 *
 * 只测输入→输出：每个 blocker / warning 分支给一组明确的宿主形状，断言 ok 与 code。
 * 不测内部实现细节，所以 guardHost 可以内部重写而测试不动。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { guardHost, satisfiesRange } from '../lib/guard.js'

/** 合法基线：与实装 rc.4 同形（六子槽 + renderSlots + ILayout 六成员 + 主题前缀）。 */
const baseline = Object.freeze({
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
})

/** 每个用例都拿一份全新、合法的宿主形状，再按需篡改。 */
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

const codes = (list) => list.map((item) => item.code)

test('全部一致：ok，无 blocker、无 warning', () => {
  const result = guardHost(shape())
  assert.equal(result.ok, true)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(result.warnings, [])
})

test('版本在支持区间内：rc.4 / rc.5 / 正式版 都接管', () => {
  for (const version of ['0.2.2-rc.4', '0.2.2-rc.5', '0.2.2', '0.2.9']) {
    assert.equal(guardHost(shape({ hostVersion: version })).ok, true, version)
  }
})

test('blocker：版本出区间（太新 / 太旧）→ 不接管', () => {
  for (const version of ['0.3.0', '1.0.0', '0.2.2-rc.3', '0.1.9']) {
    const result = guardHost(shape({ hostVersion: version }))
    assert.equal(result.ok, false, version)
    assert.ok(codes(result.blockers).includes('version-out-of-range'), version)
  }
})

test('blocker：版本读不到 → 不接管（安全侧）', () => {
  const result = guardHost(shape({ hostVersion: '' }))
  assert.equal(result.ok, false)
  assert.deepEqual(codes(result.blockers), ['version-unreadable'])
})

test('blocker：baseline 不可读 → 按不匹配处理，且不抛错', () => {
  for (const baselineValue of [null, undefined, 'not-json', 42]) {
    const result = guardHost(shape({ baseline: baselineValue }))
    assert.equal(result.ok, false)
    assert.ok(codes(result.blockers).includes('baseline-unreadable'))
  }
})

test('blocker：子槽缺失 → 不接管', () => {
  const result = guardHost(shape({ slots: baseline.slots.filter((slot) => slot.name !== 'rightbar').map((slot) => ({ ...slot })) }))
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((item) => item.code === 'slot-missing' && item.name === 'rightbar'))
})

test('blocker：子槽 kind 变化 → 不接管', () => {
  const slots = baseline.slots.map((slot) => (slot.name === 'main' ? { ...slot, kind: 'single' } : { ...slot }))
  const result = guardHost(shape({ slots }))
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((item) => item.code === 'slot-kind-changed' && item.name === 'main'))
})

test('blocker：子槽 scope 变化 → 不接管', () => {
  const slots = baseline.slots.map((slot) => (slot.name === 'sidebar' ? { ...slot, scope: 'session' } : { ...slot }))
  const result = guardHost(shape({ slots }))
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((item) => item.code === 'slot-scope-changed' && item.name === 'sidebar'))
})

test('blocker：renderSlots 缺项 → 不接管', () => {
  const result = guardHost(shape({ renderSlots: baseline.rootRenderSlots.filter((name) => name !== 'shell.overlay') }))
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((item) => item.code === 'render-slot-missing' && item.name === 'shell.overlay'))
})

test('blocker：ILayout 六成员缺一 → 不接管', () => {
  const result = guardHost(shape({ layoutMembers: baseline.layoutMembers.filter((name) => name !== 'toggleSidebar') }))
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((item) => item.code === 'layout-member-missing' && item.name === 'toggleSidebar'))
})

test('warning：主题前缀改名 → 仍接管（ok true），只记 warning', () => {
  const result = guardHost(shape({ themePrefix: '--dsw-' }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(codes(result.warnings), ['theme-prefix-changed'])
})

test('warning：宿主新增子槽 / 新增 ILayout 成员 → 仍接管', () => {
  const result = guardHost(shape({
    slots: [...baseline.slots.map((slot) => ({ ...slot })), { name: 'shell.side', kind: 'single', scope: 'root' }],
    layoutMembers: [...baseline.layoutMembers, 'focusPanel'],
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(codes(result.warnings).sort(), ['layout-member-added', 'slot-added'])
})

test('主题前缀 / renderSlots / ILayout 成员读不到时按"未知"跳过，不误判成 blocker', () => {
  const result = guardHost(shape({ themePrefix: undefined, renderSlots: undefined, layoutMembers: undefined }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings, [])
})

test('slots 读不到（非数组）→ 不接管（拿不到形状不能盲注册）', () => {
  const result = guardHost(shape({ slots: undefined }))
  assert.equal(result.ok, false)
  assert.ok(codes(result.blockers).includes('slots-unreadable'))
})

test('baseline 用仓库原始形状（services.layout.members）也能识别 ILayout 成员', () => {
  const raw = {
    hostVersion: baseline.hostVersion,
    themePrefix: baseline.themePrefix,
    slots: baseline.slots.map((slot) => ({ ...slot })),
    rootRenderSlots: [...baseline.rootRenderSlots],
    services: { layout: { members: [...baseline.layoutMembers] } },
  }
  assert.equal(guardHost(shape({ baseline: raw })).ok, true)
  const missing = guardHost(shape({ baseline: raw, layoutMembers: ['panelInfo'] }))
  assert.equal(missing.ok, false)
  assert.ok(codes(missing.blockers).includes('layout-member-missing'))
})

test('版本区间比较：支持 prerelease 排序（rc.3 < rc.4 < 正式）', () => {
  assert.equal(satisfiesRange('0.2.2-rc.4', '>=0.2.2-rc.4 <0.3.0'), true)
  assert.equal(satisfiesRange('0.2.2', '>=0.2.2-rc.4 <0.3.0'), true)
  assert.equal(satisfiesRange('0.2.2-rc.3', '>=0.2.2-rc.4 <0.3.0'), false)
  assert.equal(satisfiesRange('0.3.0-rc.1', '>=0.2.2-rc.4 <0.3.0'), true)
  assert.equal(satisfiesRange('0.3.0', '>=0.2.2-rc.4 <0.3.0'), false)
  assert.equal(satisfiesRange('not-a-version', '>=0.2.2-rc.4 <0.3.0'), false)
})

test('多 blocker 同时出现时全部列出（横幅要能一次说清）', () => {
  const result = guardHost(shape({
    hostVersion: '9.9.9',
    slots: baseline.slots.filter((slot) => slot.name !== 'rightbar').map((slot) => ({ ...slot })),
    layoutMembers: ['panelInfo'],
  }))
  assert.equal(result.ok, false)
  assert.ok(result.blockers.length >= 3)
  assert.ok(codes(result.blockers).includes('version-out-of-range'))
  assert.ok(codes(result.blockers).includes('slot-missing'))
  assert.ok(codes(result.blockers).includes('layout-member-missing'))
})

test('版本区间细节：预发布段长度不同、数字/字母标识符、无预发布者更大', () => {
  assert.equal(satisfiesRange('0.2.2-rc.4', '<=0.2.2'), true, 'rc.4 < 正式版，左边有预发布、右边没有')
  assert.equal(satisfiesRange('0.2.2-rc', '>=0.2.2-rc.4'), false, '短预发布段更小')
  assert.equal(satisfiesRange('0.2.2-rc.4.1', '>0.2.2-rc.4'), true, '预发布段更长者更大')
  assert.equal(satisfiesRange('0.2.2-2', '<0.2.2-rc'), true, '数字标识符小于字母标识符')
  assert.equal(satisfiesRange('0.2.2-2', '<0.2.2-10'), true, '数字标识符按数值比较')
  assert.equal(satisfiesRange('0.2.2-alpha', '<0.2.2-beta'), true, '字母标识符按字典序')
  assert.equal(satisfiesRange('0.2.2', '>=0.2.2'), true, '= 比较')
  assert.equal(satisfiesRange('0.2.3', '=0.2.2'), false)
})
