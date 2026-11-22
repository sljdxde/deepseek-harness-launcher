/**
 * HostGuard（票 29，护栏一）：注册 root 之前先自检宿主形状。
 *
 * 判据全部来自**契约基线**（`contracts/host-baseline.json`），任何关键项不符就不接管，
 * 保留原生界面并让 Bootstrap 出横幅——单槽重复注册只按优先级遮蔽、root 无注册会白屏，
 * 宿主没有原生兜底，所以必须"先检查、再注册"。
 *
 * 纯函数：不读磁盘、不碰 DOM、不抛错；输入输出都是纯数据，host 半区与 client 半区可共用。
 *
 * 判定表：
 *   blocker（不接管）：版本读不到/出区间、基线不可读、子槽缺失或 kind/scope 变化、
 *                     renderSlots 缺项、ILayout 六成员缺一
 *   warning（仍接管）：主题变量前缀改名（配色退化为 fallback）、宿主新增子槽/新增 ILayout 成员
 *
 * 读不到的项（themePrefix / renderSlots / layoutMembers 为 undefined）按"未知"跳过，不误判成 blocker；
 * 唯独 slots 读不到不能盲注册（拿不到形状就不知道注册上去会不会遮蔽）。
 */
import { SUPPORTED_HOST_RANGE } from './contract.js'

/**
 * 版本是否落在 `>=x.y.z <a.b.c` 这类简单区间里（支持 prerelease）。
 *
 * 自包含（解析/比较都写在函数内）：这个函数会被 tools/sync-contract.mjs 用 `toString()`
 * 原样生成进浏览器半区，不能依赖模块作用域里的其它函数或常量（除默认参数里的区间）。
 * @param {string} version - 被检查的版本（可带 v 前缀）。
 * @param {string} [rangeText] - 区间文本，默认 SUPPORTED_HOST_RANGE。
 * @returns {boolean} 落在区间内为 true；解析失败为 false（安全侧）。
 */
export function satisfiesRange(version, rangeText = SUPPORTED_HOST_RANGE) {
  const parseVersion = (value) => {
    const text = String(value ?? '').trim().replace(/^v/, '')
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text)
    if (match === null) return null
    return {
      numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] === undefined ? [] : match[4].split('.'),
    }
  }
  const compareVersions = (left, right) => {
    const a = parseVersion(left)
    const b = parseVersion(right)
    if (a === null || b === null) return null
    for (let index = 0; index < 3; index += 1) {
      if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
    }
    const aPre = a.prerelease
    const bPre = b.prerelease
    if (aPre.length === 0 && bPre.length === 0) return 0
    if (aPre.length === 0) return 1
    if (bPre.length === 0) return -1
    for (let index = 0; index < Math.max(aPre.length, bPre.length); index += 1) {
      const one = aPre[index]
      const two = bPre[index]
      if (one === undefined) return -1
      if (two === undefined) return 1
      if (one === two) continue
      const oneNumeric = /^\d+$/.test(one)
      const twoNumeric = /^\d+$/.test(two)
      if (oneNumeric && twoNumeric) return Number(one) < Number(two) ? -1 : 1
      if (oneNumeric !== twoNumeric) return oneNumeric ? -1 : 1
      return one < two ? -1 : 1
    }
    return 0
  }
  const text = String(rangeText ?? '').trim()
  const comparators = [...text.matchAll(/(>=|<=|>|<|=)?\s*([0-9]+(?:\.[0-9]+){2}(?:-[0-9A-Za-z.-]+)?)/g)]
    .map((match) => ({ operator: match[1] ?? '=', target: match[2] }))
  if (comparators.length === 0) return false
  for (const { operator, target } of comparators) {
    const delta = compareVersions(version, target)
    if (delta === null) return false
    if (operator === '>=' && delta < 0) return false
    if (operator === '<=' && delta > 0) return false
    if (operator === '>' && delta <= 0) return false
    if (operator === '<' && delta >= 0) return false
    if (operator === '=' && delta !== 0) return false
  }
  return true
}

/**
 * @param {{
 *   hostVersion?: string,
 *   baseline?: object|null,
 *   slots?: Array<{name:string, kind?:string|null, scope?:string|null}>,
 *   renderSlots?: string[],
 *   layoutMembers?: string[],
 *   themePrefix?: string,
 *   range?: string,
 * }} [input] - 宿主形状 + 基线。
 * @returns {{ ok: boolean, blockers: Array<{code:string,message:string,name?:string}>, warnings: Array<{code:string,message:string,name?:string}> }}
 */
