#!/bin/sh
# 壳层开关（新 05-§9 R1 定稿口径：持久层 override + 即时层链接，两者都要）。
#
#   即时层：profiles/<name>/node_modules/@deepseek-ai/dsh-client-ui-layout 这条链接决定「现在是谁」
#   切换   = 换链接 + 重启；链接会被 pnpm install 改回依赖图解析结果，所以换完链路要再跑一次本脚本（幂等）
#   回滚   = 换回链接（原包在 profiles/<name>/.orig/ 里留了一份，不靠重装），5 分钟口径靠这个
#
# 用法：
#   ./scripts/shell-switch.sh status | launcher | native | verify
# 环境：DSH_HOME、DSH_PROFILE（默认 web）、PACKAGE_DIR（本包绝对路径）、DSH_URL（verify 用）
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=${PACKAGE_DIR:-$(CDPATH= cd -- "$HERE/.." && pwd)}
NODE=${NODE:-node}
DSH_DATA=${DSH_HOME:-$HOME/.dsh}
PROFILE=${DSH_PROFILE:-web}
PROFILE_DIR="$DSH_DATA/profiles/$PROFILE"
MANIFEST="$PROFILE_DIR/package.json"
LINK="$PROFILE_DIR/node_modules/@deepseek-ai/dsh-client-ui-layout"
ORIG_DIR="$PROFILE_DIR/.orig/@deepseek-ai"
ORIG="$ORIG_DIR/dsh-client-ui-layout"
STATE="$DSH_DATA/state/ui-shell.json"
STATE_DIR="$(dirname "$STATE")"
LOG="$DSH_DATA/state/ui-shell.log"
HOST_PACKAGE='@deepseek-ai/dsh-client-ui-layout'

usage() {
  cat <<'USAGE'
用法：shell-switch.sh <status|launcher|native|verify>
  status    打印状态、override、链接指向
  launcher  override 指向本包 + 链接指向本包 + 重启 + 自检（失败自动回落）；幂等
  native    override 删掉 + 链接指回 .orig 原包 + 重启 + 自检
  verify    断言：当前链向正确 + [data-shell]（launcher）/原生特征（native）+ 0 报错（需要 DSH_URL）
USAGE
}

log_line() {
  mkdir -p "$(dirname "$LOG")"
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG"
}

require_profile() {
  [ -f "$MANIFEST" ] || { echo "找不到 profile 清单：$MANIFEST" >&2; exit 3; }
  [ -d "$PROFILE_DIR/node_modules" ] || { echo "profile 还没装依赖：$PROFILE_DIR/node_modules" >&2; exit 3; }
}

# 第一次切走时把原包整体复制到 .orig/，之后回滚只换链接、不重装
# 原包留底：**必须**留一份真正的上游实现。实测过一次教训——如果备份时 profile 里装的正好是本包，
# 备份下来的就是"自己"，回滚会把新外壳又装回去（rev 不变、页面还是 launcher）。
# 所以：只在确认不是本包时才留底；优先从 dsh 安装目录取。
preserve_original() {
  if [ -e "$ORIG" ] && ! is_own_package "$ORIG"; then return 0; fi
  rm -rf "$ORIG"
  mkdir -p "$ORIG_DIR"
  for candidate in "${HOST_LAYOUT_DIR:-}" "$LINK"; do
    [ -n "$candidate" ] || continue
    [ -d "$candidate" ] || [ -L "$candidate" ] || continue
    if is_own_package "$candidate"; then continue; fi
    cp -R "$candidate" "$ORIG"
    if is_own_package "$ORIG"; then rm -rf "$ORIG"; continue; fi
    log_line "preserved-original=$ORIG from=$candidate"
    return 0
  done
  echo "找不到可留底的上游 layout 实现（设 HOST_LAYOUT_DIR 指向 dsh 安装目录里的 @deepseek-ai/dsh-client-ui-layout）；"
  echo "同名 drop-in 的回滚必须有它，已停止。" >&2
  exit 3
}

# 这份目录是不是我们自己的包（以客户端文件里的运行时标记为准，名字不可信——同名）
is_own_package() {
  [ -f "$1/client/client.js" ] || return 1
  grep -q "__DSH_LAUNCHER_SHELL__" "$1/client/client.js" 2>/dev/null
}



