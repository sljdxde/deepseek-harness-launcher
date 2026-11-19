# 修复：旧版 macOS 上弹层跑到窗口左上角

## 现象

在 Intel Mac（macOS 15 及更早）上使用内置窗口，点开「模型设置」「插件」等
弹层时，内容**全部叠在窗口左上角**，与触发它的按钮毫无关系，用户根本点不到
对应选项。同一台机器上，较新系统（macOS 26+）表现正常。

## 根因：CSS 锚点定位没有降级方案

DeepSeek Harness 的 Web 前端（`dsh-web-frontend`）用 **CSS Anchor
Positioning** 摆放所有弹出层：

```css
._portal_70kcw_43 {
  position: fixed;
  position-anchor: var(--dsh-menu-anchor);
  top: max(var(--dsh-menu-window-top), calc(anchor(bottom) + 4px));
  left: max(12px, anchor(left));
  right: 12px;
  ...
}
```

锚点定位是 **Safari 26 / macOS 26** 才提供的能力。在 macOS 15 及更早的
WebKit 上，`anchor()` 不是合法值，整条 `top` / `left` 声明被丢弃，回退到
规则里写死的字面量：

```css
top: max(12px, var(--dsh-frame-overlay-top, 12px));  /* → 12px */
left: 12px;                                          /* → 12px */
```

于是弹层出现在 `(12px, 12px)`——正是用户截图里的「左上角」。

关键点：**前端没有任何降级**。我检查了打包后的
`dist/assets/index-*.css` 与全部 JS：

- 没有 `@supports (anchor-name: …)` 之类的条件规则；
- 没有 `CSS.supports(...anchor...)` 的特性检测；
- 没有「不支持时改用 JS 摆位」的备用路径。

也就是说，只要 WebKit 版本不够，弹层必然错位。这是上游的兼容性缺口。

## 修复：启动器在能力缺失时注入降级

内置窗口是启动器自己的 `WKWebView`，可以在文档加载前注入脚本
（`WKUserScript` + `.atDocumentStart`）。新增
`Sources/HarnessAnchorFallback.swift`：

1. **先探测能力**：
   ```js
   CSS.supports('position-anchor: --x') && CSS.supports('top: anchor(top)')
   ```
   同时测属性与函数——只测其一会在「半实现」的版本上误判。
2. **支持就什么都不做**：新系统完全走 DSH 自己的定位，两套逻辑不会打架。
3. **不支持时**：
   - 清掉失效的 `position-anchor` / `position-area` / `position-try-fallbacks`
     （只改 `top`/`left` 不够，残留的锚点属性仍会参与布局）；
   - 以「最后点击 / 聚焦的元素」为锚点（弹层是 portal，挂在 `body` 上，无法
     从自身反推触发元素）；
   - 竖直方向优先摆在下方，放不下改上方，都放不下则贴边并限高；
   - 水平方向与触发元素对齐，超出视口则夹回边界内；
   - 用 `MutationObserver` + `requestAnimationFrame` 处理 React 动态插入；
   - 幂等：重复注入（页面内导航）不会叠加监听。

只在**内置窗口**注入。浏览器回退模式下页面在用户自己的浏览器里，不该被启动器
改写。

## 验证

- 用 node 跑注入脚本的真实逻辑（脚本从 Swift 源提取，避免两份实现漂移）：

  | 场景 | 结果 |
  |------|------|
  | 旧 WebKit，触发元素在窗口中部 | 弹层 `top=432 left=300`（触发元素 400-428），不再退回 `12,12` |
  | 旧 WebKit，触发元素贴底 | 弹层改到上方 `top=686`，未跑出屏幕 |
  | 新 WebKit（支持锚点） | 完全不改动弹层，`top`/`left` 未被写死 |
  | 重复注入 | 幂等，不重跑摆位 |

- 新增 `scripts/test-anchor-fallback.swift`（Swift 侧契约：探测表达式、幂等、
  必须清掉哪些属性、双向兜底、注入条件）与 `scripts/test-anchor-fallback.js`
  （行为回归），均接入 `scripts/test.sh`。
