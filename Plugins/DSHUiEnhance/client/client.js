/**
 * dsh-ui-enhance — 会话行的操作不再藏在「悬停才出现的 ⋯」里。
 *
 * 背景（读 dsh 的 dsh-client-ui-workspace/lib/client.js 得到的事实）：
 *   · 会话行是 `[role="treeitem"]`，里面依次是状态点 span、标题 span、
 *     时间 span、rowActions span（内含一个 ⋯ 按钮）。
 *   · `.rowActions` 的 CSS 是 `display:none`，只有 `:hover` 时才
 *     `display:inline-flex` —— 也就是说，鼠标不先移上去，那三个操作
 *     （重命名 / 分叉 / 归档）在界面上等于不存在。
 *   · 三个操作都在 ⋯ 菜单的二级里，要两次点击才到。
 *
 * 本插件不改 dsh 的源码（改源码会被 dsh 升级冲掉），而是：
 *   1. 注入一段 CSS，把 `.rowActions` 从「悬停才显示」改成「常驻半透明、
 *      悬停变实」；
 *   2. 用 MutationObserver 在会话行里补一个图标按钮（重命名），点击时转成
 *      对 dsh 原生菜单项的调用 —— 也就是不复制业务逻辑，只把入口提前；
 *      分叉这类低频操作不摆在行上，仍收在 ⋯ 菜单里（Ctrl+D 快捷键保留）；
 *   3. 绑定键盘：F2 重命名当前会话、Ctrl+D 分叉、Ctrl+Shift+A 归档。
 *
 * dsh 的 CSS Module 类名是哈希的（`YDXeBa_rowActions` 这类），不能依赖，
 * 所以命中一律走结构选择器（`[role="treeitem"] > span:last-child`）。
 */
