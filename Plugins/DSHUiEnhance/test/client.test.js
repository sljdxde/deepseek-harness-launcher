import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const SOURCE_URL = new URL('../client/client.js', import.meta.url)
const NS = 'dsh-ui-enhance'

/**
 * DSHUiEnhance 客户端的回归锁：两个已修复的 bug 不允许再回来。
 *
 * bug 1（0.3.11 回归）：插件曾注入无作用域的
 *   `[role="treeitem"]:hover > span:nth-last-child(2){display:none}`
 *   —— 会话行第 2 个 span 是时间，工作区分组行第 2 个 span 却是目录名，
 *   悬停时会把工作区目录名整行藏掉。会话行的时间让位 dsh 官方已自带，
 *   插件不需要这条规则；测试断言注入的样式表里不再出现该选择器。
 *
 * bug 2：插件曾在会话行直接注入「重命名 + 分叉」两个按钮（分叉是低频
 *   操作，应留在 ⋯ 菜单里），且菜单点击链路有两处会让按钮点了没反应：
 *   把注入的重命名按钮自己当成了 ⋯（递归），以及只等一帧就找菜单项
 *   （React portal 还没挂上）。测试断言每行只注入重命名，且点得动。
 *
 * 不引入 DOM 依赖（仓库测试只用 node:test + vm），用最小假 DOM 装载
 * 真实 client.js：只实现插件实际用到的 createElement / 属性 / 事件 /
 * querySelector(All) / classList / textContent 等。
 */

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.childNodes = []
    this.parentNode = null
    this._attrs = new Map()
    this._classes = new Set()
    this._listeners = new Map()
    this._text = ''
  }
  get id() { return this._attrs.get('id') || '' }
  set id(value) { this._attrs.set('id', String(value)) }
  get className() { return [...this._classes].join(' ') }
  set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)) }
  get classList() {
    const self = this
    return {
      contains: (name) => self._classes.has(name),
      add: (...names) => names.forEach((name) => self._classes.add(name)),
      remove: (...names) => names.forEach((name) => self._classes.delete(name)),
    }
  }
  get dataset() {
    const self = this
    return new Proxy({}, {
      get: (_target, key) => self.getAttribute('data-' + String(key)) ?? undefined,
      set: (_target, key, value) => { self.setAttribute('data-' + String(key), value); return true },
    })
  }
  get firstChild() { return this.childNodes[0] || null }
  get children() { return this.childNodes }
  get textContent() {
    let text = this._text
    for (const child of this.childNodes) text += child.textContent
    return text
  }
  set textContent(value) { this._text = String(value); this.childNodes = [] }
  setAttribute(name, value) { this._attrs.set(name, String(value)) }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null }
  hasAttribute(name) { return this._attrs.has(name) }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node }
  insertBefore(node, reference) {
    const index = this.childNodes.indexOf(reference)
    if (index < 0) this.childNodes.push(node)
    else this.childNodes.splice(index, 0, node)
    node.parentNode = this
    return node
  }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, [])
    this._listeners.get(type).push(listener)
  }
  removeEventListener(type, listener) {
    const list = this._listeners.get(type) || []
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this
    event.currentTarget = this
    if (!event.stopPropagation) event.stopPropagation = () => {}
    if (!event.preventDefault) event.preventDefault = () => {}
    for (const listener of [...(this._listeners.get(event.type) || [])]) listener(event)
    return !event.defaultPrevented
  }
  click() { this.dispatchEvent({ type: 'click' }) }
  descendants() {
    const out = []
    const walk = (node) => {
      for (const child of node.childNodes) { out.push(child); walk(child) }
    }
    walk(this)
    return out
  }
  querySelectorAll(selector) { return queryAll(this, selector) }
  querySelector(selector) { return queryAll(this, selector)[0] || null }
}

function matchesSimple(element, part) {
  let rest = part
  const tagMatch = rest.match(/^([a-zA-Z][\w-]*|\*)/)
  if (tagMatch) {
    rest = rest.slice(tagMatch[0].length)
    if (tagMatch[0] !== '*' && element.tagName !== tagMatch[0].toUpperCase()) return false
  }
  const attrPattern = /\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g
  let match
  while ((match = attrPattern.exec(rest))) {
    const actual = element.getAttribute(match[1])
    if (actual === null) return false
    const expected = match[2] ?? match[3] ?? match[4]
    if (expected !== undefined && actual !== expected) return false
  }
  return true
}

