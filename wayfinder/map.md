# Wayfinder 地图：DHL Windows 版移植

Label: `wayfinder:map`

## Destination（终点）

一个**能用的、正式发布**的 Windows 版 Deepseek Harness Launcher（DHL）：与 macOS 版功能逐项对等（效果对等），走现有 GitHub Releases 发布方式，产物在 DMG 之外新增 Windows 安装包（MSI 和/或便携 ZIP），捆绑 Node 运行时，不购买代码签名证书。终点包含执行——本图不止把路看清，还要把 Windows 版做出来。

## Notes（领域备忘与既定偏好）

- **本项目背景**：DHL 是纯 Swift/AppKit 的 macOS 菜单栏启动器，不套 WebView，拉起用户系统的 `dsh web`。耦合普查结论（2026-10-14）：
  - 可复用（Foundation-only、平台无关）≈5,700 行：runtime 安装/原子替换（`DSHRuntimeSupport.swift`）、版本比较（`UpdateSupport.swift`）、插件 `--patch` 隔离与启动失败恢复（`PluginIsolationSupport.swift`）、会话通知数据模型、HTTP 服务探测。
  - 必须重写（AppKit）≈2,612 行：菜单栏/托盘、Carbon 全局快捷键、设置/安装/更新窗口、NSAlert、badge 绘制、release notes 渲染。
  - 7 处 OS 粘合（藏在"平台无关"文件里）：NSAppleScript 标签页复用、NSWorkspace 浏览器检测、LaunchAgent 自启动、DMG/hdiutil 自更新、osascript 提权、lsof/ps/进程组信号、BSD socket 端口扫描。
  - 三个增强插件（归档管理/插件管理/会话通知）是纯 JS（≈9,000 行），经 `--patch` 注入，**任何平台的 dsh 都能原样加载**。
- **官方对照物**：`deepseek-harness-desktop`（Tauri 2，Rust+WebView）本来就跨 Win/macOS/Linux、捆绑 Node。栈路线不拍脑袋，先做原型验证（见工单）。
- **本图每张票开工前**：grilling + domain-modeling 技能按需调用；research 票用 research 技能。仓库 `AGENTS.md` 的版本号与发布周期规则同样适用于双平台产物（细节留给雾区毕业）。
- **既定偏好（人类已拍板，不再讨论）**：① 终点的产物是一个能用的 Windows 版；② 正式发布给更多人用；③ 全部功能逐项对等（用 Windows 原生机制达到同样效果，接受机制差异，不接受功能缺项）；④ 不捆绑→改**捆绑 Node**；⑤ **不买签名证书**，SmartScreen 警告为已知代价；⑥ MSI 或便携 ZIP 皆可（点开即运行）；⑦ 发布渠道沿用本仓库 GitHub Releases，DMG 与 Windows 产物同发布。
- 工单即本目录下的 md 文件；claim = 在工单头写 `Assignee`；frontier = 未关闭、`Blocked by` 全部已关闭、无 `Assignee` 的工单。

## Decisions so far（决策索引）

_（暂无已关闭工单；一条决策一行：摘要 + 链接）_

> 进行中：[T1 官方desktop能力对照](t1-research-官方desktop-windows能力.md)、[T2 Windows原生机制映射](t2-research-windows原生机制映射.md) 两张 research 票已在本 session 并行派发子代理解决，结论写回各自工单。

## Not yet specified（雾区：范围内、尚无法成票）

- **Windows CI/发布流水线**：GitHub Actions windows runner 上构建、打包、双产物发布、与现有 tag 校验如何共存——形状取决于栈路线（Tauri 壳与原生壳的构建链完全不同）。
- **代码组织**：单仓多壳还是拆仓；共享 JS 插件层与共享逻辑（Swift 复用 vs 移植成 TS/Rust/C#）怎么分层——取决于栈路线。
- **`--patch` 注入在 Windows 的行为**：路径、进程组、npm/pnpm 调用链有无平台差异（影响插件类功能票）。
- **对等清单里每项的验收标准**与降级口径——等"技术栈路线拍板"之后才能逐票细化。
- **卸载与升级残留**：Windows 上 runtime 目录、快捷方式、自启动项的清理。
- **文档与 README 双平台化**。

## Out of scope（范围外，不随前沿毕业）

- **代码签名**：用户明确不买证书；SmartScreen 提示为接受项。
- **Linux 版**：目的地只到 Windows。
- **多内核版本管理 / TUI profile**：DHL 历来只管 web profile、固定 runtime；官方 Tauri 版的这些能力不纳入（捆绑单一 Node ≠ 多版本管理）。
- **macOS 版本身的改动**：移植不反噬 macOS 线（除非共享层重构被栈决策明确带出）。
