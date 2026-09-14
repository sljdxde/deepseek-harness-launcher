# Deepseek Harness Launcher 项目介绍

> 用一行原生 Swift 代码，把 DeepSeek Harness 变成 macOS 菜单栏里那个「点开即用、关掉就走」的常驻工具——不套 WebView，不内嵌浏览器，不捆绑 Node 运行时。

## 痛点：在 macOS 上跑 Harness，为什么总感觉「差点意思」

如果你一直在用 [DeepSeek Harness](`@deepseek-ai/dsh`) 做本地 AI Agent 开发，大概率踩过这些坑：

**命令行启动太原始。** 每次都要手敲 `npx @deepseek-ai/dsh web`，自己管进程生命周期。终端一关、窗口一关，Harness 就没了；忘了关呢？后台留一堆孤儿 node/npm 进程，端口还被占着。

**官方桌面版太重。** `deepseek-harness-desktop` 用 Tauri 2 打包，自带 WebView 外壳和完整 Node 运行时。功能全，但对一个「只想在本地跑 Harness」的 macOS 用户来说，体量大、内存高、启动慢——你并不需要它帮你管多版本内核，你的系统上已经有 Node 了。

**没有菜单栏入口。** 想打开 Harness 得翻终端、敲命令、等启动。没有全局快捷键，没有开机自启，没有「就绪后自动开浏览器」。它只是一个命令，不是一个工具。

**归档会话管理弱。** Harness 跑久了，归档列表越来越长。想清理？得去翻 session 目录、手动删文件、改 workspace.json——稍有不慎就索引错乱。

**插件生态分散。** 社区有 `awesome-dsh-plugin` 一堆好插件，但安装全靠手动跑 `dsh plugin install`，装了什么、版本多少、怎么卸载，没有一个统一界面。

**更新两条线各管各的。** `@deepseek-ai/dsh` 发新版你得自己留意 npm；启动器自身有没有更新也得自己去 GitHub 看。没有自动检查，没有一键升级。

**进程生命周期没人管。** 停止 Harness 时直接 kill pid？可能漏杀子进程；重启时旧进程没退干净？端口冲突。SIGTERM / SIGKILL 的级联终止、精确匹配启动器自身路径与 patch 身份——这些事不该由人肉来做。

## 设计核心：做一层「恰到好处」的原生薄壳

Deepseek Harness Launcher（简称 DHL）的定位非常明确：**它是第三种、且是 macOS 专属的轻量方案**——在「命令行裸跑」和「Tauri 桌面版」之间，找到一条最适合 macOS 用户的路。

### 纯原生 Swift / AppKit，零 WebView

整个启动器用 Swift + AppKit 写成，编译为 Universal 2（arm64 + x86_64）。它是 `LSUIElement` 类型的菜单栏应用——不在 Dock 占格，随系统外观（浅色/深色）自动切换，内存占用极低。不套 WebView、不用 Electron、不打包 Tauri，就是一份干净的原生 macOS 代码。

### 只做薄壳，不替代内核

DHL **不携带 Node 运行时，也不管理多个 dsh 内核版本**。它的职责只有一件事：在你已经装好 Node 和 npm 的 macOS 上，把 `@deepseek-ai/dsh` 拉起来、管好、并注入一点增强。Harness 原有的 profile、会话、其他插件——全部仍由 dsh 自己管理，DHL 绝不越界。

### 低内存的可靠安装

首次启动时，DHL 把 `@deepseek-ai/dsh` 安装到 `~/.dsh/runtime`。关键设计：使用 App 内置锁定版本的 `package-lock.json`，走 `npm ci`（而非 `npm install`）做依赖复放。峰值内存仅 0.3～0.6GB（CI 门禁硬限 1GB），默认优先国内镜像、失败自动回退官方源。后续启动直接复用固定 runtime，不再触发 npx 的解析开销。

### 智能端口管理与优雅生命周期

启动前扫描 3080 到 3099 端口：发现正在响应的 Harness 实例就直接复用；否则绑定第一个可用端口。停止或更新时，对 Harness 进程组执行 `SIGTERM → SIGKILL` 级联终止（含超时兜底），并通过精确匹配启动器自身路径与 patch 参数来识别目标进程——不误杀、不残留。

### 通过 Cordis Patch 注入增强，不污染用户配置

