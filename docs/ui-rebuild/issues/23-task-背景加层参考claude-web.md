Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

背景要更丰富一点，参考 claude-web（可下载源码分析）。

## Answer

（产出 `prototype/dsh-ui-merged-v18.html`，明细 `prototype/改动说明-v18.md`；claude-web 源码在 `/tmp/claude-web-ref`。）

- 读 claude-web 的 styles.css 与 2026-10-16 texture spec：壳(--surface-1)/板(--surface-0 卡片 + 发丝边 + elev) 结构。
- 侧栏/主区/右栏改成浮在壳上的三张卡：14px 圆角、1px 发丝边、接触+漫射双层阴影、四周 8px 壳边距、轻微竖向渐变。
- 壳层加三层 radial 柔光（暖/冷/青，日夜不同强度）+ 纯 CSS 点阵颗粒（soft-light 混合）。
- 对话区 22px 点阵纹理，从上向下渐隐。
- 全局 .card 加轻微浮起阴影。
- 踩坑记录：SVG feTurbulence data URI 会导致 Chrome 截断整张样式表（10 条规则），已改纯 CSS 点阵。
- 验证：规则数 720、浅/深色与设置页截图正常、a11y 100/BP 100、控制台 0 报错。
