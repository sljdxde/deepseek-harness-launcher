Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

模型设置参考 dsh 的条目面板设计（模型 / 推理等级 / 启用智能体团队协作 + 开关）。

## Answer

（产出 `prototype/dsh-ui-merged-v14.html`，明细 `prototype/改动说明-v14.md`。）

- 设置→模型 改为 dsh 样式条目面板：44px 条目、圆角 10、悬停整行高亮。
- 模型行：值 `deepseek v3.2 · routing group` + 箭头，点开换模型弹窗。
- 推理等级行：值 Default（标准=Default，另两档显示快速/深度），点开三选项弹窗，选完回写并与输入框 pill 同步。
- 启用智能体团队协作：? 说明图标 + role=switch 开关（aria-checked、accent 开态）。
- 子代理模型 / 上下文压缩 移到「其他」卡片。
- 验证：行高 44、三处值都读状态、开关 aria 正确、弹窗选择生效并关闭；a11y 100、控制台 0 报错。
