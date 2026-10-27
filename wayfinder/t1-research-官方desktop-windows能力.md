Label: wayfinder:research

## Question

官方 `deepseek-harness-desktop`（Tauri 2，Rust + WebView）在 **Windows** 上已经提供了哪些 DHL 赖以立身的便利/增强？逐项盘清，判断"移植 Windows 版"里哪些是**免费已有**、哪些才是 **DHL 独有的增量**。

需查清的事实：
- Windows 上它是否自带：托盘/菜单栏等价物、开机自启、应用内自更新（更什么、更到哪）、全局快捷键、拉起 dsh 后就开浏览器、端口管理、Node 运行时捆绑、多内核版本管理。
- 插件生态：能否加载第三方 dsh 插件、是否支持/暴露 `--patch`（Cordis patch）注入机制，还是只走它自己的 Tauri 插件体系。
- 安装形态（MSI/exe/便携）、是否签名、仓库地址与 license（能否在其基础上加东西再发布）。

产出：一张"官方 desktop 版 vs DHL"能力对照表，标出【重叠项 / 官方有而 DHL 无 / DHL 有而官方无】。这是决定技术栈路线的事实底座。

## Blocked by

_（无）_
