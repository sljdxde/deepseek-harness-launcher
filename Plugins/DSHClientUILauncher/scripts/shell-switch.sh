#!/bin/sh
# 壳层开关（新 05-§9 R1 定稿口径：持久层 override + 即时层链接，两者都要）。
#
#   持久层：profile 的 package.json 里 pnpm.overrides 决定「重新 install 后解析到谁」
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
preserve_original() {
  if [ -e "$ORIG" ] || [ -L "$ORIG" ]; then return 0; fi
  mkdir -p "$ORIG_DIR"
  if [ -L "$LINK" ]; then
    target=$(readlink "$LINK")
    cp -R "$PROFILE_DIR/$target" "$ORIG" 2>/dev/null || cp -R "$target" "$ORIG"
  else
    cp -R "$LINK" "$ORIG"
  fi
  log_line "preserved-original=$ORIG"
}

point_link() {
  target=$1
  mkdir -p "$(dirname "$LINK")"
  if [ -L "$LINK" ]; then rm -f "$LINK"; elif [ -d "$LINK" ]; then mv "$LINK" "$LINK.dsh-$(date +%s)"; fi
  ln -s "$target" "$LINK"
}

set_override() {
  mode=$1
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, mode, name, target] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    m.pnpm = m.pnpm ?? {};
    m.pnpm.overrides = m.pnpm.overrides ?? {};
    if (mode === "add") m.pnpm.overrides[name] = `file:${target}`;
    else delete m.pnpm.overrides[name];
    if (Object.keys(m.pnpm.overrides).length === 0) delete m.pnpm.overrides;
    if (Object.keys(m.pnpm).length === 0) delete m.pnpm;
    fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  ' "$MANIFEST" "$mode" "$HOST_PACKAGE" "$PACKAGE_DIR"
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
  # 先断言"当前链向"（即时层），再看页面：链向不对时页面即使能开也不是期望的那一版。
  actual=$(link_target)
  case "$expected" in
    launcher) wanted=$PACKAGE_DIR ;;
    native) wanted=$ORIG ;;
    *) wanted='' ;;
  esac
  if [ -n "$wanted" ] && [ "$actual" != "$wanted" ]; then
    echo "链向不符：期望 $wanted，实际 $actual" >&2
    return 1
  fi
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
    "$NODE" -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write("override="+JSON.stringify(m.pnpm?.overrides?.[process.argv[2]]??null)+"\n")' "$MANIFEST" "$HOST_PACKAGE" 2>/dev/null || echo "override=?"
    ;;
  launcher)
    require_profile
    preserve_original
    set_override add
    point_link "$PACKAGE_DIR"
    write_state launcher
    log_line "switch=launcher link=$LINK -> $PACKAGE_DIR"
    echo "链接已指向本包：$LINK -> $PACKAGE_DIR（override 已写）"
    restart_web || exit 3
    if ! verify_page launcher; then
      log_line "boot-self-check=FAILED fallback=native"
      printf '%s\n' "新外壳启动自检失败，自动回落原生（日志：$LOG）" >&2
      set_override remove
      point_link "$ORIG"
      write_state native
      restart_web || true
      exit 1
    fi
    log_line "boot-self-check=OK link=$(link_target)"
    ;;
  native)
    require_profile
    set_override remove
    if [ -e "$ORIG" ] || [ -L "$ORIG" ]; then
      point_link "$ORIG"
    fi
    write_state native
    log_line "switch=native link=$(link_target)"
    echo "链接已指回原包：$LINK -> $(link_target)"
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
