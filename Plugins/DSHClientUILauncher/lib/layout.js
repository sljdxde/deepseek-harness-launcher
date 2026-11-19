/**
 * 外壳的几何求解：右栏轨道宽度、2/4/6 分屏的降档、宽度预算。
 *
 * 全是纯函数：给视口与想要的档位，回答"能显示成什么"。渲染层只按结果排版，
 * 这样 §6.1/§6.2「返回结果对象、不 throw」的约定和 §10-5 的宽度预算都能单测。
 */

/** 右栏轨道：宽度区间与隐藏阈值（原型 `--dock-w` 口径）。 */
export const DOCK = Object.freeze({ min: 320, max: 520, default: 380, hideBelow: 1020 })

/** 单块最小尺寸：低于它必须降档，不裁切。 */
export const PANE_MIN_WIDTH = 360
export const PANE_MIN_HEIGHT = 240

/** 分屏档位，从多到少；降档按这个顺序往下走。 */
export const SPLIT_MODES = Object.freeze([6, 4, 2, 1])

/** 每档的行列（原型：2 块左右并排、4 块 2×2、6 块 3×2）。 */
const GRID = Object.freeze({ 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2] })

/** 主区在分屏之外至少留的宽度（§4.4 宽度预算）。 */
export const MAIN_MIN_WIDTH = 480

/**
 * 设定右栏宽度。
 * @param {number} px - 期望宽度（CSS 像素）。
 * @returns {{ ok: true, width: number } | { ok: false, reason: 'min'|'max', width: number }} 夹到区间内后仍要落地的宽度。
 */
export function setDockWidth(px) {
  const wanted = Number(px)
  if (!Number.isFinite(wanted) || wanted < DOCK.min) return { ok: false, reason: 'min', width: DOCK.min }
  if (wanted > DOCK.max) return { ok: false, reason: 'max', width: DOCK.max }
  return { ok: true, width: Math.round(wanted) }
}

/**
 * 右栏此刻能不能显示。
 * @param {{ viewportWidth: number, enabled?: boolean }} input - 视口宽与功能开关（R2 的 ui.shell.rightDock）。
 * @returns {boolean} 能显示则占轨道，否则整栏自隐（open() 也只 toast，不占位）。
 */
export function dockCanShow({ viewportWidth, enabled = true } = {}) {
  if (!enabled) return false
  const width = Number(viewportWidth)
  return Number.isFinite(width) && width >= DOCK.hideBelow
}

/**
 * 这个空间最多能放几块（结果只可能是 1/2/4/6 之一）。
 * @param {{ availableWidth: number, availableHeight?: number, gap?: number }} input - 主区可用宽度/高度与块间距。
 * @returns {number} 可用的最大档位。
 */
export function maxSplit({ availableWidth, availableHeight = Infinity, gap = 12 } = {}) {
  const width = Number(availableWidth)
  const height = Number(availableHeight)
  if (!Number.isFinite(width) || width <= 0) return 1
  for (const mode of SPLIT_MODES) {
    const [columns, rows] = GRID[mode]
    const perWidth = (width - gap * (columns - 1)) / columns
    const perHeight = (height - gap * (rows - 1)) / rows
    if (perWidth >= PANE_MIN_WIDTH && perHeight >= PANE_MIN_HEIGHT) return mode
  }
  return 1
}

/**
 * 分屏降档：从想要的档位往下找第一个放得下的。
 * @param {number} requested - 想要的块数（1/2/4/6，非法值按 1 处理）。
 * @param {{ availableWidth: number, availableHeight?: number, gap?: number }} space - 主区可用空间。
 * @returns {{ mode: number, requested: number, max: number, reason: 'too-narrow'|null }} 实际档位与降档原因。
 */
export function resolveSplit(requested, space = {}) {
  const wanted = SPLIT_MODES.includes(Number(requested)) ? Number(requested) : 1
  const max = maxSplit(space)
  if (wanted <= max) return { mode: wanted, requested: wanted, max, reason: null }
  return { mode: max, requested: wanted, max, reason: 'too-narrow' }
}

/**
 * 主区可用宽度 = 视口 − 图标栏 − 侧栏（展开时） − 右栏轨道。
 * @param {{ viewportWidth: number, rail?: number, sidebar?: number, dock?: number }} input - 各列宽度。
 * @returns {number} 主区可用宽度，最小 0。
 */
export function mainAreaWidth({ viewportWidth, rail = 56, sidebar = 0, dock = 0 } = {}) {
  return Math.max(0, Math.round(Number(viewportWidth) - rail - sidebar - dock))
}

