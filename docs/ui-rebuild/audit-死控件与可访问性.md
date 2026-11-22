# 死控件与可访问性验收报告（票 37）

- 状态：**PASS**（0 dead control）
- 巡检对象：`Plugins/DSHClientUILauncher/client/client.js`（浏览器生成产物；`lib/*.js` 经 `tools/sync-contract.mjs` 内联，不重复计数）
- 生成时间：2026-11-22T11:10:08.264Z
- 巡检脚本：`cd Plugins/DSHClientUILauncher && node scripts/audit-controls.mjs`（退出码 0）
- 机器可读数据：`docs/ui-rebuild/audit-controls.json`
- 验收线来源：`docs/ui-rebuild/issues/27-spec-compat-ui-rebuild.md`（0 dead control / 对比度 AA / 焦点可见 / ≥24px）

## 1. 结论

| 检查项 | 结果 | 证据 |
|---|---|---|
| 死控件 = 0 | 通过 | 0 dead |
| 控件有可访问名 | 通过 | 0 缺名 |
| 点击目标 ≥ 24px（或例外） | 通过 | 0 个 <24px |
| 焦点环可见 | 通过 | 全站兜底规则 |
| 文字对比度 AA（日夜） | 通过 | 0 组未过 |

本次共巡检 **70** 个可点控件，**dead = 0**、**缺可访问名 = 0**、**点击目标 <24px（非例外）= 0**。日夜两套主题共 34 组文字对比度全部 ≥ 4.5:1。

**发布判断：不阻塞发布。** 0 dead、0 缺名、0 目标违规，AA 与焦点均有静态证据；真机视觉由既有 S3 canary 复核（见遗留项）。

## 2. 巡检口径

- **控件识别**：`button/input/select/textarea/a/summary`，带 `data-act` / `data-action` 的元素，以及 `role=switch/radio/checkbox/tab/option/menuitem/menuitemradio/button/link` 的元素。
- **构建方式覆盖**：以 `h('tag', props, children…)` 声明式渲染为主（67 个），另扫描 `document.createElement('button')` 这类 DOM 直建控件（2 个 HostGuard 横幅按钮）。
- **dead 判定**：同时缺少「处理函数（onClick/onChange/onInput/onPointer 等）」且未「显式 disabled / aria-disabled」且没有「title / aria-label / 可见文字」→ dead。任一满足即非 dead（票 27 允许 title/aria-label 作为「演示占位」说明）。
- **缺名判定**：既无 `title`/`aria-label`/`aria-labelledby`，也无可见文字/可推断文案（文本控件必须显式标签，`placeholder` 不算可访问名）。
- **点击目标**：从 CSS 主语选择器取生效声明，显式 `height/min-height` 优先，否则按「字号×行高 + 垂直内边距」估算；`<24px` 仅 WCAG 2.5.8 明确例外可豁免。
- **对比度**：`lib/tokens.js` 的 `TEXT_PAIRS` 实际使用色对，按 WCAG 相对亮度公式分别计算日夜两套。

## 3. 汇总

- 控件总数：**70**（button 57、input 8、textarea 1、select 1、li role=option 2）
- dead：**0**
- 缺可访问名：**0**
- 点击目标：37 个类名组合全部 ≥24px（1 个拖拽分隔条按例外记录）
- 焦点：全站 `:focus-visible` 兜底规则已铺，另 14 条面板级显式规则
- 对比度：17 组场景 × 日/夜 = 34 组全部通过 AA

## 4. 修复清单

