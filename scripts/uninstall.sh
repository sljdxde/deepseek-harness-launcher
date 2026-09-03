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

remove_dsh_runtime() {
  local path
  # 保留正式 runtime：~/.dsh/runtime/node_modules 里是 DeepSeek Harness 的完整
  # npm 依赖树，删除后下次启动会重新下载并可能被误判为「首次安装」。只有更新
  # dsh（launcher 检测到版本差异时）才重建 runtime。这里只清理中断/残留的
  # 临时安装目录。
  for path in "$HOME/.dsh"/runtime.installing-*(N) "$HOME/.dsh"/runtime.previous-*(N); do
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

PLUGIN_LINK="$HOME/.dsh/profiles/web/node_modules/dsh-archive-manager"
if [[ -L "$PLUGIN_LINK" ]]; then
  TARGET="$(readlink "$PLUGIN_LINK" || true)"
  if [[ "$TARGET" == *"DSHArchiveManager"* ]]; then /bin/rm -f "$PLUGIN_LINK"; echo "Removed plugin link $PLUGIN_LINK"; fi
fi
echo "Deepseek Harness Launcher 的 ~/.dsh 数据保持不变。"
