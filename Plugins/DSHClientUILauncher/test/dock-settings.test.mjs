/**
 * 右栏五面板 + 设置六分组（票 33）的纯逻辑与渲染单测。
 *
 * 缝（S2）：模块导出的是「输入 → vnode/数据」的纯函数，用假 h 就能断言结构与可访问性；
 * 浏览器半区只负责调用，不在这里测。视觉像素仍由 canary 兜底。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DOCK_TABS,
  DOCK_TAB_IDS,
  createDockState,
  setDockTab,
  dockWidthFor,
  dockColumnsFor,
  DOCK_DEMO,
  diffSummary,
  SET_GROUPS,
  SET_GROUP_IDS,
  createSettingsState,
  setSettingsGroup,
  applySetting,
  SET_SECTIONS,
  SET_SHORTCUTS,
  renderDockTabs,
  renderDockPanel,
  renderSettings,
  dockSettingsCss,
} from '../lib/dock-settings.js'

/** 最小假 createElement：产出可断言的 vnode 树（丢掉 null/undefined 子节点，像 React）。 */
function makeH() {
  return (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((child) => child !== null && child !== undefined),
  })
}

/** 深度优先遍历 vnode 树。 */
function* walk(node) {
  if (node === null || node === undefined || typeof node !== 'object') return
  yield node
  for (const child of node.children ?? []) yield* walk(child)
}

/** 节点的可见文本（用于可读标签兜底）。 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return (node.children ?? []).map(textOf).join('')
}

/** 可读标签：aria-label 优先，其次可见文本。 */
function nameOf(node) {
  return String(node.props['aria-label'] ?? textOf(node)).trim()
}

// ---------- 面板模型 ----------

test('DOCK_TABS：五面板（审阅/文件/终端/任务/侧聊）且 id 唯一', () => {
  assert.deepEqual(DOCK_TAB_IDS, ['review', 'files', 'term', 'tasks', 'side'])
  assert.equal(DOCK_TABS.length, 5)
  assert.deepEqual(DOCK_TABS.map((tab) => tab.label), ['审阅', '文件', '终端', '任务', '侧聊'])
  assert.equal(new Set(DOCK_TABS.map((tab) => tab.id)).size, 5)
  assert.deepEqual(DOCK_TAB_IDS, DOCK_TABS.map((tab) => tab.id))
})

test('createDockState / setDockTab：默认审阅、可切到每个面板、非法 id 保持原状', () => {
  assert.equal(createDockState().tab, 'review')
  assert.equal(createDockState('files').tab, 'files')
  assert.equal(createDockState('nope').tab, 'review')
  for (const id of DOCK_TAB_IDS) assert.equal(setDockTab(createDockState(), id).tab, id)
  const before = createDockState('term')
  const after = setDockTab(before, 'unknown')
  assert.equal(after.tab, 'term')
  assert.notEqual(after, before, '返回新对象，不改入参')
  assert.equal(before.tab, 'term')
})

// ---------- 右栏宽度/四列几何：收起展开不抖、不溢出 ----------

test('dockWidthFor：关栏 / 窄窗为 0，开栏夹在 320-520', () => {
  assert.equal(dockWidthFor({ viewportWidth: 1440, requestedWidth: 380, open: false }), 0)
  assert.equal(dockWidthFor({ viewportWidth: 1019, requestedWidth: 380, open: true }), 0, '窄于 hideBelow 自隐')
  assert.equal(dockWidthFor({ viewportWidth: 900, requestedWidth: 380, open: true }), 0)
  assert.equal(dockWidthFor({ viewportWidth: 1440, requestedWidth: 100, open: true }), 320, '下限夹紧')
  assert.equal(dockWidthFor({ viewportWidth: 2000, requestedWidth: 9999, open: true }), 520, '上限夹紧')
  assert.equal(dockWidthFor({ viewportWidth: 1200, requestedWidth: 384, open: true }), 384)
  assert.equal(dockWidthFor({ viewportWidth: Number.NaN, requestedWidth: Number.NaN, open: true }), 380, '非法值兜默认')
})

