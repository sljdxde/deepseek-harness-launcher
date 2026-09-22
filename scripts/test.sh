#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --check "$ROOT/Plugins/DSHArchiveManager/lib/index.js"
node --check "$ROOT/Plugins/DSHArchiveManager/client/client.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/running-session-ids.test.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/legacy-session-headers.test.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/workspace-auto-archive.test.js"
rg -q 'patchWorkspaceDeleteForAutoArchive' "$ROOT/Plugins/DSHArchiveManager/lib/index.js"
node --check "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
node --check "$ROOT/Plugins/DSHSessionNotify/client/client.js"
node --test "$ROOT/Plugins/DSHSessionNotify/test/session-notify.test.js"
node --test "$ROOT/Plugins/DSHSessionNotify/test/client.test.js"
if rg -q 'stopRunningAgents|需要二次确认删除|只能删除已归档' "$ROOT/Plugins/DSHArchiveManager/lib/index.js"; then
  echo "archive deletion must not perform runtime or archive-state validation" >&2
  exit 1
fi
rg -Fq 'body: JSON.stringify({ sessionIds: confirmIds })' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
node --check "$ROOT/Plugins/DSHPluginManager/lib/index.js"
node --check "$ROOT/Plugins/DSHPluginManager/client/client.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-manager.test.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/client-toasts.test.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
# 客户端 UI 渲染冒烟：纯函数测不到的组件接线（工具栏/行内标记/批量轮询/多选/降级）。
node "$ROOT/Plugins/DSHPluginManager/test/client-render.smoke.mjs"
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-manager.integration.test.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-updates.test.js"
if rg -q 'npx |git clone|github.com' "$ROOT/Plugins/DSHPluginManager/lib/index.js" >/dev/null && ! rg -q 'installCandidates|git\+' "$ROOT/Plugins/DSHPluginManager/lib/index.js"; then
  echo "plugin manager must expose npm-first / git-fallback install candidates" >&2
  exit 1
fi
rg -q 'dsh-plugin-manager' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -q 'sidebar.footer.action' "$ROOT/Plugins/DSHPluginManager/client/client.js"
# 插件版本检测与更新：双源判定、老克隆补标记、按来源分派更新动作、后台检测开关。
rg -q 'comparePluginVersions' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'classifyPluginSource' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'decidePluginUpdate' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq '.dsh-source.json' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'readRepositoryHint' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'GIT_TERMINAL_PROMPT' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq "'/dsh-plugin-manager/updates'" "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq "'/dsh-plugin-manager/update-many'" "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq '/dsh-plugin-manager/updates' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq 'update-many' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq '/dsh-plugin-manager/updates' "$ROOT/Sources/main.swift"
rg -Fq 'autoCheckPluginUpdates' "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/SettingsWindowController.swift" "$ROOT/Sources/main.swift"
rg -Fq 'decidePluginUpdate' "$ROOT/Plugins/DSHPluginManager/test/plugin-updates.test.js"
# 客户端更新 UI 的纯函数（多选/框选/角标/进度/批量 toast）必须有单测。
rg -Fq 'bandSelection' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'rangeSelection' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'updatesBadgeText' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'batchToast' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'progressStepText' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -q "register\([^\n]*PluginTrigger" "$ROOT/Plugins/DSHPluginManager/client/client.js"
# 侧边栏底部动作：宿主把该 slot 渲染成 Settings 旁边的一行 nowrap flex，
# 两个占位者都声称整行宽，第二个就会被排到侧边栏右边缘之外（DOM 里存在、
# 屏幕上看不见）。因此每个动作自己占一整行（容器 wrap + flex:0 0 100%），
# 折叠态（56px 竖栏）退回 36px 圆形图标按钮。
# 通过 slot 标记的 :has() 命中容器，不得依赖宿主 CSS-module 的哈希类名。
for client in "$ROOT/Plugins/DSHArchiveManager/client/client.js" "$ROOT/Plugins/DSHPluginManager/client/client.js"; do
  rg -Fq "div:has(> [data-slot='sidebar.footer.action']){flex-wrap:wrap}" "$client"
  rg -Fq 'flex:0 0 100%' "$client"
  rg -q '\-rail\{' "$client"
