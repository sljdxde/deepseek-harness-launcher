#!/bin/sh
# shell-switch.sh —— 换壳开关（依赖模型）
#
# 裁决口径（2026-11-19，Super-agent；技术负责人落脚本）：
#   外壳 = 谁提供 @deepseek-ai/dsh-client-ui-layout 这个包。
#   launcher = profile 依赖用 `dependencies["@deepseek-ai/dsh-client-ui-layout"] = file:<本包>` +
#              在 dsh.profile.bundles 里登记本包（缺一客户端半区不进图）
#   native   = 删掉那条依赖（bundles 同名条目保留，解析回宿主自带包）
#   行 id / name / cordis.patch.yml 一个字不动；切换 = 改依赖 + pnpm install + 重启 + verify。
#   本脚本不含、也不再提 override 与软链——那两条口径已作废（05-§9 R1）。
#   备份一律写 /tmp/dsh-shell-<时间戳>/（web/ + ui-layout 原包 + 指纹），不落 profiles/ 下、不在 node_modules 里留 .orig。
#   日志字段：host=<v> pkg=<v> action=<..> verify=<一行 JSON> reason=<失败原因>
#
# 用法：
#   ./shell-switch.sh status            # 只读：依赖当前值 / bundles 登记 / dsh plugin 视角 / 版本锁判定
#   ./shell-switch.sh launcher          # 切到新外壳
#   ./shell-switch.sh native            # 切回原生
#   ./shell-switch.sh verify            # 断言页面特征（需要 DSH_URL）
#
# 环境变量：
#   PROFILE_DIR          profile 目录（默认 $DSH_HOME/profiles/web 或 ~/.dsh/profiles/web）
#   PKG_DIR              本包目录（默认与本脚本同级的 Plugins/DSHClientUILauncher）
#   DSH_URL              页面 URL（verify 用，含 token）
#   DSH_RESTART_CMD      重启钩子（默认打印、不重启；真机上配成实际命令）
#   PNPM                 pnpm 可执行（默认 pnpm）
#   ALLOW_UNVERIFIED=1   没有 DSH_URL 时允许 verify 记 SKIP 而不失败（仅 dry-run 用）
#   EXPECTED_HOST_VERSION 期望的宿主版本（默认 0.2.2-rc.5）
#
# 退出码：0 成功；2 版本锁；3 无法验证；4 依赖操作失败（已还原）；5 断言失败
set -eu

SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PKG_DIR=${PKG_DIR:-$(CDPATH= cd -- "$SELF_DIR/.." && pwd)}  # 默认就是本包目录（脚本在 <包>/scripts 下）
EXPECTED_HOST_VERSION=${EXPECTED_HOST_VERSION:-0.2.2-rc.5}
PNPM=${PNPM:-pnpm}
STATE_DIR_NAME=.shell-switch

log()  { printf '%s\n' "$*" >&2; }
die()  { code=$1; shift; log "错误：$*"; exit "$code"; }

# ---------- 定位 profile ----------
resolve_profile() {
  if [ -n "${PROFILE_DIR:-}" ]; then
    [ -d "$PROFILE_DIR" ] || die 4 "PROFILE_DIR 不存在：$PROFILE_DIR"
    printf '%s' "$PROFILE_DIR"; return 0
  fi
  for base in "${DSH_HOME:-}" "$HOME/.dsh"; do
    [ -n "$base" ] || continue
    if [ -d "$base/profiles/web" ]; then printf '%s' "$base/profiles/web"; return 0; fi
  done
  die 4 "找不到 profile 目录：请设 PROFILE_DIR"
}

PROFILE=$(resolve_profile)
PKG_JSON="$PROFILE/package.json"
LOCK="$PROFILE/pnpm-lock.yaml"
STATE="$PROFILE/$STATE_DIR_NAME"
# 备份：/tmp/dsh-shell-<时间戳>/（web 清单 + 宿主 layout 原包 + 指纹），不落在 profiles/ 里
BACKUP_ROOT=${BACKUP_ROOT:-/tmp/dsh-shell-$(date +%Y%m%d-%H%M%S)}
BASE_LOCK_HASH_FILE="$STATE/lockfile.before-launcher.sha256"

