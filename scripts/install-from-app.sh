#!/bin/zsh
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  print -u2 "Usage: $0 SOURCE_APP DESTINATION_DIRECTORY [--no-open]"
  exit 64
fi

SOURCE_APP="${1:A}"
DEST_DIR="${2:A}"
NO_OPEN="${3:-}"
TARGET_APP="$DEST_DIR/Deepseek Harness Launcher.app"
LEGACY_DHL_APP="$DEST_DIR/DHL.app"
LEGACY_APP="$DEST_DIR/DSH.app"

if [[ ! -d "$SOURCE_APP" ]]; then
  print -u2 "Source app not found: $SOURCE_APP"
  exit 66
fi

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

unregister_legacy_paths() {
  local path
  while IFS= read -r path; do
    [[ -n "$path" ]] && "$LSREGISTER" -u "$path" >/dev/null 2>&1 || true
  done < <("$LSREGISTER" -dump 2>/dev/null | /usr/bin/sed -n \
    's/^path:[[:space:]]*\(.*\.DHL-payload\.app\) ([^)]*)$/\1/p; s/^path:[[:space:]]*\(.*\.Deepseek Harness Launcher-payload\.app\) ([^)]*)$/\1/p')
}

prune_backups() {
  local dir="${1:-}"
  shift || true
  [[ -d "$dir" ]] || return 0
  local path keep skip
  while IFS= read -r -d '' path; do
    skip=0
    for keep in "$@"; do
      [[ -n "$keep" && "$path" == "$keep" ]] && { skip=1; break; }
    done
    [[ "$skip" == 1 ]] && continue
    /bin/rm -rf "$path"
    echo "Removed old backup $path"
  done < <(/usr/bin/find "$dir" -maxdepth 1 -type d \( \
    -name 'Deepseek Harness Launcher.app.backup-*' -o \
    -name 'DHL.app.backup-*' -o \
    -name 'DSH.app.backup-*' \
  \) -print0 2>/dev/null || true)
}


launcher_pids() {
  local launcher="$TARGET_APP/Contents/MacOS/DHL"
  local legacy_dhl_launcher="$LEGACY_DHL_APP/Contents/MacOS/DHL"
  local legacy_launcher="$LEGACY_APP/Contents/MacOS/DSH"
  # Match processes whose command starts with the launcher executable. A shell
  # that merely contains the app path in its own arguments must not match.
  ps -axo pid=,state=,command= | awk -v launcher="$launcher" -v legacy_dhl_launcher="$legacy_dhl_launcher" -v legacy_launcher="$legacy_launcher" '
    $2 !~ /^Z/ {
      cmd = $0
      sub(/^[ \t]*[0-9]+[ \t]+[^ \t]+[ \t]+/, "", cmd)
      if (cmd == launcher || index(cmd, launcher) == 1 ||
          cmd == legacy_dhl_launcher || index(cmd, legacy_dhl_launcher) == 1 ||
          cmd == legacy_launcher || index(cmd, legacy_launcher) == 1) print $1
    }'
}

dsh_pids() {
  local patch="$TARGET_APP/Contents/Resources/DSHArchiveManager/cordis.patch.yml"
  local legacy_dhl_patch="$LEGACY_DHL_APP/Contents/Resources/DSHArchiveManager/cordis.patch.yml"
  local legacy_patch="$LEGACY_APP/Contents/Resources/DSHArchiveManager/cordis.patch.yml"
  # npm exec is the parent and node is the actual Harness server. Restricting
  # the executable field avoids matching the shell/awk used to perform this scan.
  ps -axo pid=,state=,command= | awk -v patch="$patch" -v legacy_dhl_patch="$legacy_dhl_patch" -v legacy_patch="$legacy_patch" \
    '$2 !~ /^Z/ && ($3 == "npm" || $3 == "node" || $3 ~ /\/(npm|node)$/) && (index($0, patch) || index($0, legacy_dhl_patch) || index($0, legacy_patch)) { print $1 }'
}

managed_pids() {
  { launcher_pids; dsh_pids; } | awk 'NF && !seen[$1]++ { print $1 }' | sort -nu
}

wait_for_processes() {
  local finder="$1"
  local attempts="${2:-40}"
  local pids i
  for ((i = 1; i <= attempts; i++)); do
    pids="$($finder)"
    [[ -z "$pids" ]] && return 0
    sleep 0.1
  done
  [[ -z "$($finder)" ]]
}

