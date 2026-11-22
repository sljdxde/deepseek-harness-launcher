#!/usr/bin/env node
/**
 * 无头冒烟 canary（票 36 / 规格 S3 的「一条 canary」）。
 *
 * 目的：用**一条可重复运行的脚本**覆盖「接管 / 不接管」两条端到端路径，CI 里对每个 rc 版本各跑一次：
 *   - baseline（正常基线）：喂一个与契约基线同形的假宿主 + 目标宿主版本 → 期望 **v17 外壳渲染且无横幅**；
 *   - mutated（变异基线）：喂一个形状/版本漂移的宿主 → 期望 **HostGuard 横幅出现且原生 UI 保留**（不接管）。
 *
 * 为什么用离线桩：真宿主要 npm 装整套运行时 + 起 web + puppeteer，CI 上又慢又脆。这里直接驱动
 * 真实的 `lib/guard.js` + `lib/bootstrap.js`（取不接管/接管的**真实判定**），外壳 vnode 由真实的
 * `lib/shell-render.js` 渲染，断言只看外部可观察结果（外壳在不在、横幅在不在、原生在不在），
 * 不测内部调用次数。真宿主链路仍由 `scripts/verify-shell-standalone.sh` 覆盖。
 *
 * 用法：
 *   node scripts/canary.mjs [--mode baseline|mutated|both] [--host-version x.y.z]
 *                           [--mutate version|slot] [--baseline <path>] [--json]
 *   node scripts/canary.mjs --real   # 用 DSH_BIN 起真机跑一次（无 DSH_BIN → exit 3）
 *
 * 退出码（两种主要结果 + 两个环境码）：
 *   0  所有断言通过（baseline 外壳无横幅；mutated 横幅 + 原生）
 *   1  断言失败（某条路径行为与期望不符）
 *   2  参数错误
 *   3  环境缺件（baseline 文件缺失/不可读，跑不了就明确报错，不假装成功）
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBootstrap } from '../lib/bootstrap.js'
import { guardHost } from '../lib/guard.js'
import { renderRail, renderStatusbar } from '../lib/shell-render.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASELINE = join(ROOT, 'contracts', 'host-baseline.json')

/** 变异基线用的越界版本（远超 `>=0.2.2-rc.4 <0.3.0`，必然触发 version-out-of-range）。 */
export const MUTATED_HOST_VERSION = '99.0.0'
const MODES = new Set(['baseline', 'mutated', 'both'])
const MUTATIONS = new Set(['version', 'slot'])

/**
 * 解析命令行参数。
 * @param {string[]} argv - process.argv.slice(2)。
 * @returns {{ mode: 'baseline'|'mutated'|'both', hostVersion?: string, mutate: 'version'|'slot', baselinePath?: string, json: boolean, help: boolean }}
 * @throws {Error} 参数非法时抛出（由 main 映射成退出码 2）。
 */
