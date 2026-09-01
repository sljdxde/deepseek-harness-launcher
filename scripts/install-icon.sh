#!/bin/zsh
# 把图标装进 App Bundle。
#
# 使用 Resources/icons/<candidate>/DHL.icns 中的已审核图标资产。
#
# 用法:
#   scripts/install-icon.sh <App路径>
#   DHL_ICON=candidate-D scripts/install-icon.sh "build/Deepseek Harness Launcher.app"
#
# 切换图标:
#   ln -sfn candidate-upstream Resources/icons/current # 改默认
#   DHL_ICON=candidate-A ./scripts/build-app.sh        # 或临时指定
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$1"
[[ -n "$APP" ]] || { echo "用法: $0 <App路径>" >&2; exit 1; }

RES="$APP/Contents/Resources"
mkdir -p "$RES"

PICK="${DHL_ICON:-${DSH_ICON:-current}}"
CANDIDATE="$ROOT/Resources/icons/$PICK/DHL.icns"

if [[ -f "$CANDIDATE" ]]; then
  cp "$CANDIDATE" "$RES/DHL.icns"
  echo "Icon: Resources/icons/$PICK/DHL.icns"
else
  echo "Icon asset not found: Resources/icons/$PICK/DHL.icns" >&2
  echo "Choose a valid DHL_ICON or restore Resources/icons/current." >&2
  exit 1
fi

/usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string DHL' "$APP/Contents/Info.plist" 2>/dev/null || true
