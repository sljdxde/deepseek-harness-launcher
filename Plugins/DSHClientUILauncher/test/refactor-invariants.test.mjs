/**
 * 重构不变量（A4 / A5 / B3）：去重后旧符号必须消失、单一真源必须一致。
 *
 * 用 CODING_STANDARDS §1 允许的「旧符号必须消失 / 某常量只许一处定义」不变量，
 * 外加对单一真源的输入→输出行为断言（DOCK 宽度、图标实现）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DOCK } from '../lib/layout.js'
import { DOCK_WIDTHS, DOCK_TABS, DOCK_TAB_IDS } from '../lib/dock-settings.js'
import { iconEl, SHELL_ICONS, DOCK_ICONS, MAIN_ICONS, MODEL_ICONS, SIDEBAR_ICONS } from '../lib/icons.js'
import { shellIcon } from '../lib/shell-render.js'
import { dockIcon } from '../lib/dock-settings.js'
import { mainIcon } from '../lib/main-view.js'
import { modelIcon } from '../lib/model-surface.js'
import { sidebarIcon } from '../lib/sidebar.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('A4：DOCK_TABS/BUILTIN_TABS 的重复定义已从 contract.js / dock.js 删除，唯一真源是 dock-settings', () => {
  assert.ok(!/export const DOCK_TABS/.test(read('../lib/contract.js')), 'contract.js 不应再定义 DOCK_TABS')
  assert.ok(!/export const BUILTIN_TABS/.test(read('../lib/dock.js')), 'dock.js 不应再定义 BUILTIN_TABS')
  assert.deepEqual([...DOCK_TAB_IDS], ['review', 'files', 'term', 'tasks', 'side'])
  assert.equal(DOCK_TABS.some((tab) => tab.id === 'browser'), false, '越界的 browser 标签已删除')
})

test('B3：右栏宽度区间只有一个真源（dock-settings.DOCK_WIDTHS === layout.DOCK）', () => {
  assert.equal(DOCK_WIDTHS, DOCK, 'dock-settings 直接引用 layout 的 DOCK，不再抄一份数值')
  assert.deepEqual({ ...DOCK_WIDTHS }, { min: 320, max: 520, default: 380, hideBelow: 1020 })
})

test('B3：五个 xxxIcon 都由同一个 iconEl 实现（行为一致，未知名字给空体）', () => {
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const pairs = [
    [shellIcon, SHELL_ICONS, 'panel'],
    [dockIcon, DOCK_ICONS, 'file'],
    [mainIcon, MAIN_ICONS, 'check'],
    [modelIcon, MODEL_ICONS, 'search'],
    [sidebarIcon, SIDEBAR_ICONS, 'chevronRight'],
  ]
  for (const [fn, table, name] of pairs) {
    assert.deepEqual(fn(h, name), iconEl(h, table, name), `${fn.name} 应与 iconEl 输出一致`)
    assert.equal(fn(h, 'definitely-missing').props.dangerouslySetInnerHTML.__html, '', '未知名字给空体、不 throw')
  }
})

test('A5：client 不再自写 hostGuardBanner（复用 lib/bootstrap.js 的 bannerModel）', () => {
  assert.ok(!/function hostGuardBanner\b/.test(read('../client/client.js')), '旧的手写横幅实现必须消失')
})
