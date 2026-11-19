#!/bin/sh
# verify-shell-standalone.sh —— 在**独立实例**上验一次换壳，不碰正在使用的 dsh。
#
# 做的事：把 profile 的清单类文件复制到临时 DSH_HOME → node_modules 软链回源 profile →
# 用 shell-switch.sh 切到目标实现 → 起一个独立端口的 dsh web → 跑 verify 断言 → 收工。
# 退出码：0 断言通过；1 断言失败；2 参数错误；3 环境缺件（不假装成功）。
#
# 用法：
#   DSH_INSTALL=/path/to/dsh-install \
#   PROFILE_SRC=$HOME/.dsh/profiles/web \
#   PACKAGE_DIR=/path/to/Plugins/DSHClientUILauncher \
#   ./scripts/verify-shell-standalone.sh launcher|native|both [--port 64800]
#
# 依赖：被验的 dsh 安装、一个已存在的 profile（默认当前 DSH_HOME 的 web profile）、本包目录。
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=${PACKAGE_DIR:-$(CDPATH= cd -- "$HERE/.." && pwd)}
DSH_INSTALL=${DSH_INSTALL:-}
PROFILE_SRC=${PROFILE_SRC:-${DSH_HOME:-$HOME/.dsh}/profiles/web}
TARGET=${1:-both}
PORT=0
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT=$2; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
TIMEOUT=${START_TIMEOUT:-40}

[ -d "$DSH_INSTALL" ] || { echo "缺 DSH_INSTALL（dsh 安装目录，含 lib/bin.js）" >&2; exit 2; }
[ -f "$DSH_INSTALL/lib/bin.js" ] || { echo "DSH_INSTALL 下没有 lib/bin.js：$DSH_INSTALL" >&2; exit 2; }
[ -f "$PROFILE_SRC/package.json" ] || { echo "PROFILE_SRC 不是有效 profile：$PROFILE_SRC" >&2; exit 2; }
[ -f "$PACKAGE_DIR/package.json" ] || { echo "PACKAGE_DIR 不是有效包：$PACKAGE_DIR" >&2; exit 2; }

# dsh 安装目录的 node_modules（宿主原包在这里，不在 dsh 包自身目录下）
DSH_MODULES=$(cd "$DSH_INSTALL/../.." && pwd)
WORK=${STANDALONE_HOME:-/tmp/dsh-shell-standalone}
HOME2="$WORK/home"
FRESH=${FRESH:-1}
if [ "$FRESH" = "1" ]; then rm -rf "$WORK"; fi
mkdir -p "$HOME2/profiles"
if [ ! -d "$HOME2/profiles/web" ]; then
  cp -R "$PROFILE_SRC" "$HOME2/profiles/web"
  rm -rf "$HOME2/profiles/web/node_modules"
  # 不能用软链：pnpm 在软链的 node_modules 上会拒绝安装（exit 254），而独立实例要靠它切实现。
  # 用硬链接复制（cp -al），几秒完成、不占额外空间，且是真实目录。
  cp -al "$PROFILE_SRC/node_modules" "$HOME2/profiles/web/node_modules"
fi
DSH_HOME_DIR=$HOME2
NODE=${NODE:-node}

pick_port() {
  if [ "$PORT" != "0" ]; then echo "$PORT"; return 0; fi
  "$NODE" -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)))})'
}

# 起一个独立 dsh web，回显 URL；日志留在 $WORK/web.log
start_web() {
  log="$WORK/web.log"
  : > "$log"
  ( cd "$DSH_INSTALL" && DSH_HOME="$HOME2" "$NODE" lib/bin.js web --no-open --port "$1" > "$log" 2>&1 & )
  i=0
  while [ $i -lt "$TIMEOUT" ]; do
    url=$(grep -o 'http://127\.0\.0\.1:[0-9]*/?token=[A-Za-z0-9_-]*' "$log" | head -1 || true)
    if [ -n "${url:-}" ]; then
      printf '%s' "$url" > "$WORK/url"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "起不来（${TIMEOUT}s 内没拿到 URL），日志：$log" >&2
  return 3
}

stop_web() {
  pkill -f "lib/bin.js web --no-open --port $1" 2>/dev/null || true
  sleep 1
}