dsh_plugin() {
  if [ -n "${DSH_BIN:-}" ]; then
    "$DSH_BIN" plugin --profile "$PROFILE" "$@"
  elif command -v dsh >/dev/null 2>&1; then
    dsh plugin --profile "$PROFILE" "$@"
  else
    cat >&2 <<'MANUAL'
找不到 dsh 命令（设 DSH_BIN 指向 <dsh 安装>/lib/bin.js）。手工等价操作：
  1) cd <profile 目录>，在 package.json 的 dependencies 里加/删 "@deepseek-ai/dsh-client-ui-layout": "file:<本包绝对路径>"
  2) 在该目录跑 pnpm install
  3) 重启 dsh web 并硬刷新页面
MANUAL
    exit 3
  fi
}

# 宿主版本：优先 profile 里的 dsh 包，其次 dsh --version；读不到返回空（调用方退出 3）
host_version() {
  if [ -n "${HOST_VERSION_FILE:-}" ]; then
    "$NODE" -e 'const fs=require("node:fs");try{process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version??"")}catch{}' "$HOST_VERSION_FILE"
    return 0
  fi
  dsh_pkg="$PROFILE_DIR/node_modules/@deepseek-ai/dsh/package.json"
  if [ -f "$dsh_pkg" ]; then
    "$NODE" -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version??"")' "$dsh_pkg"
    return 0
  fi
  if [ -n "${DSH_BIN:-}" ]; then
    "$NODE" "$DSH_BIN" --version 2>/dev/null | head -1 | sed 's/^v//'
    return 0
  fi
  if command -v dsh >/dev/null 2>&1; then
    dsh --version 2>/dev/null | head -1 | sed 's/^v//'
  fi
}

package_version() {
  "$NODE" -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version??"")' "$PACKAGE_DIR/package.json"
}

# 版本锁（裁决 §1）：宿主 X ≠ 本包 Y 时拒绝安装，且不碰 manifest
require_version_lock() {
  lock_host=$(host_version)
  lock_own=$(package_version)
  if [ -z "$lock_host" ] || [ -z "$lock_own" ]; then
    echo "读不到版本（宿主 [$lock_host] / 本包 [$lock_own]），拒绝安装" >&2
    exit 3
  fi
  if [ "$lock_host" != "$lock_own" ]; then
    echo "宿主 $lock_host ≠ 本包 $lock_own，拒绝安装" >&2
    log_line "version-lock=REFUSED host=$lock_host package=$lock_own"
    exit 1
  fi
}

# 装之前的 package.json 与锁文件各留一份：native 要证明它们逐字回来了
# ② profile 的 dsh.profile.bundles：只写 ① 依赖时客户端模块图不枚举它，界面会"看起来像原生"


# 只在**没装本包**时留快照：装之前要有一个"干净原生"的基线，否则比的是上一次装了的状态
snapshot_state() {
  if "$NODE" -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(m.dependencies?.["@deepseek-ai/dsh-client-ui-layout"]===undefined?0:1)' "$MANIFEST"; then
    cp -p "$MANIFEST" "$STATE_DIR/package.json.snapshot"
    [ -f "$PROFILE_DIR/pnpm-lock.yaml" ] && cp -p "$PROFILE_DIR/pnpm-lock.yaml" "$STATE_DIR/pnpm-lock.snapshot"
  fi
  return 0
}

