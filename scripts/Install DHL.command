#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="${DHL_INSTALL_DIR:-${DSH_INSTALL_DIR:-}}"

if [[ -z "$DEST" ]]; then
  if [[ -d "/Applications/Deepseek Harness Launcher.app" || -d /Applications/DHL.app || -d /Applications/DSH.app || -w /Applications ]]; then
    DEST=/Applications
  else
    DEST="$HOME/Applications"
  fi
fi

if [[ ! -w "$DEST" && ! -w "$(dirname "$DEST")" ]]; then
  # 提权分支必须和「双击完成安装或更新.app」用同一套参数与转义，否则两条安装路径会分叉：
  # - `DHL_USER_HOME`：脚本以 root 运行时 $HOME 会变成 /var/root，脚本里所有「按用户目录」
  #   的处理（旧 runtime 清理、cleanup_dirs 里的 ~/Applications）就打错目标；
  # - `--no-open`：不能以 root 身份 `open` 用户的 App（会把 ~/Library 里的日志/偏好写成
  #   root 属主，用户下次自己启动时静默失败）；提权结束后再由当前用户打开。
  # - 转义：`printf %q` 已经会处理空格，绝不能再手动包一层 `\"…\"`——那样 DMG 卷名里的空格
  #   （/Volumes/Deepseek Harness Launcher）会变成字符串里的 `\ `，root 的 /bin/sh 在双引号内
  #   不认这个转义，路径直接找不到，提权安装必然失败。
  command="DHL_USER_HOME=$(printf '%q' "$HOME") $(printf '%q ' \
    "$SCRIPT_DIR/.install-from-app.sh" "$SCRIPT_DIR/Deepseek Harness Launcher.app" "$DEST" --no-open)"
  # AppleScript 字符串字面量只认 \" 与 \\，先补这两处反斜杠再交给 do shell script。
  escaped=${command//\\/\\\\}
  escaped=${escaped//\"/\\\"}
  osascript -e "do shell script \"$escaped\" with administrator privileges"
  open "$DEST/Deepseek Harness Launcher.app"
  exit 0
fi

exec "$SCRIPT_DIR/.install-from-app.sh" "$SCRIPT_DIR/Deepseek Harness Launcher.app" "$DEST"
