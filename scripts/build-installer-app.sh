#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/双击完成安装或更新.app"
SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"
[[ -n "$SDK" ]] || SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
source "$ROOT/scripts/swift-slice.sh"
# 安装器是独立编译目标，链不了 Sources/AlertDesign.swift（它依赖发布通道等 App 侧
# 类型），但必须链 Sources/AlertBoundary.swift：失败弹窗的正文来自 shell 输出，
# 没有那套「长正文转可滚动面板 + Esc + 屏幕预算」护栏时，它会撑成比屏幕还高的
# 窗口，而安装器主窗口没有关闭按钮，用户只能强杀。
build_swift_slice "$SDK" arm64-apple-macos12.0 "$ROOT/build/DHLInstaller-arm64" "$ROOT/Installer/main.swift" "$ROOT/Sources/AlertBoundary.swift"
build_swift_slice "$SDK" x86_64-apple-macos12.0 "$ROOT/build/DHLInstaller-x86_64" "$ROOT/Installer/main.swift" "$ROOT/Sources/AlertBoundary.swift"
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
