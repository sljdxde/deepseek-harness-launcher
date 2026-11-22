// #region module-id
// 本段由 tools/sync-contract.mjs 从 package.json 的 name 生成，勿手改。
const MODULE_ID = "@deepseek-ai/dsh-client-ui-layout"
// #endregion module-id

window.__ModuleLoader__.load({ id: MODULE_ID, factory: (require) => {
  const React = require('react')
  const h = React.createElement
  // 由 tools/sync-contract.mjs 按 package.json 版本 + git 短 sha 生成（页面 data-build 用它）
  const BUILD_STAMP = "0.2.2-rc.4+ffc8c93"
  let CURRENT_CTX = null
  // 票 29：Bootstrap 只生效一次（重复加载不注册两次、不叠第二条横幅）；卸载时复位。
  let HOST_GUARD_DONE = false

  // #region children-from-contract
  // 本段由 tools/sync-contract.mjs 从 lib/contract.js 生成，勿手改；
  // 漂移由 test/contract.test.mjs 的同步检查挡住。
  const CHILDREN = {
    "sidebar": { kind: "single", scope: 'root' },
    "main": { kind: "keyed", scope: 'root' },
    "rightbar": { kind: "single", scope: 'root' },
    "shell.bottom": { kind: "single", scope: 'root' },
    "shell.overlay": { kind: "list", scope: 'root' },
    "shell.leading": { kind: "single", scope: 'root' },
  }
  const LAYOUT_FACE_MEMBERS = ["panelInfo","selectPanel","beginNavigation","toggleSidebar","openRightbar","closeRightbar"]
  const RAIL_ENTRIES = [{"id":"conversation","label":"会话","icon":"message-circle"},{"id":"plugins","label":"插件","icon":"puzzle"},{"id":"schedules","label":"计划任务","icon":"calendar"},{"id":"approvals","label":"待审批","icon":"shield-check"},{"id":"settings","label":"设置","icon":"settings"}]
  const MODE_LABELS = {"readonly":"只读","ask":"每次询问","auto-safe":"自动批准安全命令","full":"全自动"}
  const statusText = function statusText({ page, mode, running = 0, queued = 0 } = {}) {
  const runs = Math.max(0, Math.round(Number(running) || 0))
  const waiting = Math.max(0, Math.round(Number(queued) || 0))
  const parts = []
  if (runs > 0) parts.push(`${runs} 个任务在跑`)
  if (waiting > 0) parts.push(`排队 ${waiting}`)
  return {
    page: typeof page === 'string' && page.length > 0 ? page : '会话',
    mode: MODE_LABELS[mode] ?? MODE_LABELS['auto-safe'],
    running: parts.join(' · '),
  }
}
  const SUPPORTED_HOST_RANGE = ">=0.2.2-rc.4 <0.3.0"
  const PACKAGE_NAME = "@deepseek-ai/dsh-client-ui-layout"
  const ROLLBACK_NOTE = "数据目录 ~/.dsh/state/ 不动：审批策略与审计记录都保留，回退只摘 UI 依赖。"
  const ROLLBACK_STEPS = ["移除 profile 里的本版 UI 依赖（remove）","重新安装原生界面依赖（install）","重启 dsh 并硬刷新页面（restart）"]
  const RUNBOOK_PATH = "docs/ui-rebuild/runbook-回退.md"
  const HOST_BASELINE = {"hostVersion":"0.2.2-rc.4","themePrefix":"--dsh-","slots":[{"name":"sidebar","kind":"single","scope":"root"},{"name":"main","kind":"keyed","scope":"root"},{"name":"rightbar","kind":"single","scope":"root"},{"name":"shell.bottom","kind":"single","scope":"root"},{"name":"shell.overlay","kind":"list","scope":"root"},{"name":"shell.leading","kind":"single","scope":"root"}],"rootRenderSlots":["sidebar","main","rightbar","shell.bottom","shell.overlay","shell.leading"],"layoutMembers":["panelInfo","selectPanel","beginNavigation","toggleSidebar","openRightbar","closeRightbar"]}
  const satisfiesRange = function satisfiesRange(version, rangeText = SUPPORTED_HOST_RANGE) {
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
  const guardHost = function guardHost(input = {}) {
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
  const rollbackCommand = function rollbackCommand(profile = 'web') {
  const name = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : 'web'
  return [
    `dsh plugin --profile ${name} remove ${PACKAGE_NAME}`,
    `dsh plugin --profile ${name} install`,
    '# 之后重启 dsh（退出 dsh web 后重新打开，并硬刷新页面）',
  ].join('\n')
}
  const rollbackSurface = function rollbackSurface({ profile = 'web', copied = false } = {}) {
  const didCopy = copied === true
  return {
    id: 'revert-native',
    title: '回退原生 UI',
    note: ROLLBACK_NOTE,
    steps: [...ROLLBACK_STEPS],
    command: rollbackCommand(profile),
    copyLabel: didCopy ? '已复制' : '复制命令',
    copied: didCopy,
    runbook: RUNBOOK_PATH,
  }
}
  const BANNER_ID = "launcher-hostguard-banner"
  const bannerModel = function bannerModel(guard, { profile = 'web' } = {}) {
  const blockers = Array.isArray(guard?.blockers) ? guard.blockers : []
  const reasons = blockers.map((item) => {
    if (item !== null && typeof item === 'object' && typeof item.message === 'string' && item.message.length > 0) return item.message
    if (item !== null && typeof item === 'object' && typeof item.code === 'string' && item.code.length > 0) return item.code
    return '未知原因'
  })
  return {
    id: BANNER_ID,
    title: '本版 UI 与当前 dsh 不匹配，已保留原生界面',
    reasons,
    command: rollbackCommand(profile),
    dismissLabel: '本次不再提示',
  }
}
  const createBootstrap = function createBootstrap({ register, mountBanner, profile = 'web', guard = guardHost } = {}) {
  let outcome = null
  function run(shape) {
    if (outcome !== null) return { ...outcome, repeated: true }
    let result
    try {
      result = guard(shape)
    } catch (error) {
      // guard 是纯函数，理论上不抛；兜底成"不接管"而不是把整页打崩。
      result = { ok: false, blockers: [{ code: 'guard-threw', message: String(error?.message ?? error) }], warnings: [] }
    }
    if (result.ok) {
      try {
        if (typeof register === 'function') register()
        outcome = { registered: true, guard: result, banner: null, repeated: false }
      } catch (error) {
        outcome = { registered: false, guard: result, banner: null, error, repeated: false }
      }
    } else {
      let banner = null
      try {
        banner = bannerModel(result, { profile })
        if (typeof mountBanner === 'function') mountBanner(banner)
      } catch {
        banner = null
      }
      outcome = { registered: false, guard: result, banner, repeated: false }
    }
    return { ...outcome }
  }
  return {
    run,
    get outcome() { return outcome },
  }
}
  const resolveHostVersion = function resolveHostVersion(raw) {
  return typeof raw === 'string' ? raw.trim() : ''
}
  const resolveSlots = function resolveSlots(rawSlots, { baselineSlots = [], allowLegacy = false } = {}) {
  if (Array.isArray(rawSlots)) return rawSlots
  if (allowLegacy === true && Array.isArray(baselineSlots)) return baselineSlots.map((slot) => ({ ...slot }))
  return undefined
}
  const probeLayoutMembers = function probeLayoutMembers(layoutService, expectedMembers = []) {
  if (layoutService === null || layoutService === undefined) return undefined
  const type = typeof layoutService
  if (type !== 'object' && type !== 'function') return undefined
  return expectedMembers.filter((name) => {
    try {
      return name in layoutService
    } catch {
      return false
    }
  })
}
  // #endregion children-from-contract

  // #region shell-from-lib
  // 本段由 tools/sync-contract.mjs 从 lib/{tokens,icons,shell-layout,shell-render}.js 生成，勿手改；
  // 漂移由 test/contract.test.mjs 的同步检查挡住。
  const SHELL_METRICS = {"rail":56,"sidebar":280,"status":26,"row":32,"radiusXs":6,"radiusSm":8,"radius":10,"radiusMd":12,"iconStroke":1.7}
  const SHELL_ICONS = {"conversation":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M8 9h8\"  /> <path d=\"M8 13h6\"  /> <path d=\"M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z\"  />","plugins":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1\"  />","schedules":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z\"  /> <path d=\"M16 3v4\"  /> <path d=\"M8 3v4\"  /> <path d=\"M4 11h16\"  /> <path d=\"M11 15h1\"  /> <path d=\"M12 15v3\"  />","approvals":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3\"  />","settings":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z\"  /> <path d=\"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\"  />","sun":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0\"  /> <path d=\"M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7\"  />","moon":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z\"  />","command":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M7 9a2 2 0 1 1 2 -2v10a2 2 0 1 1 -2 -2h10a2 2 0 1 1 -2 2v-10a2 2 0 1 1 2 2h-10\"  />","panel":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M4 6l5.5 0\"  /> <path d=\"M4 10l5.5 0\"  /> <path d=\"M4 14l5.5 0\"  /> <path d=\"M4 18l5.5 0\"  /> <path d=\"M14.5 6l5.5 0\"  /> <path d=\"M14.5 10l5.5 0\"  /> <path d=\"M14.5 14l5.5 0\"  /> <path d=\"M14.5 18l5.5 0\"  />","sidebar":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z\"  /> <path d=\"M9 4v16\"  /> <path d=\"M15 10l-2 2l2 2\"  />","help":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\"  /> <path d=\"M12 17l0 .01\"  /> <path d=\"M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4\"  />"}
  const DSH_LOGO = {"viewBox":"0 0 23.16 17.04","body":"M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z"}
  const DRAWER_BREAKPOINT = 860
  const TOKENS_CSS = ".launcher-shell{--l-bg:#f4f1e9;--l-bg2:#eeeae0;--l-panel:#faf8f3;--l-surface:#fffdf8;--l-surface2:#f1ede3;--l-surface3:#e6e1d3;--l-line:rgba(27,28,25,.10);--l-line2:rgba(27,28,25,.18);--l-ink:#1b1c19;--l-ink2:#4c4d46;--l-ink3:#615f56;--l-ink4:#67645a;--l-accent:#3a55c8;--l-accentSoft:rgba(58,85,200,.10);--l-onAccent:#ffffff;--l-hover:rgba(27,28,25,.055);--l-hover2:rgba(27,28,25,.09);--l-tip:#2c2c2e;--l-tipInk:#ffffff;--l-amber:#7a4d12;--l-green:#2c7458;--l-greenSoft:#dcebe3;--l-red:#ab3f36;--l-rail:56px;--l-sidebar:280px;--l-status:26px;--l-row:32px;--l-radius-xs:6px;--l-radius-sm:8px;--l-radius:10px;--l-radius-md:12px;--l-icon-stroke:1.7}\n.launcher-shell[data-theme=\"light\"]{--l-bg:#f4f1e9;--l-bg2:#eeeae0;--l-panel:#faf8f3;--l-surface:#fffdf8;--l-surface2:#f1ede3;--l-surface3:#e6e1d3;--l-line:rgba(27,28,25,.10);--l-line2:rgba(27,28,25,.18);--l-ink:#1b1c19;--l-ink2:#4c4d46;--l-ink3:#615f56;--l-ink4:#67645a;--l-accent:#3a55c8;--l-accentSoft:rgba(58,85,200,.10);--l-onAccent:#ffffff;--l-hover:rgba(27,28,25,.055);--l-hover2:rgba(27,28,25,.09);--l-tip:#2c2c2e;--l-tipInk:#ffffff;--l-amber:#7a4d12;--l-green:#2c7458;--l-greenSoft:#dcebe3;--l-red:#ab3f36;--l-rail:56px;--l-sidebar:280px;--l-status:26px;--l-row:32px;--l-radius-xs:6px;--l-radius-sm:8px;--l-radius:10px;--l-radius-md:12px;--l-icon-stroke:1.7}\n.launcher-shell[data-theme=\"dark\"]{--l-bg:#121316;--l-bg2:#15171a;--l-panel:#17191e;--l-surface:#1b1d21;--l-surface2:#22252a;--l-surface3:#2b2e34;--l-line:rgba(255,255,255,.08);--l-line2:rgba(255,255,255,.15);--l-ink:#edebe3;--l-ink2:#b8b6ac;--l-ink3:#a5a399;--l-ink4:#9a978c;--l-accent:#93a8ff;--l-accentSoft:rgba(147,168,255,.13);--l-onAccent:#101216;--l-hover:rgba(255,255,255,.06);--l-hover2:rgba(255,255,255,.10);--l-tip:#33363c;--l-tipInk:#f4f2ec;--l-amber:#f0bd85;--l-green:#5ec9a6;--l-greenSoft:#1e3a31;--l-red:#f18c81;--l-rail:56px;--l-sidebar:280px;--l-status:26px;--l-row:32px;--l-radius-xs:6px;--l-radius-sm:8px;--l-radius:10px;--l-radius-md:12px;--l-icon-stroke:1.7}"
  const SKELETON_CSS = ".launcher-shell{background:var(--l-bg);color:var(--l-ink);overflow:hidden}\n.launcher-rail{background:var(--l-bg2);border-right:1px solid var(--l-line);gap:2px;padding:10px 0 8px;align-items:center}\n.launcher-rail__logo{width:30px;height:30px;border-radius:50%;background:var(--l-ink);color:var(--l-bg);display:grid;place-items:center;margin-bottom:8px;border:0;cursor:pointer}\n.launcher-rail__logo svg{width:16px;height:16px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-rail__entry{position:relative;width:38px;height:38px;border-radius:var(--l-radius);color:var(--l-ink3);display:grid;place-items:center;background:transparent;border:0;cursor:pointer}\n.launcher-rail__entry:hover{background:var(--l-hover);color:var(--l-ink)}\n.launcher-rail__entry.on{background:var(--l-surface3);color:var(--l-ink)}\n.launcher-rail__entry.on::before{content:'';position:absolute;left:-9px;top:10px;bottom:10px;width:2px;border-radius:2px;background:var(--l-accent)}\n.launcher-rail__entry svg{width:20px;height:20px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-rail__entry[aria-disabled=\"true\"]{opacity:.4;cursor:not-allowed}\n.launcher-rail__badge{position:absolute;top:4px;right:4px;min-width:15px;height:15px;border-radius:8px;background:var(--l-accent);color:var(--l-onAccent);font-size:11px;line-height:15px;text-align:center;padding:0 3px}\n.launcher-rail__tip{position:absolute;left:calc(100% + 9px);top:50%;transform:translateY(-50%);padding:4px 8px;border-radius:var(--l-radius-xs);background:var(--l-tip);color:var(--l-tipInk);font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;z-index:90}\n.launcher-rail__entry:hover .launcher-rail__tip,.launcher-rail__entry:focus-visible .launcher-rail__tip{opacity:1}\n.launcher-rail__spacer{flex:1}\n.launcher-rail__action{width:38px;height:38px;border-radius:var(--l-radius);color:var(--l-ink3);display:grid;place-items:center;background:transparent;border:0;cursor:pointer}\n.launcher-rail__action:hover{background:var(--l-hover);color:var(--l-ink)}\n.launcher-rail__action svg{width:20px;height:20px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-sidebar{background:var(--l-bg);border-right:1px solid var(--l-line)}\n.launcher-main{background:var(--l-bg)}\n.launcher-dock{background:var(--l-panel);border-left:1px solid var(--l-line)}\n.launcher-statusbar{background:var(--l-bg2);border-top:1px solid var(--l-line);color:var(--l-ink3);height:var(--l-status);gap:12px;padding:0 12px;font-size:11px}\n.launcher-statusbar__page{color:var(--l-ink2)}\n.launcher-shell :focus-visible{outline:2px solid var(--l-accent);outline-offset:2px}"
  const shellColumns = function shellColumns({
  viewportWidth,
  sidebarCollapsed = false,
  dockWidth = 0,
  rail = SHELL_METRICS.rail,
  sidebar = SHELL_METRICS.sidebar,
  drawerBreakpoint = DRAWER_BREAKPOINT,
} = {}) {
  const width = Number(viewportWidth)
  const viewport = Number.isFinite(width) && width > 0 ? Math.round(width) : 1440
  const drawer = viewport <= Number(drawerBreakpoint)
  const side = drawer || sidebarCollapsed === true ? 0 : Math.round(Number(sidebar) || 0)
  const dockRaw = Number(dockWidth)
  const dock = drawer || !Number.isFinite(dockRaw) ? 0 : Math.max(0, Math.round(dockRaw))
  const railWidth = Math.max(0, Math.round(Number(rail) || 0))
  const main = Math.max(0, viewport - railWidth - side - dock)
  return { rail: railWidth, sidebar: side, main, dock, total: railWidth + side + main + dock, drawer }
}
  const shellIcon = function shellIcon(h, name) {
  const body = SHELL_ICONS[name] ?? ''
  return h('svg', { viewBox: '0 0 24 24', className: 'launcher-ic', 'aria-hidden': 'true', focusable: 'false', dangerouslySetInnerHTML: { __html: body } })
}
  const renderRail = function renderRail(h, options) {
  const opts = options ?? {}
  const entries = Array.isArray(opts.entries) ? opts.entries : []
  const theme = opts.theme === 'dark' ? 'dark' : 'light'
  const children = []

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__logo',
    title: 'dsh · 回到会话',
    'aria-label': 'dsh 首页',
    'data-rail-action': 'home',
    onClick: opts.onHome,
  }, h('svg', {
    viewBox: DSH_LOGO.viewBox,
    className: 'launcher-rail__mark',
    'aria-hidden': 'true',
    focusable: 'false',
    dangerouslySetInnerHTML: { __html: DSH_LOGO.body },
  })))

  if (opts.leading !== undefined && opts.leading !== null) children.push(opts.leading)

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__action',
    'data-rail-action': 'dock',
    'aria-label': '开关右栏',
    'aria-pressed': opts.dockOpen === true,
    title: '开关右栏（宽度 320–520）',
    onClick: opts.onToggleDock,
  }, shellIcon(h, 'panel')))

  if (opts.narrow === true) {
    children.push(h('button', {
      type: 'button',
      className: 'launcher-rail__action',
      'data-rail-action': 'drawer',
      'aria-label': '开关侧栏',
      'aria-expanded': opts.drawerOpen === true,
      onClick: opts.onToggleDrawer,
    }, shellIcon(h, 'sidebar')))
  }

  for (const entry of entries) {
    const badge = Number(entry.badge) > 0 ? String(entry.badge) : ''
    const disabled = entry.disabled === true
    const title = entry.title ?? entry.label
    children.push(h('button', {
      type: 'button',
      className: `launcher-rail__entry${entry.active === true ? ' on' : ''}`,
      title,
      'aria-label': entry.label,
      'aria-pressed': entry.active === true,
      'aria-disabled': disabled,
      'data-rail-key': entry.id,
      onClick: disabled ? undefined : entry.onSelect,
    },
    h('span', { className: 'launcher-rail__tip' }, title),
    shellIcon(h, entry.icon),
    badge === '' ? null : h('span', { className: 'launcher-rail__badge' }, badge)))
  }

  children.push(h('div', { className: 'launcher-rail__spacer' }))

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__action',
    'data-rail-action': 'theme',
    'aria-label': theme === 'dark' ? '切换到日间' : '切换到夜间',
    'aria-pressed': theme === 'dark',
    title: theme === 'dark' ? '当前：深色，点击切浅色' : '当前：浅色，点击切深色',
    onClick: opts.onToggleTheme,
  }, shellIcon(h, theme === 'dark' ? 'sun' : 'moon')))

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__action',
    'data-rail-action': 'palette',
    'aria-label': '命令面板',
    title: '命令面板 ⌘K',
    onClick: opts.onOpenPalette,
  }, shellIcon(h, 'command')))

  return h('nav', { className: 'launcher-rail', role: 'navigation', 'aria-label': 'launcher rail' }, ...children)
}
  const renderStatusbar = function renderStatusbar(h, status, options) {
  const s = status ?? {}
  const opts = options ?? {}
  const children = [
    h('span', { className: 'launcher-statusbar__page' }, String(s.page ?? '会话')),
    h('span', { className: 'launcher-statusbar__mode' }, String(s.mode ?? '')),
    h('span', { className: 'launcher-statusbar__running' }, String(s.running ?? '')),
  ]
  if (opts.bottom !== undefined && opts.bottom !== null) children.push(opts.bottom)
  return h('footer', { className: 'launcher-statusbar' }, ...children)
}
  // #endregion shell-from-lib
  // #region main-from-lib
  // 本段由 tools/sync-contract.mjs 从 lib/main-view.js 生成，勿手改；
  // 漂移由 test/contract.test.mjs 的同步检查挡住。
  const MAIN_APPROVAL_CHOICES = {"allow":{"label":"允许一次","tone":"primary","icon":"check"},"always":{"label":"总是允许这类","tone":"","icon":""},"deny":{"label":"拒绝","tone":"ghost danger","icon":"x"}}
  const MAIN_DEMO_COMMANDS = [{"id":"conversation","label":"回到会话","hint":"⌘1"},{"id":"settings","label":"打开设置","hint":"settings · ⌘,"},{"id":"theme","label":"切换日间 / 夜间","hint":"⌘⇧L"},{"id":"dock","label":"开关右栏","hint":"⌘J"}]
  const MAIN_DEMO_THREAD = [{"k":"user","id":"u1","t":"把 dsh 界面整套换掉：以现在这版原型为骨架，把仿工作台那版的密度和组件拿过来。任务卡、汇报卡不能变样。","at":"14:02"},{"k":"bot","id":"b1","fold":{"dur":"6 分 12 秒","files":14,"cmds":5},"tx":["按骨架 + 组件两层拆：外壳与信息架构沿用现有原型，对话流与右栏沿用工作台那版（运行摘要折叠、工具行、任务卡、汇报卡、改动卡、审批卡）。","配色只保留一套基准：日间暖纸 + 夜间近黑，对比度按 WCAG AA 校过一遍。"],"tools":[{"k":"Read","c":"dsh-ui-proto-v2.html","d":"0.2 s"},{"k":"Read","c":"dsh-ui-prototype.html","d":"0.2 s"},{"k":"Bash","c":"ls tasks/*/frozen/*.html","d":"0.4 s"},{"k":"Grep","c":"插件｜扩展管理｜归档","d":"0.1 s"},{"k":"Write","c":"dsh-ui-merged.html","d":"1.1 s"}],"plan":[{"s":"对齐两版的信息架构差异","st":"done"},{"s":"对话流与右栏组件移植","st":"done"},{"s":"日夜两套 + 窄窗校对","st":"doing"},{"s":"接线到 dsh 插件槽位","st":"next"}],"chg":[{"f":"dsh-ui-merged.html","add":218,"del":0},{"f":"notes/fusion.md","add":64,"del":12}]},{"k":"task","id":"t1","who":"任务卡 · dsh-bot","title":"融合版原型（现有 + 工作台）","assignee":"UI-UX 设计师","pct":62,"rows":[{"t":"外壳与导航（图标栏 / 侧栏 / 顶栏）","st":"done"},{"t":"对话流：运行摘要、工具行、任务卡、汇报卡","st":"done"},{"t":"右栏审阅：改动卡 + 提交","st":"doing"},{"t":"窄窗 320 与键盘走查","st":"doing"}],"dyn":"14:31 外壳完成 · 14:38 对话流完成 · 14:52 右栏完成"},{"k":"approval","id":"a1","cwd":"~/Pod","cmd":"npm run build -- --watch","why":"会写 dist/ 并常驻一个进程。批准后同一条命令不再问。"},{"k":"report","id":"r1","status":"READY","title":"融合版能点了","body":"骨架全是现有原型那套，换掉的是密度：对话流有运行摘要折叠、工具行、任务卡、汇报卡、改动卡、审批卡；右栏审阅带 diff 和提交。日 / 夜、320 窄窗、键盘焦点都过了一遍。","links":["dsh-ui-merged.html","图标声明表"],"dyn":"评测：数据是演示数据，写操作只改本地状态。"},{"k":"user","id":"u2","t":"先看夜间的密度够不够，不够就再压一档。","at":"14:56"}]
  const MAIN_ICONS = {"caret":"<path d=\"M9 6l6 6l-6 6\" />","chevronDown":"<path d=\"M6 9l6 6l6 -6\" />","chevronRight":"<path d=\"M9 6l6 6l-6 6\" />","check":"<path d=\"M5 12l5 5l10 -10\" />","x":"<path d=\"M18 6l-12 12\" /><path d=\"M6 6l12 12\" />","alert":"<path d=\"M12 9v4\" /><path d=\"M12 17l.01 0\" /><path d=\"M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18\" />","terminal":"<path d=\"M5 7l5 5l-5 5\" /><path d=\"M12 19l7 0\" />","file":"<path d=\"M14 3v4a1 1 0 0 0 1 1h4\" /><path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\" />","eye":"<path d=\"M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0\" /><path d=\"M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6\" />","target":"<path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" /><path d=\"M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0\" /><path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />","sparkles":"<path d=\"M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z\" />","copy":"<path d=\"M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z\" /><path d=\"M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2\" />","doc":"<path d=\"M14 3v4a1 1 0 0 0 1 1h4\" /><path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\" />","git":"<path d=\"M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0\" /><path d=\"M12 3v6\" /><path d=\"M12 15v6\" />","bot":"<path d=\"M6 6m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z\" /><path d=\"M9 12l.01 0\" /><path d=\"M15 12l.01 0\" />","arrowUp":"<path d=\"M12 5l0 14\" /><path d=\"M16 9l-4 -4l-4 4\" />","search":"<path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\" /><path d=\"M21 21l-6 -6\" />","message":"<path d=\"M8 9h8\" /><path d=\"M8 13h6\" /><path d=\"M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z\" />","plus":"<path d=\"M12 5l0 14\" /><path d=\"M5 12l14 0\" />"}
  const MAIN_CSS = ".launcher-ic{width:14px;height:14px;stroke-width:1.7;fill:none;stroke:currentColor;flex:none}\n.launcher-mainview{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:hidden;background:var(--l-bg);color:var(--l-ink);font-size:13px}\n.launcher-mainview *{box-sizing:border-box}\n.launcher-thread-wrap{flex:1 1 auto;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;padding:14px 0 8px;scrollbar-gutter:stable}\n.launcher-thread{max-width:740px;min-width:0;margin:0 auto;padding:0 20px;display:grid;gap:14px}\n.launcher-turn{display:grid;gap:10px;min-width:0}\n.launcher-msg-user{justify-self:end;max-width:82%;min-width:0;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-md) var(--l-radius-md) 4px var(--l-radius-md);padding:9px 13px;font-size:13px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}\n.launcher-stamp{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4);margin-top:5px;text-align:right}\n.launcher-msg-bot{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;min-width:0}\n.launcher-msg-bot__who{width:22px;height:22px;border-radius:50%;background:var(--l-ink);color:var(--l-bg);display:grid;place-items:center;margin-top:1px}\n.launcher-msg-bot__bd{min-width:0;overflow-wrap:anywhere}\n.launcher-msg-bot__hd{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--l-ink3);margin-bottom:4px}\n.launcher-msg-bot__hd b{color:var(--l-ink2);font-weight:600}\n.launcher-tx{font-size:13px;line-height:1.5;color:var(--l-ink)}\n.launcher-tx p{margin:0}.launcher-tx p+p{margin-top:8px}\n.launcher-msg-acts{display:flex;gap:2px;margin-top:4px;opacity:0;transition:opacity .12s ease}\n.launcher-msg-bot:hover .launcher-msg-acts,.launcher-msg-bot:focus-within .launcher-msg-acts{opacity:1}\n.launcher-icon-btn{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--l-ink3);cursor:pointer}\n.launcher-icon-btn:hover{background:var(--l-hover);color:var(--l-ink)}\n.launcher-fold{display:inline-flex;align-items:center;gap:6px;min-height:24px;font:inherit;font-size:12px;color:var(--l-ink3);padding:3px 7px;border:0;border-radius:var(--l-radius-xs);background:transparent;margin:2px 0 2px -2px;cursor:pointer;text-align:left}\n.launcher-fold:hover{background:var(--l-hover);color:var(--l-ink2)}\n.launcher-fold svg{transition:transform .12s ease}.launcher-fold.open svg{transform:rotate(90deg)}\n.launcher-tools{margin:6px 0 2px;border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);overflow:hidden}\n.launcher-tools__h{display:flex;align-items:center;gap:7px;padding:7px 10px;font:inherit;font-size:12px;color:var(--l-ink2);width:100%;text-align:left;border:0;background:transparent;cursor:pointer}\n.launcher-tools__h:hover{background:var(--l-hover)}\n.launcher-tools__n{color:var(--l-ink4);font-family:var(--font-mono,ui-monospace);font-size:11px}\n.launcher-main-grow{flex:1}\n.launcher-tool-row{display:grid;grid-template-columns:18px 52px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid var(--l-line);font-size:12px;min-width:0}\n.launcher-tool-row__k{color:var(--l-ink3);font-family:var(--font-mono,ui-monospace);font-size:11px}\n.launcher-tool-row__c{font-family:var(--font-mono,ui-monospace);font-size:12px;color:var(--l-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.launcher-tool-row__d{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}\n.launcher-tool-row.bad .launcher-tool-row__c{color:var(--l-red)}\n.launcher-plan{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);padding:11px 12px;margin:8px 0 0}\n.launcher-plan__h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--l-ink2);margin-bottom:8px}\n.launcher-main-kbd{margin-left:auto;font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}\n.launcher-plan-step{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:center;padding:5px 0;font-size:13px}\n.launcher-plan-step__no{width:18px;height:18px;border-radius:50%;border:1px solid var(--l-line2);display:grid;place-items:center;font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink3)}\n.launcher-plan-step.done .launcher-plan-step__no{background:var(--l-greenSoft);border-color:transparent;color:var(--l-green)}\n.launcher-plan-step.doing .launcher-plan-step__no{background:var(--l-accentSoft);border-color:transparent;color:var(--l-accent)}\n.launcher-plan-step__nm{color:var(--l-ink2);min-width:0;overflow-wrap:anywhere}\n.launcher-bcard{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);overflow:hidden;margin:2px 0;min-width:0}\n.launcher-bcard__h{display:flex;align-items:center;gap:7px;padding:8px 12px;border-bottom:1px solid var(--l-line);font-size:12px;color:var(--l-ink3);flex-wrap:wrap;min-width:0}\n.launcher-bcard__who{color:var(--l-ink2);font-weight:600;white-space:nowrap}\n.launcher-bcard__r{margin-left:auto;display:flex;gap:5px;align-items:center}\n.launcher-bcard__b{padding:11px 12px;min-width:0}\n.launcher-card-t{font-size:14px;font-weight:600;margin:0 0 4px;overflow-wrap:anywhere}\n.launcher-sub{font-size:12px;color:var(--l-ink3);line-height:1.7;overflow-wrap:anywhere}\n.launcher-main-tag{display:inline-flex;align-items:center;gap:3px;font:11px/1 var(--font-mono,ui-monospace);border:1px solid var(--l-line);border-radius:4px;padding:2px 5px;color:var(--l-ink3);background:transparent}\n.launcher-main-tag.acc{color:var(--l-accent);background:var(--l-accentSoft);border-color:transparent}\n.launcher-report-tag{font:11px/1 var(--font-mono,ui-monospace);letter-spacing:.4px;color:var(--l-accent);background:var(--l-accentSoft);border-radius:4px;padding:3px 5px}\n.launcher-prog-row{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11px;color:var(--l-ink3)}\n.launcher-bar{flex:1;height:6px;border-radius:3px;background:var(--l-surface3);overflow:hidden}\n.launcher-bar i{display:block;height:100%;background:var(--l-accent)}\n.launcher-crit{display:grid;gap:2px;margin-top:9px;padding-top:9px;border-top:1px solid var(--l-line)}\n.launcher-crit-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:center;min-height:32px;padding:2px 0;font-size:12px;color:var(--l-ink2);cursor:pointer;min-width:0}\n.launcher-crit-row input{appearance:none;width:18px;height:18px;border:1.5px solid var(--l-line2);border-radius:4px;display:grid;place-items:center;margin:0}\n.launcher-crit-row input:checked{background:var(--l-accent);border-color:transparent}\n.launcher-crit-row span.on{color:var(--l-ink4);text-decoration:line-through}\n.launcher-crit__who{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}\n.launcher-dyn{margin-top:9px;padding-top:8px;border-top:1px solid var(--l-line);font-size:12px;color:var(--l-ink3);display:grid;gap:3px;min-width:0}\n.launcher-dyn b{color:var(--l-ink4);font:11px/1 var(--font-mono,ui-monospace);font-weight:500}\n.launcher-chg-row{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 0;font-size:12px;border-bottom:1px solid var(--l-line);min-width:0}\n.launcher-chg-row:last-child{border-bottom:0}\n.launcher-chg-row__f{font-family:var(--font-mono,ui-monospace);font-size:12px;color:var(--l-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.launcher-chg-sum{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4);white-space:nowrap}\n.launcher-main-git-add{color:var(--l-green)}.launcher-main-git-del{color:var(--l-red)}\n.launcher-main-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}\n.launcher-appr{border:1px solid var(--l-line2);background:var(--l-surface);border-radius:var(--l-radius-md);overflow:hidden;min-width:0}\n.launcher-appr__h{display:flex;align-items:center;gap:7px;padding:8px 12px;font-size:12px;color:var(--l-amber);font-weight:600;border-bottom:1px solid var(--l-line)}\n.launcher-appr__b{padding:11px 12px;min-width:0}\n.launcher-appr__cmd{font-family:var(--font-mono,ui-monospace);font-size:12px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-sm);padding:8px 10px;margin:7px 0;overflow-x:auto;white-space:pre;color:var(--l-ink)}\n.launcher-appr__why{font-size:12px;color:var(--l-ink2);line-height:1.5;overflow-wrap:anywhere}\n.launcher-appr__hint{font-size:11px;color:var(--l-ink4);margin-top:8px;display:inline-flex;align-items:center;gap:8px}\n.launcher-appr__acts{display:flex;gap:6px;align-items:center;margin-top:9px;flex-wrap:wrap}\n.launcher-appr.done{background:var(--l-surface);border-color:var(--l-line)}\n.launcher-appr.done .launcher-appr__h{color:var(--l-green);border-color:var(--l-line)}\n.launcher-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:1px solid var(--l-line2);border-radius:var(--l-radius-sm);background:transparent;color:var(--l-ink2);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}\n.launcher-btn:hover{background:var(--l-hover);color:var(--l-ink)}\n.launcher-btn.primary{background:var(--l-accent);border-color:transparent;color:var(--l-onAccent)}\n.launcher-btn.primary:hover{filter:brightness(1.08);color:var(--l-onAccent)}\n.launcher-btn.ghost{border-color:transparent;background:transparent}\n.launcher-btn.danger{color:var(--l-red)}\n.launcher-btn.sm{height:26px;padding:0 8px}\n.launcher-codec{font-family:var(--font-mono,ui-monospace);font-size:12px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:6px;padding:1px 5px}\n.launcher-composer{padding:8px 14px 12px;border-top:1px solid var(--l-line);background:var(--l-bg);flex:0 0 auto;min-width:0}\n.launcher-cm-box{border:1px solid var(--l-line2);border-radius:var(--l-radius-md);background:var(--l-surface);padding:9px 10px 8px;min-width:0}\n.launcher-cm-box:focus-within{border-color:var(--l-accent);box-shadow:0 0 0 3px var(--l-accentSoft)}\n.launcher-cm-input{width:100%;max-width:100%;border:0;background:transparent;resize:none;font:inherit;font-size:13px;line-height:1.5;min-height:40px;max-height:160px;outline:none;display:block;padding:2px 2px 6px;color:var(--l-ink)}\n.launcher-cm-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}\n.launcher-cm-meta{margin-left:auto;font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}\n.launcher-send{width:30px;height:30px;border:0;border-radius:var(--l-radius-sm);background:var(--l-accent);color:var(--l-onAccent);display:grid;place-items:center;cursor:pointer}\n.launcher-send[disabled]{opacity:.38;cursor:not-allowed}\n.launcher-approval-dock{border-top:1px solid var(--l-amber);background:var(--l-surface2);padding:8px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;flex:0 0 auto;min-width:0}\n.launcher-approval-dock__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}\n.launcher-approval-dock__main b{font-size:12px;color:var(--l-amber)}\n.launcher-approval-dock__main code{font-family:var(--font-mono,ui-monospace);font-size:11px;background:var(--l-surface);border:1px solid var(--l-line);border-radius:6px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.launcher-approval-dock__acts{display:flex;gap:4px;flex-wrap:wrap}\n.launcher-palette{position:fixed;left:50%;top:14vh;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));max-width:100%;max-height:60vh;display:flex;flex-direction:column;background:var(--l-panel);color:var(--l-ink);border:1px solid var(--l-line2);border-radius:var(--l-radius-md);box-shadow:0 14px 34px rgba(0,0,0,.18);z-index:50;overflow:hidden}\n.launcher-palette__in{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid var(--l-line)}\n.launcher-palette__input{flex:1;min-width:0;min-height:24px;border:0;background:transparent;outline:none;font:inherit;font-size:14px;color:var(--l-ink)}\n.launcher-palette__list{list-style:none;margin:0;padding:4px;overflow:auto;min-height:0}\n.launcher-palette__row{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:24px;padding:8px 10px;border-radius:6px;color:var(--l-ink2);font:inherit;font-size:13px;text-align:left;cursor:pointer}\n.launcher-palette__row.sel{background:var(--l-accentSoft)}\n.launcher-palette__row.off{opacity:.45;cursor:not-allowed}\n.launcher-palette__row.sel{color:var(--l-ink)}\n.launcher-palette__hint{color:var(--l-ink4);font:11px/1 var(--font-mono,ui-monospace)}\n.launcher-palette__empty{padding:10px;font-size:12px;color:var(--l-ink3)}\n.launcher-palette__foot{display:flex;gap:10px;padding:7px 12px;border-top:1px solid var(--l-line);font-size:11px;color:var(--l-ink4);font-family:var(--font-mono,ui-monospace)}"
  const mainIcon = function mainIcon(h, name) {
  const body = MAIN_ICONS[name] ?? ''
  return h('svg', { viewBox: '0 0 24 24', className: 'launcher-ic', 'aria-hidden': 'true', focusable: 'false', dangerouslySetInnerHTML: { __html: body } })
}
  const stepStatusLabel = function stepStatusLabel(st, labels = {}) {
  if (st === 'done') return '完成'
  if (st === 'doing') return labels.doing ?? '进行中'
  return labels.todo ?? '待排期'
}
  const applyApproval = function applyApproval(state, cardId, choice) {
  if (!Object.prototype.hasOwnProperty.call(MAIN_APPROVAL_CHOICES, choice)) return { ...(state ?? {}) }
  return { ...(state ?? {}), [cardId]: choice }
}
  const resetApproval = function resetApproval(state, cardId) {
  const next = { ...(state ?? {}) }
  delete next[cardId]
  return next
}
  const approvalOf = function approvalOf(state, cardId) {
  return state?.[cardId] ?? 'pending'
}
  const pendingApprovals = function pendingApprovals(state, thread) {
  const list = Array.isArray(thread) ? thread : []
  return list.filter((m) => m?.k === 'approval' && approvalOf(state, m.id) === 'pending')
}
  const isApprovalPending = function isApprovalPending(state, thread) {
  return pendingApprovals(state, thread).length > 0
}
  const composerCanSend = function composerCanSend(text) {
  return String(text ?? '').trim() !== ''
}
  const composerKeyDown = function composerKeyDown({ key, shiftKey = false, canSend = false } = {}) {
  if (key !== 'Enter') return 'none'
  if (shiftKey) return 'newline'
  return canSend ? 'send' : 'none'
}
  const paletteFilter = function paletteFilter(commands, query) {
  const list = Array.isArray(commands) ? commands : []
  const q = String(query ?? '').trim().toLowerCase()
  if (q === '') return list.slice()
  return list.filter((cmd) => `${cmd?.label ?? ''} ${cmd?.hint ?? ''}`.toLowerCase().includes(q))
}
  const paletteStep = function paletteStep(index, delta, length) {
  const len = Number.isInteger(length) ? length : 0
  if (len <= 0) return 0
  const base = Number.isInteger(index) ? index : 0
  return ((base + delta) % len + len) % len
}
  const paletteCommand = function paletteCommand({ key, hasSelection = false } = {}) {
  if (key === 'Escape') return 'close'
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'prev'
  if (key === 'Enter' && hasSelection) return 'run'
  return 'none'
}
  const toggleExpanded = function toggleExpanded(map, key) {
  const next = { ...(map ?? {}) }
  if (next[key] === true) delete next[key]
  else next[key] = true
  return next
}
  const shouldFollowScroll = function shouldFollowScroll({ scrollTop, clientHeight, scrollHeight, threshold = 48 } = {}) {
  const top = Number(scrollTop) || 0
  const client = Number(clientHeight) || 0
  const height = Number(scrollHeight) || 0
  const gap = Number(threshold) || 0
  return height - (top + client) <= gap
}
  const renderUserMessage = function renderUserMessage(h, msg) {
  const m = msg ?? {}
  return h('div', { className: 'launcher-turn' },
    h('div', { className: 'launcher-msg-user' },
      h('span', { className: 'launcher-msg-user__text' }, String(m.t ?? '')),
      m.at ? h('div', { className: 'launcher-stamp' }, String(m.at)) : null))
}
  const renderFoldSummary = function renderFoldSummary(h, fold, opts = {}) {
  const f = fold ?? {}
  const open = opts.open === true
  return h('button', {
    type: 'button',
    className: `launcher-fold${open ? ' open' : ''}`,
    'aria-expanded': open,
    'data-fold': opts.id ?? '',
    onClick: () => opts.onToggle?.(opts.id),
  },
  mainIcon(h, 'caret'),
  h('span', null, `已处理 ${f.dur ?? ''} · 读了 ${f.files ?? 0} 个文件 · 运行 ${f.cmds ?? 0} 条命令`))
}
  const renderTools = function renderTools(h, tools, opts = {}) {
  const list = Array.isArray(tools) ? tools : []
  const open = opts.open === true
  const children = [
    h('button', {
      type: 'button',
      className: 'launcher-tools__h',
      'aria-expanded': open,
      onClick: () => opts.onToggle?.(opts.id),
    },
    mainIcon(h, 'terminal'),
    h('span', null, `这一轮跑了 ${list.length} 步`),
    h('span', { className: 'launcher-tools__n' }, open ? '收起' : '展开'),
    h('span', { className: 'launcher-main-grow' }),
    mainIcon(h, open ? 'chevronDown' : 'chevronRight')),
  ]
  if (open) {
    for (const t of list) {
      children.push(h('div', { className: `launcher-tool-row${t?.bad === true ? ' bad' : ''}` },
        mainIcon(h, t?.k === 'Bash' ? 'terminal' : t?.k === 'Write' ? 'file' : 'eye'),
        h('span', { className: 'launcher-tool-row__k' }, String(t?.k ?? '')),
        h('span', { className: 'launcher-tool-row__c', title: String(t?.c ?? '') }, String(t?.c ?? '')),
        h('span', { className: 'launcher-tool-row__d' }, String(t?.d ?? ''))))
    }
  }
  return h('div', { className: 'launcher-tools', 'aria-expanded': open }, ...children)
}
  const renderPlan = function renderPlan(h, plan) {
  const list = Array.isArray(plan) ? plan : []
  const done = list.filter((p) => p?.st === 'done').length
  return h('div', { className: 'launcher-plan' },
    h('div', { className: 'launcher-plan__h' },
      mainIcon(h, 'target'),
      h('span', null, '实现计划'),
      h('span', { className: 'launcher-main-kbd' }, `${done} / ${list.length}`)),
    list.map((p, idx) => h('div', { className: `launcher-plan-step ${p?.st ?? ''}` },
      h('span', { className: 'launcher-plan-step__no' }, p?.st === 'done' ? '✓' : String(idx + 1)),
      h('span', { className: 'launcher-plan-step__nm' }, String(p?.s ?? '')),
      h('span', { className: 'launcher-main-tag' }, stepStatusLabel(p?.st)))))
}
  const renderTaskCard = function renderTaskCard(h, card, opts = {}) {
  const c = card ?? {}
  const rows = Array.isArray(c.rows) ? c.rows : []
  const crit = opts.crit ?? {}
  return h('div', { className: 'launcher-bcard', 'data-card': 'task' },
    h('div', { className: 'launcher-bcard__h' },
      mainIcon(h, 'target'),
      h('span', { className: 'launcher-bcard__who' }, String(c.who ?? '')),
      h('span', { className: 'launcher-main-tag acc' }, String(c.assignee ?? '')),
      h('span', { className: 'launcher-bcard__r' }, h('span', { className: 'launcher-main-tag' }, `覆盖 ${rows.length} 项`))),
    h('div', { className: 'launcher-bcard__b' },
      h('h4', { className: 'launcher-card-t' }, String(c.title ?? '')),
      h('div', { className: 'launcher-sub' }, '做完一项勾一项，勾完即算过。'),
      h('div', { className: 'launcher-prog-row' },
        h('span', null, `${Number(c.pct) || 0}%`),
        h('div', { className: 'launcher-bar' }, h('i', { style: { width: `${Number(c.pct) || 0}%` } }))),
      h('div', { className: 'launcher-crit' }, rows.map((r, idx) => {
        const key = `${c.title ?? ''}${idx}`
        const on = crit[key] === true
        return h('label', { className: 'launcher-crit-row' },
          h('input', { type: 'checkbox', checked: on, 'data-crit-key': key, 'aria-label': `勾选 ${String(r?.t ?? '')}`, onChange: () => opts.onToggleCrit?.(key) }),
          h('span', { className: on ? 'on' : '' }, String(r?.t ?? '')),
          h('span', { className: 'launcher-crit__who' }, stepStatusLabel(r?.st, { doing: '在做', todo: '待办' })))
      })),
      c.dyn ? h('div', { className: 'launcher-dyn' }, h('b', null, '动态'), h('span', null, String(c.dyn))) : null))
}
  const renderReportCard = function renderReportCard(h, card, opts = {}) {
  const c = card ?? {}
  const open = opts.open === true
  const links = Array.isArray(c.links) ? c.links : []
  return h('div', { className: 'launcher-bcard', 'data-card': 'report' },
    h('div', { className: 'launcher-bcard__h' },
      mainIcon(h, 'sparkles'),
      h('span', { className: 'launcher-bcard__who' }, '汇报卡 · dsh-bot'),
      h('span', { className: 'launcher-report-tag' }, String(c.status ?? '')),
      h('span', { className: 'launcher-bcard__r' },
        h('button', { type: 'button', className: 'launcher-btn sm ghost', onClick: () => opts.onToggle?.(c.title) }, open ? '收起动态' : '展开动态'))),
    h('div', { className: 'launcher-bcard__b' },
      h('h4', { className: 'launcher-card-t' }, String(c.title ?? '')),
      h('div', { className: 'launcher-sub' }, String(c.body ?? '')),
      links.length
        ? h('div', { className: 'launcher-main-tags' }, links.map((l) => h('span', { className: 'launcher-main-tag acc' }, mainIcon(h, 'file'), String(l))))
        : null,
      open === true ? h('div', { className: 'launcher-dyn' }, h('b', null, '动态'), h('span', null, String(c.dyn ?? ''))) : null))
}
  const renderChangedCard = function renderChangedCard(h, chg, opts = {}) {
  const list = Array.isArray(chg) ? chg : []
  return h('div', { className: 'launcher-bcard', 'data-card': 'changed' },
    h('div', { className: 'launcher-bcard__h' },
      mainIcon(h, 'file'),
      h('span', { className: 'launcher-bcard__who' }, '改动'),
      h('span', { className: 'launcher-chg-sum' }, `${list.length} 个文件`),
      h('span', { className: 'launcher-bcard__r' },
        h('button', { type: 'button', className: 'launcher-btn sm ghost', onClick: () => opts.onReview?.() }, '去审阅', mainIcon(h, 'chevronRight')))),
    h('div', { className: 'launcher-bcard__b' }, list.map((f) => h('div', { className: 'launcher-chg-row' },
      mainIcon(h, 'file'),
      h('span', { className: 'launcher-chg-row__f', title: String(f?.f ?? '') }, String(f?.f ?? '')),
      h('span', { className: 'launcher-chg-sum' },
        h('span', { className: 'launcher-main-git-add' }, `+${f?.add ?? 0}`),
        ' ',
        h('span', { className: 'launcher-main-git-del' }, `−${f?.del ?? 0}`))))))
}
  const renderApprovalCard = function renderApprovalCard(h, card, opts = {}) {
  const c = card ?? {}
  const state = opts.state ?? 'pending'
  if (state !== 'pending') {
    return h('div', { className: 'launcher-appr done', 'data-approval': state },
      h('div', { className: 'launcher-appr__h' },
        mainIcon(h, state === 'deny' ? 'x' : 'check'),
        h('span', null, state === 'deny' ? '已拒绝' : state === 'always' ? '已总是允许' : '已允许 · 本次')),
      h('div', { className: 'launcher-appr__b' },
        h('div', { className: 'launcher-appr__cmd' }, String(c.cmd ?? '')),
        h('div', { className: 'launcher-appr__hint' },
          state === 'deny' ? '没有执行。想改主意可以点下面的按钮。' : '已写进本地状态，宿主那边会记成同一种决策。',
          h('button', { type: 'button', className: 'launcher-btn sm ghost', onClick: () => opts.onReset?.(c.id) }, '撤销'))))
  }
  return h('div', { className: 'launcher-appr', 'data-approval': 'pending' },
    h('div', { className: 'launcher-appr__h' }, mainIcon(h, 'alert'), h('span', null, '需要你批准 · 运行命令')),
    h('div', { className: 'launcher-appr__b' },
      h('div', { className: 'launcher-appr__why' }, '将在 ', h('span', { className: 'launcher-codec' }, String(c.cwd ?? '~/Pod')), ' 运行下面这条。'),
      h('div', { className: 'launcher-appr__cmd' }, String(c.cmd ?? '')),
      h('div', { className: 'launcher-appr__why' }, String(c.why ?? '')),
      h('div', { className: 'launcher-appr__acts' },
        Object.entries(MAIN_APPROVAL_CHOICES).map(([choice, meta]) => h('button', {
          type: 'button',
          className: `launcher-btn ${meta.tone}`.trim(),
          'data-choice': choice,
          onClick: () => opts.onChoose?.(choice),
        }, meta.icon ? mainIcon(h, meta.icon) : null, meta.label)),
        h('span', { className: 'launcher-appr__hint' }, '输入框空着按 Enter 也能允许'))))
}
  const renderApprovalDock = function renderApprovalDock(h, card, opts = {}) {
  const c = card ?? {}
  return h('div', { className: 'launcher-approval-dock' },
    mainIcon(h, 'alert'),
    h('div', { className: 'launcher-approval-dock__main' },
      h('b', null, '需要你批准 · 运行命令'),
      h('code', null, String(c.cmd ?? ''))),
    h('div', { className: 'launcher-approval-dock__acts' },
      Object.entries(MAIN_APPROVAL_CHOICES).map(([choice, meta]) => h('button', {
        type: 'button',
        className: `launcher-btn sm ${meta.tone}`.trim(),
        'data-choice': choice,
        onClick: () => opts.onChoose?.(c.id, choice),
      }, meta.label))))
}
  const renderBotMessage = function renderBotMessage(h, msg, opts = {}) {
  const m = msg ?? {}
  const idx = opts.index ?? 0
  const expanded = opts.expanded ?? {}
  const tx = Array.isArray(m.tx) ? m.tx : []
  const children = [
    h('div', { className: 'launcher-msg-bot__hd' }, h('b', null, 'DeepSeek Harness'), h('span', null, '刚刚')),
  ]
  if (m.fold) {
    children.push(renderFoldSummary(h, m.fold, {
      id: `fold:${idx}`,
      open: expanded[`fold:${idx}`] === true,
      onToggle: opts.onToggleFold,
    }))
  }
  if (tx.length) children.push(h('div', { className: 'launcher-tx' }, tx.map((p) => h('p', null, String(p)))))
  if (m.tools?.length) {
    children.push(renderTools(h, m.tools, {
      id: `tools:${idx}`,
      open: expanded[`tools:${idx}`] === true,
      onToggle: opts.onToggleTools,
    }))
  }
  if (m.plan?.length) children.push(renderPlan(h, m.plan))
  if (m.chg?.length) children.push(renderChangedCard(h, m.chg, { onReview: opts.onReview }))
  children.push(h('div', { className: 'launcher-msg-acts' },
    ['copy', 'doc', 'target', 'git'].map((name) => h('button', {
      key: name,
      type: 'button',
      className: 'launcher-icon-btn',
      title: name,
      'aria-label': name,
      onClick: () => opts.onAction?.(name),
    }, mainIcon(h, name)))))
  return h('div', { className: 'launcher-turn' },
    h('div', { className: 'launcher-msg-bot' },
      h('span', { className: 'launcher-msg-bot__who' }, mainIcon(h, 'bot')),
      h('div', { className: 'launcher-msg-bot__bd' }, ...children)))
}
  const renderThread = function renderThread(h, thread, opts = {}) {
  const list = Array.isArray(thread) ? thread : []
  const approvals = opts.approvals ?? {}
  const expanded = opts.expanded ?? {}
  const children = []
  list.forEach((m, idx) => {
    if (m === null || typeof m !== 'object') return
    if (m.k === 'user') children.push(renderUserMessage(h, m))
    else if (m.k === 'bot') children.push(renderBotMessage(h, m, { ...opts, index: idx, expanded }))
    else if (m.k === 'task') {
      children.push(h('div', { className: 'launcher-turn' }, renderTaskCard(h, m, { crit: opts.crit, onToggleCrit: opts.onToggleCrit })))
    } else if (m.k === 'report') {
      children.push(h('div', { className: 'launcher-turn' }, renderReportCard(h, m, {
        open: expanded[`report:${m.title}`] === true,
        onToggle: opts.onToggleReport,
      })))
    } else if (m.k === 'approval') {
      const state = approvalOf(approvals, m.id)
      if (state !== 'pending') {
        children.push(h('div', { className: 'launcher-turn' }, renderApprovalCard(h, m, {
          state,
          onChoose: () => {},
          onReset: opts.onApprovalReset,
        })))
      }
    }
  })
  return h('div', { className: 'launcher-thread' }, ...children)
}
  const renderComposer = function renderComposer(h, opts = {}) {
  const value = String(opts.value ?? '')
  const canSend = opts.canSend === true
  return h('div', { className: 'launcher-composer' },
    h('div', { className: 'launcher-cm-box' },
      h('textarea', {
        className: 'launcher-cm-input',
        rows: 2,
        value,
        placeholder: '给 dsh 发消息…（Enter 发送，Shift+Enter 换行）',
        'aria-label': '输入消息',
        onChange: (event) => opts.onInput?.(event?.target?.value ?? ''),
        onKeyDown: (event) => {
          const action = composerKeyDown({ key: event.key, shiftKey: event.shiftKey === true, canSend })
          if (action === 'send') {
            event.preventDefault()
            opts.onSend?.()
          } else if (action === 'none' && event.key === 'Enter') {
            event.preventDefault()
          }
        },
      }),
      h('div', { className: 'launcher-cm-row' },
        h('span', { className: 'launcher-cm-meta' }, canSend ? 'Enter 发送' : '⌘↵ 发送'),
        // 票 34：模型/等级触发按钮由 client 传入（lib/model-surface.js），没传就不渲染。
        opts.extras ?? null,
        h('button', {
          type: 'button',
          className: 'launcher-send',
          'aria-label': '发送',
          'aria-disabled': !canSend,
          disabled: !canSend,
          onClick: () => { if (canSend) opts.onSend?.() },
        }, mainIcon(h, 'arrowUp')))))
}
  const renderCommandPalette = function renderCommandPalette(h, opts = {}) {
  if (opts.open !== true) return null
  const commands = Array.isArray(opts.commands) ? opts.commands : []
  const shown = paletteFilter(commands, opts.query)
  const index = Number.isInteger(opts.index) ? opts.index : 0
  const onKeyDown = (event) => {
    const action = paletteCommand({ key: event.key, hasSelection: shown.length > 0 })
    if (action === 'close') {
      event.preventDefault()
      opts.onClose?.()
      return
    }
    if (action === 'next') {
      event.preventDefault()
      opts.onMove?.(1)
      return
    }
    if (action === 'prev') {
      event.preventDefault()
      opts.onMove?.(-1)
      return
    }
    if (action === 'run') {
      event.preventDefault()
      opts.onRun?.(shown[Math.min(index, shown.length - 1)])
    }
  }
  return h('div', { className: 'launcher-palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' },
    h('div', { className: 'launcher-palette__in' },
      mainIcon(h, 'search'),
      h('input', {
        className: 'launcher-palette__input',
        placeholder: '搜命令、页面、动作…',
        value: String(opts.query ?? ''),
        'aria-label': '搜索命令',
        autoFocus: true,
        onChange: (event) => opts.onQuery?.(event?.target?.value ?? ''),
        onKeyDown,
      }),
      h('span', { className: 'launcher-main-kbd' }, 'Esc')),
    h('ul', { className: 'launcher-palette__list', id: 'launcher-palette-list' },
      shown.length === 0 ? h('li', { className: 'launcher-palette__empty' }, '没有匹配的命令') : null,
      shown.map((cmd, i) => h('li', {
        key: cmd.id,
        role: 'option',
        'aria-selected': i === index,
        'aria-disabled': cmd.disabled === true,
        className: `launcher-palette__row${i === index ? ' sel' : ''}${cmd.disabled === true ? ' off' : ''}`,
        onClick: () => { if (cmd.disabled !== true) opts.onRun?.(cmd) },
      }, h('span', { className: 'launcher-palette__label' }, cmd.label),
        cmd.hint ? h('span', { className: 'launcher-palette__hint' }, cmd.hint) : null))),
    h('div', { className: 'launcher-palette__foot' },
      h('span', null, '↑↓ 选择'),
      h('span', null, 'Enter 执行'),
      h('span', null, 'Esc 关闭')))
}
  const renderMainView = function renderMainView(h, opts = {}) {
  const thread = Array.isArray(opts.thread) ? opts.thread : []
  const approvals = opts.approvals ?? {}
  const expanded = opts.expanded ?? {}
  const composer = opts.composer ?? {}
  const palette = opts.palette ?? {}
  const pending = pendingApprovals(approvals, thread)
  return h('div', { className: 'launcher-mainview', 'data-mainview': 'v17', onKeyDown: opts.onKeyDown },
    h('div', { className: 'launcher-thread-wrap', ref: opts.threadRef },
      renderThread(h, thread, { ...opts, approvals, expanded })),
    pending.length
      ? renderApprovalDock(h, pending[0], { onChoose: (id, choice) => opts.onApproval?.(id, choice) })
      : null,
    renderComposer(h, {
      value: composer.value,
      canSend: composer.canSend === true,
      extras: opts.composerExtras,
      onInput: opts.onCompose,
      onSend: opts.onSend,
    }),
    renderCommandPalette(h, {
      open: palette.open === true,
      query: palette.query,
      commands: palette.commands,
      index: palette.index,
      onQuery: opts.onPaletteQuery,
      onMove: opts.onPaletteMove,
      onRun: opts.onPaletteRun,
      onClose: opts.onPaletteClose,
    }))
}
  // #endregion main-from-lib

  // #region sidebar-from-lib
  // 本段由 tools/sync-contract.mjs 从 lib/sidebar.js 生成，勿手改；
  // 漂移由 test/sidebar-client.test.mjs 的同步检查挡住。
  const SIDEBAR_METRICS = {"rowHeight":32,"radius":12,"cardRadius":12,"cardHeaderHeight":40,"rowPaddingLeft":9,"rowPaddingRight":8,"leadWidth":16,"gap":6,"chevronButton":28,"scrollPadding":8}
  const SIDEBAR_ICONS = {"chevronRight":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M9 6l6 6l-6 6\"  />","chevronDown":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M6 9l6 6l6 -6\"  />","folder":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2\"  />","folderOpen":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2\"  />","dots":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"  /> <path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"  /> <path d=\"M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"  />","plus":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M12 5l0 14\"  /> <path d=\"M5 12l14 0\"  />","search":"<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /> <path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\"  /> <path d=\"M21 21l-6 -6\"  />"}
  const SIDEBAR_CSS = ".launcher-sidebar__inner{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--l-ink)}\n.launcher-sidebar .side-h{display:flex;align-items:center;gap:8px;padding:12px 12px 6px 16px;min-height:44px}\n.launcher-sidebar .side-h h2{font-size:14px;font-weight:600;letter-spacing:.2px;margin:0}\n.launcher-sidebar .side-h .side-collapse{margin-left:auto;display:grid;place-items:center;width:28px;height:28px;border:0;background:none;border-radius:8px;color:var(--l-ink3);cursor:pointer}\n.launcher-sidebar .side-h .side-collapse:hover{background:var(--l-hover);color:var(--l-ink)}\n.launcher-sidebar .side-h .side-collapse svg{width:16px;height:16px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-sidebar .side-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:2px 8px 12px;display:flex;flex-direction:column;gap:0}\n.launcher-sidebar .side-card{border:1px solid var(--l-line);border-radius:12px;background:var(--l-surface);overflow:hidden;margin:0 0 8px;flex:0 0 auto}\n.launcher-sidebar .side-card:last-child{margin-bottom:0}\n.launcher-sidebar .card-hd{display:flex;align-items:center;gap:4px;height:40px;padding:0 6px 0 10px}\n.launcher-sidebar .card-toggle{display:flex;align-items:center;gap:6px;flex:1;min-width:0;height:28px;padding:0 6px;border:0;border-radius:8px;background:none;font:inherit;text-align:left;color:inherit;cursor:pointer}\n.launcher-sidebar .card-toggle:hover{background:var(--l-hover)}\n.launcher-sidebar .card-toggle .dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto}\n.launcher-sidebar .card-toggle .dot.wait{background:var(--l-amber)}\n.launcher-sidebar .card-toggle .dot.accent{background:var(--l-accent)}\n.launcher-sidebar .card-toggle .dot.muted{background:var(--l-ink4)}\n.launcher-sidebar .card-toggle b{font-size:13px;font-weight:600;color:var(--l-ink);white-space:nowrap}\n.launcher-sidebar .card-toggle .n{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 6px;border-radius:6px;background:var(--l-surface2);color:var(--l-ink3)}\n.launcher-sidebar .card-toggle .n.wait{background:var(--l-accentSoft);color:var(--l-amber)}\n.launcher-sidebar .card-toggle .n.accent{background:var(--l-accentSoft);color:var(--l-accent)}\n.launcher-sidebar .card-hd .acts{display:flex;gap:2px;margin-left:2px}\n.launcher-sidebar .card-chev{margin-left:auto;width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:none;color:var(--l-ink4);cursor:pointer;flex:0 0 auto}\n.launcher-sidebar .card-chev:hover{background:var(--l-hover);color:var(--l-ink2)}\n.launcher-sidebar .card-chev svg{width:14px;height:14px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-sidebar .card-body{display:flex;flex-direction:column;gap:2px;padding:0 4px 6px}\n.launcher-sidebar .row{position:relative;display:flex;align-items:center;height:32px;padding:0 8px 0 9px;border-radius:12px;width:100%;box-sizing:border-box}\n.launcher-sidebar .row:hover{background:var(--l-hover)}\n.launcher-sidebar .row.is-on{background:var(--l-accentSoft)}\n.launcher-sidebar .row-main{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;height:100%;background:none;border:0;padding:0;font:inherit;color:var(--l-ink);text-align:left;cursor:pointer}\n.launcher-sidebar .row .lead{flex:0 0 auto;width:16px;height:20px;display:grid;place-items:center;color:var(--l-ink4)}\n.launcher-sidebar .row .lead svg{width:16px;height:16px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-sidebar .row .ttl{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--l-ink)}\n.launcher-sidebar .row .meta{flex:0 0 auto;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--l-ink4);display:flex;align-items:center;gap:5px}\n.launcher-sidebar .row.child{padding:0 8px 0 9px}\n.launcher-sidebar .row.child .ttl{color:var(--l-ink2)}\n.launcher-sidebar .ws-group{display:flex;flex-direction:column;gap:2px}\n.launcher-sidebar .ws-row .lead{color:var(--l-ink4)}\n.launcher-sidebar .need-sub{display:flex;align-items:center;gap:6px;height:28px;padding:0 12px;font-size:11px;font-weight:600;letter-spacing:.2px;color:var(--l-ink3);background:var(--l-surface2);border-top:1px solid var(--l-line)}\n.launcher-sidebar .need-sub .n{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--l-ink4)}\n.launcher-sidebar .row.flat{border-radius:0}\n.launcher-sidebar .ndot{width:6px;height:6px;border-radius:50%;display:inline-block}\n.launcher-sidebar .ndot.wait{background:var(--l-amber)}\n.launcher-sidebar .ndot.ok{background:var(--l-green)}\n.launcher-sidebar .side-empty{padding:8px 10px;font-size:12px;color:var(--l-ink3);line-height:1.5}\n.launcher-sidebar :focus-visible{outline:2px solid var(--l-accent);outline-offset:1px;border-radius:8px}"
  const sidebarIcon = function sidebarIcon(h, name) {
  const body = SIDEBAR_ICONS[name] ?? ''
  return h('svg', { viewBox: '0 0 24 24', className: 'launcher-ic', 'aria-hidden': 'true', focusable: 'false', dangerouslySetInnerHTML: { __html: body } })
}
  const rowTitleLeftX = function rowTitleLeftX() {
  return SIDEBAR_METRICS.rowPaddingLeft + SIDEBAR_METRICS.leadWidth + SIDEBAR_METRICS.gap
}
  const normalizeSession = function normalizeSession(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const id = String(raw.id ?? '')
  if (id === '') return null
  return {
    id,
    title: String(raw.displayTitle ?? raw.title ?? raw.name ?? id),
    cwd: typeof raw.cwd === 'string' && raw.cwd.length > 0 ? raw.cwd : '',
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    blank: raw.blank === true,
    origin: raw.origin,
  }
}
  const normalizeSessions = function normalizeSessions(snapshot) {
  if (Array.isArray(snapshot)) return snapshot.map(normalizeSession).filter((item) => item !== null)
  if (snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.ids) && snapshot.byId !== null && typeof snapshot.byId === 'object') {
    return snapshot.ids.map((id) => normalizeSession(snapshot.byId[id])).filter((item) => item !== null)
  }
  return []
}
  const workspaceName = function workspaceName(cwd) {
  const parts = String(cwd ?? '').split('/').filter((part) => part !== '')
  return parts.length === 0 ? '未命名目录' : parts[parts.length - 1]
}
  const groupSessions = function groupSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : []
  const workspaces = []
  const index = new Map()
  const tasks = []
  for (const session of list) {
    if (session === null || session === undefined) continue
    if (session.blank === true || session.origin === 'subagent') continue
    if (session.cwd === '') {
      tasks.push(session)
      continue
    }
    let group = index.get(session.cwd)
    if (group === undefined) {
      group = { id: session.cwd, name: workspaceName(session.cwd), cwd: session.cwd, sessions: [] }
      index.set(session.cwd, group)
      workspaces.push(group)
    }
    group.sessions.push(session)
  }
  return { workspaces, tasks }
}
  const needSummary = function needSummary(need) {
  const pending = need !== null && need !== undefined && Array.isArray(need.pending) ? need.pending : []
  const done = need !== null && need !== undefined && Array.isArray(need.done) ? need.done : []
  return { pending, done, total: pending.length + done.length }
}
  const normalizeOpen = function normalizeOpen(open) {
  return {
    need: open === null || open === undefined || open.need !== false,
    workspaces: open === null || open === undefined || open.workspaces !== false,
    tasks: open === null || open === undefined || open.tasks !== false,
  }
}
  const buildSidebarState = function buildSidebarState({ state, sessions, need, open, activeId, enabled } = {}) {
  if (state !== null && state !== undefined && typeof state === 'object') {
    return {
      available: true,
      need: needSummary(state.need),
      workspaces: Array.isArray(state.workspaces) ? state.workspaces : [],
      tasks: Array.isArray(state.tasks) ? state.tasks : [],
      open: normalizeOpen(state.open ?? open),
      activeId: state.activeId ?? activeId ?? null,
    }
  }
  const list = normalizeSessions(sessions)
  const groups = groupSessions(list)
  const summary = needSummary(need)
  return {
    available: enabled === true && (list.length > 0 || summary.total > 0),
    need: summary,
    workspaces: groups.workspaces,
    tasks: groups.tasks,
    open: normalizeOpen(open),
    activeId: activeId ?? null,
  }
}
  const renderCardHeader = function renderCardHeader(h, options) {
  const opts = options ?? {}
  const key = String(opts.key ?? opts.label ?? '')
  const open = opts.open !== false
  const acts = Array.isArray(opts.acts) ? opts.acts : []
  const children = [
    h('button', {
      key: 'toggle',
      type: 'button',
      className: 'card-toggle',
      'aria-expanded': open,
      'data-side-toggle': key,
      onClick: opts.onToggle,
    },
    h('span', { className: `dot ${opts.dot ?? 'muted'}`, 'aria-hidden': 'true' }),
    h('b', null, String(opts.label ?? '')),
    h('span', { className: `n ${opts.dot ?? 'muted'}` }, String(opts.count ?? 0))),
  ]
  if (acts.length > 0) children.push(h('span', { key: 'acts', className: 'acts' }, ...acts))
  // 箭头必须最后渲染：flex 下 margin-left:auto 把它顶到最右
  children.push(h('button', {
    key: 'chev',
    type: 'button',
    className: 'card-chev',
    'aria-expanded': open,
    'aria-label': open ? '收起' : '展开',
    'data-side-toggle-chev': key,
    onClick: opts.onToggle,
  }, sidebarIcon(h, open ? 'chevronDown' : 'chevronRight')))
  return h('div', { className: 'card-hd' }, ...children)
}
  const renderNeedRow = function renderNeedRow(h, item, kind, onOpen) {
  const row = item ?? {}
  return h('div', { key: String(row.id ?? row.title ?? ''), className: 'row flat' },
    h('button', {
      type: 'button',
      className: 'row-main',
      title: String(row.title ?? ''),
      'data-side-item': String(row.id ?? ''),
      onClick: onOpen === undefined ? undefined : () => onOpen(row.id),
    },
    h('span', { className: 'lead' }, h('i', { className: `ndot ${kind === 'done' ? 'ok' : 'wait'}`, 'aria-hidden': 'true' })),
    h('span', { className: 'ttl' }, String(row.title ?? '')),
    h('span', { className: 'meta' }, String(row.meta ?? ''))))
}
  const renderNeedCard = function renderNeedCard(h, state, opts) {
  const options = opts ?? {}
  const need = state?.need ?? needSummary(undefined)
  const open = state?.open?.need !== false
  const children = [renderCardHeader(h, {
    key: 'need',
    label: '需要你',
    dot: 'wait',
    count: need.total,
    open,
    onToggle: options.onToggle === undefined ? undefined : () => options.onToggle('need'),
  })]
  if (open) {
    const body = []
    if (need.pending.length > 0) {
      body.push(h('div', { key: 'sub-pending', className: 'need-sub' }, '待我处理', h('span', { className: 'n' }, String(need.pending.length))))
      for (const item of need.pending) body.push(renderNeedRow(h, item, 'wait', options.onOpenNeed))
    }
    if (need.done.length > 0) {
      body.push(h('div', { key: 'sub-done', className: 'need-sub' }, '已完成未查看', h('span', { className: 'n' }, String(need.done.length))))
      for (const item of need.done) body.push(renderNeedRow(h, item, 'done', options.onOpenNeed))
    }
    if (need.total === 0) body.push(h('div', { key: 'empty', className: 'side-empty' }, '暂时没有等你处理的事'))
    children.push(h('div', { key: 'body', className: 'card-body' }, ...body))
  }
  return h('section', { className: 'side-card side-card--need', 'aria-label': '需要你' }, ...children)
}
  const renderSessionRow = function renderSessionRow(h, session, opts) {
  const options = opts ?? {}
  const row = session ?? {}
  const active = row.id !== undefined && row.id === options.activeId
  return h('div', { key: String(row.id ?? ''), className: `row${options.child === true ? ' child' : ''}${active ? ' is-on' : ''}` },
    h('button', {
      type: 'button',
      className: 'row-main',
      title: String(row.title ?? ''),
      'data-session-id': String(row.id ?? ''),
      onClick: options.onOpenSession === undefined ? undefined : () => options.onOpenSession(row.id),
    },
    h('span', { className: 'lead' }),
    h('span', { className: 'ttl' }, String(row.title ?? ''))),
    h('span', { className: 'meta' }, h('span', { className: 'when' }, String(row.meta ?? ''))))
}
  const renderWorkspaceRow = function renderWorkspaceRow(h, workspace, opts) {
  const options = opts ?? {}
  const ws = workspace ?? {}
  const open = options.open !== false
  return h('div', { className: `row ws-row${open ? ' open' : ''}` },
    h('button', {
      type: 'button',
      className: 'row-main',
      'aria-expanded': open,
      title: String(ws.cwd ?? ws.name ?? ''),
      'data-workspace-id': String(ws.id ?? ''),
      onClick: options.onToggleWorkspace === undefined ? undefined : () => options.onToggleWorkspace(ws.id),
    },
    h('span', { className: 'lead' }, sidebarIcon(h, open ? 'folderOpen' : 'folder')),
    h('span', { className: 'ttl' }, String(ws.name ?? ws.cwd ?? ''))))
}
  const renderWorkspaceCard = function renderWorkspaceCard(h, state, opts) {
  const options = opts ?? {}
  const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : []
  const open = state?.open?.workspaces !== false
  const collapsedIds = options.collapsedWorkspaces ?? {}
  const children = [renderCardHeader(h, {
    key: 'workspaces',
    label: '工作区',
    dot: 'accent',
    count: workspaces.length,
    open,
    onToggle: options.onToggle === undefined ? undefined : () => options.onToggle('workspaces'),
  })]
  if (open) {
    const body = []
    if (workspaces.length === 0) body.push(h('div', { key: 'empty', className: 'side-empty' }, '还没有绑定目录的工作区'))
    for (const workspace of workspaces) {
      const wsOpen = collapsedIds[workspace.id] !== true
      const rows = [renderWorkspaceRow(h, workspace, {
        open: wsOpen,
        onToggleWorkspace: options.onToggleWorkspace,
      })]
      if (wsOpen) {
        for (const session of workspace.sessions ?? []) {
          rows.push(renderSessionRow(h, session, { child: true, activeId: state?.activeId, onOpenSession: options.onOpenSession }))
        }
      }
      body.push(h('div', { key: String(workspace.id ?? ''), className: 'ws-group' }, ...rows))
    }
    children.push(h('div', { key: 'body', className: 'card-body' }, ...body))
  }
  return h('section', { className: 'side-card side-card--workspaces', 'aria-label': '工作区' }, ...children)
}
  const renderSidebarTaskCard = function renderSidebarTaskCard(h, state, opts) {
  const options = opts ?? {}
  const tasks = Array.isArray(state?.tasks) ? state.tasks : []
  const open = state?.open?.tasks !== false
  const children = [renderCardHeader(h, {
    key: 'tasks',
    label: '任务',
    dot: 'muted',
    count: tasks.length,
    open,
    onToggle: options.onToggle === undefined ? undefined : () => options.onToggle('tasks'),
  })]
  if (open) {
    const body = []
    if (tasks.length === 0) body.push(h('div', { key: 'empty', className: 'side-empty' }, '临时会话放这里，不绑目录。'))
    for (const session of tasks) {
      body.push(renderSessionRow(h, session, { activeId: state?.activeId, onOpenSession: options.onOpenSession }))
    }
    children.push(h('div', { key: 'body', className: 'card-body' }, ...body))
  }
  return h('section', { className: 'side-card side-card--tasks', 'aria-label': '任务' }, ...children)
}
  const renderSidebar = function renderSidebar(h, state, options) {
  const opts = options ?? {}
  const head = [
    h('h2', { key: 'title' }, '会话'),
    opts.onCollapse === undefined
      ? null
      : h('button', {
        key: 'collapse',
        type: 'button',
        className: 'icon-btn side-collapse',
        'aria-label': '收起侧栏',
        'data-side-action': 'collapse',
        onClick: opts.onCollapse,
      }, sidebarIcon(h, 'sidebar')),
  ].filter((node) => node !== null)
  return h('div', { className: 'launcher-sidebar__inner' },
    h('div', { className: 'side-h' }, ...head),
    h('div', { className: 'side-scroll', 'data-side-scroll': 'true' },
      renderNeedCard(h, state, opts),
      renderWorkspaceCard(h, state, opts),
      renderSidebarTaskCard(h, state, opts)))
}
  // #endregion sidebar-from-lib

  // #region dock-settings-from-lib
  // 本段由 tools/sync-contract.mjs 从 lib/dock-settings.js 生成，勿手改；
  // 漂移由 test/dock-settings.test.mjs 与同步检查挡住。
  const DOCK_TABS = [{"id":"review","label":"审阅","icon":"file","badge":3},{"id":"files","label":"文件","icon":"folder","badge":0},{"id":"term","label":"终端","icon":"terminal","badge":0},{"id":"tasks","label":"任务","icon":"target","badge":2},{"id":"side","label":"侧聊","icon":"message","badge":0}]
  const DOCK_TAB_IDS = ["review","files","term","tasks","side"]
  const DOCK_WIDTHS = {"min":320,"max":520,"default":380,"hideBelow":1020}
  const DOCK_DEMO = {"diff":[{"file":"dsh-ui-merged.html","add":218,"del":0,"staged":false,"lines":[["","  <!doctype html>"],["","  <html lang=\"zh-CN\" data-theme=\"dark\">"],["+","  <link rel=\"stylesheet\" href=\"tokens.css\">"],["+","  <script src=\"shell.js\"></script>"],["","  </html>"]]},{"file":"tokens.css","add":64,"del":12,"staged":false,"lines":[["-","  --bg:#eeeae0;"],["+","  --bg:#121316;"],["-","  --accent:#3a55c8;"],["+","  --accent:#93a8ff;"]]}],"files":[{"d":0,"n":"dsh-launcher","t":"dir"},{"d":1,"n":"dsh-ui-merged.html","t":"file","chg":true},{"d":1,"n":"tokens.css","t":"file","chg":true},{"d":1,"n":"shell.js","t":"file"},{"d":1,"n":"notes","t":"dir"},{"d":2,"n":"fusion.md","t":"file","chg":true}],"fileSel":0,"term":[["p","yuzhou@mac-mini  ~/Pod"],["o","git status --short"],["o"," M dsh-ui-merged.html"],["o"," M tokens.css"],["ok","✓ 42 passing（演示）"]],"tasks":[{"id":"t1","t":"左栏按工作区 / 会话分组","who":"UI-UX 设计师","col":"doing","sub":"等用户点头"},{"id":"t2","t":"融合版：对话流组件移植","who":"研发工程师","col":"doing","sub":"接口已定"},{"id":"t3","t":"图标声明表与兜底链","who":"UI-UX 设计师","col":"todo","sub":"没声明的用兜底"},{"id":"t4","t":"日夜两套对比度校对","who":"UI-UX 设计师","col":"done","sub":"已交付"}],"side":[{"me":false,"t":"这个侧聊是独立上下文的，不会污染主会话。"},{"me":true,"t":"右栏审阅的 diff 卡片按文件分块，头行带 +N。"}]}
  const SET_GROUPS = [{"id":"general","label":"常用"},{"id":"model","label":"模型"},{"id":"ext","label":"扩展"},{"id":"conn","label":"连接"},{"id":"data","label":"数据"},{"id":"adv","label":"高级"}]
  const SET_SECTIONS = {"general":[{"title":"外观","rows":[{"id":"theme","label":"主题","hint":"日夜两套对比度都过 AA","control":{"type":"segmented","key":"theme","options":[{"id":"light","label":"日间"},{"id":"dark","label":"夜间"}]}},{"id":"density","label":"密度","hint":"紧凑省 6px 行高，适合长对话","control":{"type":"segmented","key":"density","options":[{"id":"cozy","label":"舒适"},{"id":"compact","label":"紧凑"}]}},{"id":"dock","label":"右栏","hint":"审阅、文件、终端、任务、侧聊","control":{"type":"toggle","key":"dock","onLabel":"关右栏","offLabel":"开右栏"}}]},{"title":"快捷键","rows":[{"id":"shortcut-0","label":"命令面板","control":{"type":"kbd","value":"⌘K"}},{"id":"shortcut-1","label":"右栏","control":{"type":"kbd","value":"⌘J"}},{"id":"shortcut-2","label":"分屏","control":{"type":"kbd","value":"⌘D"}},{"id":"shortcut-3","label":"日间 / 夜间","control":{"type":"kbd","value":"⌘⇧L"}},{"id":"shortcut-4","label":"设置","control":{"type":"kbd","value":"⌘,"}},{"id":"shortcut-5","label":"关掉浮层","control":{"type":"kbd","value":"Esc"}}]}],"model":[{"title":"模型","rows":[{"id":"model","label":"模型","control":{"type":"static","key":"model","value":"deepseek · routing group"}},{"id":"reason","label":"推理等级","control":{"type":"static","key":"reason","value":"Default"}},{"id":"team","label":"启用智能体团队协作","hint":"允许多个子代理分工协作，主代理汇总","control":{"type":"switch","key":"team"}}]},{"title":"其他","rows":[{"id":"submodel","label":"子代理模型","hint":"拆活时用哪条路由","control":{"type":"static","value":"同主模型"}},{"id":"compact","label":"上下文压缩","hint":"到 85% 提醒、95% 强制","control":{"type":"static","value":"自动"}}]}],"ext":[{"title":"扩展","rows":[{"id":"skill","label":"Skill 管理","hint":"装好的 Skill、从 GitHub 或文件夹安装","control":{"type":"nav","target":"ext-skill","label":"打开"}},{"id":"mcp","label":"MCP 管理","hint":"服务器、工具数、连接状态","control":{"type":"nav","target":"ext-mcp","label":"打开"}},{"id":"ssh","label":"SSH 管理","hint":"主机、端口转发","control":{"type":"nav","target":"ext-ssh","label":"打开"}},{"id":"archive","label":"归档管理","hint":"归档的会话与任务","control":{"type":"nav","target":"ext-archive","label":"打开"}}]}],"conn":[{"title":"连接","rows":[{"id":"net","label":"网络","hint":"直连，未设代理","control":{"type":"static","value":"正常"}},{"id":"proxy","label":"代理","hint":"HTTP / SOCKS 代理","control":{"type":"static","value":"未设置"}},{"id":"ssh","label":"SSH 主机","hint":"已保存 3 台","control":{"type":"nav","target":"ext-ssh","label":"管理"}}]}],"data":[{"title":"数据","rows":[{"id":"whitelist","label":"目录白名单","hint":"白名单内不触发审批","control":{"type":"static","value":"~/Pod · ~/Pod/tasks"}},{"id":"archive","label":"归档","hint":"归档的会话与任务","control":{"type":"nav","target":"ext-archive","label":"打开"}},{"id":"plugindata","label":"插件数据","hint":"插件自己的设置与缓存","control":{"type":"static","value":"随插件管理"}}]}],"adv":[{"title":"高级","rows":[{"id":"revert","label":"回退原生 UI","hint":"移除 profile 依赖并重启；审批与审计不丢","control":{"type":"rollback","key":"revertNative"}},{"id":"contract","label":"契约自检","hint":"接管前比对宿主版本与槽集合","control":{"type":"static","value":"宿主 rc.4 / 声明 rc.5"}},{"id":"update","label":"检查更新","hint":"本版不接更新通道","control":{"type":"disabled","label":"检查","reason":"本版不接更新通道"}}]}]}
  const SET_SHORTCUTS = [{"keys":"⌘K","label":"命令面板"},{"keys":"⌘J","label":"右栏"},{"keys":"⌘D","label":"分屏"},{"keys":"⌘⇧L","label":"日间 / 夜间"},{"keys":"⌘,","label":"设置"},{"keys":"Esc","label":"关掉浮层"}]
  const DOCK_ICONS = {"file":"<path d=\"M14 3v4a1 1 0 0 0 1 1h4\" /><path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\" />","folder":"<path d=\"M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2\" />","terminal":"<path d=\"M8 9l3 3l-3 3\" /><path d=\"M13 15l3 0\" /><path d=\"M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z\" />","target":"<path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" /><path d=\"M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0\" /><path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />","message":"<path d=\"M8 9h8\" /><path d=\"M8 13h6\" /><path d=\"M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z\" />","git":"<path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" /><path d=\"M12 3l7 7l-7 7l-7 -7z\" />","check":"<path d=\"M5 12l5 5l10 -10\" />","plus":"<path d=\"M12 5l0 14\" /><path d=\"M5 12l14 0\" />","x":"<path d=\"M18 6l-12 12\" /><path d=\"M6 6l12 12\" />"}
  const DOCK_SETTINGS_CSS = ".launcher-dock-tabs{display:flex;align-items:center;gap:1px;padding:4px 8px 0;border-bottom:1px solid var(--l-line);overflow-x:auto;scrollbar-width:none;flex:0 0 auto}\n.launcher-dock-tabs__grow{flex:1}\n.launcher-dock-tab{display:inline-flex;align-items:center;gap:4px;padding:8px 7px;font:inherit;font-size:12px;color:var(--l-ink3);background:transparent;border:0;border-bottom:2px solid transparent;white-space:nowrap;cursor:pointer}\n.launcher-dock-tab:hover{color:var(--l-ink)}\n.launcher-dock-tab.on{color:var(--l-ink);border-bottom-color:var(--l-accent);font-weight:500}\n.launcher-dock-tab:focus-visible{outline:2px solid var(--l-accent);outline-offset:-2px}\n.launcher-dock-tab svg{width:15px;height:15px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-dock-tab__n{font-size:11px;line-height:1;background:var(--l-surface3);border-radius:4px;padding:2px 3px;color:var(--l-ink3)}\n.launcher-dock-tab--icon{margin-left:2px}\n.launcher-dock__panel{flex:1;min-height:0;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}\n.launcher-dock__host{display:none}\n.launcher-dock-sum{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--l-ink2);padding:2px 2px 4px}\n.launcher-dock-sum svg{width:14px;height:14px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-dock-sum__g{font-size:11px;color:var(--l-ink4)}\n.launcher-dock-sum__cg{margin-left:auto;display:flex;gap:6px;font-size:11px}\n.launcher-git-add{color:var(--l-green)}\n.launcher-git-del{color:var(--l-red)}\n.launcher-dock-empty{display:grid;gap:4px;place-items:center;padding:18px 8px;border:1px dashed var(--l-line2);border-radius:var(--l-radius-md);color:var(--l-ink3);font-size:12px}\n.launcher-dock-foot{border-top:1px solid var(--l-line);padding:8px 2px 2px;display:flex;gap:6px;align-items:center;margin-top:auto}\n.launcher-dock-foot__grow{flex:1}\n.launcher-dock-foot__note{font-size:11px;color:var(--l-ink4)}\n.launcher-diff{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);overflow:hidden}\n.launcher-diff-h{display:flex;align-items:center;gap:6px;padding:6px 9px;background:var(--l-surface2);font-size:12px}\n.launcher-diff-h svg{width:13px;height:13px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-diff-h__f{font-family:var(--font-mono,monospace);font-size:11px;color:var(--l-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.launcher-diff-h__a{color:var(--l-green);font-size:11px;margin-left:auto}\n.launcher-diff-h__d{color:var(--l-red);font-size:11px}\n.launcher-diff-line{display:grid;grid-template-columns:26px 12px minmax(0,1fr);font-family:var(--font-mono,monospace);font-size:11px;line-height:1.7}\n.launcher-diff-line__ln{text-align:right;color:var(--l-ink4);padding-right:6px;user-select:none}\n.launcher-diff-line__sg{text-align:center;user-select:none}\n.launcher-diff-line__cd{overflow:hidden;text-overflow:ellipsis;white-space:pre;padding-right:8px}\n.launcher-diff-line.add{background:var(--l-accentSoft);color:var(--l-ink)}\n.launcher-diff-line.del{background:var(--l-surface2);color:var(--l-ink3)}\n.launcher-tree{display:grid;gap:1px;font-size:12px}\n.launcher-tree-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:var(--l-radius-xs);color:var(--l-ink2);width:100%;text-align:left;background:transparent;border:0;cursor:pointer;font:inherit}\n.launcher-tree-row:hover{background:var(--l-hover)}\n.launcher-tree-row.on{background:var(--l-surface3);color:var(--l-ink)}\n.launcher-tree-row:focus-visible{outline:2px solid var(--l-accent);outline-offset:-2px}\n.launcher-tree-row svg{width:14px;height:14px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}\n.launcher-tree-row__n{font-family:var(--font-mono,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.launcher-tree-row__d{margin-left:auto;font-size:11px;color:var(--l-ink4)}\n.launcher-term{background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-md);padding:9px 10px;font-family:var(--font-mono,monospace);font-size:12px;line-height:1.7;min-height:150px;max-height:340px;overflow:auto;white-space:pre-wrap;color:var(--l-ink2);margin:0}\n.launcher-term__p{color:var(--l-accent)}\n.launcher-term__ok{color:var(--l-green)}\n.launcher-term__er{color:var(--l-red)}\n.launcher-term-in{display:flex;gap:6px;margin-top:7px;align-items:center}\n.launcher-term-in__prompt{color:var(--l-accent);font-family:var(--font-mono,monospace)}\n.launcher-term-in__input{flex:1;min-width:0;background:var(--l-surface);border:1px solid var(--l-line);border-radius:var(--l-radius-sm);padding:0 8px;height:28px;font-family:var(--font-mono,monospace);font-size:12px;outline:none;color:var(--l-ink)}\n.launcher-term-in__input:focus{border-color:var(--l-accent)}\n.launcher-chat-mini{display:grid;gap:7px}\n.launcher-bub{max-width:88%;padding:6px 10px;border-radius:var(--l-radius-md);font-size:12px;line-height:1.5;background:var(--l-surface2);border:1px solid var(--l-line);color:var(--l-ink)}\n.launcher-bub.me{justify-self:end;background:var(--l-accent);color:var(--l-onAccent);border-color:transparent}\n.launcher-mini{background:var(--l-surface);border:1px solid var(--l-line);border-radius:var(--l-radius-md);padding:9px 10px;display:grid;gap:2px}\n.launcher-mini__t{font-size:13px;line-height:1.4}\n.launcher-mini__s{font-size:11px;color:var(--l-ink3);display:flex;gap:5px;align-items:center;flex-wrap:wrap}\n.launcher-tag{font-size:11px;border-radius:4px;padding:0 4px;background:var(--l-surface3);color:var(--l-ink3)}\n.launcher-tag.ok{background:var(--l-accentSoft);color:var(--l-green)}\n.launcher-tag.acc{background:var(--l-accentSoft);color:var(--l-accent)}\n.launcher-seg{height:24px;padding:0 8px;border:1px solid var(--l-line);border-radius:var(--l-radius-xs);font:inherit;font-size:12px;color:var(--l-ink2);background:var(--l-surface);cursor:pointer}\n.launcher-seg:hover{border-color:var(--l-line2);color:var(--l-ink)}\n.launcher-seg:focus-visible{outline:2px solid var(--l-accent);outline-offset:1px}\n.launcher-seg.on{background:var(--l-accentSoft);border-color:transparent;color:var(--l-accent);font-weight:500}\n.launcher-seg--primary{background:var(--l-accent);border-color:transparent;color:var(--l-onAccent)}\n.launcher-seg--danger{color:var(--l-red);border-color:var(--l-red)}\n.launcher-seg[disabled]{opacity:.5;cursor:not-allowed}\n.launcher-settings{position:fixed;inset:0;z-index:46;background:var(--l-bg);color:var(--l-ink);display:flex;flex-direction:column;overflow:hidden}\n.launcher-settings__head{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--l-line);background:var(--l-bg2)}\n.launcher-settings__title{font-size:15px;font-weight:600;margin:0}\n.launcher-settings__close{margin-left:auto;border:0;background:transparent;color:var(--l-ink3);font-size:16px;cursor:pointer;width:28px;height:28px;border-radius:var(--l-radius-xs)}\n.launcher-settings__close:hover{background:var(--l-hover);color:var(--l-ink)}\n.launcher-settings__close:focus-visible{outline:2px solid var(--l-accent)}\n.launcher-settings__tabs{display:flex;gap:2px;padding:0 14px;border-bottom:1px solid var(--l-line);overflow-x:auto;background:var(--l-bg)}\n.launcher-settings__tab{padding:8px 10px;font:inherit;font-size:12px;color:var(--l-ink3);background:transparent;border:0;border-bottom:2px solid transparent;white-space:nowrap;cursor:pointer}\n.launcher-settings__tab:hover{color:var(--l-ink)}\n.launcher-settings__tab.on{color:var(--l-ink);border-bottom-color:var(--l-accent);font-weight:500}\n.launcher-settings__tab:focus-visible{outline:2px solid var(--l-accent);outline-offset:-2px}\n.launcher-settings__body{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;max-width:720px;width:100%;margin:0 auto}\n.launcher-settings__card{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-panel);padding:4px 12px}\n.launcher-settings__colh{font-size:11px;letter-spacing:.04em;color:var(--l-ink4);text-transform:uppercase;padding:8px 0 4px}\n.launcher-set-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--l-line);font-size:13px}\n.launcher-set-row:last-child{border-bottom:0}\n.launcher-set-row__lbl{display:grid;gap:1px;min-width:0}\n.launcher-set-row__hint{font-size:11px;color:var(--l-ink3)}\n.launcher-set-row__ctl{margin-left:auto;display:flex;gap:4px;align-items:center;flex:none}\n.launcher-static{font-size:12px;color:var(--l-ink3)}\n.launcher-kbd{font-family:var(--font-mono,monospace);font-size:11px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:4px;padding:1px 5px;color:var(--l-ink2)}\n.launcher-switch{width:38px;height:24px;border-radius:12px;border:1px solid var(--l-line2);background:var(--l-surface3);position:relative;cursor:pointer;padding:0}\n.launcher-switch.on{background:var(--l-accent);border-color:transparent}\n.launcher-switch:focus-visible{outline:2px solid var(--l-accent);outline-offset:1px}\n.launcher-switch__dot{position:absolute;top:3px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--l-surface);transition:left .12s ease}\n.launcher-switch.on .launcher-switch__dot{left:19px}\n.launcher-set-row--block{flex-direction:column;align-items:stretch;gap:4px}\n.launcher-set-row--block .launcher-set-row__ctl{margin-left:0;display:block}\n.launcher-rollback{display:grid;gap:7px;padding:2px 0 6px}\n.launcher-rollback__note{margin:0;font-size:12px;color:var(--l-ink2);line-height:1.5}\n.launcher-rollback__steps{margin:0;padding-left:18px;display:grid;gap:2px;font-size:12px;color:var(--l-ink3)}\n.launcher-rollback__cmd{margin:0;padding:8px 10px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-sm);font-family:var(--font-mono,monospace);font-size:11px;line-height:1.6;color:var(--l-ink);white-space:pre-wrap;word-break:break-all;user-select:all}\n.launcher-rollback__actions{display:flex;align-items:center;gap:8px}\n.launcher-rollback__status{font-size:11px;color:var(--l-green)}\n.launcher-rollback__runbook{margin:0;font-size:11px;color:var(--l-ink4)}\n.launcher-rollback__runbook code{font-family:var(--font-mono,monospace);font-size:11px;background:var(--l-surface2);border-radius:4px;padding:1px 4px}\n.launcher-shell[data-density=\"compact\"]{--l-row:26px}\n.launcher-shell[data-density=\"compact\"] .launcher-dock__panel{gap:5px;padding:7px 10px}\n.launcher-shell[data-density=\"compact\"] .launcher-set-row{padding:6px 0}\n.launcher-shell[data-density=\"compact\"] .launcher-mini{padding:6px 8px}"
  const diffSummary = function diffSummary(diff) {
  const list = Array.isArray(diff) ? diff : []
  let a = 0
  let d = 0
  for (const file of list) {
    a += Number(file?.add) || 0
    d += Number(file?.del) || 0
  }
  return { n: list.length, a, d }
}
  const dockIcon = function dockIcon(h, name) {
  const body = DOCK_ICONS[name] ?? ''
  return h('svg', { viewBox: '0 0 24 24', className: 'launcher-ic', 'aria-hidden': 'true', focusable: 'false', dangerouslySetInnerHTML: { __html: body } })
}
  const dockWidthFor = function dockWidthFor({ viewportWidth, requestedWidth, open = true, min = DOCK_WIDTHS.min, max = DOCK_WIDTHS.max, hideBelow = DOCK_WIDTHS.hideBelow } = {}) {
  const viewport = Number(viewportWidth)
  const vw = Number.isFinite(viewport) && viewport > 0 ? viewport : 1440
  if (open !== true || vw < hideBelow) return 0
  // 视口预算：给主区至少留 816（1440 参考下 56+280+480+380=1196，余量给间距）
  const maxFor = Math.max(min, Math.min(max, Math.round(vw - 816)))
  const wanted = Number.isFinite(Number(requestedWidth)) ? Math.round(Number(requestedWidth)) : DOCK_WIDTHS.default
  return Math.max(min, Math.min(maxFor, wanted))
}
  const dockColumnsFor = function dockColumnsFor({ viewportWidth, dockWidth = 0, sidebarCollapsed = false } = {}) {
  return shellColumns({ viewportWidth, dockWidth, sidebarCollapsed })
}
  const applySetting = function applySetting(values, action) {
  const base = values ?? {}
  const next = {
    theme: base.theme === 'dark' ? 'dark' : 'light',
    density: base.density === 'compact' ? 'compact' : 'cozy',
    dockOpen: base.dockOpen === true,
    team: base.team === true,
  }
  if (action === null || typeof action !== 'object') return { values: next, effect: null }
  if (action.type === 'segmented') {
    if (action.key === 'theme') {
      const value = action.value === 'dark' ? 'dark' : 'light'
      return { values: { ...next, theme: value }, effect: { type: 'theme', value } }
    }
    if (action.key === 'density') {
      const value = action.value === 'compact' ? 'compact' : 'cozy'
      return { values: { ...next, density: value }, effect: { type: 'density', value } }
    }
    return { values: next, effect: null }
  }
  if (action.type === 'toggle' && action.key === 'dock') {
    const value = !next.dockOpen
    return { values: { ...next, dockOpen: value }, effect: { type: 'dock', value } }
  }
  if (action.type === 'switch' && action.key === 'team') {
    const value = !next.team
    return { values: { ...next, team: value }, effect: { type: 'team', value } }
  }
  if (action.type === 'nav') return { values: next, effect: { type: 'nav', target: String(action.target ?? '') } }
  if (action.type === 'copyRollback') return { values: next, effect: { type: 'copyRollback' } }
  if (action.type === 'danger') return { values: next, effect: { type: 'danger', key: String(action.key ?? '') } }
  return { values: next, effect: null }
}
  const renderDockTabs = function renderDockTabs(h, options) {
  const opts = options ?? {}
  const tabs = Array.isArray(opts.tabs) ? opts.tabs : []
  const children = []
  for (const tab of tabs) {
    const badge = Number(tab.badge) > 0 ? String(tab.badge) : ''
    children.push(h('button', {
      key: tab.id,
      type: 'button',
      role: 'tab',
      className: `launcher-dock-tab${tab.id === opts.active ? ' on' : ''}`,
      'data-dock-tab': tab.id,
      'aria-selected': tab.id === opts.active,
      title: tab.label,
      onClick: () => { if (typeof opts.onSelect === 'function') opts.onSelect(tab.id) },
    },
    dockIcon(h, tab.icon),
    h('span', { className: 'launcher-dock-tab__label' }, tab.label),
    badge === '' ? null : h('span', { className: 'launcher-dock-tab__n' }, badge)))
  }
  children.push(h('span', { key: 'grow', className: 'launcher-dock-tabs__grow' }))
  children.push(h('button', {
    key: 'collapse',
    type: 'button',
    className: 'launcher-dock-tab launcher-dock-tab--icon',
    'data-dock-action': 'collapse',
    'aria-label': '收起右栏',
    title: '收起 ⌘J',
    onClick: () => { if (typeof opts.onCollapse === 'function') opts.onCollapse() },
  }, dockIcon(h, 'x')))
  return h('div', { className: 'launcher-dock-tabs', role: 'tablist', 'aria-label': '右栏面板' }, ...children)
}
  const renderDockPanel = function renderDockPanel(h, options) {
  const opts = options ?? {}
  const data = opts.data ?? {}
  const requested = opts.tab
  const tab = DOCK_TAB_IDS.includes(requested) ? requested : 'review'
  const emit = (action) => { if (typeof opts.onAction === 'function') opts.onAction(action) }
  const body = []

  const summary = diffSummary(data.diff)
  const sum = (icon, title, note, extra) => h('div', { className: 'launcher-dock-sum', key: 'sum' },
    dockIcon(h, icon),
    h('b', null, title),
    h('span', { className: 'launcher-dock-sum__g' }, note),
    extra ?? null)

  if (tab === 'review') {
    body.push(sum('git', '未提交的改动', `${summary.n} 个文件`,
      h('span', { className: 'launcher-dock-sum__cg' },
        h('span', { className: 'launcher-git-add' }, `+${summary.a}`),
        h('span', { className: 'launcher-git-del' }, `−${summary.d}`))))
    const diff = Array.isArray(data.diff) ? data.diff : []
    if (diff.length === 0) {
      body.push(h('div', { className: 'launcher-dock-empty', key: 'empty' }, '都提交了', h('p', null, '再看一遍 diff 就点上面的「文件」。')))
    }
    for (const file of diff) {
      const head = h('div', { className: 'launcher-diff-h', key: `h-${file.file}` },
        dockIcon(h, 'file'),
        h('span', { className: 'launcher-diff-h__f', title: file.file }, file.file),
        h('span', { className: 'launcher-diff-h__a' }, `+${file.add}`),
        h('span', { className: 'launcher-diff-h__d' }, `−${file.del}`),
        file.staged === true ? h('span', { className: 'launcher-tag ok', style: { marginLeft: 'auto' } }, '已暂存') : null)
      const lines = (file.lines ?? []).map((line, index) => h('div', {
        key: `l-${index}`,
        className: `launcher-diff-line${line[0] === '+' ? ' add' : (line[0] === '-' ? ' del' : '')}`,
      },
      h('span', { className: 'launcher-diff-line__ln' }, String(index + 1)),
      h('span', { className: 'launcher-diff-line__sg' }, line[0] || ' '),
      h('span', { className: 'launcher-diff-line__cd' }, String(line[1] ?? '').trim())))
      body.push(h('div', { className: 'launcher-diff', key: `d-${file.file}` }, head, ...lines))
    }
    body.push(h('div', { className: 'launcher-dock-foot', key: 'foot' },
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'stage' }) }, '全部暂存'),
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'revert' }) }, '还原'),
      h('span', { className: 'launcher-dock-foot__grow' }),
      h('button', { type: 'button', className: 'launcher-seg launcher-seg--primary', onClick: () => emit({ type: 'commit' }) }, '提交…')))
  } else if (tab === 'files') {
    const files = Array.isArray(data.files) ? data.files : []
    const sel = Number.isFinite(Number(data.fileSel)) ? Number(data.fileSel) : 0
    body.push(sum('folder', 'dsh-launcher', `${files.filter((file) => file.chg === true).length} 处改动`))
    body.push(h('div', { className: 'launcher-tree', key: 'tree' },
      files.map((file, index) => h('button', {
        key: `f-${index}`,
        type: 'button',
        className: `launcher-tree-row${sel === index ? ' on' : ''}`,
        style: { paddingLeft: `${6 + file.d * 12}px` },
        title: file.n,
        onClick: () => emit({ type: 'fileSel', index }),
      },
      dockIcon(h, file.t === 'dir' ? 'folder' : 'file'),
      h('span', { className: 'launcher-tree-row__n' }, file.n),
      file.chg === true ? h('span', { className: 'launcher-tree-row__d' }, 'M') : null))))
    const selected = files[sel] ?? files[0]
    const preview = ['<!doctype html>', '<html lang="zh-CN">', '  <link rel="stylesheet">', '</html>']
    body.push(h('div', { className: 'launcher-diff', key: 'preview' },
      h('div', { className: 'launcher-diff-h' }, dockIcon(h, 'file'), h('span', { className: 'launcher-diff-h__f' }, selected?.n ?? '—')),
      preview.map((line, index) => h('div', { key: `p-${index}`, className: `launcher-diff-line${index === 2 ? ' add' : ''}` },
        h('span', { className: 'launcher-diff-line__ln' }, String(index + 1)),
        h('span', { className: 'launcher-diff-line__sg' }, index === 2 ? '+' : ' '),
        h('span', { className: 'launcher-diff-line__cd' }, line)))))
  } else if (tab === 'term') {
    const lines = Array.isArray(data.term) ? data.term : []
    body.push(h('pre', { className: 'launcher-term', key: 'out' },
      lines.map((line, index) => h('span', { key: `t-${index}`, className: `launcher-term__${line[0] ?? 'o'}` }, `${line[1] ?? ''}\n`))))
    body.push(h('div', { className: 'launcher-term-in', key: 'in' },
      h('span', { className: 'launcher-term-in__prompt' }, '$'),
      h('input', {
        className: 'launcher-term-in__input',
        'aria-label': '终端输入',
        placeholder: '敲命令，Enter 执行（演示）',
        value: data.termIn ?? '',
        onChange: (event) => emit({ type: 'termIn', value: event?.target?.value }),
      }),
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'termRun' }) }, '执行')))
  } else if (tab === 'tasks') {
    const tasks = Array.isArray(data.tasks) ? data.tasks : []
    body.push(sum('target', '任务', `${tasks.length} 个`))
    for (const task of tasks) {
      body.push(h('div', { className: 'launcher-mini', key: task.id },
        h('div', { className: 'launcher-mini__t' }, task.t),
        h('div', { className: 'launcher-mini__s' },
          h('span', { className: 'launcher-mini__who' }, task.who),
          h('span', { className: `launcher-tag ${task.col === 'done' ? 'ok' : (task.col === 'doing' ? 'acc' : '')}` }, task.col === 'done' ? '完成' : (task.col === 'doing' ? '在做' : '待办'))),
        h('div', { className: 'launcher-mini__s' }, task.sub)))
    }
    body.push(h('div', { className: 'launcher-dock-foot', key: 'foot' },
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'newTask' }) }, '新建任务'),
      h('span', { className: 'launcher-dock-foot__grow' }),
      h('span', { className: 'launcher-dock-foot__note' }, `${tasks.filter((task) => task.col === 'doing').length} 个在做`)))
  } else {
    const messages = Array.isArray(data.side) ? data.side : []
    body.push(h('div', { className: 'launcher-chat-mini', key: 'chat' },
      messages.map((message, index) => h('div', { key: `b-${index}`, className: `launcher-bub${message.me === true ? ' me' : ''}` }, message.t))))
    body.push(h('div', { className: 'launcher-term-in', key: 'in' },
      h('input', {
        className: 'launcher-term-in__input',
        'aria-label': '侧聊输入',
        placeholder: '在这个分支里问…（上下文独立）',
        value: data.sideIn ?? '',
        onChange: (event) => emit({ type: 'sideIn', value: event?.target?.value }),
      }),
      h('button', { type: 'button', className: 'launcher-seg launcher-seg--primary', onClick: () => emit({ type: 'sideSend' }) }, '发')))
  }

  return h('div', { className: 'launcher-dock__panel', role: 'tabpanel', 'data-dock-tab': tab }, ...body)
}
  const renderSettings = function renderSettings(h, options) {
  const opts = options ?? {}
  const groups = Array.isArray(opts.groups) ? opts.groups : []
  const sectionsMap = opts.sections ?? {}
  const values = opts.values ?? {}
  const groupIds = groups.map((group) => group.id)
  const resolved = groupIds.includes(opts.active) ? opts.active : (groupIds[0] ?? 'general')
  const onGroup = typeof opts.onGroup === 'function' ? opts.onGroup : () => {}
  const onAction = typeof opts.onAction === 'function' ? opts.onAction : () => {}
  const onClose = typeof opts.onClose === 'function' ? opts.onClose : () => {}

  function renderControl(row) {
    const control = row.control ?? {}
    if (control.type === 'rollback') {
      // 回退入口：说明 + 三步命令 + 复制按钮。命令/说明/步骤都来自 rollbackSurface（单一真源），
      // 这里只负责把它们排成可读、可复制的块，不另抄一份命令字符串。
      const model = opts.rollback ?? {}
      const steps = Array.isArray(model.steps) ? model.steps : []
      const copied = model.copied === true
      return h('div', { key: control.key ?? 'rollback', className: 'launcher-rollback', 'data-rollback': control.key ?? 'revertNative' },
        h('p', { className: 'launcher-rollback__note', key: 'note' }, String(model.note ?? '')),
        h('ol', { className: 'launcher-rollback__steps', key: 'steps' },
          ...steps.map((step, index) => h('li', { key: `step-${index}` }, String(step)))),
        h('pre', { className: 'launcher-rollback__cmd', key: 'cmd', 'data-rollback-command': '' }, String(model.command ?? '')),
        h('div', { className: 'launcher-rollback__actions', key: 'actions' },
          h('button', {
            type: 'button',
            className: `launcher-seg${copied ? ' on' : ''}`,
            'data-copy-rollback': '',
            'aria-label': copied ? '回退命令已复制' : '复制回退命令',
            onClick: () => onAction({ type: 'copyRollback' }),
          }, copied ? (model.copiedLabel ?? '已复制') : (model.copyLabel ?? '复制命令')),
          h('span', { className: 'launcher-rollback__status', role: 'status', 'aria-live': 'polite' }, copied ? '已复制到剪贴板' : '')),
        h('p', { className: 'launcher-rollback__runbook', key: 'runbook' },
          '完整三态步骤与预期见 runbook：',
          h('code', null, String(model.runbook ?? ''))))
    }
    if (control.type === 'segmented') {
      const options = Array.isArray(control.options) ? control.options : []
      return options.map((option) => h('button', {
        key: option.id,
        type: 'button',
        className: `launcher-seg${values[control.key] === option.id ? ' on' : ''}`,
        'aria-pressed': values[control.key] === option.id,
        'data-control': control.key,
        'data-value': option.id,
        onClick: () => onAction({ type: 'segmented', key: control.key, value: option.id }),
      }, option.label))
    }
    if (control.type === 'toggle') {
      const on = control.key === 'dock' ? values.dockOpen === true : values[control.key] === true
      return h('button', {
        key: control.key,
        type: 'button',
        className: `launcher-seg${on ? ' on' : ''}`,
        'aria-pressed': on,
        'data-control': control.key,
        onClick: () => onAction({ type: 'toggle', key: control.key }),
      }, on ? (control.onLabel ?? '关') : (control.offLabel ?? '开'))
    }
    if (control.type === 'switch') {
      const on = values[control.key] === true
      return h('button', {
        key: control.key,
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        'aria-label': row.label,
        className: `launcher-switch${on ? ' on' : ''}`,
        'data-control': control.key,
        onClick: () => onAction({ type: 'switch', key: control.key }),
      }, h('span', { className: 'launcher-switch__dot' }))
    }
    if (control.type === 'static') {
      // 票 34：静态条目可绑定 values[key]（模型/推理等级读真实状态），没绑定就用固定文案。
      const bound = control.key !== undefined && Object.prototype.hasOwnProperty.call(values, control.key) ? values[control.key] : control.value
      return h('span', { className: 'launcher-static' }, String(bound ?? ''))
    }
    if (control.type === 'kbd') return h('kbd', { className: 'launcher-kbd' }, String(control.value ?? ''))
    if (control.type === 'nav') {
      return h('button', { key: 'nav', type: 'button', className: 'launcher-seg', 'data-target': control.target, onClick: () => onAction({ type: 'nav', target: control.target }) }, control.label ?? '打开')
    }
    if (control.type === 'danger') {
      return h('button', { key: 'danger', type: 'button', className: 'launcher-seg launcher-seg--danger', onClick: () => onAction({ type: 'danger', key: control.key }) }, control.label ?? '回退')
    }
    if (control.type === 'disabled') {
      return h('button', { key: 'disabled', type: 'button', className: 'launcher-seg', disabled: true, 'aria-disabled': 'true', title: control.reason ?? '' }, control.label ?? '检查')
    }
    return null
  }

  function renderRow(row, index) {
    const block = row.control?.type === 'rollback'
    return h('div', { className: `launcher-set-row${block ? ' launcher-set-row--block' : ''}`, key: row.id ?? `row-${index}` },
      h('span', { className: 'launcher-set-row__lbl' },
        h('span', { className: 'launcher-set-row__label' }, row.label),
        row.hint === undefined || row.hint === null ? null : h('span', { className: 'launcher-set-row__hint' }, row.hint)),
      h('span', { className: 'launcher-set-row__ctl' }, renderControl(row)))
  }

  const tabs = groups.map((group) => h('button', {
    key: group.id,
    type: 'button',
    role: 'tab',
    className: `launcher-settings__tab${group.id === resolved ? ' on' : ''}`,
    'aria-selected': group.id === resolved,
    'data-group': group.id,
    onClick: () => onGroup(group.id),
  }, group.label))

  const sectionsForGroup = Array.isArray(sectionsMap[resolved]) ? sectionsMap[resolved] : []
  const body = sectionsForGroup.map((section, sectionIndex) => {
    const rows = Array.isArray(section.rows) ? section.rows : []
    return h('section', { className: 'launcher-settings__card', key: `section-${sectionIndex}` },
      section.title === undefined || section.title === null ? null : h('div', { className: 'launcher-settings__colh' }, section.title),
      ...rows.map((row, index) => renderRow(row, index)))
  })

  return h('div', { className: 'launcher-settings', role: 'dialog', 'aria-modal': 'true', 'aria-label': '设置' },
    h('header', { className: 'launcher-settings__head' },
      h('h2', { className: 'launcher-settings__title' }, '设置'),
      h('button', { type: 'button', className: 'launcher-settings__close', 'aria-label': '关闭设置', title: '关闭', onClick: () => onClose() }, '✕')),
    h('div', { className: 'launcher-settings__tabs', role: 'tablist', 'aria-label': '设置分组' }, ...tabs),
    h('div', { className: 'launcher-settings__body' }, ...body))
}
  // #endregion dock-settings-from-lib

  // #region model-from-lib
  // 本段由 tools/sync-contract.mjs 从 lib/model-surface.js 生成，勿手改；
  // 漂移由 test/model-client.test.mjs 的同步检查挡住。
  const MODEL_GROUPS = [{"id":"deepseek","label":"DeepSeek","models":[{"id":"DeepSeek V3.2","name":"DeepSeek V3.2","note":"默认：长上下文、工具调得稳"},{"id":"DeepSeek V3.2 mini","name":"DeepSeek V3.2 mini","note":"便宜、快，适合小事"},{"id":"DeepSeek R1","name":"DeepSeek R1","note":"想久一点再答"}]},{"id":"routing","label":"路由组","models":[{"id":"deepseek 爽用 · routing group","name":"deepseek 爽用 · routing group","note":"Magpie 提供，按任务自动选型","routing":true}]}]
  const REASON_LEVELS = [{"id":"Default","label":"Default","hint":"默认档","note":"约 1 倍 token"},{"id":"Low","label":"Low","hint":"少想，快","note":"约 0.7 倍 token"},{"id":"High","label":"High","hint":"多查几轮再答","note":"约 1.5-2 倍 token"},{"id":"Max","label":"Max","hint":"最长推理，慢","note":"约 3 倍 token"}]
  const MODEL_ICONS = {"search":"<path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\" /><path d=\"M21 21l-6 -6\" />","check":"<path d=\"M5 12l5 5l10 -10\" />","chevronDown":"<path d=\"M6 9l6 6l6 -6\" />"}
  const DEFAULT_MODEL = "DeepSeek V3.2"
  const DEFAULT_REASON = "Default"
  const MODEL_IDS = ["DeepSeek V3.2","DeepSeek V3.2 mini","DeepSeek R1","deepseek 爽用 · routing group"]
  const REASON_IDS = ["Default","Low","High","Max"]
  const POPOVER_KINDS = {"model":"model","reason":"reason"}
  const MODEL_CSS = ".launcher-cm-modelwrap{display:inline-flex;align-items:center;gap:2px;margin-left:2px;flex:0 0 auto}\n.launcher-cm-t{display:inline-flex;align-items:center;min-height:24px;border:0;background:none;padding:2px 3px;border-radius:6px;font:inherit;font-size:13px;color:var(--l-ink3);cursor:pointer;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis}\n.launcher-cm-t:hover{background:var(--l-hover2);color:var(--l-ink2)}\n.launcher-cm-t:focus-visible{outline:2px solid var(--l-accent);outline-offset:1px}\n.launcher-cm-t.lev{color:var(--l-ink4)}\n.launcher-cm-t.chev{width:24px;height:24px;padding:0;display:grid;place-items:center;color:var(--l-ink4)}\n.launcher-cm-t.chev svg{width:14px;height:14px}\n.launcher-model-pop{position:absolute;z-index:130;min-width:240px;max-width:360px;max-height:56vh;overflow:auto;padding:6px;background:var(--l-panel);border:1px solid var(--l-line);border-radius:12px;box-shadow:0 14px 34px rgba(0,0,0,.16)}\n.launcher-pop-search{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--l-line);margin:-2px -2px 6px}\n.launcher-pop-search svg{width:14px;height:14px;color:var(--l-ink4)}\n.launcher-pop-search__in{flex:1;min-width:0;min-height:24px;border:0;background:none;font:inherit;font-size:13px;color:var(--l-ink);outline:none}\n.launcher-pop-g{padding:6px 8px 2px;font-size:11px;color:var(--l-ink4)}\n.launcher-pop-item{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 8px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--l-ink);text-align:left;cursor:pointer}\n.launcher-pop-item:hover,.launcher-pop-item:focus-visible{background:var(--l-hover2)}\n.launcher-pop-item.on{color:var(--l-accent)}\n.launcher-pop-item__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.launcher-pop-note{margin-left:auto;font-size:11px;color:var(--l-ink4)}\n.launcher-pop-item .chk{margin-left:auto;color:var(--l-accent);display:grid;place-items:center}\n.launcher-pop-item .chk svg{width:16px;height:16px}"
  const isDeepReason = function isDeepReason(reason) {
  return reason === 'High' || reason === 'Max'
}
  const createModelState = function createModelState(input = {}) {
  const model = MODEL_IDS.includes(input?.model) ? input.model : DEFAULT_MODEL
  const reason = REASON_IDS.includes(input?.reason) ? input.reason : DEFAULT_REASON
  return { model, reason, deep: isDeepReason(reason) }
}
  const pickModel = function pickModel(state, id) {
  const base = createModelState(state)
  return MODEL_IDS.includes(id) ? { ...base, model: id } : base
}
  const pickReason = function pickReason(state, id) {
  const base = createModelState(state)
  return REASON_IDS.includes(id) ? { ...base, reason: id, deep: isDeepReason(id) } : base
}
  const createPopoverState = function createPopoverState() {
  return { kind: null, query: '' }
}
  const openPopover = function openPopover(popover, kind) {
  if (kind !== POPOVER_KINDS.model && kind !== POPOVER_KINDS.reason) return createPopoverState()
  return { kind, query: '' }
}
  const closePopover = function closePopover() {
  return createPopoverState()
}
  const togglePopover = function togglePopover(popover, kind) {
  const current = popover?.kind ?? null
  if (current === kind) return closePopover()
  return openPopover(popover, kind)
}
  const setPopoverQuery = function setPopoverQuery(popover, query) {
  const kind = popover?.kind ?? null
  return { kind, query: typeof query === 'string' ? query : '' }
}
  const filterModelGroups = function filterModelGroups(query) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  return MODEL_GROUPS
    .map((group) => ({
      id: group.id,
      label: group.label,
      models: group.models.filter((model) => q === '' || model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q)),
    }))
    .filter((group) => group.models.length > 0)
}
  const modelTriggerLabel = function modelTriggerLabel(state) {
  const model = createModelState(state).model
  return model.toLowerCase()
}
  const modelMeta = function modelMeta(id) {
  for (const group of MODEL_GROUPS) {
    const found = group.models.find((model) => model.id === id)
    if (found !== undefined) return found
  }
  return null
}
  const modelRowLabel = function modelRowLabel(state) {
  const base = modelTriggerLabel(state)
  const meta = modelMeta(createModelState(state).model)
  return meta !== null && meta.routing === true ? base : `${base} · routing group`
}
  const popoverPlacement = function popoverPlacement(input = {}) {
  const margin = Number.isFinite(input?.margin) ? input.margin : 8
  const gap = Number.isFinite(input?.gap) ? input.gap : 8
  const vw = Number.isFinite(input?.viewportWidth) && input.viewportWidth > 0 ? input.viewportWidth : 0
  const vh = Number.isFinite(input?.viewportHeight) && input.viewportHeight > 0 ? input.viewportHeight : 0
  const width = Number.isFinite(input?.popWidth) && input.popWidth > 0 ? input.popWidth : 260
  const right = Number.isFinite(input?.triggerRect?.right) ? input.triggerRect.right : margin
  const top = Number.isFinite(input?.triggerRect?.top) ? input.triggerRect.top : vh
  const maxLeft = Math.max(margin, vw - width - margin)
  const left = Math.min(Math.max(margin, right - width), maxLeft)
  const bottom = Math.max(margin, vh - top + gap)
  return { left, bottom }
}
  const modelIcon = function modelIcon(h, name) {
  const body = MODEL_ICONS[name] ?? ''
  return h('svg', { viewBox: '0 0 24 24', className: 'launcher-ic', 'aria-hidden': 'true', focusable: 'false', dangerouslySetInnerHTML: { __html: body } })
}
  const renderPopItem = function renderPopItem(h, { key, label, note, checked, onPick }) {
  const children = [h('span', { className: 'launcher-pop-item__label' }, label)]
  if (note !== undefined) children.push(h('span', { className: 'launcher-pop-note' }, note))
  children.push(checked ? h('span', { className: 'chk' }, modelIcon(h, 'check')) : null)
  return h('button', {
    key,
    type: 'button',
    role: 'menuitemradio',
    'aria-checked': checked === true,
    className: `launcher-pop-item${checked === true ? ' on' : ''}`,
    'data-model-pick': key,
    onClick: () => onPick(key),
  }, ...children)
}
  const renderModelTrigger = function renderModelTrigger(h, options = {}) {
  const state = createModelState(options.state)
  const popover = options.popover ?? null
  const onAct = typeof options.onAct === 'function' ? options.onAct : () => {}
  const modelOpen = popover === POPOVER_KINDS.model
  const reasonOpen = popover === POPOVER_KINDS.reason
  return h('span', { className: 'launcher-cm-modelwrap', 'data-model-trigger': '' },
    h('button', {
      key: 'model',
      type: 'button',
      className: 'launcher-cm-t',
      title: '选模型',
      'aria-haspopup': 'menu',
      'aria-expanded': modelOpen,
      'data-model-act': 'model',
      onClick: () => onAct('model'),
    }, modelTriggerLabel(state)),
    h('button', {
      key: 'reason',
      type: 'button',
      className: 'launcher-cm-t lev',
      title: '推理等级',
      'aria-haspopup': 'menu',
      'aria-expanded': reasonOpen,
      'data-model-act': 'reason',
      onClick: () => onAct('reason'),
    }, state.reason),
    h('button', {
      key: 'chev',
      type: 'button',
      className: 'launcher-cm-t chev',
      'aria-label': '模型与推理等级',
      'aria-haspopup': 'menu',
      'aria-expanded': modelOpen,
      'data-model-act': 'model',
      onClick: () => onAct('model'),
    }, modelIcon(h, 'chevronDown')))
}
  const renderModelPopover = function renderModelPopover(h, options = {}) {
  const kind = options.kind ?? null
  if (kind !== POPOVER_KINDS.model && kind !== POPOVER_KINDS.reason) return null
  const state = createModelState(options.state)
  const query = typeof options.query === 'string' ? options.query : ''
  const onQuery = typeof options.onQuery === 'function' ? options.onQuery : () => {}
  const onPickModel = typeof options.onPickModel === 'function' ? options.onPickModel : () => {}
  const onPickReason = typeof options.onPickReason === 'function' ? options.onPickReason : () => {}
  const body = []

  if (kind === POPOVER_KINDS.model) {
    body.push(h('div', { key: 'search', className: 'launcher-pop-search' },
      modelIcon(h, 'search'),
      h('input', {
        className: 'launcher-pop-search__in',
        type: 'search',
        value: query,
        placeholder: '搜索模型…',
        'aria-label': '搜索模型',
        'data-model-search': '',
        onChange: (event) => onQuery(event?.target?.value ?? ''),
      })))
    const groups = filterModelGroups(query)
    for (const group of groups) {
      body.push(h('div', { key: `g-${group.id}`, className: 'launcher-pop-g' }, group.label))
      for (const model of group.models) {
        body.push(renderPopItem(h, {
          key: model.id,
          label: model.name,
          checked: state.model === model.id,
          onPick: onPickModel,
        }))
      }
    }
    if (groups.length === 0) body.push(h('div', { key: 'empty', className: 'launcher-pop-g' }, '没有匹配的模型'))
  } else {
    body.push(h('div', { key: 'g-reason', className: 'launcher-pop-g' }, '推理等级'))
    for (const level of REASON_LEVELS) {
      body.push(renderPopItem(h, {
        key: level.id,
        label: level.label,
        note: level.hint,
        checked: state.reason === level.id,
        onPick: onPickReason,
      }))
    }
  }

  return h('div', {
    className: 'launcher-model-pop',
    role: 'menu',
    'aria-label': kind === POPOVER_KINDS.model ? '选择模型' : '选择推理等级',
    'data-model-popover': kind,
    ref: options.popoverRef,
  }, ...body)
}
  // #endregion model-from-lib

  // 与 lib/new-session.js 的 STARTERS 逐条对齐（text 是整句：只填入、不发送）；
  // 漂移由 test/new-session.test.mjs 的同步检查挡住。
  const STARTERS = [
    { id: 'explore', label: '看仓库结构', text: '帮我看一下这个仓库的结构，先说值得注意的地方。' },
    { id: 'test', label: '跑一遍测试', text: '跑一遍测试，失败的和跳过的分开说。' },
    { id: 'split-tasks', label: '拆成任务卡', text: '把这件事拆成几张能并行的任务卡，写清依赖顺序。' },
    { id: 'resume', label: '接着上次的活', text: '接着上次没做完的活继续，先说上次停在哪。' },
  ]

  const CSS = `
.launcher-shell{--launcher-rail:56px;--launcher-sidebar:280px;--launcher-status:26px;--launcher-dock:0px;
  background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary);
  display:grid;grid-template-rows:1fr var(--launcher-status);
  grid-template-columns:var(--launcher-rail) var(--launcher-sidebar) minmax(0,1fr) var(--launcher-dock);
  grid-template-areas:"rail sidebar main dock" "status status status status";
  height:100vh;width:100vw;overflow:hidden}
.launcher-rail{grid-area:rail;align-items:center;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));display:flex;flex-direction:column;gap:6px;padding:8px 0;min-height:0}
.launcher-rail__entry{align-items:center;background:transparent;border:0;border-radius:10px;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;display:flex;flex:none;font:inherit;font-size:13px;height:36px;justify-content:center;width:36px}
.launcher-rail__entry:hover{background:var(--dsw-alias-button-floating-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.launcher-rail__entry.on{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.18));color:var(--dsw-alias-label-primary)}
.launcher-sidebar{grid-area:sidebar;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));min-height:0;overflow:hidden}
.launcher-main{container-type:inline-size;display:flex;flex-direction:column;min-width:0;min-height:0;grid-area:main;container-type:inline-size;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.launcher-dock{position:relative;grid-area:dock;border-left:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));min-height:0;overflow:hidden;display:flex;flex-direction:column}
.launcher-splitbar{display:flex;gap:2px;padding:2px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.launcher-splitbar__mode{font:inherit;font-size:11px;min-height:24px;padding:1px 6px;border-radius:4px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;opacity:.7}
.launcher-splitbar__mode.on{opacity:1;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.launcher-panes{flex:1;min-height:0;display:grid;gap:1px;grid-template-columns:repeat(var(--split-cols,1),minmax(0,1fr));grid-template-rows:repeat(var(--split-rows,1),minmax(0,1fr))}
.launcher-pane{min-width:0;min-height:0;overflow:auto;display:flex;flex-direction:column}
@container (max-width: 760px){.launcher-panes{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:repeat(var(--split-rows,1),minmax(0,1fr))}}
.launcher-palette{position:fixed;inset-inline:0;top:12vh;margin:auto;width:min(560px,92vw);max-height:60vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-1,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);z-index:50;overflow:hidden}
.launcher-palette__input{font:inherit;padding:10px 12px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));outline:none;background:transparent;color:inherit}
.launcher-palette__list{list-style:none;margin:0;padding:4px;overflow:auto}
.launcher-palette__item{display:flex;justify-content:space-between;gap:12px;padding:6px 10px;border-radius:6px;cursor:pointer}
.launcher-palette__item.off{opacity:.45;cursor:not-allowed}
.launcher-palette__item.on{background:var(--dsw-alias-bg-2,rgba(127,127,127,.12))}
.launcher-palette__hint{opacity:.6;font-size:11px}
.launcher-shell[data-code-wrap="off"] pre, .launcher-shell[data-code-wrap="off"] pre code{white-space:pre!important;overflow-x:auto}
.launcher-shell[data-code-wrap="on"] pre code{white-space:pre-wrap!important;word-break:break-word}
.launcher-diag{position:fixed;right:16px;bottom:40px;width:min(340px,90vw);background:var(--dsw-alias-bg-1,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.18);z-index:45}
.launcher-diag__head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.launcher-ctx{position:relative;display:inline-flex}
.launcher-ctx__entry{height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:13px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.launcher-ctx__entry[data-pct^="9"]{border-color:var(--dsw-alias-warning,#d97706)}
.launcher-ctx__pop{min-width:200px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-1,#fff);z-index:1000;box-shadow:0 10px 28px rgba(0,0,0,.18)}
.launcher-ctx__head{font-size:12px;margin-bottom:6px}
.launcher-ctx__list{margin:0;padding:0;display:grid;gap:4px;font-size:12px}
.launcher-ctx__list div{display:flex;justify-content:space-between;gap:12px}
.launcher-ctx__list dt{opacity:.7}
.launcher-ctx__list dd{margin:0}
.launcher-perm{position:relative;display:inline-flex;align-items:center}
.launcher-perm__pill{height:26px;display:inline-flex;align-items:center;gap:4px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:13px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.launcher-perm__pill[disabled]{opacity:.6;cursor:not-allowed}
.launcher-perm__menu{position:absolute;bottom:calc(100% + 6px);left:0;min-width:180px;padding:4px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-1,#fff);z-index:40}
.launcher-perm__item{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.launcher-perm__item.on{background:var(--dsw-alias-bg-2,rgba(127,127,127,.12))}
@container (max-width: 640px){.launcher-perm__text{display:none}.launcher-perm__pill{padding:0 6px}}
.launcher-approval-chip{font-size:11px;color:var(--dsw-alias-label-secondary,#666);opacity:.65;pointer-events:none;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;padding:0 6px;line-height:18px}
.launcher-approval-chip.is-error{color:var(--dsw-alias-state-warn-border,#d9a441);opacity:1;pointer-events:auto;cursor:pointer;background:transparent;font:inherit;border-style:solid}
.launcher-approval-card{position:fixed;right:16px;bottom:48px;z-index:1000;width:min(360px,92vw);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;background:var(--dsw-alias-bg-1,#fff);box-shadow:0 10px 28px rgba(0,0,0,.18);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.launcher-approval-card__head{font-size:12px;font-weight:600}
.launcher-approval-card__cmd{font-size:11px;white-space:pre-wrap;word-break:break-all;background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));border-radius:6px;padding:6px;max-height:120px;overflow:auto}
.launcher-approval-card__actions{display:flex;gap:6px;justify-content:flex-end}
.launcher-approval-card__btn{font:inherit;font-size:12px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;cursor:pointer}
.launcher-approval-settings{display:flex;flex-direction:column;gap:8px;font-size:12px}
.launcher-approval-settings__row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.launcher-approval-settings__mode{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;height:24px;padding:0 8px;cursor:pointer}
.launcher-approval-settings__mode.on{background:var(--dsw-alias-bg-2,rgba(127,127,127,.14))}
.launcher-approval-settings__tool{display:inline-flex;align-items:center;gap:4px}
.launcher-approval-settings__input{height:24px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;padding:0 8px;min-width:180px}
.launcher-approval-settings__dir{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:6px;padding:0 6px;font-size:11px}
.launcher-approval-settings__dir button{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit}
.launcher-approval-settings__error{color:var(--dsw-alias-state-warn-border,#d9a441);margin:0}
.launcher-dock-summary{font-size:12px;opacity:.75}
.launcher-model-chip{font-size:12px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;opacity:.85}
.launcher-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:rgba(20,20,20,.9);color:#fff;font-size:12px;z-index:60;pointer-events:none}
.launcher-turn-action{display:inline-flex;align-items:center;gap:4px;height:28px;max-width:100%;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;border-radius:6px;padding:0 8px;font:inherit;font-size:12px;cursor:pointer}
.launcher-turn-action__label{white-space:nowrap}
@media (max-width: 420px){.launcher-turn-action{padding:0 6px;min-width:24px;justify-content:center}.launcher-turn-action__label{display:none}}
.launcher-turn-highlight{outline:2px solid var(--dsw-alias-accent,#4c8dff);outline-offset:2px;border-radius:6px}
.launcher-diag__list{margin:0;padding:8px 10px;display:grid;gap:6px;font-size:12px}
.launcher-diag__list div{display:flex;justify-content:space-between;gap:12px}
.launcher-diag__list dt{opacity:.7}
.launcher-diag__list dd{margin:0}
.launcher-dock__host{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.launcher-dock[data-dock-width="0"]{border-left:0}
.launcher-dock[data-dock-width="0"] .launcher-dock__host{visibility:hidden;pointer-events:none;width:0}
.launcher-dock__handle{position:absolute;left:0;top:0;bottom:0;width:8px;cursor:col-resize;background:transparent;z-index:30;touch-action:none}
.launcher-dock__handle:hover{background:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.launcher-statusbar{grid-area:status;align-items:center;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));display:flex;font-size:11px;gap:10px;padding:0 10px;color:var(--dsw-alias-label-secondary)}
.launcher-overlay{position:fixed;inset:0;pointer-events:none;z-index:40}
.launcher-overlay>*{pointer-events:auto}
.launcher-pane{position:relative;display:flex;flex-direction:column;min-height:0;overflow:hidden;contain:paint;isolation:isolate}
@media (max-width: 860px){
  .launcher-shell{grid-template-columns:var(--launcher-rail) 0 minmax(0,1fr) 0}
  .launcher-sidebar{position:fixed;left:var(--launcher-rail);top:0;bottom:var(--launcher-status);width:280px;z-index:30;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));box-shadow:0 0 0 100vmax rgba(0,0,0,.001)}
  .launcher-sidebar[data-drawer="closed"]{display:none}
  .launcher-main{min-width:0}
}
.launcher-theme-chip{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;min-width:24px;min-height:24px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;border-radius:6px;font-size:12px;line-height:1;padding:2px 6px;cursor:pointer}
.launcher-panel-back{flex:0 0 auto;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.launcher-panel-back__btn{display:inline-flex;align-items:center;min-width:24px;min-height:24px;padding:0 6px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;opacity:.8}
.launcher-empty{position:static;flex:0 0 auto;z-index:auto;align-items:center;display:flex;justify-content:center;min-height:0;max-height:260px;overflow:auto;padding:16px 16px 8px;background:transparent}
.launcher-pane__host{display:flex;flex:1 1 0;min-height:0;flex-direction:column;overflow:hidden}
.launcher-empty__card{display:flex;flex-direction:column;gap:10px;margin:auto;width:100%}
.launcher-empty__theme{align-items:center;background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.14));border-radius:12px;color:var(--dsw-alias-label-secondary,#666);display:flex;font-size:13px;font-weight:600;height:40px;justify-content:center;width:40px}
.launcher-empty__title{font-size:19px;font-weight:600;line-height:1.4;margin:2px 0 0}
.launcher-empty__body{color:var(--dsw-alias-label-secondary,#666);font-size:12.5px;line-height:1.7;margin:0}
.launcher-empty__starters{display:grid;gap:8px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:6px}
.launcher-empty__starters[data-columns="1"]{grid-template-columns:minmax(0,1fr)}
.launcher-empty__starter{align-items:center;background:var(--dsw-alias-button-floating-fill,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;color:inherit;cursor:pointer;display:flex;font:inherit;font-size:13px;height:36px;justify-content:center;padding:0 10px}
.launcher-empty__hint{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;margin:4px 0 0}
.launcher-conflict{border-bottom:1px solid var(--dsw-alias-state-warn-border,#d9a441);background:var(--dsw-alias-state-warn-fill,#fff6e0);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;padding:6px 12px;position:sticky;top:0;z-index:50}
.launcher-hostguard{position:sticky;top:0;z-index:60;border-bottom:1px solid var(--dsw-alias-state-warn-border,#d9a441);background:var(--dsw-alias-state-warn-fill,#fff6e0);color:var(--dsw-alias-label-primary,#1f1f1f);font-size:12px;line-height:1.6;padding:8px 12px;display:flex;flex-direction:column;gap:6px}
.launcher-hostguard__head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600}
.launcher-hostguard__close{font:inherit;font-size:12px;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));border-radius:6px;background:transparent;color:inherit;cursor:pointer;flex:none}
.launcher-hostguard__reasons{margin:0;padding-left:18px}
.launcher-hostguard__cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;background:var(--dsw-alias-bg-2,rgba(0,0,0,.06));border-radius:6px;padding:6px;margin:0}
`

  function ensureStyle() {
    if (document.getElementById('dsh-launcher-style') !== null) return
    const tag = document.createElement('style')
    tag.id = 'dsh-launcher-style'
    // 先铺令牌（日夜两套变量），再原有样式，最后骨架覆盖（v17 图标栏/状态条/四列底色）
    // 款式分层：令牌 → 原有 CSS → 骨架 → 主区 → 右栏/设置 → 侧栏（各由 lib 模块生成）
    tag.textContent = `${TOKENS_CSS}\n${CSS}\n${SKELETON_CSS}\n${MAIN_CSS}\n${DOCK_SETTINGS_CSS}\n${SIDEBAR_CSS}\n${MODEL_CSS}`
    document.head.appendChild(tag)
  }

  /** 面板选中的最小观测面（ui-sidebar 的 usePanelInfo 读它决定哪条高亮）。 */
  function createPanelInfo() {
    let snapshot = { activePanelId: null }
    const listeners = new Set()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set: (id) => {
        const next = { activePanelId: id === undefined ? null : id }
        if (next.activePanelId === snapshot.activePanelId) return
        snapshot = next
        for (const listener of listeners) listener()
      },
    }
  }

  /**
   * 从宿主命令源枚举命令（05 §6.5 要求动态枚举，不许硬编码）。接口形状不保证稳定，
   * 取不到就返回空表，面板显示「未接入命令源」。
   * @param {object} ctx - 客户端上下文。
   * @returns {{ id: string, label: string, hint?: string, run?: Function, command?: string }[]} 命令清单。
   */
  /**
   * 我们自己的 catalog 行（与 lib/command-palette.js 的 ownCatalogRows 同口径）。
   * client 是 loader 形态不能 import lib，这里内联同一套规则；单测在 lib 侧覆盖。
   * @param {object} ctx - 客户端上下文。
   * @returns {object[]} catalog 行。
   */
  /**
   * 按候选 key 解析 main 面板真 key（05 写死口径）：`ctx.slots.entries('main')` 里第一个命中的。
   * 解析不到返回 null —— 调用方置灰，不许 throw。
   * @param {object} ctx - 客户端上下文。
   * @param {string[]} candidates - 候选 key。
   * @returns {string|null} 真 key。
   */
  /** 打开插件工作台：宿主 pluginNavigation.openList() 优先，退 selectPanel 真 key。 */
  function openPluginWorkbench(ctx) {
    try {
      if (typeof ctx?.pluginNavigation?.openList === 'function') {
        ctx.pluginNavigation.openList()
        return true
      }
    } catch {
      /* 落到 selectPanel */
    }
    const key = resolveMainKey(ctx, RAIL_CANDIDATES.plugins)
    if (key !== null) return selectPanel(key)
    return false
  }

  function resolveMainKey(ctx, candidates) {
    try {
      const entries = ctx?.slots?.entries?.('main') ?? []
      const keys = entries.map((entry) => entry?.options?.key).filter((key) => typeof key === 'string')
      for (const key of candidates) if (keys.includes(key)) return key
    } catch {
      /* 解析失败按未解析处理 */
    }
    return null
  }

  // 调宿主命令 resolve 用普通上下文：插件 ctx 是代理，读未 inject 的属性会抛
  // `cannot get property "target" without inject`（实测）
  const MENU_CONTEXT = { region: 'page', modal: null, source: 'menu' }

  /** 宿主面板里「自己不带返回」的那些——由外壳补一条回链（插件页自带，不重复）。 */
  const PANELS_NEEDING_BACK = ['dsh-archive-manager']

  /**
   * 让宿主自己展开/收起右栏（不要再拿本地 sticky 冒充展开态）：
   * ① 宿主服务 sidebarRight：commandTarget(null) + toggleExpanded()；
   * ② 退宿主命令 `sidebar.right.toggle`；
   * ③ 都不行才用本地轨道（仅兜底，轨道开了内容不一定开）。
   * @returns {boolean} 是否成功让宿主切换。
   */
  function toggleRightbarHost() {
    try {
      const svc = CURRENT_CTX?.get?.('sidebarRight')
      if (svc !== null && svc !== undefined && typeof svc.toggleExpanded === 'function') {
        svc.commandTarget?.(null)
        svc.toggleExpanded()
        return true
      }
    } catch {
      /* 落到命令 */
    }
    try {
      const rows = CURRENT_CTX?.shortcuts?.registry?.commands
      const row = rows?.get?.('sidebar.right.toggle')
      if (row !== undefined) {
        const verdict = row.resolve?.({ region: 'page', modal: null, source: 'menu' })
        if (verdict?.status === 'handled' && typeof verdict.run === 'function') {
          verdict.run()
          return true
        }
      }
    } catch {
      /* 落到本地兜底 */
    }
    return false
  }

  /** 回会话页：宿主 selectPanel(null) 不生效时退到 'conversation' 真 key。 */
  function goConversation(ctx) {
    try {
      ctx?.layout?.selectPanel?.(null)
      if (ctx?.layout?.panelInfo?.getSnapshot?.().activePanelId === null) return true
    } catch {
      /* 落到真 key */
    }
    return selectPanel('conversation')
  }

  const RAIL_CANDIDATES = {
    conversation: ['conversation'],
    schedules: ['dsh-schedule', 'schedule', 'schedules'],
    approvals: ['dsh-approvals', 'approvals'],
    settings: ['dsh-settings', 'settings'],
    plugins: ['dsh-plugin-manager', 'plugin-manager'],
  }

  /** FR-43 #7：代码块自动换行开关（根属性 + localStorage，不改宿主接口）。 */
  const CODE_WRAP_KEY = 'dsh.launcher.codeWrap'
  function codeWrapOn() {
    try {
      return window.localStorage.getItem(CODE_WRAP_KEY) === 'off' ? false : true
    } catch {
      return true
    }
  }
  function applyCodeWrap(on) {
    try {
      window.localStorage.setItem(CODE_WRAP_KEY, on ? 'on' : 'off')
    } catch {
      /* 无 localStorage 时只影响本次会话 */
    }
  }
  function setCodeWrapPref(on) {
    try {
      window.localStorage.setItem(CODE_WRAP_KEY, on ? 'on' : 'off')
    } catch {
      /* 无 localStorage 时只影响本次会话 */
    }
  }

  /**
   * FR-39/42/43：把三个动作注册进真槽（`conversation.chat.assistant-actions` / `conversation.chat.turnTail`）。
   * 用 `ctx.slots.inject(槽名, () => register(...))`：槽在才注册、返回同步 dispose。
   * 渲染验证需要有会话的环境，这里只做注册（按钮点了派发事件，由宿主/外壳后续接）。
   * @param {object} ctx - 客户端上下文。
   * @returns {Function[]} dispose 列表。
   */
  /**
   * FR-39/42/43：三个会话动作（真槽注册）。
   * 恒定注册（0.2.0 范围内）；回滚是代码级/构建级的——不注入这两个槽条目即可，不用运行时开关。
   * 按钮必须真有行为，否则就是"假执行"（05 §6.5：假执行比不提供更糟）。
   */
  /** 外壳的可见反馈条（失败/结果都要看得见，别只 console）。 */
  function showLauncherToast(text) {
    try {
      const node = document.createElement('div')
      node.className = 'launcher-toast'
      node.textContent = text
      document.body.appendChild(node)
      setTimeout(() => node.remove(), 2600)
    } catch {
      console.warn('dsh-client-ui-launcher:', text)
    }
  }

  /** 当前 dsh profile（横幅与设置页回退命令共用；读不到回落 web）。 */
  function launcherProfile() {
    const value = typeof window !== 'undefined' ? window.__DSH_LAUNCHER_PROFILE__ : undefined
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'web'
  }

  /**
   * FR-35 权限范围 pill（05 §6.3-⑥）：挂 `conversation.composer.bar`，26px、`+` 右侧、模型 chip 左侧。
   * 默认不注册：宿主是否在槽 props 里给「当前权限 + 设置回调」尚未确认，没有回调时按钮点了就是假执行。
   * 开闸：`window.__DSH_LAUNCHER_PERMISSION_PILL__ === true`。读不到宿主策略时显示 `workspace-write`，绝不显示 full。
   * @param {object} ctx - 客户端上下文。
   * @returns {Function[]} dispose 列表。
   */
  /**
   * FR-38 上下文诊断：入口 + 浮层都在 `conversation.session.header.actions`（session scope）。
   * root 是 root scope，拿不到 useProjection；硬读 ctx.tokenMeter 会把整页打崩（df1f865 事故）。
   * 数据只用宿主投影 `contextPressure` / `contextBreakdown`；读不到整条不渲染（不置假数据）。
   */
  function registerContextDiagnostics(ctx) {
    const Component = (slotProps) => {
      // hooks 必须无条件、顺序稳定：全部放在组件最顶部（React #310 的根因就是放在了 early return 之后）
      const [open, setOpen] = React.useState(false)
      const entryRef = React.useRef(null)
      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [open])
      const readProjection = (name) => {
        try {
          const hook = slotProps?.useProjection
          if (typeof hook !== 'function') return null
          const value = hook(name)
          return typeof value === 'function' ? value((v) => v) : value
        } catch {
          return null
        }
      }
      const pressure = readProjection('contextPressure')
      const breakdown = readProjection('contextBreakdown')
      if (typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEBUG__ === true) {
        // 一次把「这个槽到底给了什么」打全：props 键、useProjection 类型、两条真实返回值
        const readSafe = (name) => {
          try {
            const hook = slotProps?.useProjection
            return typeof hook === 'function' ? hook(name) : 'no-hook'
          } catch (error) {
            return `throw:${String(error?.message ?? error).slice(0, 60)}`
          }
        }
        console.info('launcher:ctx props', JSON.stringify({
          keys: Object.keys(slotProps ?? {}),
          useProjection: typeof slotProps?.useProjection,
          contextPressure: readSafe('contextPressure'),
          contextBreakdown: readSafe('contextBreakdown'),
          tokenUsage: readSafe('tokenUsage'),
        }).slice(0, 600))
      }
      const num = (value, keys) => {
        if (value === null || value === undefined) return null
        if (typeof value === 'number') return Number.isFinite(value) ? value : null
        for (const key of keys) {
          const n = Number(value[key])
          if (Number.isFinite(n)) return n
        }
        return null
      }
      // 实测形状：{pressureTokens, projectedTokens, contextWindow}
      // 实测：{pressureTokens, projectedTokens, contextWindow}；占用优先 projectedTokens
      const used = num(pressure, ['projectedTokens', 'pressureTokens', 'used', 'usedTokens', 'tokens', 'surfaceTokens'])
      const limit = num(pressure, ['contextWindow', 'limit', 'limitTokens', 'windowTokens', 'max'])
      const ratio = num(pressure, ['ratio', 'pct', 'percent', 'pressure'])
      let pct = null
      if (used !== null && limit !== null && limit > 0) pct = Math.min(100, Math.round((used / limit) * 100))
      else if (ratio !== null) pct = ratio <= 1 ? Math.round(ratio * 100) : Math.round(ratio)
      const system = num(breakdown, ['systemTokens', 'system'])
      const chat = num(breakdown, ['messageTokens', 'chat'])
      const files = num(breakdown, ['filesTokens', 'files'])
      const tools = num(breakdown, ['toolsTokens', 'tools'])

      const unavailable = pct === null && system === null && chat === null && tools === null
      // 浮层挂 document.body：header 的 mask 会裁掉 position:fixed 的后代（实测）
      React.useEffect(() => {
        if (!open || unavailable) return undefined
        const rect = entryRef.current?.getBoundingClientRect?.()
        const node = document.createElement('div')
        node.className = 'launcher-ctx__pop launcher-ctxdiag__pop'
        node.setAttribute('role', 'dialog')
        node.setAttribute('aria-label', '上下文诊断')
        node.setAttribute('data-launcher-overlay', '')
        node.style.position = 'fixed'
        node.style.zIndex = '1000'
        node.style.top = `${(rect?.bottom ?? 0) + 6}px`
        node.style.left = `${Math.max(8, rect?.left ?? 8)}px`
        const head = document.createElement('header')
        head.className = 'launcher-ctx__head'
        head.textContent = pct === null ? '上下文占用 —' : `上下文占用 ${pct}%`
        node.appendChild(head)
        const list = document.createElement('dl')
        list.className = 'launcher-ctx__list'
        for (const [label, value] of [['系统提示', system], ['会话消息', chat], ['文件', files], ['工具', tools]]) {
          if (value === null || value === undefined) continue
          const row = document.createElement('div')
          const dt = document.createElement('dt')
          dt.textContent = label
          const dd = document.createElement('dd')
          dd.textContent = String(value)
          row.append(dt, dd)
          list.appendChild(row)
        }
        node.appendChild(list)
        document.body.appendChild(node)
        const onOutside = (event) => {
          if (node.contains(event.target)) return
          if (entryRef.current?.contains?.(event.target)) return
          setOpen(false)
        }
        document.addEventListener('pointerdown', onOutside, true)
        return () => {
          document.removeEventListener('pointerdown', onOutside, true)
          node.remove()
          entryRef.current?.focus?.()
        }
      }, [open, unavailable, pct, system, chat, files, tools])

      return h('div', { className: 'launcher-ctx launcher-ctxdiag', onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false) } },
        h('button', {
          ref: entryRef,
          type: 'button',
          className: 'launcher-ctx__entry',
          'data-pct': pct === null ? '' : pct,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-disabled': unavailable,
          disabled: unavailable,
          title: unavailable ? '上下文用量不可用' : `上下文占用 ${pct}% · 点开看拆分`,
          onClick: () => {
            if (unavailable) return
            setOpen((v) => !v)
          },
        }, unavailable ? '上下文 —' : `上下文 ${pct}%`))
    }
    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      const dispose = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'launcher.contextDiagnostics',
        order: 10,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册上下文诊断失败', error)
      return []
    }
  }


  /**
   * C 方案：`conversation.composer.dock`（list，session）只挂**只读镜像**——排队数量。
   * 不抢宿主状态、不重复渲染同一数字：宿主管生一条，我们只在「有排队且宿主没给这条」时显示；
   * 拿不到就整条不渲染。
   */
  function registerComposerDock(ctx) {
    /** composer 容器（把取值限定在会话 composer 内，避免误读命令面板/改名弹窗的可编辑元素）。 */
    const composerRoot = () => {
      const bySlot = document.querySelector('[data-slot="conversation.composer"]')
      if (bySlot !== null) return bySlot
      const editable = document.querySelector('[contenteditable="true"]')
      return editable?.closest('[class*="composer"]') ?? null
    }

    /** DOM 读数（宿主给 dock 槽传的是空对象，slotProps 里没有输入/附件）。 */
    const readDockSummary = () => {
      try {
        const root = composerRoot()
        if (root === null) return { chars: 0, attachments: 0 }
        const editable = root.querySelector('[contenteditable="true"]')
        // Lexical 空编辑器保留一个换行：先去首尾空白再数字符，否则清空后仍会显示「输入 1 字」
        const chars = editable === null ? 0 : [...(editable.innerText ?? '').trim()].length
        // 同一 chip 只算一次：优先按 data-attachment-id 去重；纯 class 命中时跳过已被外层 id 覆盖的节点
        const nodes = [...root.querySelectorAll('[data-attachment-id], [class*="attachmentChip"], [class*="attachment-chip"]')]
        const ids = new Set()
        let classOnly = 0
        for (const node of nodes) {
          const id = node.getAttribute?.('data-attachment-id')
          if (typeof id === 'string' && id.length > 0) ids.add(id)
          else if (node.closest?.('[data-attachment-id]') === null) classOnly += 1
        }
        const attachments = ids.size + classOnly
        return { chars, attachments }
      } catch {
        return { chars: 0, attachments: 0 }
      }
    }

    const Component = () => {
      const [summary, setSummary] = React.useState(readDockSummary)
      React.useEffect(() => {
        let frame = 0
        const update = () => {
          // rAF 合并：生成中每个 token 都触发也只算一次；数值没变不 setState
          if (frame !== 0) return
          frame = requestAnimationFrame(() => {
            frame = 0
            const next = readDockSummary()
            setSummary((prev) => (prev.chars === next.chars && prev.attachments === next.attachments ? prev : next))
          })
        }
        const root = composerRoot()
        document.addEventListener('input', update, true)
        const observer = new MutationObserver(update)
        // 只观察 composer 子树；拿不到容器时不观察（宁可不动，也不盯全页）
        if (root !== null) observer.observe(root, { childList: true, subtree: true, characterData: true })
        const timer = setInterval(update, 800)
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          document.removeEventListener('input', update, true)
          observer.disconnect()
          clearInterval(timer)
        }
      }, [])
      const parts = []
      if (summary.chars > 0) parts.push(`输入 ${summary.chars} 字`)
      if (summary.attachments > 0) parts.push(`${summary.attachments} 个附件`)
      if (parts.length === 0) return null
      return h('span', {
        className: 'launcher-dock-summary',
        title: parts.join(' · '),
        'data-dock-chars': summary.chars,
        'data-dock-attachments': summary.attachments,
      }, parts.join(' · '))
    }

    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      const dispose = ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'launcher.composerDock',
        order: 10,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册 composer.dock 摘要失败', error)
      return []
    }
  }


  // ---- PR-B：审批（策略设置 / 待审批卡 / 置灰入口） ----
  const APPROVAL_BASE = '/dsh-approval'
  const APPROVAL_MODES = [
    { id: 'readonly', label: '只读' },
    { id: 'ask', label: '每次询问' },
    { id: 'auto-safe', label: '自动批准安全命令' },
    { id: 'full', label: '全自动' },
  ]
  // 真 schema（policy-store.mjs）：tools 的键是这六类
  const APPROVAL_TOOLS = [
    { id: 'fs.read', label: '读文件' },
    { id: 'fs.write', label: '写文件' },
    { id: 'exec', label: '执行命令' },
    { id: 'net', label: '网络' },
    { id: 'browser', label: '浏览器' },
    { id: 'git.push', label: 'git push' },
  ]
  const APPROVAL_CHOICES = [
    { id: 'allow-once', label: '允许这一次' },
    { id: 'allow-always', label: '永久允许' },
    { id: 'deny', label: '拒绝' },
  ]
  /** 设置页四项（4 档 / 6 类 / 白名单 / 危险标注），保存走 Remote 的 set + 版本冲突重读。 */
  function ApprovalSettings() {
    const [doc, setDoc] = React.useState(null)
    const [draft, setDraft] = React.useState(null)
    const [path, setPath] = React.useState('')
    const [error, setError] = React.useState(null)
    React.useEffect(() => {
      approvalRequest('/policy').then((value) => { setDoc(value); setDraft(value) }).catch(() => setError('读取失败'))
    }, [])
    if (draft === null) return h('div', { className: 'launcher-approval-settings' }, error ?? '加载中…')
    const setMode = (runMode) => setDraft({ ...draft, runMode })
    const setTool = (tool, level) => setDraft({ ...draft, tools: { ...(draft.tools ?? {}), [tool]: level } })
    const save = async (patch) => {
      try {
        const result = await approvalRequest('/policy', { method: 'POST', body: JSON.stringify({ patch, ifVersion: doc.version }) })
        if (result?.ok === true) { setDoc(result.doc); setDraft(result.doc); setError(null) }
        else { setError(result?.reason === 'conflict' ? '策略已被别处修改，已重新加载' : String(result?.message ?? '保存失败')) ; approvalRequest('/policy').then((value) => { setDoc(value); setDraft(value) }) }
      } catch { setError('保存失败') }
    }
    const levels = [{ id: 'allow', label: '允许' }, { id: 'ask', label: '询问' }, { id: 'deny', label: '拒绝' }]
    return h('div', { className: 'launcher-approval-settings', 'data-slot': 'launcher.approvalSettings' },
      h('div', { className: 'launcher-approval-settings__row' },
        h('span', null, '运行模式'),
        APPROVAL_MODES.map((mode) => h('button', {
          key: mode.id, type: 'button', 'data-mode': mode.id,
          'aria-pressed': draft.runMode === mode.id,
          className: `launcher-approval-settings__mode${draft.runMode === mode.id ? ' on' : ''}`,
          onClick: () => { setMode(mode.id); save({ runMode: mode.id }) },
        }, mode.label))),
      h('div', { className: 'launcher-approval-settings__row' },
        h('span', null, '工具类别'),
        APPROVAL_TOOLS.map((tool) => h('label', { key: tool.id, className: 'launcher-approval-settings__tool' },
          tool.label,
          h('select', {
            'data-tool': tool.id,
            'aria-label': `工具类别：${tool.label}`,
            value: draft.tools?.[tool.id] ?? 'ask',
            onChange: (event) => { setTool(tool.id, event.target.value); save({ tools: { ...(draft.tools ?? {}), [tool.id]: event.target.value } }) },
          }, levels.map((level) => h('option', { key: level.id, value: level.id }, level.label)))))),
      h('div', { className: 'launcher-approval-settings__row' },
        h('span', null, '目录白名单'),
        h('input', {
          className: 'launcher-approval-settings__input',
          'data-approval-whitelist': 'input',
          'aria-label': '目录白名单路径',
          placeholder: '/path/to/dir',
          value: path,
          onChange: (event) => setPath(event.target.value),
        }),
        h('button', {
          type: 'button', 'data-approval-whitelist': 'add',
          onClick: () => {
            const next = [...new Set([...(draft.dirWhitelist ?? []), path.trim()].filter(Boolean))]
            setDraft({ ...draft, dirWhitelist: next })
            save({ dirWhitelist: next })
            setPath('')
          },
        }, '添加')),
      h('div', { className: 'launcher-approval-settings__row' },
        h('span', null, '已白名单'),
        (draft.dirWhitelist ?? []).map((dir) => h('span', { key: dir, className: 'launcher-approval-settings__dir' },
          dir,
          h('button', {
            type: 'button',
            'data-approval-whitelist': 'remove',
            'data-dir': dir,
            'aria-label': `移除白名单目录 ${dir}`,
            onClick: () => {
              const next = (draft.dirWhitelist ?? []).filter((item) => item !== dir)
              setDraft({ ...draft, dirWhitelist: next })
              save({ dirWhitelist: next })
            },
          }, '×')))),
      h('label', { className: 'launcher-approval-settings__row' },
        h('input', {
          type: 'checkbox',
          'data-approval-danger': 'toggle',
          'aria-label': '标注危险命令',
          checked: draft.dangerousGuard?.enabled !== false,
          onChange: (event) => {
            const on = event.target.checked
            const guard = { ...(draft.dangerousGuard ?? { enabled: true, patterns: [] }), enabled: on }
            setDraft({ ...draft, dangerousGuard: guard })
            save({ dangerousGuard: guard })
          },
        }),
        '标注危险命令'),
      error === null ? null : h('p', { className: 'launcher-approval-settings__error' }, error))
  }

  /** FR-44 三态（与 lib/model-chip.js 同口径）。 */
  function modelChipText(model = {}) {
    const name = typeof model.name === 'string' ? model.name.trim() : ''
    if (name.length === 0) return null
    const level = typeof model.reasoningLevel === 'string' ? model.reasoningLevel.trim() : ''
    if (level.length > 0) return { label: `${name} · ${level}`, state: 'level' }
    if (model.metadataKnown === true) return { label: `${name} · 无推理等级`, state: 'none' }
    return { label: name, state: 'unknown' }
  }

  /** FR-44 模型 chip（只显示不切换）：三态见 lib/model-chip.js；没有模型元数据就不渲染。 */
  function registerModelChip(ctx) {
    const Component = (slotProps) => {
      const text = modelChipText({
        name: slotProps?.model?.name ?? slotProps?.modelName,
        reasoningLevel: slotProps?.model?.reasoningLevel ?? slotProps?.reasoningLevel,
        metadataKnown: slotProps?.model?.metadataKnown === true || slotProps?.metadataKnown === true,
      })
      if (text === null) return null
      return h('span', { className: 'launcher-model-chip', 'data-model-state': text.state, title: text.label }, text.label)
    }
    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      // composer.bar 若是 single 槽，注册会打断 required 插件激活：先确认它是 list 再注册
      const spec = ctx.slots.spec?.('conversation.composer.bar')
      if (spec === undefined || spec === null || spec.kind !== 'list') return []
      const dispose = ctx.slots.inject('conversation.composer.bar', () => ctx.slots.register({
        name: 'conversation.composer.bar',
        id: 'launcher.modelChip',
        order: 20,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册模型 chip 失败', error)
      return []
    }
  }

  function registerPermissionPill(ctx) {
    if (typeof window === 'undefined' || window.__DSH_LAUNCHER_PERMISSION_PILL__ !== true) return []
    const LEVELS = [
      { id: 'read', label: '仅可查看', short: '阅' },
      { id: 'workspace-write', label: '工作区内修改', short: '改' },
      { id: 'danger-full-access', label: '完全权限', short: '全' },
    ]
    const Component = (slotProps) => {
      const scope = LEVELS.some((l) => l.id === slotProps?.permission?.scope) ? slotProps.permission.scope : 'workspace-write'
      const canChange = typeof slotProps?.onSetPermission === 'function'
      const current = LEVELS.find((l) => l.id === scope) ?? LEVELS[1]
      const [open, setOpen] = React.useState(false)
      return h('div', { className: 'launcher-perm' },
        h('button', {
          type: 'button',
          className: 'launcher-perm__pill',
          'data-scope': current.id,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          title: current.label,
          disabled: !canChange,
          onClick: () => canChange && setOpen((v) => !v),
        }, h('span', { className: 'launcher-perm__icon', 'aria-hidden': 'true' }, current.short),
           h('span', { className: 'launcher-perm__text' }, current.label)),
        open && canChange ? h('div', { className: 'launcher-perm__menu', role: 'menu' },
          LEVELS.map((level) => h('button', {
            key: level.id,
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': level.id === current.id,
            className: `launcher-perm__item${level.id === current.id ? ' on' : ''}`,
            onClick: () => { slotProps.onSetPermission(level.id); setOpen(false) },
          }, level.label))) : null)
    }
    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      // M1：composer.bar 在 rc.5 是 single 槽，注册会打断 required 激活（同模型 chip 的坑）
      const spec = ctx.slots.spec?.('conversation.composer.bar')
      if (spec === undefined || spec === null || spec.kind !== 'list') return []
      const dispose = ctx.slots.inject('conversation.composer.bar', () => ctx.slots.register({
        name: 'conversation.composer.bar',
        id: 'launcher.permissionPill',
        order: 10,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册权限 pill 失败', error)
      return []
    }
  }



  function registerTurnActions(ctx) {
    const disposers = []

    /**
     * 按宿主真实结构取「这一轮」：按钮在 `[data-chat-flow-kind="turn-tail"]` 里，
     * 正文取它前面最近的 `assistant-step`（助手）或 `user`（用户），轮次 = tail 在会话里的序号。
     * @param {Element|null} node - 触发按钮或包含按钮的节点。
     * @returns {{ text: string, role: string, turnIndex: number }} 这一轮的数据。
     */
    /**
     * 取消息正文并把代码块还原成围栏：宿主把 ``` 渲染成 `pre>code`，`innerText` 会丢掉反引号。
     * @param {Element} root - 消息节点。
     * @returns {string} 带围栏的正文。
     */
    const textWithFences = (root) => {
      // 按文档顺序拼：遇到 PRE 一次拼「```lang + 代码 + ```」；
      // 宿主的代码块常带一个「语言标签」节点（如 <span>js</span>）紧挨在 PRE 前，要跳过它并把语言带进围栏。
      const parts = []
      const labelOf = (node) => {
        const text = (node?.textContent ?? '').trim()
        return /^[A-Za-z0-9+#._-]{1,12}$/.test(text) ? text.toLowerCase() : ''
      }
      const pushPre = (pre, lang) => {
        const code = pre.querySelector('code')
        // 语言三处依次取：code 的 language-* class → pre 的 language-* class → data-language → 传入的标签文本
        const codeLang = ((code?.className ?? '').match(/language-([\w-]+)/)?.[1]
          ?? (pre.className ?? '').match(/language-([\w-]+)/)?.[1]
          ?? pre.getAttribute?.('data-language')
          ?? '')
        const body = (code?.textContent ?? pre.textContent ?? '').replace(/\n$/, '')
        parts.push(`\n\n\`\`\`${codeLang || lang}\n${body}\n\`\`\`\n\n`)
      }
      const walk = (node) => {
        if (node === null || node === undefined) return
        if (node.nodeType === 3) {
          parts.push(node.nodeValue ?? '')
          return
        }
        if (node.nodeType !== 1) return
        if (node.tagName === 'PRE') {
          pushPre(node, '')
          return
        }
        // 宿主的代码块容器（.md-code-block / 含横幅）里有 pre：只取 pre 的代码与语言，
        // 绝不把横幅里的语言名、复制按钮带进正文。
        if (typeof node.querySelector === 'function' && node.querySelector('pre') !== null) {
          const langEl = node.querySelector('[class*="language"], [data-language]')
          const lang = (langEl?.textContent ?? '').trim().toLowerCase()
          pushPre(node.querySelector('pre'), lang)
          return
        }
        const children = [...node.childNodes]
        for (const child of children) walk(child)
      }
      walk(root)
      return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
    }



    const readTurnFromNode = (node) => {
      const tail = node?.closest?.('[data-chat-flow-kind="turn-tail"]') ?? null
      if (tail === null) return { text: '', role: 'assistant', turnIndex: 1 }
      // 轮次：只看「当前会话里」的 turn-tail（不是全文档），否则多会话页面永远算成 1
      const tailScope = (() => {
        let scope = tail.parentElement
        while (scope !== null && scope !== document.body) {
          if (scope.querySelectorAll('[data-chat-flow-kind="turn-tail"]').length > 1) return scope
          scope = scope.parentElement
        }
        return tail.parentElement ?? document.body
      })()
      const tails = [...tailScope.querySelectorAll('[data-chat-flow-kind="turn-tail"]')]
      const turnIndex = Math.max(1, tails.indexOf(tail) + 1)
      // 正文：在「同时包含 tail 的祖先」里找 tail 之前最近的 assistant-step / user（不跨消息容器）
      const nearestBefore = (kind) => {
        let scope = tail.parentElement
        while (scope !== null && scope !== document.body) {
          const found = [...scope.querySelectorAll(`[data-chat-flow-kind="${kind}"]`)]
            .filter((el) => el.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING)
          if (found.length > 0) return found[found.length - 1]
          scope = scope.parentElement
        }
        return null
      }
      const assistant = nearestBefore('assistant-step')
      if (assistant !== null) return { text: textWithFences(assistant), role: 'assistant', turnIndex }
      const user = nearestBefore('user')
      return { text: (user?.innerText ?? user?.textContent ?? '').trim(), role: 'user', turnIndex }
    }



    // 导出：生成 Markdown 并触发下载（不依赖宿主接口）
    const downloadExport = (turn) => {
      const text = typeof turn?.text === 'string' ? turn.text.trim() : ''
      if (text.length === 0) {
        // 取不到正文就不产占位文件（真机空文件事故）
        showLauncherToast('导出失败：取不到这一轮的正文')
        return
      }
      const index = Number.isFinite(turn?.turnIndex) && turn.turnIndex > 0 ? Math.trunc(turn.turnIndex) : 1
      const body = `## ${turn?.role === 'assistant' ? '助手' : '用户'}\n\n${text}\n`
      try {
        const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `turn-${index}-${Date.now()}.md`
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
        showLauncherToast(`已导出 ${link.download}`)
      } catch (error) {
        showLauncherToast(`导出失败：${String(error?.message ?? error).slice(0, 60)}`)
      }
    }

    // 上下文查看：有锚点就滚过去高亮；没有就固定文案告知（不静默）
    const viewInContext = (turn, event) => {
      const anchor = event?.currentTarget?.closest?.('[data-chat-flow-kind="turn-tail"]') ?? null
      if (anchor !== null) {
        anchor.scrollIntoView({ block: 'center', behavior: 'smooth' })
        anchor.classList.add('launcher-turn-highlight')
        setTimeout(() => anchor.classList.remove('launcher-turn-highlight'), 1600)
        return
      }
      const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => /上下文/.test(node.textContent ?? ''))
      if (tab !== null) tab.click()
      showLauncherToast(`第 ${turn?.turnIndex ?? 1} 轮暂无锚点，已停留在当前会话`)
      window.dispatchEvent(new CustomEvent('launcher:turn-action', { detail: { id: 'launcher.viewInContext' } }))
    }

    /**
     * FR-41 降级版：新建会话并把该轮正文以 `> ` 引用块填进 composer，明确告知「未复制上下文」。
     * 不碰原会话内容：只读 DOM 取正文 + 走宿主 session.new。
     */
    const branchToNewSession = async (turn) => {
      const quote = typeof turn?.text === 'string' ? turn.text.trim() : ''
      if (quote.length === 0) {
        showLauncherToast('分支失败：取不到这一轮的正文')
        return
      }
      const quoted = quote.split('\n').map((line) => (line.length === 0 ? '>' : `> ${line}`)).join('\n')
      let created = false
      try {
        const rows = CURRENT_CTX?.shortcuts?.registry?.commands
        const row = rows?.get?.('session.new')
        if (row !== undefined) {
          const verdict = row.resolve?.({ region: 'page', modal: null, source: 'menu' })
          if (verdict?.status === 'handled' && typeof verdict.run === 'function') {
            verdict.run()
            created = true
          }
        }
      } catch {
        created = false
      }
      if (!created && typeof CURRENT_CTX?.layout?.selectPanel === 'function') {
        try {
          CURRENT_CTX.layout.selectPanel('conversation')
          created = true
        } catch {
          created = false
        }
      }
      if (!created) {
        showLauncherToast('分支失败：无法新建会话')
        return
      }
      // 等「新会话的 composer」出现再填：旧 composer 一直在 DOM 里，
      // 判据必须是元素身份变了（旧节点被卸载、新节点挂上），而不是「存在即可」。
      const before = document.querySelector('[contenteditable="true"], textarea')
      const started = Date.now()
      const waitForComposer = () => {
        const now = document.querySelector('[contenteditable="true"], textarea')
        const replaced = now !== null && now !== before
        if (replaced || Date.now() - started > 2500) {
          fillComposerByDom(quoted)
          showLauncherToast('已新建会话并引用该轮，未复制上下文')
          return
        }
        setTimeout(waitForComposer, 150)
      }
      waitForComposer()
    }

    const rows = [
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.export', order: 20, label: '导出本轮', icon: '⤓', onClick: downloadExport },
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.viewInContext', order: 30, label: '在上下文视图中查看此轮', icon: '◎', onClick: viewInContext },
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.branch', order: 40, label: '在新对话中分支', icon: '⑂', onClick: branchToNewSession },
    ]

    for (const row of rows) {
      try {
        const Component = (slotProps) => {
          const turn = readTurnFromNode(slotProps?.anchorNode ?? null)
          return h('button', {
            type: 'button',
            className: 'launcher-turn-action',
            'data-action': row.id,
            title: row.label,
            'aria-label': row.label,
            onClick: (event) => row.onClick(readTurnFromNode(event?.currentTarget), event),
          },
            h('span', { className: 'launcher-turn-action__icon', 'aria-hidden': 'true' }, row.icon ?? '·'),
            h('span', { className: 'launcher-turn-action__label' }, row.label))
        }
        if (typeof ctx?.slots?.inject === 'function') {
          disposers.push(ctx.slots.inject(row.slot, () => ctx.slots.register({
            name: row.slot,
            id: row.id,
            order: row.order,
            inject: () => ({}),
          }, Component)))
        }
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 注册会话动作失败', row.id, error)
      }
    }
    return disposers.filter((d) => typeof d === 'function')
  }


  /**
   * FR-38：从宿主取上下文用量（system / chat / files / tools + 百分比 + 建议）。
   * 读不到返回 null —— 调用方整项不显示、入口置灰，不许拿外壳状态顶替。
   * @param {object} ctx - 客户端上下文。
   * @returns {{ system:number, chat:number, files:number, tools:number, used:number, limit:number, pct:number }|null} 用量。
   */
  function readContextUsage(ctx) {
    // 插件 ctx 是代理：读未 inject 的属性会在 **get 阶段** throw，`?.` 拦不住。
    // 所以每个候选都单独 try/catch；服务没声明就拿不到，返回 null（入口置灰，不造假数据）。
    const safe = (fn) => {
      try {
        return fn()
      } catch {
        return null
      }
    }
    const candidates = [
      safe(() => ctx?.tokenMeter?.getSnapshot?.()),
      safe(() => ctx?.tokenMeter?.snapshot?.()),
      safe(() => ctx?.contextMeter?.getSnapshot?.()),
      safe(() => ctx?.composer?.meter?.()),
    ]
    for (const raw of candidates) {
      if (raw === null || raw === undefined || typeof raw !== 'object') continue
      const breakdown = raw.breakdown ?? raw
      const system = Number(breakdown.systemTokens ?? breakdown.system ?? 0)
      const tools = Number(breakdown.toolsTokens ?? breakdown.tools ?? 0)
      const chat = Number(breakdown.messageTokens ?? breakdown.chat ?? 0)
      const files = Number(breakdown.filesTokens ?? breakdown.files ?? 0)
      const used = Number(raw.surfaceTokens ?? raw.used ?? system + tools + chat + files)
      const limit = Number(raw.limit ?? raw.contextLimit ?? raw.windowTokens ?? 0)
      if (!Number.isFinite(used) || used <= 0 || !Number.isFinite(limit) || limit <= 0) continue
      const pct = Math.min(100, Math.round((used / limit) * 100))
      return { system, chat, files, tools, used, limit, pct }
    }
    return null
  }


  function ownCatalogRowsFor(ctx) {
    // 判定放在 resolve() 里现算：注册时 `ctx.slots.entries('main')` 里目标面板可能还没注册
    const currentPage = () => {
      try {
        return ctx?.layout?.panelInfo?.getSnapshot?.().activePanelId ?? 'conversation'
      } catch {
        return 'conversation'
      }
    }
    const onPage = () => {
      const page = currentPage()
      return page === null || page === undefined || page === 'conversation' || page === 'plugins'
    }
    const keyReady = () => resolveMainKey(ctx, RAIL_CANDIDATES.plugins) !== null
    const runWorkbench = () => {
      const key = resolveMainKey(ctx, RAIL_CANDIDATES.plugins)
      if (key !== null) ctx.layout?.selectPanel?.(key)
    }
    const resolveWorkbench = () => (onPage() && keyReady() ? { status: 'handled', run: runWorkbench } : { status: 'pass' })
    const wrapReady = () => onPage()
    return [
      ...(typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEV_PANEL__ === true
        ? [{ id: 'launcher.devPanel', label: '外壳调试面板', hint: '开发用：面板/分屏/右栏宽度/codeWrap/权限', regions: ['page'], aliases: [], resolve: () => ({ status: 'handled', run: () => window.dispatchEvent(new CustomEvent('launcher:open-dev-panel')) }) }]
        : []),
      { id: 'launcher.theme.toggle', label: '切换主题', hint: '浅色 / 深色（⌘⇧L）', regions: ['page'], aliases: [], resolve: () => ({ status: 'handled', run: () => window.dispatchEvent(new CustomEvent('launcher:toggle-theme')) }) },
      { id: 'launcher.codeWrap.toggle', label: '切换代码块自动换行', hint: '开/关长代码横向滚动', regions: ['page', 'editable'], aliases: [], resolve: () => (wrapReady() ? { status: 'handled', run: () => window.dispatchEvent(new CustomEvent('launcher:toggle-code-wrap')) } : { status: 'pass' }) },
      { id: 'launcher.pluginWorkbench', label: '打开插件工作台', hint: '插件页（plugin:<id>）', regions: ['page', 'editable'], aliases: [], resolve: resolveWorkbench },
    ]
  }


  function collectCommands(ctx) {
    // 05 §6.5 实测口径：条目源 = ctx.shortcuts.registry.commands（Map）。
    // catalog.getSnapshot() 只是键位展示（无 regions/resolve），不能用。
    const registry = ctx?.shortcuts?.registry
    const map = registry?.commands
    if (!(map instanceof Map)) return []
    const out = []
    const seen = new Set()
    for (const cmd of map.values()) {
      if (cmd === null || typeof cmd !== 'object') continue
      const id = cmd.id
      if (typeof id !== 'string' || id.length === 0) continue
      const rawLabel = typeof cmd.label === 'function' ? cmd.label() : cmd.label
      const label = typeof rawLabel === 'string' ? rawLabel : id
      const regions = Array.isArray(cmd.regions) ? cmd.regions : []
      if (!regions.some((region) => region === 'page' || region === 'editable')) continue
      const modals = Array.isArray(cmd.modals) ? cmd.modals : []
      if (modals.length > 0 && regions.length === 0) continue
      if (seen.has(id)) continue
      seen.add(id)
      let disabled = false
      try {
        const verdict = cmd.resolve?.(MENU_CONTEXT)
        disabled = !(verdict === 'handled' || verdict?.status === 'handled')
      } catch {
        disabled = true
      }
      out.push({ id, label, hint: typeof cmd.hint === 'string' ? cmd.hint : cmd.description, disabled, command: cmd })
    }
    return out
  }




  /**
   * 起手式的 DOM 兜底填充：优先 contenteditable（execCommand insertText），其次 textarea（原生 setter + input 事件）。
   * 只填入、不发发送键，不提交任何请求。
   * @param {string} text - 要填入的整句。
   * @returns {boolean} 是否填成功。
   */
  function fillComposerByDom(text) {
    try {
      const root = document.querySelector('[data-slot="conversation.composer"]')
        ?? document.querySelector('[contenteditable="true"]')?.closest('[class*="composer"]')
        ?? null
      const editable = root?.querySelector('[contenteditable="true"]') ?? null
      if (editable !== null) {
        editable.focus()
        const selection = window.getSelection()
        const range = document.createRange()
        // 起手式是「填一个建议」：先全选清空再填，不做追加（09 已记口径）
        range.selectNodeContents(editable)
        selection?.removeAllRanges()
        selection?.addRange(range)
        if (document.execCommand('delete')) {
          range.selectNodeContents(editable)
          range.collapse(false)
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
        // Lexical 类 composer：用 paste 事件写入（insertText 的 \n 会被吞，insertParagraph 无效）
        if (String(text).includes('\n')) {
          try {
            const data = new DataTransfer()
            data.setData('text/plain', String(text))
            // defaultPrevented = Lexical 接住了 paste；未被接住则继续走逐行插入（别报假成功）
            const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
            editable.dispatchEvent(event)
            if (event.defaultPrevented) return true
          } catch {
            /* 退逐行插入 */
          }
        }
        const lines = String(text).split('\n')
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (line.length > 0) document.execCommand('insertText', false, line)
          if (index < lines.length - 1) document.execCommand('insertParagraph')
        }
        // 光标放到文末，别留全选
        const endRange = document.createRange()
        endRange.selectNodeContents(editable)
        endRange.collapse(false)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(endRange)
        return true
      }
      const textarea = document.querySelector('textarea')
      if (textarea !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(textarea, text)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.focus()
        return true
      }
    } catch {
      return false
    }
    return false
  }

  /**
   * 主题落地器（原宿主 layout 的 apply(snapshot)，随同名替换一起搬回来）：
   * 写 colorScheme / data-ds-theme-source / body[data-ds-theme-dark] / 字体变量。
   * 不做这一步，setTheme 只改 preference，页面不变色。
   */
  const appliedThemeTokens = []

  function applyThemeDom() {
    try {
      const snapshot = CURRENT_CTX?.theme?.getTheme?.()
      if (snapshot === null || snapshot === undefined) return
      const scheme = snapshot.active?.colorScheme ?? 'light'
      const root = document.documentElement
      root.style.colorScheme = scheme
      root.setAttribute('data-ds-theme-source', snapshot.preference === 'system' ? 'system' : scheme)
    root.removeAttribute('data-ds-theme-dark')
      const body = document.body
      if (body === null) return
      // 宿主 palette 认这个属性名（DARK_ATTRIBUTE = 'data-ds-dark-theme'）
      if (scheme === 'dark') body.setAttribute('data-ds-dark-theme', '')
      else body.removeAttribute('data-ds-dark-theme')
      // 主题自带 tokens 写成内联变量：先撤上一轮自己写的，别覆盖别人写的
      for (const name of appliedThemeTokens) body.style.removeProperty(name)
      appliedThemeTokens.length = 0
      for (const [name, value] of Object.entries(snapshot.active?.tokens ?? {})) {
        if (typeof value !== 'string') continue
        body.style.setProperty(name, value)
        appliedThemeTokens.push(name)
      }
      // meta[name=theme-color] 按 body 计算背景更新
      try {
        const meta = document.querySelector('meta[name="theme-color"]')
        if (meta !== null) meta.setAttribute('content', getComputedStyle(body).backgroundColor)
      } catch {
        /* 没有 meta 就跳过 */
      }
      for (const [role, px] of Object.entries(snapshot.fontSizes ?? {})) {
        if (Number.isFinite(px)) body.style.setProperty(`--dsw-font-size-${role}`, `${px}px`)
      }
      for (const [role, family] of Object.entries(snapshot.fontFamilies ?? {})) {
        if (typeof family === 'string' && family.length > 0) body.style.setProperty(`--dsw-font-family-${role}`, family)
        else body.style.removeProperty(`--dsw-font-family-${role}`)
      }
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 主题落地失败', error)
    }
  }

  /** 空态判据（与 lib/new-session.js 的 emptyStateDecision 同口径）。 */
  function emptyStateDecision(input) {
    const force = input.force ?? (typeof window !== 'undefined' ? window.__DSH_LAUNCHER_EMPTY__ : undefined)
    // 开发期开关放最前面：否则没有会话时永远走不到 forced-on
    if (force === 'off') return { render: false, reason: 'forced-off' }
    if (force === 'on') return { render: true, reason: 'forced-on' }
    // 不在会话页（面板已切到插件/归档等）就不画
    if (input.activePanelId !== null && input.activePanelId !== undefined) return { render: false, reason: 'other-panel' }
    // 宿主自己画了空态就不画（不许双空态）
    if (input.hostEmptyState === true) return { render: false, reason: 'host-empty-state' }
    // 有消息就不画
    const messages = Number(input.messageCount)
    if (Number.isFinite(messages) && messages > 0) return { render: false, reason: 'has-messages' }
    // root 拿不到 sessionId：只要当前在会话页、宿主没画空态、没有消息，就用我们的卡片
    return { render: true, reason: 'ok' }
  }


  /** 卡片布局量（与 lib/new-session.js 的 cardLayout 同口径）。 */
  function cardLayout(width, height) {
    const narrow = width <= 760
    return {
      width: Math.min(440, width),
      // 空态要给宿主 hero+composer 让地方：卡片最高 260px（内部滚动），不要把 composer 顶出视口
      minHeight: Math.min(260, Math.round((height * (narrow ? 36 : 46)) / 100)),
      columns: narrow ? 1 : 2,
    }
  }

  /** 空会话首屏（FR-36）：主题标 + 标题 + 说明 + 四个起手式；点起手式只填入不发送。 */
  function EmptyStateCard(props) {
    const layout = props.layout
    const onStarter = (id) => {
      const item = STARTERS.find((entry) => entry.id === id)
      if (item === undefined) return
      const ctx = CURRENT_CTX
      // DOM 填充优先：ctx.composer.fill 存在但可能是 no-op（实测填不进去），不能当成功
      let filled = fillComposerByDom(item.text)
      if (!filled) {
        try {
          if (typeof ctx?.composer?.fill === 'function') {
            ctx.composer.fill(item.text)
            ctx.composer.focus?.()
            filled = true
          }
        } catch {
          filled = false
        }
      }
      if (!filled) showLauncherToast('起手式填不进去：没找到输入框')
      if (filled && typeof props.onFilled === 'function') props.onFilled()
      window.dispatchEvent(new CustomEvent('launcher:starter', { detail: { id, text: item.text, filled } }))
    }
    return h('div', { className: 'launcher-empty', 'data-launcher-empty': 'our' },
      h('div', { className: 'launcher-empty__card', style: { maxWidth: `${layout.width}px`, minHeight: `${layout.minHeight}px` } },
        h('div', { className: 'launcher-empty__theme', 'aria-hidden': 'true' }, 'dsh'),
        h('h2', { className: 'launcher-empty__title' }, '从一个问题开始'),
        h('p', { className: 'launcher-empty__body' }, '选一个起手式，或直接在下面输入；起手式只会填进输入框，不会替你发送。'),
        h('div', { className: 'launcher-empty__starters', 'data-columns': String(layout.columns) },
          STARTERS.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'launcher-empty__starter',
            onClick: () => onStarter(item.id),
          }, item.label))),
        h('p', { className: 'launcher-empty__hint' }, '提示：⌘K 打开命令面板')))
  }

  /**
   * 主区外观预览（票 32）：宿主没提供 main 面板、或显式打开预览时，用 v17 的
   * 对话流 + 卡片 + 输入行 + 命令面板填满主区。真实会话仍走宿主 main 槽；这里只做
   * 「外壳自己的主区」演示与窄窗走查，状态全部落在本组件内（写操作只改本地状态）。
   * 渲染与状态变换都在 lib/main-view.js（生成到 main-from-lib 区），组件只做 React 接线。
   */
  function MainPreview(props) {
    const thread = MAIN_DEMO_THREAD
    const [approvals, setApprovals] = React.useState({})
    const [expanded, setExpanded] = React.useState({})
    const [crit, setCrit] = React.useState({})
    const [composer, setComposer] = React.useState('')
    const [paletteOpen, setPaletteOpen] = React.useState(false)
    const [paletteQuery, setPaletteQuery] = React.useState('')
    const [paletteIndex, setPaletteIndex] = React.useState(0)
    const [modelPopover, setModelPopover] = React.useState(() => createPopoverState())
    const modelPopRef = React.useRef(null)
    const threadRef = React.useRef(null)
    const canSend = composerCanSend(composer)
    const shown = paletteFilter(MAIN_DEMO_COMMANDS, paletteQuery)
    // 首次挂载直接落到底部：打开主区先看到最新一轮，之后再按「贴底才跟随」滚动。
    React.useEffect(() => {
      const node = threadRef.current
      if (node !== null) node.scrollTop = node.scrollHeight
    }, [])
    React.useEffect(() => {
      const node = threadRef.current
      if (node !== null && shouldFollowScroll({ scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight })) {
        node.scrollTop = node.scrollHeight
      }
    }, [approvals, expanded, crit])
    const send = () => {
      if (!canSend) return
      setComposer('')
      props.onToast?.('演示模式：这条只进本地预览，不接真后端')
    }
    const onKeyDown = (event) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k'
      if (isPaletteKey) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        setPaletteIndex(0)
        return
      }
      if (!paletteOpen) return
      const action = paletteCommand({ key: event.key, hasSelection: shown.length > 0 })
      if (action === 'close') {
        event.preventDefault()
        setPaletteOpen(false)
        return
      }
      if (action === 'next') {
        event.preventDefault()
        setPaletteIndex((i) => paletteStep(i, 1, shown.length))
        return
      }
      if (action === 'prev') {
        event.preventDefault()
        setPaletteIndex((i) => paletteStep(i, -1, shown.length))
        return
      }
      if (action === 'run') {
        event.preventDefault()
        const cmd = shown[Math.min(paletteIndex, shown.length - 1)]
        if (cmd !== undefined) {
          setPaletteOpen(false)
          props.onCommand?.(cmd.id)
        }
      }
    }
    // 票 34：模型/等级浮层——贴触发按钮定位、点外/Esc/切页收起、选中即回写并关闭。
    React.useEffect(() => {
      if (modelPopover.kind === null) return
      const place = () => {
        const pop = modelPopRef.current
        if (pop === null || pop === undefined) return
        const pane = pop.closest?.('.launcher-pane') ?? null
        const trig = pane?.querySelector?.('[data-model-trigger]') ?? null
        if (trig === null || pane === null) return
        const tr = trig.getBoundingClientRect()
        const pr = pane.getBoundingClientRect()
        const spot = popoverPlacement({
          triggerRect: { right: tr.right - pr.left, top: tr.top - pr.top },
          popWidth: pop.offsetWidth || 260,
          viewportWidth: pr.width,
          viewportHeight: pr.height,
        })
        pop.style.left = `${spot.left}px`
        pop.style.bottom = `${spot.bottom}px`
        pop.style.top = 'auto'
        pop.style.right = 'auto'
      }
      place()
      window.addEventListener('resize', place)
      return () => window.removeEventListener('resize', place)
    }, [modelPopover.kind, props.modelState])
    React.useEffect(() => {
      if (modelPopover.kind === null) return
      const onDown = (event) => {
        if (event.target?.closest?.('[data-model-popover], [data-model-trigger]')) return
        setModelPopover(closePopover())
      }
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setModelPopover(closePopover())
        }
      }
      document.addEventListener('mousedown', onDown, true)
      window.addEventListener('keydown', onKey, true)
      return () => {
        document.removeEventListener('mousedown', onDown, true)
        window.removeEventListener('keydown', onKey, true)
      }
    }, [modelPopover.kind])
    React.useEffect(() => {
      if (modelPopover.kind !== 'model') return
      modelPopRef.current?.querySelector?.('[data-model-search]')?.focus?.()
    }, [modelPopover.kind])
    React.useEffect(() => {
      if (props.settingsOpen === true) setModelPopover(closePopover())
    }, [props.settingsOpen])
    const actModel = (kind) => setModelPopover((prev) => togglePopover(prev, kind))
    const chooseModel = (id) => { props.onPickModel?.(id); setModelPopover(closePopover()) }
    const chooseReason = (id) => { props.onPickReason?.(id); setModelPopover(closePopover()) }
    return h(React.Fragment, null,
      renderMainView(h, {
        thread,
        approvals,
        expanded,
        crit,
        composer: { value: composer, canSend },
        composerExtras: renderModelTrigger(h, { state: props.modelState, popover: modelPopover.kind, onAct: actModel }),
        palette: { open: paletteOpen, query: paletteQuery, commands: MAIN_DEMO_COMMANDS, index: paletteIndex },
        threadRef,
        onApproval: (id, choice) => setApprovals((state) => applyApproval(state, id, choice)),
        onApprovalReset: (id) => setApprovals((state) => resetApproval(state, id)),
        onToggleFold: (id) => setExpanded((state) => toggleExpanded(state, id)),
        onToggleTools: (id) => setExpanded((state) => toggleExpanded(state, id)),
        onToggleReport: (title) => setExpanded((state) => toggleExpanded(state, `report:${title}`)),
        onToggleCrit: (key) => setCrit((state) => toggleExpanded(state, key)),
        onCompose: setComposer,
        onSend: send,
        onPaletteQuery: (query) => { setPaletteQuery(query); setPaletteIndex(0) },
        onPaletteMove: (delta) => setPaletteIndex((i) => paletteStep(i, delta, shown.length)),
        onPaletteRun: (cmd) => { setPaletteOpen(false); props.onCommand?.(cmd.id) },
        onPaletteClose: () => setPaletteOpen(false),
        onKeyDown,
      }),
      renderModelPopover(h, {
        kind: modelPopover.kind,
        query: modelPopover.query,
        state: props.modelState,
        popoverRef: modelPopRef,
        onQuery: (value) => setModelPopover((prev) => setPopoverQuery(prev, value)),
        onPickModel: chooseModel,
        onPickReason: chooseReason,
      }))
  }

  /** 外壳本体：56 图标栏 + 侧栏列 + 主区 + 右栏轨道 + 底状态条 + 浮层。 */
  function LauncherRoot(props) {
    const renderSlot = props.renderSlot
    // 侧栏三段卡片（票 31）：折叠态由本地 state 管，会话行来自宿主 useSessions，
    // 需要你计数由 props.sidebarNeed / props.sidebarState 现算（不硬编码）。
    const [sidebarSections, setSidebarSections] = React.useState({ need: true, workspaces: true, tasks: true })
    const [sidebarCollapsedWs, setSidebarCollapsedWs] = React.useState({})
    const hasSessionsHook = typeof props.useSessions === 'function'
    let sidebarSessions = null
    if (hasSessionsHook) {
      try { sidebarSessions = props.useSessions((snapshot) => snapshot ?? null) } catch { sidebarSessions = null }
    }
    const sidebarState = sidebarSessions === null && props.sidebarState === undefined
      ? buildSidebarState({ enabled: false })
      : buildSidebarState({
        state: props.sidebarState,
        sessions: sidebarSessions,
        need: props.sidebarNeed,
        open: sidebarSections,
        activeId: props.selectedSessionId,
        enabled: hasSessionsHook,
      })
    const toggleSidebarSection = (key) => setSidebarSections((prev) => ({ ...prev, [key]: prev[key] === false }))
    const toggleSidebarWorkspace = (id) => setSidebarCollapsedWs((prev) => ({ ...prev, [id]: prev[id] !== true }))
    const openSidebarSession = (id) => {
      if (id === undefined || id === null) return
      try {
        const workspaceNav = CURRENT_CTX?.get?.('uiWorkspace')
        if (workspaceNav !== undefined && typeof workspaceNav.openSession === 'function') { workspaceNav.openSession(id); return }
      } catch { /* 落到下一档 */ }
      try { CURRENT_CTX?.sessions?.open?.(id) } catch { /* 忽略：没有会话服务就保持原样 */ }
    }
    const [viewportWidth, setViewportWidth] = React.useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
    React.useEffect(() => {
      const onResize = () => setViewportWidth(window.innerWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [])
    // 标准 props 是选择器钩子（SnapshotSelectorHook），必须带 selector 调用，
    // 直接 useDockOpen() 会报 `selector is not a function` 并把 root 整个打崩。
    const dockOpenHook = props.useDockOpen === undefined ? false : props.useDockOpen((open) => open)
    const [dockOpenEvent, setDockOpenEvent] = React.useState(() => {
      try { return window.__DSH_LAUNCHER_DOCK__ === true } catch { return false }
    })
    React.useEffect(() => {
      const onDock = (event) => setDockOpenEvent(event?.detail?.open === true)
      window.addEventListener('launcher:dock', onDock)
      return () => window.removeEventListener('launcher:dock', onDock)
    }, [])
    const dockOpen = dockOpenHook || dockOpenEvent
    const status = () => statusText({ page: props.statusPage, mode: props.statusMode, running: props.statusRunning, queued: props.statusQueued })
    // W3：拖拽把手 + canShow 接线。宽度只改 CSS 变量，不重绘右栏内容。
    // 03 FR-13：宽度按会话记忆（localStorage['dsh.launcher.dockWidth']），刷新后右栏默认收起、重开回该值
    const [dragWidth, setDragWidth] = React.useState(() => {
      try {
        const saved = Number(window.localStorage.getItem('dsh.launcher.dockWidth'))
        if (!Number.isFinite(saved) || saved < DOCK_MIN) return DOCK_WIDTH
        return clampDock(saved, window.innerWidth)
      } catch {
        return DOCK_WIDTH
      }
    })
    const [splitMode, setSplitMode] = React.useState(1)
    // 票 33：右栏当前面板 / 设置页开关与分组 / 密度 / 团队协作开关（后两项来自设置页）
    const [dockTab, setDockTab] = React.useState('review')
    const [settingsOpen, setSettingsOpen] = React.useState(false)
    const [settingsGroup, setSettingsGroup] = React.useState('general')
    // 票 35：回退命令「刚复制过」反馈（1.8s 后回落），只影响按钮文案，不持久化。
    const [rollbackCopied, setRollbackCopied] = React.useState(false)
    const [density, setDensity] = React.useState('cozy')
    const [teamOn, setTeamOn] = React.useState(false)
    // 票 34：模型/等级是真实状态源——输入行浮层与设置条目读同一份。
    const [modelState, setModelState] = React.useState(() => createModelState())
    // ≤860：侧栏转抽屉（默认收起），与 rail 互斥；主区从 rail 后起算
    const [drawerOpen, setDrawerOpen] = React.useState(false)
    const [themeMode, setThemeMode] = React.useState(() => {
      try {
        const pref = CURRENT_CTX?.theme?.getTheme?.()?.preference
        if (pref === 'dark' || pref === 'light') return pref
      } catch {
        /* 读不到就用 DOM 兜底 */
      }
      try {
        return document.documentElement.dataset.dsTheme === 'dark' ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    })
    // 票 35：设置页 Esc 关闭。挂 window 捕获，焦点不在面板 div 上也能关。
    React.useEffect(() => {
      if (!settingsOpen) return undefined
      const onSettingsKey = (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        setSettingsOpen(false)
      }
      window.addEventListener('keydown', onSettingsKey, true)
      return () => window.removeEventListener('keydown', onSettingsKey, true)
    }, [settingsOpen])
    const applyTheme = (next) => {
      setThemeMode(next)
      try {
        const ctx = CURRENT_CTX
        if (typeof ctx?.theme?.setTheme === 'function') {
          ctx.theme.setTheme(next)
          applyThemeDom()
          // 宿主没写标记时补写（便于断言；不覆盖宿主自己的值）
          const root = document.documentElement
          if (root.dataset.dsThemeSource === undefined || root.dataset.dsThemeSource === 'system') {
            root.dataset.dsThemeSource = next
          }
          return
        }
      } catch (error) {
        console.warn('dsh-client-ui-launcher: setTheme 失败，转 DOM 兜底', error)
      }
      try {
        document.documentElement.dataset.dsTheme = next
        document.documentElement.dataset.dsThemeSource = 'user'
      } catch {
        /* 忽略 */
      }
    }
    const toggleTheme = () => applyTheme((() => { try { return CURRENT_CTX?.theme?.getTheme?.()?.preference } catch { return undefined } })() === 'dark' ? 'light' : 'dark')
    /** 右栏开关：宿主 sidebarRight/命令 + 外壳轨道，两条入口（rail ▤ / ⌘⇧B）共用同一份状态。 */
    const toggleRef = React.useRef({ dock: null, theme: null })
    const layerRef = React.useRef({ palette: false, dev: false })
    const dockTimerRef = React.useRef(0)
    const toggleDock = () => {
      // 以模块级 store 为准（React 状态可能滞后一帧，导致"永远只开不关"）
      if (getDockOpen()) {
        if (dockTimerRef.current !== 0) { clearTimeout(dockTimerRef.current); dockTimerRef.current = 0 }
        // 关闭：宿主在 launcher 里不一定回 closeRightbar，外壳直接把轨道收掉（可视结果必须响应）
        DOCK_CLOSE_INTENT.user = true
        setDockOpen(false)
        setDockOpenEvent(false)
        // 关闭时不要再走宿主 toggle：那会把刚关掉的右栏重新打开
        try { CURRENT_CTX?.layout?.closeRightbar?.() } catch { /* 忽略 */ }
        return
      }
      setDockOpen(true)
      toggleRightbarHost()
      // 打开：先给宿主一帧；若宿主没接管（blocked / 无 occupant 等），外壳自己展开轨道
      dockTimerRef.current = setTimeout(() => {
        dockTimerRef.current = 0
        // 期间用户已关掉：不要写回 true，否则表现为「关掉又自己弹回来」
        if (!getDockOpen()) return
        const width = document.querySelector('.launcher-dock')?.getBoundingClientRect().width ?? 0
        if (width < 10) {
          setDockOpenEvent(true)
          setTimeout(() => {
            if (!getDockOpen()) return
            const retry = document.querySelector('.launcher-dock')?.getBoundingClientRect().width ?? 0
            if (retry < 10) showLauncherToast('右栏未就绪：先打开一个会话再展开')
          }, 250)
        }
      }, 200)
    }
    const narrow = viewportWidth <= 860
    // 宿主 MainPanel 的口径：面板 key 是 renderSlot 的第三参 `{ entryKey }`，
    // 当前面板从 usePanelInfo 选择器钩子取（我们自己在 inject 里提供了这个钩子）。
    const hostPolicy = (() => {
      try {
        return ctx?.permissions?.getSnapshot?.()?.filePolicy ?? ctx?.policy?.getSnapshot?.()?.filePolicy
      } catch {
        return undefined
      }
    })()
    const permissionLabel = (() => {
      const level = ['danger-full-access', 'workspace-write', 'read'].includes(hostPolicy) ? hostPolicy : 'workspace-write'
      return { 'danger-full-access': '完全权限', 'workspace-write': '工作区内修改', read: '仅可查看' }[level]
    })()
    const [hostHasMessages, setHostHasMessages] = React.useState(false)
    const [starterFilled, setStarterFilled] = React.useState(false)
    React.useEffect(() => {
      applyThemeDom()
      // 测试钩子：debug 开关下暴露 composer 填充器，便于无会话环境验多行插入
      if (typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEBUG__ === true) {
        window.__DSH_LAUNCHER_FILL__ = fillComposerByDom
      }
    }, [])
    toggleRef.current.dock = toggleDock
    toggleRef.current.theme = toggleTheme
    React.useEffect(() => {
      // 宿主右栏面板内的「收起右侧边栏」在换壳后不会回 closeRightbar：点它时外壳直接收轨道
      // 按宿主文案匹配（中/英、大小写不敏感）；宿主改文案则退化为无响应，不影响 rail ▤ / ⌘⇧B
      const COLLAPSE_LABELS = ['收起右侧边栏', '收起侧边栏', 'collapse right sidebar', 'hide right sidebar', 'collapse sidebar']
      const onHostCollapse = (event) => {
        const target = event?.target
        if (target === null || target === undefined || typeof target.closest !== 'function') return
        // 作用域收紧：只对右栏内的元素生效
        if (target.closest('.launcher-dock') === null) return
        const btn = target.closest('[aria-label], [title]')
        if (btn === null) return
        const label = String(btn.getAttribute('aria-label') ?? btn.getAttribute('title') ?? '').toLowerCase()
        if (!COLLAPSE_LABELS.some((word) => label.includes(word.toLowerCase()))) return
        DOCK_CLOSE_INTENT.user = true
        setDockOpen(false)
      }
      window.addEventListener('click', onHostCollapse, true)
      return () => window.removeEventListener('click', onHostCollapse, true)
    }, [])
    React.useEffect(() => {
      // composer 是 Lexical，root 上的 keydown 可能被它 stopPropagation：window capture 抢在前面。
      // 通过 ref 调最新的 toggle，避免拿到首次渲染的陈旧 dockOpen。
      const onShortcut = (event) => {
        if (event.key === 'Escape' && layerRef.current.dev && !layerRef.current.palette) {
          event.preventDefault()
          setDevOpen(false)
          return
        }
        const withMod = event.metaKey || event.ctrlKey
        if (!withMod || !event.shiftKey) return
        const key = String(event.key).toLowerCase()
        if (key === 'b') {
          event.preventDefault()
          event.stopPropagation()
          toggleRef.current.dock?.()
          return
        }
        if (key === 'l') {
          event.preventDefault()
          event.stopPropagation()
          toggleRef.current.theme?.()
        }
      }
      window.addEventListener('keydown', onShortcut, true)
      return () => window.removeEventListener('keydown', onShortcut, true)
    }, [])
    // 空态覆盖层要给 composer 让位：按 composer 实际高度算，不用固定 150px
    const [composerHeight, setComposerHeight] = React.useState(150)
    React.useEffect(() => {
      const measure = () => {
        const editable = document.querySelector('[contenteditable="true"]')
        if (editable === null) return
        // 从输入框往上找「composer 本体」：class 含 composer 或 _root，且高度 < 200（不要拿到整块会话区）
        let node = editable
        let height = Math.round(editable.getBoundingClientRect().height)
        while (node !== null && node !== document.body) {
          const rect = node.getBoundingClientRect()
          const cls = String(node.className ?? '')
          if (rect.height > 0 && rect.height < 200 && /composer|_root/.test(cls)) {
            height = Math.round(rect.height)
            break
          }
          node = node.parentElement
        }
        setComposerHeight(height + 24)
      }

      measure()
      const observer = new MutationObserver(measure)
      observer.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('resize', measure)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', measure)
      }
    }, [])
    React.useEffect(() => {
      const check = () => setHostHasMessages(document.querySelector('[data-chat-flow-kind]') !== null)
      check()
      const observer = new MutationObserver(check)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    const emptyDecision = emptyStateDecision({
      selectedSessionId: props.selectedSessionId ?? props.sessionId ?? null,
      messageCount: props.messageCount,
      hostEmptyState: props.hostEmptyState,
      messageCount: hostHasMessages ? 1 : props.messageCount,
      activePanelId: props.usePanelInfo === undefined ? null : props.usePanelInfo((info) => info.activePanelId),
    })
    const activePanelId = props.usePanelInfo === undefined
      ? null
      : props.usePanelInfo((info) => info.activePanelId)
    const ctx = CURRENT_CTX
    const commands = collectCommands(ctx)
    const [paletteOpen, setPaletteOpen] = React.useState(false)
    const paletteWasOpen = React.useRef(false)
    React.useEffect(() => {
      if (paletteWasOpen.current && !paletteOpen) {
        requestAnimationFrame(() => {
          const opener = openerRef.current
          if (opener !== null && opener.isConnected !== false && typeof opener.focus === 'function') {
            opener.focus()
            return
          }
          const fallback = document.querySelector('[data-slot="main"] textarea, [data-slot="main"] input, [data-slot="main"] [contenteditable="true"], .launcher-main textarea, .launcher-main input, .launcher-main [contenteditable="true"]')
          fallback?.focus?.()
        })
      }
      paletteWasOpen.current = paletteOpen
    }, [paletteOpen])
    const paneScrollRef = React.useRef(0)
    const [devOpen, setDevOpen] = React.useState(false)
    layerRef.current.palette = paletteOpen
    layerRef.current.dev = devOpen
    const [wrapOn, setWrapOn] = React.useState(codeWrapOn)
    // #1 焦点回位：打开面板时记住当时的活动元素，Esc 时优先还给它（选择器只作兜底）
    const openerRef = React.useRef(null)
    React.useEffect(() => {
      const openDev = () => setDevOpen(true)
      const flip = () => setWrapOn((on) => { setCodeWrapPref(!on); return !on })
      window.addEventListener('launcher:open-dev-panel', openDev)
      window.addEventListener('launcher:toggle-code-wrap', flip)
      const onThemeToggle = () => applyTheme((CURRENT_CTX?.theme?.getTheme?.()?.preference === 'dark') ? 'light' : 'dark')
      window.addEventListener('launcher:toggle-theme', onThemeToggle)
      return () => {
        window.removeEventListener('launcher:open-dev-panel', openDev)
        window.removeEventListener('launcher:toggle-code-wrap', flip)
        window.removeEventListener('launcher:toggle-theme', onThemeToggle)
      }
    }, [])
    const onDiagKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setDevOpen(false) }
    }
    const [paletteIndex, setPaletteIndex] = React.useState(0)
    const [query, setQuery] = React.useState('')
    const shown = commands.filter((cmd) => query === '' || String(cmd.label).includes(query))
    const dockCanShow = dockOpen && viewportWidth >= DOCK_HIDE_BELOW
    // 票 33：右栏有效宽度与四列几何都走 lib/dock-settings.js（与 layout/shell-layout 同一条公式）。
    // 收起→0、展开→固定宽度，列宽合计恒等于视口，主区由 minmax(0,1fr) 吸收，切换不跳、不溢出。
    const dockWidth = dockWidthFor({ viewportWidth, requestedWidth: dragWidth, open: dockOpen })
    const columns = dockColumnsFor({ viewportWidth, dockWidth, sidebarCollapsed: props.sidebarCollapsed === true })
    const mainWidth = columns.main
    const effectiveSplit = resolveSplit(splitMode, mainWidth, (typeof window === 'undefined' ? 900 : window.innerHeight) - 26)
    const [cols, rows] = SPLIT_GRID[effectiveSplit] ?? SPLIT_GRID[1]
    const mainKeys = (() => {
      try {
        return (CURRENT_CTX?.slots?.entries?.('main') ?? []).map((entry) => entry?.options?.key).filter((key) => typeof key === 'string')
      } catch {
        return ['conversation']
      }
    })()
    const paneKeys = assignPaneKeys(mainKeys, effectiveSplit)
    const lastPointerRef = React.useRef({ time: 0, x: 0 })
    const startDrag = (event) => {
      event.preventDefault()
      const now = Date.now()
      const last = lastPointerRef.current
      // 双击复位：两次 pointerdown 间隔 <300ms 且位移 <4px（preventDefault 后不会再收到 dblclick）
      if (now - last.time < 300 && Math.abs(event.clientX - last.x) < 4) {
        lastPointerRef.current = { time: 0, x: 0 }
        setDragWidth(clampDock(DOCK_WIDTH, viewportWidth))
        return
      }
      lastPointerRef.current = { time: now, x: event.clientX }
      const startX = event.clientX
      const startWidth = dragWidth
      const move = (e) => {
        const next = clampDock(startWidth - (e.clientX - startX), viewportWidth)
        setDragWidth(next)
        try { window.localStorage.setItem('dsh.launcher.dockWidth', String(next)) } catch { /* 忽略 */ }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
    const collapsed = props.sidebarCollapsed === true
    // 图标栏条目（票 30）：导航解析留在外壳，渲染交给 lib/shell-render.js 的 renderRail。
    // 解析不到 main key 的入口置灰（aria-disabled + 说明 title），不许 throw。
    const railEntries = RAIL_ENTRIES.map((entry) => {
      const railKey = entry.id === 'conversation'
        ? 'conversation'
        : resolveMainKey(ctx, RAIL_CANDIDATES[entry.id] ?? [entry.id])
      // 票 33：设置入口永远可点——打开外壳自己的六分组设置页（不依赖宿主是否注册 settings main key）。
      const isSettings = entry.id === 'settings'
      const disabled = isSettings ? false : railKey === null
      const title = entry.id === 'plugins'
        ? (disabled ? '插件工作台本版未接' : '插件工作台')
        : (disabled ? (entry.id === 'approvals' ? '见 设置 → 审批与权限' : '本版未接') : entry.label)
      return {
        id: entry.id,
        label: entry.label,
        icon: entry.id,
        active: props.activeRail === entry.id,
        badge: 0,
        disabled,
        title,
        onSelect: () => {
          if (disabled) return
          if (isSettings) { setSettingsOpen(true); return }
          try {
            ctx?.layout?.selectPanel?.(entry.id === 'conversation' ? null : railKey)
          } catch (error) {
            console.warn('dsh-client-ui-launcher: 导航失败', error)
          }
        },
      }
    })
    // 票 33：设置页动作 → 取值 + 副作用（状态机在 lib/dock-settings.js 的 applySetting，单测覆盖）。
    // 主题/密度/右栏开关即时生效；团队开关本地记；导航/回退给出可见反馈（不留假执行）。
    const handleSettingAction = (action) => {
      const { effect } = applySetting({ theme: themeMode, density, dockOpen, team: teamOn }, action)
      if (effect === null) return
      if (effect.type === 'theme') applyTheme(effect.value)
      else if (effect.type === 'density') setDensity(effect.value)
      else if (effect.type === 'team') setTeamOn(effect.value)
      else if (effect.type === 'dock') toggleRef.current.dock?.()
      else if (effect.type === 'nav') showLauncherToast(`该入口本版未接：${effect.target}`)
      else if (effect.type === 'copyRollback') {
        // 票 35：复制命令（remove → install → 重启），执行仍由用户按 runbook 手动完成。
        const command = rollbackSurface({ profile: launcherProfile() }).command
        let copied = false
        try {
          const pending = navigator.clipboard?.writeText?.(command)
          if (pending && typeof pending.catch === 'function') pending.catch(() => {})
          copied = typeof navigator.clipboard?.writeText === 'function'
        } catch (error) {
          console.warn('dsh-client-ui-launcher: 复制回退命令失败', error)
        }
        if (copied) {
          setRollbackCopied(true)
          showLauncherToast('回退命令已复制：按 runbook 三步执行，数据目录不动')
          if (typeof window !== 'undefined') window.setTimeout(() => setRollbackCopied(false), 1800)
        } else {
          showLauncherToast('复制失败：请手动选中命令复制')
        }
      }
      else if (effect.type === 'danger') showLauncherToast('回退原生 UI：请按 runbook 复制 remove / install / 重启 命令（演示）')
    }
    // 右栏面板内的按钮/输入：每个都有可见反馈，不留死控件（0 dead control）。
    const handleDockPanelAction = (action) => {
      if (action === null || action === undefined) return
      if (action.type === 'stage') showLauncherToast('全部暂存（演示）')
      else if (action.type === 'revert') showLauncherToast('还原所有改动（演示）')
      else if (action.type === 'commit') showLauncherToast('提交改动（演示）')
      else if (action.type === 'newTask') showLauncherToast('新建任务（演示）')
      else if (action.type === 'termRun') showLauncherToast('终端执行（演示）')
      else if (action.type === 'sideSend') showLauncherToast('侧聊已发送（演示，独立上下文）')
      else if (action.type === 'fileSel') showLauncherToast(`选中文件 ${Number(action.index) + 1}`)
      // termIn / sideIn：输入框自身保留输入态，不需要额外反馈
    }
    const runCommand = (cmd) => {
      setPaletteOpen(false)
      requestAnimationFrame(() => { const pane = document.querySelector('.launcher-pane'); if (pane !== null) pane.scrollTop = paneScrollRef.current })
      setQuery('')
      try {
        const verdict = cmd.command?.resolve?.(MENU_CONTEXT)
        if (verdict !== 'handled' && verdict?.status !== 'handled') return
        const run = verdict?.run ?? cmd.command?.run
        if (typeof run === 'function') run()
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 命令执行失败', error)
      }
    }
    const onKeyDown = (event) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k'
      if (isPaletteKey) {
        event.preventDefault()
        if (!paletteOpen) {
          openerRef.current = document.activeElement
          paneScrollRef.current = document.querySelector('.launcher-pane')?.scrollTop ?? 0
        }
        setPaletteOpen((open) => !open)
        setPaletteIndex(0)
        return
      }
      if (!paletteOpen) return
      if (event.key === 'Escape') {
        const target = nextEscapeTarget([paletteOpen ? 'palette' : null, devOpen ? 'debug' : null].filter(Boolean))
        if (target === null) return
        event.preventDefault()
        setPaletteOpen(false)
        requestAnimationFrame(() => { const pane = document.querySelector('.launcher-pane'); if (pane !== null) pane.scrollTop = paneScrollRef.current })
        // Esc 焦点回位：UX 口径是回到 composer 输入框（05-§4.2 / FR-06）
        requestAnimationFrame(() => {
          const opener = openerRef.current
          if (opener !== null && opener.isConnected !== false && typeof opener.focus === 'function') {
            opener.focus()
            return
          }
          // 兜底：composer 可能是 input / textarea / contenteditable，别只猜 textarea
          const fallback = document.querySelector(
            '[data-slot="main"] textarea, [data-slot="main"] input, [data-slot="main"] [contenteditable="true"], .launcher-main textarea, .launcher-main input, .launcher-main [contenteditable="true"]',
          )
          fallback?.focus?.()
        })
        return
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); setPaletteIndex((i) => (shown.length === 0 ? 0 : (i + 1) % shown.length)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setPaletteIndex((i) => (shown.length === 0 ? 0 : (i - 1 + shown.length) % shown.length)) }
      if (event.key === 'Enter' && shown[paletteIndex] !== undefined) { event.preventDefault(); runCommand(shown[paletteIndex]) }
    }
    const onRootKeyDown = (event) => {
      if (event?.target?.closest?.('.launcher-palette') !== null && event?.target?.closest?.('.launcher-palette') !== undefined) return
      onKeyDown(event)
    }
    // 票 32：主区移植默认接管「会话」这一格（v17 对话流 + 卡片 + 输入行 + 命令面板）。
    // 其他 main 面板（插件/归档等）仍走宿主槽；`__DSH_LAUNCHER_V17_MAIN__ = false`
    // 或 props.mainPreview=false 可回退到宿主会话（回退口留给排查与灰度）。
    const showMainPreview = props.mainPreview === true
      || (props.mainPreview !== false && (typeof window === 'undefined' || window.__DSH_LAUNCHER_V17_MAIN__ !== false))
    const conversationActive = activePanelId === null || activePanelId === 'conversation'
    const previewConversation = showMainPreview && conversationActive
    const renderMainPreview = () => h(MainPreview, {
      onToast: showLauncherToast,
      modelState,
      settingsOpen,
      onPickModel: (id) => setModelState((state) => pickModel(state, id)),
      onPickReason: (id) => setModelState((state) => pickReason(state, id)),
      onCommand: (id) => {
        if (id === 'theme') toggleTheme()
        else if (id === 'dock') toggleRef.current.dock?.()
        else if (id === 'settings') { try { selectPanel('dsh-settings') } catch { /* 宿主没有设置面板时忽略 */ } }
        else if (id === 'conversation') goConversation(CURRENT_CTX)
      },
    })
    return h('div', {
      className: 'launcher-shell',
      'data-drawer': narrow ? (drawerOpen ? 'open' : 'closed') : 'static',
      'data-shell': 'launcher',
      // 日夜两套令牌挂在外壳根（票 30）：切主题只改这一个属性，令牌即时生效
      'data-theme': themeMode,
      // 05 §6.3-7：属性挂外壳根，不挂 documentElement（避免改到宿主自己的代码块）
      'data-code-wrap': wrapOn ? 'on' : 'off',
      // 票 33：密度即时生效（compact 时行高变量收紧），主题/右栏已由 data-theme/--launcher-dock 承载
      'data-density': density,
      style: { '--launcher-composer-h': `${composerHeight}px`, '--launcher-dock': `${dockWidth}px`, '--launcher-sidebar': `${columns.sidebar}px` },
      'data-build': BUILD_STAMP,
      onKeyDown: onRootKeyDown,
    },
      renderRail(h, {
        leading: renderSlot('shell.leading', {}),
        entries: railEntries,
        dockOpen,
        narrow,
        drawerOpen,
        theme: themeMode,
        onToggleDock: () => toggleRef.current.dock?.(),
        onToggleDrawer: () => setDrawerOpen((open) => !open),
        onToggleTheme: toggleTheme,
        onOpenPalette: () => { openerRef.current = document.activeElement; setPaletteOpen(true); setPaletteIndex(0) },
      }),
      h('aside', { className: 'launcher-sidebar', 'data-drawer': narrow ? (drawerOpen ? 'open' : 'closed') : 'static' },
        collapsed
          ? null
          : sidebarState.available === true
            ? renderSidebar(h, sidebarState, {
              onToggle: toggleSidebarSection,
              onOpenSession: openSidebarSession,
              onToggleWorkspace: toggleSidebarWorkspace,
              collapsedWorkspaces: sidebarCollapsedWs,
              onCollapse: narrow ? () => setDrawerOpen(false) : undefined,
            })
            : renderSlot('sidebar', { collapsed, width: 280, drawer: narrow })),
      h('main', {
        className: 'launcher-main',
        'data-split': splitMode,
        style: { '--split-cols': cols, '--split-rows': rows },
      },
        h('div', { className: 'launcher-splitbar', role: 'toolbar', 'aria-label': '分屏档位' },
          SPLIT_MODES.map((mode) => h('button', {
            key: mode,
            type: 'button',
            className: `launcher-splitbar__mode${splitMode === mode ? ' on' : ''}`,
            'aria-pressed': splitMode === mode,
            onClick: () => {
              // 降档要给出可见反馈，否则用户视角是「点了没反应」（05 §6.2 允许降档）
              const target = resolveSplit(mode, mainWidth, (typeof window === 'undefined' ? 900 : window.innerHeight) - 26)
              if (target !== mode) showLauncherToast(`窗口太窄，已降为 ${target} 块（每块至少 360 宽）`)
              setSplitMode(mode)
            },
          }, String(mode))),
          h('button', {
            type: 'button',
            className: 'launcher-theme-chip',
            'aria-label': '切换日夜模式',
            'aria-pressed': themeMode === 'dark',
            title: themeMode === 'dark' ? '当前：深色，点击切浅色' : '当前：浅色，点击切深色',
            'data-theme-mode': themeMode,
            onClick: toggleTheme,
          }, themeMode === 'dark' ? '🌙' : '☀️')),
        h('div', { className: 'launcher-panes' },
          paneKeys.map((key, index) => h('div', {
            key: key ?? `unavailable-${index}`,
            className: `launcher-pane${key === null ? ' launcher-pane--unavailable' : ''}`,
            // 第一格反映真实 entryKey（断言用）；空位显式标 unavailable，不自造 key
            'data-pane': index === 0 ? (activePanelId ?? 'conversation') : (key ?? 'unavailable'),
          },
            key === null
              ? (showMainPreview ? renderMainPreview() : h('span', { className: 'launcher-pane__unavailable' }, '本版未接'))
              : index === 0
              ? (previewConversation
                ? renderMainPreview()
                : [
                  emptyDecision.render && !starterFilled
                    ? h(EmptyStateCard, { key: 'empty', layout: cardLayout(viewportWidth, typeof window === 'undefined' ? 900 : window.innerHeight), onFilled: () => setStarterFilled(true) })
                    : null,
                  activePanelId !== null && PANELS_NEEDING_BACK.includes(activePanelId)
                    ? h('div', { key: 'panel-back', className: 'launcher-panel-back' },
                      h('button', { type: 'button', className: 'launcher-panel-back__btn', onClick: () => goConversation(CURRENT_CTX) }, '← 返回会话'))
                    : null,
                  // 宿主子树（含 composer）必须照常渲染：卡片不能顶掉输入框
                  h('div', { key: 'host-main', className: 'launcher-pane__host' }, renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })),
                ])
              : renderSlot('main', {}, { entryKey: key }))))),
      h('aside', {
        className: 'launcher-dock',
        'data-dock-width': dockWidth,
      },
        // rightbar 是 single/root 槽：必须常驻挂载，否则宿主认为没有 occupant →
        // sidebarRight 没有可开 tab → toggle 永远 blocked → dockWidth 永远 0（互相等）。
        // 收起态用 CSS 隐藏（width:0/visibility:hidden），状态仍以宿主为准。
        h('div', {
          key: 'handle',
          className: 'launcher-dock__handle',
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-label': '右栏宽度（拖拽 320–520）',
          onPointerDown: startDrag,
          onDoubleClick: () => { const next = clampDock(DOCK_WIDTH, viewportWidth); setDragWidth(next); try { window.localStorage.setItem('dsh.launcher.dockWidth', String(next)) } catch { /* 忽略 */ } },
        }),
        // 票 33：右栏五面板（审阅/文件/终端/任务/侧聊）+ 收起按钮，内容来自 lib/dock-settings.js
        renderDockTabs(h, {
          tabs: DOCK_TABS,
          active: dockTab,
          onSelect: (id) => setDockTab(id),
          onCollapse: () => toggleRef.current.dock?.(),
        }),
        renderDockPanel(h, { tab: dockTab, data: DOCK_DEMO, onAction: handleDockPanelAction }),
        // rightbar 是 single/root 槽：必须常驻挂载，否则宿主认为没有 occupant →
        // sidebarRight 没有可开 tab → toggle 永远 blocked → dockWidth 永远 0（互相等）。
        // 换成 v17 五面板后，宿主右栏容器隐藏但保持挂载（DOCK_SETTINGS_CSS 里 display:none）。
        h('div', {
          key: 'rightbar-host',
          className: 'launcher-dock__host',
          'data-dock-hidden': dockWidth > 0 ? 'false' : 'true',
          'aria-hidden': dockWidth > 0 ? 'false' : 'true',
        }, renderSlot('rightbar', { width: dockWidth, viewportWidth, canShow: dockCanShow }))),
      renderStatusbar(h, status(), { bottom: renderSlot('shell.bottom', {}) }),
      h('div', { className: 'launcher-overlay' },
        renderSlot('shell.overlay', {}),
        // 票 33：六分组设置页（从 rail 设置入口打开；Esc 关闭）。主题/密度/右栏开关即时生效。
        settingsOpen
          ? h('div', {
            key: 'settings-layer',
            onKeyDown: (event) => { if (event.key === 'Escape') { event.preventDefault(); setSettingsOpen(false) } },
          }, renderSettings(h, {
            groups: SET_GROUPS,
            sections: SET_SECTIONS,
            shortcuts: SET_SHORTCUTS,
            active: settingsGroup,
            values: { theme: themeMode, density, dockOpen, team: teamOn, model: modelRowLabel(modelState), reason: modelState.reason },
            values: { theme: themeMode, density, dockOpen, team: teamOn },
            rollback: rollbackSurface({ profile: launcherProfile(), copied: rollbackCopied }),
            onGroup: (id) => setSettingsGroup(id),
            onAction: handleSettingAction,
            onClose: () => setSettingsOpen(false),
          }))
          : null),
      devOpen ? h('div', { className: 'launcher-diag', role: 'dialog', 'aria-label': '外壳调试面板', onKeyDown: onDiagKeyDown },
        h('header', { className: 'launcher-diag__head' },
          h('span', null, '外壳调试面板（开发用）'),
          h('button', { type: 'button', onClick: () => setDevOpen(false), 'aria-label': '关闭调试面板' }, '✕')),
        h('dl', { className: 'launcher-diag__list' },
          h('div', null, h('dt', null, '当前面板'), h('dd', null, String(activePanelId ?? 'conversation'))),
          h('div', null, h('dt', null, '分屏档位'), h('dd', null, String(splitMode))),
          h('div', null, h('dt', null, '右栏宽度'), h('dd', null, `${dockWidth}px${dockCanShow ? '' : '（隐藏）'}`)),
          h('div', null, h('dt', null, '代码块换行'), h('dd', null, wrapOn ? '开' : '关')),
          h('div', null, h('dt', null, '权限范围'), h('dd', null, permissionLabel)))) : null,
      paletteOpen ? h('div', { className: 'launcher-palette', 'data-index': paletteIndex, role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' },
        h('input', {
          className: 'launcher-palette__input',
          placeholder: '搜索命令…',
          'aria-label': '搜索命令',
          autoFocus: true,
          onKeyDown,
          value: query,
          onChange: (e) => { setQuery(e.target.value); setPaletteIndex(0) },
          'aria-controls': 'launcher-palette-list',
        }),
        h('ul', { id: 'launcher-palette-list', role: 'listbox', className: 'launcher-palette__list' },
          shown.length === 0 ? h('li', { className: 'launcher-palette__empty' }, '未接入命令源（宿主命令表待接线）') : null,
          shown.map((cmd, index) => h('li', {
            key: cmd.id,
            role: 'option',
            'aria-selected': index === paletteIndex,
            className: `launcher-palette__item${index === paletteIndex ? ' on' : ''}${cmd.disabled ? ' off' : ''}`,
            'aria-disabled': cmd.disabled === true,
            onClick: () => { if (cmd.disabled !== true) runCommand(cmd) },
            onMouseEnter: () => setPaletteIndex(index),
          }, h('span', { className: 'launcher-palette__label' }, cmd.label),
             h('span', { className: 'launcher-palette__hint' }, cmd.hint))))) : null,
    )
  }

  /** 已有声明方时的一条页内提示（§4.2-2：最坏是原生界面 + 提示，不是白屏）。 */
  function showConflict(detail) {
    if (typeof document === 'undefined' || document.body === null) return
    const existing = document.getElementById('launcher-conflict')
    if (existing !== null) return
    const bar = document.createElement('div')
    bar.id = 'launcher-conflict'
    bar.className = 'launcher-conflict'
    bar.textContent = '检测到 ui-layout 仍在启用，新外壳未接管（界面为原生布局）。' + (detail === undefined ? '' : `（${detail}）`)
    document.body.prepend(bar)
  }

  const DOCK_WIDTH = 380
  // 与 lib/layout.js 的 DOCK 保持一致（client 侧不 import，避免加载顺序耦合）
  const DOCK_MIN = 320
  // 用户主动关右栏的意图：宿主「开→立刻关」的自动 close 要被吞一次，用户关必须生效
  const DOCK_CLOSE_INTENT = { user: false }
  // 右栏显隐的唯一一份 store：apply() 的 layout face 与组件开关共用，避免 hook 恒 true 关不掉
  let DOCK_OPEN_STATE = false
  const DOCK_LISTENERS = new Set()
  let dockAutoCloseSwallowed = false
  function getDockOpen() { return DOCK_OPEN_STATE }
  function subscribeDock(listener) {
    DOCK_LISTENERS.add(listener)
    return () => DOCK_LISTENERS.delete(listener)
  }
  function setDockOpen(next) {
    if (next === true) dockAutoCloseSwallowed = false
    if (next === false) {
      if (DOCK_CLOSE_INTENT.user) DOCK_CLOSE_INTENT.user = false
      else if (!dockAutoCloseSwallowed) { dockAutoCloseSwallowed = true; return }
    }
    DOCK_OPEN_STATE = next
    try { window.__DSH_LAUNCHER_DOCK__ = DOCK_OPEN_STATE } catch { /* 忽略 */ }
    for (const listener of DOCK_LISTENERS) listener()
    try { window.dispatchEvent(new CustomEvent('launcher:dock', { detail: { open: DOCK_OPEN_STATE } })) } catch { /* 忽略 */ }
  }
  const DOCK_HIDE_BELOW = 1020
  // 票 33：夹紧口径统一到 lib/dock-settings.js 的 dockWidthFor（与右栏有效宽度同一份逻辑）。
  const clampDock = (w, viewportWidth) => dockWidthFor({ viewportWidth, requestedWidth: w, open: true })
  // 与 lib/panes.js 的 GRID 一致：1/2/4/6 档 → 行列
  const SPLIT_GRID = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2] }

  // 分屏 key 分配（与 lib/panes.js 的 assignPaneKeys 同口径）：只认真实 key，凑不满给 null（渲染成「本版未接」）
  const PANE_PREFERENCE = ['conversation', 'dsh-plugin-manager', 'dsh-archive-manager', 'schedules', 'plugins']
  function assignPaneKeys(availableKeys, count) {
    const available = new Set(Array.isArray(availableKeys) ? availableKeys : [])
    const ordered = []
    for (const key of PANE_PREFERENCE) if (available.has(key)) ordered.push(key)
    for (const key of available) if (!PANE_PREFERENCE.includes(key)) ordered.push(key)
    const total = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 1
    return Array.from({ length: total }, (_, index) => ordered[index] ?? null)
  }

  /** 与 lib/layout.js 的 maxSplit/resolveSplit 同口径：每块最小 360×240，放不下就降档。 */
  function maxSplitFor(width, height) {
    const w = Number(width)
    const h = Number(height)
    if (!Number.isFinite(w) || w <= 0) return 1
    for (const mode of [6, 4, 2, 1]) {
      const [columns, rows] = SPLIT_GRID[mode]
      const perWidth = (w - 12 * (columns - 1)) / columns
      const perHeight = (h - 12 * (rows - 1)) / rows
      if (perWidth >= 360 && perHeight >= 240) return mode
    }
    return 1
  }

  function resolveSplit(requested, width, height) {
    const max = maxSplitFor(width, height)
    return requested <= max ? requested : max
  }

  // Esc 层级（与 lib/escape.js 的 ESCAPE_ORDER 同口径）
  const ESCAPE_ORDER = ['selection', 'find', 'composer', 'palette', 'modal', 'debug', 'meter']
  function nextEscapeTarget(open) {
    const set = new Set(open)
    for (const layer of ESCAPE_ORDER) if (set.has(layer)) return layer
    return null
  }
  const SPLIT_MODES = [1, 2, 4, 6]
  // W5 命令清单**动态枚举**：由接线方（clientRoot 包装层）从宿主命令源取；取不到就是空表，
  // 面板显示「未接入命令源」——不拿硬编码清单充数（05 §6.5 TC-16-3/16-6）。

  // ---- HostGuard / Bootstrap（票 29）：注册前自检，不接管时保留原生 UI + 可关闭横幅 ----

  /** 宿主主题变量前缀（能读到的第一个）；读不到返回 undefined（guard 按"未知"跳过）。 */
  function detectThemePrefix() {
    if (typeof window !== 'undefined' && typeof window.__DSH_LAUNCHER_THEME_PREFIX__ === 'string') {
      return window.__DSH_LAUNCHER_THEME_PREFIX__
    }
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return undefined
    try {
      const style = getComputedStyle(document.documentElement)
      for (const prefix of ['--dsh-', '--dsw-']) {
        if (style.getPropertyValue(`${prefix}alias-bg-base`).trim().length > 0) return prefix
      }
    } catch {
      /* 读不到就跳过前缀检查 */
    }
    return undefined
  }

  /**
   * 从运行期 ctx 探测宿主形状（供 HostGuard）。
   * `ctx.slots.spec` 是宿主槽声明；读不到（旧宿主 / API 缺失）返回无 slots，Bootstrap 跳过自检而不是误判。
   * 允许 `window.__DSH_LAUNCHER_HOST_SHAPE__` 覆盖（canary 用变异基线注入）。
   * @param {object} ctx - cordis 上下文。
   * @returns {object} guardHost 的输入。
   */
  function readSlotDeclarations(ctx) {
    if (typeof ctx?.slots?.spec !== 'function') return undefined
    const found = []
    for (const name of Object.keys(CHILDREN)) {
      let spec
      try { spec = ctx.slots.spec(name) } catch { spec = undefined }
      if (spec !== undefined && spec !== null) found.push({ name, kind: spec.kind, scope: spec.scope })
    }
    return found.length > 0 ? found : undefined
  }

  function readRootRenderSlots(ctx) {
    try {
      const rootSpec = typeof ctx?.slots?.spec === 'function' ? ctx.slots.spec('root') : undefined
      if (rootSpec !== undefined && rootSpec !== null && Array.isArray(rootSpec.renderSlots)) return rootSpec.renderSlots
    } catch {
      /* 读不到就不检查 renderSlots */
    }
    return undefined
  }

  /** 宿主 layout 服务（ILayout）；ctx.get 绕过 inject 要求，读不到返回 undefined。 */
  function readLayoutService(ctx) {
    try { if (typeof ctx?.get === 'function') { const service = ctx.get('layout'); if (service !== undefined) return service } } catch { /* 继续兜底 */ }
    try { if (typeof ctx?.reflect?.get === 'function') { const service = ctx.reflect.get('layout', false); if (service !== undefined) return service } } catch { /* 继续兜底 */ }
    try { const service = ctx?.layout; if (service !== undefined) return service } catch { /* 读不到就跳过 */ }
    return undefined
  }

  /**
   * 从运行期 ctx 探测宿主形状（供 HostGuard）。
   * A2：版本读不到不再回退 baseline；slots 读不到由 guard 判 slots-unreadable（除非显式白名单）；
   * layoutMembers 必须真实探测并参与判定（ILayout 检查不再空转）。
   */
  function probeHostShape(ctx) {
    const override = typeof window !== 'undefined' ? window.__DSH_LAUNCHER_HOST_SHAPE__ : null
    if (override !== null && typeof override === 'object') return override
    // 「旧宿主无 slots API」只有显式环境白名单才兜底成 baseline 形状（见 README「兼容开关」）。
    const allowLegacySlots = typeof window !== 'undefined' && window.__DSH_LAUNCHER_ALLOW_LEGACY_SLOTS__ === true
    const slots = resolveSlots(readSlotDeclarations(ctx), { baselineSlots: HOST_BASELINE.slots, allowLegacy: allowLegacySlots })
    const renderSlots = readRootRenderSlots(ctx)
    const rawVersion = typeof window !== 'undefined'
      ? (window.__DSH_LAUNCHER_HOST_VERSION__ || window.__DSH_BOOT__?.release?.version || '')
      : ''
    const hostVersion = resolveHostVersion(rawVersion)
    const layoutMembers = probeLayoutMembers(readLayoutService(ctx), HOST_BASELINE.layoutMembers)
    return { hostVersion, baseline: HOST_BASELINE, slots, renderSlots, layoutMembers, themePrefix: detectThemePrefix() }
  }


  /** 渲染可关闭横幅（不持久化：关闭只移除本节点，下次启动仍提示）。重复 id 不叠加。 */
  function showHostGuardBanner(model) {
    if (typeof document === 'undefined' || document.body === null) return
    if (document.getElementById(model.id) !== null) return
    const bar = document.createElement('div')
    bar.id = model.id
    bar.className = 'launcher-hostguard'
    bar.setAttribute('role', 'alert')
    const head = document.createElement('div')
    head.className = 'launcher-hostguard__head'
    const title = document.createElement('span')
    title.textContent = model.title
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'launcher-hostguard__close'
    close.textContent = model.dismissLabel
    close.addEventListener('click', () => bar.remove())
    head.append(title, close)
    const reasons = document.createElement('ul')
    reasons.className = 'launcher-hostguard__reasons'
    for (const reason of model.reasons) {
      const li = document.createElement('li')
      li.textContent = reason
      reasons.append(li)
    }
    const command = document.createElement('pre')
    command.className = 'launcher-hostguard__cmd'
    command.textContent = model.command
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'launcher-hostguard__close'
    copy.textContent = '复制命令'
    copy.addEventListener('click', () => {
      try {
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(model.command)
      } catch {
        /* 复制失败就让用户手动选中命令 */
      }
    })
    bar.append(head, reasons, command, copy)
    document.body.prepend(bar)
  }

  function apply(ctx) {
    ensureStyle()
    // 票 29 Bootstrap：guard.ok 才注册 root；不 ok 时保留原生 UI + 横幅，不抛错、不重复。
    if (HOST_GUARD_DONE) return () => {}
    HOST_GUARD_DONE = true
    const hostShape = probeHostShape(ctx)
    // A2：slots/版本读不到都已是 blocker（不再 warn 后照常注册），统一走 createBootstrap 的注册/横幅分支。
    const bootstrap = createBootstrap({
      register: () => { window.__DSH_LAUNCHER_SHELL__ = true },
      mountBanner: showHostGuardBanner,
      profile: launcherProfile(),
    })
    const outcome = bootstrap.run(hostShape)
    if (!outcome.registered) {
      window.__DSH_LAUNCHER_SHELL__ = false
      window.__DSH_LAUNCHER_HOST_GUARD__ = outcome.guard
      console.info('dsh-client-ui-launcher: HostGuard 未接管', JSON.stringify((outcome.guard?.blockers ?? []).map((item) => item.code)))
      return () => { HOST_GUARD_DONE = false }
    }
    if (Array.isArray(outcome.guard?.warnings) && outcome.guard.warnings.length > 0) {
      console.warn('dsh-client-ui-launcher: HostGuard 警告（仍接管）', JSON.stringify(outcome.guard.warnings.map((item) => item.code)))
    }
    // 本实现的运行时标记：verify 用它 + [data-shell] 双特征判"现在装的是哪一版 layout"，
    // 不靠容易在两侧都出现的槽标记（实测 [data-slot="sidebar"] 两态都有）。
    window.__DSH_LAUNCHER_SHELL__ = true
    // 验证句柄：真机上从 console 调 ctx.layout.selectPanel(null) 等（技术负责人 W1 尾判据第 1 条）。
    // 只读暴露，不改行为；卸载时清掉。
    // M6：整份 cordis ctx 只在 DEBUG 下暴露，发布版不挂（同 __DSH_LAUNCHER_FILL__）
    if (typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEBUG__ === true) {
      window.__DSH_LAUNCHER_CTX__ = ctx
    }
    CURRENT_CTX = ctx
    // FR-39/42/43：会话流动作（真槽，槽在才注册）
    const turnDisposers = registerTurnActions(ctx)
    const permDisposers = registerPermissionPill(ctx)
    const modelDisposers = registerModelChip(ctx)
    const diagDisposers = registerContextDiagnostics(ctx)
    const dockDisposers = registerComposerDock(ctx)
    // FR-16：我们自己的动作也注册进同一个 catalog（与宿主条目同权）
    const OWN_ROWS_REGISTERED = Symbol.for('dsh.launcher.catalogRows')
    if (typeof ctx?.shortcuts?.register === 'function') {
      const rows = ownCatalogRowsFor(ctx)
      try {
        const register = ctx.shortcuts?.register
        if (typeof register === 'function') {
          rows.forEach((row) => register.call(ctx.shortcuts, {
            ...row,
            label: typeof row.label === 'function' ? row.label : () => row.label,
            aliases: [],
            modals: [],
            defaults: {},
          }))
          window.__DSH_LAUNCHER_OWN_ROWS__ = rows.length
        }
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 注册 catalog 行失败', error)
      }
    }
    const panelInfo = createPanelInfo()
    // 右栏轨道宽度是外壳的活，但显隐由 ctx.layout.openRightbar/closeRightbar 记账
    // （ui-sidebar-right 用这两个动作），所以它得是一个能订阅的小观测面。
    const dockHook = { getSnapshot: getDockOpen, subscribe: subscribeDock }
    // 上游 AppFrame 注册时带 foldedLandscape（窄窗折起），占据者可能会取 useFoldedLandscape；
    // 不 provide 会留下"required 未激活"的下一个坑，所以照带。
    let foldedLandscape = typeof window !== 'undefined' && window.innerWidth < 900
    const foldedListeners = new Set()
    const foldedHook = {
      getSnapshot: () => foldedLandscape,
      subscribe: (listener) => {
        foldedListeners.add(listener)
        return () => foldedListeners.delete(listener)
      },
    }
    const syncFolded = () => {
      const next = typeof window !== 'undefined' && window.innerWidth < 900
      if (next === foldedLandscape) return
      foldedLandscape = next
      for (const listener of foldedListeners) listener()
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', syncFolded)
    }
    const disposers = []
    try {
      // 面板选中的观测面：ui-sidebar 用 usePanelInfo(info => info.activePanelId === id) 决定高亮。
      disposers.push(ctx.slots.provideRoot({ hooks: { panelInfo } }))
      // PR-B：设置页四项（与肤色/字号同列）
      try {
        disposers.push(ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'launcher.approvalSettings',
          order: 30,
          inject: () => ({}),
        }, ApprovalSettings)))
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 注册审批设置项失败', error)
      }
      // 服务的对外面：本仓插件 inject 'layout' 并调用 selectPanel(null)。
      // 同一个 panelInfo 对象同时喂 provideRoot 与 ctx.layout：两份源会出现"切了面板侧栏不亮"。
      const face = {
        panelInfo,
        // 只接受已注册的 main key；未注册 throw 且保留原选择；null 永远合法。
        selectPanel: (id) => {
          if (id === null || id === undefined) {
            panelInfo.set(null)
            return
          }
          const registered = ctx.slots.entries('main').some((entry) => entry?.options?.key === id)
          if (!registered) throw new Error(`launcher: main key 未注册：${String(id)}`)
          panelInfo.set(id)
        },
        beginNavigation: () => new AbortController().signal,
        // 不碰列宽：侧栏的收起/展开与列宽求解是外壳自己的事（W2），布局服务面只暴露动作。
        toggleSidebar: () => {},
        // 由右栏占据者调用（track=false 表示全屏覆盖，不占主区轨道）
        openRightbar: (track) => setDockOpen(track !== false),
        closeRightbar: () => setDockOpen(false),
      }
      if (face.panelInfo !== panelInfo) throw new Error('launcher: panelInfo 必须是同一个对象')
      disposers.push(ctx.reflect.provide('layout', face))
      disposers.push(ctx.slots.register({
        name: 'root',
        children: CHILDREN,
        inject: () => ({ hooks: { dockOpen: dockHook, foldedLandscape: foldedHook } }),
      }, LauncherRoot))
    } catch (error) {
      // 不带半个服务面接管：服务面任一步失败就整段撤销、不注册 root，退回原生外壳 + 提示条。
      // 半个服务面会让 plugin-manager / archive-manager 静默消失（10、11c 专查这一条）。
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch { /* 撤销期的失败不再向上抛 */ }
      }
      disposers.length = 0
      const detail = String(error?.message ?? error).slice(0, 160)
      showConflict(detail.includes('already') ? detail : `layout 服务未接管，已回原生外壳（${detail}）`)
      console.warn('dsh-client-ui-launcher: 未接管 root 槽', error)
    }
    return () => {
      window.__DSH_LAUNCHER_SHELL__ = false
      HOST_GUARD_DONE = false
      if (window.__DSH_LAUNCHER_CTX__ === ctx) delete window.__DSH_LAUNCHER_CTX__
      if (typeof window.removeEventListener === 'function') window.removeEventListener('resize', syncFolded)
      // 会话动作的 dispose 只释放一次（之前被外层循环重复调用）
      for (const dockDispose of dockDisposers) {
        try { dockDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const modelDispose of modelDisposers) {
        try { modelDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const diagDispose of diagDisposers) {
        try { diagDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const permDispose of permDisposers) {
        try { permDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const turnDispose of turnDisposers) {
        try { turnDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
    }
  }

  // 只 inject slots：ctx.reflect 是上下文自带的属性，不是可注入的服务——
  // 把 reflect 写进 inject 会让插件等一个不存在的服务，连带 ui-sidebar/ui-chat 全 pending
  // （真机实测：`web boot: 3 required entries did not activate … waiting for service: reflect`）。
  return { inject: ['slots', 'shortcuts', 'theme'], apply }
} })
