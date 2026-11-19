#!/usr/bin/env node
/**
 * 宿主槽契约快照（05-设计 §5）。
 *
 * 为什么：槽名、kind、席位清单、root 的 renderSlots 都是宿主私有契约，宿主升级后的
 * 症状是"功能静默消失、控制台 0 报错"。所以把宿主已安装的 d.ts 解析成一份可 diff 的
 * JSON，CI 里 `--check` 与 baseline 比，差一项就红；`--write` 只在确认跟进后更新。
 *
 * 用法：
 *   node tools/contract-snapshot.mjs --check
 *   node tools/contract-snapshot.mjs --write
 *   node tools/contract-snapshot.mjs --check --layout-from <dir> --sidebar-from <dir>
 *
 * 默认从 (仓库根)/Plugins/DSHClientUILauncher/node_modules 找宿主包；本仓库不装
 * node_modules 时用 --layout-from/--sidebar-from 指向 npm 快照目录。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(PACKAGE_ROOT, 'contracts', 'host-baseline.json')

const args = process.argv.slice(2)
const mode = args.includes('--write') ? 'write' : (args.includes('--check') ? 'check' : null)

function argValue(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

/** 在源码里找出 interface 块的花括号范围。 */
function interfaceBlock(source, name) {
  const start = source.indexOf(`interface ${name} {`)
  if (start < 0) return null
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  return null
}

/** 从一段槽声明里抽出 `'name': { kind, scope }` 条目。 */
function slotsOf(block) {
  if (block === null) return []
  const slots = []
  const entryPattern = /'([^']+)':\s*\{/g
  let match
  while ((match = entryPattern.exec(block)) !== null) {
    const body = bracesAt(block, match.index + match[0].length - 1)
    if (body === null) continue
    const kind = /kind:\s*'([^']+)'/.exec(body)?.[1] ?? null
    const scope = /scope:\s*'([^']+)'/.exec(body)?.[1] ?? null
    if (kind === null) continue
    slots.push({ name: match[1], kind, scope })
  }
  return slots
}

/** 从 `{` 处读到配对的 `}`，返回内部文本。 */
function bracesAt(source, openIndex) {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, index)
    }
  }
  return null
}

/** 从 `interface ILayout {…}` 里抽成员名（服务面缺口，W1 尾补）。 */
function faceMembersOf(source) {
  const body = interfaceBlock(source, 'ILayout')
  if (body === null) return []
  const members = []
  for (const line of body.split('\n')) {
    const name = /^\s*readonly\s+([A-Za-z_$][\w$]*)/.exec(line)?.[1] ?? /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(line)?.[1]
    if (name !== undefined) members.push(name)
  }
  return members
}

