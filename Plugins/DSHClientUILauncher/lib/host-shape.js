/**
 * 宿主形状探测的纯函数（票 29 / A2）。
 *
 * 背景：`client.js` 的 `probeHostShape` 之前**没有**把 `layoutMembers` 放进 guard 输入，
 * 于是 `ILayout 六成员缺失` 这一 blocker 永远不执行；版本读不到时又回退 baseline 版本，
 * 把"读不到"伪装成"匹配"。这里把三条判定抽成不依赖 DOM / cordis 的纯函数，
 * 既能在 Node 单测里逐分支覆盖，又能由 `tools/sync-contract.mjs` 原样内联进浏览器半区。
 *
 * 约定：
 * - 版本读不到 = `''`（交给 guard 出 `version-unreadable` blocker，绝不回退 baseline）；
 * - slots 读不到 = `undefined`（交给 guard 出 `slots-unreadable` blocker）；
 *   只有显式环境白名单（`__DSH_LAUNCHER_ALLOW_LEGACY_SLOTS__ === true`）才用 baseline 形状兜底；
 * - layoutMembers 从宿主 layout 服务实测：返回"基线里、宿主确实暴露的成员"，缺项由 guard 判 blocker。
 */

/**
 * 归一化宿主版本号：读不到就是空串，不回退 baseline（安全侧）。
 * @param {unknown} raw - 原始版本（可能来自 window/ctx）。
 * @returns {string} 去空白后的版本；非字符串或空值返回 ''。
 */
export function resolveHostVersion(raw) {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 归一化子槽声明。
 * @param {unknown} rawSlots - 从宿主 `ctx.slots.spec` 读到的槽数组。
 * @param {{ baselineSlots?: Array<object>, allowLegacy?: boolean }} [options]
 *   `allowLegacy` 只能由显式环境开关打开；打开时用 baseline 形状兜底（假设旧宿主同形）。
 * @returns {Array<object> | undefined} 可判定时返回数组；读不到返回 undefined（交给 guard 判 slots-unreadable）。
 */
export function resolveSlots(rawSlots, { baselineSlots = [], allowLegacy = false } = {}) {
  if (Array.isArray(rawSlots)) return rawSlots
  if (allowLegacy === true && Array.isArray(baselineSlots)) return baselineSlots.map((slot) => ({ ...slot }))
  return undefined
}

/**
 * 从宿主 layout 服务实测 ILayout 成员：只返回基线期望且宿主确实暴露的成员。
 *
 * 为什么不返回"服务上所有键"：`LayoutController` 还有 panels/navigation 等实现细节，
 * 全量返回会让 guard 报一堆 `layout-member-added` 噪音；只比基线成员，缺哪个就是 blocker。
 *
 * @param {unknown} layoutService - 宿主 layout 服务（可能读不到）。
 * @param {string[]} [expectedMembers] - 基线期望的成员名。
 * @returns {string[] | undefined} 暴露的成员名子集；服务读不到返回 undefined（"未知"，guard 跳过）。
 */
export function probeLayoutMembers(layoutService, expectedMembers = []) {
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
