Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

把融合版原型修到「能当验收参照物」：

1. **布局**：`.main` 改成四行网格（`auto auto minmax(0,1fr) auto`）+ `.main>.page{grid-row:2/-1}`，让聊天页 6 个 tab 恢复 40px 可点（现状被压成 1px）。
2. **交互**：补 `case 'split'`（真分屏或明确置灰 + 说明）；修 `copy`（写剪贴板）；修 `autoToggle`（真改状态）；`stage` / `commit` / `revert` 要么真改 `S.diff`，要么置灰 + 说明。
3. **假开关**：16 处只 toast 的按钮逐条处置——能做就做，不能做就置灰 + `title`，不允许静默 toast。
4. **触屏 / Tab 可达**：hover-only 的 `.msg-acts`、`.pin`、`.ws-row .more` 补 `:focus-within` 与触屏显形。
5. **交付**：`dsh-ui-merged-v3.html`（或原地改并打版本注释）+ 一份「改了什么」清单。

不做：对齐清单里的新交互（等 05）；不引入构建工具。

## Answer

（2026-11-20）产出 `prototype/dsh-ui-merged-v3.html` + `prototype/改动说明-v3.md`。

- **布局**：`.main` 改 4 行网格并显式分行；实测网格行 `46 / 40.4 / 563 / 149`，6 个 tab 恢复 40px，`elementFromPoint` 命中 `BUTTON.tab`；轨迹页 `.page` 563，不压 composer。
- **交互**：分屏做成真 2 栏（对话 + 轨迹）；`copy` 接剪贴板（含 `execCommand` 回落）；`autoToggle` 真改 `AUTOS[].on`；`stage` 打 `staged` 标、`commit` 只提交已暂存项。
- **假开关**：剩余 `data-act="toast"` 统一 `.is-stub`（透明度 .55、`title="演示占位：…"`），不再静默。
- **可达性**：`.pin` 补 `:focus-within`；`@media (hover:none)` 常显。
- **验证**：file:// 实测，控制台 0 报错；分屏 2 pane、暂存 3 个「已暂存」、提交后 diff 清空、自动化「已启用→已停用」。
- 未做：claude-web 新交互（等 05）、4/6 栏与 pane 降档（等规格）。
