Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

上一轮改的是设置页，我要的是「换模型弹窗」照 dsh 的条目面板改；弹窗里分段控件还在，等于没改。

## Answer

（产出 `prototype/dsh-ui-merged-v15.html`，明细 `prototype/改动说明-v15.md`。）

- 换模型弹窗里删掉推理等级分段控件，改成 dsh 的 drow 行：左标签 + 右侧值（Default/快速/深度）+ 箭头。
- 点行就地展开三个子行（带 token 说明、勾选），选完自动收起、值回写、弹窗不关。
- 未选中模型行去掉圆点图标改 16px 空槽，标题与选中行对齐。
- 弹窗底部补「启用智能体团队协作」行（? + role=switch），与设置页一致。
- 验证：弹窗内 .seg=0、drow=2；选深度后行值与输入框 pill 同步、弹窗不关；a11y 100；控制台 0 报错。
