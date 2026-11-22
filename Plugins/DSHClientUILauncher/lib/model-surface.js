import { MODEL_ICONS, iconEl } from './icons.js'
export { MODEL_ICONS } from './icons.js'

/**
 * 模型与推理等级浮层（票 34）：输入框右下角的轻量选择器 + 纯状态。
 *
 * 与 shell/main/dock 同一条纪律：浏览器半区不能 import，Node 侧这里是源，
 * 由 tools/sync-contract.mjs 用 toString 内联进 client.js 的 model-from-lib 标记区。
 * 渲染函数统一「传 h」，状态变换都是纯函数，所以 Node 侧用假 h 就能断言结构与可访问性。
 *
 * 视觉基线：docs/ui-rebuild/prototype/dsh-ui-merged-v17.html（modelPop / reasonPop / cm-modelwrap）。
 */

// ---------- 数据 ----------

/**
 * 模型分组（顺序即浮层分组顺序）。第一组是 DeepSeek 直连模型，第二组是路由组。
 * 分组只在浮层里展示；选中值用 `id`（也是渲染文案）。
 */
export const MODEL_GROUPS = Object.freeze([
  Object.freeze({
    id: 'deepseek',
    label: 'DeepSeek',
    models: Object.freeze([
      Object.freeze({ id: 'DeepSeek V3.2', name: 'DeepSeek V3.2', note: '默认：长上下文、工具调得稳' }),
      Object.freeze({ id: 'DeepSeek V3.2 mini', name: 'DeepSeek V3.2 mini', note: '便宜、快，适合小事' }),
      Object.freeze({ id: 'DeepSeek R1', name: 'DeepSeek R1', note: '想久一点再答' }),
    ]),
  }),
  Object.freeze({
    id: 'routing',
    label: '路由组',
    models: Object.freeze([
      Object.freeze({ id: 'deepseek 爽用 · routing group', name: 'deepseek 爽用 · routing group', note: 'Magpie 提供，按任务自动选型', routing: true }),
    ]),
  }),
])

/** 推理等级四项（Default/Low/High/Max）。High/Max 等价「深入开」。 */
export const REASON_LEVELS = Object.freeze([
  Object.freeze({ id: 'Default', label: 'Default', hint: '默认档', note: '约 1 倍 token' }),
  Object.freeze({ id: 'Low', label: 'Low', hint: '少想，快', note: '约 0.7 倍 token' }),
  Object.freeze({ id: 'High', label: 'High', hint: '多查几轮再答', note: '约 1.5-2 倍 token' }),
  Object.freeze({ id: 'Max', label: 'Max', hint: '最长推理，慢', note: '约 3 倍 token' }),
])

/** 扁平模型 id 表（校验选中值用）。 */
export const MODEL_IDS = Object.freeze(MODEL_GROUPS.reduce((ids, group) => ids.concat(group.models.map((model) => model.id)), []))

/** 推理等级 id 表。 */
export const REASON_IDS = Object.freeze(REASON_LEVELS.map((level) => level.id))

/** 默认模型 / 默认等级。 */
export const DEFAULT_MODEL = 'DeepSeek V3.2'
export const DEFAULT_REASON = 'Default'

/** 浮层种类。 */
export const POPOVER_KINDS = Object.freeze({ model: 'model', reason: 'reason' })

// ---------- 纯状态 ----------

/** High/Max 视为「深入开」。 */
export function isDeepReason(reason) {
  return reason === 'High' || reason === 'Max'
}

/**
 * 造一个模型选择状态；非法值回退默认（渲染不能因为坏输入白屏）。
 * @param {{ model?: string, reason?: string }} [input]
 * @returns {{ model: string, reason: string, deep: boolean }}
 */
export function createModelState(input = {}) {
  const model = MODEL_IDS.includes(input?.model) ? input.model : DEFAULT_MODEL
  const reason = REASON_IDS.includes(input?.reason) ? input.reason : DEFAULT_REASON
  return { model, reason, deep: isDeepReason(reason) }
}

/**
 * 选中一个模型，返回新状态（不改入参）。非法 id 保持原值。
 * @param {{ model: string, reason: string, deep: boolean }} state
 * @param {string} id
 * @returns {{ model: string, reason: string, deep: boolean }}
 */
export function pickModel(state, id) {
  const base = createModelState(state)
  return MODEL_IDS.includes(id) ? { ...base, model: id } : base
}

