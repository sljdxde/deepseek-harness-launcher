// Tabler 图标集：键名表 + 光学归一化（光学尺寸统一、内容精确居中）
//   - 键名与插件管理器共用一套词汇（短键 → Tabler 图标名）
//   - 归一化：解析每个图标的实际几何包围盒，统一缩放到同一光学尺寸并居中到 24 网格中心，
//     避免「同尺寸 SVG 盒 ≠ 同视觉大小」的生硬感。
import fs from 'node:fs'
import path from 'node:path'

export const KEY_TO_TABLER = {
  search: 'search', refresh: 'refresh', plus: 'plus', check: 'circle-check',
  shield: 'shield-check', x: 'x', chev: 'chevron-right', expand: 'arrows-maximize',
  collapse: 'arrows-minimize', back: 'chevron-left', sparkle: 'bulb', download: 'download',
  star: 'star', cube: 'box', compass: 'compass', bell: 'bell', globe: 'world',
  chart: 'chart-line', zap: 'bolt', hdd: 'device-floppy', layers: 'layers-subtract',
  server: 'server', puzzle: 'puzzle', archive: 'archive', branch: 'git-branch',
  message: 'message', palette: 'palette', workflow: 'route', robot: 'robot',
  gear: 'settings', panel: 'layout-sidebar-left-expand', terminal: 'terminal-2',
  cpu: 'cpu', brain: 'library', database: 'database', code: 'code', brackets: 'braces',
  gauge: 'gauge', store: 'building-store', plug: 'plug', network: 'network',
  wrench: 'tool', book: 'book-2', key: 'key', share: 'share-3', eye: 'eye',
  eyeoff: 'eye-off', image: 'photo', mic: 'microphone', coins: 'coin',
  folder: 'folder', pkg: 'package', file: 'file-text', activity: 'activity',
  flame: 'flame', rocket: 'rocket', bulb: 'bulb', cloud: 'cloud', timer: 'hourglass',
  user: 'user', session: 'messages', audio: 'music', cable: 'plug-connected',
  scan: 'scan', voice: 'microphone', notes: 'notes', tree: 'sitemap', commit: 'git-commit',
  route: 'route', waypoints: 'topology-full-hierarchy', map: 'language', paint: 'paint',
  note: 'note', orbit: 'topology-star-3', blocks: 'components', todo: 'checklist',
  bellring: 'bell-ringing', table: 'table', sliders: 'adjustments', filter: 'filter',
  info: 'info-circle', warn: 'alert-triangle',
  library: 'library', container: 'container', chartbar: 'chart-bar',
  external: 'external-link', sun: 'sun', moon: 'moon',
  install: 'arrow-bar-to-down',
}

const ATTR_ORDER = ['d', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width',
  'height', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'opacity', 'offset', 'pathLength', 'id']

// ── 解析 SVG 几何，求内容包围盒 ──
// 弧线（a/A）必须算极值：Tabler 的圆形是用弧画的，只取端点会让包围盒偏小、居中算错。
function arcExtents(x0, y0, rx, ry, phiDeg, largeArc, sweep, x1, y1) {
  if (rx === 0 || ry === 0) return null
  const phi = (phiDeg * Math.PI) / 180
  const dx2 = (x0 - x1) / 2
  const dy2 = (y0 - y1) / 2
  const cosP = Math.cos(phi), sinP = Math.sin(phi)
  const x1p = cosP * dx2 + sinP * dy2
  const y1p = -sinP * dx2 + cosP * dy2
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s }
  const sign = largeArc === sweep ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const co = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cosP * cxp - sinP * cyp + (x0 + x1) / 2
  const cy = sinP * cxp + cosP * cyp + (y0 + y1) / 2
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI
  const pts = [[x0, y0], [x1, y1]]
  // 弧上的极值点：θ = 0/π 给 x 极值，θ = ±π/2 给 y 极值。
  // 角度区间按 sweep 方向判断：sweep=1 角度递增（theta1 → theta1+dTheta），
  // sweep=0 角度递减；候选角归一化到 (−π, π] 的相对角后落在区间内才算。
  const inArc = (a) => {
    let d = (a - theta1) % (2 * Math.PI)
    if (d > Math.PI) d -= 2 * Math.PI
    if (d <= -Math.PI) d += 2 * Math.PI
    if (sweep) return d > 1e-9 && d < dTheta - 1e-9
    return d < -1e-9 && d > dTheta + 1e-9
  }
  for (const [ang0, px, py] of [
    [0, rx, 0], [Math.PI, -rx, 0], [Math.PI / 2, 0, ry], [-Math.PI / 2, 0, -ry],
  ]) {
    if (inArc(ang0)) {
      pts.push([cosP * rx * Math.cos(ang0) - sinP * ry * Math.sin(ang0) + cx,
        sinP * rx * Math.cos(ang0) + cosP * ry * Math.sin(ang0) + cy])
    }
  }
  return pts
}

