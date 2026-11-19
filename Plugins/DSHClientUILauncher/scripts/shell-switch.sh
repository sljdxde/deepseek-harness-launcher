#!/bin/sh
# 壳层开关（05-§9 R1）：改一个值 + 重启，5 分钟内可回滚。
#
# 用法：
#   ./scripts/shell-switch.sh status      # 读当前值
#   ./scripts/shell-switch.sh launcher    # 切到新外壳
#   ./scripts/shell-switch.sh native      # 切回原生 ui-layout
#   ./scripts/shell-switch.sh verify      # 断言页面特征（需要 DSH_URL 与可用的无头浏览器）
#
# 状态文件：$DSH_HOME/state/ui-shell.json，键 shell = "native" | "launcher"；缺文件/坏文件按 launcher（全开）处理，
# 回滚开关不能因为文件坏了把界面弄坏（05-§9 R2 末段）。
# 探测不到就退出码 3 并打印手工等价操作，不假装成功（06 R-12）。
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE=${NODE:-node}
DSH_DATA=${DSH_HOME:-$HOME/.dsh}
STATE="$DSH_DATA/state/ui-shell.json"

usage() {
  cat <<'USAGE'
用法：shell-switch.sh <status|launcher|native|verify>
  status    打印当前 shell 值
  launcher  切到新外壳（写 state/ui-shell.json 并重启 dsh web）
  native    切回原生 ui-layout
  verify    断言页面特征：launcher 时 [data-shell="launcher"] 在、.app 不在；native 时相反
USAGE
}

# 读值：缺文件/坏文件都按 launcher（05-§9 R2：任一开关读不到都按全开处理）
read_shell() {
  if [ ! -f "$STATE" ]; then echo launcher; return 0; fi
  "$NODE" -e '
    const fs = require("node:fs");
    try {
      const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(doc && doc.shell === "native" ? "native" : "launcher");
    } catch { process.stdout.write("launcher"); }
  ' "$STATE" 2>/dev/null || echo launcher
}

# 原子写：tmp + rename；文件 0600
write_shell() {
  value=$1
  dir=$(dirname "$STATE")
  mkdir -p "$dir"
  tmp="$STATE.tmp.$$"
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, value] = process.argv.slice(1);
    const next = { shell: value === "native" ? "native" : "launcher", updatedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  ' "$tmp" "$value"
  mv -f "$tmp" "$STATE"
}

# 重启：优先 dsh web restart；探测不到就退出 3 并给手工步骤
restart_web() {
  if command -v dsh >/dev/null 2>&1; then
    if dsh web --help 2>&1 | grep -q 'restart'; then
      dsh web restart
      echo "已重启 dsh web"
      return 0
    fi
  fi
  cat >&2 <<'MANUAL'
探测不到 `dsh web restart`（R-12：不假装成功）。手工等价操作：
  1) 退出当前 dsh web（菜单栏 → 退出，或结束该进程）
  2) 重新打开 dsh web
  3) 浏览器硬刷新页面（Command+Shift+R）
MANUAL
  exit 3
}

# verify：状态与页面特征都要对
verify() {
  expected=$(read_shell)
  if [ -n "${DSH_URL:-}" ] && command -v "$NODE" >/dev/null 2>&1; then
    "$NODE" "$HERE/verify-shell.mjs" "$DSH_URL" "$expected"
    return $?
  fi
  cat >&2 <<MANUAL
未提供 DSH_URL，无法断言页面特征（当前状态文件：shell=$expected）。手工等价操作：
  · launcher：页面存在 [data-shell="launcher"]，且不存在原生壳特征 .app
  · native：页面存在 .app（四列 grid），且不存在 [data-shell="launcher"]
  浏览器控制台执行：document.querySelector('[data-shell="launcher"]') / document.querySelector('.app')
MANUAL
  exit 3
}

case "${1:-}" in
  status) echo "shell=$(read_shell)"; echo "state=$STATE" ;;
  launcher|native)
    write_shell "$1"
    echo "已写 $STATE：shell=$1"
    restart_web
    ;;
  verify) verify ;;
  *) usage; exit 2 ;;
esac