[ -f "$PKG_JSON" ] || die 4 "缺少 $PKG_JSON"

# ---------- JSON 读写（只用 node，避免 jq 依赖） ----------
NODE_BIN=${NODE_BIN:-node}
command -v "$NODE_BIN" >/dev/null 2>&1 || die 4 "找不到 node"

pkg_field() { # $1: dep | bundles | deps-all
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const p = process.argv[1], what = process.argv[2];
    let d; try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch { console.log(""); process.exit(0); }
    if (what === "dep") console.log((d.dependencies || {})["@deepseek-ai/dsh-client-ui-layout"] || "");
    else if (what === "bundles") console.log(((d.dsh?.profile?.bundles) || []).includes("@deepseek-ai/dsh-client-ui-layout") ? "yes" : "no");
    else if (what === "deps-all") console.log(JSON.stringify(d.dependencies || {}));
  ' "$PKG_JSON" "$1"
}

# 官方接口：dsh plugin add/remove（DSH_BIN 指向 <dsh>/lib/bin.js 时用 node 跑）
dsh_plugin_available() { [ -n "${DSH_BIN:-}" ] || command -v dsh >/dev/null 2>&1; }
dsh_plugin() {
  if [ -n "${DSH_BIN:-}" ]; then "$NODE_BIN" "$DSH_BIN" plugin --profile "$(basename "$PROFILE")" "$@"
  else dsh plugin --profile "$(basename "$PROFILE")" "$@"; fi
}

pkg_write_bundles() { # $1: add|remove —— 只动 dsh.profile.bundles，不碰 dependencies
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const [p, mode] = process.argv.slice(1);
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const NAME = "@deepseek-ai/dsh-client-ui-layout";
    doc.dsh = doc.dsh || {}; doc.dsh.profile = doc.dsh.profile || {};
    const b = doc.dsh.profile.bundles = doc.dsh.profile.bundles || [];
    const next = b.filter((x) => x !== NAME);
    if (mode === "add") next.push(NAME);
    doc.dsh.profile.bundles = next;
    fs.writeFileSync(p, JSON.stringify(doc, null, 2) + "\n");
  ' "$PKG_JSON" "$1"
}

pkg_write() { # $1: mode(add|remove)  $2: file: spec
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const [p, mode, spec] = process.argv.slice(1);
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const NAME = "@deepseek-ai/dsh-client-ui-layout";
    doc.dependencies = doc.dependencies || {};
    if (mode === "add") {
      doc.dependencies[NAME] = spec;
      doc.dsh = doc.dsh || {}; doc.dsh.profile = doc.dsh.profile || {};
      const b = doc.dsh.profile.bundles = doc.dsh.profile.bundles || [];
      if (!b.includes(NAME)) b.push(NAME);
    } else if (mode === "remove") {
      delete doc.dependencies[NAME];
      // bundles 里的同名字段保留（解析回宿主自带包），按裁决不动
    } else throw new Error("bad mode " + mode);
    fs.writeFileSync(p, JSON.stringify(doc, null, 2) + "\n");
  ' "$PKG_JSON" "$1" "${2:-}"
}

hash_file() { "$NODE_BIN" -e '
  const { createHash } = require("node:crypto"), fs = require("node:fs");
  const p = process.argv[1];
  if (!fs.existsSync(p)) { console.log("missing"); process.exit(0); }
  console.log(createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
' "$1"; }

# ---------- 版本锁 ----------
host_version() {
  # 测试接缝：指向一个 dsh 包目录或其中的 package.json 均可（真机不需要设）
  if [ -n "${HOST_VERSION_FILE:-}" ] && [ -f "$HOST_VERSION_FILE" ]; then
    "$NODE_BIN" -e 'const fs=require("node:fs");process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version||""))' "$HOST_VERSION_FILE"
    return 0
  fi
  if [ -n "${HOST_VERSION_FILE:-}" ] && [ -f "$HOST_VERSION_FILE/package.json" ]; then
    "$NODE_BIN" -e 'const fs=require("node:fs");process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version||""))' "$HOST_VERSION_FILE/package.json"
    return 0
  fi
  local p="$PROFILE/node_modules/@deepseek-ai/dsh/package.json"
  if [ -f "$p" ]; then
    "$NODE_BIN" -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).version||""))}catch{}' "$p"
    return 0
  fi
  if command -v dsh >/dev/null 2>&1; then dsh --version 2>/dev/null | tr -d '[:space:]' | sed 's/^v//'; return 0; fi
  printf ''
}

