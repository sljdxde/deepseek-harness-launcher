#!/bin/zsh
set -euo pipefail

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
CANDIDATE_DIRS=(
  "${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}"
  "$HOME/Applications"
  "/Applications"
)

cleanup_legacy_volumes() {
  local volume
  for volume in /Volumes/*(N); do
    [[ -d "$volume" ]] || continue
    case "${volume:t}" in
      DHL|DSH|Deepseek*Harness*Launcher*) ;;
      *) continue ;;
    esac
    hdiutil detach "$volume" -force >/dev/null 2>&1 || true
  done
}

managed_dsh_pids() {
  local runtime_dsh="$HOME/.dsh/runtime/node_modules/.bin/dsh"
  local runtime_staging="$HOME/.dsh/runtime.installing-"
  ps -axo pid=,state=,command= | awk -v runtime_dsh="$runtime_dsh" -v runtime_staging="$runtime_staging" \
    '$2 !~ /^Z/ { executable = ($3 == "npm" || $3 == "node" || $3 == "dsh" || $3 ~ /\/(npm|node|dsh)$/); if (executable && (index($0, runtime_dsh) || index($0, runtime_staging))) print $1 }'
}

stop_managed_dsh() {
  local pids pid
  pids="$(managed_dsh_pids)"
  [[ -z "$pids" ]] && return 0
  while read -r pid; do
    [[ -z "$pid" || "$pid" == "$$" ]] && continue
    kill -TERM "$pid" 2>/dev/null || true
  done <<< "$pids"
  sleep 1
  pids="$(managed_dsh_pids)"
  [[ -z "$pids" ]] && return 0
  while read -r pid; do
    [[ -z "$pid" || "$pid" == "$$" ]] && continue
    kill -KILL "$pid" 2>/dev/null || true
  done <<< "$pids"
}

unregister_legacy_paths() {
  local path
  while IFS= read -r path; do
    [[ -n "$path" ]] && "$LSREGISTER" -u "$path" >/dev/null 2>&1 || true
  done < <("$LSREGISTER" -dump 2>/dev/null | /usr/bin/sed -n \
    's/^path:[[:space:]]*\(.*\.DHL-payload\.app\) ([^)]*)$/\1/p; s/^path:[[:space:]]*\(.*\.Deepseek Harness Launcher-payload\.app\) ([^)]*)$/\1/p')
}

remove_apps() {
  local path
  for path in \
    "${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}/Deepseek Harness Launcher.app" \
    "$HOME/Applications/Deepseek Harness Launcher.app" \
    "/Applications/Deepseek Harness Launcher.app" \
    "${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-$HOME/Applications}}/DHL.app" \
    "$HOME/Applications/DHL.app" \
    "/Applications/DHL.app" \
    "$HOME/Applications/DSH.app" \
    "/Applications/DSH.app"; do
    if [[ -e "$path" ]]; then
      "$LSREGISTER" -u "$path" >/dev/null 2>&1 || true
      /bin/rm -rf "$path"
      echo "Removed $path"
    fi
  done
}

remove_backups() {
  local dir path
  for dir in "${CANDIDATE_DIRS[@]}"; do
    [[ -d "$dir" ]] || continue
    while IFS= read -r -d '' path; do
      /bin/rm -rf "$path"
      echo "Removed backup $path"
    done < <(/usr/bin/find "$dir" -maxdepth 1 -type d \( \
      -name 'Deepseek Harness Launcher.app.backup-*' -o \
      -name 'DHL.app.backup-*' -o \
      -name 'DSH.app.backup-*' \
    \) -print0 2>/dev/null || true)
  done
}

latest_runtime_snapshot() {
  # 最新的在前：zsh 的时间排序限定符里 om 是新→旧（实测 Om 反而old→new），
  # 取第一个就是最新那份快照。
  local -a snapshots
  snapshots=("$HOME/.dsh"/runtime.previous-*(N-/om))
  [[ ${#snapshots[@]} -gt 0 ]] || return 1
  printf '%s\n' "${snapshots[1]}"
}

restore_interrupted_runtime() {
  # 上次更新在替换 runtime 的中途被打断时，正式 runtime 会只剩一份快照
  # （runtime.previous-*）。那是用户手上唯一一份能跑的环境：先换回正式位置，
  # 绝不能当残留删掉——删了下次打开启动器只能联网重装一份。
  # 用绝对路径调用 mv：本文件里的 `local path` 会把 zsh 里与 PATH 绑定的
  # path 数组局部化，作用域内的 PATH 因此是空的，裸命令一律找不到。
  [[ -e "$HOME/.dsh/runtime" ]] && return 0
  local snapshot
  snapshot="$(latest_runtime_snapshot)" || return 0
  if /bin/mv "$snapshot" "$HOME/.dsh/runtime" 2>/dev/null; then
    echo "Restored dsh runtime from interrupted-update snapshot: $snapshot"
  fi
}

remove_dsh_runtime() {
  local path runtime_present=0
  restore_interrupted_runtime
  [[ -e "$HOME/.dsh/runtime" ]] && runtime_present=1
  # 保留正式 runtime：~/.dsh/runtime/node_modules 里是 DeepSeek Harness 的完整
  # npm 依赖树，删除后下次启动会重新下载并可能被误判为「首次安装」。只有更新
  # dsh（launcher 检测到版本差异时）才重建 runtime。这里只清理中断/残留的
  # 临时安装目录。
  for path in "$HOME/.dsh"/runtime.installing-*(N) "$HOME/.dsh"/runtime.broken-*(N); do
    [[ -e "$path" ]] || continue
    /bin/rm -rf "$path"
    echo "Removed dsh runtime residue $path"
  done
  # 只有正式 runtime 已经在位，剩下的 previous-* 才是旧快照；否则它是用户
  # 唯一一份运行环境（上面的恢复没成功），必须留着。
  [[ "$runtime_present" == 1 ]] || return 0
  for path in "$HOME/.dsh"/runtime.previous-*(N); do
    [[ -e "$path" ]] || continue
    /bin/rm -rf "$path"
    echo "Removed dsh runtime residue $path"
  done
}

cleanup_legacy_volumes
unregister_legacy_paths
stop_managed_dsh
remove_apps
remove_backups
remove_dsh_runtime

# Only remove links that still point into one of our app bundles; anything
# else is a user-installed plugin with the same name and must be preserved.
for PLUGIN_SPEC in "dsh-archive-manager:DSHArchiveManager" "dsh-plugin-manager:DSHPluginManager" "dsh-session-notify:DSHSessionNotify"; do
  PLUGIN_NAME="${PLUGIN_SPEC%%:*}"
  PLUGIN_MARKER="${PLUGIN_SPEC##*:}"
  for MODULES_DIR in "$HOME/.dsh/profiles/web/node_modules" "$HOME/.dsh/profiles/node_modules"; do
    PLUGIN_LINK="$MODULES_DIR/$PLUGIN_NAME"
    if [[ -L "$PLUGIN_LINK" ]]; then
      TARGET="$(readlink "$PLUGIN_LINK" || true)"
      if [[ "$TARGET" == *"$PLUGIN_MARKER"* ]]; then /bin/rm -f "$PLUGIN_LINK"; echo "Removed plugin link $PLUGIN_LINK"; fi
    fi
  done
done
echo "Deepseek Harness Launcher 的 ~/.dsh 数据保持不变。"
