Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

侧栏不满意：层级要显示、点击会跳、工作区照 dsh 当前设计、「需要你」要汇总（待我处理 + 已完成未查看）、任务段同样跳、排版留空要优化。用 Modern Web Guidance 指导。

## Answer

（产出 `prototype/dsh-ui-merged-v8.html`，明细 `prototype/改动说明-v8.md`。）

- 实测运行中 dsh 侧栏规格并复刻：行 32px、`padding:0 8px 0 9px`、圆角 12、图标 14、区头 36/32px、动作浮层宽 0（绝对定位）。
- 跳动三因三修：整块重绘丢滚动 → `renderSide` 保存/恢复 scrollTop + 按 data-act/id 还原焦点；行高不固定 → 统一 32px；悬停动作插流 → 绝对定位 + 时间淡出，几何不变。
- 层级：工作区（caret+folder+count）→ 子会话缩进 32 + 1px 引导线，字号/颜色降档；三段 `<section aria-label>`。
- 需要你：汇总卡 = 待我处理 N（琥珀点）+ 已完成未查看 M（绿点），区头总数 = 两者之和。
- 排版：行间距 1、分区 10、区头动作 26、title 13 / meta 11。
- 验证：点击后 scrollTop 120→120、行 top 289→289、宽高不变；悬停几何不变；Lighthouse a11y 100 保持；控制台 0 报错。
- 未做：折叠仍用 button+aria-expanded（导航树不适用 details，且 summary 不能放按钮）；目录层不进侧栏。
