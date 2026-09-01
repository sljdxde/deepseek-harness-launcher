#!/bin/zsh
# 把图标装进 App Bundle。
#
# 优先使用 Resources/icons/<candidate>/DSH.icns（AI 设计稿生成的成品图标），
# 找不到才回退到 scripts/generate-icon.swift 的 Swift 矢量绘制版本。
#
# 用法:
#   scripts/install-icon.sh <App路径>
#   DSH_ICON=candidate-B scripts/install-icon.sh build/DSH.app
#
# 切换图标:
#   ln -sfn candidate-B Resources/icons/current     # 改默认
#   DSH_ICON=candidate-C ./scripts/build-app.sh     # 或临时指定
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$1"
[[ -n "$APP" ]] || { echo "用法: $0 <App路径>" >&2; exit 1; }

RES="$APP/Contents/Resources"
mkdir -p "$RES"

PICK="${DSH_ICON:-current}"
CANDIDATE="$ROOT/Resources/icons/$PICK/DSH.icns"

if [[ -f "$CANDIDATE" ]]; then
  cp "$CANDIDATE" "$RES/DSH.icns"
  echo "Icon: Resources/icons/$PICK/DSH.icns"
else
  ICONSET="$(mktemp -d)/DSH.iconset"
  swift "$ROOT/scripts/generate-icon.swift" "$ICONSET"
  iconutil -c icns "$ICONSET" -o "$RES/DSH.icns"
  echo "Icon: fallback -> generate-icon.swift (矢量绘制)"
fi

/usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string DSH' "$APP/Contents/Info.plist" 2>/dev/null || true