/**
 * 选中一个推理等级；High/Max 同步把 deep 置真。
 * @param {{ model: string, reason: string, deep: boolean }} state
 * @param {string} id
 * @returns {{ model: string, reason: string, deep: boolean }}
 */
export function pickReason(state, id) {
  const base = createModelState(state)
  return REASON_IDS.includes(id) ? { ...base, reason: id, deep: isDeepReason(id) } : base
}

/**
 * 造一个浮层状态（与选择状态分离：开合/搜索是瞬时 UI，不写回模型）。
 * @returns {{ kind: 'model'|'reason'|null, query: string }}
 */
export function createPopoverState() {
  return { kind: null, query: '' }
}

/**
 * 打开某类浮层（同时清空搜索）。
 * @param {{ kind: any, query: any }} [popover]
 * @param {'model'|'reason'} kind
 * @returns {{ kind: 'model'|'reason'|null, query: string }}
 */
export function openPopover(popover, kind) {
  if (kind !== POPOVER_KINDS.model && kind !== POPOVER_KINDS.reason) return createPopoverState()
  return { kind, query: '' }
}

/**
 * 关闭浮层。
 * @returns {{ kind: null, query: '' }}
 */
export function closePopover() {
  return createPopoverState()
}

/**
 * 点同一个触发按钮就收起，点另一个就切换过去。
 * @param {{ kind: 'model'|'reason'|null, query: string }} [popover]
 * @param {'model'|'reason'} kind
 * @returns {{ kind: 'model'|'reason'|null, query: string }}
 */
export function togglePopover(popover, kind) {
  const current = popover?.kind ?? null
  if (current === kind) return closePopover()
  return openPopover(popover, kind)
}

/**
 * 搜索框输入（纯字符串化，空值归空串）。
 * @param {{ kind: 'model'|'reason'|null, query: string }} [popover]
 * @param {unknown} query
 * @returns {{ kind: 'model'|'reason'|null, query: string }}
 */
export function setPopoverQuery(popover, query) {
  const kind = popover?.kind ?? null
  return { kind, query: typeof query === 'string' ? query : '' }
}

/**
 * 按关键词过滤模型分组（大小写不敏感，空关键词返回全部；过滤后空组丢掉）。
 * @param {string} [query]
 * @returns {Array<{ id: string, label: string, models: object[] }>}
 */
export function filterModelGroups(query) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  return MODEL_GROUPS
    .map((group) => ({
      id: group.id,
      label: group.label,
      models: group.models.filter((model) => q === '' || model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q)),
    }))
    .filter((group) => group.models.length > 0)
}

/** 触发按钮上的模型名（v17 用小写）。 */
export function modelTriggerLabel(state) {
  const model = createModelState(state).model
  return model.toLowerCase()
}

/** 按 id 找模型元数据（找不到给 null）。 */
export function modelMeta(id) {
  for (const group of MODEL_GROUPS) {
    const found = group.models.find((model) => model.id === id)
    if (found !== undefined) return found
  }
  return null
}

/** 设置→模型 里模型条目的值（v17 是「模型 · routing group」；路由组本身不再重复后缀）。 */
export function modelRowLabel(state) {
  const base = modelTriggerLabel(state)
  const meta = modelMeta(createModelState(state).model)
  return meta !== null && meta.routing === true ? base : `${base} · routing group`
}

// ---------- 定位 ----------

/**
 * 浮层贴触发按钮定位：右对齐触发按钮，且不越过视口左右/底部边界。
 * 浮层向上展开（输入框在底部），所以返回的是距视口底部的 `bottom`。
 * @param {{ triggerRect?: { right?: number, top?: number }, popWidth?: number, viewportWidth?: number, viewportHeight?: number, gap?: number, margin?: number }} [input]
 * @returns {{ left: number, bottom: number }}
 */
export function popoverPlacement(input = {}) {
  const margin = Number.isFinite(input?.margin) ? input.margin : 8
  const gap = Number.isFinite(input?.gap) ? input.gap : 8
  const vw = Number.isFinite(input?.viewportWidth) && input.viewportWidth > 0 ? input.viewportWidth : 0
  const vh = Number.isFinite(input?.viewportHeight) && input.viewportHeight > 0 ? input.viewportHeight : 0
  const width = Number.isFinite(input?.popWidth) && input.popWidth > 0 ? input.popWidth : 260
  const right = Number.isFinite(input?.triggerRect?.right) ? input.triggerRect.right : margin
  const top = Number.isFinite(input?.triggerRect?.top) ? input.triggerRect.top : vh
  const maxLeft = Math.max(margin, vw - width - margin)
  const left = Math.min(Math.max(margin, right - width), maxLeft)
  const bottom = Math.max(margin, vh - top + gap)
  return { left, bottom }
}

