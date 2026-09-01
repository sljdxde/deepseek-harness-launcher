#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}"

"$ROOT/scripts/build-universal.sh"
exec "$ROOT/scripts/install-from-app.sh" "$ROOT/build/Deepseek Harness Launcher.app" "$DEST"