done
if rg -q '\[class\$="_footerActions"\]' "$ROOT/Plugins/DSHArchiveManager/client/client.js" "$ROOT/Plugins/DSHPluginManager/client/client.js"; then
  echo "sidebar footer layout must not patch the shell's hashed CSS-module class" >&2
  exit 1
fi
# 竖栏里只显示图标，且只在明确的 wide === false 时切换（折叠动画期间保持宽行）。
rg -Fq "const rail = wide === false" "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq "rail ? 'dsh-pm-trigger dsh-pm-trigger-rail' : 'dsh-pm-trigger'" "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq '!rail && h' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq "wide === false ? 'dsh-archive-trigger dsh-archive-trigger-rail' : 'dsh-archive-trigger'" "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q '/dsh-plugin-manager/installed' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/marketplace' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/install' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/uninstall' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/update' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'cleanupPluginSources' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'awesome-dsh-plugin' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'ensurePnpmPath' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'corepack' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'pnpm-bin' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'dsh-plugin-manager' "$ROOT/Plugins/DSHArchiveManager/cordis.patch.yml"
# 会话完成通知：插件随启动器打包、patch 注入并由菜单栏轮询。
rg -q 'dsh-session-notify' "$ROOT/Plugins/DSHArchiveManager/cordis.patch.yml"
rg -Fq 'DSHSessionNotify' "$ROOT/scripts/build-app.sh" "$ROOT/scripts/build-universal.sh" "$ROOT/Sources/main.swift"
rg -Fq 'BundledPlugin(linkName: "dsh-session-notify", bundleMarker: "DSHSessionNotify", url: sessionNotifyPluginURL)' "$ROOT/Sources/main.swift"
rg -q '/dsh-session-notify/events' "$ROOT/Plugins/DSHSessionNotify/lib/index.js" "$ROOT/Sources/main.swift"
# 页面存活心跳：标签页全关后 keep-alive 连接仍在，必须靠注入客户端的
# presence（轮询心跳 + pagehide bye）判断是否需要新开页面。
rg -q '/dsh-session-notify/presence' "$ROOT/Plugins/DSHSessionNotify/lib/index.js" "$ROOT/Plugins/DSHSessionNotify/client/client.js" "$ROOT/Sources/main.swift"
rg -q 'presenceActive' "$ROOT/Sources/BrowserConnectionSupport.swift" "$ROOT/Sources/main.swift"
rg -q '/dsh-session-notify/open' "$ROOT/Plugins/DSHSessionNotify/lib/index.js" "$ROOT/Sources/main.swift"
rg -q '/dsh-session-notify/commands/claim' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -q 'ctx\.sessions\.open' "$ROOT/Plugins/DSHSessionNotify/client/client.js"
rg -q '"\./client": "\./client/client.js"' "$ROOT/Plugins/DSHSessionNotify/package.json"
rg -q '"client"' "$ROOT/Plugins/DSHSessionNotify/package.json"
rg -q 'monitorSessionNotify' "$ROOT/Sources/main.swift"
rg -q 'makeSessionNotifyBadgeImage' "$ROOT/Sources/main.swift"
rg -q 'dsh-session-notify' "$ROOT/scripts/uninstall.sh"
rg -q 'DSHSessionNotify' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
if rg -Fq 'alert.informativeText = manifest.notes' "$ROOT/Sources/main.swift"; then
  echo "update notes must be rendered as markdown, not dumped into informativeText" >&2
  exit 1
