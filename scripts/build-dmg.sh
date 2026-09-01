#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; "$ROOT/scripts/build-universal.sh"; "$ROOT/scripts/build-installer-app.sh"
STAGE="$ROOT/build/dmg-stage"; rm -rf "$STAGE" "$ROOT/dist"; mkdir -p "$STAGE"; cp -R "$ROOT/build/DHL.app" "$STAGE/.DHL-payload.app"; cp -R "$ROOT/build/双击完成安装或更新.app" "$STAGE/双击完成安装或更新.app"
mkdir -p "$ROOT/dist"
hdiutil create -volname "DHL" -srcfolder "$STAGE" -ov -format UDZO "$ROOT/dist/DHL.dmg"; echo "Created $ROOT/dist/DHL.dmg"
