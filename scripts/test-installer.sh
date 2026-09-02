#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER="$ROOT/scripts/install-from-app.sh"

test -x "$INSTALLER"
rg -q 'index\(\$0, patch\)' "$INSTALLER"
rg -q '\$2 !~ /\^Z/' "$INSTALLER"
rg -q 'index\(cmd, launcher\) == 1' "$INSTALLER"
rg -q 'executable = \(\$3 == "npm".*"dsh"' "$INSTALLER"
rg -q 'signal_processes launcher_pids KILL' "$INSTALLER"
rg -q 'signal_processes dsh_pids KILL' "$INSTALLER"
rg -q 'wait_for_processes launcher_pids' "$INSTALLER"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/dsh-installer-test.XXXXXX")"
PID=""
NPX_PID=""
cleanup() {
  [[ -n "$PID" ]] && kill -KILL "$PID" 2>/dev/null || true
  [[ -n "$NPX_PID" ]] && kill -KILL "$NPX_PID" 2>/dev/null || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

SOURCE="$WORKDIR/source/Deepseek Harness Launcher.app"
DEST="$WORKDIR/destination"
TARGET="$DEST/Deepseek Harness Launcher.app"
OLD_BACKUP="$DEST/DHL.app.backup-old"
OLD_TARGET_BACKUP="$DEST/Deepseek Harness Launcher.app.backup-old"
mkdir -p "$SOURCE/Contents/Resources" "$TARGET/Contents/Resources/DSHArchiveManager" "$TARGET/Contents/MacOS" "$OLD_BACKUP"
mkdir -p "$OLD_TARGET_BACKUP"
print -r -- 'new-version' > "$SOURCE/Contents/Resources/version.txt"
print -r -- 'patch' > "$TARGET/Contents/Resources/DSHArchiveManager/cordis.patch.yml"
print -r -- 'old-version' > "$TARGET/Contents/Resources/version.txt"
print -r -- '#!/bin/zsh' > "$TARGET/Contents/MacOS/DHL"
print -r -- 'exec -a "$0" /usr/bin/tail -f /dev/null' >> "$TARGET/Contents/MacOS/DHL"
chmod +x "$TARGET/Contents/MacOS/DHL"

"$TARGET/Contents/MacOS/DHL" 30 &
PID="$!"
for _ in {1..20}; do
  kill -0 "$PID" 2>/dev/null && break
  sleep 0.05
done
kill -0 "$PID" 2>/dev/null || {
  print -u2 'installer fixture failed to start its managed process'
  exit 1
}

# Simulate the legacy npx-based backend used by older DHL builds. The command
# includes the managed patch path, but its executable is npx rather than node.
FAKE_NPX="$WORKDIR/npx"
ln -s /usr/bin/tail "$FAKE_NPX"
"$FAKE_NPX" -f /dev/null web --patch "$TARGET/Contents/Resources/DSHArchiveManager/cordis.patch.yml" >/dev/null 2>&1 &
NPX_PID="$!"
for _ in {1..20}; do
  kill -0 "$NPX_PID" 2>/dev/null && break
  sleep 0.05
done
kill -0 "$NPX_PID" 2>/dev/null || {
  print -u2 'legacy npx fixture failed to start'
  exit 1
}

# This fixture intentionally contains only installation data, not a runnable
# application. The installer behavior under test is process shutdown and
# replacement, so suppress Finder launch after a successful replacement.
DHL_SKIP_BUNDLE_QUIT=1 DHL_SKIP_GLOBAL_CLEANUP=1 "$INSTALLER" "$SOURCE" "$DEST" --no-open
wait "$PID" 2>/dev/null || true
PID=""
for _ in {1..20}; do
  if ! kill -0 "$NPX_PID" 2>/dev/null; then break; fi
  sleep 0.05
done
if kill -0 "$NPX_PID" 2>/dev/null; then
  print -u2 'installer failed to stop legacy npx backend'
  exit 1
fi
NPX_PID=""

test "$(cat "$TARGET/Contents/Resources/version.txt")" = 'new-version'
test ! -e "$OLD_BACKUP" || {
  print -u2 'old backups should be pruned after reinstall'
  exit 1
}
test ! -e "$OLD_TARGET_BACKUP" || {
  print -u2 'old Deepseek Harness Launcher backups should be pruned after reinstall'
  exit 1
}
find "$DEST" -maxdepth 1 -type d -name '*.app.backup-*' -print -quit | grep -q . && {
  print -u2 'successful reinstall should not leave an app backup'
  exit 1
} || true

print 'Deepseek Harness Launcher installer replacement test passed'
