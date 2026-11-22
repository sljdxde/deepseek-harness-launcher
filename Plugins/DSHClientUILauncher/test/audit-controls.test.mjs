/**
 * 死控件巡检脚本（票 37）：判定逻辑与报告字段。
 *
 * 只测外部行为：给控件描述 → 得到 dead / missingName 判定；给一段源码 → 得到控件清单；
 * 给清单 → 得到报告对象（字段固定，供 CLI 与归档报告消费）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTROL_ROLES,
  CONTROL_TAGS,
  classifyControl,
  extractControls,
  auditControls,
  buildReport,
  computeTargetSize,
  ruleSubjectHasClass,
} from '../scripts/audit-controls.mjs'

test('内建判定集合：按钮类标签与交互型 role', () => {
  for (const tag of ['button', 'input', 'select', 'textarea', 'a', 'summary']) {
    assert.ok(CONTROL_TAGS.has(tag), `应把 ${tag} 当控件`)
  }
  for (const role of ['switch', 'radio', 'tab', 'option', 'menuitemradio', 'checkbox']) {
    assert.ok(CONTROL_ROLES.has(role), `应把 role=${role} 当控件`)
  }
})

test('四类样本：正常 / 缺失标签 / 显式 disabled / 无处理函数', () => {
  const normal = classifyControl({ tag: 'button', hasHandler: true, disabled: false, label: '', hasText: true })
  assert.equal(normal.dead, false, '有处理函数且有文字 → 不是死控件')
  assert.equal(normal.missingName, false)

  const missingLabel = classifyControl({ tag: 'button', hasHandler: true, disabled: false, label: '', hasText: false })
  assert.equal(missingLabel.dead, false, '有处理函数 → 不是死控件')
  assert.equal(missingLabel.missingName, true, '无 aria-label/title/文字 → 缺可访问名')

  const disabled = classifyControl({ tag: 'button', hasHandler: false, disabled: true, label: '', hasText: true })
  assert.equal(disabled.dead, false, '显式 disabled → 不算死控件')
  assert.equal(disabled.missingName, false, '有文字 → 有可访问名')

  const dead = classifyControl({ tag: 'button', hasHandler: false, disabled: false, label: '', hasText: false })
  assert.equal(dead.dead, true, '无处理函数、未 disabled、无说明 → 死控件')
  assert.deepEqual(dead.reasons.sort(), ['no-handler', 'no-label'].sort())
})

test('title / aria-label 说明占位也算非死控件', () => {
  const placeholder = classifyControl({ tag: 'button', hasHandler: false, disabled: false, label: '演示占位', hasText: false })
  assert.equal(placeholder.dead, false)
  assert.equal(placeholder.missingName, false)
})

test('extractControls：按钮 / input / role=switch / data-act 都入清单，并解析处理函数与标签', () => {
  const source = `
    const a = h('button', { type: 'button', className: 'x', onClick: () => go(), 'aria-label': '去' }, '去')
    const b = h('input', { type: 'checkbox', onChange: () => toggle(), 'aria-label': '勾选' })
    const c = h('div', { role: 'switch', 'aria-checked': true, onClick: () => flip() }, h('span', null, '开'))
    const d = h('div', { 'data-act': 'export', title: '导出', onClick: () => run() }, '导出')
    const e = h('div', { className: 'plain' }, '不是控件')
  `
  const controls = extractControls(source)
  assert.equal(controls.length, 4)
  assert.deepEqual(controls.map((c) => c.tag), ['button', 'input', 'div', 'div'])
  assert.equal(controls[0].hasHandler, true)
  assert.equal(controls[0].label, '去')
  assert.equal(controls[1].hasHandler, true)
  assert.equal(controls[1].label, '勾选')
  assert.equal(controls[2].role, 'switch')
  assert.equal(controls[2].hasText, true)
  assert.equal(controls[3].hasHandler, true)
  assert.equal(controls[3].label, '导出')
  assert.equal(controls[0].line, 2)
})

test('extractControls：条件 onClick（disabled ? undefined : fn）靠 aria-disabled 判非死；嵌套对象里的括号不截断', () => {
  const source = `
    const a = h('button', {
      type: 'button',
      'aria-disabled': disabled,
      onClick: disabled ? undefined : entry.onSelect,
    }, entry.label)
    const b = h('button', { onClick: () => pick({ id: 'x', meta: { deep: [1, 2] } }) }, '选')
  `
  const controls = extractControls(source)
  assert.equal(controls.length, 2)
  assert.equal(controls[0].disabled, true)
  assert.equal(controls[0].dead, false)
  assert.equal(controls[1].hasHandler, true)
})

test('auditControls：汇总控件数 / dead / 缺名，并保留可定位信息', () => {
  const controls = extractControls(`
    const a = h('button', { onClick: () => go() }, '去')
    const b = h('button', { className: 'ghost' })
    const c = h('button', { 'aria-label': '占位' })
  `)
  const result = auditControls(controls)
  assert.equal(result.controlCount, 3)
  assert.equal(result.deadCount, 1)
  assert.equal(result.missingNameCount, 1, 'b 既死又缺名，c 有名字，a 有文字')
  assert.equal(result.dead[0].line, 3)
  assert.equal(result.dead[0].tag, 'button')
  assert.ok(result.dead[0].reasons.includes('no-handler'))
})

test('ruleSubjectHasClass：只认主体元素上的类，不把后代选择器当目标', () => {
  assert.equal(ruleSubjectHasClass('.launcher-rail__action svg', 'launcher-rail__action'), false)
  assert.equal(ruleSubjectHasClass('.launcher-rail__action', 'launcher-rail__action'), true)
  assert.equal(ruleSubjectHasClass('.launcher-btn.sm', 'launcher-btn'), true)
  assert.equal(ruleSubjectHasClass('.launcher-btn .x', 'launcher-btn'), false)
  assert.equal(ruleSubjectHasClass('.launcher-tree-row.on:hover', 'launcher-tree-row'), true)
})

test('computeTargetSize：显式 height 优先，否则用字号×行高 + 垂直内边距估算', () => {
  assert.equal(computeTargetSize({ height: '38px', width: '38px' }).height, 38)
  const derived = computeTargetSize({ padding: '8px 10px', 'font-size': '13px' })
  assert.ok(derived.height > 30 && derived.height < 40, `估算高度约 34，实际 ${derived.height}`)
  const small = computeTargetSize({ 'font-size': '11px', padding: '1px 6px' })
  assert.equal(small.below24, true)
})

test('buildReport：字段固定，包含总数/死控件/缺名/目标尺寸/焦点/对比度与 pass', () => {
  const report = buildReport({
    controls: [{ line: 1, tag: 'button', dead: false, missingName: false }],
    targetSizes: [{ className: 'launcher-btn', height: 28, width: null, below24: false, exempt: false }],
    focus: { globalRule: true, explicit: 3, missing: [] },
    contrast: { light: [{ name: '正文', ratio: 10, pass: true }], dark: [{ name: '正文', ratio: 9, pass: true }] },
    generatedAt: '2026-11-22T00:00:00.000Z',
    source: 'client/client.js',
  })
  assert.equal(report.generatedAt, '2026-11-22T00:00:00.000Z')
  assert.equal(report.source, 'client/client.js')
  assert.equal(report.controlCount, 1)
  assert.equal(report.deadCount, 0)
  assert.equal(report.missingNameCount, 0)
  assert.ok(Array.isArray(report.checks))
  assert.equal(report.pass, true)
  for (const key of ['dead', 'missingName', 'targetSize', 'focus', 'contrast']) {
    assert.ok(key in report, `报告缺字段 ${key}`)
  }
})

test('buildReport：任一检查失败则 pass=false', () => {
  const report = buildReport({
    controls: [{ line: 1, tag: 'button', dead: true, missingName: true, reasons: ['no-handler'] }],
    targetSizes: [{ className: 'launcher-x', height: 18, width: null, below24: true, exempt: false }],
    focus: { globalRule: true, explicit: 3, missing: [] },
    contrast: { light: [], dark: [] },
    generatedAt: 'x',
    source: 's',
  })
  assert.equal(report.pass, false)
  assert.ok(report.checks.some((check) => check.id === 'dead-controls' && check.pass === false))
  assert.ok(report.checks.some((check) => check.id === 'target-size' && check.pass === false))
})

test('extractDomControls：DOM 直建按钮入清单；程序化下载 <a> 跳过', async () => {
  const { extractDomControls } = await import('../scripts/audit-controls.mjs')
  const source = `
    const close = document.createElement('button')
    close.className = 'launcher-hostguard__close'
    close.textContent = '本次不再提示'
    close.addEventListener('click', () => bar.remove())
    const link = document.createElement('a')
    link.href = url
    link.download = 'turn.md'
    link.click()
  `
  const controls = extractDomControls(source)
  assert.equal(controls.length, 1)
  assert.equal(controls[0].tag, 'button')
  assert.equal(controls[0].kind, 'dom')
  assert.equal(controls[0].hasHandler, true)
  assert.equal(controls[0].hasText, true)
  assert.equal(controls[0].dead, false)
})