signal_processes() {
  local finder="$1"
  local signal="$2"
  local pids pid pgid
  pids="$($finder)"
  [[ -z "$pids" ]] && return 0
  while read -r pid; do
    [[ -z "$pid" || "$pid" == "$$" ]] && continue
    pgid="$(ps -o pgid= -p "$pid" | tr -d ' ' || true)"
    # The launcher creates Harness in its own process group. Only signal a group
    # owned by the matched process so an installer never kills its own shell.
    if [[ -n "$pgid" && "$pgid" == "$pid" ]]; then
      kill -"$signal" -- -"$pgid" 2>/dev/null || true
    fi
    kill -"$signal" "$pid" 2>/dev/null || true
  done <<< "$pids"
}

stop_existing_dsh() {
  # Ask the UI process to exit first, but never wait for an old, stuck build
  # to acknowledge the Apple event. The targeted signal path below is the
  # authoritative fallback before replacement.
  if [[ "${DHL_SKIP_BUNDLE_QUIT:-${DSH_SKIP_BUNDLE_QUIT:-0}}" != "1" ]]; then
    osascript -e 'ignoring application responses' -e 'tell application id "com.local.dhl-launcher" to quit' -e 'end ignoring' >/dev/null 2>&1 || true
    osascript -e 'ignoring application responses' -e 'tell application id "com.local.dsh-launcher" to quit' -e 'end ignoring' >/dev/null 2>&1 || true
  fi

  if ! wait_for_processes launcher_pids 15; then
    print "Deepseek Harness Launcher did not exit normally; terminating it..."
    signal_processes launcher_pids TERM
    if ! wait_for_processes launcher_pids 10; then
      print "Deepseek Harness Launcher did not exit after SIGTERM; force quitting..."
      signal_processes launcher_pids KILL
    fi
    if ! wait_for_processes launcher_pids 10; then
      print -u2 "Unable to stop the running Deepseek Harness Launcher; installation was cancelled."
      return 1
    fi
  fi

  # The launcher intentionally leaves Harness running when it quits, so updating
  # must stop the backend in a separate phase before its bundled patch moves.
  signal_processes dsh_pids TERM
  if ! wait_for_processes dsh_pids 20; then
    print "Deepseek Harness Launcher backend did not exit after SIGTERM; force quitting..."
    signal_processes dsh_pids KILL
  fi
  if ! wait_for_processes dsh_pids 20; then
    print -u2 "Unable to stop the running Deepseek Harness Launcher backend; installation was cancelled."
    return 1
  fi
}

stop_existing_dsh
mkdir -p "$DEST_DIR"

BACKUP=""
LEGACY_DHL_BACKUP=""
if [[ -e "$TARGET_APP" ]]; then
  BACKUP="$DEST_DIR/Deepseek Harness Launcher.app.backup-$(date +%Y%m%d-%H%M%S)-$$"
  mv "$TARGET_APP" "$BACKUP"
fi

if [[ -e "$LEGACY_DHL_APP" ]]; then
  LEGACY_DHL_BACKUP="$DEST_DIR/DHL.app.backup-$(date +%Y%m%d-%H%M%S)-$$"
  mv "$LEGACY_DHL_APP" "$LEGACY_DHL_BACKUP"
fi

if [[ -e "$LEGACY_APP" ]]; then
  LEGACY_BACKUP="$DEST_DIR/DSH.app.backup-$(date +%Y%m%d-%H%M%S)-$$"
  mv "$LEGACY_APP" "$LEGACY_BACKUP"
fi

if ! ditto "$SOURCE_APP" "$TARGET_APP"; then
  /bin/rm -rf "$TARGET_APP"
  [[ -n "$BACKUP" && -e "$BACKUP" ]] && mv "$BACKUP" "$TARGET_APP"
  [[ -n "$LEGACY_DHL_BACKUP" && -e "$LEGACY_DHL_BACKUP" ]] && mv "$LEGACY_DHL_BACKUP" "$LEGACY_DHL_APP"
  [[ -n "${LEGACY_BACKUP:-}" && -e "$LEGACY_BACKUP" ]] && mv "$LEGACY_BACKUP" "$LEGACY_APP"
  print -u2 "Failed to install Deepseek Harness Launcher; the previous app was restored when possible."
  exit 1
fi

unregister_legacy_paths
prune_backups "$DEST_DIR" "$BACKUP" "$LEGACY_DHL_BACKUP" "${LEGACY_BACKUP:-}"
xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
print "Installed $TARGET_APP"
[[ -n "$BACKUP" ]] && print "Previous app backup: $BACKUP"
if [[ "$NO_OPEN" != "--no-open" && "${DHL_NO_OPEN:-${DSH_NO_OPEN:-0}}" != "1" ]]; then
  open "$TARGET_APP"
fi
