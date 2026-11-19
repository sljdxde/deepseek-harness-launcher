/**
 * FR-44 模型 chip 三态（只显示、不切换）：
 *   有推理等级 → `模型名 · 等级`
 *   确认无等级 → `模型名 · 无推理等级`（显式说明，不静默）
 *   元数据读不到 → 只显示模型名（不编造等级）
 */
export const NO_REASONING_LABEL = '无推理等级'

/**
 * 算出 chip 文案与状态。
 * @param {{ name?: string, reasoningLevel?: string|null, metadataKnown?: boolean }} [model] - 模型元数据。
 * @returns {{ label: string, state: 'level'|'none'|'unknown' }|null} 文案；没有模型名时 null（不渲染）。
 */
export function modelChipText(model = {}) {
  const name = typeof model.name === 'string' ? model.name.trim() : ''
  if (name.length === 0) return null
  const level = typeof model.reasoningLevel === 'string' ? model.reasoningLevel.trim() : ''
  if (level.length > 0) return { label: `${name} · ${level}`, state: 'level' }
  if (model.metadataKnown === true) return { label: `${name} · ${NO_REASONING_LABEL}`, state: 'none' }
  return { label: name, state: 'unknown' }
}