check_version_lock() {
  # 先走包内版本锁工具（包 version ↔ contracts/host-baseline.json 的宿主 ui-layout 版本）
  if [ -f "$PKG_DIR/tools/check-host-version.mjs" ]; then
    # 三方比对：把本脚本读到的宿主版本传进去（同一数据源，避免工具自己读不到时误判）
    if ! "$NODE_BIN" "$PKG_DIR/tools/check-host-version.mjs" --profile-dir "$PROFILE" --host-version "$(host_version)" >/dev/null 2>&1; then
      "$NODE_BIN" "$PKG_DIR/tools/check-host-version.mjs" --profile-dir "$PROFILE" --host-version "$(host_version)" >&2 || true
      die 2 "版本锁：宿主/基线/本包三方不一致，拒绝安装"
    fi
  fi
  local hv; hv=$(host_version)
  if [ -z "$hv" ]; then die 2 "版本锁：读不到宿主版本（$PROFILE/node_modules/@deepseek-ai/dsh/package.json 与 dsh --version 都不可用）"; fi
  local pv=""
  if [ -n "${PKG_DIR:-}" ] && [ -f "$PKG_DIR/package.json" ]; then
    pv=$("$NODE_BIN" -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).version||""))}catch{}' "$PKG_DIR/package.json")
  fi
  if [ "$hv" != "$EXPECTED_HOST_VERSION" ]; then
    die 2 "版本锁：宿主 $hv ≠ 期望 $EXPECTED_HOST_VERSION（拒绝安装；不静默用旧产物）"
  fi
  if [ -n "$pv" ] && [ "$pv" != "$hv" ]; then
    die 2 "版本锁：本包 version=$pv ≠ 宿主 version=$hv（拒绝安装，先构建对齐的版本）"
  fi
  HOST_V=$hv; PKG_V=${pv:-未读}
  printf '版本锁 OK：host=%s pkg=%s baseline=%s\n' "$hv" "${pv:-未读}" "$EXPECTED_HOST_VERSION"
}

# ---------- 重启钩子 ----------
# 备份：profile 清单 + 宿主 layout 原包 + 指纹，全部写 /tmp/dsh-shell-<时间戳>/
backup_now() {
  mkdir -p "$BACKUP_ROOT"
  if [ ! -d "$BACKUP_ROOT/web" ]; then
    mkdir -p "$BACKUP_ROOT/web"
    cp -p "$PKG_JSON" "$BACKUP_ROOT/web/package.json" 2>/dev/null || true
    [ -f "$LOCK" ] && cp -p "$LOCK" "$BACKUP_ROOT/web/pnpm-lock.yaml"
  fi
  local host_layout="$PROFILE/node_modules/@deepseek-ai/dsh-client-ui-layout"
  if [ ! -d "$BACKUP_ROOT/ui-layout" ] && [ -d "$host_layout" ] && ! grep -q '__DSH_LAUNCHER_SHELL__' "$host_layout/client/client.js" 2>/dev/null; then
    cp -R "$host_layout" "$BACKUP_ROOT/ui-layout"
  fi
  {
    printf 'package.json  %s\n' "$(hash_file "$PKG_JSON")"
    [ -f "$LOCK" ] && printf 'pnpm-lock     %s\n' "$(hash_file "$LOCK")"
    printf 'backup-root   %s\n' "$BACKUP_ROOT"
  } > "$BACKUP_ROOT/fingerprints.txt"
  log "备份：$BACKUP_ROOT（web/ + ui-layout 原包 + fingerprints.txt）"
}

