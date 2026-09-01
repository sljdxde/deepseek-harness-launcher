#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/build/DSH.app"
SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"; [[ -n "$SDK" ]] || SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
rm -rf "$ROOT/build"; mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
swiftc "$ROOT"/Sources/*.swift -o "$ROOT/build/DSH-arm64" -sdk "$SDK" -target arm64-apple-macos12.0
swiftc "$ROOT"/Sources/*.swift -o "$ROOT/build/DSH-x86_64" -sdk "$SDK" -target x86_64-apple-macos12.0
lipo -create "$ROOT/build/DSH-arm64" "$ROOT/build/DSH-x86_64" -output "$OUT/Contents/MacOS/DSH"
cp "$ROOT/Resources/Info.plist" "$OUT/Contents/Info.plist"; chmod +x "$OUT/Contents/MacOS/DSH"
cp -R "$ROOT/Plugins/DSHArchiveManager" "$OUT/Contents/Resources/DSHArchiveManager"
cp "$ROOT/scripts/install-from-app.sh" "$OUT/Contents/Resources/install-from-app.sh"; chmod +x "$OUT/Contents/Resources/install-from-app.sh"
cp "$ROOT/Resources/menubar-creature.png" "$OUT/Contents/Resources/menubar-creature.png"
"$ROOT/scripts/install-icon.sh" "$OUT"
rm -f "$ROOT/build/DSH-arm64" "$ROOT/build/DSH-x86_64"; lipo -info "$OUT/Contents/MacOS/DSH"; echo "Built $OUT (Universal 2)"