# 在独立实例里换实现：直接换 node_modules 里那份包（独立实例不需要 pnpm；
# pnpm 在复制/硬链的 node_modules 上会 exit 254 且日志为空，见 09-自测）。
LAYOUT="$HOME2/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-layout"
ORIG="$HOME2/profiles/web/.orig-layout"

switch_impl() {
  want=$1
  case "$want" in
    launcher)
      # 原包留底：优先用 profile 里那份，其次用	dsh 安装目录里的宿主实现（新 profile 可能还没有 layout 依赖）
      if [ ! -d "$ORIG" ]; then
        # 源 profile 可能本来就装着我们的实现：这种情况必须从 dsh 安装目录取宿主原包留底
        if [ -d "$LAYOUT" ] && ! is_ours_at "$LAYOUT"; then cp -R "$LAYOUT" "$ORIG"
        elif [ -d "$DSH_MODULES/@deepseek-ai/dsh-client-ui-layout" ]; then
          cp -R "$DSH_MODULES/@deepseek-ai/dsh-client-ui-layout" "$ORIG"
        fi
      fi
      rm -rf "$LAYOUT"
      # 只拷实现需要的部分：不能整个 cp -R（包里若有 node_modules 软链会被解引用，复制几百 MB 卡住）
      mkdir -p "$LAYOUT"
      for entry in package.json client lib cordis.patch.yml contracts; do
        if [ -e "$PACKAGE_DIR/$entry" ]; then cp -R "$PACKAGE_DIR/$entry" "$LAYOUT/"; fi
      done ;;
    native)
      if [ -d "$ORIG" ]; then rm -rf "$LAYOUT"; cp -R "$ORIG" "$LAYOUT"; fi ;;
  esac
}

is_ours_at() {
  [ -f "$1/client/client.js" ] && grep -q '__DSH_LAUNCHER_SHELL__' "$1/client/client.js"
}

is_ours() {
  is_ours_at "$LAYOUT"
}

# 30 秒硬超时：URL 捕获或浏览器断言卡住时打印手工三步并 exit 2（明确"未验证"），绝不允许挂住
VERIFY_TIMEOUT=${VERIFY_TIMEOUT:-30}
run_with_timeout() {
  secs=$1; shift
  "$@" & pid=$!
  ( sleep "$secs"; kill -9 "$pid" 2>/dev/null ) & watcher=$!
  wait "$pid"; code=$?
  kill "$watcher" 2>/dev/null || true
  return $code
}

manual_steps() {
  cat >&2 <<'MANUAL'
未验证：独立实例在 30 秒内没给出可判定的结果。请按手工三步（runbook 同款）：
  1) 起独立实例：DSH_HOME=<临时 home> node <dsh 安装>/lib/bin.js web --no-open --port <端口>
  2) 从启动日志读带 token 的 URL
  3) DSH_HOME=<临时 home> PKG_DIR=<本包> sh scripts/shell-switch.sh verify launcher|native
MANUAL
}

run_state() {
  want=$1
  port=$(pick_port)
  echo "── $want（端口 $port，DSH_HOME=$HOME2）──"
  switch_impl "$want"
  if [ "$want" = "launcher" ]; then
    is_ours || { echo "独立实例里没换上我们的实现（$LAYOUT）" >&2; return 3; }
  else
    is_ours && { echo "独立实例里仍是我们的实现，native 未生效" >&2; return 3; }
  fi
  start_web "$port" || { stop_web "$port"; return 3; }
  [ -f "$WORK/url" ] || { manual_steps; return 2; }
  url=$(cat "$WORK/url")
  echo "URL: $url"
  DSH_HOME="$HOME2" DSH_URL="$url" PACKAGE_DIR="$PACKAGE_DIR" \
    run_with_timeout "$VERIFY_TIMEOUT" "$NODE" "$HERE/verify-shell.mjs" "$url" "$want"
  code=$?
  stop_web "$port"
  if [ "$code" -ne 0 ]; then
    manual_steps
    return 2
  fi
  return 0
}

case "$TARGET" in
  launcher|native) run_state "$TARGET" ;;
  both)
    run_state launcher || exit $?
    run_state native || exit $?
    ;;
  *) echo "用法：$0 launcher|native|both [--port N]" >&2; exit 2 ;;
esac