function pathBBox(d) {
  const nums = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number)
  const cmds = d.match(/[a-zA-Z]/g) || []
  let i = 0, cx = 0, cy = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const put = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const cmd of cmds) {
    const rel = cmd === cmd.toLowerCase()
    const c = cmd.toUpperCase()
    if (c === 'Z') continue
    if (c === 'H') { const v = nums[i++]; if (rel) { cx += v } else { cx = v } put(cx, cy); continue }
    if (c === 'V') { const v = nums[i++]; if (rel) { cy += v } else { cy = v } put(cx, cy); continue }
    if (c === 'A') {
      const rx = nums[i++], ry = nums[i++], rot = nums[i++], laf = nums[i++], sf = nums[i++]
      const x = nums[i++], y = nums[i++]
      const ex = rel ? cx + x : x, ey = rel ? cy + y : y
      const ext = arcExtents(cx, cy, rx, ry, rot, laf, sf, ex, ey)
      if (ext) ext.forEach(([px, py]) => put(px, py))
      else { put(ex, ey) }
      cx = ex; cy = ey
      continue
    }
    const step = (c === 'C' || c === 'S') ? 6 : (c === 'Q' || c === 'T') ? 4 : 2
    for (let k = 0; k < step; k += 2) {
      const x = nums[i++], y = nums[i++]
      const ax = rel ? cx + x : x
      const ay = rel ? cy + y : y
      put(ax, ay)
      if (k === step - 2) { cx = ax; cy = ay }
    }
  }
  return [minX, minY, maxX, maxY]
}

function bboxOf(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const put = (x0, y0, x1, y1) => {
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return
    minX = Math.min(minX, x0); minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1)
  }
  for (const { tag, attrs } of elements) {
    // Tabler 的 SVG 里有一条不可见的 24×24 包围路径（stroke="none"），不计入内容盒
    if (attrs.stroke === 'none' || attrs.fill === 'none' && attrs.d === undefined) continue
    const num = (k) => (attrs[k] === undefined ? NaN : parseFloat(attrs[k]))
    if (tag === 'path') {
      const b = pathBBox(attrs.d || '')
      put(b[0], b[1], b[2], b[3])
    } else if (tag === 'rect') {
      const x = num('x') || 0, y = num('y') || 0, w = num('width') || 0, h = num('height') || 0
      put(x, y, x + w, y + h)
    } else if (tag === 'circle') {
      const cx = num('cx') || 0, cy = num('cy') || 0, r = num('r') || 0
      put(cx - r, cy - r, cx + r, cy + r)
    } else if (tag === 'ellipse') {
      const cx = num('cx') || 0, cy = num('cy') || 0, rx = num('rx') || 0, ry = num('ry') || 0
      put(cx - rx, cy - ry, cx + rx, cy + ry)
    } else if (tag === 'line') {
      put(num('x1'), num('y1'), num('x2'), num('y2'))
    } else if (tag === 'polyline' || tag === 'polygon') {
      const pts = (attrs.points || '').trim().split(/[\s,]+/).map(Number)
      for (let k = 0; k + 1 < pts.length; k += 2) put(pts[k], pts[k + 1], pts[k], pts[k + 1])
    }
  }
  return [minX, minY, maxX, maxY]
}

/**
 * 归一化：把图标内容统一缩放到 OPTICAL_BOX 并居中到 24 网格中心。
 * 只做等比缩放 + 平移，不改形状；描边宽度随之等比变化（视觉更均匀）。
 */
export const OPTICAL_BOX = 21.5   // 内容在 24 网格里占的目标边长

export function normalize(elements, { box = OPTICAL_BOX } = {}) {
  const [minX, minY, maxX, maxY] = bboxOf(elements)
  const w = maxX - minX, h = maxY - minY
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { transform: null, scale: 1, dx: 0, dy: 0 }
  }
  const scale = Math.min(box / w, box / h)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const dx = 12 - cx * scale, dy = 12 - cy * scale
  return { transform: `translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${scale.toFixed(4)})`, scale, dx, dy }
}

// ── 读 Tabler SVG → 归一化后的内联标记 ──
export function loadNormalized(srcDir, names = Object.values(KEY_TO_TABLER)) {
  const out = {}
  for (const name of new Set(names)) {
    const file = path.join(srcDir, name + '.svg')
    if (!fs.existsSync(file)) throw new Error('缺少 tabler 图标: ' + name)
    const inner = fs.readFileSync(file, 'utf8').match(/<svg[^>]*>([\s\S]*?)<\/svg>/)[1]
    const elements = [...inner.matchAll(/<(path|rect|circle|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/g)]
      .map(([, tag, raw]) => {
        const attrs = {}
        for (const m of raw.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[m[1]] = m[2]
        return { tag, attrs }
      })
    const { transform, scale } = normalize(elements)
    const body = elements.map(({ tag, attrs }) => {
      const order = Object.keys(attrs).sort((a, b) => {
        const ia = ATTR_ORDER.indexOf(a), ib = ATTR_ORDER.indexOf(b)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
      })
      const a = order.map(k => `${k}="${attrs[k]}"`).join(' ')
      return `<${tag}${a ? ' ' + a : ''}/>`
    }).join('')
    // 描边补偿：缩放倍率不同会让线宽不一致，除以 scale 后所有图标渲染出的线宽完全相同
    const strokeWidth = (2 / scale).toFixed(3)
    const gAttrs = [
      transform ? `transform="${transform}"` : '',
      `stroke-width="${strokeWidth}"`,
    ].filter(Boolean).join(' ')
    out[name] = `<g ${gAttrs}>${body}</g>`
  }
  return out
}
