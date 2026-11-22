Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

对话框的模型选择要照 dsh 做轻量浮层，不要弹大框。

## Answer

（产出 `prototype/dsh-ui-merged-v16.html`，明细 `prototype/改动说明-v16.md`。）

- 输入框右下角改成 `deepseek v3.2  Default ⌄` 三个轻量触发。
- 点模型名/⌄ → 上方浮出模型面板（搜索框 + DeepSeek/路由组分组 + 当前项勾选），选中即关。
- 点等级 → 浮出 Default/Low/High/Max 四项，当前项勾选，选中即关；deep 在 High/Max 为真。
- 浮层 fixed 贴触发按钮上方、右对齐不出屏、圆角 12 带阴影、max-height 56vh；点外部/Esc/切页自动收。
- 删除原「推理·标准」pill 与对话框入口（设置页与换模型对话框文案同步改四档）。
- 验证：两组浮层内容与勾选正确、选中回写 footer、关闭方式齐全；a11y 100（chevron 24px）；控制台 0 报错。
