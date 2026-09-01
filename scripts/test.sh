#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --check "$ROOT/Plugins/DSHArchiveManager/lib/index.js"
node --check "$ROOT/Plugins/DSHArchiveManager/client/client.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/running-session-ids.test.js"
if rg -q 'stopRunningAgents|需要二次确认删除|只能删除已归档' "$ROOT/Plugins/DSHArchiveManager/lib/index.js"; then
  echo "archive deletion must not perform runtime or archive-state validation" >&2
  exit 1
fi
rg -Fq 'body: JSON.stringify({ sessionIds: confirmIds })' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q 'window.isOpaque = true' "$ROOT/Sources/SettingsWindowController.swift"
rg -q 'visualEffect.blendingMode = .withinWindow' "$ROOT/Sources/SettingsWindowController.swift"
rg -q 'checkbox.contentTintColor = .labelColor' "$ROOT/Sources/SettingsWindowController.swift"
if rg -q 'feedField|updateFeedURL|更新清单' "$ROOT/Sources/SettingsWindowController.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/main.swift"; then
  echo "update source must be fixed to GitHub Releases" >&2
  exit 1
fi
rg -Fq 'sljdxde/deepseek-harness-launcher' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'api.github.com/repos' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'Deepseek Harness Launcher.dmg' "$ROOT/Sources/UpdateSupport.swift"
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
plutil -extract CFBundleShortVersionString raw "$ROOT/Resources/Info.plist" | grep -qx '0.1.0'
rg -Fq '正在安装 DHL' "$ROOT/Installer/main.swift"
rg -Fq '已更新，正在重新启动 DHL' "$ROOT/Installer/main.swift"
zsh -n "$ROOT/scripts/install.sh"
zsh -n "$ROOT/scripts/install-from-app.sh"
zsh -n "$ROOT/scripts/uninstall.sh"
rg -q "cleanup_legacy_volumes" "$ROOT/scripts/uninstall.sh"
rg -q "unregister_legacy_paths" "$ROOT/scripts/uninstall.sh" "$ROOT/scripts/install-from-app.sh"
rg -q "remove_backups" "$ROOT/scripts/uninstall.sh"
rg -q "prune_backups" "$ROOT/scripts/install-from-app.sh"
rg -q "xattr -dr com.apple.quarantine" "$ROOT/scripts/install-from-app.sh"
zsh -n "$ROOT/scripts/Install DHL.command"
zsh -n "$ROOT/scripts/build-installer-app.sh"
zsh -n "$ROOT/scripts/build-dmg.sh"
"$ROOT/scripts/test-installer.sh"
rg -q 'signal_processes launcher_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'signal_processes dsh_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'wait_for_processes launcher_pids' "$ROOT/scripts/install-from-app.sh"
rg -q 'Previous app backup' "$ROOT/scripts/install-from-app.sh"
rg -q 'DHL_SKIP_BUNDLE_QUIT' "$ROOT/scripts/install-from-app.sh"
rg -q 'ensureArchivePluginLink' "$ROOT/Sources/main.swift"
rg -q '"--profile", "web"' "$ROOT/Sources/main.swift"
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
swiftc "$ROOT/scripts/test-launcher-support.swift" "$ROOT/Sources/ArchivePluginSupport.swift" "$ROOT/Sources/LogSupport.swift" -o "$ROOT/build/test-launcher-support"
"$ROOT/build/test-launcher-support"
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
lipo -info "$ROOT/build/双击完成安装或更新.app/Contents/MacOS/DHLInstaller" | grep -q 'x86_64.*arm64\|arm64.*x86_64'
codesign --verify --deep --strict "$ROOT/build/双击完成安装或更新.app"
rg -Fq 'appendingPathComponent(".Deepseek Harness Launcher-payload.app")' "$ROOT/Installer/main.swift"
rg -Fq 'cp -R "$ROOT/build/Deepseek Harness Launcher.app" "$STAGE/.Deepseek Harness Launcher-payload.app"' "$ROOT/scripts/build-dmg.sh"
if rg -Fq 'ln -s /Applications' "$ROOT/scripts/build-dmg.sh"; then
  echo "DMG must expose only the installation entry" >&2
  exit 1
fi
echo "Deepseek Harness Launcher checks passed"
