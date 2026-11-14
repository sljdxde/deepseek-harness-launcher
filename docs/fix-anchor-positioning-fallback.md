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