window.__ModuleLoader__.load({ id: 'dsh-ui-enhance', factory: (require) => {
  const NS = 'dsh-ui-enhance'

  // 会话行里 rowActions 的稳定结构：它是 treeitem 的最后一个 span 子节点，
  // 且里面有一个带 aria-label 的 button（⋯）。用「最后一个 span 且含
  // button」而不是哈希类名，dsh 换哈希也命中。
  const ROW = '[role="treeitem"]'
  const ROW_ACTIONS = `${ROW} > span:last-child`

  const css = `
/* ── 1. 行内操作常驻可见 ──────────────────────────────────────────────
   原本是 display:none，只有 :hover 才出现。改成常驻、半透明，悬停到该行
   时变实 —— 用户不用「探索」就能看见这里有操作。 */
/* 只作用于「会话行」—— 由脚本打上的 data-dsh-ui-enhance-session 标记，
   工作区分组行保持 dsh 原本的悬停行为。 */
${ROW}[data-${NS}-session] ${ROW_ACTIONS} {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  opacity: .55;
  transition: opacity .12s ease;
}
${ROW}[data-${NS}-session]:hover ${ROW_ACTIONS},
${ROW}[data-${NS}-session] ${ROW_ACTIONS}:focus-within {
  opacity: 1;
}
/* 注意：别按 span:nth-last-child(2) 给「时间标签让位」再补规则。
   工作区分组行（projectRow）的直接子 span 是 [folder, chevron, projectText,
   rowActions]，nth-last-child(2) 恰好是**目录名**，这样写会在悬停时把整行
   目录名藏掉（0.3.11 回归）；会话行的时间让位 dsh 自己已经做了
   （sessionRow:hover 时 rowResting 会被官方样式隐藏），不需要重复。 */

/* ── 2. 插件补的常驻按钮 ────────────────────────────────────────────
   16px 图标按钮，与 dsh 自己的 iconButton 同尺寸同配色，视觉上无缝。 */
.${NS}-btn {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 4px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 16px;
  width: 16px;
  padding: 0;
}
.${NS}-btn:hover {
  color: var(--dsw-alias-label-primary);
}
.${NS}-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.${NS}-btn svg { width: 16px; height: 16px; display: block; }

/* ── 3. 键盘提示（重命名进行中）──────────────────────────────────── */
.${NS}-hint {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0,0,0,.22);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  padding: 8px 14px;
  z-index: 2147483000;
  pointer-events: none;
  opacity: 0;
  transition: opacity .15s ease;
}
.${NS}-hint[data-show='1'] { opacity: 1; }
`

  // 图标：与 dsh 用同一套语义（铅笔=重命名）。
  // 手绘 SVG 而不是 require dsh 的图标模块：那些是内部模块，版本间会变。
  const ICON_EDIT = 'M11.6 2.6 13.4 4.4 5.4 12.4 3.2 13 2.6 10.8z'

  function makeIcon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.6')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', path)
    svg.appendChild(p)
    return svg
  }

  function ensureStyles() {
    if (document.getElementById(NS + '-style')) return
    const style = document.createElement('style')
    style.id = NS + '-style'
    style.textContent = css
    document.head.appendChild(style)
  }

  // 会话行 → 原生行内 ⋯ 按钮。找不到返回 null。
  // 注意：本插件注入的按钮也在 rowActions 里，且排在 ⋯ 前面；它们同样带
  // aria-label，直接取第一个会把「重命名」按钮自己当 ⋯，点下去递归调用。
  // 所以按本插件的类名排除自己注入的按钮。
  function menuButton(row) {
    const actions = row.querySelector(':scope > span:last-child')
    if (!actions) return null
    const buttons = Array.from(actions.querySelectorAll('button[aria-label]'))
    return buttons.find((button) => !button.classList.contains(NS + '-btn')) || null
  }

  /**
   * 把 dsh 的菜单项点出来。dsh 的 ⋯ 按钮点击后由它自己的 React 组件渲染
   * 菜单（portal 到 body），所以我们点 ⋯、等菜单出现、再点同名项 —— 这样
   * 不复制任何业务逻辑（重命名走它自己的输入框、归档走它自己的确认）。
   *
   * 代价是「两次 DOM 点击」而不是直接调用；好处是 dsh 换实现也不会坏。
   */
  function clickMenuAction(row, label) {
    const trigger = menuButton(row)
    if (!trigger) return false
    trigger.click()
    // 菜单是点完才异步渲染的（React portal），只等一帧经常还没挂上；
    // 这里短轮询找菜单项，超时才收起菜单并提示。
    const deadline = Date.now() + 800
    const timer = setInterval(() => {
      // dsh 的菜单项是带 role 的按钮或可点击项；按可见文本匹配
      const candidates = Array.from(document.querySelectorAll(
        '[role="menuitem"], [role="menu"] button, [data-menu-item]'
      ))
      const target = candidates.find(el => (el.textContent || '').trim().includes(label))
      if (target) {
        clearInterval(timer)
        target.click()
        return
      }
      if (Date.now() > deadline) {
        clearInterval(timer)
        // 兜底：菜单没渲染出来就把 ⋯ 收起来，别留一个空菜单
        trigger.click()
        showHint(`没找到「${label}」菜单项`)
      }
    }, 30)
    return true
  }

  let hintTimer = null
  function showHint(text) {
    let hint = document.getElementById(NS + '-hint')
    if (!hint) {
      hint = document.createElement('div')
      hint.id = NS + '-hint'
      hint.className = NS + '-hint'
      document.body.appendChild(hint)
    }
    hint.textContent = text
    hint.dataset.show = '1'
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => { hint.dataset.show = '0' }, 1600)
  }

  /**
   * 给一行补常驻按钮。已经补过就跳过（幂等，MutationObserver 会反复触发）。
   * 只补「重命名」这一个高频操作；分叉、归档留在 ⋯ 里（Ctrl+D 仍可快捷分叉）。
   */
  function enhanceRow(row) {
    if (row.getAttribute('data-' + NS + '-done') === '1') return
    const actions = row.querySelector(':scope > span:last-child')
    if (!actions) return
    // 只处理「会话行」：它的 ⋯ 按钮 aria-label 形如「会话“X”的操作」，
    // 而工作区行的按钮是「工作区“X”的操作」「在“X”中新建会话」。
    // 按文案区分，而不是按按钮个数 —— 工作区分组行也可能有两三个按钮。
    // 会话行的标志：rowActions 里有一个 aria-label 形如「会话"X"的操作」
    // 的按钮。dsh 0.2.x 的会话行还额外带了「归档会话」「置顶会话」两个
    // 常驻按钮（它自己已经把这两个提到一级了），所以不能按按钮个数判定；
    // 工作区分组行的按钮是「工作区"X"的操作」「在"X"中新建会话」。
    const buttons = Array.from(actions.querySelectorAll('button'))
    const sessionBtn = buttons.find(b => {
      const label = b.getAttribute('aria-label') || ''
      return /会话/.test(label) && /操作/.test(label) && !/工作区/.test(label) && !/新建/.test(label)
    })
    if (!sessionBtn) return
    row.setAttribute('data-' + NS + '-done', '1')
    // the CSS keys off this: only session rows get the always-visible span
    row.setAttribute('data-' + NS + '-session', '1')

    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = `${NS}-btn ${NS}-edit`
    editBtn.title = '重命名（F2）'
    editBtn.setAttribute('aria-label', '重命名会话')
    editBtn.appendChild(makeIcon(ICON_EDIT))
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()   // 别让点击冒泡成「打开会话」
      clickMenuAction(row, '重命名')
    })

    // 插在 ⋯ 之前：视觉顺序 = 重命名、⋯、归档、置顶
    actions.insertBefore(editBtn, actions.firstChild)
  }

  function enhanceAll() {
    document.querySelectorAll(ROW).forEach(enhanceRow)
  }

  // ── 键盘 ────────────────────────────────────────────────────────────
  // 当前「聚焦」的会话行：最近一次鼠标进入或点击的那一行。
  let activeRow = null
  function rememberActive(event) {
    const row = event.target && event.target.closest ? event.target.closest(ROW) : null
    if (row) activeRow = row
  }

  function onKeyDown(event) {
    if (!activeRow || !activeRow.isConnected) return
    // 正在输入框里打字时不劫持按键
    const tag = (event.target && event.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) return

    if (event.key === 'F2') {
      event.preventDefault()
      clickMenuAction(activeRow, '重命名')
      return
    }
    if (event.ctrlKey && !event.shiftKey && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault()
      clickMenuAction(activeRow, '分叉')
      return
    }
    if (event.ctrlKey && event.shiftKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault()
      clickMenuAction(activeRow, '归档')
    }
  }

  // ── 装配 ────────────────────────────────────────────────────────────
  let observer = null

  function start() {
    ensureStyles()
    enhanceAll()

    // 侧边栏是 React 渲染的，会话增减、切换工作区都会重画：观察即可
    observer = new MutationObserver(() => enhanceAll())
    observer.observe(document.body, { childList: true, subtree: true })

    document.addEventListener('mouseover', rememberActive, true)
    document.addEventListener('mousedown', rememberActive, true)
    document.addEventListener('keydown', onKeyDown, true)
  }

  function stop() {
    if (observer) observer.disconnect()
    observer = null
    document.removeEventListener('mouseover', rememberActive, true)
    document.removeEventListener('mousedown', rememberActive, true)
    document.removeEventListener('keydown', onKeyDown, true)
  }

  function apply(ctx) {
    // 客户端插件在页面加载后 apply：等 DOM 有内容再开始
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true })
    } else {
      start()
    }
    if (ctx && ctx.on) ctx.on('dispose', stop)
  }

  return { inject: ['slots', 'locale'], apply }
}})
