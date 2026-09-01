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
rg -q "return \{ inject: \['slots', 'locale'\], apply \}" "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q 'dsh-archive-select-all' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q 'selectAllRef\.current\.indeterminate' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
plutil -lint "$ROOT/Resources/Info.plist"
plutil -extract CFBundleShortVersionString raw "$ROOT/Resources/Info.plist" | grep -qx '0.1.0'
zsh -n "$ROOT/scripts/install.sh"
zsh -n "$ROOT/scripts/install-from-app.sh"
zsh -n "$ROOT/scripts/Install DSH.command"
zsh -n "$ROOT/scripts/build-installer-app.sh"
zsh -n "$ROOT/scripts/build-dmg.sh"
"$ROOT/scripts/test-installer.sh"
rg -q 'signal_processes launcher_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'signal_processes dsh_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'wait_for_processes launcher_pids' "$ROOT/scripts/install-from-app.sh"
rg -q 'Previous app backup' "$ROOT/scripts/install-from-app.sh"
rg -q 'DSH_SKIP_BUNDLE_QUIT' "$ROOT/scripts/install-from-app.sh"
rg -q '"--profile", "web"' "$ROOT/Sources/main.swift"
if rg -q 'func applicationWillTerminate' "$ROOT/Sources/main.swift"; then
  echo "launcher exit must not synchronously stop the DSH backend" >&2
  exit 1
fi
rg -q 'menu\.showsStateColumn = false' "$ROOT/Sources/main.swift"
rg -q 'item\.offStateImage = nil' "$ROOT/Sources/main.swift"
rg -q 'let settingsItem = makeSettingsMenuItem()' "$ROOT/Sources/main.swift"
rg -q 'private final class SettingsMenuItemView: NSView' "$ROOT/Sources/main.swift"
rg -Fq 'NSPoint(x: 0' "$ROOT/Sources/main.swift"
rg -Fq 'private let shortcut = "⌘,"' "$ROOT/Sources/main.swift"
rg -Fq 'keyEquivalent: ","' "$ROOT/Sources/main.swift"
rg -Fq 'item.keyEquivalentModifierMask = [.command]' "$ROOT/Sources/main.swift"
if rg -Fq 'plainMenuItem(title: "设置…"' "$ROOT/Sources/main.swift"; then
  echo "settings must use the icon-free custom menu row" >&2
  exit 1
fi
if rg -q '"web", "--no-open".*"--patch"' "$ROOT/Sources/main.swift"; then
  echo "invalid DSH argument order" >&2
  exit 1
fi
mkdir -p "$ROOT/build"
swiftc "$ROOT/scripts/test-update-support.swift" "$ROOT/Sources/UpdateSupport.swift" -o "$ROOT/build/test-update-support"
"$ROOT/build/test-update-support"
"$ROOT/scripts/build-app.sh" >/dev/null
test -x "$ROOT/build/DSH.app/Contents/MacOS/DSH"
test -f "$ROOT/build/DSH.app/Contents/Resources/DSH.icns"
test -x "$ROOT/build/DSH.app/Contents/Resources/install-from-app.sh"
"$ROOT/scripts/build-universal.sh" >/dev/null
lipo -info "$ROOT/build/DSH.app/Contents/MacOS/DSH" | grep -q 'x86_64.*arm64\|arm64.*x86_64'
test -f "$ROOT/build/DSH.app/Contents/Resources/menubar-creature.png"
"$ROOT/scripts/build-installer-app.sh" >/dev/null
test -x "$ROOT/build/双击完成安装或更新.app/Contents/MacOS/DSHInstaller"
test -x "$ROOT/build/双击完成安装或更新.app/Contents/Resources/install-from-app.sh"
lipo -info "$ROOT/build/双击完成安装或更新.app/Contents/MacOS/DSHInstaller" | grep -q 'x86_64.*arm64\|arm64.*x86_64'
rg -Fq 'appendingPathComponent(".DSH-payload.app")' "$ROOT/Installer/main.swift"
rg -Fq 'cp -R "$ROOT/build/DSH.app" "$STAGE/.DSH-payload.app"' "$ROOT/scripts/build-dmg.sh"
if rg -Fq 'ln -s /Applications' "$ROOT/scripts/build-dmg.sh"; then
  echo "DMG must expose only the installation entry" >&2
  exit 1
fi
echo "DSH launcher checks passed"