export function parseArgs(argv) {
  const out = { mode: 'both', hostVersion: undefined, mutate: 'version', baselinePath: undefined, json: false, help: false, real: false }
  const take = (index, flag) => {
    const value = argv[index]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数 ${flag} 缺少取值`)
    return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--mode') {
      const value = take(index += 1, '--mode')
      if (!MODES.has(value)) throw new Error(`--mode 只能是 baseline|mutated|both，收到 ${value}`)
      out.mode = value
    } else if (arg === '--host-version') {
      out.hostVersion = take(index += 1, '--host-version')
    } else if (arg === '--mutate') {
      const value = take(index += 1, '--mutate')
      if (!MUTATIONS.has(value)) throw new Error(`--mutate 只能是 version|slot，收到 ${value}`)
      out.mutate = value
    } else if (arg === '--baseline') {
      out.baselinePath = take(index += 1, '--baseline')
    } else if (arg === '--real') {
      out.real = true
    } else if (arg === '--json') {
      out.json = true
    } else if (arg === '-h' || arg === '--help') {
      out.help = true
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  return out
}

/**
 * 读契约基线。
 * @param {string} [path] - baseline 路径，默认包内 contracts/host-baseline.json。
 * @returns {object} baseline 对象。
 */
export function loadBaseline(path = DEFAULT_BASELINE) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * 由契约基线造一个「假宿主形状」，供 guardHost 判定。
 *
 * baseline：形状与基线一致，宿主版本用 `hostVersion`（默认基线版本；CI 传目标 rc 以模拟新 rc 宿主）。
 * mutated：模拟宿主漂移——默认把版本改成越界值（version-out-of-range），
 *          或 `mutate='slot'` 时删掉一条子槽（slot-missing）。
 * @param {'baseline'|'mutated'} mode - 两种路径。
 * @param {object} baseline - 契约基线。
 * @param {{ hostVersion?: string, mutate?: 'version'|'slot' }} [options] - 覆盖项。
 * @returns {object} guardHost 的入参形状。
 */
export function hostShapeFor(mode, baseline, { hostVersion, mutate = 'version' } = {}) {
  const shape = {
    hostVersion: hostVersion ?? baseline.hostVersion,
    baseline,
    slots: (baseline.slots ?? []).map((slot) => ({ ...slot })),
    renderSlots: [...(baseline.rootRenderSlots ?? [])],
    layoutMembers: [...(baseline.services?.layout?.members ?? baseline.layoutService?.face ?? [])],
    themePrefix: baseline.themePrefix,
  }
  if (mode === 'mutated') {
    if (mutate === 'slot') {
      shape.slots = shape.slots.filter((slot) => slot.name !== 'rightbar')
    } else {
      shape.hostVersion = MUTATED_HOST_VERSION
    }
  }
  return shape
}

/** 递归查找 vnode 树里是否有满足 predicate 的节点。 */
export function hasVNode(node, predicate) {
  if (node === null || node === undefined) return false
  if (Array.isArray(node)) return node.some((child) => hasVNode(child, predicate))
  if (typeof node !== 'object') return false
  if (predicate(node)) return true
  return hasVNode(node.children, predicate)
}

/** 极简 createElement：结构里有 type/props/children，供 shell-render 渲染出可断言的 vnode。 */
const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() })

/**
 * 假宿主：register = 渲染 v17 外壳（真实 shell-render 产物），mountBanner = 出横幅并保留原生 UI。
 * 只记录「外部可观察」的三件事：外壳 vnode、横幅模型、原生是否可见。
 * @returns {{ register: Function, mountBanner: Function, snapshot: Function }} 假宿主接口。
 */
export function createStubHost() {
  const state = { registered: 0, shell: null, banner: null, native: false, nativeVNode: null }
  return {
    register() {
      state.registered += 1
      state.shell = h('div', { 'data-shell': 'launcher', 'data-build': 'canary' },
        renderRail(h, { entries: [] }),
        renderStatusbar(h, { page: '会话' }))
      state.banner = null
      state.native = false
      state.nativeVNode = null
    },
    mountBanner(model) {
      state.banner = model
      state.native = true
      // 不注册 root 时宿主原生壳仍在——用原生根槽节点代表「原生 UI 可见」。
      state.nativeVNode = h('div', { 'data-native-ui': 'host', 'data-slot': 'root' })
    },
    snapshot() {
      return {
        registered: state.registered,
        shell: state.shell,
        banner: state.banner,
        native: state.native,
        nativeVNode: state.nativeVNode,
      }
    },
  }
}

/**
 * 按 mode 判定断言结果（纯函数，单测直接测）。只认外部可观察结构。
 * @param {'baseline'|'mutated'} mode - 期望路径。
 * @param {object} snapshot - createStubHost().snapshot() 的结果。
 * @returns {{ ok: boolean, verdict: string, reasons: string[] }} 判定。
 */
export function evaluate(mode, snapshot) {
  const shellPresent = hasVNode(snapshot?.shell, (node) => node?.props?.['data-shell'] === 'launcher')
  const railPresent = hasVNode(snapshot?.shell, (node) => node?.props?.className === 'launcher-rail')
  const statusPresent = hasVNode(snapshot?.shell, (node) => node?.props?.className === 'launcher-statusbar')
  const bannerPresent = snapshot?.banner !== null && snapshot?.banner !== undefined
  const nativePresent = snapshot?.native === true
    && hasVNode(snapshot?.nativeVNode, (node) => node?.props?.['data-native-ui'] === 'host')
  const reasons = []
  if (mode === 'baseline') {
    if (!shellPresent) reasons.push('v17 外壳未渲染（缺 [data-shell="launcher"]）')
    if (!railPresent) reasons.push('v17 外壳不完整（缺 rail）')
    if (!statusPresent) reasons.push('v17 外壳不完整（缺 statusbar）')
    if (bannerPresent) reasons.push('正常基线出现了 HostGuard 横幅（不应出现）')
    if (nativePresent) reasons.push('正常基线回落到了原生 UI（不应回落）')
    return { ok: reasons.length === 0, verdict: reasons.length === 0 ? 'baseline-ok' : 'baseline-broken', reasons }
  }
  if (!bannerPresent) reasons.push('变异基线没有出现 HostGuard 横幅')
  if (!nativePresent) reasons.push('变异基线没有保留原生 UI')
  if (shellPresent) reasons.push('变异基线仍然接管了外壳（不应接管）')
  return { ok: reasons.length === 0, verdict: reasons.length === 0 ? 'mutated-ok' : 'mutated-broken', reasons }
}

/**
 * 跑一条 canary 路径：造形状 → 走真实 bootstrap → 断言。
 * @param {{ mode: 'baseline'|'mutated', baseline: object, hostVersion?: string, mutate?: 'version'|'slot' }} input - 输入。
 * @returns {object} 结果（含 guard 摘要、snapshot、判定）。
 */
export function runCanary({ mode, baseline, hostVersion, mutate = 'version' }) {
  // mutated 用漂移形状，不接受外部 hostVersion（否则可能被"修好"）。
  const shape = hostShapeFor(mode, baseline, { hostVersion: mode === 'mutated' ? undefined : hostVersion, mutate })
  const guard = guardHost(shape)
  const host = createStubHost()
  const boot = createBootstrap({ register: host.register, mountBanner: host.mountBanner })
  const outcome = boot.run(shape)
  const snapshot = host.snapshot()
  const verdict = evaluate(mode, snapshot)
  return {
    mode,
    hostVersion: shape.hostVersion,
    guard: { ok: guard.ok, blockers: guard.blockers.map((item) => item.code) },
    registered: outcome.registered,
    snapshot,
    ...verdict,
  }
}

/**
 * 真机 canary（A3）：从 DSH_BIN 起一个**独立**的 dsh web，断言 root 渲染成 v17 外壳。
 *
 * 不假装成功：没有 DSH_BIN / 二进制不存在 / 缺 DSH_INSTALL(lib/bin.js) 或 profile /
 * 缺 Chrome·puppeteer 等环境件，一律 exit 3 并说明跳过；只有真机断言失败才 exit 1。
 * 复用 scripts/verify-shell-standalone.sh（临时 DSH_HOME，不碰正在用的 dsh）。
 * @param {{ stdout?: Function, stderr?: Function, env?: object }} [io] - 输出与进程环境（可注入）。
 * @returns {number} 退出码。
 */
export function runReal(io = {}) {
  const stdout = io.stdout ?? ((line) => process.stdout.write(line))
  const stderr = io.stderr ?? ((line) => process.stderr.write(line))
  const env = io.env ?? process.env
  const dshBin = String(env.DSH_BIN ?? '').trim()
  if (dshBin.length === 0) {
    stderr('[canary --real] 跳过（exit 3）：未设置 DSH_BIN —— 真机 canary 需要 dsh 可执行文件\n')
    return 3
  }
  if (!existsSync(dshBin)) {
    stderr(`[canary --real] 跳过（exit 3）：DSH_BIN 不存在：${dshBin}\n`)
    return 3
  }
  const dshHome = env.DSH_HOME ?? join(homedir(), '.dsh')
  const installCandidates = [
    env.DSH_INSTALL,
    join(dirname(dshBin), '..', '..', '@deepseek-ai', 'dsh'),
    join(dshHome, 'runtime', 'node_modules', '@deepseek-ai', 'dsh'),
  ].filter((value) => typeof value === 'string' && value.length > 0)
  const install = installCandidates.find((dir) => existsSync(join(dir, 'lib', 'bin.js')))
  const profile = env.PROFILE_SRC ?? join(dshHome, 'profiles', 'web')
  if (install === undefined) {
    stderr('[canary --real] 跳过（exit 3）：定位不到 dsh 安装目录（需含 lib/bin.js，可用 DSH_INSTALL 指定）\n')
    return 3
  }
  if (!existsSync(join(profile, 'package.json'))) {
    stderr(`[canary --real] 跳过（exit 3）：找不到可用 profile：${profile}\n`)
    return 3
  }
  const script = join(ROOT, 'scripts', 'verify-shell-standalone.sh')
  if (!existsSync(script)) {
    stderr(`[canary --real] 跳过（exit 3）：缺少 ${script}\n`)
    return 3
  }
  const child = spawnSync('sh', [script, 'launcher'], {
    cwd: ROOT,
    env: { ...env, DSH_INSTALL: install, PROFILE_SRC: profile, PACKAGE_DIR: ROOT },
    encoding: 'utf8',
  })
  if (child.stdout) stdout(child.stdout)
  if (child.stderr) stderr(child.stderr)
  if (child.status === 0) {
    stdout('[canary --real] PASS：真机 root 渲染为 v17 外壳（无 HostGuard 横幅）\n')
    return 0
  }
  if (child.status === 3) {
    stderr('[canary --real] 跳过（exit 3）：环境缺件（Chrome / puppeteer / 宿主未就绪）\n')
    return 3
  }
  stderr('[canary --real] FAIL：真机断言不通过\n')
  return 1
}

const USAGE = `用法：node scripts/canary.mjs [--mode baseline|mutated|both] [--host-version x.y.z]
                          [--mutate version|slot] [--baseline <path>] [--json]
       node scripts/canary.mjs --real   # 真机（需 DSH_BIN；无则 exit 3）`

/**
 * CLI 入口：返回退出码而不是直接 process.exit，便于单测。
 * @param {string[]} argv - 参数列表。
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void }} [io] - 输出流（可注入）。
 * @returns {number} 退出码。
 */
export function main(argv, io = {}) {
  const stdout = io.stdout ?? ((line) => process.stdout.write(line))
  const stderr = io.stderr ?? ((line) => process.stderr.write(line))
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    stderr(`${error.message}\n${USAGE}\n`)
    return 2
  }
  if (args.help) {
    stdout(`${USAGE}\n`)
    return 0
  }
  if (args.real) {
    return runReal({ stdout, stderr })
  }
  let baseline
  try {
    baseline = loadBaseline(args.baselinePath)
  } catch (error) {
    stderr(`canary 跑不了：读不到契约基线（${args.baselinePath ?? DEFAULT_BASELINE}）：${error.message}\n`)
    return 3
  }
  const modes = args.mode === 'both' ? ['baseline', 'mutated'] : [args.mode]
  const results = []
  for (const mode of modes) {
    let result
    try {
      result = runCanary({ mode, baseline, hostVersion: args.hostVersion, mutate: args.mutate })
    } catch (error) {
      stderr(`canary 运行失败（mode=${mode}）：${error?.stack ?? error}\n`)
      return 3
    }
    results.push(result)
    if (!args.json) {
      stdout(`[canary] mode=${result.mode} host=${result.hostVersion} guard.ok=${result.guard.ok} `
        + `registered=${result.registered} blockers=[${result.guard.blockers.join(',')}]\n`)
      stdout(`[canary] verdict=${result.verdict} ${result.ok ? 'PASS' : 'FAIL'}\n`)
      for (const reason of result.reasons) stdout(`[canary]   - ${reason}\n`)
    }
  }
  if (args.json) {
    stdout(`${JSON.stringify(args.mode === 'both' ? results : results[0], null, 2)}\n`)
  }
  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    if (!args.json) stderr(`[canary] ${failed.length} 条路径未达预期：${failed.map((result) => result.mode).join(', ')}\n`)
    return 1
  }
  if (!args.json) stdout(`[canary] 全部通过（${results.map((result) => result.mode).join(' + ')}）\n`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
