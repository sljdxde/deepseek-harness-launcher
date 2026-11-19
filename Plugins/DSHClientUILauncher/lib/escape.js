/**
 * Esc 的优先级链（04-A2 · D1）。
 *
 * 同一时刻可能开着好几层浮层，Esc 只能关最上面那一层，顺序固定为：
 * 划词浮层 → find → plus/slash 菜单 → palette → modal → 计量面板。
 * 计量面板排最后：它贴着 composer，是"看一眼就走"的面板，不能抢在划词或查找前面。
 *
 * 关掉计量面板时焦点要还给环（D1 的原话），这条在渲染层执行；这里只回答"该关谁"。
 */

/** 从最上层到最下层；数组顺序就是 Esc 的消费顺序。 */
export const ESCAPE_ORDER = Object.freeze(['selection', 'find', 'composer', 'palette', 'modal', 'meter'])

/**
 * Esc 该关哪一层。
 * @param {Iterable<string>|string[]} open - 当前打开的层（顺序无关，按 ESCAPE_ORDER 排）。
 * @returns {string|null} 该关的层；没有开的层返回 null（Esc 交还宿主）。
 */
export function nextEscapeTarget(open) {
  const layers = new Set(Array.isArray(open) ? open : [...(open ?? [])])
  for (const layer of ESCAPE_ORDER) {
    if (layers.has(layer)) return layer
  }
  return null
}

/**
 * 关掉一层之后的焦点归属。
 *
 * 两条来源不同但不冲突：04-A2 D1 要求关计量面板把焦点还给环（它是 composer 上的小按钮）；
 * FR-06 要求 find 关掉后焦点回输入框（原型这里是落到发送键上，属缺陷）。其它层不动焦点，
 * 交还给关之前的活动元素。
 */
export const FOCUS_AFTER_ESCAPE = Object.freeze({ meter: 'meter-ring', find: 'composer-input' })

/**
 * 关掉一层之后的焦点归属。
 * @param {string|null} layer - nextEscapeTarget 的结果。
 * @returns {{ closed: string|null, focus: 'meter-ring'|'composer-input'|null }} 关闭目标与焦点去处（null = 沿用关之前）。
 */
export function escapeOutcome(layer) {
  if (layer === null) return { closed: null, focus: null }
  return { closed: layer, focus: FOCUS_AFTER_ESCAPE[layer] ?? null }
}
