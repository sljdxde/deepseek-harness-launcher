Label: wayfinder:research

Type: research
Status: resolved
Blocked by: —
Assignee: module-inventory（2026-11-20）

## Question

按「脑 / 皮」边界盘一遍现有 `Plugins/DSHClientUILauncher`（`client/client.js` 2074 行 + `lib/` 约 3800 行 + `lib/approval/` + `contracts/` + `tools/`），给规格一份「保留 / 重写 / 待定」清单：

1. 每个模块一句话职责 + 行数 + 依赖的宿主契约（slot / 服务 / API）。
2. 判定：契约快照与工具、审批链、dock/panes/composer 纯逻辑、宿主服务适配属于「脑」；布局 / rail / sidebar / topbar / statusbar / 页面容器属于「皮」；跨界的标「待定」并写理由。
3. 指出「皮」里与融合版冲突的旧假设（侧栏 280、断点 1020/860、B 方案侧栏外观等）。
4. 指出「脑」里可直接带进新规格的验收与测试资产（单测、契约 baseline、审批回归）。

输出：一张表（模块 | 行数 | 职责 | 宿主契约 | 判定），末尾 5 条「重写时最容易漏掉的东西」。只读，不改代码。

## Answer

（2026-11-20，`module-inventory` 子代理；全文见 `research/现有实现脑皮盘点.md`。）

- **总盘**：8820 行。脑可整体搬 ≈2997 行（审批 1231 + 契约/工具 711 + 纯逻辑 1766 中的大部分 + 验收脚本），测试 22 文件 / 203 条（当前 202 绿 1 红：`BUILD_STAMP` 落后 3 笔）。
- **皮**：`client.js` 1–156（CSS/生成区）、1305–1841（LauncherRoot）、1928–2074（apply/注册）共约 840 行要重写；157–1304（适配层 + 6 处 DOM 桥）逐个拆：契约注册留、DOM 桥是负债。
- **关键残缺**：审批「脑全、皮全缺」——`approvalRequest()` 在 client 里没有定义，审批卡只有 CSS。
- **冲突**：侧栏 280 vs 272、右栏 380 vs 384、断点 1020/860 vs 980/400、缺 topbar 多 splitbar、B 方案与全自绘侧栏冲突、`shell.leading` 位置错、一批自造 props 无供给方、主题变量名错、⌘B dead control。
- **5 条坑**：8 处逻辑靠人肉同步；审批皮缺失；状态来源要重定义；契约快照三处盲区（owner props / SlotFactoryMap / retainMainPanels）；验收现在就是红的（rc.4 vs rc.5、baseline）。
