Label: wayfinder:grilling

## Question

**技术栈路线拍板**（本图的根决策）：Windows 版 DHL 用哪条路线落地？在 T1（官方能力对照）+ T4（真实 Windows 原型证据）之上，人类就以下候选定夺：
- Route A：采用/扩展官方 Tauri 壳，把 DHL 三插件注入 + 便利性做进这个壳。
- Route B：新写跨平台壳（Tauri/Electron）复刻全部便利。
- Route C：Swift on Windows 复用 Foundation"大脑" + UI 重写。
- Route D：原生 .NET（WinUI/WPF + 托盘）Windows 专属壳。

需一并敲定的下游牵连（据所选栈）：共享 JS 插件层如何跨平台注入；约 5,700 行 Swift"大脑"是复用、移植还是重写；代码组织（单仓多壳 / 拆仓）。

这一票的分辨率把地图大片雾毕业成具体功能票。**它的结论是本图能否交付 Windows 版的分水岭。**

## Blocked by

t4, t2
