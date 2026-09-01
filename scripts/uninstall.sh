#!/bin/zsh
set -euo pipefail

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
CANDIDATE_DIRS=(
  "${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}"
  "$HOME/Applications"
  "/Applications"
)

cleanup_legacy_volumes() {
  local volume
  for volume in /Volumes/*(N); do
    [[ -d "$volume" ]] || continue
    case "${volume:t}" in
      DHL|DSH|Deepseek*Harness*Launcher*) ;;
      *) continue ;;
    esac
    hdiutil detach "$volume" -force >/dev/null 2>&1 || true
  done
}

unregister_legacy_paths() {
  local path
  while IFS= read -r path; do
    [[ -n "$path" ]] && "$LSREGISTER" -u "$path" >/dev/null 2>&1 || true
  done < <("$LSREGISTER" -dump 2>/dev/null | /usr/bin/sed -n \
    's/^path:[[:space:]]*\(.*\.DHL-payload\.app\) ([^)]*)$/\1/p; s/^path:[[:space:]]*\(.*\.Deepseek Harness Launcher-payload\.app\) ([^)]*)$/\1/p')
}

remove_apps() {
  local path
  for path in \
    "${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}/Deepseek Harness Launcher.app" \
    "$HOME/Applications/Deepseek Harness Launcher.app" \
    "/Applications/Deepseek Harness Launcher.app" \
    "${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}/DHL.app" \
    "$HOME/Applications/DHL.app" \
    "/Applications/DHL.app" \
    "$HOME/Applications/DSH.app" \
    "/Applications/DSH.app"; do
    if [[ -e "$path" ]]; then
      "$LSREGISTER" -u "$path" >/dev/null 2>&1 || true
      /bin/rm -rf "$path"
      echo "Removed $path"
    fi
  done
}

remove_backups() {
  local dir path
  for dir in "${CANDIDATE_DIRS[@]}"; do
    [[ -d "$dir" ]] || continue
    while IFS= read -r -d '' path; do
      /bin/rm -rf "$path"
      echo "Removed backup $path"
    done < <(/usr/bin/find "$dir" -maxdepth 1 -type d \( \
      -name 'Deepseek Harness Launcher.app.backup-*' -o \
      -name 'DHL.app.backup-*' -o \
      -name 'DSH.app.backup-*' \
    \) -print0 2>/dev/null || true)
  done
}

cleanup_legacy_volumes
unregister_legacy_paths
remove_apps
remove_backups

PLUGIN_LINK="$HOME/.dsh/profiles/web/node_modules/dsh-archive-manager"
if [[ -L "$PLUGIN_LINK" ]]; then
  TARGET="$(readlink "$PLUGIN_LINK" || true)"
  if [[ "$TARGET" == *"DSHArchiveManager"* ]]; then /bin/rm -f "$PLUGIN_LINK"; echo "Removed plugin link $PLUGIN_LINK"; fi
fi
echo "Deepseek Harness Launcher 的 ~/.dsh 数据保持不变。"