restart_hook() {
  if [ -n "${DSH_RESTART_CMD:-}" ]; then
    log "→ 重启：$DSH_RESTART_CMD"
    sh -c "$DSH_RESTART_CMD"
  else
    log "→ 重启：未配置 DSH_RESTART_CMD（dry-run 模式，跳过；真机请配置成实际重启命令）"
  fi
}

# ---------- pnpm install（失败还原 package.json） ----------
install_with_restore() {
  local backup="$1"
  log "→ $PNPM install（cwd=$PROFILE）"
  if ! ( cd "$PROFILE" && "$PNPM" install --prefer-offline --no-frozen-lockfile >/dev/null 2>&1 ); then
    log "install 失败，正在还原 package.json"
    cp -f "$backup" "$PKG_JSON"
    local a b; a=$(hash_file "$backup"); b=$(hash_file "$PKG_JSON")
    [ "$a" = "$b" ] || die 4 "还原后 hash 不一致：$a ≠ $b（package.json 可能已被破坏）"
    die 4 "pnpm install 失败，已还原 package.json（hash=$a）"
  fi
  # 成功也校验一次备份未被破坏（防止 install 期间外部改动）
  [ -f "$backup" ] || die 4 "备份丢失：$backup"
}

# ---------- verify（headless Chrome；找不到 puppeteer 就明确 SKIP/失败） ----------
verify_page() { # $1 = launcher|native
  if [ -z "${DSH_URL:-}" ]; then
    if [ "${ALLOW_UNVERIFIED:-0}" = "1" ]; then log "verify SKIP：未提供 DSH_URL（ALLOW_UNVERIFIED=1）"; return 0; fi
    die 3 "verify 需要 DSH_URL（带 token 的页面地址）"
  fi
  # 判据用仓库里的 verify-shell.mjs：靠实现运行时标记 + [data-shell] 判"装的是哪一版"，
  # 不用 [data-slot="sidebar"]（实测两态都会出现，当判据会假阳性）。
  # 身份断言：profile 里装的到底是不是这份本包（realpath 与 client.js sha256 两条都要过）
  if [ -f "$PKG_DIR/tools/check-installed-identity.mjs" ]; then
    if ! "$NODE_BIN" "$PKG_DIR/tools/check-installed-identity.mjs" --profile-dir "$PROFILE" --package-dir "$PKG_DIR" --expect "$1" >&2; then
      die 5 "身份断言失败（$1）：装的不是期望的那份"
    fi
  fi
  if [ -x "$PKG_DIR/scripts/verify-shell.mjs" ] || [ -f "$PKG_DIR/scripts/verify-shell.mjs" ]; then
    if ! "$NODE_BIN" "$PKG_DIR/scripts/verify-shell.mjs" "$DSH_URL" "$1"; then
      # 身份已确认是我们这份、页面却还是旧壳：服务端模块缓存，必须重启，不算安装失败
      log "reason=stale-module-cache（身份正确但页面仍是旧壳，请重启 dsh web）"
      die 5 "壳层断言失败（$1）：疑似服务端模块缓存，重启后再验"
    fi
    return 0
  fi
  log "verify：找不到 $PKG_DIR/scripts/verify-shell.mjs"; die 3 "缺少断言脚本"
}

# ---------- 动作 ----------
do_launcher() {
  backup_now
  [ -n "$PKG_DIR" ] && [ -d "$PKG_DIR" ] || die 4 "找不到本包目录：PKG_DIR=$PKG_DIR"
  check_version_lock
  mkdir -p "$STATE"
  local backup="$STATE/package.json.before-launcher"
  cp -f "$PKG_JSON" "$backup"
  # 基线只在"从 native 切过去"时记录一次；重复 launcher 不能覆盖它（否则 native 比对失真）
  if [ -f "$LOCK" ] && [ "$(pkg_field dep)" = "" ]; then
    hash_file "$LOCK" > "$BASE_LOCK_HASH_FILE"
    log "记录 lockfile 基线：$(cat "$BASE_LOCK_HASH_FILE")"
  fi
  if dsh_plugin_available; then
    log "→ dsh plugin add @deepseek-ai/dsh-client-ui-layout@file:$PKG_DIR"
    if ! dsh_plugin add "@deepseek-ai/dsh-client-ui-layout@file:$PKG_DIR"; then
      cp -f "$backup" "$PKG_JSON"
      log "reason=dsh-plugin-add-failed restored=$PKG_JSON"
      die 4 "dsh plugin add 失败，已还原 package.json"
    fi
    pkg_write_bundles add || true
  else
    pkg_write add "file:$PKG_DIR"
    install_with_restore "$backup"
  fi
  restart_hook
  verify_page launcher
  log "launcher 完成：dependencies + bundles 已登记（patch/行未动）"
}