test('dockColumnsFor：1100-2000 全区间收起/展开都「合计=视口、主区>0」（不抖不溢出）', () => {
  for (let width = 1100; width <= 2000; width += 50) {
    const closed = dockColumnsFor({ viewportWidth: width, dockWidth: 0 })
    assert.equal(closed.total, width, `${width} 收起合计`)
    assert.ok(closed.main > 0, `${width} 收起主区要为正`)
    for (const dockWidth of [320, 380, 520]) {
      const open = dockColumnsFor({ viewportWidth: width, dockWidth })
      assert.equal(open.total, width, `${width}/${dockWidth} 展开合计`)
      assert.ok(open.main > 0, `${width}/${dockWidth} 展开主区要为正`)
      assert.equal(open.dock, dockWidth)
      // 收起与展开的视口合计一致 → 收起/展开不会把整页撑出横向滚动
      assert.equal(open.total, closed.total)
    }
  }
})

// ---------- 设置六分组状态机 ----------

test('SET_GROUPS：六分组、顺序与标签对齐 v17', () => {
  assert.deepEqual(SET_GROUP_IDS, ['general', 'model', 'ext', 'conn', 'data', 'adv'])
  assert.deepEqual(SET_GROUPS.map((group) => group.label), ['常用', '模型', '扩展', '连接', '数据', '高级'])
  assert.equal(SET_GROUPS.length, 6)
})

test('createSettingsState / setSettingsGroup：默认常用、六组可切、非法保持', () => {
  assert.equal(createSettingsState().group, 'general')
  assert.equal(createSettingsState('adv').group, 'adv')
  assert.equal(createSettingsState('nope').group, 'general')
  for (const id of SET_GROUP_IDS) assert.equal(setSettingsGroup(createSettingsState(), id).group, id)
  const before = createSettingsState('data')
  assert.equal(setSettingsGroup(before, 'nope').group, 'data')
  assert.equal(before.group, 'data')
})

test('applySetting：主题/密度/右栏开关即时给出 effect，团队开关取反，导航/回退透传', () => {
  const base = { theme: 'light', density: 'cozy', dockOpen: false, team: false }

  const dark = applySetting(base, { type: 'segmented', key: 'theme', value: 'dark' })
  assert.equal(dark.values.theme, 'dark')
  assert.deepEqual(dark.effect, { type: 'theme', value: 'dark' })

  const compact = applySetting(base, { type: 'segmented', key: 'density', value: 'compact' })
  assert.equal(compact.values.density, 'compact')
  assert.deepEqual(compact.effect, { type: 'density', value: 'compact' })

  const dockOn = applySetting(base, { type: 'toggle', key: 'dock' })
  assert.equal(dockOn.values.dockOpen, true)
  assert.deepEqual(dockOn.effect, { type: 'dock', value: true })
  const dockOff = applySetting({ ...base, dockOpen: true }, { type: 'toggle', key: 'dock' })
  assert.equal(dockOff.values.dockOpen, false)

  const teamOn = applySetting(base, { type: 'switch', key: 'team' })
  assert.equal(teamOn.values.team, true)
  assert.deepEqual(teamOn.effect, { type: 'team', value: true })

  assert.deepEqual(applySetting(base, { type: 'nav', target: 'ext-ssh' }).effect, { type: 'nav', target: 'ext-ssh' })
  assert.deepEqual(applySetting(base, { type: 'danger', key: 'revertNative' }).effect, { type: 'danger', key: 'revertNative' })

  // 未知/异常动作不崩、不改值
  assert.deepEqual(applySetting(base, { type: 'segmented', key: 'theme' }).values.theme, 'light')
  assert.equal(applySetting(base, { type: 'segmented', key: 'nope', value: 'x' }).effect, null)
  assert.equal(applySetting(base, null).effect, null)
  assert.equal(applySetting(base, { type: 'md' }).effect, null)
  // 归一化非法值
  assert.equal(applySetting({ theme: 'weird', density: 'weird', dockOpen: 'yes', team: 1 }, null).values.theme, 'light')
  assert.equal(applySetting({ theme: 'weird', density: 'weird', dockOpen: 'yes', team: 1 }, null).values.density, 'cozy')
})

