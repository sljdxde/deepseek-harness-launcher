Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

v20 的分栏在 1442 宽下右栏被裁、顶栏文字被压；不要继续改，回到之前的 v19。

## Answer

- 当前参照物改回 **`prototype/dsh-ui-merged-v19.html`**（三张浮卡 + 壳层柔光/颗粒/点阵，14px 壳边距、16 圆角）。
- v20（底纹主题/水印/时段色温）与 v21（满铺版）保留为实验留档，**不采用**。
- 记录根因：v20 的卡片用 margin 做壳边距，grid 轨道不随 margin 收缩，1442 宽时总宽超出视口 → 右栏被裁、顶栏挤压；正确做法应是用 `.app{padding + column-gap}` 而不是 item margin。
- 未做的可选项：若要把 v20 的三项背景能力补到 v19 上，需改用 padding+gap 布局重做（一次到位），等确认后再动。