DHL 不改写你已有的 Cordis 配置文件。它在启动时通过 `--patch` 注入自己的 `cordis.patch.yml`，以软链接方式把内置插件（归档管理 DSHArchiveManager、插件市场 DSHPluginManager）挂进 dsh 的插件目录。卸载 DHL 时只移除自有资源链接，你的会话、profile、其他插件数据完整保留。

## 解决问题：每个痛点，都有一个对应的解

| 你遇到的麻烦 | DHL 怎么解决 |
|---|---|
| 每次手敲命令启动 | 菜单栏图标常驻，点击「打开」即可；Spotlight / Raycast 搜索 `dsh` 或 `dhl` 秒启 |
| 全局快捷呼出 | 默认 `⌃⌥D`，任意应用中一键呼出浏览器到 Harness 界面；可在设置中自定义录制 |
| 进程残留 / 端口冲突 | 级联 SIGTERM→SIGKILL 终止 + 精确路径匹配；退出时彻底清理 |
| 安装重 / 慢 / 易失败 | 锁定 runtime + `npm ci` 低内存路径 + 镜像回退 + 原子替换；安装窗口实时显示进度 |
| 归档会话难管理 | 内置 **DSHArchiveManager** 面板：列出归档会话、显示工作区与后代数量、支持单条/批量删除（带二次确认） |
| 插件分散难管理 | 内置 **DSHPluginManager** 插件市场：已安装 / 插件市场双页，来自 `awesome-dsh-plugin` 数据，一键安装/卸载 |
| 更新要自己跟进 | 启动器自更新（对接 GitHub Releases，下载 DMG 并自替换）；dsh 版本异步检查，有新版本菜单栏提示 |
| 没有开机自启 | 通过 LaunchAgent（`com.local.dhl-launcher`）实现登录项，设置中一键开关 |
| 不知道运行状态 | 菜单栏实时显示当前端口（未运行则显示「未运行」）；所有日志写入 `~/Library/Logs/Deepseek Harness Launcher/dhl.log` |

## 效果展示

![架构总览](assets/architecture.png)

上图是 DHL 的整体架构：原生菜单栏 App 作为薄壳，拉起 `~/.dsh/runtime` 中的 dsh web profile，注入归档管理与插件市场增强 patch，最终通过系统默认浏览器呈现 Harness 界面。端口 3080–3099 智能复用，无 patch 时基础模式降级运行。

【插入：安装流程演示 GIF】

首次启动 DHL 时，如果检测到 `~/.dsh/runtime` 不存在，会弹出安装窗口。窗口实时读取 npm 输出，显示当前操作阶段（解析/下载/写入/校验）、已下载数量和已等待时长。安装走 `npm ci` 低内存路径，默认优先 npmmirror 镜像，失败自动回退 npmjs。整个过程峰值内存控制在 0.6GB 以内，CI 有 1GB 硬门禁把关。

【插入：启动与运行演示 GIF】

安装完成后，DHL 进入正常运行状态：菜单栏出现图标并实时显示端口号（如「端口：3080」）。点击菜单项「打开 Deepseek Harness」或按下全局快捷键 `⌃⌥D`，系统默认浏览器自动跳转到 Harness Web 界面。已有标签页时聚焦原标签，不重复新开。设置中可配置「就绪后自动打开浏览器」开关。

【插入：日常运行演示 GIF】

日常使用中，DHL 静默驻留在菜单栏。右键/左键点击图标可查看端口状态、打开日志、检查更新、进入设置。设置窗口提供：自动更新开关与频率、浏览器自动打开、开机自启、全局快捷键录制。所有 stdout/stderr 与生命周期事件完整记录到日志文件，排障时一键「打开日志」即可定位问题。

【插入：新功能介绍 GIF】

两大内置增强功能均通过 Cordis patch 注入，不影响 Harness 原有配置：

**归档管理面板（DSHArchiveManager）**：在 Harness Web 界面侧边栏新增入口，展示所有归档会话及其工作区、后代数量。支持单选/全选、单条删除与批量删除，二次确认后永久清除（先移入临时暂存区再原子清理，失败自动回滚）。

**插件市场（DSHPluginManager）**：侧边栏「插件管理」入口，含「已安装」与「插件市场」两个页面。市场数据来自 `awesome-dsh-plugin`，支持分类浏览、搜索、按星级/下载量排序、一键安装。安装/卸载通过 `dsh plugin --profile web` 执行，缺 pnpm 时自动用 corepack 自举。
