/**
 * Bootstrap（票 29）：把 HostGuard 的判定接到"注册 / 不注册"上。
 *
 * - guard.ok → 注册 root（由调用方注入 `register`，真机里就是从 client 工厂注册 AppFrame）；
 * - 不 ok → 不注册、不抛错，渲染可关闭横幅（`mountBanner` 由调用方给，真机里是 DOM）；
 * - 幂等：同一实例重复 run 只生效一次，避免重复加载注册两次、叠出两条横幅。
 *
 * 横幅只出现一次/会话，关闭状态不持久化（下次启动仍提示，避免掩盖问题）。
 */
import { guardHost } from './guard.js'
import { rollbackCommand } from './rollback.js'

export const BANNER_ID = 'launcher-hostguard-banner'

/**
 * 横幅要显示的内容（纯数据，DOM 渲染在 client 侧）。
 * @param {{ ok?: boolean, blockers?: Array<{code?:string,message?:string}> }} guard - guardHost 结果。
 * @param {{ profile?: string }} [options] - profile 用于生成回退命令。
 * @returns {{ id: string, title: string, reasons: string[], command: string, dismissLabel: string }}
 */
export function bannerModel(guard, { profile = 'web' } = {}) {
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

/**
 * @param {{
 *   register?: () => void,
 *   mountBanner?: (model: object) => void,
 *   profile?: string,
 *   guard?: (shape: object) => { ok: boolean, blockers: object[], warnings: object[] },
 * }} [deps] - 注册函数、横幅挂载函数（都可注入，便于单测）。
 * @returns {{ run: (shape: object) => object, readonly outcome: object|null }}
 */
export function createBootstrap({ register, mountBanner, profile = 'web', guard = guardHost } = {}) {
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
