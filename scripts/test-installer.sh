#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER="$ROOT/scripts/install-from-app.sh"

test -x "$INSTALLER"
rg -q 'index\(\$0, patch\)' "$INSTALLER"
rg -q '\$2 !~ /\^Z/' "$INSTALLER"
rg -q '\$3 == launcher' "$INSTALLER"
rg -q '\$3 == "npm"' "$INSTALLER"
rg -q 'signal_processes launcher_pids KILL' "$INSTALLER"
rg -q 'signal_processes dsh_pids KILL' "$INSTALLER"
rg -q 'wait_for_processes launcher_pids' "$INSTALLER"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/dsh-installer-test.XXXXXX")"
PID=""
cleanup() {
  [[ -n "$PID" ]] && kill -KILL "$PID" 2>/dev/null || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

SOURCE="$WORKDIR/source/DHL.app"
DEST="$WORKDIR/destination"
TARGET="$DEST/DHL.app"
mkdir -p "$SOURCE/Contents/Resources" "$TARGET/Contents/Resources/DSHArchiveManager" "$TARGET/Contents/MacOS"
print -r -- 'new-version' > "$SOURCE/Contents/Resources/version.txt"
print -r -- 'patch' > "$TARGET/Contents/Resources/DSHArchiveManager/cordis.patch.yml"
print -r -- 'old-version' > "$TARGET/Contents/Resources/version.txt"
cp /bin/sleep "$TARGET/Contents/MacOS/DHL"
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

# This fixture intentionally contains only installation data, not a runnable
# application. The installer behavior under test is process shutdown and
# replacement, so suppress Finder launch after a successful replacement.
DHL_SKIP_BUNDLE_QUIT=1 "$INSTALLER" "$SOURCE" "$DEST" --no-open
wait "$PID" 2>/dev/null || true
PID=""

test "$(cat "$TARGET/Contents/Resources/version.txt")" = 'new-version'
test -d "$(dirname "$TARGET")/DHL.app.backup-"* || {
  print -u2 'expected a recoverable DHL.app backup'
  exit 1
}

print 'Deepseek Harness Launcher installer replacement test passed'
