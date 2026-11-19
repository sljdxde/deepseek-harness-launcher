#!/bin/sh
# 壳层开关（新 05-§9 R1 两向 + 宿主级 boot 自检）。
#
# 语义：native 与 launcher 的差别是「profile 里装哪一版 layout 实现」，不是同一份代码读一个值——
# 让位只意味着"不注册 root"，真 ui-layout 没被加载时它接不回来。所以这里换的是模块实现（软链），
# state/ui-shell.json 只作状态记录，不当唯一开关。
#
# 用法：
#   ./scripts/shell-switch.sh status     # 读状态
#   ./scripts/shell-switch.sh native     # 回原生：layout 模块指回宿主原包 + 重启（新 R1 已实测可用）
#   ./scripts/shell-switch.sh launcher   # 切新壳：指向本包构建产物 + 重启 + boot 自检；失败自动回落并写日志
#   ./scripts/shell-switch.sh verify     # 断言界面特征（需要 DSH_URL；launcher 还要 DSH_HOME 里的状态）
#
# 关键：默认值 native。前进向必须是"可观测成功才留下"——进了 launcher 之后页面起不来（13 条必需
# 客户端条目任一条 pending 的表现就是整页空白），本脚本自动把模块换回原生并重启，写日志，退出码 1。
# 用户不会被困在空白页里、也不需要命令行救回来。
#
# 探测不到任何一项就退出码 3 并打印手工等价操作，不假装成功（06 R-12）。
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE=${NODE:-node}
DSH_DATA=${DSH_HOME:-$HOME/.dsh}
STATE="$DSH_DATA/state/ui-shell.json"
LOG="$DSH_DATA/state/ui-shell.log"

# 两个可配置路径：装在哪、构建产物在哪。默认从环境读，探测不到就 exit 3。
LAYOUT_MODULE=${LAYOUT_MODULE:-}
LAUNCHER_BUILD=${LAUNCHER_BUILD:-}
BACKUP_SUFFIX=.dsh-native

usage() {
  cat <<'USAGE'
用法：shell-switch.sh <status|launcher|native|verify>
  status    打印当前 shell 值与模块指向
  native    回原生（模块指回宿主原包 + 重启）
  launcher  切新壳（模块指到本包构建 + 重启 + boot 自检，失败自动回落）
  verify    断言界面特征（需要 DSH_URL）
环境：LAYOUT_MODULE=<装好的 layout 模块路径>  LAUNCHER_BUILD=<build-layout-alias 的产物目录>
USAGE
}

log_line() {
  mkdir -p "$(dirname "$LOG")"
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG"
}

# 默认 native：开关读不到就按"回原生"处理（空白页比旧界面糟得多）
read_shell() {
  if [ ! -f "$STATE" ]; then echo native; return 0; fi
  "$NODE" -e '
    const fs = require("node:fs");
    try {
      const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(doc && doc.shell === "launcher" ? "launcher" : "native");
    } catch { process.stdout.write("native"); }
  ' "$STATE" 2>/dev/null || echo native
}

write_shell() {
  value=$1
  mkdir -p "$(dirname "$STATE")"
  tmp="$STATE.tmp.$$"
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, value] = process.argv.slice(1);
    fs.writeFileSync(file, JSON.stringify({ shell: value === "launcher" ? "launcher" : "native", updatedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  ' "$tmp" "$value"
  mv -f "$tmp" "$STATE"
}

require_paths() {
  if [ -z "$LAYOUT_MODULE" ] || [ -z "$LAUNCHER_BUILD" ]; then
    cat >&2 <<'MANUAL'
缺少 LAYOUT_MODULE / LAUNCHER_BUILD（R-12：不猜路径、不假装成功）。手工等价操作：
  1) 找到当前安装里的 layout 模块：<dsh 安装目录>/node_modules/@deepseek-ai/dsh-client-ui-layout
  2) 构建本包：node tools/build-layout-alias.mjs --out <产物目录>
  3) 把 1) 改名为 *.dsh-native，再软链到 2)；反向则软链回 1)
  4) 重启 dsh web，硬刷新页面
MANUAL
    exit 3
  fi
  if [ ! -d "$LAYOUT_MODULE" ] && [ ! -L "$LAYOUT_MODULE" ]; then
    echo "LAYOUT_MODULE 不存在：$LAYOUT_MODULE" >&2
    exit 3
  fi
}

restart_web() {
  if command -v dsh >/dev/null 2>&1 && dsh web --help 2>&1 | grep -q restart; then
    dsh web restart
    echo "已重启 dsh web"
    return 0
  fi
  cat >&2 <<'MANUAL'
探测不到 `dsh web restart`（R-12：不假装成功）。手工等价操作：
  1) 退出当前 dsh web  2) 重新打开 dsh web  3) 浏览器硬刷新（Command+Shift+R）
MANUAL
  return 3
}

# 指向某个实现（目录或软链）；原目录只在第一次切走时改名备份
point_to() {
  target=$1
  if [ -e "$LAYOUT_MODULE$BACKUP_SUFFIX" ]; then
    rm -f "$LAYOUT_MODULE"
  else
    mv "$LAYOUT_MODULE" "$LAYOUT_MODULE$BACKUP_SUFFIX"
  fi
  ln -s "$target" "$LAYOUT_MODULE"
}

point_native() {
  if [ -e "$LAYOUT_MODULE$BACKUP_SUFFIX" ]; then
    rm -f "$LAYOUT_MODULE"
    ln -s "$LAYOUT_MODULE$BACKUP_SUFFIX" "$LAYOUT_MODULE"
  fi
}

verify_page() {
  expected=$1
  if [ -z "${DSH_URL:-}" ]; then
    echo "未提供 DSH_URL，无法断言页面（期望 $expected）" >&2
    return 3
  fi
  "$NODE" "$HERE/verify-shell.mjs" "$DSH_URL" "$expected"
}

case "${1:-}" in
  status)
    echo "shell=$(read_shell)"
    echo "state=$STATE"
    if [ -n "$LAYOUT_MODULE" ]; then echo "module=$(readlink "$LAYOUT_MODULE" 2>/dev/null || echo "$LAYOUT_MODULE")"; fi
    ;;
  native)
    require_paths
    point_native
    write_shell native
    log_line "switch=native module=$LAYOUT_MODULE"
    echo "已指回原生 layout：$LAYOUT_MODULE"
    restart_web || exit 3
    if [ -n "${DSH_URL:-}" ]; then verify_page native || { log_line "verify=native FAILED"; exit 1; }; fi
    ;;
  launcher)
    require_paths
    point_to "$LAUNCHER_BUILD"
    write_shell launcher
    log_line "switch=launcher module=$LAYOUT_MODULE -> $LAUNCHER_BUILD"
    echo "已指向新外壳：$LAYOUT_MODULE -> $LAUNCHER_BUILD"
    restart_web || exit 3
    # 宿主级 boot 自检：起不来（13 条必需条目 pending 的表现就是空白页）就自动回落，绝不把用户留在空白里
    if ! verify_page launcher; then
      log_line "boot-self-check=FAILED fallback=native"
      printf '%s\n' "新外壳启动自检失败，已自动回落原生（日志：$LOG）" >&2
      point_native
      write_shell native
      restart_web || true
      exit 1
    fi
    log_line "boot-self-check=OK"
    ;;
  verify)
    verify_page "$(read_shell)"
    ;;
  *)
    usage
    exit 2
    ;;
esac
