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

# pwd -P normalizes TMPDIR's trailing slash (…/T//dsh-installer-test): the
# scoped process matcher compares ps argv against the installer's resolved
# paths, so both sides must use the same normalized form.
WORKDIR="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/dsh-installer-test.XXXXXX")" && pwd -P)"
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

"$TARGET/Contents/MacOS/DHL" -f /dev/null &
PID="$!"
for _ in {1..20}; do
  kill -0 "$PID" 2>/dev/null && break
  sleep 0.05
done
kill -0 "$PID" 2>/dev/null || {
  print -u2 'installer fixture failed to start its managed process'
  exit 1
}

# 替身脚本会 `exec -a "$0"` 成 argv[0] = <path>/DHL 的 tail。安装器（在
# DHL_STOP_SCOPE=target 下）只按「argv 就是 launcher 路径」这一类匹配它，跳过
# 「shell + 首参是 launcher」那一类（那是为了不误杀真实安装的启动器）。所以必须
# **等它真的 exec 完再跑安装器**：否则安装器扫描时看到的是 `/bin/zsh <path>/DHL`，
# 认不出托管进程 → 不会停它 → 测试的等待就成了空等（实测挂死 20 分钟）。
# 注意别用 `cp /usr/bin/tail` 当替身：系统二进制换目录运行会被内核 Killed: 9，
# 那样测试会「假绿」（进程根本没起来，安装器当然也就没什么可停）。
launcher_argv="$TARGET/Contents/MacOS/DHL"
exec_ready=0
for _ in {1..80}; do
  current="$(ps -o command= -p "$PID" 2>/dev/null)"
  if [[ "$current" == "$launcher_argv"* ]]; then
    exec_ready=1
    break
  fi
  sleep 0.05
done
if [[ "$exec_ready" != 1 ]]; then
  print -u2 'installer fixture never reached its launcher argv (exec phase)'
  kill -KILL "$PID" 2>/dev/null || true
  exit 1
fi

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
# DHL_STOP_SCOPE=target keeps process shutdown scoped to the fixture: a test
# run must never SIGTERM the really installed launcher/backend (that is what
# used to make the menu-bar app "auto quit" during regression runs).
DHL_STOP_SCOPE=target DHL_SKIP_GLOBAL_CLEANUP=1 "$INSTALLER" "$SOURCE" "$DEST" --no-open
# 等安装器把替身停掉：**必须有超时**——裸 wait 一旦等不到就永远挂着，
# 让人以为「回归卡了」而不是「安装器没停掉旧启动器」（这个坑踩过一次）。
for _ in {1..50}; do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$PID" 2>/dev/null; then
  print -u2 'installer failed to stop the managed launcher fixture'
  kill -KILL "$PID" 2>/dev/null || true
  exit 1
fi
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
