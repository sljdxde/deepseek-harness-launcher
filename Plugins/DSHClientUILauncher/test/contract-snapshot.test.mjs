/**
 * 契约快照 CLI 的结构比较与变异 fixture 测试（缝合点 S1）。
 *
 * 这里不依赖机器上装没装宿主：用 baseline 反向生成一个"等价宿主"目录树（d.ts + client.js），
 * 让 `contract-snapshot.mjs --write/--check` 在这棵树上跑，再逐类篡改宿主形状，断言
 * 退出码非 0 且 stderr 打印对应 blocker。这样 CI 与开发机都不需要联网安装宿主。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const TOOL = join(PKG, 'tools', 'contract-snapshot.mjs')
const BASELINE = JSON.parse(readFileSync(join(PKG, 'contracts', 'host-baseline.json'), 'utf8'))

const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * 用一个"宿主形状"对象生成可被 contract-snapshot 解析的目录树。
 * 默认形状拷贝自 baseline，因此 --write 出来的 baseline 与仓库 baseline 等价。
 * @param {string} dir - 生成根目录（下面有 layout/sidebar/slots 三个包）。
 * @param {(host: object) => void} [mutate] - 就地篡改形状，模拟宿主漂移。
 * @returns {{layout:string,sidebar:string,slots:string}} 三个包目录。
 */
function buildHost(dir, mutate = () => {}) {
  const host = {
    slots: BASELINE.slots.map((slot) => ({ ...slot })),
    seats: (BASELINE.seats ?? []).map((seat) => ({ ...seat })),
    renderSlots: [...BASELINE.rootRenderSlots],
    signatures: [...BASELINE.services.layout.signatures],
    panelInfoFields: [...BASELINE.services.panelInfo.fields],
    themePrefix: BASELINE.themePrefix ?? '--dsh-',
    layoutVersion: BASELINE.hostVersion ?? BASELINE.host.layoutVersion,
    sidebarVersion: BASELINE.host.sidebarVersion ?? BASELINE.host.layoutVersion,
  }
  mutate(host)

  const layout = join(dir, 'layout')
  const sidebar = join(dir, 'sidebar')
  const slots = join(dir, 'slots')

  const slotBody = host.slots.map((slot) => `    '${slot.name}': { kind: '${slot.kind}', scope: '${slot.scope}' },`).join('\n')
  write(join(layout, 'lib/types/client/index.d.ts'), `export declare namespace Client {\n  interface SlotMap {\n${slotBody}\n  }\n}\n`)
  write(join(layout, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-layout', version: host.layoutVersion }))

  const union = host.renderSlots.map((name) => `'${name}'`).join(' | ')
  write(
    join(layout, 'lib/types/client/AppFrame.d.ts'),
    `import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';\n` +
      `export type AppFrameProps = PropsRuntime<'root'> & PropsRenderSlots<${union}> & InjectFace<AppFrameInjected>;\n` +
      `export declare function AppFrame({ useStore, usePanelInfo, }: AppFrameProps): unknown;\n`,
  )

  const memberLines = host.signatures.map((line) => `    ${line};`).join('\n')
  const fieldLines = host.panelInfoFields.map((line) => `    ${line};`).join('\n')
  write(
    join(layout, 'lib/types/client/service.d.ts'),
    `export interface PanelInfo {\n${fieldLines}\n}\n` +
      `export interface ILayout {\n${memberLines}\n}\n`,
  )

  // client.js 同时承载 provideRoot.hooks 与主题变量前缀（宿主实际用这两种指纹）。
  const themeVars = Array.from({ length: 8 }, (_, index) => `var(${host.themePrefix}alias-token-${index}, #fff)`).join('; ')
  write(join(layout, 'lib/client.js'), `provideRoot({hooks:{panelInfo:layout.panelInfo}});\nconst theme = "${themeVars}";\n`)

  const seatBody = host.seats.map((seat) => `    '${seat.name}': { kind: '${seat.kind}', scope: '${seat.scope}' },`).join('\n')
  write(join(sidebar, 'lib/types/client/contract/slots.d.ts'), `export declare namespace Client {\n  interface SlotMap {\n${seatBody}\n  }\n}\n`)
  write(join(sidebar, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-sidebar', version: host.sidebarVersion }))

  write(join(slots, 'lib/types/renderer.d.ts'), 'export type HostObservable<T> = ObservableSnapshot<T>;\n')
  write(join(slots, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-slots', version: host.layoutVersion }))

  return { layout, sidebar, slots }
}

function runTool(args) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' })
}

function dirs(host) {
  return ['--layout-from', host.layout, '--sidebar-from', host.sidebar, '--slots-from', host.slots]
}

/** 生成"等价宿主 + 等价 baseline"到临时目录，返回可复用的上下文。 */
function withBaseline(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-snapshot-'))
  try {
    const host = buildHost(join(dir, 'canonical'))
    const baselinePath = join(dir, 'baseline.json')
    const written = runTool(['--write', '--baseline', baselinePath, ...dirs(host)])
    assert.equal(written.status, 0, `--write 必须成功：${written.stderr}`)
    return fn({ dir, host, baselinePath, written })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('--write 记录 hostVersion 与主题前缀，--check 对等价宿主退出 0', () => {
  withBaseline(({ host, baselinePath, written }) => {
    const recorded = JSON.parse(readFileSync(baselinePath, 'utf8'))
    assert.match(recorded.hostVersion, /^\d+\.\d+\.\d+/)
    assert.equal(recorded.hostVersion, recorded.host.layoutVersion, 'hostVersion 与宿主包版本一致')
    assert.match(String(recorded.themePrefix), /^--[a-z]+-$/)
    assert.match(written.stdout, /hostVersion/, '--write 输出要带上 hostVersion')

    const checked = runTool(['--check', '--baseline', baselinePath, ...dirs(host)])
    assert.equal(checked.status, 0, `等价宿主必须通过：${checked.stderr}`)
    assert.match(checked.stdout, /一致/)
  })
})

test('五类变异 fixture 各自退出非 0 并打印对应 blocker', () => {
  withBaseline(({ dir, baselinePath }) => {
    const cases = [
      ['删子槽', (host) => { host.slots = host.slots.filter((slot) => slot.name !== 'rightbar') }, /slot:removed rightbar/],
      ['改 kind', (host) => { host.slots.find((slot) => slot.name === 'main').kind = 'single' }, /slot:kind-changed main/],
      [
        '缺 ILayout 成员',
        (host) => { host.signatures = host.signatures.filter((line) => !line.startsWith('toggleSidebar')) },
        /service:missing layout: toggleSidebar/,
      ],
      ['改主题前缀', (host) => { host.themePrefix = '--dsw-' }, /theme-prefix-changed/],
    ]
    for (const [label, mutate, expected] of cases) {
      const mutated = buildHost(join(dir, `fixture-${Buffer.from(label).toString('hex')}`), mutate)
      const result = runTool(['--check', '--baseline', baselinePath, ...dirs(mutated)])
      assert.notEqual(result.status, 0, `${label} 必须非 0`)
      assert.match(result.stderr, expected, `${label} 要打印对应 blocker，实际：${result.stderr}`)
      assert.match(result.stderr, /blocker/, `${label} 的差异要标注为 blocker`)
    }

    // 第五类：基线缺失本身按"不匹配"处理，退出非 0。
    const missing = runTool(['--check', '--baseline', join(dir, 'no-such-baseline.json'), ...dirs(buildHost(join(dir, 'healthy')))])
    assert.notEqual(missing.status, 0, '基线缺失必须非 0')
    assert.match(missing.stderr, /没有 baseline/)
  })
})
