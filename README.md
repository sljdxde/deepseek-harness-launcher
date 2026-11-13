# Deepseek Harness Launcher（DHL）

[English](./README.en.md)

**Deepseek Harness Launcher** 是一款轻量级 **原生 macOS / Windows 启动器**（macOS 菜单栏、Windows 托盘），用于本地运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（基于 `@deepseek-ai/dsh` 的 AI agent 平台）。从 Spotlight 或 Raycast 搜索 `Deepseek Harness Launcher`，也可以输入 `dsh` 或 `dhl`，应用会启动 Harness 的 `web` profile，并以**启动器内置的原生窗口**承载 Harness 界面（macOS 为 `NSWindow` + `WKWebView`，Windows 为 Wails WebView 窗口）；菜单栏/托盘图标常驻，服务就绪后默认打开内置窗口。需要时可在设置里改回用系统浏览器打开（回退模式）。

App 图标与菜单栏图标派生自官方 `deepseek-harness-desktop`（MIT 协议），仅做了圆形外框等少量修改 —— 见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

---

## 它和「原始 deepseek-harness」的关系

上游 `@deepseek-ai/dsh` 是 Harness 内核。官方提供两种跑法：

1. **命令行**：手动 `npx @deepseek-ai/dsh web`，自己管进程；
2. **官方桌面版** `deepseek-harness-desktop`：Tauri 2 外壳（Rust 后端 + WebView），跨 Windows/macOS/Linux，自带 Node 运行时与多版本内核管理，并内置完整 Tauri 插件生态。

**本项目是第三种轻量方案**：macOS 上是纯原生 Swift / AppKit（内置 `WKWebView` 窗口承载 Harness），Windows 上是 Go + Wails 的托盘 App，两边功能逐项对等。它不套 Electron/Tauri 的完整外壳，只在需要时拉起你已经装好的 `dsh`，并额外注入归档管理、插件管理与页面存活心跳/会话跳转（`DSHSessionNotify`）等内置插件。它**不替代 Harness 内核**，而是让 Harness 在桌面上更好用。

两个平台的差异只在「系统机制怎么实现」，不在「有没有这个功能」：

| 能力 | macOS | Windows |
|---|---|---|
| 常驻入口 | 菜单栏状态项 + Dock 图标 | 托盘图标 + 可固定到任务栏的 **Harness 主窗口** |
| 点开进界面 | 菜单栏菜单「打开」 / 全局 ⌃⌥D | **单击任务栏图标还原 Harness 主窗口，再点最小化**（Windows 原生处理）；托盘图标单击/右键弹出启动器面板（会话 / 更新 / 设置多 tab） |
| dsh 页面 | 内置 `WKWebView` 窗口（可回退到系统浏览器） | 启动器自带窗口内嵌 dsh 页面（同一套注入插件） |
| 自启动 | `LaunchAgent` | 注册表 `HKCU\...\Run` |
| 自更新 | 下载 DMG、替换 .app | 下载 exe、退出后替换并重启 |
| 完成提醒 | 菜单栏数字角标 + Dock 数字 + 菜单「会话完成」列表（按会话计数，重启不丢）；Harness 侧栏由 DSH 自己展示，启动器不注入红点 | 托盘/任务栏红色未读角标 + 面板「会话」列表 + Windows Toast 通知；同样不注入侧栏红点 |
| Node 运行时 | 用系统已装的 node/npm | **捆绑便携 Node（内嵌于 exe）**（免安装，或回退系统 node） |
| 安装 | DMG 内双击安装器 | **exe 即安装包**：双击自装到 `%LOCALAPPDATA%`，支持控制面板卸载 |

---

## 特性