// ---------- 图标 ----------

/** 只搬浮层/触发按钮用到的少量 Tabler 线性图标（描边由 CSS 控制）。 */

/**
 * 生成一个 24×24 线性图标节点（未知名字给空体，不 throw）。
 * @param {(type: string, props?: object, ...children: any[]) => any} h
 * @param {string} name
 * @returns {any}
 */
export function modelIcon(h, name) {
  return iconEl(h, MODEL_ICONS, name)
}

// ---------- 渲染 ----------

/**
 * 输入框右下角的触发按钮组：模型名 + 等级 + 箭头。
 * 模型名和箭头都开模型浮层；等级开等级浮层；aria-expanded 反映当前开合。
 * @param {(type: string, props?: object, ...children: any[]) => any} h
 * @param {{ state?: object, popover?: 'model'|'reason'|null, onAct?: (kind: 'model'|'reason') => void }} [options]
 * @returns {any} span vnode
 */
export function renderModelTrigger(h, options = {}) {
  const state = createModelState(options.state)
  const popover = options.popover ?? null
  const onAct = typeof options.onAct === 'function' ? options.onAct : () => {}
  const modelOpen = popover === POPOVER_KINDS.model
  const reasonOpen = popover === POPOVER_KINDS.reason
  return h('span', { className: 'launcher-cm-modelwrap', 'data-model-trigger': '' },
    h('button', {
      key: 'model',
      type: 'button',
      className: 'launcher-cm-t',
      title: '选模型',
      'aria-haspopup': 'menu',
      'aria-expanded': modelOpen,
      'data-model-act': 'model',
      onClick: () => onAct('model'),
    }, modelTriggerLabel(state)),
    h('button', {
      key: 'reason',
      type: 'button',
      className: 'launcher-cm-t lev',
      title: '推理等级',
      'aria-haspopup': 'menu',
      'aria-expanded': reasonOpen,
      'data-model-act': 'reason',
      onClick: () => onAct('reason'),
    }, state.reason),
    h('button', {
      key: 'chev',
      type: 'button',
      className: 'launcher-cm-t chev',
      'aria-label': '模型与推理等级',
      'aria-haspopup': 'menu',
      'aria-expanded': modelOpen,
      'data-model-act': 'model',
      onClick: () => onAct('model'),
    }, modelIcon(h, 'chevronDown')))
}

/** 单个可选项：role=menuitemradio，选中项右侧打勾，aria-checked 读自状态。 */
export function renderPopItem(h, { key, label, note, checked, onPick }) {
  const children = [h('span', { className: 'launcher-pop-item__label' }, label)]
  if (note !== undefined) children.push(h('span', { className: 'launcher-pop-note' }, note))
  children.push(checked ? h('span', { className: 'chk' }, modelIcon(h, 'check')) : null)
  return h('button', {
    key,
    type: 'button',
    role: 'menuitemradio',
    'aria-checked': checked === true,
    className: `launcher-pop-item${checked === true ? ' on' : ''}`,
    'data-model-pick': key,
    onClick: () => onPick(key),
  }, ...children)
}

/**
 * 模型/等级浮层内容（只渲染，不定位置：定位由客户端量触发按钮后套 popoverPlacement）。
 * @param {(type: string, props?: object, ...children: any[]) => any} h
 * @param {{ kind?: 'model'|'reason'|null, query?: string, state?: object, popoverRef?: any, onQuery?: (value: string) => void, onPickModel?: (id: string) => void, onPickReason?: (id: string) => void }} [options]
 * @returns {any|null} 浮层 vnode，kind 非法时 null
 */
