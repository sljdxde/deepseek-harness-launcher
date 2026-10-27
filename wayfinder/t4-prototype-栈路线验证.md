Label: wayfinder:prototype

## Question

在真实 Windows 机器上，把技术栈路线的候选各做一个便宜原型，用能跑的保真度决定走哪条：
- **Route A（采用官方 Tauri 壳）**：官方 `deepseek-harness-desktop` 装到 Windows，把 DHL 的三个 JS 插件经 `--patch` 注入，验证插件能否跑起来、归档/插件/通知面板能否出现。
- **Route C/D 探针**：任选最小验证——官方壳若无 `--patch`，评估插件层要不要另起宿主。

产出可运行的 Windows 证据，链接进本票。据 T1 的对照表决定 A 还剩多少独有价值；据 T3 的机器做验证。最终把"栈路线"拍板为一张具体决策。

## Blocked by

t1, t3