# 逐字一致做不到：`dsh plugin remove` 会把 package.json 按自己的 canonical 形态重写（键序/缩进变）。
# 判据改成"语义一致"：dependencies 与 dsh.profile.bundles 两项与装前快照相等即算回到装前。
compare_snapshot() {
  if [ ! -f "$STATE_DIR/package.json.snapshot" ]; then return 0; fi
  "$NODE" - "$MANIFEST" "$STATE_DIR/package.json.snapshot" <<'NODE_EOF'
const fs = require('node:fs')
const pick = (file) => {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  const deps = Object.fromEntries(Object.entries(m.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify({ deps, bundles: m.dsh?.profile?.bundles ?? [] })
}
const [now, before] = process.argv.slice(2)
if (pick(now) === pick(before)) process.stdout.write('SEMANTIC-OK\n')
else { process.stderr.write('SEMANTIC-DIFF\n'); process.exit(1) }
NODE_EOF
  if [ $? -eq 0 ]; then
    echo "package.json 语义与装前一致（依赖与 bundles）"
  else
    echo "警告：package.json 语义与装前不一致（依赖或 bundles 变了）" >&2
    log_line "native=manifest-semantic-diff"
  fi
}



set_bundle() {
  mode=$1
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, mode, name] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(m.dsh?.profile?.bundles) ? m.dsh.profile.bundles : null;
    if (list === null) process.exit(3);
    const next = list.filter((entry) => entry !== name);
    if (mode === "add") next.push(name);
    m.dsh.profile.bundles = next;
    fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  ' "$MANIFEST" "$mode" "$HOST_PACKAGE"
}

set_override() {
  mode=$1
  if [ "$mode" = "add" ]; then
    dsh_plugin add "@deepseek-ai/dsh-client-ui-layout@file:$PACKAGE_DIR" || return 1
    # 登记写在 plugin add 之后：先写会被 dsh 按 canonical 形态重写掉
    set_bundle add || return 1
    return 0
  fi
  set_bundle remove || true
  # 幂等：依赖已经不在了就不调 dsh plugin remove（否则 pnpm remove 会因为该依赖不存在而报错）
  if "$NODE" -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(m.dependencies?.["@deepseek-ai/dsh-client-ui-layout"]===undefined?0:1)' "$MANIFEST"; then
    return 0
  fi
  dsh_plugin remove "@deepseek-ai/dsh-client-ui-layout"
}

write_state() {
  mkdir -p "$(dirname "$STATE")"
  tmp="$STATE.tmp.$$"
  "$NODE" -e 'const fs=require("node:fs");const [f,v]=process.argv.slice(1);fs.writeFileSync(f,JSON.stringify({shell:v,updatedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600})' "$tmp" "$1"
  mv -f "$tmp" "$STATE"
}

read_state() {
  if [ ! -f "$STATE" ]; then echo native; return 0; fi
  "$NODE" -e 'const fs=require("node:fs");try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(d&&d.shell==="launcher"?"launcher":"native")}catch{process.stdout.write("native")}' "$STATE" 2>/dev/null || echo native
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
  expected=$1
  # "装的哪一版"用实现标记判，不用路径：pnpm 的 file: 安装是**拷贝**不是软链，realpath 永远是 profile 里的那份。
  if [ -f "$LINK/client/client.js" ] && grep -q "__DSH_LAUNCHER_SHELL__" "$LINK/client/client.js" 2>/dev/null; then
    installed=ours
  elif [ -e "$LINK" ]; then
    installed=host
  else
    installed=none
  fi
  case "$expected" in
    launcher)
      if [ "$installed" != "ours" ]; then
        echo "链向不符：launcher 期望 profile 里装的是本包，实际 ${installed}" >&2
        return 1
      fi ;;
    native)
      if [ "$installed" = "ours" ]; then
        echo "链向不符：native 但 profile 里装的仍是本包" >&2
        return 1
      fi ;;
  esac
  if [ -z "${DSH_URL:-}" ]; then
    echo "未提供 DSH_URL，无法断言页面（期望 $expected）" >&2
    return 3
  fi
  "$NODE" "$HERE/verify-shell.mjs" "$DSH_URL" "$expected"
}

link_target() {
  [ -L "$LINK" ] && readlink "$LINK" || echo "$LINK"
}

case "${1:-}" in
  status)
    echo "shell=$(read_state)"
    echo "profile=$PROFILE_DIR"
    echo "link=$(link_target)"
    "$NODE" -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write("dependency="+JSON.stringify(m.dependencies?.[process.argv[2]]??null)+"\n")' "$MANIFEST" "$HOST_PACKAGE" 2>/dev/null || echo "dependency=?"
    ;;
  launcher)
    require_profile
    require_version_lock
    snapshot_state
    cp -p "$MANIFEST" "$MANIFEST.bak.$$"
    if ! set_override add; then
      mv -f "$MANIFEST.bak.$$" "$MANIFEST"
      log_line "install=FAILED manifest=restored"
      echo "安装失败，profile 的 package.json 已还原，未生效" >&2
      exit 3
    fi
    rm -f "$MANIFEST.bak.$$"
    write_state launcher
    log_line "switch=launcher link=$LINK -> $PACKAGE_DIR"
    echo "已装本包：$HOST_PACKAGE -> $PACKAGE_DIR"
    restart_web || exit 3
    if ! verify_page launcher; then
      log_line "boot-self-check=FAILED fallback=native"
      printf '%s\n' "新外壳启动自检失败，自动回落原生（日志：$LOG）" >&2
      set_override remove
      write_state native
      restart_web || true
      exit 1
    fi
    log_line "boot-self-check=OK link=$(link_target)"
    ;;
  native)
    require_profile
    cp -p "$MANIFEST" "$MANIFEST.bak.$$"
    if ! set_override remove; then
      mv -f "$MANIFEST.bak.$$" "$MANIFEST"
      log_line "uninstall=FAILED manifest=restored"
      echo "卸载失败，profile 的 package.json 已还原，未生效" >&2
      exit 3
    fi
    rm -f "$MANIFEST.bak.$$"
    write_state native
    log_line "switch=native link=$(link_target)"
    echo "已卸回宿主实现（依赖移除）"
    compare_snapshot
    snapshot_state
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