- `./scripts/test.sh` 全量回归绿。

## 教训

- **新 CSS 能力要配降级**：`anchor()`、`@container`、`:has()` 这类能力在
  「WebView 版本由用户系统决定」的场景里必须探测。桌面 App 内嵌 WebView
  尤其危险——同一份代码在开发机（新系统）上永远是对的。
- **别只测属性**：`position-anchor` 能被解析不代表 `anchor()` 能用，
  能力探测要把实际用到的函数一起测。
- **症状能直接指向机制**：弹层出现在 `(12,12)` 这个具体坐标，正是 CSS 里
  写死的回退值——从「这个数字哪来的」出发，比从「定位逻辑哪里错了」出发快得多。

---

# 二次修复：降级脚本误伤「自己居中」的弹层（0.4.3 → 0.4.4）

## 现象

0.4.3 发布后，点开「插件管理」「归档管理」，弹层被挤到窗口左侧、内容裁掉一半，
几乎无法操作；模型选择等菜单则正常。

## 根因：判据过宽

插件管理和归档管理的弹层是这样居中的：

```css
.dsh-pm-page {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, calc(100vw - 32px));
}
```

它们**根本不依赖锚点定位**，自己就能居中。但它们都带 `role="dialog"`，
而 0.4.3 的降级脚本把「`position: fixed` + `role="dialog"`」当成锚点弹层：

```js
if (role === 'menu' || role === 'listbox' || role === 'dialog'
    || role === 'group') return true;      // ← 把居中弹层也抓进来了
```

于是脚本改写了 `top`/`left`，**却没有清掉 `transform: translate(-50%,-50%)`**。
两部分叠加后的实际位置是：

```
left: 300px  +  translate(-50%) = 300 - 360 = -60px
```

弹层被推走自身宽度的一半，正好是截图里「内容裁到左边」的样子。

## 修复：按「是否真的用了锚点」判定，而不是按角色

```js
function hasAnchorDeclaration(el) { /* data-anchor-side、anchor-name … */ }
function centersItself(el) { return getComputedStyle(el).transform !== 'none'; }

function isOverlay(el) {
  if (centersItself(el)) return false;        // 自带居中的一律放过
  return hasAnchorDeclaration(el);
}
```

`scan()` 的选择器同步收窄，不再无条件抓 `role="dialog"`。

另外补了**升级路径**：旧版本可能已经给某些弹层写过内联 `top`/`left`，而内联样式
优先级高于 CSS，不清掉的话老用户升级后弹层仍然偏着。脚本启动时先把带
`data-dsh-anchor-fallback` 标记的元素还原。

顺带修了一个时序问题：`.atDocumentStart` 注入时 `documentElement` 可能还不存在，
原先会因拿不到根节点而装不上 `MutationObserver`。改为等 `DOMContentLoaded`。

## 验证

新增三类用例，并确认「撤销修复后测试会失败」：

| 用例 | 撤销修复 | 修复后 |
|------|---------|--------|
| 自带居中弹层不被改写 `top`/`left` | ❌ `top=432px` | ✅ 不动 |
| 带 `anchor-name` 的弹层仍被接管 | — | ✅ `top=432` |
| 升级路径还原旧版残留内联样式 | ❌ 残留 `12px` | ✅ 清空 |
| `documentElement` 缺失不抛错 | — | ✅ 等 `DOMContentLoaded` |

## 教训

- **降级逻辑的作用域要按「机制」划，不能按「表象」划**：`role="dialog"` 描述的
  是语义，不是定位方式。用一个宽泛的角色去匹配「用了某个 CSS 特性」的元素，
  必然误伤。
- **改别人的布局前，先看它原本怎么定位**：如果元素自带 `transform` 居中就说明
  它不需要你帮忙。**部分覆盖**（改 `left` 不改 `transform`）比不覆盖更糟。
- **降级脚本要写「还原」路径**：任何往 DOM 上写内联样式的注入，都必须能在
  下一次启动时把自己上次写的清掉，否则升级后遗症会一直留着。
