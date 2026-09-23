# Deepseek Harness Launcher（DHL）

[English](./README.en.md)

**Deepseek Harness Launcher** 是一款轻量级 **原生 macOS 菜单栏启动器**，用于本地运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（基于 `@deepseek-ai/dsh` 的 AI agent 平台）。从 Spotlight 或 Raycast 搜索 `Deepseek Harness Launcher`，也可以输入 `dsh` 或 `dhl`，应用会启动 Harness 的 `web` profile、常驻菜单栏，并在服务就绪后打开系统默认浏览器；它不内嵌浏览器，也不提供独立的桌面聊天界面。

App 图标与菜单栏图标派生自官方 `deepseek-harness-desktop`（MIT 协议），仅做了圆形外框等少量修改 —— 见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

---

## 它和「原始 deepseek-harness」的关系

上游 `@deepseek-ai/dsh` 是 Harness 内核。官方提供两种跑法：

1. **命令行**：手动 `npx @deepseek-ai/dsh web`，自己管进程；
2. **官方桌面版** `deepseek-harness-desktop`：Tauri 2 外壳（Rust 后端 + WebView），跨 Windows/macOS/Linux，自带 Node 运行时与多版本内核管理，并内置完整 Tauri 插件生态。

**本项目是第三种、且是 macOS 专属的轻量方案**：一个纯原生 Swift / AppKit 菜单栏 App，不套任何 WebView/Electron/Tauri 外壳，只在需要时拉起你已经装好的 `dsh`，并额外注入一个归档管理增强插件。它**不替代 Harness 内核**，而是让 Harness 在 macOS 上更好用。

---

## 特性