do_native() {
  backup_now
  local backup="$STATE/package.json.before-native"
  mkdir -p "$STATE"
  cp -f "$PKG_JSON" "$backup"
  if [ "$(pkg_field dep)" = "" ]; then
    log "native：dependencies 里已无该包（幂等，继续做 install/verify）"
  fi
  if dsh_plugin_available; then
    if dsh_plugin remove "@deepseek-ai/dsh-client-ui-layout"; then
      pkg_write_bundles remove || true
    else
      log "reason=dsh-plugin-remove-failed（依赖可能已不存在，继续）"
    fi
  else
    pkg_write remove
    install_with_restore "$backup"
  fi
  if [ -f "$BASE_LOCK_HASH_FILE" ] && [ -f "$LOCK" ]; then
    local want got; want=$(cat "$BASE_LOCK_HASH_FILE"); got=$(hash_file "$LOCK")
    if [ "$want" != "$got" ]; then die 4 "lockfile 与切换前不一致：want=$want got=$got（回原生未逐字还原）"; fi
    log "lockfile 校验：与切换前逐字一致（sha256=$got）"
  else
    log "lockfile 校验：缺少切换前基线，跳过（首次 native 时正常）"
  fi
  restart_hook
  verify_page native
  if [ -f "$backup" ] && ! cmp -s "$backup" "$PKG_JSON"; then
    if "$NODE_BIN" -e '
      const fs=require("node:fs");const [a,b]=process.argv.slice(1);
      const pick=(f)=>{const m=JSON.parse(fs.readFileSync(f,"utf8"));return JSON.stringify({d:Object.entries(m.dependencies||{}).sort(),b:m.dsh?.profile?.bundles??[]})};
      process.exit(pick(a)===pick(b)?0:1)' "$backup" "$PKG_JSON"; then
      cp -f "$backup" "$PKG_JSON"; log "package.json 语义一致但字节不同，已按备份逐字恢复"
    else
      log "reason=manifest-semantic-diff 未逐字恢复"
    fi
  fi
  log "native 完成：依赖已删除（bundles 条目保留，解析回宿主包）"
}

do_status() {
  printf 'profile            : %s\n' "$PROFILE"
  printf '本包目录           : %s\n' "${PKG_DIR:-未找到}"
  printf 'dependencies[layout]: %s\n' "$(pkg_field dep)"
  printf 'bundles 登记       : %s\n' "$(pkg_field bundles)"
  hv=$(host_version)
  printf '宿主版本           : %s（期望 %s）\n' "$hv" "$EXPECTED_HOST_VERSION"
  if [ "$hv" = "$EXPECTED_HOST_VERSION" ]; then printf '版本锁判定         : OK（可切换）\n'; else printf '版本锁判定         : 不匹配（安装会被拒绝，退出码 2）\n'; fi
  printf 'lockfile 基线      : %s\n' "$( [ -f "$BASE_LOCK_HASH_FILE" ] && cat "$BASE_LOCK_HASH_FILE" || echo "无")"
  printf 'patch/行            : 未改动（本脚本从不写 cordis.patch.yml）\n'
}

case "${1:-}" in
  launcher) do_launcher ;;
  native)   do_native ;;
  verify)   verify_page "${2:-launcher}" ;;
  status)   do_status ;;
  *) die 64 "用法：$0 <status|launcher|native|verify [launcher|native]>" ;;
esac