/** 从 AppFrame 的 `PropsRenderSlots<'a' | 'b'>` 里抽子槽名。 */
function renderSlotsOf(source) {
  const match = /PropsRenderSlots<([^>]+)>/.exec(source)
  if (match === null) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

/**
 * 抽 `interface X {…}` 的成员签名（原样文本去掉多余空白），用于"参数形态变了"这类 diff。
 */
function signaturesOf(block) {
  if (block === null) return []
  const out = []
  for (const raw of block.split('\n')) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (line === '' || line.startsWith('*') || line.startsWith('/*')) continue
    if (!/^(readonly\s+)?[A-Za-z_$][\w$]*(\s*[(:<?])/.test(line)) continue
    out.push(line.replace(/[;,]?$/, ''))
  }
  return out
}

/** 从宿主编译产物里读 `provideRoot({ hooks: { … } })` 的 hook 键。 */
function rootHookKeysOf(clientSource) {
  const match = /provideRoot\(\{\s*hooks:\s*\{([^}]*)\}/.exec(clientSource)
  if (match === null) return []
  return [...match[1].matchAll(/([A-Za-z_$][\w$]*)\s*[:(]/g)].map((entry) => entry[1])
}

function readOrThrow(path, what) {
  if (!existsSync(path)) {
    process.stderr.write(`找不到 ${what}：${path}\n`)
    process.exit(3)
  }
  return readFileSync(path, 'utf8')
}

function packageVersion(packageDir) {
  const manifest = join(packageDir, 'package.json')
  if (!existsSync(manifest)) return null
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null
  } catch {
    return null
  }
}

/** 解析宿主：ui-layout 的 6 子槽 + root 的 renderSlots，ui-sidebar 的席位。 */
function collect({ layoutFrom, sidebarFrom, slotsFrom }) {
  const layoutSource = readOrThrow(join(layoutFrom, 'lib/types/client/index.d.ts'), 'ui-layout 的客户端类型')
  const frameSource = readOrThrow(join(layoutFrom, 'lib/types/client/AppFrame.d.ts'), 'ui-layout 的 AppFrame 类型')
  const slots = slotsOf(interfaceBlock(layoutSource, 'SlotMap'))
  const seats = sidebarFrom === null
    ? null
    : slotsOf(interfaceBlock(readOrThrow(join(sidebarFrom, 'lib/types/client/contract/slots.d.ts'), 'ui-sidebar 的槽契约'), 'SlotMap'))
  const serviceSource = readOrThrow(join(layoutFrom, 'lib/types/client/service.d.ts'), 'ui-layout 的服务面类型')
  const layoutClientSource = readOrThrow(join(layoutFrom, 'lib/client.js'), 'ui-layout 的客户端产物')
  return {
    host: {
      layoutPackage: '@deepseek-ai/dsh-client-ui-layout',
      layoutVersion: packageVersion(layoutFrom),
      sidebarPackage: sidebarFrom === null ? null : '@deepseek-ai/dsh-client-ui-sidebar',
      sidebarVersion: sidebarFrom === null ? null : packageVersion(sidebarFrom),
    },
    slots: slots.map((slot) => ({ name: slot.name, kind: slot.kind, scope: slot.scope })),
    rootRenderSlots: renderSlotsOf(frameSource),
    seats: seats === null ? null : seats.map((seat) => ({ name: seat.name, kind: seat.kind, scope: seat.scope })),
    layoutService: {
      face: faceMembersOf(serviceSource),
      standardProps: [...new Set([...frameSource.matchAll(/usePanelInfo/g)].map(() => 'usePanelInfo'))],
    },
    // 三组服务指纹（05 回写后的 W1 尾判据）：layout 六成员与参数形态 / panelInfo 字段+observable /
    // provideRoot.hooks 必含 panelInfo。任何一组变了，外壳的接管方式都要重新看一眼。
    services: {
      layout: {
        members: faceMembersOf(serviceSource),
        signatures: signaturesOf(interfaceBlock(serviceSource, 'ILayout')),
      },
      panelInfo: {
        fields: signaturesOf(interfaceBlock(serviceSource, 'PanelInfo')),
        // HostObservable<T> = ObservableSnapshot<T> 的别名行 + 宿主实际使用的方法名（编译产物里
        // `getSnapshot` / `subscribe` 是 panelInfo 唯二被调用的成员）。别名行变了就红。
        observable: {
          alias: (/export type HostObservable<T> = [^;]+;/.exec(readOrThrow(join(slotsFrom, 'lib/types/renderer.d.ts'), 'ui-slots 的 observable 类型')) ?? [''])[0],
          methods: ['getSnapshot', 'subscribe'],
        },
      },
      provideRoot: { hooks: rootHookKeysOf(layoutClientSource) },
    },
  }
}

function diff(baseline, current) {
  const out = []
  const index = (list) => new Map((list ?? []).map((item) => [item.name, item]))
  const before = index(baseline.slots)
  const after = index(current.slots)
  for (const [name, slot] of after) {
    if (!before.has(name)) out.push(`slot:new ${name} (${slot.kind})`)
    else if (before.get(name).kind !== slot.kind) out.push(`slot:kind-changed ${name}: ${before.get(name).kind} → ${slot.kind}`)
  }
  for (const name of before.keys()) if (!after.has(name)) out.push(`slot:removed ${name}`)
  const seatsBefore = index(baseline.seats)
  const seatsAfter = index(current.seats)
  for (const [name, seat] of seatsAfter) {
    if (!seatsBefore.has(name)) out.push(`seat:new ${name} (${seat.kind})`)
    else if (seatsBefore.get(name).kind !== seat.kind) out.push(`seat:kind-changed ${name}: ${seatsBefore.get(name).kind} → ${seat.kind}`)
  }
  for (const name of seatsBefore.keys()) if (!seatsAfter.has(name)) out.push(`seat:removed ${name}`)
  const faceBefore = JSON.stringify(baseline.layoutService?.face ?? [])
  const faceAfter = JSON.stringify(current.layoutService?.face ?? [])
  if (faceBefore !== faceAfter) out.push(`layout:face ${faceBefore} → ${faceAfter}`)
  const beforeServices = baseline.services ?? {}
  const afterServices = current.services ?? {}
  for (const group of ['layout', 'panelInfo', 'provideRoot']) {
    if (afterServices[group] === undefined) continue
    if (beforeServices[group] === undefined) { out.push(`service:missing ${group}`); continue }
    const beforeSig = JSON.stringify(beforeServices[group])
    const afterSig = JSON.stringify(afterServices[group])
    if (beforeSig === afterSig) continue
    const beforeMembers = beforeServices[group].members ?? beforeServices[group].fields ?? beforeServices[group].hooks ?? []
    const afterMembers = afterServices[group].members ?? afterServices[group].fields ?? afterServices[group].hooks ?? []
    const removed = beforeMembers.filter((name) => !afterMembers.includes(name))
    const added = afterMembers.filter((name) => !beforeMembers.includes(name))
    if (removed.length > 0) out.push(`service:missing ${group}: ${removed.join(', ')}`)
    if (added.length > 0) out.push(`service:shape-changed ${group}: +${added.join(', ')}`)
    const beforeShapes = JSON.stringify(beforeServices[group].signatures ?? beforeServices[group].observable ?? beforeServices[group].hooks ?? [])
    const afterShapes = JSON.stringify(afterServices[group].signatures ?? afterServices[group].observable ?? afterServices[group].hooks ?? [])
    if (beforeShapes !== afterShapes && removed.length === 0 && added.length === 0) {
      out.push(`service:signature-changed ${group}`)
    }
    if (group === 'provideRoot' && JSON.stringify(beforeServices.provideRoot.hooks) !== JSON.stringify(afterServices.provideRoot.hooks)) {
      out.push(`hook:changed ${JSON.stringify(beforeServices.provideRoot.hooks)} → ${JSON.stringify(afterServices.provideRoot.hooks)}`)
    }
  }
  const renderBefore = JSON.stringify(baseline.rootRenderSlots ?? [])
  const renderAfter = JSON.stringify(current.rootRenderSlots ?? [])
  if (renderBefore !== renderAfter) out.push(`root:render-slots ${renderBefore} → ${renderAfter}`)
  return out
}

if (mode === null) {
  process.stderr.write('用法：node tools/contract-snapshot.mjs --check|--write [--layout-from <dir>] [--sidebar-from <dir>]\n')
  process.exit(2)
}

const layoutFrom = argValue('--layout-from') ?? join(PACKAGE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-layout')
const sidebarFrom = argValue('--sidebar-from') ?? join(PACKAGE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar')
const slotsFrom = argValue('--slots-from') ?? join(PACKAGE_ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-slots')
const current = collect({
  layoutFrom,
  sidebarFrom: existsSync(join(sidebarFrom, 'lib/types/client/contract/slots.d.ts')) ? sidebarFrom : null,
  slotsFrom,
})

if (mode === 'write') {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
  process.stdout.write(`已写入 ${BASELINE}\n槽 ${current.slots.length} 条，席位 ${(current.seats ?? []).length} 条，renderSlots ${current.rootRenderSlots.length} 个\n`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  process.stderr.write(`没有 baseline（${BASELINE}），先跑 --write 并确认\n`)
  process.exit(3)
}
const differences = diff(JSON.parse(readFileSync(BASELINE, 'utf8')), current)
if (differences.length === 0) {
  process.stdout.write(`宿主契约与 baseline 一致（${current.host.layoutPackage}@${current.host.layoutVersion}）\n`)
  process.exit(0)
}
process.stderr.write(`宿主契约与 baseline 有 ${differences.length} 处差异：\n${differences.map((line) => `  ${line}`).join('\n')}\n`)
process.stderr.write('确认跟进后跑 --write 更新 baseline，并在 PR 里写"宿主改了什么、我们跟进了什么"。\n')
process.exit(2)
