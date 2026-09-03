#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/build/Deepseek Harness Launcher.app"
SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"; [[ -n "$SDK" ]] || SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
rm -rf "$ROOT/build"; mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
swiftc "$ROOT"/Sources/*.swift -o "$ROOT/build/DHL-arm64" -sdk "$SDK" -target arm64-apple-macos12.0
swiftc "$ROOT"/Sources/*.swift -o "$ROOT/build/DHL-x86_64" -sdk "$SDK" -target x86_64-apple-macos12.0
lipo -create "$ROOT/build/DHL-arm64" "$ROOT/build/DHL-x86_64" -output "$OUT/Contents/MacOS/DHL"
cp "$ROOT/Resources/Info.plist" "$OUT/Contents/Info.plist"; chmod +x "$OUT/Contents/MacOS/DHL"
cp -R "$ROOT/Plugins/DSHArchiveManager" "$OUT/Contents/Resources/DSHArchiveManager"
cp -R "$ROOT/Resources/dsh-runtime" "$OUT/Contents/Resources/dsh-runtime"
cp "$ROOT/scripts/install-from-app.sh" "$OUT/Contents/Resources/install-from-app.sh"; chmod +x "$OUT/Contents/Resources/install-from-app.sh"
cp "$ROOT/Resources/menubar-creature.png" "$OUT/Contents/Resources/menubar-creature.png"
"$ROOT/scripts/install-icon.sh" "$OUT"
codesign --force --deep --sign - "$OUT"
rm -f "$ROOT/build/DHL-arm64" "$ROOT/build/DHL-x86_64"; lipo -info "$OUT/Contents/MacOS/DHL"; echo "Built $OUT (Universal 2)"
