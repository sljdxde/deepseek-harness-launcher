Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

壳上做 3-4 种可切换底纹（纸纹/网格/点阵/纯色）；对话区加极淡大号几何水印；背景色随时间微变（早晚色温）。都落到 UI。

## Answer

（产出 `prototype/dsh-ui-merged-v20.html`，明细 `prototype/改动说明-v20.md`。）

- 外观新增「背景底纹」：纸纹/网格/点阵/纯色，`html[data-bg]` 驱动 `.app::before` 纯 CSS 渐变，即时切换。
- 对话区 `.thread-wrap::after` 92px 同心圆 + 30° 斜线水印，opacity .55、向下渐隐。
- `applyBg()` 按小时选 6 档色温叠在最上层，外观里显示当前时段（清晨…夜间），切主题/底纹自动重算。
- 验证：四种底纹 background-image 实测正确、水印生效、17 点取下午暖沙色；a11y 100、控制台 0 报错。
- 截图：v20-chat-dots / v20-settings-paper / v20-dark-grid。