test('diffSummary：文件数 / 增删行合计', () => {
  assert.deepEqual(diffSummary(DOCK_DEMO.diff), {
    n: DOCK_DEMO.diff.length,
    a: DOCK_DEMO.diff.reduce((sum, file) => sum + file.add, 0),
    d: DOCK_DEMO.diff.reduce((sum, file) => sum + file.del, 0),
  })
  assert.deepEqual(diffSummary([]), { n: 0, a: 0, d: 0 })
  assert.deepEqual(diffSummary(undefined), { n: 0, a: 0, d: 0 })
})

// ---------- 右栏标签栏渲染 ----------

test('renderDockTabs：五个 tab 都 role=tab 且有可读标签，当前项 aria-selected', () => {
  const h = makeH()
  const tree = renderDockTabs(h, { tabs: DOCK_TABS, active: 'term', onSelect: () => {}, onCollapse: () => {} })
  assert.equal(tree.props.className, 'launcher-dock-tabs')
  const tabs = [...walk(tree)].filter((node) => node.props.role === 'tab')
  assert.equal(tabs.length, 5)
  for (const tab of tabs) {
    assert.ok(nameOf(tab).length > 0, '每个 tab 都要有可读标签')
    assert.equal(typeof tab.props['aria-selected'], 'boolean')
    assert.equal(tab.props['aria-selected'], tab.props['data-dock-tab'] === 'term')
  }
  const collapse = [...walk(tree)].find((node) => node.props['data-dock-action'] === 'collapse')
  assert.ok(collapse, '要有收起按钮')
  assert.match(collapse.props['aria-label'], /收起/)
})

// ---------- 五面板内容（与 v17 一致） ----------

test('renderDockPanel：五个面板内容各不相同且带 v17 关键文案', () => {
  const h = makeH()
  const markers = {
    review: /未提交的改动/,
    files: /dsh-launcher/,
    term: /git status/,
    tasks: /左栏按工作区/,
    side: /侧聊是独立上下文/,
  }
  for (const id of DOCK_TAB_IDS) {
    const tree = renderDockPanel(h, { tab: id, data: DOCK_DEMO, onAction: () => {} })
    assert.equal(tree.props.role, 'tabpanel')
    assert.equal(tree.props['data-dock-tab'], id)
    assert.match(textOf(tree), markers[id], `${id} 面板要有 v17 文案`)
  }
  // 未知面板回退到审阅，不 throw
  const fallback = renderDockPanel(h, { tab: 'nope', data: DOCK_DEMO, onAction: () => {} })
  assert.match(textOf(fallback), markers.review)
})

test('renderDockPanel：审阅/任务底栏按钮可点且有反馈回调', () => {
  const h = makeH()
  const actions = []
  const review = renderDockPanel(h, { tab: 'review', data: DOCK_DEMO, onAction: (a) => actions.push(a) })
  const buttons = [...walk(review)].filter((node) => node.type === 'button')
  assert.ok(buttons.length >= 3, '全部暂存/还原/提交都要在')
  for (const button of buttons) {
    assert.ok(nameOf(button).length > 0)
    button.props.onClick()
  }
  assert.ok(actions.length === buttons.length, '每个按钮点了都有回调（0 dead control）')
})

// ---------- 设置页渲染 + 可访问性 ----------

test('renderSettings：六个分组切换器 role=tab，常用组含主题/密度/右栏控件', () => {
  const h = makeH()
  const tree = renderSettings(h, {
    groups: SET_GROUPS,
    sections: SET_SECTIONS,
    shortcuts: SET_SHORTCUTS,
    active: 'general',
    values: { theme: 'light', density: 'cozy', dockOpen: true, team: false },
    onGroup: () => {},
    onAction: () => {},
    onClose: () => {},
  })
  const tabs = [...walk(tree)].filter((node) => node.props.role === 'tab')
  assert.equal(tabs.length, 6, '六个分组')
  const text = textOf(tree)
  assert.match(text, /主题/)
  assert.match(text, /密度/)
  assert.match(text, /右栏/)
  const themeSeg = [...walk(tree)].find((node) => node.props['data-control'] === 'theme' && node.props['data-value'] === 'dark')
  assert.ok(themeSeg, '主题要有日/夜分段按钮')
  assert.equal(themeSeg.props['aria-pressed'], false)
  const dockBtn = [...walk(tree)].filter((node) => node.type === 'button').find((node) => /关右栏|开右栏/.test(textOf(node)))
  assert.ok(dockBtn, '右栏开关按钮在')
})

