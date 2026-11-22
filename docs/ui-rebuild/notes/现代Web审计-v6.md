# v6 原型 · Modern Web Guidance 审计（2026-11-20）

对象：`prototype/dsh-ui-merged-v6.html`（2863 行单文件原型）
依据：`modern-web-guidance` 指南库（dialog / html / accessibility / menu / viewport-aware-dropdowns / dark-mode / color）
实测：Chrome DevTools Lighthouse（desktop、snapshot）+ 页面内脚本测量

## 一、总分与失败项（Lighthouse，v6）

| 类别 | 分数 |
|---|---|
| Accessibility | 94 |
| Best Practices | 100 |
| SEO | 60（原型无关，缺 meta description / robots） |
| Agentic Browsing | 33（原型无关，缺 llms.txt / ard.json） |

Accessibility 失败 3 项（共 27 项通过）：

1. `color-contrast`：24 个节点不达 4.5:1。主因是 `--ink4` 用在 10-10.5px 小字上（浅色 3.05、暗色 3.75），另有 `.chip.demo` 暗色 3.53、`.is-stub` 用 `opacity:.55` 把文字压到 2.5-2.8。
2. `heading-order`：聊天页缺 h1，卡片直接出 h4（h1→h4 跳级）。
3. `label-content-name-mismatch`：图标栏「插件」「会话」按钮的 `aria-label` 不含可见的角标数字（3 / 2）。

## 二、脚本实测（Lighthouse 查不到的）

| 项 | 实测 | 期望 |
|---|---|---|
| 打开模态后焦点位置 | `BODY`（没进弹层） | 弹层内首个控件 |
| 背景是否 inert | 否，仍有 84 个可聚焦元素 | 模态时背景不可达 |
| 弹层 `aria-modal` | 无 | 由原生 `<dialog>` 提供 |
| 行内操作按钮尺寸 | `.icon-btn.xs` / `.pin` 20×20 | ≥24×24 |
| 分段控件状态 | 无 `aria-pressed` | 状态对读屏可见 |
| 原生 `<dialog>` 数量 | 0（全是 `.layer` + `div[role=dialog]`） | 模态用 `<dialog>` |

## 三、分级改进意见

### P0 · 阻断（可访问性与正确性）

**1. 模态弹层改成原生 `<dialog>` + `showModal()`**（指南 `dialog`）
- 现状：`.layer` + `.scrim` + `div[role="dialog"]`，自己处理 Esc、点遮罩关闭；结果焦点不进入弹层、背景不 inert、无 `aria-modal`——读屏和键盘用户会"漏"到背景的 84 个控件里。
- 改法：`<dialog aria-labelledby=...>`，`showModal()` 打开；不要写 `role="dialog"`/`aria-modal`/焦点陷阱/`inert`/Esc 处理，浏览器全包；点遮罩关闭用 `closedby="any"`（Safari 不支持时按指南加 pointerdown/pointerup 兜底）；按钮关闭用 `<form method="dialog">` 或 `command="close"`；滚动穿透用 `dialog:modal{overscroll-behavior:contain}` + `dialog::backdrop` 同款，**不要**给 html/body 加 `overflow:hidden`。
- 命令面板（⌘K）属「页面仍可操作」的非模态：用 `<dialog popover="manual">`，不要 `showModal()`。

**2. 右键菜单改用 Popover + 锚点定位**（指南 `menu`、`viewport-aware-dropdowns`）
- 现状：`div[role="menu"]` + JS `clientX/clientY` + 手动 clamp；无方向键、Home/End，焦点不进菜单 → `role="menu"` 与实际行为不符。
- 改法：`popover="auto"` + 触发按钮 `commandfor` / `command="toggle-popover"`；定位用 `position-area: block-end span-inline-end` + `position-try-fallbacks: flip-block, flip-inline`，不要自己算坐标；菜单内用 `focusgroup="menu"` 拿方向键；无触发按钮时 `showPopover({source: 占位元素})` 按指针位置锚定。若不打算实现完整菜单键盘模型，就先去掉 `role="menu"`，退化为普通按钮列表并手动移焦。

**3. 对比度：小字不许用 `--ink4`**（指南 `color`、`accessibility`）
- `--ink4` 实测 3.05（浅）/3.75（暗），低于小字 4.5；`.chip.demo` 暗色 3.53。
- 改法：10-11px 元信息改用 `--ink3`（或把 `--ink4` 加深到 ≥4.5）；`.chip.demo` 暗色调深；`.is-stub` 不要用 `opacity` 降透明度（会连带压对比度），改用弱化色 token。

**4. 目标尺寸 24×24**（指南 `accessibility` 2.5.8）
- `.icon-btn.xs`、`.pin` 是 20×20。改 24×24（或 `min-inline-size/min-block-size` + padding），行内按钮密集时用 24 起步。