function matchesSelector(element, selector) {
  const parts = selector.trim().split(/\s+(?![^\[]*\])/)
  if (!parts.length) return false
  if (!matchesSimple(element, parts[parts.length - 1])) return false
  let node = element.parentNode
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    let matched = false
    while (node) {
      if (matchesSimple(node, parts[index])) { matched = true; node = node.parentNode; break }
      node = node.parentNode
    }
    if (!matched) return false
  }
  return true
}

function queryAll(root, selector) {
  const found = []
  for (const raw of selector.split(',')) {
    const part = raw.trim()
    if (!part) continue
    // 插件只用这一种 :scope 形式：取「最后一个直接子元素，且它是 span」
    if (part === ':scope > span:last-child') {
      const last = root.childNodes[root.childNodes.length - 1]
      if (last && last.tagName === 'SPAN') found.push(last)
      continue
    }
    for (const element of root.descendants()) if (matchesSelector(element, part)) found.push(element)
  }
  return [...new Set(found)]
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document')
    this.readyState = 'complete'
    this.body = new FakeElement('body')
    this.head = new FakeElement('head')
    this.childNodes.push(this.body, this.head)
    this._documentListeners = new Map()
  }
  createElement(tagName) { return new FakeElement(tagName) }
  createElementNS(_namespace, tagName) { return new FakeElement(tagName) }
  getElementById(id) { return this.descendants().find((element) => element.id === id) || null }
  addEventListener(type, listener) {
    if (!this._documentListeners.has(type)) this._documentListeners.set(type, [])
    this._documentListeners.get(type).push(listener)
  }
  removeEventListener(type, listener) {
    const list = this._documentListeners.get(type) || []
    const index = list.indexOf(listener)
    if (index >= 0) list.splice(index, 1)
  }
}

class FakeMutationObserver {
  constructor(callback) { this.callback = callback }
  observe() { this.observed = true }
  disconnect() { this.disconnected = true }
}

/**
 * 在假 DOM 上装载真实的 client.js 并 apply。
 * 故意不提供 requestAnimationFrame：菜单点击链路如果退回「只等一帧」，
 * 这里会直接 ReferenceError，测试失败。
 */
async function loadClient(document) {
  const source = await readFile(SOURCE_URL, 'utf8')
  let plugin = null
  const window = {
    __ModuleLoader__: {
      load(record) { plugin = record.factory(() => { throw new Error('client.js 不应 require 任何模块') }) },
    },
  }
  vm.runInNewContext(source, {
    window,
    document,
    MutationObserver: FakeMutationObserver,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  })
  assert.ok(plugin, 'client.js 必须通过 __ModuleLoader__ 注册插件')
  const disposers = []
  plugin.apply({ on: (_event, disposer) => disposers.push(disposer) })
  return { plugin, disposers }
}

/** 会话行：direct span = [状态点, 标题, 时间(rowResting), rowActions]。 */
function makeSessionRow(document, title, menuLabels = ['置顶会话', '重命名', '分叉会话', '归档会话']) {
  const row = document.createElement('div')
  row.setAttribute('role', 'treeitem')
  const status = document.createElement('span'); status.className = 'slot'
  const titleEl = document.createElement('span'); titleEl.className = 'title'; titleEl.textContent = title
  const time = document.createElement('span'); time.className = 'rowResting'; time.textContent = '3分钟'
  const actions = document.createElement('span'); actions.className = 'rowActions'
  const menuClicks = []
  const nativeMenu = document.createElement('button')
  nativeMenu.setAttribute('aria-label', `会话“${title}”的操作`)
  // 模拟 dsh 的 React portal：点 ⋯ 之后菜单是异步挂到 body 上的
  nativeMenu.addEventListener('click', () => {
    menuClicks.push('open')
    setTimeout(() => {
      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      for (const label of menuLabels) {
        const item = document.createElement('button')
        item.setAttribute('role', 'menuitem')
        item.textContent = label
        item.addEventListener('click', () => menuClicks.push(label))
        menu.appendChild(item)
      }
      document.body.appendChild(menu)
    }, 20)
  })
  actions.appendChild(nativeMenu)
  const archive = document.createElement('button'); archive.setAttribute('aria-label', '归档会话'); actions.appendChild(archive)
  const pin = document.createElement('button'); pin.setAttribute('aria-label', '置顶会话'); actions.appendChild(pin)
  row.appendChild(status)
  row.appendChild(titleEl)
  row.appendChild(time)
  row.appendChild(actions)
  return { row, actions, nativeMenu, menuClicks }
}

