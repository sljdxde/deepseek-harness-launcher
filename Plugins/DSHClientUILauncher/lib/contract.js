/**
 * 宿主槽契约的包内常量表（05-设计 §5.3 的"运行期兜底"要用它）。
 *
 * 这些名字不是我们的 API，是宿主 @deepseek-ai/dsh-client-ui-layout 的私有契约：
 * 声明一个槽 = 拿到它唯一的渲染权，声明漏一个，对应区域就整块消失且控制台 0 报错。
 * 所以名字、kind 在这里冻结一份，启动期与真实声明比对、CI 与快照比对（§5.1/§5.2）。
 *
 * 改这张表必须同时改 contracts/host-baseline.json 并在 PR 里写"宿主改了什么、
 * 我们跟进了什么"（06-设计评审 R-10）。
 */

/** root 之外由本包重新声明的 6 个子槽，顺序即 §4.1 表格顺序。 */
export const SUB_SLOTS = Object.freeze([
  { name: 'sidebar', kind: 'single' },
  { name: 'main', kind: 'keyed' },
  { name: 'rightbar', kind: 'single' },
  { name: 'shell.bottom', kind: 'single' },
  { name: 'shell.overlay', kind: 'list' },
  { name: 'shell.leading', kind: 'single' },
])

/** root 槽签名里必须出现的 renderSlots 名（AppFrameProps）。 */
export const ROOT_RENDER_SLOTS = Object.freeze(SUB_SLOTS.map((slot) => slot.name))

/**
 * ui-sidebar 在 `sidebar` 槽内部声明的席位。走 §4.3 落法 A（自绘侧栏）时，
 * 这些席位必须同名重新声明，否则注册进它们的插件（ui-workspace / ui-settings）
 * 会静默消失。席位清单进快照，不假设它稳定。
 */
export const SIDEBAR_SEATS = Object.freeze([
  'sidebar.toggle.badge',
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'sidebar.panellist',
  'sidebar.panellist.actions',
  'sidebar.workspaces',
  'sidebar.settings',
  'sidebar.footer.action',
  'sidebar.session.action',
])

/** shell.overlay 里本包自己的条目 id（前缀固定 launcher.，避免与宿主条目抢排序）。 */
export const OVERLAY_IDS = Object.freeze({
  cmdk: 'launcher.cmdk',
  toast: 'launcher.toast',
  approval: 'launcher.approval',
  selection: 'launcher.selection',
  composerPop: 'launcher.composer-pop',
  contractWarning: 'launcher.contract-warning',
})

/** 右栏 6 个内置标签，顺序即标签栏顺序（原型 DOCK_TABS）。 */
export const DOCK_TABS = Object.freeze(['review', 'files', 'browser', 'terminal', 'tasks', 'side'])

/** main 槽的保留键：只有它绑 Session。 */
export const MAIN_CONVERSATION_KEY = 'conversation'

/**
 * 比对"真实声明"与常量表，返回结构化 diff（空数组 = 一致）。
 * @param {{ slots: Array<{name: string, kind: string}>, renderSlots?: string[] }} actual - 宿主/运行期读到的声明。
 * @returns {Array<{ kind: string, name: string, expected?: string, actual?: string }>} diff 列表。
 */
export function diffContract(actual) {
  const out = []
  const actualSlots = new Map((actual?.slots ?? []).map((slot) => [slot.name, slot.kind]))
  for (const expected of SUB_SLOTS) {
    if (!actualSlots.has(expected.name)) {
      out.push({ kind: 'slot:missing', name: expected.name, expected: expected.kind })
      continue
    }
    const kind = actualSlots.get(expected.name)
    if (kind !== expected.kind) out.push({ kind: 'slot:kind-changed', name: expected.name, expected: expected.kind, actual: kind })
  }
  for (const name of actualSlots.keys()) {
    if (!SUB_SLOTS.some((slot) => slot.name === name)) out.push({ kind: 'slot:extra', name })
  }
  const renderSlots = new Set(actual?.renderSlots ?? [])
  if (renderSlots.size > 0) {
    for (const name of ROOT_RENDER_SLOTS) {
      if (!renderSlots.has(name)) out.push({ kind: 'root:render-slot-missing', name })
    }
  }
  return out
}

/** diff 转一条人能读的黄条文案（§5.3：不白屏、不静默）。 */
export function describeDiff(diff) {
  if (!Array.isArray(diff) || diff.length === 0) return ''
  const parts = diff.slice(0, 4).map((item) => {
    if (item.kind === 'slot:kind-changed') return `${item.name} 由 ${item.expected} 变 ${item.actual}`
    if (item.kind === 'slot:missing') return `缺少 ${item.name}（${item.expected}）`
    return `${item.kind} ${item.name}`
  })
  const more = diff.length > parts.length ? ` 等 ${diff.length} 处` : ''
  return `宿主槽契约与预期不一致（${parts.join('；')}${more}），新外壳部分功能可能不显示`
}
