#!/bin/zsh
set -euo pipefail
for path in "${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}/DHL.app" "$HOME/Applications/DHL.app" "/Applications/DHL.app" "$HOME/Applications/DSH.app" "/Applications/DSH.app"; do
  if [[ -d "$path" ]]; then rm -rf "$path"; echo "Removed $path"; fi
done
PLUGIN_LINK="$HOME/.dsh/profiles/web/node_modules/dsh-archive-manager"
if [[ -L "$PLUGIN_LINK" ]]; then
  TARGET="$(readlink "$PLUGIN_LINK" || true)"
  if [[ "$TARGET" == *"DSHArchiveManager"* ]]; then rm -f "$PLUGIN_LINK"; echo "Removed plugin link $PLUGIN_LINK"; fi
fi
echo "Deepseek Harness Launcher 的 ~/.dsh 数据保持不变。"
