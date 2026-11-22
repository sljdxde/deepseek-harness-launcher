Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

去掉工作区行的小三角折叠样式；需要你 / 工作区 / 任务 三段统一成同一种样式；折叠箭头全部放最右侧。

## Answer

（产出 `prototype/dsh-ui-merged-v10.html`，明细 `prototype/改动说明-v10.md`。）

- 删掉工作区行 folder 下的小三角（`.ws-row .chev` = 0）；展开/收起改为整行点击，保留 aria-expanded。
- 三段统一成同一卡片组件：`.side-card` + `cardHeader()`，头部 40 高、1px 边框、圆角 12、段间距 8；结构 = 圆点 + 标题 + 计数胶囊 + [操作图标] + 折叠箭头。
- 箭头统一最右：独立按钮（同一 toggle 动作），三个卡片箭头右端 x=297 对齐；⌄/› 随状态切换。
- 计数胶囊保留语义色（需要你琥珀 / 工作区蓝 / 任务灰），形状一致。
- 验证：展开 590 ↔ 收起 42；aria-expanded 同步；Lighthouse a11y 100；控制台 0 报错。截图 v10-expanded / collapsed / tasks。
