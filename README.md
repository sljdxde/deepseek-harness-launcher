# Deepseek Harness Launcher（DHL）

[English](./README.en.md)

**Deepseek Harness Launcher** 是一款轻量级 **原生 macOS 菜单栏启动器**，用于本地运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（基于 `@deepseek-ai/dsh` 的 AI agent 平台）。从 Spotlight 或 Raycast 搜索 `Deepseek Harness Launcher`，也可以输入 `dsh` 或 `dhl`，应用会启动 Harness 的 `web` profile、常驻菜单栏，并在服务就绪后打开系统默认浏览器；它不内嵌浏览器，也不提供独立的桌面聊天界面。

App 图标与菜单栏图标派生自官方 `deepseek-harness-desktop`（MIT 协议），仅做了圆形外框等少量修改 —— 见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

---

## 它和「原始 deepseek-harness」的关系

上游 `@deepseek-ai/dsh` 是 Harness 内核。官方提供两种跑法：

1. **命令行**：手动 `npx @deepseek-ai/dsh --profile web`，自己管进程；
2. **官方桌面版** `deepseek-harness-desktop`：Tauri 2 外壳（Rust 后端 + WebView），跨 Windows/macOS/Linux，自带 Node 运行时与多版本内核管理，并内置完整 Tauri 插件生态。

**本项目是第三种、且是 macOS 专属的轻量方案**：一个纯原生 Swift / AppKit 菜单栏 App，不套任何 WebView/Electron/Tauri 外壳，只在需要时拉起你已经装好的 `dsh`，并额外注入一个归档管理增强插件。它**不替代 Harness 内核**，而是让 Harness 在 macOS 上更好用。

---

## 特性

| # | 增强点 | 说明 |
|---|--------|------|
| 1 | **原生菜单栏外壳，零 WebView** | 纯 AppKit/Swift 实现（`LSUIElement` 菜单栏 App，不在 Dock 占格）。相比 Tauri/Electron，体积小、内存低、随系统外观（浅/深色）自动切换。 |
| 2 | **内置归档管理插件（DSHArchiveManager）** | 通过 `--patch` 注入 Cordis patch，在 Harness Web 界面提供「归档管理」面板：列出归档会话、单条/批量删除（带二次确认）、显示工作区与后代数量。 |
| 3 | **智能端口管理（3080–3099）** | 启动前从 3080 扫描到 3099：发现正在响应的 Harness 就复用；否则使用第一个可绑定端口。若复用实例没有归档插件，Harness 仍可使用，日志会记录为基础模式。 |
| 4 | **复用本机 Node，并可自动获取 dsh** | 用 `npx --prefer-offline --yes @deepseek-ai/dsh` 启动：优先使用 npm 缓存，缓存缺失时允许 npx 下载 `@deepseek-ai/dsh`。不捆绑 Node 或 dsh 内核；会查找 `~/opt/node`、`~/.volta`、`~/.nvm`、`/opt/homebrew/bin`、`/usr/local/bin`。 |
| 5 | **原生应用内自更新** | 直接对接本仓库 GitHub Releases，菜单内「检查更新」可下载 `Deepseek Harness Launcher.dmg` 并自替换重启（支持自动定时检查 + 频率设置）。 |
| 6 | **开机自启动** | 通过 `LaunchAgent`（`com.local.dhl-launcher`）实现登录 macOS 自动拉起，可在设置中开关。 |
| 7 | **优雅的进程生命周期** | 停止 / 更新前对 Harness 进程组做 `SIGTERM → SIGKILL` 级联终止（含超时兜底），并精确匹配 launcher 自身路径与运行该 patch 的 npm/node 进程，避免误杀或残留孤儿进程。 |
| 8 | **原生设置窗口** | 自动更新开关与频率、就绪后是否自动开浏览器、开机启动；与系统外观一致。 |
| 9 | **实时状态 + 日志** | 菜单栏实时显示当前运行端口；所有 stdout/stderr 与生命周期事件写入 `~/Library/Logs/Deepseek Harness Launcher/dhl.log`，一键「打开日志」。 |

**边界与取舍**：

- 仅支持 macOS（无 Windows / Linux）；
- 不捆绑 Node 运行时，也不管理多个 dsh 内核版本；需要用户系统中已有可用的 `node` 与 `npx`。
- 缓存不存在时，首次启动可能需要下载 dsh，因此会比后续启动慢。
- Deepseek Harness Launcher 只添加自己的归档插件链接与临时 patch；Harness 原有 profile、会话及其他插件仍由 dsh 管理。

---

## 前置条件

