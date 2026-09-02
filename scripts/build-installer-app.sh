#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/双击完成安装或更新.app"
SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"
[[ -n "$SDK" ]] || SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
swiftc "$ROOT/Installer/main.swift" -o "$ROOT/build/DHLInstaller-arm64" -sdk "$SDK" -target arm64-apple-macos12.0
swiftc "$ROOT/Installer/main.swift" -o "$ROOT/build/DHLInstaller-x86_64" -sdk "$SDK" -target x86_64-apple-macos12.0
lipo -create "$ROOT/build/DHLInstaller-arm64" "$ROOT/build/DHLInstaller-x86_64" -output "$OUT/Contents/MacOS/DHLInstaller"
cp "$ROOT/Resources/InstallerInfo.plist" "$OUT/Contents/Info.plist"
cp "$ROOT/scripts/install-from-app.sh" "$OUT/Contents/Resources/install-from-app.sh"
cp "$ROOT/build/Deepseek Harness Launcher.app/Contents/Resources/DHL.icns" "$OUT/Contents/Resources/DHL.icns"
cp -R "$ROOT/build/Deepseek Harness Launcher.app" "$OUT/Contents/Resources/Deepseek Harness Launcher.app"
chmod +x "$OUT/Contents/MacOS/DHLInstaller" "$OUT/Contents/Resources/install-from-app.sh"
rm -f "$ROOT/build/DHLInstaller-arm64" "$ROOT/build/DHLInstaller-x86_64"
plutil -lint "$OUT/Contents/Info.plist" >/dev/null
lipo -info "$OUT/Contents/MacOS/DHLInstaller"
codesign --force --deep --sign - "$OUT"
echo "Built $OUT (Universal 2)"