export function guardHost(input = {}) {
  const range = input.range ?? SUPPORTED_HOST_RANGE
  const blockers = []
  const warnings = []
  const block = (code, message, name) => {
    const item = { code, message }
    if (name !== undefined) item.name = name
    blockers.push(item)
  }
  const warn = (code, message, name) => {
    const item = { code, message }
    if (name !== undefined) item.name = name
    warnings.push(item)
  }

  // 1) 版本：读不到 / 出区间都算 blocker。
  const version = typeof input.hostVersion === 'string' ? input.hostVersion.trim() : ''
  if (version.length === 0) block('version-unreadable', '宿主版本读不到，无法确认兼容')
  else if (!satisfiesRange(version, range)) block('version-out-of-range', `宿主版本 ${version} 不在支持区间 ${range}`)

  // 2) 基线：读不到按"不匹配"处理（安全侧），不再往下比结构。
  const baseline = input.baseline
  const baselineOk = baseline !== null && typeof baseline === 'object'
    && typeof baseline.hostVersion === 'string' && baseline.hostVersion.length > 0
    && Array.isArray(baseline.slots)
  if (!baselineOk) {
    block('baseline-unreadable', '契约基线不可读，按不匹配处理')
    return { ok: blockers.length === 0, blockers, warnings }
  }

  // 3) 六条子槽：缺失 / kind 变化 / scope 变化都是 blocker；新增子槽只告警。
  if (!Array.isArray(input.slots)) {
    block('slots-unreadable', '读不到宿主子槽声明，不能盲注册')
  } else {
    const actual = new Map(input.slots.map((slot) => [slot?.name, slot]))
    const expectedNames = new Set()
    for (const expected of baseline.slots) {
      expectedNames.add(expected.name)
      const found = actual.get(expected.name)
      if (found === undefined || found === null) {
        block('slot-missing', `缺少子槽 ${expected.name}（${expected.kind}）`, expected.name)
        continue
      }
      if (found.kind != null && expected.kind != null && found.kind !== expected.kind) {
        block('slot-kind-changed', `子槽 ${expected.name} 由 ${expected.kind} 变 ${found.kind}`, expected.name)
      }
      if (found.scope != null && expected.scope != null && found.scope !== expected.scope) {
        block('slot-scope-changed', `子槽 ${expected.name} scope 由 ${expected.scope} 变 ${found.scope}`, expected.name)
      }
    }
    for (const slot of input.slots) {
      if (slot?.name !== undefined && !expectedNames.has(slot.name)) warn('slot-added', `宿主新增子槽 ${slot.name}`, slot.name)
    }
  }

  // 4) root.renderSlots：宿主报了的名字集合里缺项 = blocker；没报（undefined）= 跳过。
  if (Array.isArray(input.renderSlots)) {
    const have = new Set(input.renderSlots)
    for (const name of (Array.isArray(baseline.rootRenderSlots) ? baseline.rootRenderSlots : [])) {
      if (!have.has(name)) block('render-slot-missing', `root.renderSlots 缺 ${name}`, name)
    }
  }

  // 5) ILayout 六成员：缺项 = blocker；新增成员只告警。基线两种形状都认。
  const expectedMembers = Array.isArray(baseline.layoutMembers)
    ? baseline.layoutMembers
    : (baseline.services?.layout?.members ?? baseline.layoutService?.face ?? null)
  if (Array.isArray(input.layoutMembers) && Array.isArray(expectedMembers)) {
    const have = new Set(input.layoutMembers)
    for (const name of expectedMembers) {
      if (!have.has(name)) block('layout-member-missing', `ILayout 缺成员 ${name}`, name)
    }
    for (const name of input.layoutMembers) {
      if (!expectedMembers.includes(name)) warn('layout-member-added', `ILayout 新增成员 ${name}`, name)
    }
  }

  // 6) 主题前缀改名：只是配色退化，仍接管（warning）。
  const expectedPrefix = typeof baseline.themePrefix === 'string' ? baseline.themePrefix : ''
  const actualPrefix = typeof input.themePrefix === 'string' ? input.themePrefix : ''
  if (expectedPrefix.length > 0 && actualPrefix.length > 0 && expectedPrefix !== actualPrefix) {
    warn('theme-prefix-changed', `主题变量前缀由 ${expectedPrefix} 变 ${actualPrefix}，配色走 fallback`)
  }

  return { ok: blockers.length === 0, blockers, warnings }
}