| # | 问题 | 位置 | 修复 |
|---:|---|---|---|
| 1 | 条件渲染 checkbox 无可访问名 | `lib/main-view.js` 会话流评审项 | 加 `aria-label="勾选 ${String(r?.t ?? '')}"` |
| 2 | 命令面板 option 行无处理函数；option 内嵌套 button（交互元素嵌套） | `lib/main-view.js` renderCommandPalette | option 行自身 `onClick` + `aria-disabled`，移除内嵌 button，文案改 span |
| 3 | 审批设置 select 无可访问名 | `client/client.js` ApprovalSettings | 加 `aria-label="工具类别：${tool.label}"` |
| 4 | 目录白名单输入框无标签（只有 placeholder） | `client/client.js` ApprovalSettings | 加 `aria-label="目录白名单路径"` |
| 5 | 移除白名单按钮只有 × 符号 | `client/client.js` ApprovalSettings | 加 `aria-label="移除白名单目录 ${dir}"` |
| 6 | 危险命令 checkbox 无可访问名 | `client/client.js` ApprovalSettings | 加 `aria-label="标注危险命令"` |
| 7 | 手写命令面板输入框无标签 | `client/client.js` LauncherRoot | 加 `aria-label="搜索命令"` |
| 8 | 折叠按钮高度 22.8px | `lib/main-view.js` mainCss | `min-height:24px` |
| 9 | 开关高度 22px | `lib/dock-settings.js` dockSettingsCss | 高度 22→24，圆点 top 3px / on left 19px |
| 10 | 模型触发按钮高 22.2px | `lib/model-surface.js` modelCss | `min-height:24px` + inline-flex 居中 |
| 11 | 模型搜索框高 18.2px | `lib/model-surface.js` modelCss | `min-height:24px` |
| 12 | 分屏档位按钮高 17.4px | `client/client.js` CSS | `min-height:24px` |
| 13 | 日夜切换 chip 16px | `client/client.js` CSS | `min-width/min-height:24px` + 居中 |
| 14 | 返回会话按钮 16.8px | `client/client.js` CSS | `min-width/min-height:24px` |
| 15 | 命令面板行高 18.2px（改结构后） | `lib/main-view.js` mainCss | `min-height:24px` + padding 8px 10px |
| 16 | 键盘焦点无全站兜底 | `lib/tokens.js` skeletonCss | 加 `.launcher-shell :focus-visible{outline:2px solid var(--l-accent);outline-offset:2px}` |
| 17 | `--l-green-soft` 变量未定义（计划步骤完成态底色失效） | `lib/tokens.js` | 新增 `greenSoft` 令牌：日间 `#dcebe3`、夜间 `#1e3a31`，并纳入 AA 色对 |
| 18 | AA 覆盖不足（原仅 6 组） | `lib/tokens.js` TEXT_PAIRS | 扩到 17 组：ink4/accent/onAccent/tipInk/greenSoft/amber/red 等实际用例 |

## 5. 对比度 AA 结果（WCAG，正文 4.5:1）

| 场景 | 前景 / 背景 | 日间 | 夜间 | 判定 |
|---|---|---:|---:|:---:|
| 正文 | `#1b1c19` / `#f4f1e9` | 15.17 | 15.56 | ✓ |
| 正文（面板） | `#1b1c19` / `#faf8f3` | 16.13 | 14.73 | ✓ |
| 次要文字 | `#4c4d46` / `#f4f1e9` | 7.57 | 9.13 | ✓ |
| 次要文字（面板） | `#4c4d46` / `#faf8f3` | 8.05 | 8.65 | ✓ |
| 弱化文字 | `#615f56` / `#eeeae0` | 5.33 | 7.10 | ✓ |
| 弱化文字（面板） | `#615f56` / `#faf8f3` | 6.03 | 6.95 | ✓ |
| 正文（卡片） | `#1b1c19` / `#fffdf8` | 16.84 | 14.14 | ✓ |
| 弱化文字（浅底） | `#615f56` / `#f4f1e9` | 5.67 | 7.34 | ✓ |
| 辅助文字 | `#67645a` / `#f4f1e9` | 5.25 | 6.35 | ✓ |
| 辅助文字（面板） | `#67645a` / `#faf8f3` | 5.58 | 6.01 | ✓ |
| 强调文字 | `#3a55c8` / `#f4f1e9` | 5.62 | 8.21 | ✓ |
| 强调文字（面板） | `#3a55c8` / `#faf8f3` | 5.97 | 7.78 | ✓ |
| 主按钮文字 | `#ffffff` / `#3a55c8` | 6.34 | 8.29 | ✓ |
| 提示冒泡文字 | `#ffffff` / `#2c2c2e` | 13.94 | 10.82 | ✓ |
| 计划完成态 | `#2c7458` / `#dcebe3` | 4.55 | 6.09 | ✓ |
| 审批强调 | `#7a4d12` / `#fffdf8` | 7.13 | 9.90 | ✓ |
| 危险文字 | `#ab3f36` / `#fffdf8` | 5.91 | 7.08 | ✓ |

