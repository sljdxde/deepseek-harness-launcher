/** 空会话首屏（W2 尾 / FR-36 / 05-§6.4）：起手式、空态判据、运行条快照、⌘N 让路。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CARD,
  RUNBAR_ZERO,
  STARTERS,
  applyStarter,
  applyStarterThrough,
  cardLayout,
  emptyStateDecision,
  recordRunbar,
  runbarFor,
  runbarFromHost,
  shouldRenderEmptyState,
  starterOf,
  yieldsToOverlay,
} from '../lib/new-session.js'

const CLIENT = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

test('起手式：四条，标签与 05-§6.4 一致，整句不为空', () => {
  assert.deepEqual(STARTERS.map((item) => item.id), ['explore', 'test', 'split-tasks', 'resume'])
  assert.deepEqual(STARTERS.map((item) => item.label), ['看仓库结构', '跑一遍测试', '拆成任务卡', '接着上次的活'])
  for (const item of STARTERS) {
    assert.ok(item.text.length > item.label.length, `${item.id} 的填入文本要是整句`)
  }
  assert.equal(starterOf('explore').label, '看仓库结构')
  assert.equal(starterOf('nope'), null)
})

test('起手式：只填入并聚焦，永不发送', () => {
  const applied = applyStarter('test')
  assert.deepEqual(applied, { ok: true, kind: 'test', text: starterOf('test').text, focus: true, send: false })
  assert.deepEqual(applyStarter('nope'), { ok: false, send: false })
})

test('空态判据：只有「选中会话 + 无消息 + 宿主没画空态」才画', () => {
  assert.equal(shouldRenderEmptyState({ selectedSessionId: 's1', messageCount: 0 }), true)
  assert.equal(shouldRenderEmptyState({ selectedSessionId: 's1', messageCount: 3 }), false, '有消息就不画')
  assert.equal(shouldRenderEmptyState({ selectedSessionId: null, messageCount: 0 }), false, '没选中会话不画')
  assert.equal(shouldRenderEmptyState({ selectedSessionId: '', messageCount: 0 }), false)
  assert.equal(
    shouldRenderEmptyState({ selectedSessionId: 's1', messageCount: 0, hostEmptyState: true }),
    false,
    '宿主已有空态：返回 null，不许双空态',
  )
})

test('空态卡片尺寸：宽上限 440，≥760 高 46vh、≤760 高 36vh 且一列', () => {
  const wide = cardLayout({ width: 1440, height: 900 })
  assert.deepEqual(wide, { width: 440, minHeight: Math.round(900 * 0.46), columns: 2, narrow: false })
  const narrow = cardLayout({ width: 700, height: 900 })
  assert.deepEqual(narrow, { width: 440, minHeight: Math.round(900 * 0.36), columns: 1, narrow: true })
  const tight = cardLayout({ width: 320, height: 520 })
  assert.equal(tight.width, 320, '窄于 440 时跟着视口走，不溢出')
  assert.equal(tight.columns, 1)
  assert.equal(CARD.width, 440)
  assert.equal(CARD.contentWidth, 390)
})

test('运行条：新会话全 0，切回旧会话按 id 还原，不串会话', () => {
  const empty = runbarFor({}, 'new-1')
  assert.deepEqual(empty, { ...RUNBAR_ZERO })

  let snapshots = {}
  snapshots = recordRunbar(snapshots, 'old-1', { rounds: 51, steps: 173, tokens: 128400, cacheHit: 96, contextPct: 62 })
  assert.deepEqual(runbarFor(snapshots, 'old-1'), { rounds: 51, steps: 173, tokens: 128400, cacheHit: 96, contextPct: 62 })
  assert.deepEqual(runbarFor(snapshots, 'new-1'), { ...RUNBAR_ZERO }, '新会话不许把上一条的 51 轮带过来')
})

test('运行条：recordRunbar 不改入参，越界值被夹住', () => {
  const before = { 's1': { rounds: 2, steps: 5, tokens: 10, cacheHit: 1, contextPct: 40 } }
  const after = recordRunbar(before, 's1', { rounds: 3 })
  assert.equal(before.s1.rounds, 2, '原表不动')
  assert.equal(after.s1.rounds, 3)
  assert.equal(after.s1.steps, 5, '没给的字段保留')
  const clamped = recordRunbar({}, 's2', { rounds: -4, contextPct: 180 })
  assert.equal(clamped.s2.rounds, 0)
  assert.equal(clamped.s2.contextPct, 100)
})

test('⌘N 让路：外壳浮层开着时让，关着时不让', () => {
  assert.equal(yieldsToOverlay({ overlayOpen: true }), true)
  assert.equal(yieldsToOverlay({ overlayOpen: false }), false)
  assert.equal(yieldsToOverlay(), false)
})

test('渲染层与纯逻辑同步：四条起手式与空态标记都进了 client', () => {
  assert.ok(CLIENT.includes("'data-launcher-empty': 'our'"), '空态卡片要带自己的标记，便于断言与不重复渲染')
  for (const item of STARTERS) {
    assert.ok(CLIENT.includes(item.label), `client 缺起手式标签：${item.label}`)
    assert.ok(CLIENT.includes(item.text), `client 缺起手式整句：${item.id}`)
  }
  assert.ok(CLIENT.includes('maxWidth: `${layout.width}px`'), '宽度上限由 cardLayout 给，不写死在 CSS')
  assert.ok(CLIENT.includes('hostEmptyState'), '宿主已画空态时要走 false 分支')
})

test('空态判据：显式注入 + 开发期强制开关（不做 DOM 嗅探）', () => {
  assert.deepEqual(emptyStateDecision({ selectedSessionId: 's1', messageCount: 0 }), { render: true, reason: 'ok' })
  assert.deepEqual(
    emptyStateDecision({ selectedSessionId: 's1', messageCount: 0, hostEmptyState: true }),
    { render: false, reason: 'host-empty-state' },
  )
  assert.deepEqual(
    emptyStateDecision({ selectedSessionId: 's1', messageCount: 0, force: 'on', hostEmptyState: true }),
    { render: true, reason: 'forced-on' },
    '开发期开关能强制画出我们的空态',
  )
  assert.deepEqual(
    emptyStateDecision({ selectedSessionId: 's1', messageCount: 0, force: 'off' }),
    { render: false, reason: 'forced-off' },
    '也能强制关掉，看宿主自己的空态',
  )
})

test('起手式走 composer face：只 fill + focus，不写 DOM', () => {
  const calls = []
  const face = { fill: (text) => calls.push(['fill', text]), focus: () => calls.push(['focus']) }
  const result = applyStarterThrough(face, 'explore')
  assert.deepEqual(result, { ok: true, kind: 'explore', filled: true, focused: true })
  assert.deepEqual(calls, [['fill', starterOf('explore').text], ['focus']])
  assert.deepEqual(applyStarterThrough(null, 'explore'), { ok: false, reason: 'no-composer', send: false })
  assert.deepEqual(applyStarterThrough(face, 'nope'), { ok: false, reason: 'unknown-starter', send: false })
})

test('运行条：数据以宿主为准，拿不到给 0 并标 usageAvailable=false', () => {
  assert.deepEqual(runbarFromHost(undefined, 'new-1'), { snapshot: { ...RUNBAR_ZERO }, usageAvailable: false })
  const usage = { 's1': { rounds: 51, steps: 173, tokens: 128400, cacheHit: 96, contextPct: 62 } }
  assert.deepEqual(runbarFromHost(usage, 's1'), {
    snapshot: { rounds: 51, steps: 173, tokens: 128400, cacheHit: 96, contextPct: 62 },
    usageAvailable: true,
  })
  assert.deepEqual(
    runbarFromHost(usage, 'new-1'),
    { snapshot: { ...RUNBAR_ZERO }, usageAvailable: false },
    '宿主没有这条会话的数：给 0，不拿别的会话顶上',
  )
})

test('接线口径进了 client：显式注入、开发期开关、起手式广播', () => {
  assert.ok(CLIENT.includes('hostEmptyState'), '显式注入布尔')
  // 空态判据本身不做 DOM 嗅探；client 里其它功能（导出取正文、composer 聚焦）合法使用 querySelector
  assert.ok(CLIENT.includes('emptyStateDecision'), '空态判据由纯函数决定')
  assert.ok(CLIENT.includes('__DSH_LAUNCHER_EMPTY__'), '开发期开关')
  assert.ok(CLIENT.includes('launcher:starter'), 'W6 之前只广播，不写 DOM')
  assert.ok(CLIENT.includes("ctx.composer"), 'composer face 优先')
  assert.ok(CLIENT.includes('emptyStateDecision'), '判据与 lib 同口径')
})
