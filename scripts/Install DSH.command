#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="${DSH_INSTALL_DIR:-}"

if [[ -z "$DEST" ]]; then
  if [[ -d /Applications/DSH.app || -w /Applications ]]; then
    DEST=/Applications
  else
    DEST="$HOME/Applications"
  fi
fi

if [[ ! -w "$DEST" && ! -w "$(dirname "$DEST")" ]]; then
  exec osascript -e "do shell script \"$(printf '%q ' \"$SCRIPT_DIR/.install-from-app.sh\" \"$SCRIPT_DIR/DSH.app\" \"$DEST\")\" with administrator privileges"
fi

exec "$SCRIPT_DIR/.install-from-app.sh" "$SCRIPT_DIR/DSH.app" "$DEST"
