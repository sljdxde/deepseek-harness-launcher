Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

换模型弹窗要支持推理等级选择（图 1）。

## Answer

（产出 `prototype/dsh-ui-merged-v13.html`，明细 `prototype/改动说明-v13.md`。）

- 弹窗模型列表下新增「推理等级」：快速 / 标准 / 深度分段控件（role=radiogroup + aria-checked），带 token 倍数 title 与随模型变化的提示文案。
- 选模型不关窗，可同时定等级；「在用」与勾选同步。
- 输入框那行「深入」→「推理 · <等级>」，点开同一弹窗；深度等价原来深入开（deep 同步）。
- 设置页推理等级行显示当前值。
- 修真实 bug：弹窗原来只在种类变化时重建，内部状态刷不出来 → modelPick 的 key 加「模型|等级」签名。
- 验证：aria-checked / 右侧值 / pill / deep 全部同步，弹窗保持打开；a11y 100；控制台 0 报错。