fi
rg -q 'ReleaseNotesMarkdown.attributedString' "$ROOT/Sources/DSHUpdateVersionPicker.swift"
rg -q 'UpdateDownloadWindowController' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateDownloadWindowController.swift"
rg -q 'UpdateDownloadProgress' "$ROOT/Sources/UpdateSupport.swift"
rg -q 'miniaturizable' "$ROOT/Sources/UpdateDownloadWindowController.swift"
# 三种更新的进度窗口都走 DSHInstallWindowController，必须可最小化。
rg -Fq '.titled, .closable, .miniaturizable' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq 'static let pluginUpdate = ProgressWindowWording(' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq 'DSHInstallWindowController(wording: .pluginUpdate)' "$ROOT/Sources/main.swift"
rg -Fq 'PluginUpdatePresentation.progress' "$ROOT/Sources/main.swift"
rg -Fq 'PluginUpdatesSnapshot.parse' "$ROOT/Sources/main.swift"
rg -Fq '/dsh-plugin-manager/updates' "$ROOT/Sources/main.swift"
rg -q 'onProgress' "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/main.swift"
rg -Fq 'DSHPluginManager' "$ROOT/scripts/build-app.sh" "$ROOT/scripts/build-universal.sh" "$ROOT/Sources/main.swift"
rg -q 'window.isOpaque = true' "$ROOT/Sources/SettingsWindowController.swift"
rg -q 'visualEffect.blendingMode = .withinWindow' "$ROOT/Sources/SettingsWindowController.swift"
rg -q 'checkbox.contentTintColor = .labelColor' "$ROOT/Sources/SettingsWindowController.swift"
if rg -q 'feedField|updateFeedURL|更新清单' "$ROOT/Sources/SettingsWindowController.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/main.swift"; then
  echo "update source must be fixed to GitHub Releases" >&2
  exit 1
fi
rg -Fq 'sljdxde/deepseek-harness-launcher' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'api.github.com/repos' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'Deepseek.Harness.Launcher.dmg' "$ROOT/Sources/UpdateSupport.swift"
if rg -Fq 'DHL.dmg' "$ROOT/Sources/UpdateSupport.swift"; then
  echo "update asset must use the full DMG name" >&2
  exit 1
fi
rg -q 'case \.noPublishedRelease' "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/main.swift"
rg -q "return \{ inject: \['slots', 'locale'\], apply \}" "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q 'dsh-archive-select-all' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q 'selectAllRef\.current\.indeterminate' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
plutil -lint "$ROOT/Resources/Info.plist"
plutil -extract CFBundleExecutable raw "$ROOT/Resources/Info.plist" | grep -qx 'DHL'
plutil -extract CFBundleDisplayName raw "$ROOT/Resources/Info.plist" | grep -qx 'Deepseek Harness Launcher'
plutil -extract CFBundleName raw "$ROOT/Resources/Info.plist" | grep -qx 'Deepseek Harness Launcher'
# 版本号规则见 AGENTS.md：正式 x.y.z；提测 x.y.z-a.b；开发 x.y.z-a.b-SNAPSHOT。
# 门禁只校验格式规则与两处 plist 一致性，不锁定具体版本号。
APP_VERSION="$(plutil -extract CFBundleShortVersionString raw "$ROOT/Resources/Info.plist")"
INSTALLER_VERSION="$(plutil -extract CFBundleShortVersionString raw "$ROOT/Resources/InstallerInfo.plist")"
VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+\.[0-9]+(-SNAPSHOT)?)?$'
echo "$APP_VERSION" | grep -Eqx "$VERSION_PATTERN" || { echo "Info.plist 版本不符合 AGENTS.md 规则: $APP_VERSION" >&2; exit 1; }
echo "$INSTALLER_VERSION" | grep -Eqx "$VERSION_PATTERN" || { echo "InstallerInfo.plist 版本不符合 AGENTS.md 规则: $INSTALLER_VERSION" >&2; exit 1; }
[[ "$APP_VERSION" == "$INSTALLER_VERSION" ]] || { echo "版本不一致: $APP_VERSION vs $INSTALLER_VERSION" >&2; exit 1; }
rg -Fq '正在安装 DHL' "$ROOT/Installer/main.swift"
rg -Fq '已更新，正在重新启动 DHL' "$ROOT/Installer/main.swift"
zsh -n "$ROOT/scripts/install.sh"
zsh -n "$ROOT/scripts/install-from-app.sh"
zsh -n "$ROOT/scripts/uninstall.sh"
rg -q "cleanup_legacy_volumes" "$ROOT/scripts/uninstall.sh"
rg -q "unregister_legacy_paths" "$ROOT/scripts/uninstall.sh" "$ROOT/scripts/install-from-app.sh"
rg -q "remove_backups" "$ROOT/scripts/uninstall.sh"
rg -q "remove_dsh_runtime" "$ROOT/scripts/uninstall.sh"
rg -q "runtime.installing-" "$ROOT/scripts/uninstall.sh"
rg -q "prune_backups" "$ROOT/scripts/install-from-app.sh"
rg -q "xattr -dr com.apple.quarantine" "$ROOT/scripts/install-from-app.sh"
zsh -n "$ROOT/scripts/Install DHL.command"
zsh -n "$ROOT/scripts/build-installer-app.sh"
zsh -n "$ROOT/scripts/swift-slice.sh"
zsh -n "$ROOT/scripts/build-dmg.sh"
"$ROOT/scripts/test-installer.sh"
# 安装器测试必须限定进程停止作用域：禁止回归运行杀掉真实安装的 launcher/dsh。
rg -q 'DHL_STOP_SCOPE' "$ROOT/scripts/install-from-app.sh" "$ROOT/scripts/test-installer.sh"
rg -q 'signal_processes launcher_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'signal_processes dsh_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'wait_for_processes launcher_pids' "$ROOT/scripts/install-from-app.sh"
rg -q 'Previous app backup' "$ROOT/scripts/install-from-app.sh"
if rg -q 'tell application id|DHL_SKIP_BUNDLE_QUIT|DSH_SKIP_BUNDLE_QUIT' "$ROOT/scripts/install-from-app.sh"; then
  echo "installer must stop old processes without Apple Events" >&2
  exit 1
