Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

侧栏：排版对齐；「工作区」三字加重；排列/展示/按钮/按钮位置完全 copy dsh，不要自我创造。

## Answer

（产出 `prototype/dsh-ui-merged-v9.html`，明细 `prototype/改动说明-v9.md`。）

对照运行中 dsh 实测逐项复刻：区头 36 高 / 左 12 / 文字 14px·600（按要求加重）/ 右侧按钮 28×28·圆角 8·gap 4·图标 16；行 32 高、行距 4、内边距 `0 8px 0 9px`、圆角 12；标题 14px·400 近黑、时间 12px 次要色；**会话不缩进**（与工作区标题同一 x）、无引导线；工作区行只留 folder + 标题（无计数、无常显箭头，hover 出三角）；行内动作绝对定位 right 8 / gap 13；会话动作顺序 ⋯/归档/置顶，工作区动作顺序 ⋯/新建会话；选中底色 rgba(38,49,72,.06)。

删掉上一版自造项：会话计数、常显折叠箭头、会话缩进+竖线、会话行消息图标、标题 550 字重。

需要你卡片两组条目对齐到同一网格（实测圆点 x=79、标题 x=90）。

验证：各项尺寸/顺序/位置实测与 dsh 一致；Lighthouse a11y 100；控制台 0 报错。截图 v9-sidebar-light / tasks / dark。