export function renderModelPopover(h, options = {}) {
  const kind = options.kind ?? null
  if (kind !== POPOVER_KINDS.model && kind !== POPOVER_KINDS.reason) return null
  const state = createModelState(options.state)
  const query = typeof options.query === 'string' ? options.query : ''
  const onQuery = typeof options.onQuery === 'function' ? options.onQuery : () => {}
  const onPickModel = typeof options.onPickModel === 'function' ? options.onPickModel : () => {}
  const onPickReason = typeof options.onPickReason === 'function' ? options.onPickReason : () => {}
  const body = []

  if (kind === POPOVER_KINDS.model) {
    body.push(h('div', { key: 'search', className: 'launcher-pop-search' },
      modelIcon(h, 'search'),
      h('input', {
        className: 'launcher-pop-search__in',
        type: 'search',
        value: query,
        placeholder: '搜索模型…',
        'aria-label': '搜索模型',
        'data-model-search': '',
        onChange: (event) => onQuery(event?.target?.value ?? ''),
      })))
    const groups = filterModelGroups(query)
    for (const group of groups) {
      body.push(h('div', { key: `g-${group.id}`, className: 'launcher-pop-g' }, group.label))
      for (const model of group.models) {
        body.push(renderPopItem(h, {
          key: model.id,
          label: model.name,
          checked: state.model === model.id,
          onPick: onPickModel,
        }))
      }
    }
    if (groups.length === 0) body.push(h('div', { key: 'empty', className: 'launcher-pop-g' }, '没有匹配的模型'))
  } else {
    body.push(h('div', { key: 'g-reason', className: 'launcher-pop-g' }, '推理等级'))
    for (const level of REASON_LEVELS) {
      body.push(renderPopItem(h, {
        key: level.id,
        label: level.label,
        note: level.hint,
        checked: state.reason === level.id,
        onPick: onPickReason,
      }))
    }
  }

  return h('div', {
    className: 'launcher-model-pop',
    role: 'menu',
    'aria-label': kind === POPOVER_KINDS.model ? '选择模型' : '选择推理等级',
    'data-model-popover': kind,
    ref: options.popoverRef,
  }, ...body)
}

// ---------- 样式 ----------

/**
 * 触发按钮与浮层样式（全部 `.launcher-` 前缀，不碰宿主）。
 * @returns {string} CSS 文本
 */
export function modelCss() {
  return [
    '.launcher-cm-modelwrap{display:inline-flex;align-items:center;gap:2px;margin-left:2px;flex:0 0 auto}',
    '.launcher-cm-t{display:inline-flex;align-items:center;min-height:24px;border:0;background:none;padding:2px 3px;border-radius:6px;font:inherit;font-size:13px;color:var(--l-ink3);cursor:pointer;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis}',
    '.launcher-cm-t:hover{background:var(--l-hover2);color:var(--l-ink2)}',
    '.launcher-cm-t:focus-visible{outline:2px solid var(--l-accent);outline-offset:1px}',
    '.launcher-cm-t.lev{color:var(--l-ink4)}',
    '.launcher-cm-t.chev{width:24px;height:24px;padding:0;display:grid;place-items:center;color:var(--l-ink4)}',
    '.launcher-cm-t.chev svg{width:14px;height:14px}',
    '.launcher-model-pop{position:absolute;z-index:130;min-width:240px;max-width:360px;max-height:56vh;overflow:auto;padding:6px;background:var(--l-panel);border:1px solid var(--l-line);border-radius:12px;box-shadow:0 14px 34px rgba(0,0,0,.16)}',
    '.launcher-pop-search{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--l-line);margin:-2px -2px 6px}',
    '.launcher-pop-search svg{width:14px;height:14px;color:var(--l-ink4)}',
    '.launcher-pop-search__in{flex:1;min-width:0;min-height:24px;border:0;background:none;font:inherit;font-size:13px;color:var(--l-ink);outline:none}',
    '.launcher-pop-g{padding:6px 8px 2px;font-size:11px;color:var(--l-ink4)}',
    '.launcher-pop-item{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 8px;border:0;border-radius:8px;background:none;font:inherit;font-size:13px;color:var(--l-ink);text-align:left;cursor:pointer}',
    '.launcher-pop-item:hover,.launcher-pop-item:focus-visible{background:var(--l-hover2)}',
    '.launcher-pop-item.on{color:var(--l-accent)}',
    '.launcher-pop-item__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.launcher-pop-note{margin-left:auto;font-size:11px;color:var(--l-ink4)}',
    '.launcher-pop-item .chk{margin-left:auto;color:var(--l-accent);display:grid;place-items:center}',
    '.launcher-pop-item .chk svg{width:16px;height:16px}',
  ].join('\n')
}