- macOS 12 或更高版本。
- 已安装可从终端使用的 Node.js（建议 Node 22 或与当前 dsh 兼容的 LTS）及 npm/npx。Deepseek Harness Launcher 不携带运行时。
- 网络仅在 npm 缓存中缺少 `@deepseek-ai/dsh` 或检查/下载 Deepseek Harness Launcher 更新时需要。

启动实际执行的命令为：

```sh
npx --prefer-offline --yes @deepseek-ai/dsh --profile web \
  --patch <Deepseek Harness Launcher.app 内的 cordis.patch.yml> --no-open --port <3080-3099>
```

### 启动与端口

1. 打开 Deepseek Harness Launcher 后，启动器先检测 3080-3099。
2. 找到能返回 Harness 首页的端口时，直接复用该进程；否则在第一个可绑定端口启动 dsh。
3. Harness 首页可用后，Deepseek Harness Launcher 进入运行状态，并按设置决定是否只打开一次系统默认浏览器。
4. 「停止后台」会结束 Deepseek Harness Launcher 管理的 Harness 进程；「退出 Deepseek Harness Launcher」只退出菜单栏 UI，后台 Harness 会继续运行。

若所有端口均无法复用或绑定，或 `npx`/插件启动失败，Deepseek Harness Launcher 会显示失败提示；详细 stdout、stderr 与命令行记录可从「打开日志」查看。

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
```

DMG 打开后只显示一个 **「双击完成安装或更新」** App。双击后会停止旧进程、替换应用并重新启动：已安装在 `/Applications`（支持迁移旧版 `DHL.app` 或 `DSH.app`）时优先更新到 `/Applications/Deepseek Harness Launcher.app`；否则安装到 `~/Applications/Deepseek Harness Launcher.app`。没有写入 `/Applications` 权限时会请求管理员授权。隐藏载荷不会显示在 Finder 中，避免误拖。

默认构建产物使用 ad-hoc 签名，本机可直接运行；但直接下载安装仍可能被 Gatekeeper 拦截（提示“应用已损坏”），可先执行 `xattr -dr com.apple.quarantine "/Applications/Deepseek Harness Launcher.app"` 后重试。正式分发需通过 `scripts/sign-and-notarize.sh` 完成 Developer ID 签名与公证，所需凭据通过环境变量提供，不能写入仓库。

### 菜单栏操作

| 菜单项 | 快捷键 | 作用 |
|--------|--------|------|
| 打开 Deepseek Harness Launcher | ⌘O | 打开当前端口的 Harness 界面；未运行时自动启动 |
| 端口：xxxx | — | 实时显示当前运行端口（未运行则显示「未运行」） |
| 重新启动 | ⌘R | 停止后台并重启 |
| 停止后台 | ⌘S | 终止 Harness 后台进程 |
| 检查更新 | — | 手动检查 GitHub Releases |
| 设置… | ⌘, | 自动更新、检查频率、就绪开浏览器、开机启动 |
| 打开日志 | ⌘L | 打开 `~/Library/Logs/Deepseek Harness Launcher/dhl.log` |
| 退出 Deepseek Harness Launcher | ⌘Q | 退出（Harness 后台继续运行） |

### 设置与更新

- 设置项：自动检查更新、检查频率、Harness 就绪后自动打开浏览器、登录 macOS 时自动启动 Deepseek Harness Launcher。
- 默认值：自动检查更新开启、每 6 小时检查一次、启动后约 8 秒做首次后台检查；就绪后自动打开浏览器开启；开机启动关闭。检查间隔最小为 1 小时。
- 更新源固定为本仓库 GitHub Releases（`sljdxde/deepseek-harness-launcher`），用户无需填写地址。当前 App 版本为 `0.1.0`，仅当 Release 版本号更高时提示。
- GitHub API 返回 `403`（通常是未认证限流）时，启动器会回退读取 Releases Atom feed 来比较版本；没有已发布 Release 时，手动检查会显示「暂无可用更新」。
- 可用更新必须携带名为 `Deepseek Harness Launcher.dmg` 的 Release asset。下载保存到 `~/Downloads/Deepseek Harness Launcher-<version>.dmg`，随后由用户确认「安装并重启」；此操作会先停止后台、替换当前 App、再重新启动 Deepseek Harness Launcher。

### 卸载

```sh
./scripts/uninstall.sh
```

卸载脚本会移除当前/旧版 `Deepseek Harness Launcher.app`、`DHL.app` 与 `DSH.app`，清理历史 App 备份，卸载并注销旧 DMG 卷与 payload 注册，并删除指向 Deepseek Harness Launcher 自有资源的归档插件链接；**保留 `~/.dsh` 数据**（会话、归档、profile 与其他插件数据）。

---

## 归档管理插件（DSHArchiveManager）

- 位置：`Plugins/DSHArchiveManager/`，含 `cordis.patch.yml`、`lib/index.js`（服务端）、`client/client.js`（注入到 Harness Web 界面的 React 面板）。
- 注入方式：启动时在 `~/.dsh/profiles/web/node_modules/dsh-archive-manager` 创建指向 App 内资源的软链接，并以 `--patch <资源目录>/cordis.patch.yml` 传给 dsh；不会改写用户已有的 Cordis patch 文件。
- 归档面板展示 `archivedSessionIds` 中仍可找到的会话，并显示工作区与后代数量。服务端接口还会返回会话创建时间与工作目录，供后续界面使用。
- 支持单选、全选、单条删除与批量删除。用户在二次确认中点击「确认删除」后，立即永久删除所选会话及整个后代树；不要求输入 `DELETE`，也不校验会话是否仍在运行或是否已归档。
- 删除时先将会话目录移入 `~/.dsh/sessions` 下的临时暂存区，更新 `workspace.json` 中的工作区会话列表与 `archivedSessionIds`，再清理暂存区；索引更新失败会回滚已移动的目录。不会删除工作区目录本身。
- 启动器会在 Harness 就绪后探测插件路由。探测不到时核心 Harness 保持可用，日志会记录「归档增强插件不可用，Deepseek Harness Launcher 将以基础模式运行」。

### 升级兼容性

早期 DSH/DHL 安装可能在 `~/.dsh/profiles/web/node_modules/dsh-archive-manager` 留下一个指向旧 `DSH.app` 的失效软链接。Deepseek Harness Launcher 会自动替换指向自身 `DSHArchiveManager` 资源的旧链接，避免 `ERR_MODULE_NOT_FOUND`。若同名条目不是 Deepseek Harness Launcher 自己的链接或目录，Deepseek Harness Launcher 不会覆盖它，以免破坏第三方插件。

---

## 图标

- **App 图标**：圆形白底 + 黑色 creature，派生自 `deepseek-harness-desktop` 图标（仅改外框为圆形区分）。资产在 `Resources/icons/candidate-upstream/`（`DHL.iconset/` 含 16/32/128/256/512 + @2x 共 10 尺寸，`DHL.icns` 为烘焙产物）。
- **菜单栏图标**：`Resources/menubar-creature.png`（上游 `macos-tray.svg` 渲染图），作为 template 接入 —— 深色菜单栏自动显示为白色、浅色显示为黑色。
- 构建脚本经 `scripts/install-icon.sh` 把 `DHL.icns` 与 `menubar-creature.png` 打包进 App bundle。
- 版权与署名见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

---

## 架构概览

```text
┌─────────────────────────────────────────────┐
│ Deepseek Harness Launcher 菜单栏 App        │
│   状态栏图标 · 设置窗口 · 自更新 · 登录项    │
└───────────────┬─────────────────────────────┘
                │ 启动：npx --prefer-offline @deepseek-ai/dsh
                │        --profile web --patch <cordis.patch.yml>
                │        --no-open --port 3080..3099
                ▼
