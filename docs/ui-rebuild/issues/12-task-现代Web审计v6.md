Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

用 modern-web-guidance 分析 v6 原型，给出分级改进意见（不改代码）。

## Answer

（全文：`notes/现代Web审计-v6.md`；实测 Lighthouse a11y 94，3 项失败 + 脚本测得 6 项。）

- P0-1 模态改原生 `<dialog>`+`showModal()`：实测打开后焦点停在 BODY、背景 84 个可聚焦元素、无 aria-modal。
- P0-2 右键菜单改 `popover="auto"` + `commandfor` + `position-area`/`position-try-fallbacks`；现 `role="menu"` 无方向键、焦点不进菜单。
- P0-3 对比度：`--ink4` 3.05/3.75、`.chip.demo` 暗色 3.53、`.is-stub` 用 opacity 压到 2.5-2.8。
- P0-4 目标尺寸：`.icon-btn.xs`/`.pin` 20×20 < 24。
- P0-5 语义：button 内嵌 role=button；分段控件/chips 无 aria-pressed；rail 按钮 aria-label 不含角标数字。
- P1-6 折叠区改 `<details>/<summary>`（`name` 互斥）；P1-7 搜索包 `<search>`；P1-8 补 h1、h4→h3；P1-9 补 `meta color-scheme` + `:root{color-scheme}`；P1-10 滚动条改 `scrollbar-color`。
- P2-11 全量 innerHTML 重绘导致焦点/滚动/过渡/dialog 状态丢失；P2-12 弹层补 `@starting-style`。
