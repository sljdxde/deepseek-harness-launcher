#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --check "$ROOT/Plugins/DSHArchiveManager/lib/index.js"
node --check "$ROOT/Plugins/DSHArchiveManager/client/client.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/running-session-ids.test.js"
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
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-manager.integration.test.js"
if rg -q 'npx |git clone|github.com' "$ROOT/Plugins/DSHPluginManager/lib/index.js" >/dev/null && ! rg -q 'installCandidates|git\+' "$ROOT/Plugins/DSHPluginManager/lib/index.js"; then
  echo "plugin manager must expose npm-first / git-fallback install candidates" >&2
  exit 1
fi
rg -q 'dsh-plugin-manager' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -q 'sidebar.footer.action' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -q "register\([^\n]*PluginTrigger" "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -q '/dsh-plugin-manager/installed' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/marketplace' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/install' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/uninstall' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
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
rg -q 'ReleaseNotesMarkdown.attributedString' "$ROOT/Sources/main.swift"
rg -q 'UpdateDownloadWindowController' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateDownloadWindowController.swift"
rg -q 'UpdateDownloadProgress' "$ROOT/Sources/UpdateSupport.swift"
rg -q 'miniaturizable' "$ROOT/Sources/UpdateDownloadWindowController.swift"
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
rg -Fq '重启 dsh' "$ROOT/Sources/main.swift"
rg -q 'restartDSH' "$ROOT/Sources/main.swift"
rg -q 'stopDHL \{' "$ROOT/Sources/main.swift"
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
rg -q '正在安装 dsh' "$ROOT/Sources/main.swift"
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
rg -Fq '检查 dsh 更新' "$ROOT/Sources/main.swift"
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
swiftc "$ROOT/scripts/test-release-notes.swift" "$ROOT/Sources/ReleaseNotesSupport.swift" -o "$ROOT/build/test-release-notes"
"$ROOT/build/test-release-notes"
swiftc "$ROOT/scripts/test-session-notify.swift" "$ROOT/Sources/SessionNotifySupport.swift" -o "$ROOT/build/test-session-notify"
"$ROOT/build/test-session-notify"
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
