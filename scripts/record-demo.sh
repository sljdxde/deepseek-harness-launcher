#!/bin/bash
# ============================================================
# DSH Launcher 演示动图录制脚本
# 用法：./scripts/record-demo.sh <安装|启动|运行|新功能>
#
# 依赖：
#   - screencapture（macOS 自带，无需安装）
#   - ffmpeg（已装于 /opt/homebrew/bin/ffmpeg）
#   - 或用你已有的 Snapzy 录屏后导出 .mov 放到同目录
#
# 输出：article/assets/demo-<环节>.gif
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$PROJECT_DIR/article/assets"
mkdir -p "$OUT_DIR"

SEG="${1:-}"
VALID_SEGMENTS=("安装" "启动" "运行" "新功能")

usage() {
  echo "用法：$0 <${VALID_SEGMENTS[*]// /|}>"
  echo ""
  echo "录制 DSH Launcher 四个演示环节的 GIF 动图："
  echo "  安装  首次启动的 dsh runtime 安装窗口与进度"
  echo "  启动  从菜单栏图标到 Harness 就绪的全流程"
  echo "  运行  日常使用：菜单栏操作、设置窗口、日志查看"
  echo "  新功能  归档管理面板 + 插件市场操作演示"
  echo ""
  echo "录制的视频会自动转换为 GIF 并放入 article/assets/"
  exit 1
}

# 验证参数
if [[ -z "$SEG" ]]; then
  usage
fi

VALID=0
for v in "${VALID_SEGMENTS[@]}"; do
  if [[ "$SEG" == "$v" ]]; then VALID=1; break; fi
done
if [[ "$VALID" -eq 0 ]]; then
  echo "❌ 未知环节: $SEG"
  echo "   可选: ${VALID_SEGMENTS[*]}"
  exit 1
fi

NAME="demo-${SEG}"
MOV="$OUT_DIR/${NAME}.mov"
GIF="$OUT_DIR/${NAME}.gif"

echo "============================================="
echo "  DSH Launcher 演示录制：${SEG}"
echo "============================================="
echo ""
echo "📹 步骤 1/2：录制屏幕"
echo "   请在弹出的选取框中拖选要录制的区域，"
echo "   然后点击「开始录制」；完成后按菜单栏 ▲ 停止。"
echo ""

# 使用 macOS 自带 screencapture 录制视频（交互式选区）
screencapture -v "$MOV"

if [[ ! -f "$MOV" || ! -s "$MOV" ]]; then
  echo "❌ 录制失败或文件为空: $MOV"
  exit 1
fi

echo ""
echo "✅ 视频已保存：$MOV ($(du -h "$MOV" | cut -f1))"
echo ""
echo "🎬 步骤 2/2：转换为 GIF ..."

# ffmpeg 转换：调色板生成 + 高质量 GIF
FFMPEG="/opt/homebrew/bin/ffmpeg"
if [[ ! -x "$FFMPEG" ]]; then
  FFMPEG="ffmpeg"
fi

"$FFMPEG" -y -i "$MOV" \
  -vf "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 "$GIF" 2>/dev/null

if [[ -f "$GIF" && -s "$GIF" ]]; then
  echo "✅ GIF 已生成：$GIF ($(du -h "$GIF" | cut -f1))"
  echo ""
  echo "📌 下一步：把此 GIF 上传到公众号编辑器，替换文章中"
  echo "   「效果展示」章节对应的【插入：${SEG}流程演示 GIF】占位。"
else
  echo "❌ GIF 转换失败，请检查 ffmpeg 输出"
  exit 1
fi
