#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/build/DHL.app"
SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"; [[ -n "$SDK" ]] || SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
rm -rf "$ROOT/build"; mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
swiftc "$ROOT"/Sources/*.swift -o "$OUT/Contents/MacOS/DHL" -sdk "$SDK" -target arm64-apple-macos12.0
cp "$ROOT/Resources/Info.plist" "$OUT/Contents/Info.plist"; chmod +x "$OUT/Contents/MacOS/DHL"
cp -R "$ROOT/Plugins/DSHArchiveManager" "$OUT/Contents/Resources/DSHArchiveManager"
cp "$ROOT/scripts/install-from-app.sh" "$OUT/Contents/Resources/install-from-app.sh"; chmod +x "$OUT/Contents/Resources/install-from-app.sh"
cp "$ROOT/Resources/menubar-creature.png" "$OUT/Contents/Resources/menubar-creature.png"
"$ROOT/scripts/install-icon.sh" "$OUT"
echo "Built $OUT (arm64; use build-universal.sh for Universal 2)"
