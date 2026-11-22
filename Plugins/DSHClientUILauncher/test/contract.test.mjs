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
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { SUB_SLOTS, ROOT_RENDER_SLOTS, SIDEBAR_SEATS, LAYOUT_FACE_MEMBERS, OVERLAY_IDS, DOCK_TABS, SUPPORTED_HOST_RANGE, diffContract, describeDiff } from '../lib/contract.js'
import { moduleIdBlock, withContractBlock, withModuleId, withShellBlock, runSync, buildStampBlock, shellBlock } from '../tools/sync-contract.mjs'
import { checkHostVersion, realHostVersion } from '../tools/check-host-version.mjs'
import { chmodSync, mkdirSync, mkdtempSync as mkTmp, rmSync as rmTmp } from 'node:fs'

const baseline = JSON.parse(readFileSync(new URL('../contracts/host-baseline.json', import.meta.url), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

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

test('baseline 用实装宿主重生成：记录 hostVersion 与主题前缀', () => {
  assert.match(String(baseline.hostVersion), /^\d+\.\d+\.\d+/, 'baseline 必须记录 hostVersion（--write 从实装宿主读出）')
  assert.equal(baseline.hostVersion, baseline.host.layoutVersion, 'hostVersion 就是宿主包版本')
  assert.match(String(baseline.themePrefix), /^--[a-z]+-$/, 'baseline 必须记录宿主主题变量前缀')
})

test('包声明：engines.dsh 支持区间下界取实装宿主版本，peerDependencies 覆盖 dsh + 五个 client 子包', () => {
  assert.equal(manifest.engines?.dsh, SUPPORTED_HOST_RANGE, 'engines.dsh 与 lib/contract.js 的支持区间常量同源')
  const lower = /^>=([^ ]+) </.exec(SUPPORTED_HOST_RANGE)?.[1]
  assert.equal(lower, baseline.hostVersion, '支持区间下界必须等于实装宿主版本')
  assert.equal(manifest.version, baseline.hostVersion, '同名 drop-in：本包版本镜像宿主版本（版本锁三方一致）')

  const expectedPeers = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-client-shortcuts',
  ]
  assert.deepEqual(Object.keys(manifest.peerDependencies ?? {}).sort(), [...expectedPeers].sort())
  for (const name of expectedPeers) assert.equal(manifest.peerDependencies[name], SUPPORTED_HOST_RANGE, `${name} 的 peer 区间`)
  // dsh.client.inject 就是这五个 client 子包的实际引用来源
  assert.deepEqual([...manifest.dsh.client.inject].sort(), expectedPeers.filter((name) => name !== '@deepseek-ai/dsh').sort())
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
  const normalize = (text) => text.replace(/const BUILD_STAMP = "[^"]*"/, 'const BUILD_STAMP = "X"')
  const synced = withContractBlock(source)
  assert.notEqual(synced, null, 'client.js 里必须有 children-from-contract 标记区')
  // BUILD_STAMP 随每次提交变化（stamp 提交天然落后一笔），不参与“手改”判定
  assert.equal(normalize(synced), normalize(source), '跑 node tools/sync-contract.mjs 更新，别手改')
})

test('client/client.js 的壳层块也是生成的，手改就会红（票 30）', () => {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  assert.ok(source.includes('// #region shell-from-lib'), 'client.js 必须有 shell-from-lib 标记区')
  assert.equal(withShellBlock(source), source, '跑 node tools/sync-contract.mjs 更新，别手改')
})

test('壳层块包含令牌 CSS、图标与渲染函数（票 30）', () => {
  const block = shellBlock()
  assert.match(block, /\/\/ #region shell-from-lib/)
  assert.match(block, /const TOKENS_CSS = "/)
  assert.match(block, /const SKELETON_CSS = "/)
  assert.match(block, /const SHELL_ICONS = \{/)
  assert.match(block, /const shellColumns = function shellColumns/)
  assert.match(block, /const renderRail = function renderRail/)
  assert.match(block, /const renderStatusbar = function renderStatusbar/)
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

test('版本锁：三方比对（宿主 = 基线 = 本包），不符即失败（裁决 §1）', () => {
  // 用 fixture 注入宿主版本，避免依赖机器上有没有装宿主（否则无宿主环境恒红）
  const ok = checkHostVersion({ hostVersion: manifest.version })
  assert.equal(ok.ok, true, JSON.stringify(ok))
  assert.equal(ok.baseline, ok.packageVersion)
  const hostMismatch = checkHostVersion({ hostVersion: '9.9.9' })
  assert.equal(hostMismatch.ok, false)
  assert.equal(hostMismatch.reason, 'host-vs-baseline')
  const noHost = checkHostVersion({ hostVersion: '' })
  assert.equal(noHost.reason, 'host-version-unreadable')
  const noBaseline = checkHostVersion({ hostVersion: manifest.version, baselineVersion: '' })
  assert.equal(noBaseline.reason, 'contract-snapshot-missing')
  // 宿主 = 基线但都不等于本包版本 → 指出是「本包 vs 基线」这一方。
  const pkgMismatch = checkHostVersion({ hostVersion: '0.2.2-rc.9', baselineVersion: '0.2.2-rc.9' })
  assert.equal(pkgMismatch.ok, false)
  assert.equal(pkgMismatch.reason, 'package-vs-baseline')
})

test('版本锁 CLI：一致退 0、不符退 1、读不到宿主退 3（用 --host-version 注入 fixture）', () => {
  const tool = fileURLToPath(new URL('../tools/check-host-version.mjs', import.meta.url))
  const ok = spawnSync(process.execPath, [tool, '--host-version', manifest.version], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /版本锁通过/)
  const bad = spawnSync(process.execPath, [tool, '--host-version', '9.9.9'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /版本锁失败/)
  const unreadable = spawnSync(process.execPath, [tool, '--host-version', ''], { encoding: 'utf8' })
  assert.equal(unreadable.status, 3)
  const pkgBad = spawnSync(process.execPath, [tool, '--host-version', '0.2.2-rc.9', '--baseline-version', '0.2.2-rc.9'], { encoding: 'utf8' })
  assert.equal(pkgBad.status, 1)
  assert.match(pkgBad.stderr, /package-vs-baseline/)
})

test('版本锁工具：读不到宿主时给出可判定结果（不靠机器环境）', () => {
  const noHost = checkHostVersion({ hostVersion: '' })
  assert.equal(noHost.ok, false)
  assert.equal(noHost.reason, 'host-version-unreadable')
  assert.equal(typeof noHost.host, 'string')
})

test('宿主版本读取：profile 里的 dsh 包优先，其次 DSH_BIN --version，都读不到返回空串', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hostver-'))
  try {
    mkdirSync(join(dir, 'node_modules/@deepseek-ai/dsh'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '1.2.3' }))
    assert.equal(realHostVersion({ profileDir: dir }), '1.2.3')
    assert.equal(realHostVersion({}), '', '没有 profile 也没有 dsh 时返回空串')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('宿主版本读取：没有 profile 时退回 DSH_BIN --version（带 v 前缀也能解析）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hostbin-'))
  const bin = join(dir, 'fake-dsh.mjs')
  writeFileSync(bin, '#!/usr/bin/env node\nprocess.stdout.write("v2.3.4\\n")\n')
  chmodSync(bin, 0o755)
  try {
    assert.equal(realHostVersion({ dshBin: bin }), '2.3.4')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('宿主版本读取：profile 里 dsh 包是坏 JSON 时落到下一档（不抛错）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hostbad-'))
  try {
    mkdirSync(join(dir, 'node_modules/@deepseek-ai/dsh'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/@deepseek-ai/dsh/package.json'), '{ not json')
    assert.equal(realHostVersion({ profileDir: dir }), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('页面 data-build：构建标记 = 包版本 + git 短 sha，且 client 里已注入', () => {
  // stamp 是「上次同步时的 HEAD」：允许 HEAD 与 HEAD^（提交 stamp 本身会让它落后一笔）
  const stamp = buildStampBlock()
  const acceptable = new Set([stamp])
  for (const ref of ['HEAD^', 'HEAD~2']) {
    try {
      const sha = execFileSync('git', ['-C', fileURLToPath(new URL('..', import.meta.url)), 'rev-parse', '--short', ref], { encoding: 'utf8' }).trim()
      const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
      acceptable.add(`${version}+${sha}`)
    } catch {
      /* 浅克隆/无父提交就只认当前 */
    }
  }
  assert.match(stamp, /^\d+\.\d+\.\d+(-[\w.]+)?\+[\w]+$/)
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  const match = source.match(/const BUILD_STAMP = "([^"]*)"/)
  assert.ok(match !== null, 'client 必须有 BUILD_STAMP')
  assert.ok(acceptable.has(match[1]), `client 的 BUILD_STAMP 必须是 HEAD/HEAD^/HEAD~2 之一，实际 ${match[1]}`)
  assert.ok(source.includes("'data-build': BUILD_STAMP"), '根元素必须输出 data-build')
})