fi
rg -q 'ensureBundledPluginLinks' "$ROOT/Sources/main.swift"
rg -q 'ensureBundledPluginLink' "$ROOT/Sources/ArchivePluginSupport.swift"
rg -q 'BundledPlugin\(' "$ROOT/Sources/main.swift"
rg -Fq 'Plugins/DSHPluginManager' "$ROOT/Sources/main.swift"
rg -q 'executablePath\(named: "npm"' "$ROOT/Sources/main.swift"
rg -q 'DSHRuntimeSupport.install' "$ROOT/Sources/main.swift"
rg -q 'runtime.installing-' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'cleanupInterruptedInstalls' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -Fq '已检测到完整 dsh runtime，跳过 npm 下载' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'SIGKILL' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'cordis-plugin-group/package.json' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'DSHInstallWindowController' "$ROOT/Sources/main.swift"
rg -q 'DSHInstallProgressTracker' "$ROOT/Sources/main.swift"
rg -Fq '本地未检测到 DeepSeek Harness' "$ROOT/Sources/DSHInstallWindowController.swift" "$ROOT/Sources/main.swift"
rg -Fq '安装命令：npx @deepseek-ai/dsh web' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq '安装进度：正在下载 npm 依赖' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq '安装完成后会自动打开 DeepSeek Harness Web 页面' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq '打开 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -Fq '退出 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -Fq '重启 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -q 'restartDSH' "$ROOT/Sources/main.swift"
rg -q 'stopDHL \{' "$ROOT/Sources/main.swift"
# 重启竞态：旧实例的 terminationHandler 可能在新实例已启动后才回到主线程，
# 必须比对「当前受管进程」身份，否则重启成功也会弹「启动失败」并清空新实例引用。
rg -Fq 'guard self.process === terminatedProcess else {' "$ROOT/Sources/main.swift"
rg -Fq '旧实例退出不计入启动失败' "$ROOT/Sources/main.swift"
if rg -Fq 'menuRowItem(title: "打开 Deepseek Harness Launcher"' "$ROOT/Sources/main.swift" || rg -Fq 'menuRowItem(title: "退出 Deepseek Harness Launcher"' "$ROOT/Sources/main.swift"; then
  echo "menu labels must use the shorter Deepseek Harness name" >&2
  exit 1
fi
if rg -Fq '停止后台' "$ROOT/Sources/main.swift"; then
  echo "obsolete Stop Backend menu item must not be present" >&2
  exit 1
fi
rg -q 'if elapsedTimer == nil' "$ROOT/Sources/DSHInstallWindowController.swift"
if rg -q '预计时长|预计剩余|estimate' "$ROOT/Sources/DSHInstallWindowController.swift" "$ROOT/Sources/DSHInstallProgress.swift" "$ROOT/Sources/main.swift"; then
  echo "installation UI must not show fabricated time estimates" >&2
  exit 1