/** composer 工具条在窄窗下可用的宽度档位（FR-31）。 */
export const COMPOSER_BAR = Object.freeze({ full: 480, compact: 400, icons: 320 })

/**
 * composer 工具条在给定宽度下怎么排（FR-31：320 下不溢出、发送键不许被裁）。
 * 原型在 320 时工具条 scrollWidth 431 / clientWidth 196、发送键 right 522 落到视口外——那是缺陷，
 * 这里的规则是"先收标签、再收次要入口进 + 菜单，发送键永远在"。
 * @param {number} availableWidth - 输入区可用宽度。
 * @returns {{ labels: 'full'|'icon', extras: 'inline'|'menu', sendVisible: true }} 排布档位。
 */
export function collapseComposerBar(availableWidth) {
  const width = Number(availableWidth)
  if (!Number.isFinite(width) || width < COMPOSER_BAR.compact) {
    return { labels: 'icon', extras: 'menu', sendVisible: true }
  }
  if (width < COMPOSER_BAR.full) return { labels: 'icon', extras: 'inline', sendVisible: true }
  return { labels: 'full', extras: 'inline', sendVisible: true }
}

/** 窄窗阈值：低于它把次要入口收进菜单，但每个入口都必须还有一条可见路径（FR-31）。 */
export const NARROW = Object.freeze({ chip: 360, rail: 400 })

/**
 * 320 这类窄窗的降级计划（FR-31）。
 *
 * 判据（03 为准）：`document.body.scrollWidth ≤ 321`、五个动作不需要横向滚动、composer 不溢出、
 * 发送键可见、审批 chip 不被裁；右栏/侧栏收起时**必须有可见入口，不能静默消失**。
 * 所以这里没有 `hidden` 这种取值：收起来的一律给 `menu` / `rail`，由渲染层留一个可见按钮。
 * @param {number} viewportWidth - 视口宽（CSS 像素）。
 * @returns {{ composer: ReturnType<typeof collapseComposerBar>, approvalChip: 'inline'|'menu', dockEntry: 'track'|'rail', sidebarEntry: 'column'|'rail' }} 降级计划。
 */
export function narrowPlanOf(viewportWidth) {
  const width = Number(viewportWidth)
  const safe = Number.isFinite(width) ? width : 0
  return {
    composer: collapseComposerBar(safe),
    approvalChip: safe < NARROW.chip ? 'menu' : 'inline',
    dockEntry: safe < DOCK.hideBelow ? 'rail' : 'track',
    sidebarEntry: safe < NARROW.rail ? 'rail' : 'column',
  }
}

/**
 * §4.4 的宽度预算检查（1440 参考：56 + 280 + 480 + 380 = 1196，余量给间距与把手）。
 * @param {{ viewportWidth: number, rail?: number, sidebar?: number, dock?: number }} input - 各列宽度。
 * @returns {{ main: number, total: number, fits: boolean }} 主区宽度、视口合计、主区是否够 MAIN_MIN_WIDTH。
 */
export function widthBudget({ viewportWidth, rail = 56, sidebar = 280, dock = DOCK.default } = {}) {
  const main = mainAreaWidth({ viewportWidth, rail, sidebar, dock })
  return { main, total: Math.round(Number(viewportWidth)), fits: main >= MAIN_MIN_WIDTH }
}

/** ≤860 时侧栏塌成抽屉（列宽 0）；否则收起态 0、展开 280。与 client 的 mainWidth 同口径。 */
export function sidebarColumnWidth({ viewportWidth, collapsed = false, sidebar = 280, drawerBreakpoint = 860 } = {}) {
  const width = Number(viewportWidth)
  if (!Number.isFinite(width)) return sidebar
  if (width <= drawerBreakpoint) return 0
  return collapsed ? 0 : sidebar
}

/**
 * 主区实际能放几块（把侧栏列宽算对，避免 788–860 误降档）。
 * @param {{ requested: number, viewportWidth: number, collapsed?: boolean, rail?: number, dock?: number, height?: number }} input - 视口与外壳列宽。
 * @returns {{ mainWidth: number, mode: number, requested: number, max: number, reason: 'too-narrow'|null }} 结果。
 */
export function effectiveSplitFor({ requested, viewportWidth, collapsed = false, rail = 56, dock = 0, height = Infinity } = {}) {
  const mainWidth = Math.max(0, Math.round(Number(viewportWidth) - rail - sidebarColumnWidth({ viewportWidth, collapsed }) - dock))
  return { mainWidth, ...resolveSplit(requested, { availableWidth: mainWidth, availableHeight: height }) }
}