| # | 增强点 | 说明 |
|---|--------|------|
| 1 | **原生外壳 + 内置 Harness 窗口** | 纯 AppKit/Swift 实现；启动器自己持有一个 `NSWindow + WKWebView` 窗口承载 Harness 界面（默认界面，可在设置里回退到系统浏览器）。`LSUIElement=false`，Dock 图标与菜单栏图标常驻；相比 Tauri/Electron 不捆绑 Node 运行时，体积小、内存低，随系统外观（浅/深色）自动切换。 |
| 2 | **内置归档管理插件（DSHArchiveManager）** | 通过 `--patch` 注入 Cordis patch，在 Harness Web 界面提供「归档管理」面板：列出归档会话、单条/批量删除（带二次确认）、显示工作区与后代数量。 |
| 3 | **智能端口管理（3080–3099）** | 启动前从 3080 扫描到 3099：发现正在响应的 Harness 就复用；否则使用第一个可绑定端口。若复用实例没有归档插件，Harness 仍可使用，日志会记录为基础模式。 |
| 4 | **首次安装可靠，后续启动稳定** | 首次启动前将 `@deepseek-ai/dsh` 完整安装到 `~/.dsh/runtime`，使用 peer-dependency 完整解析、临时目录安装和原子替换；默认优先较快的 npm 镜像，失败后回退官方源。后续直接运行固定 runtime，不使用易留下半安装缓存的 npx。 |
| 5 | **原生应用内自更新** | 直接对接本仓库 GitHub Releases，菜单内「检测启动器（DHL）更新」可显示版本/下载进度并下载 `Deepseek.Harness.Launcher.dmg`（GitHub 自动将空格存为点），随后自替换重启（后台按「检查频率」自动检查，默认每 6 小时）。 |
| 6 | **开机自启动** | 通过 `LaunchAgent`（`com.local.dhl-launcher`）实现登录 macOS 自动拉起，可在设置中开关。 |
| 7 | **优雅的进程生命周期** | 停止 / 更新前对 Harness 进程组做 `SIGTERM → SIGKILL` 级联终止（含超时兜底），并精确匹配 launcher 自身路径与运行该 patch 的 npm/node 进程，避免误杀或残留孤儿进程。 |
| 8 | **原生设置窗口** | 检查频率、自动检测插件更新、用内置窗口显示 Harness（不打开浏览器）、就绪后自动打开 Harness 界面、开机启动、全局快捷呼出；与系统外观一致。 |
| 9 | **实时状态 + 日志** | 菜单栏实时显示当前运行端口；所有 stdout/stderr 与生命周期事件写入 `~/Library/Logs/Deepseek Harness Launcher/dhl.log`，一键「打开日志」。 |
| 10 | **全局快捷呼出** | 任意应用中按 `⌃⌥D`（可在设置中录制更换），直接打开并前置内置 Harness 窗口；dsh 未运行会先启动。默认路径没有浏览器实例、AppleScript 与标签页匹配，不会多开标签/窗口。浏览器回退模式仍保留原有的标签复用与降级逻辑（多浏览器实例的 macOS 寻址限制见「浏览器回退模式」）。 |
| 11 | **后台定时检测更新（dsh + 启动器）** | 后台定时检查 npm 上 `@deepseek-ai/dsh` 与启动器自身的新版本（常开，默认每 6 小时一轮，启动后 8 秒先来一次），不阻塞启动；有新版本时菜单项标题写明，菜单栏图标同时亮一枚蓝色向上箭头角标（不打开菜单也看得见）。 |
| 12 | **内置插件管理（DSHPluginManager）** | 侧边栏新增「插件管理」入口，含「已安装」与「插件市场」两个页面：已安装插件可查看/卸载/**更新到最新版本**，也可**忽略某个版本**（忽略后不再计入可更新数量，远端出更高版本时会重新提醒）；市场数据来自两个来源：社区清单 `awesome-dsh-plugin`，以及 **DeepSeek 官方插件**（直接查 npm 上 `@deepseek-ai` scope 里声明了 `dsh.bundle` 的官方插件，分类里固定排第一；官方不维护第三方清单仓库，也不内置索引源），都支持分类、搜索、按星级/下载排序、一键安装。更新前可在行内点「更新内容」，查看该版本的 GitHub Release 正文或仓库 CHANGELOG 里对应版本的段落；更新成功后只修补检测缓存里那一条，其它插件的更新标记不会一起消失。安装/卸载/更新通过 `dsh plugin --profile web` 执行，缺 pnpm 时自动用 corepack 自举，变更后提示重启 dsh 生效。可更新插件在面板「已安装」列表里逐行标记；侧边栏「插件管理」入口只渲染图标、不显示角标，启动器菜单行也不再显示可更新数量（该数量只写进日志，用于驱动更新进度窗口）。每个插件行都有「停用 / 启用」开关：停用 = 把它在 dsh 装配树里的行写进启动器的 `--patch` 覆盖层（`disabled: true`），重启 dsh 后生效；启用 = 移除这条覆盖。内置插件同样可停用（只是仍不可卸载），但 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和插件管理器自身不允许停用，开关会置灰并说明原因。 |
| 13 | **会话完成统计（菜单栏 / Dock 数字）** | 内置 `DSHSessionNotify` 插件把主会话 `turn/end` 记录在 Harness 侧，启动器轮询事件流维护「未读会话数」：菜单栏图标右下角显示数字胶囊、Dock 图标显示同口径数字、菜单顶部列出最近完成的会话（工作区名 + 时间 + 结果），点一条即跳转到该会话并只清这一条；未读落 UserDefaults，启动器重启/更新后不清零。计数单位是**会话**（同一会话连跑多轮不重复计数），`resumed` / `viewed` / `aborted` 会撤销对应提醒。**不往 Harness 侧栏注入红点**：侧栏的「已完成」状态点仍归 DSH 自己，启动器只做统计与数字提示。 |
| 14 | **启动失败自动恢复（已移除）** | 启动器不再因插件导致 dsh 起不来而自动禁用插件、逐个排除或转入安全模式；dsh 启动失败时只如实报错，不改动 profile 的依赖与 bundle 列表。 |
| 15 | **异常结束状态点（Windows 内置）** | Windows 启动器内置 `dsh-interrupted-dot` 插件：正常收尾（`completed` / 用户停止 / 上限 / 阻塞）保持 DSH 自带绿点；异常结束（`error`、`interrupted`，含进程中途崩溃）把**同一个**状态点染红，不新增第二个点，打开会话或重新开跑即恢复。macOS 启动器暂未随包内置（本机以 local-plugins 方式安装）。 |
**边界与取舍**：

- 支持 macOS 与 Windows；Linux 暂不支持；
- 内置窗口只承载 Harness 页面（本机 loopback 且当前端口）：外链与文档链接交给系统浏览器，它不是带地址栏的通用浏览器；关掉「用内置窗口显示 Harness」可回到完整的浏览器方案（回退模式）；
- macOS 版不捆绑 Node（用系统的）；**Windows 版捆绑便携 Node**，用户无需自己装；
- 不捆绑 Node 运行时，也不管理多个 dsh 内核版本；需要用户系统中已有可用的 `node` 与 `npm`。
- 首次启动会显示安装窗口；依赖下载可能需要几分钟，安装成功后后续启动直接复用 `~/.dsh/runtime`。
- Deepseek Harness Launcher 只添加自己的内置插件链接（归档管理、插件管理、页面存活心跳与会话跳转）与临时 patch；Harness 原有 profile、会话及其他插件仍由 dsh 管理。

---

## 前置条件

- macOS 12 或更高版本。
- 已安装可从终端使用的 Node.js（建议 Node 22 或与当前 dsh 兼容的 LTS）及 npm。Deepseek Harness Launcher 不携带 Node 运行时。
- 网络仅在首次安装/更新 `@deepseek-ai/dsh` 或检查/下载 Deepseek Harness Launcher 更新时需要。

首次启动会先执行安装。App 内置锁定版本的 `dsh-runtime/package-lock.json`，安装走低内存的 `npm ci`（复放已解析的依赖集，避免裸 `npm install` 全量解析导致的约 3GB 内存占用）。实测峰值：冷缓存首装约 190-220MB；npm 缓存已命中时约 1.2-1.3GB（依赖全在本地，npm 一次性 reify 整棵树），对应 V8 上限 1536MB：

```sh
npm ci --prefix ~/.dsh/runtime --no-audit --no-fund --prefer-offline \
  --registry <registry>
```

更新 dsh 不需要重新全量解析：新版本 App 自带更新的锁定文件，启动时若发现已装版本比锁定版本旧，会**先问一次**（「更新运行环境」/「稍后」）。选「稍后」不打断使用：继续用当前版本启动，菜单里常驻一条「更新运行环境到 vX（App 自带）」，随时可点。启动器不会因为「有更新」就自己开始装。

安装完成后实际执行：

```sh
~/.dsh/runtime/node_modules/.bin/dsh web \
  --patch <Deepseek Harness Launcher.app 内的 cordis.patch.yml> --no-open --port <3080-3099>
```

默认按 `registry.npmmirror.com`、`registry.npmjs.org` 顺序尝试；可通过环境变量 `DHL_NPM_REGISTRY` 指定公司/私有 registry。

安装窗口会读取 npm 的实际输出，显示当前 npm 操作（解析、下载、写入、校验）、实际成功下载记录数和真实已等待时长；只有在 npm 提供稳定的依赖总数和完成事件时才显示安装百分比，百分比固定保留两位小数，不显示剩余时间。

如果 npm 在启动器内持续下载失败，失败提示会提供可复制的官方兜底命令：

```sh
npx @deepseek-ai/dsh web
```

命令成功启动后保持终端进程运行，再重新打开 Deepseek Harness Launcher；启动器会复用已经运行的 Harness。若不希望命令自动打开浏览器，可追加 `--no-open`。

### 启动与端口

1. 打开 Deepseek Harness Launcher 后，启动器先检测 3080-3099。
2. 找到能返回 Harness 首页的端口时，直接复用该进程；否则在第一个可绑定端口启动 dsh。
3. Harness 首页可用后，Deepseek Harness Launcher 进入运行状态，并按设置决定是否自动打开 Harness 界面（默认开启）：内置窗口开关开启时打开内置窗口，关掉时打开一次系统默认浏览器（回退模式）。
4. 「退出 Deepseek Harness」会退出启动器（菜单栏、Dock 图标与内置窗口一起结束），并终止 Deepseek Harness Launcher 管理的 Harness 后台进程。关闭窗口不等于退出：dsh 继续在后台运行，点 Dock 图标、⌘O 或菜单「打开 Deepseek Harness」可重新打开窗口。

若所有端口均无法复用或绑定，或 npm/dsh/插件启动失败，Deepseek Harness Launcher 会显示失败提示；首次安装期间可取消，临时目录会自动清理。详细 stdout、stderr 与命令行记录可从「打开日志」查看。

### 启动期不强制装/更新运行环境

启动器把「运行环境能不能用」和「依赖树是否齐全」分开判：`.bin/dsh` 还在就先启动，不把一份还能跑的环境判死、更不会因为它「看起来不完整」就要求重装。启动期的每个安装动作都必须由用户点头：

- **App 自带锁文件更新**：问一次「更新运行环境 / 稍后」。选「稍后」照常启动，并把选择记住，之后不再反复问；菜单里那条「更新运行环境到 vX（App 自带）」仍随时可用。
- **运行环境缺失**（本机用过 dsh，但 `~/.dsh/runtime` 没了）：问一次「重新安装 / 稍后」。选「稍后」不会在每次打开时再弹，菜单里出现「重建 Deepseek Harness 运行环境」可随时重建。
- **替换 runtime 的中途被打断**（旧环境只以 `runtime.previous-*` 快照形式存在）：直接自动换回来再启动，不弹重装框、不联网重装。卸载脚本同样只在正式 runtime 已在位时才清理这类快照，绝不会删掉用户唯一一份运行环境。


## 安装与构建

### 从源码安装

```sh
./scripts/install.sh                                  # 编译 Universal 2 → ~/Applications/Deepseek Harness Launcher.app
DHL_INSTALL_DIR=/Applications ./scripts/install.sh    # 安装到系统 /Applications
```

安装脚本会：先请求旧启动器退出，再对其及 Deepseek Harness Launcher 管理的 Harness 后台执行 `SIGTERM`，超时后 `SIGKILL`；确认结束后保留带时间戳的 App 备份、用 `ditto` 替换 `Deepseek Harness Launcher.app`，最后自动重新打开。重装成功后会自动清理此前的 App 备份、注销旧的 DMG payload 注册并移除新 App 的 quarantine 标记。设置 `DHL_NO_OPEN=1` 可跳过安装后自动启动。若无法确认相关进程已经退出，安装会取消，不会覆盖正在运行的 App。

> 当前机器仅有 Command Line Tools；Universal 2 可交叉编译，但签名 / notarization 需要完整 Xcode 与 Developer ID 环境。

### 构建产物

```sh
./scripts/build-app.sh            # arm64 开发构建 → build/Deepseek Harness Launcher.app
./scripts/build-universal.sh      # Universal 2（arm64 + x86_64）
./scripts/build-dmg.sh            # dist/Deepseek Harness Launcher.dmg（含「双击完成安装或更新」安装助手）
./scripts/test.sh                # 完整回归测试（含 DMG 打包与校验）
```

完整回归用例与发布门禁说明见 [TESTING.md](TESTING.md)。GitHub Actions 会在每次提交时自动运行，测试不通过不会创建或更新 Release。

DMG 打开后只显示一个 **「双击完成安装或更新」** App。安装器自身已内嵌完整的 Deepseek Harness Launcher.app，即使用户把安装器单独复制到其他目录也能完成安装；DMG 内仍保留隐藏载荷以兼容旧版安装/更新流程。双击后会停止旧进程、替换应用并重新启动：已安装在 `/Applications`（支持迁移旧版 `DHL.app` 或 `DSH.app`）时优先更新到 `/Applications/Deepseek Harness Launcher.app`；否则安装到 `~/Applications/Deepseek Harness Launcher.app`。没有写入 `/Applications` 权限时会请求管理员授权。

默认构建产物使用 ad-hoc 签名，本机可直接运行；但直接下载安装仍可能被 Gatekeeper 拦截（提示“应用已损坏”），可先执行 `xattr -dr com.apple.quarantine "/Applications/Deepseek Harness Launcher.app"` 后重试。正式分发需通过 `scripts/sign-and-notarize.sh` 完成 Developer ID 签名与公证，所需凭据通过环境变量提供，不能写入仓库。

### 菜单栏操作

| 菜单项 | 快捷键 | 作用 |
|--------|--------|------|
| 打开 Deepseek Harness | ⌘O | 打开/前置内置 Harness 窗口；未运行时自动启动。浏览器回退模式下复用或新开 Harness 标签页 |
| 全局呼出 Deepseek Harness | ⌃⌥D | 任意应用中呼出/前置内置 Harness 窗口，可在设置中录制更换 |
| 端口：xxxx | — | 实时显示当前运行端口（未运行则显示「未运行」） |
| 检测启动器（DHL）更新 | — | 手动检查 GitHub Releases，更新说明按 Markdown 渲染展示；后台也会按「检查频率」自动检查（默认 6 小时），有新版时菜单栏图标亮蓝色箭头角标 |
| 设置… | ⌘, | 检查频率、自动检测插件更新、内置窗口开关、就绪后自动打开 Harness 界面、开机启动、快捷呼出 |
| 打开日志 | ⌘L | 打开 `~/Library/Logs/Deepseek Harness Launcher/dhl.log` |
| 退出 Deepseek Harness | ⌘Q | 退出并终止 Harness 后台进程 |

### 主菜单与窗口

启动器现在是常规 App（`LSUIElement=false`），Dock 图标常驻，并有一份完整主菜单：

| 菜单 | 菜单项与快捷键 |
|------|----------------|
| 应用 | 关于 Deepseek Harness Launcher、设置… ⌘,、退出 Deepseek Harness ⌘Q |
| 编辑 | 撤销 ⌘Z、重做 ⇧⌘Z、剪切 ⌘X、复制 ⌘C、粘贴 ⌘V、删除、全选 ⌘A（WKWebView 输入框里的复制粘贴依赖它） |
| 显示 | 重新载入 Harness 页面 ⌘R、打开日志 ⌘L |
| 窗口 | 最小化 ⌘M、关闭 ⌘W、打开 Harness 窗口 ⌘O |

- 主菜单的 ⌘R 只重载内置窗口的页面，不重启 dsh；它与菜单栏菜单里的「重启 Deepseek Harness」⌘R 不冲突——菜单栏快捷键只在菜单展开时生效。
- 关闭窗口（⌘W 或红色关闭按钮）不退出：dsh 继续在后台跑，菜单栏图标与端口状态照常工作；点 Dock 图标、⌘O 或菜单「打开 Deepseek Harness」会把窗口重新拿到前面。
- 退出仍用 ⌘Q 或菜单「退出 Deepseek Harness」，会同时结束内置窗口与后台 dsh。
- 重启 dsh 后内置窗口会用新进程的 token 入口自动重载（旧 token 已失效，不重载会停在 401 页）；菜单栏仍显示「已重启 ✓」。
- 窗口标题「Deepseek Harness」，默认 1280×860、最小 960×600，并记住上次位置大小；WebKit 内容进程崩溃时会自动重载页面。
- 窗口内：外链（非 `127.0.0.1`/`localhost`/`::1` 且非当前端口）交给系统浏览器；`<input type=file>` 用原生文件选择面板（附件上传可用）；下载落到 `~/Downloads`（重名自动加序号，不覆盖）；页面里的 alert/confirm/prompt 用原生弹窗。

### 设置与更新

- 设置项：检查频率、自动检测插件更新、用内置窗口显示 Harness（不打开浏览器）、就绪后自动打开 Harness 界面、登录 macOS 时自动启动 Deepseek Harness Launcher、全局快捷呼出快捷键。
- 默认值：**后台检查常开**、每 6 小时一轮、启动后约 8 秒做首次后台检查；自动检测插件更新开启；**内置窗口开启**；就绪后自动打开 Harness 界面开启；开机启动关闭；全局快捷键启用，默认 `⌃⌥D`。检查间隔最小为 1 小时。
- 关掉「用内置窗口显示 Harness（不打开浏览器）」= 回到旧的浏览器方案（回退模式）：旧代码与行为完整保留，用于内置窗口不可用、需要浏览器扩展等场景。细节见下文「浏览器回退模式」。
- 后台检查常开、只提示、从不静默安装：启动器自更新与 dsh 更新都不需要「要不要自动检查」的开关（历史上那个开关一关，启动器自检就只剩手动点击，用户会以为根本没有后台定时任务）。发现新版本时，菜单栏图标右上角亮一枚**蓝色向上箭头角标**，鼠标悬停能看到是「启动器可更新 vX」还是「Deepseek Harness 可更新 vX」；点击菜单里的对应条目才进入更新流程。
- **两条链路都能「忽略」（跳过此版本）**：启动器自更新与 dsh 更新的弹窗第三个按钮都是「跳过此版本 / 取消跳过此版本」。跳过之后那一版**不再进菜单标题、也不亮角标**，菜单行回到普通的「检测启动器（DHL）更新」/「检查 Deepseek Harness 更新」，不会一直占着最显眼的位置；记录在偏好里跨重启保留，远端出了更高的版本会重新提示。想装回来随时点菜单那两行：弹窗照旧打开，按钮变成「取消跳过此版本」。真正装上之后跳过记录自动清空。
- 更新源固定为本仓库 GitHub Releases（`sljdxde/deepseek-harness-launcher`），用户无需填写地址。当前 App 版本为 `0.4.1`，仅当 Release 版本号更高时提示；Release 正文（Markdown）会在更新弹窗中渲染为带标题、列表与行内样式的更新说明。
- 启动器自身更新和 `@deepseek-ai/dsh` 更新是两条独立链路；dsh 检查同时读 **npm 的 dist-tags**（`latest` / `next` / `beta` / `alpha`）与 **GitHub Release**（`deepseek-ai/deepseek-harness` 的 `releases.atom`；匿名 API 常被 `403` 限流，feed 更稳），取两者中最新、且确实已发布到 npm 的版本，只提示，不修改 npm 缓存。菜单标题与弹窗都会标出通道（正式版 / 候选版 / 公测版 / 内测版）——npm 的 `latest` 常常落后于刚发的 Release，只看它就会漏掉新版本。
- dsh 是否更新完全由用户决定：弹窗提供「更新到 vX / 稍后 / 跳过此版本」，预发布版本默认按钮是「稍后」（回车不会顺手装上内测版），弹窗里显示来源（GitHub Release / npm 某标签）、发布日期与 Release 正文（Markdown 渲染）。**找到多个比当前新的版本时，弹窗给出「更新到：[版本下拉]」**：一次列全（最新的在最上、最多 10 条、默认选最新一版），切换版本会同步刷新该版本的来源、日期与说明，按钮也跟着变成「更新到 vX」；只有一个候选时退化为原先的单版本提示。「跳过此版本」跳过的是当前下拉里选中的那一版，并会被记住：那一版不再进菜单标题、也不亮角标（菜单行回到普通标题），手动点菜单仍会弹窗（里面可「取消跳过此版本」）。自动检查只改菜单标题与菜单栏角标，**从不静默安装**。
- dsh 的 Release tag 形如 `dsh-v0.1.7-alpha.1`，与 npm 版本 `0.1.7-alpha.1` 视为同一版本；同版本优先采用 GitHub Release（带发布日期与更新说明）。只有出现在 npm 版本列表里的候选才会被推荐——镜像滞后时 GitHub 刚发的 tag 还没上 npm，直接安装会 `ETARGET` 失败，这类候选会被忽略并写进日志。
- 提示框外观统一走 `AlertDesign`：语气图标（SF Symbol，加色）、标题 + 一句话正文 + 圆角信息卡（版本对比 `v旧 → v新` + 通道胶囊 / 来源与日期 / Release 说明），细节不再堆进正文；卡片下的次要说明用三级色小字。
- dsh 的版本比较按 npm 语义（semver）：同 base 下预发布低于正式版，`alpha.1 < alpha.2`、`rc.2 < rc.3` 都能区分（启动器自身 `x.y.z-a.b[-SNAPSHOT]` 用的 `compareVersions` 不区分后者，所以 dsh 用独立的 `compareDSHVersions`）。
- GitHub API 返回 `403`（通常是未认证限流）时，启动器会回退读取 Releases Atom feed 来比较版本；没有已发布 Release 时，手动检查会显示「暂无可用更新」。
- 启动器自更新的弹窗与 dsh 那套同口径：「下载更新 / 稍后 / 跳过此版本」；跳过的版本不再进菜单标题、不亮角标，手动点菜单还能弹回来取消跳过（见上一条）。
- 可用更新必须携带名为 `Deepseek.Harness.Launcher.dmg` 的 Release asset（GitHub 不接受空格，会把文件名里的空格改为点）。下载期间显示可最小化/关闭的进度窗口，关闭窗口不取消下载；下载保存到 `~/Downloads/Deepseek Harness Launcher-<version>.dmg`，随后由用户确认「安装并重启」；此操作会先终止后台、替换当前 App、再重新启动 Deepseek Harness。

### 浏览器回退模式（回退用）

把设置里的「用内置窗口显示 Harness（不打开浏览器）」关掉，就回到旧的浏览器方案。旧代码与行为完整保留，只在需要回退时使用（例如内置窗口无法使用、需要浏览器扩展，或者你就是习惯在浏览器里用 Harness）。

- Harness 界面在系统默认浏览器中打开；「打开 Deepseek Harness」与全局呼出都走浏览器路径。
- 已有 Harness 标签会被复用/前置，标签匹配按 origin（`scheme://host:port`）进行；首次使用 macOS 会询问是否允许启动器控制 Chrome/Safari。
- 同一浏览器跑着多个实例（`agent-browser`、`chrome-devtools-mcp` 这类自动化浏览器常驻）时，macOS 只把 AppleScript 发给「最近启动」的实例。真正连着 Harness 的实例不是被寻址的那个时，启动器不会去动另一个实例的标签页：Harness 页就在眼前时只前置浏览器；用户切到了别的标签时，按 pid 定向在真正连接的实例里新开一个标签并切到目标会话，日志会提示「退出那个后台/自动化浏览器实例后即可恢复在原标签里直接切换」。这是平台限制，不是启动器能根治的（详见 [`docs/fix-session-jump-tab-focus.md`](docs/fix-session-jump-tab-focus.md)）。
- 浏览器回退模式下仍保留「命令领取的焦点优先」等防抢逻辑，以及各类降级路径。

### 插件版本检测与更新

- **检测口径（按来源分派）**：npm 包走 registry 的 `dist-tags`（只跟 `latest` 比，不把 rc/beta/alpha 推给装正式版的用户）；`github:` 依赖与 `plugin-sources` 里的克隆走 `git ls-remote` + 远端 `package.json`，**以"远端版本号变高"为判定**，只有 commit 变了而版本号没变时附注「远端有新提交」；`version` 相同时判定为已是最新。
- **跨大版本**会照常提示，但标注为「跨大版本 vX」，更新按钮直接安装最新版（无视 profile 里记录的版本范围）。
- **不再做插件兼容性检测**：启动、更新、安装三条路径都不再比对 `peerDependencies` 与 dsh 运行时版本，也不再联网探测目标版本的 peer 声明。插件市场的 `latest` 常面向比本机更新的 dsh，旧门禁会把用户卡在一个升不动的旧版本上（例如 v0.30.0 要求 `^0.2.2-rc.1` 而本机是 0.2.1-rc.2），还多一次 `pnpm view` 往返；启动时的静态扫描则要请求 `/installed` 并遍历 `node_modules` 逐个读 `package.json`。装不完整的版本仍由安装验收（`installedImportGaps`）撤销；能装上但加载失败时，启动器只如实报错，不再自动隔离或禁用插件。
- **忽略某个版本**：行内「忽略」与工具栏「忽略选中」把不想看到的更新收起来。忽略只针对**那一个版本**（记录在 profile 的 `.plugin-updates-ignored.json`，`name` + 版本精确匹配），远端出了更高的版本会重新提醒，所以忽略不会把插件永远钉在旧版本上；被忽略的条目不再计入可更新数量与「全部更新」，行内仍保留「更新」与「取消忽略」（想装随时能装回来）。检测缓存 `.plugin-updates.json` 里存的始终是原始检测结论，忽略是读时叠加的，因此取消忽略立刻恢复显示、不需要重新联网。
- **区间语义只保留在插件侧**：npm 语义（`rc.1 < rc.6`、`^0.0.3` 上界是 `0.0.4`、支持 `0.1.x`/`>= 0.1.0`/`||`）由插件管理器的 JS 实现（`satisfiesPluginRange`）与表驱动用例锁住。启动器侧曾有一份同规则的 Swift 实现，但兼容性扫描整体下线后主流程 0 调用，已连同单测一起删除，避免同一套语义维护两遍。
- **远端 `package.json` 的读取顺序**：先 `raw.githubusercontent.com`（不需要 token，常规路径不碰 API）；失败（超时/断流/404）时改用 `api.github.com/repos/.../contents` 取同一路径并 base64 还原。国内网络对 raw 限速严重（实测一次 GET 要 14～60 秒、且会中途断流），只走 raw 会让 `github:` 来源的插件**永远显示「失败」**、点更新还会被回一句「没有检测到可更新的版本」. 超时的文案也换成人能看懂的「拉取远端 package.json 超时（N 秒）」。
- **来源识别**：克隆到 `plugin-sources` 时写入 `.dsh-source.json`（作者 / 仓库 / 子目录 / commit）。此前装的旧克隆没有这个标记，检测时会按 `package.json` 的 `repository.url` + `repository.directory` → 市场索引 → 目录名候选的顺序逐个 `git ls-remote` 确认，命中后把标记写回目录（所以"大仓库子目录"型插件也能正确检测）。都确认不了（本地插件或私有仓库）才标记为「未识别到可检测的远端来源」。
- **更新动作**：npm → `pnpm add <name>@<latest>`；`github:` → 按原 spec 重新解析；`plugin-sources` 克隆 → 先把旧目录改名成 `.bak-<时间戳>` 再重新 clone 覆盖，失败自动回滚（只保留最近一个备份）。服务端插件代码要**重启 dsh** 才生效。
- **后台自动检测**：默认开启（设置窗口「自动检测插件更新」可关）。开启时启动器在服务就绪后约 15 秒触发一次刷新，之后跟随「检查频率」（默认每 6 小时）；结果缓存在 profile 下的 `.plugin-updates.json`，默认 6 小时内不重复联网。关闭只影响后台检测，面板里的「检查更新」仍可用。
- **呈现**：插件管理面板「已安装」列表每行显示当前版本与「可更新到 vX」（可单条更新／忽略，也可「全部更新」「忽略选中」），并有「上次检测」时间；可更新数量只写进启动器日志（用于驱动更新进度窗口）：侧边栏「插件管理」入口只渲染图标，启动器菜单行也不再显示它，已忽略的条目不计入统计。旧的外部 Harness 实例没有这些接口时静默降级。

### 插件兼容性检测（已移除）

启动器**不再**做插件兼容性检测：启动时不扫描、更新插件时不比对 peer、安装时不判版本要求。这类判定既拖慢就绪与更新（要联网 `pnpm view`、请求 `/installed`、遍历 `node_modules`），又经常因为「插件市场的 `latest` 面向比本机更新的 dsh」而把用户卡在一个升不动的旧版本上，只会弹出用户无法自行处置的告警。

- 插件真把 dsh 弄崩时，启动器只如实报错，不再自动禁用、隔离或回退任何插件（见下节）。
- npm 区间语义的纯函数与单测只保留在 `Plugins/DSHPluginManager/lib/index.js` 和 `plugin-peer-compat.test.js`；启动器主流程不做兼容性判定，也不再维护第二份 Swift 实现。
- dsh 官方插件市场自身按 `engines.dsh` 筛选可用版本，那是 dsh 运行时的行为，不在本启动器仓库内。

### 启动失败自动恢复（已移除）

启动器**不再**替用户决定哪个插件该被禁用。以下机制已整体移除：启动前静态预检（扫相对 import 并预隔离）、启动失败后的 stderr 归因与逐个排除（bisect）、隔离 overlay（`--patch` + `disabled: true`）、安全模式（`--profile rescue`）、dsh 更新失败的一键回退弹窗，以及菜单里的「已隔离 N 个插件」恢复入口。

- dsh 若在启动过程中退出，启动器只如实记日志并报错，不再自动重启或禁用任何插件。
- 常规启动参数不再带**自动隔离** overlay；面板里用户主动停用的插件仍会通过独立的 `disabled` overlay 生效（见「内置插件管理」）。
- 这整套自动恢复机制的实现与单测已删除，不再维护第二套语义；`Sources/PluginIsolationSupport.swift` 只保留「用户停用」状态读取、overlay 渲染与启动参数拼接，这些是主流程仍在调用的。

### Windows：安装、卸载与构建

安装（exe 即安装包，全程用户级、无需管理员权限）：

1. 从 GitHub Release 下载 `DHL-windows-amd64.exe`（已内嵌便携 Node，无需自装 Node.js）；
2. 双击运行：启动器自动安装到 `%LOCALAPPDATA%\Programs\DHL`（复制 exe + 解出捆绑 Node），写入开始菜单快捷方式与「安装的应用」卸载项，然后自动启动；
3. 之后双击新版安装包即可升级（版本相同则直接启动已装副本）。首次运行 SmartScreen 可能提示未知发布者，选择「更多信息 → 仍要运行」。

不想触发自安装时：以 `DHL_NO_INSTALL=1` 环境变量运行，或在 exe 旁放置 `.portable` 标记文件/`data` 目录（便携模式）；构建目录里直接运行 exe 属于开发模式，同样不会自装。

卸载（保留 `~/.dsh` 全部数据与运行环境），任选其一：

- 启动器「设置」→「关于」→「卸载启动器」；
- Windows「设置 → 应用 → 安装的应用」中卸载 Deepseek Harness Launcher；
- 命令行 `DHL.exe --uninstall`。

卸载会停止 dsh，删除 `%LOCALAPPDATA%\Programs\DHL`（含历史备份）、`%LOCALAPPDATA%\DHL`（日志与内置插件副本）、开始菜单/桌面/任务栏固定快捷方式、自启动注册表项与卸载项，并清理 profile 中指向内置插件的链接；**保留其他 `~/.dsh` 数据**（会话、凭据、runtime 与用户自装插件）。

从源码构建（Go 1.26+）：

```powershell
cd windows
powershell -ExecutionPolicy Bypass -File fetch-node.ps1   # 下载便携 Node 并保留 zip（exe 内嵌用）
powershell -ExecutionPolicy Bypass -File build.ps1         # build\DHL.exe（自包含安装包）
go test ./...                                              # 单元测试
```

### 卸载

```sh
./scripts/uninstall.sh
```

卸载脚本会移除当前/旧版 `Deepseek Harness Launcher.app`、`DHL.app` 与 `DSH.app`，停止 DHL 管理的 Harness，清理历史 App 备份与 `~/.dsh/runtime.installing-*`／`runtime.broken-*` 之类的中断残留，卸载并注销旧 DMG 卷与 payload 注册，并删除指向 Deepseek Harness Launcher 自有资源的归档插件链接；**保留其他 `~/.dsh` 数据**（会话、归档、profile 与其他插件数据）。`~/.dsh/runtime.previous-*` 是「替换 runtime 中途被打断」留下的完整环境快照：正式 runtime 缺失时会先把它换回 `~/.dsh/runtime`，只有在正式 runtime 已在位时才当残留清理——绝不会删掉用户唯一一份运行环境。

---

## 归档管理插件（DSHArchiveManager）

- 位置：`Plugins/DSHArchiveManager/`，含 `cordis.patch.yml`、`lib/index.js`（服务端）、`client/client.js`（注入到 Harness Web 界面的 React 面板）。
- 注入方式：启动时在 `~/.dsh/profiles/web/node_modules/dsh-archive-manager` 创建指向 App 内资源的软链接，并以 `--patch <资源目录>/cordis.patch.yml` 传给 dsh；不会改写用户已有的 Cordis patch 文件。
- 归档面板展示 `archivedSessionIds` 中仍可找到的会话，并显示工作区与后代数量。服务端接口还会返回会话创建时间与工作目录，供后续界面使用。
- 支持单选、全选、单条删除与批量删除。用户在二次确认中点击「确认删除」后，立即永久删除所选会话及整个后代树；不要求输入 `DELETE`，也不校验会话是否仍在运行或是否已归档。
- 删除时先将会话目录移入 `~/.dsh/sessions` 下的临时暂存区，更新 `workspace.json` 中的工作区会话列表与 `archivedSessionIds`，再清理暂存区；索引更新失败会回滚已移动的目录。不会删除工作区目录本身。
- 启动器会在 Harness 就绪后探测插件路由。探测不到时核心 Harness 保持可用，日志会记录「归档增强插件不可用，Deepseek Harness Launcher 将以基础模式运行」。

### 升级兼容性

早期 DSH/DHL 安装可能在 `~/.dsh/profiles/web/node_modules/dsh-archive-manager` 留下一个指向旧 `DSH.app` 的失效软链接。Deepseek Harness Launcher 会自动替换指向自身 `DSHArchiveManager` 资源的旧链接，避免 `ERR_MODULE_NOT_FOUND`。若同名条目不是 Deepseek Harness Launcher 自己的链接或目录，Deepseek Harness Launcher 不会覆盖它，以免破坏第三方插件。此外，早期版本内置的 `DSHMoreMenu` / `DSHUiEnhance` / `DSHLauncherSettings` / `DSHSidebarDeck` 已整体下线，启动时会自动回收仍指向 App 包内旧资源的同名悬空软链；用户自己安装的同名插件不会被删除。

---

## 内置通知插件（DSHSessionNotify）现在提供什么

会话完成统计仍由启动器维护（菜单栏数字角标、Dock 数字、菜单「会话完成」列表）：启动器轮询插件的完成事件流，但**不往 Harness 侧栏注入红点**——侧栏的「已完成」状态点仍归 DSH 自己。插件随启动器打包，提供三项能力：

- **页面存活心跳**：注入客户端每 750ms 回报自己的 clientId、可见性与当前会话（`GET /dsh-session-notify/commands?...&viewing=…&visible=…`），`GET /dsh-session-notify/presence` 汇总成「现在有没有 Harness 页面连着、是否可见」。浏览器回退模式靠它决定复用已有标签还是新开一个——Chrome 的 keep-alive 连接在多标签全关后仍然 ESTABLISHED，只看 socket 会误判。
- **完成事件流**：`GET /dsh-session-notify/events?after=<seq>` 返回 `completion` / `resumed` / `viewed` 增量，启动器据此维护未读会话数（菜单栏角标、Dock 数字、菜单列表）。
- **会话跳转命令通道（插件侧）**：`POST /dsh-session-notify/open` 入队，页面轮询领取（`/dsh-session-notify/commands`，焦点优先、可见优先、带 TTL）。macOS 启动器点「会话完成」列表、Windows 点面板里的会话行时都会投递这个命令（内置窗口带 `requireEmbedded`），不能从共享插件里删。

侧栏红点这个能力已经从插件里整体删除：两个平台都只把完成状态折算成数字（菜单栏 / Dock / 托盘 / 任务栏）和完成列表，Harness 侧栏的「已完成」状态点归 DSH 自己。

## 图标

- **App 图标**：圆形白底 + 黑色 creature，派生自 `deepseek-harness-desktop` 图标（仅改外框为圆形区分）。资产在 `Resources/icons/candidate-upstream/`（`DHL.iconset/` 含 16/32/128/256/512 + @2x 共 10 尺寸，`DHL.icns` 为烘焙产物）。
- **菜单栏图标**：`Resources/menubar-creature.png`（上游 `macos-tray.svg` 渲染图），作为 template 接入 —— 深色菜单栏自动显示为白色、浅色显示为黑色。
- 构建脚本经 `scripts/install-icon.sh` 把 `DHL.icns` 与 `menubar-creature.png` 打包进 App bundle。
- 版权与署名见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

---

## 架构概览

```text
┌────────────────────────────────────────────────┐
│ Deepseek Harness Launcher（常规 macOS App）    │
│   菜单栏图标 · Dock 图标 · 主菜单 · 设置窗口   │
│   ├─ 内置 Harness 窗口（NSWindow + WKWebView） │
│   └─ 自更新 · 登录项 · 更新角标                │
└───────────────┬────────────────────────────────┘
                │ 启动：~/.dsh/runtime/node_modules/.bin/dsh
                │        web --patch <cordis.patch.yml>
                │        --no-open --port 3080..3099
                ▼
┌────────────────────────────────────────────────┐
│ dsh web profile（localhost，后台常驻）         │
│   ├─ Harness 界面  http://127.0.0.1:<port>/    │
│   └─ 归档管理插件  /dsh-archive-manager/*      │
└────────────────────────────────────────────────┘
                │ WebSocket / HTTP（只走 loopback）
                ▼
  内置 Harness 窗口直接加载 Harness 页面
  （设置里关掉内置窗口 = 浏览器回退模式：
    改由系统默认浏览器打开）
```

数据目录：`~/.dsh`（profile、会话、归档等由 dsh 自身管理）。

## 日志与排障

- 日志文件：`~/Library/Logs/Deepseek Harness Launcher/dhl.log`。菜单栏中的「打开日志」会直接打开它。
- 日志时间使用本机时区，格式为 `yyyy-MM-dd HH:mm:ss Z`；已有的历史 UTC 日志不会被重写。
- 遇到启动失败，优先检查日志中的「启动命令」以及紧随其后的 npm/dsh stderr。常见原因是 Node/npm 不在可发现路径、registry 网络失败、端口已被非 Harness 程序占用，或归档插件链接指向了已删除的旧 App。
- 内置窗口显示「Harness 页面要求认证」：当前 dsh 是外部启动的（或刚重启过），启动器没有它的 token 入口。点菜单栏「打开 Deepseek Harness」可重试；外部实例请在设置里改回浏览器打开，或用「重启 Deepseek Harness」让启动器接管。
- 启动器不再自动隔离插件、也没有隔离状态文件；若怀疑某个插件导致启动失败，按日志里的启动命令与 stderr 定位，到 Harness 侧边栏「插件管理」里自行卸载或降级该插件。

---

## 开发与测试

- 要求：macOS 12+，Xcode Command Line Tools（`swiftc`）。Universal 2 交叉编译只需 CLT。
- `./scripts/test.sh` 仍是全量回归：插件语法与归档删除测试、启动器辅助逻辑测试、更新检查测试、安装替换测试，并构建与检查两个 Universal 2 App。
- `./scripts/test.sh --fast` 跳过打包（universal 构建、安装器、DMG），只跑断言，用于迭代。
- `./scripts/test-one.sh <suite>` 只跑一条 Swift 测试，suite 名即 `scripts/test-<suite>.swift` 的中段（如 `update-support`、`status-badge`）。
- `scripts/test-harness-window.swift` 锁住内置窗口的决策层：打开/重载/只前置、外链外开、下载不覆盖、401 兜底页与主菜单快捷键；`./scripts/test-one.sh harness-window` 只跑这一条。完整回归见 `./scripts/test.sh`。

```sh
./scripts/test.sh
```

---

## 许可证

- 主仓库：MIT —— 见 [LICENSE](./LICENSE)。
- 图标资产改编自 `deepseek-harness-desktop`（MIT, © 2026 contributors），署名与修改说明见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

> ⚠️ `dsh` 具备本地代码执行能力，仅供学习 / 研究 / 测试，请在可信、隔离的环境中使用。