fi
rg -q 'progress\.isIndeterminate = true' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -q 'openWhenReady' "$ROOT/Sources/main.swift"
rg -q 'openBrowserWhenReadyIfNeeded' "$ROOT/Sources/main.swift"
rg -q 'installWindow\.present\(\)' "$ROOT/Sources/main.swift"
rg -q 'NSRunningApplication' "$ROOT/Sources/main.swift"
rg -q 'createsNewApplicationInstance = false' "$ROOT/Sources/main.swift"
# Web 入口复用已有页面：用 lsof 客户端连接 + ps 父子链找浏览器主进程，
# 命中后由 Apple Events 选中已有 Harness 标签，避免 NSWorkspace.open 重复创建标签页。
rg -q 'BrowserConnectionSupport' "$ROOT/Sources/main.swift"
rg -q 'clientPIDs' "$ROOT/Sources/BrowserConnectionSupport.swift"
rg -q 'browserPID' "$ROOT/Sources/BrowserConnectionSupport.swift"
rg -q 'BrowserAutomationSupport' "$ROOT/Sources/main.swift"
rg -q 'NSAppleScript' "$ROOT/Sources/BrowserAutomationSupport.swift"
rg -q 'browserFocusScript' "$ROOT/Sources/BrowserAutomationSupport.swift"
plutil -extract NSAppleEventsUsageDescription raw "$ROOT/Resources/Info.plist" | grep -q '定位并打开已存在的 Deepseek Harness'
rg -Fq 'BrowserConnectionTests' "$ROOT/scripts/test-browser-connection.swift"
xcrun swiftc -o /tmp/dsh-test-browser-connection "$ROOT/Sources/BrowserConnectionSupport.swift" "$ROOT/Sources/BrowserAutomationSupport.swift" "$ROOT/scripts/test-browser-connection.swift" -framework AppKit
/tmp/dsh-test-browser-connection
rg -q -- '--registry' "$ROOT/Sources/DSHRuntimeSupport.swift"
if rg -q 'npx --prefer-offline --yes @deepseek-ai/dsh' "$ROOT/Sources/main.swift" "$ROOT/Sources/DSHUpdateSupport.swift"; then
  echo "launcher must not bootstrap dsh through npx" >&2
  exit 1
fi
rg -q 'npm_config_legacy_peer_deps.*false' "$ROOT/Sources/LauncherEnvironment.swift"
rg -q 'npm_config_fetch_retries' "$ROOT/Sources/LauncherEnvironment.swift"
# First-install memory budget: fetch concurrency is capped at 16 and npm's V8
# heap ceiling is bounded (see npmMaxOldSpaceSizeMB) so a fresh dsh install
# stays far below the ~3GB peak that unbounded settings produced.
rg -q 'npm_config_maxsockets.*"16"' "$ROOT/Sources/LauncherEnvironment.swift"
if rg -q 'npm_config_maxsockets.*"50"' "$ROOT/Sources/LauncherEnvironment.swift"; then
  echo "npm fetch concurrency must stay at 16 for the first-install memory budget" >&2
  exit 1
fi
rg -q 'npmMaxOldSpaceSizeMB' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'appendCapturedOutput' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'maxCapturedOutputBytes' "$ROOT/Sources/DSHRuntimeSupport.swift"
# Lockfile-based first install: the bundled dsh-runtime spec must exist, the
# install path must switch to `npm ci` when it is present, and build scripts
# must ship it inside the app bundle.
test -s "$ROOT/Resources/dsh-runtime/package.json"
test -s "$ROOT/Resources/dsh-runtime/package-lock.json"
rg -q 'bundledRuntimeSpec' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q '"ci", "--prefix"' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'Resources/dsh-runtime' "$ROOT/scripts/build-app.sh" "$ROOT/scripts/build-universal.sh"
if [[ "$(rg -c -- '--no-package-lock' "$ROOT/Sources/DSHRuntimeSupport.swift")" != "1" ]]; then
  echo "--no-package-lock must only appear once, on the fallback (no bundled spec) install path" >&2
  exit 1
