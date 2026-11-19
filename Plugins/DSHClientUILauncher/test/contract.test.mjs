/**
 * 契约层单测：包内常量表必须与 contracts/host-baseline.json 逐条一致。
 *
 * 这是 §5 的第二道闸（第一道是 tools/contract-snapshot.mjs --check 与宿主的 d.ts 比）。
 * 两道都要，因为 baseline 与常量表各自可能被顺手改掉。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { SUB_SLOTS, ROOT_RENDER_SLOTS, SIDEBAR_SEATS, LAYOUT_FACE_MEMBERS, OVERLAY_IDS, DOCK_TABS, diffContract, describeDiff } from '../lib/contract.js'
import { moduleIdBlock, withContractBlock, withModuleId, runSync } from '../tools/sync-contract.mjs'
import { checkHostVersion } from '../tools/check-host-version.mjs'
import { mkdtempSync as mkTmp, rmSync as rmTmp } from 'node:fs'

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

test('布局服务面：包内成员表与宿主 baseline 的 ILayout 逐条一致（服务面缺口，W1 尾补）', () => {
  assert.deepEqual([...LAYOUT_FACE_MEMBERS], baseline.layoutService.face)
  assert.deepEqual(baseline.layoutService.standardProps, ['usePanelInfo'], 'ui-sidebar 靠它决定侧栏高亮')
})

test('client/client.js 的契约块是生成的，手改就会红', () => {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  const synced = withContractBlock(source)
  assert.notEqual(synced, null, 'client.js 里必须有 children-from-contract 标记区')
  assert.equal(synced, source, '跑 node tools/sync-contract.mjs 更新，别手改')
})

test('同步脚本 CLI 自己可用：--check 退出码 0', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/sync-contract.mjs', import.meta.url)), '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /契约块已是最新/)
})

test('同步脚本：漂移时 --check 退出 1、写回后 0、没有标记区退出 3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-sync-'))
  const target = join(dir, 'client.js')
  const drifted = [
    'x',
    '// #region module-id',
    'const MODULE_ID = "stale"',
    '// #endregion module-id',
    '  // #region children-from-contract',
    '  const CHILDREN = {}',
    '  // #endregion children-from-contract',
    'y',
    '',
  ].join('\n')
  writeFileSync(target, drifted)
  const lines = []
  const log = (line) => lines.push(line)
  assert.equal(runSync({ check: true, target, log }), 1, '手改过的块要被拒')
  assert.equal(runSync({ target, log }), 0, '不带 --check 时写回')
  assert.equal(runSync({ check: true, target, log }), 0, '写回后检查通过')
  writeFileSync(join(dir, 'plain.js'), 'no markers here\n')
  assert.equal(runSync({ check: true, target: join(dir, 'plain.js'), log }), 3)
  rmSync(dir, { recursive: true, force: true })
})

test('服务指纹进入 baseline：layout 六成员/签名、panelInfo 字段与 observable、provideRoot.hooks', () => {
  assert.deepEqual(baseline.services.layout.members, [...LAYOUT_FACE_MEMBERS])
  assert.equal(baseline.services.layout.signatures.length, 6, '六成员的参数形态都记了')
  assert.deepEqual(baseline.services.panelInfo.fields, ['readonly activePanelId: MainPanelId | null'])
  assert.deepEqual(baseline.services.panelInfo.observable.methods, ['getSnapshot', 'subscribe'])
  assert.deepEqual(baseline.services.provideRoot.hooks, ['panelInfo'], 'provideRoot.hooks 必含 panelInfo')
})

test('client 的模块 id 由 package.json 的 name 生成（同名替换的前提）', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  assert.ok(source.includes(moduleIdBlock(manifest.name)), 'module-id 段必须与包名一致')
  assert.equal(withModuleId(source, 'x'), withModuleId(source, 'x'))
})

test('同步脚本 CLI 自己可用：--check', () => {
  const out = mkTmp(join(tmpdir(), 'launcher-cli-'))
  try {
    const synced = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/sync-contract.mjs', import.meta.url)), '--check'], { encoding: 'utf8' })
    assert.equal(synced.status, 0, synced.stderr)
    const onlyId = join(out, 'only-id.js')
    writeFileSync(onlyId, '// #region module-id\nconst MODULE_ID = "x"\n// #endregion module-id\n')
    assert.equal(runSync({ check: true, target: onlyId, log: () => {} }), 3, '缺 children 标记区要退出 3')
  } finally {
    rmTmp(out, { recursive: true, force: true })
  }
})

test('版本锁：包版本必须等于宿主 ui-layout 版本，不符即失败（裁决 §1）', () => {
  const ok = checkHostVersion()
  assert.equal(ok.ok, true, JSON.stringify(ok))
  assert.equal(ok.packageVersion, ok.hostVersion)
  const bad = checkHostVersion({ hostVersion: '9.9.9' })
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'version-mismatch')
  const missing = checkHostVersion({ hostVersion: '' })
  assert.equal(missing.reason, 'contract-snapshot-missing')
})

test('版本锁 CLI：一致退出 0、不符退出 1', () => {
  const tool = fileURLToPath(new URL('../tools/check-host-version.mjs', import.meta.url))
  const ok = spawnSync(process.execPath, [tool], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /版本锁通过/)
  const bad = spawnSync(process.execPath, [tool, '--host-version', '9.9.9'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /版本锁失败/)
})