| # | 增强点 | 说明 |
|---|--------|------|
| 1 | **原生菜单栏外壳，零 WebView** | 纯 AppKit/Swift 实现（`LSUIElement` 菜单栏 App，不在 Dock 占格）。相比 Tauri/Electron，体积小、内存低、随系统外观（浅/深色）自动切换。 |
| 2 | **内置归档管理插件（DSHArchiveManager）** | 通过 `--patch` 注入 Cordis patch，在 Harness Web 界面提供「归档管理」面板：列出归档会话、单条/批量删除（带二次确认）、显示工作区与后代数量。 |
| 3 | **智能端口管理（3080–3099）** | 启动前从 3080 扫描到 3099：发现正在响应的 Harness 就复用；否则使用第一个可绑定端口。若复用实例没有归档插件，Harness 仍可使用，日志会记录为基础模式。 |
| 4 | **首次安装可靠，后续启动稳定** | 首次启动前将 `@deepseek-ai/dsh` 完整安装到 `~/.dsh/runtime`，使用 peer-dependency 完整解析、临时目录安装和原子替换；默认优先较快的 npm 镜像，失败后回退官方源。后续直接运行固定 runtime，不使用易留下半安装缓存的 npx。 |
| 5 | **原生应用内自更新** | 直接对接本仓库 GitHub Releases，菜单内「检测启动器（DHL）更新」可显示版本/下载进度并下载 `Deepseek.Harness.Launcher.dmg`（GitHub 自动将空格存为点），随后自替换重启（支持自动定时检查 + 频率设置）。 |
| 6 | **开机自启动** | 通过 `LaunchAgent`（`com.local.dhl-launcher`）实现登录 macOS 自动拉起，可在设置中开关。 |
| 7 | **优雅的进程生命周期** | 停止 / 更新前对 Harness 进程组做 `SIGTERM → SIGKILL` 级联终止（含超时兜底），并精确匹配 launcher 自身路径与运行该 patch 的 npm/node 进程，避免误杀或残留孤儿进程。 |
| 8 | **原生设置窗口** | 自动更新开关与频率、就绪后是否自动开浏览器、开机启动；与系统外观一致。 |
| 9 | **实时状态 + 日志** | 菜单栏实时显示当前运行端口；所有 stdout/stderr 与生命周期事件写入 `~/Library/Logs/Deepseek Harness Launcher/dhl.log`，一键「打开日志」。 |
| 10 | **全局快捷呼出** | 任意应用中按 `⌃⌥D`（可在设置中录制更换）直接呼出 Deepseek Harness 浏览器窗口；检测到已有 Harness 页面时选中并前置原标签，不再重复新开。 |
| 11 | **启动时检测 dsh 更新** | 应用启动后异步检查 npm 上 `@deepseek-ai/dsh` 的最新版本，不阻塞启动；有新版本时菜单栏提示并可跳转 npm 查看。 |
| 12 | **内置插件管理（DSHPluginManager）** | 侧边栏新增「插件管理」入口，含「已安装」与「插件市场」两个页面：已安装插件可查看/卸载/**更新到最新版本**；市场数据来自 `awesome-dsh-plugin`（分类、搜索、按星级/下载排序、一键安装）。安装/卸载/更新通过 `dsh plugin --profile web` 执行，缺 pnpm 时自动用 corepack 自举，变更后提示重启 dsh 生效。可更新插件在侧边栏入口与面板里都有标记。 |
| 13 | **会话完成通知（DSHSessionNotify）** | 内置服务端插件监听主会话 `turn/end`（方案同社区 dsh-notify 插件，但不弹系统通知）。会话回合结束时，菜单栏图标显示 Foxmail 式红色未读角标（**按会话计数**：同一会话连跑多轮仍只算一个），菜单顶部列出最近的完成/出错/中止会话（时间 · 标题 · 结果），点击条目打开 Harness 页面并清除角标，也可一键「清除完成提醒」。 |

| 14 | **启动失败自动恢复** | 某个插件把 dsh 弄崩时（插件 import 失败会让整个进程以退出码 1 结束），启动器从 stderr 里认出是哪个插件，用自带的 `--patch` overlay 把它的行 `disabled: true` 再自动重启；认不出或隔离到上限就转入只加载 dsh 自带插件的安全模式。全过程不改动 profile 的依赖与 bundle 列表，菜单里可一键恢复。详见「启动失败自动恢复」。 |
**边界与取舍**：

- 仅支持 macOS（无 Windows / Linux）；
- 不捆绑 Node 运行时，也不管理多个 dsh 内核版本；需要用户系统中已有可用的 `node` 与 `npm`。
- 首次启动会显示安装窗口；依赖下载可能需要几分钟，安装成功后后续启动直接复用 `~/.dsh/runtime`。
- Deepseek Harness Launcher 只添加自己的内置插件链接（归档管理、插件管理、会话完成通知）与临时 patch；Harness 原有 profile、会话及其他插件仍由 dsh 管理。

---

## 前置条件

- macOS 12 或更高版本。
- 已安装可从终端使用的 Node.js（建议 Node 22 或与当前 dsh 兼容的 LTS）及 npm。Deepseek Harness Launcher 不携带 Node 运行时。
- 网络仅在首次安装/更新 `@deepseek-ai/dsh` 或检查/下载 Deepseek Harness Launcher 更新时需要。

首次启动会先执行安装。App 内置锁定版本的 `dsh-runtime/package-lock.json`，安装走低内存的 `npm ci`（复放已解析的依赖集，峰值约 0.3~0.6GB，避免裸 `npm install` 全量解析导致的 ~3GB 内存占用）：

```sh
npm ci --prefix ~/.dsh/runtime --no-audit --no-fund --prefer-offline \
  --registry <registry>
```

更新 dsh 不需要重新全量解析：新版本 App 自带更新的锁定文件，启动时检测到已装版本不一致，会自动用同样的 `npm ci` 做低内存原子升级。

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
3. Harness 首页可用后，Deepseek Harness Launcher 进入运行状态，并按设置决定是否只打开一次系统默认浏览器。
4. 「退出 Deepseek Harness」会退出菜单栏 UI，并终止 Deepseek Harness Launcher 管理的 Harness 后台进程。

若所有端口均无法复用或绑定，或 npm/dsh/插件启动失败，Deepseek Harness Launcher 会显示失败提示；首次安装期间可取消，临时目录会自动清理。详细 stdout、stderr 与命令行记录可从「打开日志」查看。

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
| 会话完成（N 个未读） | — | 仅在有未读完成提醒时出现：列出最近完成的会话（时间 · 标题 · 结果），点击条目选中 Harness 原标签、打开对应会话并清除角标，或「清除完成提醒」 |
| 打开 Deepseek Harness | ⌘O | 打开当前端口的 Harness 界面；未运行时自动启动。浏览器里已有 Harness 页面时选中原标签，否则才新开；首次复用标签时 macOS 会请求允许启动器控制浏览器 |
| 全局呼出 Deepseek Harness | ⌃⌥D | 任意应用中呼出，可在设置中录制更换 |
| 端口：xxxx | — | 实时显示当前运行端口（未运行则显示「未运行」） |
| 检测启动器（DHL）更新 | — | 手动检查 GitHub Releases，更新说明按 Markdown 渲染展示 |
| 设置… | ⌘, | 自动更新、检查频率、就绪开浏览器、开机启动 |
| 打开日志 | ⌘L | 打开 `~/Library/Logs/Deepseek Harness Launcher/dhl.log` |
| 退出 Deepseek Harness | ⌘Q | 退出并终止 Harness 后台进程 |

### 设置与更新

- 设置项：自动检测启动器（DHL）更新、检查频率、Harness 就绪后自动打开浏览器、登录 macOS 时自动启动 Deepseek Harness Launcher、全局快捷呼出快捷键。
- 默认值：自动检测启动器（DHL）更新开启、每 6 小时检查一次、启动后约 8 秒做首次后台检查；就绪后自动打开浏览器开启；开机启动关闭；全局快捷键启用，默认 `⌃⌥D`。检查间隔最小为 1 小时。
- 更新源固定为本仓库 GitHub Releases（`sljdxde/deepseek-harness-launcher`），用户无需填写地址。当前 App 版本为 `0.3.5`，仅当 Release 版本号更高时提示；Release 正文（Markdown）会在更新弹窗中渲染为带标题、列表与行内样式的更新说明。
- 启动器自身更新和 `@deepseek-ai/dsh` 更新是两条独立链路；dsh 检查同时读 **npm 的 dist-tags**（`latest` / `next` / `beta` / `alpha`）与 **GitHub Release**（`deepseek-ai/deepseek-harness` 的 `releases.atom`；匿名 API 常被 `403` 限流，feed 更稳），取两者中最新、且确实已发布到 npm 的版本，只提示，不修改 npm 缓存。菜单标题与弹窗都会标出通道（正式版 / 候选版 / 公测版 / 内测版）——npm 的 `latest` 常常落后于刚发的 Release，只看它就会漏掉新版本。
- dsh 是否更新完全由用户决定：弹窗提供「更新到 vX / 稍后 / 跳过此版本」，预发布版本默认按钮是「稍后」（回车不会顺手装上内测版），弹窗里显示来源（GitHub Release / npm 某标签）、发布日期与 Release 正文（Markdown 渲染）。**找到多个比当前新的版本时，弹窗给出「更新到：[版本下拉]」**：一次列全（最新的在最上、最多 10 条、默认选最新一版），切换版本会同步刷新该版本的来源、日期与说明，按钮也跟着变成「更新到 vX」；只有一个候选时退化为原先的单版本提示。「跳过此版本」跳过的是当前下拉里选中的那一版，并会被记住：自动检查只把菜单写成「已跳过 vX」，手动点菜单仍会弹窗（里面可「取消跳过此版本」）。自动检查只改菜单标题，**从不静默安装**。
- dsh 的 Release tag 形如 `dsh-v0.1.7-alpha.1`，与 npm 版本 `0.1.7-alpha.1` 视为同一版本；同版本优先采用 GitHub Release（带发布日期与更新说明）。只有出现在 npm 版本列表里的候选才会被推荐——镜像滞后时 GitHub 刚发的 tag 还没上 npm，直接安装会 `ETARGET` 失败，这类候选会被忽略并写进日志。
- 提示框外观统一走 `AlertDesign`：语气图标（SF Symbol，加色）、标题 + 一句话正文 + 圆角信息卡（版本对比 `v旧 → v新` + 通道胶囊 / 来源与日期 / Release 说明），细节不再堆进正文；卡片下的次要说明用三级色小字。
- dsh 的版本比较按 npm 语义（semver）：同 base 下预发布低于正式版，`alpha.1 < alpha.2`、`rc.2 < rc.3` 都能区分（启动器自身 `x.y.z-a.b[-SNAPSHOT]` 用的 `compareVersions` 不区分后者，所以 dsh 用独立的 `compareDSHVersions`）。
- GitHub API 返回 `403`（通常是未认证限流）时，启动器会回退读取 Releases Atom feed 来比较版本；没有已发布 Release 时，手动检查会显示「暂无可用更新」。
- 可用更新必须携带名为 `Deepseek.Harness.Launcher.dmg` 的 Release asset（GitHub 不接受空格，会把文件名里的空格改为点）。下载期间显示可最小化/关闭的进度窗口，关闭窗口不取消下载；下载保存到 `~/Downloads/Deepseek Harness Launcher-<version>.dmg`，随后由用户确认「安装并重启」；此操作会先终止后台、替换当前 App、再重新启动 Deepseek Harness。

### 插件版本检测与更新

- **检测口径（按来源分派）**：npm 包走 registry 的 `dist-tags`（只跟 `latest` 比，不把 rc/beta/alpha 推给装正式版的用户）；`github:` 依赖与 `plugin-sources` 里的克隆走 `git ls-remote` + 远端 `package.json`，**以"远端版本号变高"为判定**，只有 commit 变了而版本号没变时附注「远端有新提交」；`version` 相同时判定为已是最新。
- **跨大版本**会照常提示，但标注为「跨大版本 vX」，更新按钮直接安装最新版（无视 profile 里记录的版本范围）。
- **升级前的 dsh 版本门禁**：执行更新前先取目标版本声明的 `peerDependencies`（npm 走 registry、git 来源走远端 `package.json`），与本机 `~/.dsh/runtime` 里各 `@deepseek-ai/*` 组件的实际版本比对；不满足就**直接阻止这次升级**并说明「目标版本要求 X，当前 dsh 是 Y，请先更新 dsh 本体」。探测本身失败（registry 不通、仓库改名）时放行——判不了不等于不兼容，后面还有装后验收与启动隔离两层兜底。
- **区间语义与启动器自身的版本比较是两套**：插件与 dsh 的兼容性按 npm 语义判（`rc.1 < rc.6`、`^0.0.3` 上界是 `0.0.4`、支持 `0.1.x`/`>= 0.1.0`/`||`）；但**不**采纳 npm 默认的预发布门控——dsh 生态常态就是装 rc runtime，套上去会把所有只写正式区间的插件一律报成不兼容，警告变成噪音。同一套规则在 Swift（`Sources/PluginCompatibilitySupport.swift`）与 JS（`satisfiesPluginRange`）各实现一份，两边用同一批表驱动用例锁住。
- **来源识别**：克隆到 `plugin-sources` 时写入 `.dsh-source.json`（作者 / 仓库 / 子目录 / commit）。此前装的旧克隆没有这个标记，检测时会按 `package.json` 的 `repository.url` + `repository.directory` → 市场索引 → 目录名候选的顺序逐个 `git ls-remote` 确认，命中后把标记写回目录（所以"大仓库子目录"型插件也能正确检测）。都确认不了（本地插件或私有仓库）才标记为「未识别到可检测的远端来源」。
- **更新动作**：npm → `pnpm add <name>@<latest>`；`github:` → 按原 spec 重新解析；`plugin-sources` 克隆 → 先把旧目录改名成 `.bak-<时间戳>` 再重新 clone 覆盖，失败自动回滚（只保留最近一个备份）。服务端插件代码要**重启 dsh** 才生效。
- **后台自动检测**：默认开启（设置窗口「自动检测插件更新」可关）。开启时启动器在服务就绪后约 15 秒触发一次刷新，之后跟随「检查频率」（默认每 6 小时）；结果缓存在 profile 下的 `.plugin-updates.json`，默认 6 小时内不重复联网。关闭只影响后台检测，面板里的「检查更新」仍可用。
- **呈现**：插件管理面板「已安装」列表每行显示当前版本与「可更新到 vX」（可单条更新，也可「全部更新」），并有「上次检测」时间；侧边栏「插件管理」入口和启动器菜单行也会显示可更新数量。旧的外部 Harness 实例没有这些接口时静默降级。

### 启动失败自动恢复（插件隔离与安全模式）

设计目标：**点「重启」一定要能把 Harness 拉起来**。插件是 dsh 启动时逐个 import 的，任何一个抛错整个进程就以退出码 1 结束，而插件管理器的 HTTP 接口随 dsh 一起死——所以恢复逻辑必须放在启动器里，不依赖 dsh 活着。

- **只在「启动过程中」退出才触发**：运行期崩溃的原因五花八门，那时候禁插件大概率无效，还会静默削弱用户环境。
- **归因**：从这次启动的 stderr 里认 `failed to import loader entry <行> (<包>)`、`Cannot find package '<包>'`、`ERR_MODULE_NOT_FOUND` 的 `node_modules` 路径。括号里是 `@deepseek-ai/*` 这类公共层时改用**行 id 反查**（`--dump-config` 的 `# == <包名>` 段能查出那一行属于哪个 bundle）——dsh 升级后最常见的破坏是「模块 import 得动、插件 init 才炸」，那种报错里既没有包名也没有路径。
- **拉起前的静态预检**：第一次启动 dsh 之前先把 profile 里的第三方 bundle 扫一遍相对 import，缺文件的**预隔离**掉（原因记「启动前预检」），让「上游只在打包时生成公共模块」这类问题不需要先失败一次才自愈。只在真查出问题时才付一次 `--dump-config` 的开销。
- **逐个排除（bisect）**：什么都没点名时，按 `dsh.profile.bundles` 的第三方列表一个一个禁、一个一个试。失败退出只要几秒，代价是几次快速重试，换来的是**只禁掉真正坏的那一个**，而不是一把全砍。第三方全禁完仍起不来才转安全模式（此时先提出 dsh 版本一键回退，回退不成才进安全模式）。
- **隔离**：跑一次 `dsh web --dump-config`（只 compose、不启服务，坏 profile 上照样出结果）取该包**自己贡献**的顶层行 id，取不到再退回包内 `cordis.patch.yml` 的 `insert:` 块；然后写两个文件到 `~/Library/Application Support/Deepseek Harness Launcher/`：`plugin-isolation.json`（状态）与 `plugin-isolation.yml`（overlay）。下次启动以最高优先级的 `--patch` 传入 `- id: <行>` + `disabled: true`，并自动重新拉起。
  - 不碰 profile 的 `dependencies` 与 `dsh.profile.bundles`（那两处 `dsh plugin` 每次都会 reconcile 回来），不删插件文件，不跑 pnpm。
  - 内置插件（`@deepseek-ai/dsh-base`、`dsh-web-app` 与启动器自带的三个插件）永不被隔离。
  - 一次启动会话最多连续隔离 3 个插件，避免把插件挨个禁光。
- **安全模式**：认不出嫌疑插件、或隔离额度用尽时，改用 `dsh --profile rescue --from-default-profile web` 启动——只含 dsh 自带的 base + web-app（新建约 16K，不需要网络），第三方插件一个都不加载。此时不跑归档/通知/插件更新等探针，免得对着一堆「插件不可用」弹窗。
- **恢复**：菜单会出现「已隔离 N 个插件…（点按恢复）」或「退出安全模式并重启」。手动复位删掉 `plugin-isolation.json` 即可。
- **已知代价**：被隔离的插件如果给别的 bundle 注入服务，那些行会以 `pending (waiting for services: …)` 再失败一次，此时阶梯会继续隔离下一个嫌疑插件或转入安全模式。
- **dsh 版本回退快照的释放时机**：不是「首页有响应」就算成功——那会出现「dsh 升到 X 之后所有插件加载失败、但界面显示成功、也已经一键回不去」。快照要等内置插件探测成功（插件树真的加载完）才清理。
- **还在观察的缺口**：dsh 本体升级后启动器会跑一次 `dsh plugin update --latest` 同步插件，那条路走的是 dsh 自带 CLI，**没有**上面这套 peer 门禁与装后验收；它的兜底是启动预检 + 逐个排除 + 兼容性扫描提示。

### 卸载

```sh
./scripts/uninstall.sh
```

卸载脚本会移除当前/旧版 `Deepseek Harness Launcher.app`、`DHL.app` 与 `DSH.app`，停止并删除 DHL 管理的 `~/.dsh/runtime` 及临时安装目录，清理历史 App 备份，卸载并注销旧 DMG 卷与 payload 注册，并删除指向 Deepseek Harness Launcher 自有资源的归档插件链接；**保留其他 `~/.dsh` 数据**（会话、归档、profile 与其他插件数据）。

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

## 会话完成通知插件（DSHSessionNotify）

- 位置：`Plugins/DSHSessionNotify/`（`lib/index.js` 服务端插件 + `cordis.patch.yml` 注入声明），随归档插件的 patch 一起生效。
- 检测方式与社区 `dsh-notify` 插件一致：订阅 Harness 服务端 `session/event` 事件流，主会话（非 subagent）回合结束时记录一条完成事件；不同点在于不弹系统通知，而是通过 `GET /dsh-session-notify/events?after=<seq>` 暴露给启动器轮询（仅 127.0.0.1，不出机器）。
- 呈现：菜单栏图标叠加 Foxmail 式红色未读角标（99 封顶显示 `99+`，按会话计数）；菜单顶部「会话完成」区块列出最近 6 条（时间 · 会话标题 · 结果：已完成/出错/已中止/达到 token 上限/被阻塞）。点击条目会选中已打开的 Harness 标签并打开对应会话，也可「清除完成提醒」。首次使用时 macOS 会询问是否允许启动器控制 Chrome/Safari；拒绝、外部实例或不支持的浏览器会降级为原来的打开/前置页面行为。
- 排队消息（插话）场景：用户在我干活时又发一条消息时，回合可能以 `aborted`（`reason.kind === 'user'`）收尾，或先 `completed` 再立刻开跑下一轮——两种都不该让角标亮起「会话已完成」。因此插件**不记录被打断的回合**，并在每一轮 `turn/start` 写一条 `resumed` 记录；启动器收到 `resumed` 会撤销该会话的未读提醒（同一批轮询里先记后撤即为净零，角标不会闪）。旧插件/旧缓冲里的 `aborted` 事件在启动器侧同样按撤销处理。
- 菜单行标签用**工作区名称**（`~/.dsh/storages/workspace.json` 里每个工作区的 sessionIds 反查），拿不到就回退会话标题、再回退短 id——不会再出现一列分不清的 `session-`。
- 点某一条只把**那一条**标记已读并跳转到该会话（工作区随之切换），其它条目留在列表里还能再点；行内未读用半粗体区分，`清除完成提醒` 才是全部清空。
- 语义：角标 = **未读会话数**，不是 turn 数——一个长会话每回一轮都会写一条 `turn/end`，按事件计数会出现「1 个会话、9 条未读」这种明显不对的数字；同一会话的后续完成覆盖前一条（只留最近一次的时间与原因）。数字直到用户点击或清除才会归零；dsh 重启（序列号归零）不会重复计数。Harness 侧仅保留最近 50 条事件，内存占用可忽略。
- 标题：优先取会话自身 `session/title` 事件里的标题；标题是异步生成的，早一轮还没有标题时回退成会话 ID 去掉 `session-` 前缀后的 8 位（避免所有条目都显示成 `session-`）。
- 可用性：仅当启动器自己启动/重启 dsh（带内置 patch）时可用；复用外部 Harness 或升级后未重启 dsh 时接口不存在，启动器静默降级并在日志记录一次。此时菜单栏不会出现角标，不影响其他功能。

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
                │ 启动：~/.dsh/runtime/node_modules/.bin/dsh
                │        web --patch <cordis.patch.yml>
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
- 遇到启动失败，优先检查日志中的「启动命令」以及紧随其后的 npm/dsh stderr。常见原因是 Node/npm 不在可发现路径、registry 网络失败、端口已被非 Harness 程序占用，或归档插件链接指向了已删除的旧 App。
- 因插件导致的启动失败会先自动隔离并重试（日志里搜「已隔离插件」），隔离记录在 `~/Library/Application Support/Deepseek Harness Launcher/plugin-isolation.json`；某次更新后功能消失，先看这个文件是不是把插件禁掉了。

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
