#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; "$ROOT/scripts/build-universal.sh"; "$ROOT/scripts/build-installer-app.sh"
STAGE="$ROOT/build/dmg-stage"; rm -rf "$STAGE" "$ROOT/dist"; mkdir -p "$STAGE"; cp -R "$ROOT/build/Deepseek Harness Launcher.app" "$STAGE/.Deepseek Harness Launcher-payload.app"; cp -R "$ROOT/build/双击完成安装或更新.app" "$STAGE/双击完成安装或更新.app"
codesign --force --deep --sign - "$STAGE/.Deepseek Harness Launcher-payload.app" "$STAGE/双击完成安装或更新.app"
mkdir -p "$ROOT/dist"
hdiutil create -volname "Deepseek Harness Launcher" -srcfolder "$STAGE" -ov -format UDZO "$ROOT/dist/Deepseek Harness Launcher.dmg"; echo "Created $ROOT/dist/Deepseek Harness Launcher.dmg"