/** 工作区分组行：direct span = [folder, chevron, projectText(目录名), rowActions]。 */
function makeWorkspaceRow(document, name) {
  const row = document.createElement('div')
  row.setAttribute('role', 'treeitem')
  const folder = document.createElement('span'); folder.className = 'slot folder'
  const chevron = document.createElement('span'); chevron.className = 'slot chevron'
  const title = document.createElement('span'); title.className = 'projectText'; title.textContent = name
  const actions = document.createElement('span'); actions.className = 'rowActions'
  row.appendChild(folder)
  row.appendChild(chevron)
  row.appendChild(title)
  row.appendChild(actions)
  return { row, title }
}

test('注入的样式表不再按 nth-last-child 隐藏任何行的第 2 个 span（工作区目录名悬停回归）', async () => {
  const document = new FakeDocument()
  const workspace = makeWorkspaceRow(document, 'dsh-launcher')
  document.body.appendChild(workspace.row)

  await loadClient(document)

  const style = document.getElementById(NS + '-style')
  assert.ok(style, '插件必须注入样式表')
  // 注释里允许提到这个选择器（作为反面教材），只看真正的声明规则
  const css = style.textContent.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(
    !css.includes('nth-last-child'),
    '不允许再用 span:nth-last-child(2) 做悬停让位：工作区行第 2 个 span 是目录名，会被整行藏掉',
  )
  // 会话行的时间让位由 dsh 官方样式（.sessionRow:hover .rowResting）负责，
  // 插件只需要保留「只作用于会话行」的 rowActions 规则。
  assert.ok(css.includes('[data-dsh-ui-enhance-session]'), '会话行样式必须限定在 data-dsh-ui-enhance-session 上')
})

test('会话行只注入重命名一个按钮；分叉留在 ⋯ 菜单里，工作区行不受影响', async () => {
  const document = new FakeDocument()
  const workspace = makeWorkspaceRow(document, 'dsh-launcher')
  const session = makeSessionRow(document, '修复目录悬停不可见')
  document.body.appendChild(workspace.row)
  document.body.appendChild(session.row)

  await loadClient(document)

  // 会话行被标记（CSS / 键盘都依赖这个标记），工作区行不能被误标
  assert.equal(session.row.getAttribute('data-' + NS + '-done'), '1')
  assert.equal(session.row.getAttribute('data-' + NS + '-session'), '1')
  assert.equal(workspace.row.getAttribute('data-' + NS + '-session'), null, '工作区分组行不能当成会话行')
  assert.equal(workspace.row.querySelectorAll('button').length, 0, '工作区行不能注入按钮')

  const buttons = session.actions.querySelectorAll('button')
  const injected = buttons.filter((button) => button.classList.contains(NS + '-btn'))
  assert.equal(injected.length, 1, '行上只允许注入一个按钮（重命名）')
  assert.ok(injected[0].classList.contains(NS + '-edit'), '注入的应该是重命名按钮')
  assert.ok(
    !buttons.some((button) => button.className.includes(NS + '-fork')),
    '分叉不应直接挂在会话行上（应折叠进 ⋯ 菜单）',
  )
  // 重命名 + 原生 ⋯ + 归档 + 置顶
  assert.equal(buttons.length, 4)
})

test('行内重命名按钮点得动：走原生 ⋯ 菜单，且不会把自己当成 ⋯ 递归', async () => {
  const document = new FakeDocument()
  const session = makeSessionRow(document, '修复目录悬停不可见')
  document.body.appendChild(session.row)

  await loadClient(document)

  const editButton = session.actions.querySelectorAll('button').find((button) => button.classList.contains(NS + '-edit'))
  assert.ok(editButton, '会话行应有重命名按钮')
  editButton.click()

  // 菜单是 20ms 后才挂到 body 的：短轮询必须能等到它
  await new Promise((resolve) => setTimeout(resolve, 250))

  assert.deepEqual(session.menuClicks, ['open', '重命名'], '点重命名 = 打开 ⋯ 菜单并点中「重命名」菜单项')
})

test('dispose 后停止观察与快捷键监听', async () => {
  const document = new FakeDocument()
  const session = makeSessionRow(document, '修复目录悬停不可见')
  document.body.appendChild(session.row)

  const { disposers } = await loadClient(document)
  assert.equal(disposers.length, 1, '插件应把 dispose 交给宿主')
  disposers[0]()
  assert.equal(document._documentListeners.get('keydown').length, 0, 'dispose 后不应继续监听键盘')
})