**5. 交互语义**
- 禁止嵌套交互：`<button class="plug-row">` 里放了 `<span role="button">`（图钉），`div[role=button].chat-row` 里放了三个 `span[role=button]`。改法：行本身做标题按钮/链接，操作按钮作为**兄弟**节点放在行内尾部（用 flex 布局），不要嵌进可点元素里。
- 分段控件与分类 chips 的状态只有 `.on` class：补 `aria-pressed`（或整组做 `role="radiogroup"` + `aria-checked`）。
- 图标栏按钮 `aria-label` 要包含可见文字：`aria-label="插件，3 个待办"`，或把角标 `aria-hidden` 并在 label 里给数量。

### P1 · 结构现代化（省代码，也更稳）

**6. 折叠区改用 `<details>/<summary>`**（指南 `html` §5）
- 「需要你 / 工作区 / 任务 / 插件更多」现在都是 JS 状态 + 整块重绘；改成原生折叠：`<details open><summary>工作区 <span>7</span></summary>…`。好处：展开状态由浏览器维护，`aria-expanded` 自动正确，键盘/读屏免费；多组互斥用 `<details name="side">`。注意 summary 里不要嵌按钮（现在的 + / … 要挪到 summary 的兄弟位置或用页头操作区）。

**7. 搜索框包进 `<search>`**（指南 `html` §1）
- 两处搜索（工作区、插件）用 `<search><form>…</form></search>`，读屏可直接跳到搜索区。

**8. 标题层级**（指南 `html` §1、`accessibility`）
- 聊天页补一个视觉隐藏的 h1（会话标题）；卡片 h4 → h3，并在页内先用 h2 起节；弹层标题用 h2（弹层是独立上下文，别接页面的 h1 跳级）。

**9. 暗色模式补 `color-scheme`**（指南 `dark-mode`）
- 现在只有 `[data-theme="dark"]` 换 token，缺 `<meta name="color-scheme" content="light dark">` 与 `:root{color-scheme:light dark}`。后果：暗色下原生滚动条、表单控件、默认画布仍是浅色。切主题时同步把 `color-scheme` 设为 `dark`/`light`。

**10. 滚动条统一 `scrollbar-color`**（指南 `browser-ui-theming`）
- 现有 10 处 `::-webkit-scrollbar` 只在 Chromium 生效，且一旦定义 `scrollbar-color` 会反过来禁用 webkit 伪元素——二选一。建议 `scrollbar-width:thin` + `scrollbar-color: var(--thumb) transparent`，颜色用 `light-dark()` 或主题 token。

### P2 · 手感与性能

**11. 整块 `innerHTML` 重绘的代价**
- 每次状态变化 `renderMain/renderSide/renderLayer` 全量重写：焦点丢（实测模态打开后焦点落 BODY 的另一半原因）、滚动位置丢、CSS 过渡被打断、`<dialog>`/`popover` 状态会被销毁。真机接入时：交给浏览器管状态的组件（dialog/popover/details）不要放进重绘区；列表用 keyed diff；长列表可加 `content-visibility:auto`。

**12. 动效细节**
- 已有 `prefers-reduced-motion` 兜底（好）。弹层进出可补 `@starting-style` + `transition-behavior:allow-discrete`，避免"只出不进"的割裂；时长保持在 150ms 内、只动 `opacity/translate`。

## 四、已经做对的（保持）

- `lang="zh-CN"`、`viewport`、`<title>` 齐全；`<nav>/<main>/<aside>` 地标正确。
- 装饰性 SVG 全部 `aria-hidden="true"`；`toast` 用 `role="status" aria-live="polite"`。
- 全局 `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}` 有 3:1 以上对比。
- `prefers-reduced-motion` 有关闭动画。
- 图标按钮普遍有 `aria-label` / `title`。

## 五、建议顺序

1. P0-1/2/3/4/5（一轮改完，Lighthouse 可回到 100）
2. P1-6/7/8/9/10（结构现代化，减少状态类 bug）
3. P2（真机实现时一并做，原型阶段可只做 11 的评估）

---

## 附：v7 修复结果（2026-11-20）

P0 全部修复；P1 修 6/7/8/9/10（`<details>` 因与整块重绘冲突押后）。

| 指标 | v6 | v7 |
|---|---|---|
| Lighthouse Accessibility | 94 | 100 |
| 失败项 | 3（对比度、heading-order、label-content-name） | 0（仅 SEO/agentic 与本项目无关项） |
| 嵌套交互 | 有 | 0 |
| 弹层打开后焦点 | BODY | 弹层内 |
| `--ink4` 实测对比度 | 3.05 / 3.75 | 5.58 / 6.01 |

明细见 `prototype/改动说明-v7.md`。
