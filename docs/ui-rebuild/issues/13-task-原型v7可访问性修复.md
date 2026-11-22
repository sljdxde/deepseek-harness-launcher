Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

按 12 号审计结论修 P0（弹层/菜单/对比度/目标尺寸/语义）与 P1（search、标题、color-scheme、滚动条、跳转链接），产出 v7 并复验。

## Answer

（产出 `prototype/dsh-ui-merged-v7.html`，明细 `prototype/改动说明-v7.md`。）

- 弹层 14 处改原生 `<dialog>`+`showModal()`：`closedby="any"`、`::backdrop`、`overscroll-behavior`、Safari 兜底；命令面板用 `<dialog popover="manual">`。
- 右键菜单改 `popover="auto"` + `role=menu/menuitem`，焦点入菜单、↑↓/Home/End、点外/Esc 关闭。
- 对比度：`--ink4` 5.58/6.01（原 3.05/3.75）、`--amber` 加深/提亮、`.is-stub` 去 opacity、选中行改 accent-soft。
- 目标尺寸 24×24；chip 不收缩且 ≤1600 只留图标。
- 行结构拆成主按钮 + 兄弟按钮（嵌套交互 0）；aria-pressed/expanded/selected 补齐；rail label 带角标；tabs 改 tablist+tab+方向键。
- P1：`<search>`、h1/h2 层级、`meta color-scheme` + 主题 `color-scheme`、`scrollbar-color`、跳转链接。
- 未做：`<details>` 折叠（与整块重绘冲突，押后到真机实现）、锚点定位菜单、SEO/agentic 元数据。
- 复验：Lighthouse Accessibility 94 → **100**，Best Practices 100；弹层焦点在框内、关闭状态同步；控制台 0 报错。