┌─────────────────────────────────────────────┐
│ dsh web profile（localhost，后台常驻）       │
│   ├─ Harness 界面  http://127.0.0.1:<port>/ │
│   └─ 归档管理插件  /dsh-archive-manager/*    │   ← 本项目注入的增强
└─────────────────────────────────────────────┘
                │
                ▼
       系统默认浏览器打开 Harness 界面
```

数据目录：`~/.dsh`（profile、会话、归档等由 dsh 自身管理）。

## 日志与排障

- 日志文件：`~/Library/Logs/Deepseek Harness Launcher/dhl.log`。菜单栏中的「打开日志」会直接打开它。
- 日志时间使用本机时区，格式为 `yyyy-MM-dd HH:mm:ss Z`；已有的历史 UTC 日志不会被重写。
- 遇到启动失败，优先检查日志中的「启动命令」以及紧随其后的 npm/dsh stderr。常见原因是 Node/npx 不在可发现路径、首次下载失败、端口已被非 Harness 程序占用，或归档插件链接指向了已删除的旧 App。

---

## 开发与测试

- 要求：macOS 12+，Xcode Command Line Tools（`swiftc`）。Universal 2 交叉编译只需 CLT。
- `./scripts/test.sh` 会执行插件语法与归档删除测试、启动器辅助逻辑测试、更新检查测试、安装替换测试，并构建与检查两个 Universal 2 App。

```sh
./scripts/test.sh
```

---

## 许可证

- 主仓库：MIT —— 见 [LICENSE](./LICENSE)。
- 图标资产改编自 `deepseek-harness-desktop`（MIT, © 2026 contributors），署名与修改说明见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

> ⚠️ `dsh` 具备本地代码执行能力，仅供学习 / 研究 / 测试，请在可信、隔离的环境中使用。