fi
# Irregular-update path: version mismatch must drive a forced lockfile reinstall
rg -q 'needsRuntimeUpgrade' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'bundledDSHVersion' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'installedDSHVersion' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'force: isUpgrade' "$ROOT/Sources/main.swift"
rg -q 'DSHInstallMode' "$ROOT/Sources/main.swift"
rg -q 'hasHarnessInstall' "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/main.swift"
rg -q 'case firstInstall, upgrade, repair' "$ROOT/Sources/main.swift"
rg -Fq '检测到已有 DeepSeek Harness 安装' "$ROOT/Sources/main.swift"
rg -Fq '不影响你的会话、归档与插件数据' "$ROOT/Sources/main.swift"
if rg -q 'npm_config_progress.*false|--progress=false' "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/LauncherEnvironment.swift"; then
  echo "npm installation progress must remain enabled" >&2
  exit 1
fi
rg -q '启动超过 10 分钟' "$ROOT/Sources/main.swift"
rg -q 'DSHRuntimeSupport.isInstalled' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -q 'runtime.installing-' "$ROOT/Sources/main.swift" "$ROOT/scripts/install-from-app.sh" "$ROOT/scripts/uninstall.sh"
rg -q '正在安装 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -q '"web",' "$ROOT/Sources/main.swift"
rg -Fq 'npx @deepseek-ai/dsh web' "$ROOT/Sources/main.swift" "$ROOT/README.md"
if rg -q 'func applicationWillTerminate' "$ROOT/Sources/main.swift"; then
  echo "launcher exit must not synchronously stop the Harness backend" >&2
  exit 1
fi
rg -q 'menu\.showsStateColumn = false' "$ROOT/Sources/main.swift"
rg -q 'item\.offStateImage = nil' "$ROOT/Sources/main.swift"
rg -q 'let settingsItem = makeSettingsMenuItem()' "$ROOT/Sources/main.swift"
rg -Fq 'menuRowItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")' "$ROOT/Sources/main.swift"
rg -Fq 'keyEquivalent: ","' "$ROOT/Sources/main.swift"
rg -Fq 'keyEquivalentModifierMask = keyEquivalent.isEmpty ? [] : [.command]' "$ROOT/Sources/main.swift"
rg -Fq 'RegisterEventHotKey' "$ROOT/Sources/GlobalHotKey.swift"
rg -Fq '"view", "@deepseek-ai/dsh", "version"' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'scheduleDSHUpdateCheck' "$ROOT/Sources/main.swift"
rg -Fq 'ServiceProbe.body' "$ROOT/Sources/main.swift"
rg -Fq 'nodeEnvironment' "$ROOT/Sources/LauncherEnvironment.swift"
rg -Fq '检查 Deepseek Harness 更新' "$ROOT/Sources/main.swift"
# dsh 更新检查：npm dist-tags + GitHub Release 双来源（npm 的 latest 常落后于刚发的
# Release），是否安装由用户决定（更新/稍后/跳过此版本），跳过会被记住。
rg -Fq '["view", "@deepseek-ai/dsh", "dist-tags", "versions", "--json"]' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'deepseek-ai/deepseek-harness/releases.atom' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'compareDSHVersions' "$ROOT/Sources/DSHUpdateSupport.swift" "$ROOT/scripts/test-dsh-version-support.swift"
rg -Fq 'DSHUpdatePlanner.shouldAnnounce' "$ROOT/Sources/main.swift"
rg -Fq 'if interactive { presentDSHUpdate(report: report) }' "$ROOT/Sources/main.swift"
rg -Fq '跳过此版本' "$ROOT/Sources/main.swift"
rg -Fq 'skippedDSHVersion' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateSupport.swift"
# 多个新版本时让用户挑：下拉列出全部比当前新的候选，切换时刷新说明与按钮。
rg -Fq 'DSHUpdatePlanner.selectableUpdates' "$ROOT/Sources/main.swift" "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'NSPopUpButton' "$ROOT/Sources/DSHUpdateVersionPicker.swift"
rg -Fq 'DSHUpdateVersionPicker(' "$ROOT/Sources/main.swift"
# 提示框统一外观：SF Symbol 语气图标 + 圆角信息卡，正文不堆细节。
rg -Fq 'AlertDesign.style' "$ROOT/Sources/main.swift"
rg -Fq 'AlertDesign.accessory' "$ROOT/Sources/main.swift"
rg -Fq 'AlertDesign.card' "$ROOT/Sources/main.swift"
rg -Fq 'NSImage.SymbolConfiguration' "$ROOT/Sources/AlertDesign.swift"
rg -Fq 'cornerCurve = .continuous' "$ROOT/Sources/AlertDesign.swift"
# 会话完成提醒按会话计数：同一会话连跑多轮不能把角标数字刷高。
rg -Fq 'events.removeAll { $0.sessionId == event.sessionId }' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq '个会话未读' "$ROOT/Sources/main.swift"
rg -Fq 'sessionLabelFromId' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
# 排队消息场景：被打断的回合不算完成；新一轮开始（turn/start）要撤销该会话的未读提醒。
rg -Fq "if (reason === 'aborted') return null;" "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'summarizeTurnStart' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq "kind: 'resumed'" "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'event.isResume' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq '已撤销其完成提醒' "$ROOT/Sources/main.swift"
rg -Fq 'snapshotEvents' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'selectableUpdates' "$ROOT/scripts/test-dsh-version-support.swift"
# 自动检查只改菜单标题：不得出现「检查完直接安装」的路径。
if rg -q 'applyDSHUpdateReport.*updateDSHNow|performDSHUpdateCheck.*updateDSHNow' "$ROOT/Sources/main.swift"; then
  echo "dsh updates must never install without the user choosing Update" >&2
  exit 1
