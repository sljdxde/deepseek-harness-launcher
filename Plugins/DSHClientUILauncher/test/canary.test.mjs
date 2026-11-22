/**
 * canary 脚本单测（票 36）：参数解析、两种期望的断言逻辑、真实 bootstrap 走通两条路径、CLI 退出码。
 *
 * 只测外部可观察结果：解析出的参数、evaluate 的判定、runCanary 的 snapshot、进程退出码。
 * 不测内部调用次数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseArgs,
  loadBaseline,
  hostShapeFor,
  hasVNode,
  createStubHost,
  evaluate,
  runCanary,
  main,
  MUTATED_HOST_VERSION,
} from '../scripts/canary.mjs'
import { guardHost } from '../lib/guard.js'

const SCRIPT = fileURLToPath(new URL('../scripts/canary.mjs', import.meta.url))
const baseline = loadBaseline()

test('parseArgs：默认 both + version 变异 + 非 json', () => {
  assert.deepEqual(parseArgs([]), {
    mode: 'both', hostVersion: undefined, mutate: 'version', baselinePath: undefined, json: false, help: false, real: false,
  })
})

test('parseArgs：逐个开关都能解析', () => {
  const args = parseArgs([
    '--mode', 'baseline', '--host-version', '0.2.2-rc.5', '--mutate', 'slot',
    '--baseline', '/tmp/b.json', '--json',
  ])
  assert.equal(args.mode, 'baseline')
  assert.equal(args.hostVersion, '0.2.2-rc.5')
  assert.equal(args.mutate, 'slot')
  assert.equal(args.baselinePath, '/tmp/b.json')
  assert.equal(args.json, true)
  assert.equal(parseArgs(['--help']).help, true)
})

test('parseArgs：非法枚举值 / 未知参数 / 缺取值都抛错', () => {
  assert.throws(() => parseArgs(['--mode', 'weird']), /--mode/)
  assert.throws(() => parseArgs(['--mutate', 'nope']), /--mutate/)
  assert.throws(() => parseArgs(['--bogus']), /未知参数/)
  assert.throws(() => parseArgs(['--host-version']), /缺少取值/)
})

test('hostShapeFor baseline：与基线同形，guard 放行', () => {
  const shape = hostShapeFor('baseline', baseline)
  assert.equal(shape.hostVersion, baseline.hostVersion)
  assert.equal(shape.baseline, baseline)
  assert.equal(shape.slots.length, baseline.slots.length)
  assert.deepEqual(shape.renderSlots, baseline.rootRenderSlots)
  assert.equal(guardHost(shape).ok, true)
})

test('hostShapeFor baseline：--host-version 覆盖到支持区间内的新 rc 仍放行', () => {
  const shape = hostShapeFor('baseline', baseline, { hostVersion: '0.2.2-rc.5' })
  assert.equal(shape.hostVersion, '0.2.2-rc.5')
  assert.equal(guardHost(shape).ok, true)
})

test('hostShapeFor mutated（version）：越界版本触发 blocker', () => {
  const shape = hostShapeFor('mutated', baseline)
  assert.equal(shape.hostVersion, MUTATED_HOST_VERSION)
  const result = guardHost(shape)
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((item) => item.code === 'version-out-of-range'))
})

test('hostShapeFor mutated（slot）：删掉 rightbar 触发 slot-missing，版本仍合法', () => {
  const shape = hostShapeFor('mutated', baseline, { mutate: 'slot' })
  assert.equal(shape.hostVersion, baseline.hostVersion)
  assert.ok(!shape.slots.some((slot) => slot.name === 'rightbar'))
  const result = guardHost(shape)
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((item) => item.code === 'slot-missing'))
})

test('hasVNode：能穿透嵌套与数组找到节点', () => {
  const tree = { type: 'div', props: {}, children: [{ type: 'span', props: { id: 'x' }, children: [] }] }
  assert.equal(hasVNode(tree, (node) => node?.props?.id === 'x'), true)
  assert.equal(hasVNode(tree, (node) => node?.props?.id === 'y'), false)
  assert.equal(hasVNode(null, () => true), false)
})

test('evaluate baseline：外壳在且无横幅 → 通过', () => {
  const host = createStubHost()
  host.register()
  const verdict = evaluate('baseline', host.snapshot())
  assert.equal(verdict.ok, true)
  assert.equal(verdict.verdict, 'baseline-ok')
  assert.deepEqual(verdict.reasons, [])
})

test('evaluate baseline：出现横幅 → 失败并给原因', () => {
  const host = createStubHost()
  host.mountBanner({ id: 'launcher-hostguard-banner' })
  const verdict = evaluate('baseline', host.snapshot())
  assert.equal(verdict.ok, false)
  assert.equal(verdict.verdict, 'baseline-broken')
  assert.ok(verdict.reasons.some((line) => line.includes('外壳未渲染')))
  assert.ok(verdict.reasons.some((line) => line.includes('横幅')))
})

test('evaluate mutated：横幅在且原生可见 → 通过', () => {
  const host = createStubHost()
  host.mountBanner({ id: 'launcher-hostguard-banner' })
  const verdict = evaluate('mutated', host.snapshot())
  assert.equal(verdict.ok, true)
  assert.equal(verdict.verdict, 'mutated-ok')
})

test('evaluate mutated：仍接管外壳 / 无横幅都算失败', () => {
  const host = createStubHost()
  host.register()
  const verdict = evaluate('mutated', host.snapshot())
  assert.equal(verdict.ok, false)
  assert.ok(verdict.reasons.some((line) => line.includes('没有出现')))
  assert.ok(verdict.reasons.some((line) => line.includes('仍然接管')))
})

test('runCanary baseline：真实 guard+bootstrap 走通，外壳渲染无横幅', () => {
  const result = runCanary({ mode: 'baseline', baseline })
  assert.equal(result.ok, true)
  assert.equal(result.guard.ok, true)
  assert.equal(result.registered, true)
  assert.equal(result.snapshot.banner, null)
  assert.equal(result.snapshot.native, false)
})

test('runCanary mutated：真实 guard+bootstrap 不接管，出横幅且原生可见', () => {
  const result = runCanary({ mode: 'mutated', baseline })
  assert.equal(result.ok, true)
  assert.equal(result.guard.ok, false)
  assert.equal(result.registered, false)
  assert.equal(result.snapshot.banner?.id, 'launcher-hostguard-banner')
  assert.equal(result.snapshot.native, true)
})

test('runCanary mutated：--mutate slot 同样不接管', () => {
  const result = runCanary({ mode: 'mutated', baseline, mutate: 'slot' })
  assert.equal(result.ok, true)
  assert.equal(result.registered, false)
  assert.ok(result.guard.blockers.includes('slot-missing'))
})

function capture() {
  const out = []
  const err = []
  return { io: { stdout: (line) => out.push(line), stderr: (line) => err.push(line) }, out, err }
}

test('main：both 通过返回 0，日志含两条路径', () => {
  const { io, out, err } = capture()
  const code = main(['--mode', 'both'], io)
  assert.equal(code, 0)
  const text = out.join('')
  assert.match(text, /verdict=baseline-ok PASS/)
  assert.match(text, /verdict=mutated-ok PASS/)
  assert.equal(err.join(''), '')
})

test('main：--json 输出可解析的结果数组', () => {
  const { io, out } = capture()
  const code = main(['--mode', 'both', '--json'], io)
  assert.equal(code, 0)
  const parsed = JSON.parse(out.join(''))
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed.map((item) => item.mode), ['baseline', 'mutated'])
})

test('main：参数错误返回 2', () => {
  const { io, err } = capture()
  assert.equal(main(['--mode', 'nope'], io), 2)
  assert.match(err.join(''), /--mode/)
})

test('main：baseline 文件读不到返回 3（明确失败，不假装成功）', () => {
  const { io, err } = capture()
  assert.equal(main(['--mode', 'baseline', '--baseline', '/nonexistent/canary-baseline.json'], io), 3)
  assert.match(err.join(''), /读不到契约基线/)
})

test('CLI：真实进程跑 both 退出 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--mode', 'both'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /全部通过/)
})

test('CLI：真实进程跑缺基线退出 3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canary-'))
  try {
    const result = spawnSync(process.execPath, [SCRIPT, '--baseline', join(dir, 'missing.json')], { encoding: 'utf8' })
    assert.equal(result.status, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseArgs：--real 被解析为真机模式', () => {
  assert.equal(parseArgs(['--real']).real, true)
  assert.equal(parseArgs([]).real, false)
})

test('--real 无 DSH_BIN 时 exit 3（跳过而不是假装成功）', () => {
  const previous = process.env.DSH_BIN
  delete process.env.DSH_BIN
  const out = []
  const err = []
  try {
    const status = main(['--real'], { stdout: (line) => out.push(line), stderr: (line) => err.push(line) })
    assert.equal(status, 3)
    assert.match(err.join(''), /跳过.*DSH_BIN/)
  } finally {
    if (previous !== undefined) process.env.DSH_BIN = previous
  }
})
