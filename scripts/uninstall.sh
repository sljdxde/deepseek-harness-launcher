#!/bin/zsh
set -euo pipefail
for path in "${DSH_INSTALL_DIR:-$HOME/Applications}/DSH.app" "$HOME/Applications/DSH.app" "/Applications/DSH.app"; do
  if [[ -d "$path" ]]; then rm -rf "$path"; echo "Removed $path"; fi
done
PLUGIN_LINK="$HOME/.dsh/profiles/web/node_modules/dsh-archive-manager"
if [[ -L "$PLUGIN_LINK" ]]; then
  TARGET="$(readlink "$PLUGIN_LINK" || true)"
  if [[ "$TARGET" == *"DSHArchiveManager"* ]]; then rm -f "$PLUGIN_LINK"; echo "Removed plugin link $PLUGIN_LINK"; fi
fi
echo "DSH data under ~/.dsh was left untouched."
