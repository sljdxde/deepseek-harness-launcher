/**
 * composer 四件的纯逻辑单测：/ 三档匹配、附件条、上下文计量、排队消息、引用插入。
 * 口径来自 05-设计 §6.3 与 §10-6/13/14。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ATTACH_LIMIT, SLASH_QUERY_LIMIT, addAttachment, breakdownOf, createQueue, filterSlash, levelOf, meterOf, meterHint, quoteBlockOf, slashQueryOf,
} from '../lib/composer.js'

test('/ 只在行首、无空白、无第二个斜杠时触发', () => {
  assert.equal(slashQueryOf('/'), '')
  assert.equal(slashQueryOf('/co'), 'co')
  assert.equal(slashQueryOf('前面的话\n/comp'), 'comp')
  assert.equal(slashQueryOf('/usr/bin'), null)
  assert.equal(slashQueryOf('/ '), null)
  assert.equal(slashQueryOf('x /co'), null)
  assert.equal(slashQueryOf(`/${'a'.repeat(SLASH_QUERY_LIMIT)}`), 'a'.repeat(SLASH_QUERY_LIMIT))
  assert.equal(slashQueryOf(`/${'a'.repeat(SLASH_QUERY_LIMIT + 1)}`), null)
})

test('/ 三档匹配：名字前缀 > 词首 > 任意位置，同档按名字', () => {
  const items = [
    { name: 're-compact' },
    { name: 'my:compact-now' },
    { name: 'compact' },
    { name: 'archive' },
  ]
  assert.deepEqual(filterSlash(items, 'comp').map((item) => item.name), ['compact', 'my:compact-now', 're-compact'])
  assert.deepEqual(filterSlash(items, 'now').map((item) => item.name), ['my:compact-now'])
  assert.deepEqual(filterSlash(items, 'chive').map((item) => item.name), ['archive'])
  assert.deepEqual(filterSlash(items, '').map((item) => item.name), ['archive', 'compact', 'my:compact-now', 're-compact'])
  assert.deepEqual(filterSlash(items, 'zzz'), [])
  assert.deepEqual(filterSlash(items, 'a'.repeat(SLASH_QUERY_LIMIT + 1)), [])
})

test('附件：上限 5、同 kind+name 去重、ref 不去重、id 可注入', () => {
  let seq = 0
  const makeId = () => `att-${(seq += 1)}`
  const dupInSmallList = addAttachment([{ id: 'att-0', kind: 'file', name: 'a.js' }], { kind: 'file', name: 'a.js' }, makeId)
  assert.equal(dupInSmallList.reason, 'dup', '同 kind+name 先按重复拒')
  let items = []
  for (const name of ['a.js', 'b.js', 'c.js', 'd.js', 'e.js']) {
    const result = addAttachment(items, { kind: 'file', name }, makeId)
    assert.equal(result.ok, true)
    items = result.items
  }
  const over = addAttachment(items, { kind: 'file', name: 'f.js' }, makeId)
  assert.equal(over.ok, false)
  assert.equal(over.reason, 'limit')
  assert.equal(items.length, ATTACH_LIMIT)

  const full = addAttachment(items, { kind: 'file', name: 'a.js' }, makeId)
  assert.equal(full.reason, 'limit', '满了以后连重复都按上限拒')

  const refTwice = addAttachment([], { kind: 'ref', name: '会话 12' }, makeId)
  const refAgain = addAttachment(refTwice.items, { kind: 'ref', name: '会话 12' }, makeId)
  assert.equal(refAgain.ok, true, 'ref 按设计不去重')
  assert.equal(refAgain.items.length, 2)
})

test('计量：真机口径 round(used/window*100)，85/95 两档阈值', () => {
  assert.deepEqual(meterOf({ used: 0, window: 200000 }), { pct: 0, level: 'normal' })
  assert.deepEqual(meterOf({ used: 170000, window: 200000 }), { pct: 85, level: 'warn' })
  assert.deepEqual(meterOf({ used: 190000, window: 200000 }), { pct: 95, level: 'hot' })
  assert.deepEqual(meterOf({ used: 300000, window: 200000 }), { pct: 100, level: 'hot' })
  assert.deepEqual(meterOf({ used: 10, window: 0 }), { pct: 0, level: 'normal' })
  assert.equal(levelOf(84.9), 'normal')
  assert.equal(levelOf(85), 'warn')
  assert.equal(levelOf(95), 'hot')
})

test('计量环的 title 与 aria-label 共用同一句（定稿文案）', () => {
  const { pct, level } = meterOf({ used: 176000, window: 200000 })
  assert.equal(meterHint(pct), '上下文占用 88%，该压缩了 · 点开压到 40%')
  assert.equal(level, 'warn', '颜色只由 level 决定，不靠文案')
})

test('四项拆分之和恒等于显示值', () => {
  const cases = [
    { raw: { system: 10, chat: 60, files: 20, tools: 10 }, pct: 85 },
    { raw: { system: 1, chat: 1, files: 1, tools: 1 }, pct: 95 },
    { raw: { system: 0, chat: 0, files: 0, tools: 0 }, pct: 40 },
    { raw: { system: 7, chat: 0, files: 3, tools: 0 }, pct: 100 },
  ]
  for (const { raw, pct } of cases) {
    const parts = breakdownOf(raw, pct)
    const sum = parts.system + parts.chat + parts.files + parts.tools
    assert.equal(sum, pct, JSON.stringify({ raw, pct, parts }))
    for (const value of Object.values(parts)) assert.ok(Number.isInteger(value) && value >= 0)
  }
})

test('排队消息：只在发送中入队，否则让调用方直接发', () => {
  let sending = false
  const queue = createQueue({ isSending: () => sending })
  assert.equal(queue.enqueue({ text: 'a' }).reason, 'not-sending')
  sending = true
  const added = queue.enqueue({ text: 'a' })
  assert.equal(added.ok, true)
  assert.equal(queue.count(), 1)
})

test('排队消息：fire 成功出队并发送，二次 fire 返回 gone', async () => {
  const sent = []
  const queue = createQueue({
    isSending: () => true,
    abort: () => {},
    waitForRunEnd: async () => true,
    send: async (sessionId, message) => sent.push({ sessionId, text: message.text }),
    makeId: () => 'q1',
  })
  queue.enqueue({ text: '第一条' }, 's1')
  assert.deepEqual(await queue.fire('q1'), { ok: true })
  assert.deepEqual(sent, [{ sessionId: 's1', text: '第一条' }])
  assert.equal(queue.count(), 0)
  assert.deepEqual(await queue.fire('q1'), { ok: false, reason: 'gone' })
})

test('排队消息：abort 超时不发送、留在队列', async () => {
  let sends = 0
  const queue = createQueue({
    isSending: () => true,
    waitForRunEnd: async () => false,
    send: async () => { sends += 1 },
    makeId: () => 'q1',
  })
  queue.enqueue({ text: 'x' })
  assert.deepEqual(await queue.fire('q1'), { ok: false, reason: 'abort-timeout' })
  assert.equal(sends, 0)
  assert.equal(queue.count(), 1)
})

test('排队消息：同一 id 并发 fire 只跑一次', async () => {
  let releases = null
  const queue = createQueue({
    isSending: () => true,
    waitForRunEnd: () => new Promise((resolve) => { releases = resolve }),
    send: async () => {},
    makeId: () => 'q1',
  })
  queue.enqueue({ text: 'x' })
  const first = queue.fire('q1')
  const second = await queue.fire('q1')
  assert.deepEqual(second, { ok: false, reason: 'busy' })
  releases(true)
  assert.deepEqual(await first, { ok: true })
})

test('排队消息：remove 与 clear', () => {
  const queue = createQueue({ isSending: () => true, makeId: () => 'q1' })
  queue.enqueue({ text: 'a' })
  assert.equal(queue.remove('q1'), true)
  assert.equal(queue.remove('q1'), false)
  queue.enqueue({ text: 'b' })
  queue.clear()
  assert.equal(queue.count(), 0)
})

test('排队消息：edit 取回输入框并从队列移除', () => {
  const queue = createQueue({ isSending: () => true, makeId: () => 'q1' })
  queue.enqueue({ text: '写一半' })
  const taken = queue.edit('q1')
  assert.equal(taken.text, '写一半')
  assert.equal(queue.count(), 0)
  assert.equal(queue.edit('q1'), null)
})

test('引用插入：每行前置 > ，空内容与超长拒绝', () => {
  const ok = quoteBlockOf('第一行\n第二行')
  assert.equal(ok.ok, true)
  assert.equal(ok.block, '> 第一行\n> 第二行')
  assert.equal(ok.lines, 2)
  assert.equal(quoteBlockOf('   ').reason, 'empty')
  assert.equal(quoteBlockOf('x'.repeat(8001)).reason, 'too-long')
})