> 大字号（≥18.66px 粗体或 ≥24px）门槛为 3:1，本表全部为正文尺寸，按 4.5:1 从严判定。

## 6. 点击目标实测（按类名组合）

| 类名 | 高度 px | 宽度 px | 判定 |
|---|---:|---:|---|
| `launcher-rail__logo` | 30 | 30 | ✓ ≥24 |
| `launcher-rail__action` | 38 | 38 | ✓ ≥24 |
| `launcher-rail__entry` | 36 | 36 | ✓ ≥24 |
| `launcher-fold` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-tools__h` | 30.8 | 内容自适应 | ✓ ≥24 |
| `launcher-btn` | 28 | 内容自适应 | ✓ ≥24 |
| `launcher-icon-btn` | 26 | 26 | ✓ ≥24 |
| `launcher-cm-input` | 40 | 内容自适应 | ✓ ≥24 |
| `launcher-send` | 30 | 30 | ✓ ≥24 |
| `launcher-palette__input` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-palette__row` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-dock-tab` | 32.8 | 内容自适应 | ✓ ≥24 |
| `launcher-dock-tab launcher-dock-tab--icon` | 32.8 | 内容自适应 | ✓ ≥24 |
| `launcher-seg` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-seg launcher-seg--primary` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-tree-row` | 26.2 | 内容自适应 | ✓ ≥24 |
| `launcher-term-in__input` | 28 | 内容自适应 | ✓ ≥24 |
| `launcher-switch` | 24 | 38 | ✓ ≥24 |
| `launcher-seg launcher-seg--danger` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-settings__tab` | 32.8 | 内容自适应 | ✓ ≥24 |
| `launcher-settings__close` | 28 | 28 | ✓ ≥24 |
| `launcher-pop-item` | 34 | 内容自适应 | ✓ ≥24 |
| `launcher-cm-t` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-pop-search__in` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-ctx__entry` | 26 | 内容自适应 | ✓ ≥24 |
| `launcher-approval-settings__mode` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-approval-settings__input` | 24 | 180 | ✓ ≥24 |
| `launcher-perm__pill` | 26 | 内容自适应 | ✓ ≥24 |
| `launcher-perm__item` | 28.8 | 内容自适应 | ✓ ≥24 |
| `launcher-turn-action` | 28 | 24 | ✓ ≥24 |
| `launcher-empty__starter` | 36 | 内容自适应 | ✓ ≥24 |
| `launcher-splitbar__mode` | 24 | 内容自适应 | ✓ ≥24 |
| `launcher-theme-chip` | 24 | 24 | ✓ ≥24 |
| `launcher-panel-back__btn` | 24 | 24 | ✓ ≥24 |
| `launcher-dock__handle` | 18.2 | 8 | 例外（见遗留项） |
| `launcher-palette__item` | 30.2 | 内容自适应 | ✓ ≥24 |
| `launcher-hostguard__close` | 24 | 内容自适应 | ✓ ≥24 |

## 7. 控件清单与状态

| 行 | 构建 | 标签/role | 类名 | 处理函数 | 显式 disabled | 可访问名 |
|---:|---|---|---|:---:|:---:|---|
| 250 | vnode | button | launcher-rail__logo | ✓ | — | `dsh 首页` |
| 267 | vnode | button | launcher-rail__action | ✓ | — | `开关右栏` |
| 278 | vnode | button | launcher-rail__action | ✓ | — | `开关侧栏` |
| 292 | vnode | button | launcher-rail__entry | ✓ | ✓ | `entry.label` |
| 309 | vnode | button | launcher-rail__action | ✓ | — | `theme === 'dark' ? '切换到日间' : '切换到夜间'` |
| 319 | vnode | button | launcher-rail__action | ✓ | — | `命令面板` |
| 429 | vnode | button | launcher-fold | ✓ | — | 可见文字 |
| 443 | vnode | button | launcher-tools__h | ✓ | — | 可见文字 |
| 499 | vnode | input | — | ✓ | — | `勾选 ${String(r?.t ?? '')}` |
| 515 | vnode | button | launcher-btn | ✓ | — | 可见文字 |
| 532 | vnode | button | launcher-btn | ✓ | — | 可见文字 |
| 553 | vnode | button | launcher-btn | ✓ | — | 可见文字 |
| 562 | vnode | button | launcher-btn | ✓ | — | 可见文字 |
| 578 | vnode | button | launcher-btn | ✓ | — | 可见文字 |
| 611 | vnode | button | launcher-icon-btn | ✓ | — | `name` |
| 658 | vnode | textarea | launcher-cm-input | ✓ | — | `输入消息` |
| 679 | vnode | button | launcher-send | ✓ | ✓ | `发送` |
| 718 | vnode | input | launcher-palette__input | ✓ | — | `搜索命令` |
| 730 | vnode | li / option | launcher-palette__row | ✓ | ✓ | 可见文字 |
| 883 | vnode | button | — | ✓ | — | 可见文字 |
| 897 | vnode | button | — | ✓ | — | `open ? '收起' : '展开'` |
| 911 | vnode | button | — | ✓ | — | `String(row.title ?? '')` |
| 954 | vnode | button | — | ✓ | — | `String(row.title ?? '')` |
| 970 | vnode | button | — | ✓ | — | `String(ws.cwd ?? ws.name ?? '')` |
| 1042 | vnode | button | — | ✓ | — | `收起侧栏` |
| 1143 | vnode | button / tab | launcher-dock-tab | ✓ | — | `tab.label` |
| 1158 | vnode | button | launcher-dock-tab launcher-dock-tab--icon | ✓ | — | `收起右栏` |
| 1210 | vnode | button | launcher-seg | ✓ | — | 可见文字 |
| 1211 | vnode | button | launcher-seg | ✓ | — | 可见文字 |
| 1213 | vnode | button | launcher-seg launcher-seg--primary | ✓ | — | 可见文字 |
| 1219 | vnode | button | launcher-tree-row | ✓ | — | `file.n` |
| 1244 | vnode | input | launcher-term-in__input | ✓ | — | `终端输入` |
| 1251 | vnode | button | launcher-seg | ✓ | — | 可见文字 |
| 1264 | vnode | button | launcher-seg | ✓ | — | 可见文字 |
| 1272 | vnode | input | launcher-term-in__input | ✓ | — | `侧聊输入` |
| 1279 | vnode | button | launcher-seg launcher-seg--primary | ✓ | — | 可见文字 |
| 1309 | vnode | button | launcher-seg | ✓ | — | `copied ? '回退命令已复制' : '复制回退命令'` |
| 1323 | vnode | button | launcher-seg | ✓ | — | 可见文字 |
| 1335 | vnode | button | launcher-seg | ✓ | — | 可见文字 |
| 1346 | vnode | button / switch | launcher-switch | ✓ | — | `row.label` |
| 1364 | vnode | button | launcher-seg | ✓ | — | 可见文字 |
| 1367 | vnode | button | launcher-seg launcher-seg--danger | ✓ | — | 可见文字 |
| 1370 | vnode | button | launcher-seg | — | ✓ | `control.reason ?? ''` |
| 1384 | vnode | button / tab | launcher-settings__tab | ✓ | — | 可见文字 |
| 1405 | vnode | button | launcher-settings__close | ✓ | — | `关闭设置` |
| 1511 | vnode | button / menuitemradio | launcher-pop-item | ✓ | — | 可见文字 |
| 1528 | vnode | button | launcher-cm-t | ✓ | — | `选模型` |
| 1538 | vnode | button | launcher-cm-t | ✓ | — | `推理等级` |
| 1548 | vnode | button | launcher-cm-t | ✓ | — | `模型与推理等级` |
| 1572 | vnode | input | launcher-pop-search__in | ✓ | — | `搜索模型` |
| 2051 | vnode | button | launcher-ctx__entry | ✓ | ✓ | `unavailable ? '上下文用量不可用' : ′上下文占用 ${pct}% · 点开看拆分′` |
| 2220 | vnode | button | launcher-approval-settings__mode | ✓ | — | 可见文字 |
| 2230 | vnode | select | — | ✓ | — | `工具类别：${tool.label}` |
| 2238 | vnode | input | launcher-approval-settings__input | ✓ | — | `目录白名单路径` |
| 2246 | vnode | button | — | ✓ | — | 可见文字 |
| 2259 | vnode | button | — | ✓ | — | `移除白名单目录 ${dir}` |
| 2271 | vnode | input | — | ✓ | — | `标注危险命令` |
| 2339 | vnode | button | launcher-perm__pill | ✓ | ✓ | `current.label` |
| 2351 | vnode | button / menuitemradio | launcher-perm__item | ✓ | — | 可见文字 |
| 2579 | vnode | button | launcher-turn-action | ✓ | — | `row.label` |
| 2885 | vnode | button | launcher-empty__starter | ✓ | — | 可见文字 |
| 3613 | vnode | button | launcher-splitbar__mode | ✓ | — | 可见文字 |
| 3625 | vnode | button | launcher-theme-chip | ✓ | — | `切换日夜模式` |
| 3652 | vnode | button | launcher-panel-back__btn | ✓ | — | 可见文字 |
| 3665 | vnode | div / separator | launcher-dock__handle | ✓ | — | `右栏宽度（拖拽 320–520）` |
| 3715 | vnode | button | — | ✓ | — | `关闭调试面板` |
| 3723 | vnode | input | launcher-palette__input | ✓ | — | `搜索命令` |
| 3735 | vnode | li / option | launcher-palette__item | ✓ | ✓ | 可见文字 |
| 3908 | DOM | button | launcher-hostguard__close | ✓ | — | 可见文字 |
| 3924 | DOM | button | launcher-hostguard__close | ✓ | — | 可见文字 |

## 8. 复现与验证命令

```bash
cd Plugins/DSHClientUILauncher
node --test test/*.test.mjs            # 396 pass / 0 fail
node scripts/audit-controls.mjs         # exit 0，dead 0
node tools/sync-contract.mjs --check    # exit 0
node --check client/client.js lib/tokens.js lib/main-view.js lib/model-surface.js lib/dock-settings.js scripts/audit-controls.mjs
```

## 9. 遗留项

1. **右栏拖拽分隔条** `launcher-dock__handle` 命中宽度 8px：它是连续拖动目标，按 WCAG 2.5.8「essential」例外记录，未按 24px 离散按钮要求处理。
2. **巡检范围**：仅覆盖本包渲染树（`client/client.js` 的 h()/DOM 控件）。宿主注入的第三方面板（plugin-manager / archive-manager 等）不在本包渲染树内，其控件由各自插件的验收负责。
3. **焦点环的视觉确认**：静态保证全站 `:focus-visible` 规则存在且不被 `outline:none` 覆盖；实际可见性由 S3 canary / 真机截图复核（发布前既有门禁）。
4. **静态判定边界**：`onClick: () => opts.onX?.()` 这类可选回调在父组件不传时运行期无动作；本票按票 27 口径以「源码有处理函数接线」判定，动态可达性由 canary 覆盖。

**是否阻塞发布：否。** 以上 1/2/4 为已记录口径与例外，3 由既有 canary 门禁覆盖，均不构成 dead control 或 AA 失败。
