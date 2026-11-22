Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

主题背景看不出变多（v18 太淡）。

## Answer

（产出 `prototype/dsh-ui-merged-v19.html`，明细 `prototype/改动说明-v19.md`。）

- 根因：壳色与面板色几乎同色、壳边仅 8px、柔光过淡。
- 壳色独立 token 并压深：浅 #e7dfcc / 深 #0b0c0e；面板保持原色，拉开一个明度档。
- 壳边距 8→14、圆角 14→16；柔光 .28→.34（深 .22→.26）；颗粒 .24→.38（深 .28→.42）；对话区点阵 20px、不透明度 .85。
- 新增 max-width:1280 兜底：卡片退回满铺，避免窄窗被壳边距挤到裁切。
- 验证：1500 浅/深对比明显、1100 无裁切、a11y 100、控制台 0 报错。
- 后续可选项已在说明里列出（底纹主题 / 几何水印 / 随时间渐变）。
