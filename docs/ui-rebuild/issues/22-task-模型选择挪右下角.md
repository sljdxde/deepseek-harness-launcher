Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

模型选择位置不对，应放输入框右下角。

## Answer

（产出 `prototype/dsh-ui-merged-v17.html`，明细 `prototype/改动说明-v17.md`。）

- .cm-row 目录 pill 后加弹性空隙，右侧「⌘↵ 发送 18% + 模型/等级 + 发送」整组靠右。
- 模型段紧贴发送按钮左侧（send 右端=行右端 1191，模型段 984-1155）。
- 浮层按触发按钮实时定位，挪位置后自动跟随。
- 验证：布局数值正确、浮层仍向上弹、a11y 100、控制台 0 报错。