test('renderSettings：模型组团队开关是 role=switch 且 aria-checked 读自状态', () => {
  const h = makeH()
  const render = (team) => renderSettings(h, {
    groups: SET_GROUPS,
    sections: SET_SECTIONS,
    shortcuts: SET_SHORTCUTS,
    active: 'model',
    values: { theme: 'light', density: 'cozy', dockOpen: false, team },
    onGroup: () => {},
    onAction: () => {},
    onClose: () => {},
  })
  const off = [...walk(render(false))].find((node) => node.props.role === 'switch')
  const on = [...walk(render(true))].find((node) => node.props.role === 'switch')
  assert.equal(off.props['aria-checked'], false)
  assert.equal(on.props['aria-checked'], true)
})

test('renderSettings：所有可交互控件都有可读标签、非禁用项键盘可达（tabIndex !== -1）', () => {
  const h = makeH()
  for (const group of SET_GROUP_IDS) {
    const tree = renderSettings(h, {
      groups: SET_GROUPS,
      sections: SET_SECTIONS,
      shortcuts: SET_SHORTCUTS,
      active: group,
      values: { theme: 'dark', density: 'compact', dockOpen: false, team: true },
      onGroup: () => {},
      onAction: () => {},
      onClose: () => {},
    })
    const controls = [...walk(tree)].filter((node) => node.type === 'button' || node.type === 'input')
    assert.ok(controls.length > 0, `${group} 组至少一个控件`)
    for (const control of controls) {
      assert.ok(nameOf(control).length > 0, `${group} 组控件缺可读标签：${JSON.stringify(control.props)}`)
      if (control.props.disabled !== true) {
        assert.notEqual(control.props.tabIndex, -1, `${group} 组控件不可 Tab 到`)
      }
    }
  }
})

