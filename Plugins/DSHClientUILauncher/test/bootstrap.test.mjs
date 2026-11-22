/**
 * Bootstrap（票 29）：guard.ok 才注册 root / 注入 client；不 ok 不注册、不抛错、渲染可关闭横幅。
 * 幂等：重复调用不注册两次、不叠第二条横幅。
 *
 * 用假宿主：register / mountBanner 都是 spy，不碰真 DOM 与真 cordis ctx。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createBootstrap, bannerModel } from '../lib/bootstrap.js'
import { PACKAGE_NAME } from '../lib/rollback.js'

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

const okShape = () => ({
  hostVersion: baseline.hostVersion,
  baseline,
  slots: baseline.slots.map((slot) => ({ ...slot })),
  renderSlots: [...baseline.rootRenderSlots],
  layoutMembers: [...baseline.layoutMembers],
  themePrefix: baseline.themePrefix,
})

const badShape = () => ({ ...okShape(), hostVersion: '9.9.9' })

function spy() {
  const calls = []
  const fn = (...args) => calls.push(args)
  return { fn, calls }
}

test('guard.ok：注册一次、不渲染横幅', () => {
  const register = spy()
  const mountBanner = spy()
  const boot = createBootstrap({ register: register.fn, mountBanner: mountBanner.fn })
  const outcome = boot.run(okShape())
  assert.equal(outcome.registered, true)
  assert.equal(register.calls.length, 1)
  assert.equal(mountBanner.calls.length, 0)
})

test('guard 不 ok：不注册、渲染横幅、不抛错', () => {
  const register = spy()
  const mountBanner = spy()
  const boot = createBootstrap({ register: register.fn, mountBanner: mountBanner.fn })
  const outcome = boot.run(badShape())
  assert.equal(outcome.registered, false)
  assert.equal(register.calls.length, 0)
  assert.equal(mountBanner.calls.length, 1)
  assert.ok(outcome.guard.blockers.length > 0)
})

test('幂等：连续两次 run 只注册一次、只出一次横幅', () => {
  const register = spy()
  const mountBanner = spy()
  const bootOk = createBootstrap({ register: register.fn, mountBanner: mountBanner.fn })
  bootOk.run(okShape())
  bootOk.run(okShape())
  assert.equal(register.calls.length, 1)

  const registerBad = spy()
  const mountBad = spy()
  const bootBad = createBootstrap({ register: registerBad.fn, mountBanner: mountBad.fn })
  bootBad.run(badShape())
  bootBad.run(badShape())
  assert.equal(registerBad.calls.length, 0)
  assert.equal(mountBad.calls.length, 1)
  assert.equal(bootBad.outcome.repeated, false)
})

test('mountBanner 抛错不向上抛（不 ok 时"不抛错"）', () => {
  const register = spy()
  const boot = createBootstrap({
    register: register.fn,
    mountBanner: () => { throw new Error('dom gone') },
  })
  assert.doesNotThrow(() => boot.run(badShape()))
  assert.equal(register.calls.length, 0)
})

test('register 抛错不把整页打崩（记在 outcome 上）', () => {
  const mountBanner = spy()
  const boot = createBootstrap({
    register: () => { throw new Error('root taken') },
    mountBanner: mountBanner.fn,
  })
  let outcome
  assert.doesNotThrow(() => { outcome = boot.run(okShape()) })
  assert.equal(outcome.registered, false)
  assert.match(String(outcome.error), /root taken/)
})

test('横幅模型：原因列表 + 回退命令 + "本次不再提示"', () => {
  const model = bannerModel({ ok: false, blockers: [{ code: 'version-out-of-range', message: '宿主版本 9.9.9 不在支持区间' }], warnings: [] }, { profile: 'web' })
  assert.equal(model.id, 'launcher-hostguard-banner')
  assert.match(model.title, /原生界面/)
  assert.deepEqual(model.reasons, ['宿主版本 9.9.9 不在支持区间'])
  assert.match(model.command, new RegExp(`remove ${PACKAGE_NAME}`))
  assert.match(model.command, /install/)
  assert.equal(model.dismissLabel, '本次不再提示')
})

test('guard 自己抛错时兜底成"不接管"（不把整页打崩）', () => {
  const mountBanner = spy()
  const boot = createBootstrap({ register: () => {}, mountBanner: mountBanner.fn, guard: () => { throw new Error('boom') } })
  let outcome
  assert.doesNotThrow(() => { outcome = boot.run(okShape()) })
  assert.equal(outcome.registered, false)
  assert.equal(outcome.guard.blockers[0].code, 'guard-threw')
  assert.equal(mountBanner.calls.length, 1)
})

test('横幅原因：blocker 没写 message 时回落到 code 文案', () => {
  const model = bannerModel({ ok: false, blockers: [{ code: 'slot-missing' }, {}] })
  assert.deepEqual(model.reasons, ['slot-missing', '未知原因'])
})

test('五类 blocker 各自单独触发：都不注册 root、都出横幅（原生 UI 保留）', () => {
  const cases = {
    '版本出区间': { ...okShape(), hostVersion: '9.9.9' },
    '基线不可读': { ...okShape(), baseline: null },
    '子槽缺失': { ...okShape(), slots: okShape().slots.filter((slot) => slot.name !== 'rightbar') },
    'renderSlots 缺项': { ...okShape(), renderSlots: okShape().renderSlots.filter((name) => name !== 'shell.overlay') },
    'ILayout 缺成员': { ...okShape(), layoutMembers: okShape().layoutMembers.filter((name) => name !== 'toggleSidebar') },
  }
  for (const [label, shape] of Object.entries(cases)) {
    const register = spy()
    const mountBanner = spy()
    const boot = createBootstrap({ register: register.fn, mountBanner: mountBanner.fn })
    const outcome = boot.run(shape)
    assert.equal(outcome.registered, false, label)
    assert.equal(register.calls.length, 0, label)
    assert.equal(mountBanner.calls.length, 1, label)
    assert.ok(outcome.guard.blockers.length > 0, label)
  }
})
