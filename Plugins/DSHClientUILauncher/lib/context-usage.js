/**
 * FR-38 上下文用量的纯计算（宿主真实形状，见 64801 实测）：
 *   contextPressure  = { pressureTokens, projectedTokens, contextWindow }
 *   contextBreakdown = { systemTokens, toolsTokens, messageTokens }（**没有 filesTokens**）
 * 百分比优先用 projectedTokens/contextWindow（更接近"占用"），退 pressureTokens；四项里缺项就是 null，不硬编。
 */

/**
 * 算占用与拆分。
 * @param {{ pressure?: object, breakdown?: object }} [input] - 宿主投影返回值。
 * @returns {{ pct: number|null, system: number|null, chat: number|null, files: number|null, tools: number|null }|null} 用量；算不出 pct 时 null。
 */
export function contextUsageOf({ pressure, breakdown } = {}) {
  const num = (value, keys) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    for (const key of keys) {
      const n = Number(value[key])
      if (Number.isFinite(n)) return n
    }
    return null
  }
  const window = num(pressure, ['contextWindow', 'windowTokens', 'max'])
  const used = num(pressure, ['projectedTokens', 'pressureTokens', 'used', 'tokens'])
  let pct = null
  if (window !== null && window > 0 && used !== null) pct = Math.min(100, Math.max(0, Math.round((used / window) * 100)))
  else {
    const ratio = num(pressure, ['ratio', 'pct', 'percent'])
    if (ratio !== null) pct = ratio <= 1 ? Math.round(ratio * 100) : Math.round(ratio)
  }
  if (pct === null) return null
  return {
    pct,
    system: num(breakdown, ['systemTokens', 'system']),
    chat: num(breakdown, ['messageTokens', 'chat']),
    files: num(breakdown, ['filesTokens', 'files']),
    tools: num(breakdown, ['toolsTokens', 'tools']),
  }
}

/**
 * 压缩建议（05 §6.5-② 文案）。
 * @param {number} pct - 占用百分比。
 * @returns {string} 建议文案。
 */
export function contextAdvice(pct) {
  if (pct >= 95) return '快满了：建议压缩到 40%'
  if (pct >= 85) return '该压缩了：建议压缩到 40%'
  return '占用正常'
}