test('dockSettingsCss：只作用于 .launcher- 外壳、含右栏/设置关键类、无裸元素 !important', () => {
  const css = dockSettingsCss()
  assert.match(css, /\.launcher-dock-tabs/)
  assert.match(css, /\.launcher-dock__panel/)
  assert.match(css, /\.launcher-settings/)
  assert.match(css, /\.launcher-set-row/)
  assert.match(css, /\.launcher-seg/)
  for (const line of css.split('\n').filter((row) => row.includes('!important'))) {
    const selector = line.replace(/^\s*@[^{]+\{/, '').split('{')[0].trim()
    for (const part of selector.split(',')) {
      assert.ok(part.trim().startsWith('.launcher-'), `选择器必须外壳作用域：${line.trim().slice(0, 80)}`)
    }
  }
})

// ---------- 票 35：设置 → 高级 →「回退原生 UI」入口 ----------

import { rollbackSurface } from '../lib/rollback.js'

test('SET_SECTIONS.adv：高级分组含「回退原生 UI」入口（可读标签），命令由 rollback 模型给', () => {
  const adv = SET_SECTIONS.adv
  const rows = adv.flatMap((section) => section.rows)
  const revert = rows.find((row) => row.id === 'revert')
  assert.ok(revert, '高级分组必须有回退行')
  assert.equal(revert.label, '回退原生 UI')
  assert.equal(revert.control.type, 'rollback')
  // 命令不在静态常量里抄一份（单一真源在 lib/rollback.js 的 rollbackCommand）
  assert.equal(revert.control.command, undefined)
})

test('renderSettings(高级)：显示说明（数据目录不动）+ 三步命令 + 复制按钮（未复制态）', () => {
  const h = makeH()
  const rollback = rollbackSurface()
  const actions = []
  const tree = renderSettings(h, {
    groups: SET_GROUPS,
    sections: SET_SECTIONS,
    active: 'adv',
    values: { theme: 'light', density: 'cozy', dockOpen: false, team: false },
    rollback,
    onGroup: () => {},
    onAction: (a) => actions.push(a),
    onClose: () => {},
  })
  const text = textOf(tree)
  assert.match(text, /回退原生 UI/)
  assert.match(text, /数据目录/)
  assert.match(text, /不动/)
  assert.match(text, /移除 profile 里的本版 UI 依赖/)
  const cmd = [...walk(tree)].find((node) => node.props['data-rollback-command'] !== undefined)
  assert.ok(cmd, '要有可复制的命令块')
  assert.equal(textOf(cmd), rollback.command, '命令块与 rollbackSurface.command 一致')
  assert.match(textOf(cmd), /remove/)
  assert.match(textOf(cmd), /install/)
  const copy = [...walk(tree)].find((node) => node.props['data-copy-rollback'] !== undefined)
  assert.ok(copy, '要有复制按钮')
  assert.equal(textOf(copy), '复制命令')
  assert.ok(nameOf(copy).length > 0, '复制按钮要有可读标签')
  copy.props.onClick()
  assert.deepEqual(actions, [{ type: 'copyRollback' }], '点复制发出 copyRollback 动作')
})

test('renderSettings(高级)：复制后反馈「已复制」且 aria-live 状态可读', () => {
  const h = makeH()
  const tree = renderSettings(h, {
    groups: SET_GROUPS,
    sections: SET_SECTIONS,
    active: 'adv',
    values: { theme: 'light', density: 'cozy', dockOpen: false, team: false },
    rollback: rollbackSurface({ copied: true }),
    onGroup: () => {},
    onAction: () => {},
    onClose: () => {},
  })
  const copy = [...walk(tree)].find((node) => node.props['data-copy-rollback'] !== undefined)
  assert.equal(textOf(copy), '已复制')
  const status = [...walk(tree)].find((node) => node.props.role === 'status')
  assert.ok(status, '复制反馈要有 role=status')
  assert.equal(status.props['aria-live'], 'polite')
  assert.match(textOf(status), /已复制/)
})

test('renderSettings：关闭按钮有可读标签且触发 onClose（Esc 关闭的按钮同一条路径）', () => {
  const h = makeH()
  let closed = 0
  const tree = renderSettings(h, {
    groups: SET_GROUPS,
    sections: SET_SECTIONS,
    active: 'adv',
    values: { theme: 'light', density: 'cozy', dockOpen: false, team: false },
    rollback: rollbackSurface(),
    onGroup: () => {},
    onAction: () => {},
    onClose: () => { closed += 1 },
  })
  const close = [...walk(tree)].find((node) => node.props.className === 'launcher-settings__close')
  assert.ok(close, '要有关闭按钮')
  assert.match(nameOf(close), /关闭/)
  close.props.onClick()
  assert.equal(closed, 1)
})

test('applySetting：copyRollback 动作给出复制副作用、不改外观取值', () => {
  const base = { theme: 'dark', density: 'compact', dockOpen: true, team: true }
  const result = applySetting(base, { type: 'copyRollback' })
  assert.deepEqual(result.effect, { type: 'copyRollback' })
  assert.deepEqual(result.values, base)
})

test('renderDockPanel(审阅)：没有 diff 时给「都提交了」空态（不渲染 diff 列表）', () => {
  const h = makeH()
  const empty = renderDockPanel(h, { tab: 'review', data: { ...DOCK_DEMO, diff: [] }, onAction: () => {} })
  assert.match(textOf(empty), /都提交了/)
})

test('renderSettings：danger 控件可点并透传动作，未知控件类型渲染为空（0 dead control）', () => {
  const h = makeH()
  const actions = []
  const sections = {
    general: [{
      title: '高级',
      rows: [
        { id: 'revert', label: '回退原生 UI', control: { type: 'danger', key: 'revertNative', label: '回退' } },
        { id: 'unknown', label: '未知控件', control: { type: 'not-a-control' } },
      ],
    }],
  }
  const tree = renderSettings(h, {
    groups: [{ id: 'general', label: '常用' }],
    sections,
    active: 'general',
    values: {},
    onGroup: () => {},
    onAction: (action) => actions.push(action),
    onClose: () => {},
  })
  const danger = [...walk(tree)].find((node) => node.type === 'button' && textOf(node) === '回退')
  assert.ok(danger, 'danger 按钮要渲染出来')
  danger.props.onClick()
  assert.deepEqual(actions, [{ type: 'danger', key: 'revertNative' }])
  // 未知控件类型不产生按钮（renderControl 返回 null），行标签仍在
  assert.match(textOf(tree), /未知控件/)
})
