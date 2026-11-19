#!/bin/sh
# 壳层开关（新 05-§9 R1：同名 drop-in + profile pnpm override）。
#
# 换的是「profile 里装哪一版 layout 实现」，不是读一个状态值让同一份代码让位：
#   launcher：profile 的 dependencies 里加一条 @deepseek-ai/dsh-client-ui-layout → file:<本包> → pnpm install → 重启
#   native  ：删掉这条依赖 → pnpm install → 重启
#
# 注意（实测）：pnpm 11 **不再读 package.json 的 `pnpm.overrides`**（会打印 "The pnpm field … is no longer
# read by pnpm" 并忽略），而且 overrides 只作用于已存在的依赖图——layout 本来不是 profile 的依赖，写 override
# 也不会装。可用做法是把它作为 profile 的**依赖**装进去：模块解析优先 profile 的 node_modules，
# 行 id 与 name 都不用改。
# 行 id 仍是 ui-layout，cordis.patch.yml 一个字不动。
#
# 默认 native。前进向带 boot 自检：起了空白页（13 条必需客户端条目任一条 pending 的表现）就自动
# 删回 override、重装、重启、写日志，绝不让用户困在空白页里。
#
# 用法：
#   ./scripts/shell-switch.sh status | launcher | native | verify
# 环境：DSH_HOME（默认家目录下的 dsh 数据目录）、DSH_PROFILE（默认 web）、
#       PACKAGE_DIR（本包绝对路径，默认从脚本位置推）、DSH_URL（verify 用）
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=${PACKAGE_DIR:-$(CDPATH= cd -- "$HERE/.." && pwd)}
NODE=${NODE:-node}
DSH_DATA=${DSH_HOME:-$HOME/.dsh}
PROFILE=${DSH_PROFILE:-web}
PROFILE_DIR="$DSH_DATA/profiles/$PROFILE"
MANIFEST="$PROFILE_DIR/package.json"
STATE="$DSH_DATA/state/ui-shell.json"
LOG="$DSH_DATA/state/ui-shell.log"
HOST_PACKAGE='@deepseek-ai/dsh-client-ui-layout'

usage() {
  cat <<'USAGE'
用法：shell-switch.sh <status|launcher|native|verify>
  status    打印状态与 profile 里的依赖指向
  launcher  把本包作为 profile 依赖装进去 → pnpm install → 重启 → boot 自检（失败自动回落）
  native    删掉这条依赖 → pnpm install → 重启
  verify    断言界面特征（需要 DSH_URL）
USAGE
}

log_line() {
  mkdir -p "$(dirname "$LOG")"
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG"
}

write_state() {
  mkdir -p "$(dirname "$STATE")"
  tmp="$STATE.tmp.$$"
  "$NODE" -e 'const fs=require("node:fs");const [f,v]=process.argv.slice(1);fs.writeFileSync(f,JSON.stringify({shell:v,updatedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600})' "$tmp" "$1"
  mv -f "$tmp" "$STATE"
}

# 开关默认 native：缺文件/坏文件一律按原生（空白页比旧界面糟）
read_state() {
  if [ ! -f "$STATE" ]; then echo native; return 0; fi
  "$NODE" -e 'const fs=require("node:fs");try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(d&&d.shell==="launcher"?"launcher":"native")}catch{process.stdout.write("native")}' "$STATE" 2>/dev/null || echo native
}

require_profile() {
  if [ ! -f "$MANIFEST" ]; then
    echo "找不到 profile 清单：$MANIFEST（DSH_HOME / DSH_PROFILE 对不上的话会走到这里）" >&2
    exit 3
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    cat >&2 <<'MANUAL'
找不到 pnpm（R-12：不假装成功）。手工等价操作：
  1) 在 profile 目录的 package.json 的 dependencies 里加/删 "@deepseek-ai/dsh-client-ui-layout": "file:<本包绝对路径>"
     （pnpm 11 不再读 `pnpm.overrides`，只在已存在的依赖图上生效，装不了新包）
  2) 在该目录跑 pnpm install
  3) 重启 dsh web 并硬刷新页面
MANUAL
    exit 3
  fi
}

set_dependency() {
  mode=$1
  require_profile
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, mode, name, target] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    manifest.dependencies = manifest.dependencies ?? {};
    if (mode === "add") manifest.dependencies[name] = `file:${target}`;
    else delete manifest.dependencies[name];
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  ' "$MANIFEST" "$mode" "$HOST_PACKAGE" "$PACKAGE_DIR"
}

install_profile() {
  ( cd "$PROFILE_DIR" && pnpm install --silent ) || {
    echo "pnpm install 失败，override 已改但依赖没装上；请人工处理（日志见上）" >&2
    exit 3
  }
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

verify_page() {
  if [ -z "${DSH_URL:-}" ]; then
    echo "未提供 DSH_URL，无法断言页面（期望 $1）" >&2
    return 3
  fi
  "$NODE" "$HERE/verify-shell.mjs" "$DSH_URL" "$1"
}

case "${1:-}" in
  status)
    echo "shell=$(read_state)"
    echo "profile=$MANIFEST"
    "$NODE" -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write("dependency="+JSON.stringify(m.dependencies?.[process.argv[2]]??null)+"\n")' "$MANIFEST" "$HOST_PACKAGE" 2>/dev/null || echo "dependency=?"
    ;;
  launcher)
    set_dependency add
    install_profile
    write_state launcher
    log_line "switch=launcher dependency=file:$PACKAGE_DIR"
    echo "已把 $HOST_PACKAGE 覆盖为本包：$PACKAGE_DIR"
    restart_web || exit 3
    if ! verify_page launcher; then
      log_line "boot-self-check=FAILED fallback=native"
      printf '%s\n' "新外壳启动自检失败，自动回落原生（日志：$LOG）" >&2
      set_dependency remove
      install_profile
      write_state native
      restart_web || true
      exit 1
    fi
    log_line "boot-self-check=OK"
    ;;
  native)
    set_dependency remove
    install_profile
    write_state native
    log_line "switch=native dependency=removed"
    echo "已删掉 override，装回上游 layout"
    restart_web || exit 3
    if [ -n "${DSH_URL:-}" ]; then verify_page native || { log_line "verify=native FAILED"; exit 1; }; fi
    ;;
  verify)
    verify_page "$(read_state)"
    ;;
  *)
    usage
    exit 2
    ;;
esac
