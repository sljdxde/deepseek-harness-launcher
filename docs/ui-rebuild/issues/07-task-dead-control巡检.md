Label: wayfinder:task

Type: task
Status: open
Blocked by: 06

## Question

写一个能对原型跑「0 dead control」巡检的脚本（优先无外部依赖；Node + CDP 或 headless 浏览器二选一）：

1. 枚举所有带 `data-act` / `role=button` / `<button>` / `[tabindex]` 的控件。
2. 逐个点击（或聚焦 + Enter），记录：DOM/状态是否变化、是否只出 toast、是否无任何反应、控制台报错。
3. 输出机器可读结果（JSON）+ 人读摘要（dead / toast-only / ok 三类计数）。
4. 对当前融合版跑一遍做基线；对 v3 跑一遍必须 dead=0、toast-only=0（或全部有 `title` 说明）。

产出：脚本 + 使用说明 + 两次运行的输出。