fi
rg -Fq 'npm dist-tags' "$ROOT/README.md" "$ROOT/README.en.md"
if rg -Fq 'dsh 检查只比较 npm 最新版本' "$ROOT/README.md"; then
  echo "README must document the dual-source dsh update check" >&2
  exit 1
fi
rg -Fq 'globalHotKeyEnabled' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq '请按下快捷键' "$ROOT/Sources/SettingsWindowController.swift"
rg -Fq 'globalHotKeyManager' "$ROOT/Sources/main.swift"
if rg -q 'SettingsMenuItemView' "$ROOT/Sources/main.swift"; then
  echo "legacy settings-only menu view must be removed" >&2
  exit 1
fi
if rg -q '"web", "--no-open".*"--patch"' "$ROOT/Sources/main.swift"; then
  echo "invalid Harness argument order" >&2
  exit 1
fi
mkdir -p "$ROOT/build"
swiftc "$ROOT/scripts/test-update-support.swift" "$ROOT/Sources/UpdateSupport.swift" -o "$ROOT/build/test-update-support"
"$ROOT/build/test-update-support"
swiftc "$ROOT/scripts/test-plugin-compatibility.swift" "$ROOT/Sources/PluginCompatibilitySupport.swift" "$ROOT/Sources/UpdateSupport.swift" -o "$ROOT/build/test-plugin-compatibility"
"$ROOT/build/test-plugin-compatibility"
swiftc "$ROOT/scripts/test-release-notes.swift" "$ROOT/Sources/ReleaseNotesSupport.swift" -o "$ROOT/build/test-release-notes"
"$ROOT/build/test-release-notes"
swiftc "$ROOT/scripts/test-session-notify.swift" "$ROOT/Sources/SessionNotifySupport.swift" -o "$ROOT/build/test-session-notify"
swiftc "$ROOT/scripts/test-plugin-updates.swift" "$ROOT/Sources/PluginUpdateSupport.swift" -o "$ROOT/build/test-plugin-updates"
"$ROOT/build/test-plugin-updates"
"$ROOT/build/test-session-notify"
# 提示框外观与版本选择器：纯 AppKit 视图，直接构造/量尺寸/触发动作来断言。
swiftc "$ROOT/scripts/test-alert-design.swift" "$ROOT/Sources/AlertDesign.swift" "$ROOT/Sources/DSHUpdateVersionPicker.swift" "$ROOT/Sources/ReleaseNotesSupport.swift" "$ROOT/Sources/DSHUpdateSupport.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/LauncherEnvironment.swift" "$ROOT/Sources/DSHRuntimeSupport.swift" -o "$ROOT/build/test-alert-design" -framework AppKit
"$ROOT/build/test-alert-design"
swiftc "$ROOT/scripts/test-launcher-support.swift" "$ROOT/Sources/ArchivePluginSupport.swift" "$ROOT/Sources/LogSupport.swift" -o "$ROOT/build/test-launcher-support"
"$ROOT/build/test-launcher-support"
swiftc "$ROOT/scripts/test-global-hotkey.swift" "$ROOT/Sources/GlobalHotKey.swift" -o "$ROOT/build/test-global-hotkey"
"$ROOT/build/test-global-hotkey"
swiftc "$ROOT/scripts/test-dsh-version-support.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/LauncherEnvironment.swift" "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/DSHUpdateSupport.swift" -o "$ROOT/build/test-dsh-version-support"
"$ROOT/build/test-dsh-version-support"
swiftc "$ROOT/scripts/test-dsh-install-progress.swift" "$ROOT/Sources/DSHInstallProgress.swift" -o "$ROOT/build/test-dsh-install-progress"
"$ROOT/build/test-dsh-install-progress"
swiftc "$ROOT/scripts/test-dsh-runtime-support.swift" "$ROOT/Sources/LauncherEnvironment.swift" "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/DSHUpdateSupport.swift" "$ROOT/Sources/UpdateSupport.swift" -o "$ROOT/build/test-dsh-runtime-support"
RUNTIME_TEST_HOME="$(mktemp -d /tmp/dsh-runtime-home.XXXXXX)"
# macOS ignores the HOME env var for NSHomeDirectory(); DSHRuntimeSupport honors
# DSH_HOME, so use it to isolate the runtime tests from the real ~/.dsh.
DSH_HOME="$RUNTIME_TEST_HOME" "$ROOT/build/test-dsh-runtime-support"
find "$RUNTIME_TEST_HOME" -depth -type f -delete 2>/dev/null || true
find "$RUNTIME_TEST_HOME" -depth -type l -delete 2>/dev/null || true
find "$RUNTIME_TEST_HOME" -depth -type d -empty -delete 2>/dev/null || true
"$ROOT/scripts/build-app.sh" >/dev/null
test -x "$ROOT/build/Deepseek Harness Launcher.app/Contents/MacOS/DHL"
plutil -extract CFBundleDisplayName raw "$ROOT/build/Deepseek Harness Launcher.app/Contents/Info.plist" | grep -qx 'Deepseek Harness Launcher'
test -f "$ROOT/build/Deepseek Harness Launcher.app/Contents/Resources/DHL.icns"
test -x "$ROOT/build/Deepseek Harness Launcher.app/Contents/Resources/install-from-app.sh"
"$ROOT/scripts/build-universal.sh" >/dev/null
lipo -info "$ROOT/build/Deepseek Harness Launcher.app/Contents/MacOS/DHL" | grep -q 'x86_64.*arm64\|arm64.*x86_64'
test -f "$ROOT/build/Deepseek Harness Launcher.app/Contents/Resources/menubar-creature.png"
codesign --verify --deep --strict "$ROOT/build/Deepseek Harness Launcher.app"
"$ROOT/scripts/build-installer-app.sh" >/dev/null
test -x "$ROOT/build/双击完成安装或更新.app/Contents/MacOS/DHLInstaller"
test -x "$ROOT/build/双击完成安装或更新.app/Contents/Resources/install-from-app.sh"
test -d "$ROOT/build/双击完成安装或更新.app/Contents/Resources/Deepseek Harness Launcher.app"
lipo -info "$ROOT/build/双击完成安装或更新.app/Contents/MacOS/DHLInstaller" | grep -q 'x86_64.*arm64\|arm64.*x86_64'
codesign --verify --deep --strict "$ROOT/build/双击完成安装或更新.app"
rg -Fq 'appendingPathComponent(".Deepseek Harness Launcher-payload.app")' "$ROOT/Installer/main.swift"
rg -Fq 'cp -R "$ROOT/build/Deepseek Harness Launcher.app" "$STAGE/.Deepseek Harness Launcher-payload.app"' "$ROOT/scripts/build-dmg.sh"
if rg -Fq 'ln -s /Applications' "$ROOT/scripts/build-dmg.sh"; then
  echo "DMG must expose only the installation entry" >&2
  exit 1
fi
"$ROOT/scripts/build-dmg.sh" >/dev/null
test -s "$ROOT/dist/Deepseek Harness Launcher.dmg"
hdiutil verify "$ROOT/dist/Deepseek Harness Launcher.dmg" >/dev/null
echo "Deepseek Harness Launcher regression checks passed"
