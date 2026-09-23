#!/bin/bash
# DHL 宣传视频 v4 拼接脚本（分镜稿 v4：四幕 18 镜，S12 拆 4 段 → 21 段 ~95s）
# 用法: bash build_v4.sh [vdir]
# 特性: xfade 淡入淡出转场、ASS 浅蓝白字幕、BGM+旁白混音、顶部横幅+底部 Dock 裁切
set -e
if [ -x /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg ]; then
  FF=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
  FP=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe
else
  FF=/opt/homebrew/bin/ffmpeg
  FP=/opt/homebrew/bin/ffprobe
fi
"$FF" -hide_banner -filters 2>/dev/null | grep -q "ass" || { echo "ABORT: ffmpeg 无 ass 字幕滤镜(需 ffmpeg-full)"; exit 1; }
VDIR="${1:-/Users/yuzhou/004个人代码仓库/dsh-launcher/.video_agent}"
SHOTS="$VDIR/shots"; GFX="$VDIR/gfx"; AUD="$VDIR/audio"; OUT="$VDIR"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
FONT="/System/Library/Fonts/Hiragino Sans GB.ttc"
W=1280; H=720; FPS=30; XFD=0.3

# crop: 顶部避豆包横幅(170px)，底部避 Dock(留 160px)。4K=3840x2160 → crop=3555:1830:142:170
CROP="crop=3555:1830:142:170"

# ---------- 镜头清单（分镜稿v4；S12 拆 4 段：检测→市场安装→卸载→确认） ----------
# 格式: 类型:路径，类型 c=静态卡 v=录屏
declare -a SRC=(
  "c:$GFX/gfx_08_teaser.png"        # S01 开场 Teaser 3.5
  "v:$SHOTS/v4_s02_github.mp4"      # S02 GitHub 仓库页 4.0
  "v:$SHOTS/v4_s03_releases.mp4"    # S03 Releases 页 4.0
  "v:$SHOTS/v4_s04_dmg.mp4"         # S04 Finder/DMG 4.0
  "v:$SHOTS/v4_s05_menubar.mp4"     # S05 菜单栏图标 3.0
  "v:$SHOTS/v4_s06_menu.mp4"        # S06 菜单展开 3.5
  "v:$SHOTS/v4_s07_open.mp4"        # S07 打开 Harness 4.0
  "v:$SHOTS/v4_s08_chat.mp4"        # S08 真实对话 6.0
  "v:$SHOTS/v4_s09_badge.mp4"       # S09 会话完成角标 3.5
  "v:$SHOTS/v4_s10_archive_select.mp4"  # S10 归档管理 8.0
  "v:$SHOTS/v4_s11_archive_confirm.mp4" # S11 二次确认删除 4.0
  "v:$SHOTS/v4_s12a_plugin_check.mp4"   # S12a 版本检测 5.0
  "v:$SHOTS/v4_s12d_install.mp4"        # S12b 市场搜索安装 7.0
  "v:$SHOTS/v4_s12e_uninstall.mp4"      # S12c 卸载确认 5.0
  "v:$SHOTS/v4_s12f_uninstall_confirm.mp4" # S12d 确认卸载 4.0
  "v:$SHOTS/v4_s13_update_check.mp4"   # S13 更新检查 5.0
  "v:$SHOTS/v4_s14_logs.mp4"           # S14 日志查看 5.0
  "v:$SHOTS/v4_s15_restart.mp4"        # S15 生命周期重启 5.0
  "v:$SHOTS/v4_s16a_harness_settings.mp4" # S16 原生设置 4.0
  "c:$GFX/gfx_05_infocard.png"      # S17 总结卡 4.0
  "c:$GFX/gfx_15_outro.png"         # S18 Outro 4.0
)
declare -a DUR=(3.5 4.0 4.0 4.0 3.0 3.5 4.0 6.0 3.5 8.0 4.0 5.0 7.0 5.0 4.0 5.0 5.0 5.0 4.0 4.0 4.0)
N=${#SRC[@]}

# ---------- 字幕文案（每镜一句） ----------
declare -a SUB=(
  "在 Mac 上跑 DeepSeek Harness，还停在命令行？"
  "开源项目 Deepseek Harness Launcher，原生菜单栏启动器"
  "下载 DMG，一步装好"
  "拖进 Applications，打开即用"
  "原生 macOS 菜单栏启动器"
  "鼠标一点，服务就绪"
  "自动拉起 dsh 服务，打开浏览器"
  "直接开聊，编码 Agent 帮你干活"
  "会话完成，角标提醒，点击直达现场"
  "归档管理，会话收纳，清理一次搞定"
  "删除前二次确认，防误删"
  "插件版本自动检测，更新不迷路"
  "插件市场，搜索即得，一键安装"
  "卸载二次确认，防误操作"
  "装卸闭环，插件生态开放"
  "内置更新检查，新版本不迷路"
  "完整日志，出问题有据可查"
  "dsh 服务生命周期，一键重启"
  "原生设置：自动启动、更新检查全都有"
  "原生 · 轻量 · 开源，让 Harness 在 Mac 上更好用"
  "开源地址见简介，Star 支持一下"
)

echo "== [1/5] 素材存在性检查 =="
MISS=0
for f in "$AUD/vo_v4_1.wav" "$AUD/vo_v4_2.wav" "$AUD/bgm.wav"; do
  [ -f "$f" ] || { echo "MISSING: $f"; MISS=1; }
done
for i in "${!SRC[@]}"; do
  typ=${SRC[$i]%%:*}; path=${SRC[$i]#*:}
  [ -f "$path" ] || { echo "MISSING: $path"; MISS=1; }
done
[ $MISS -eq 1 ] && { echo "ABORT: 必需素材缺失（新镜头录制后补齐）"; exit 1; }

echo "== [2/5] 片段统一化（目标时长: ${DUR[*]}） =="
SEG=()
for i in "${!SRC[@]}"; do
  typ=${SRC[$i]%%:*}; path=${SRC[$i]#*:}; t=${DUR[$i]}
  out="$WORK/seg$(printf '%02d' $i).mp4"
  if [ "$typ" = "c" ]; then
    $FF -y -v error -loop 1 -i "$path" -t "$t" -vf "scale=$W:$H:force_original_aspect_ratio=decrease,pad=$W:$H:(ow-iw)/2:(oh-ih)/2,fps=$FPS,format=yuv420p" -an -c:v libx264 -preset fast -crf 18 "$out"
  else
    sd=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$path")
    sc=$(echo "$sd / $t" | bc -l)
    $FF -y -v error -i "$path" -vf "$CROP,scale=$W:$H:force_original_aspect_ratio=decrease,pad=$W:$H:(ow-iw)/2:(oh-ih)/2,setpts=PTS/$sc,fps=$FPS,format=yuv420p" -an -c:v libx264 -preset fast -crf 18 "$out"
  fi
  SEG+=("$out")
done

echo "== [3/5] xfade 拼接（转场 $XFD s） =="
DURS=()
for s in "${SEG[@]}"; do d=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$s"); DURS+=("$d"); done
CMD="$FF -y"
INP=()
for i in "${!SEG[@]}"; do CMD="$CMD -i ${SEG[$i]}"; INP+=("[$i:v]"); done
FILTER=""; PREV=""; OFF=0.0
for i in "${!SEG[@]}"; do
  if [ $i -eq 0 ]; then
    FILTER="${INP[$i]}format=yuv420p[v0];"; PREV="[v0]"
  else
    dur=${DURS[$((i-1))]}
    OFF=$(echo "$OFF + $dur - $XFD" | bc -l)
    FILTER="$FILTER ${PREV}${INP[$i]}xfade=transition=fade:duration=$XFD:offset=$OFF[v$i];"
    PREV="[v$i]"
  fi
done
LAST=$(( ${#SEG[@]} - 1 ))
CMD="$CMD -filter_complex \"${FILTER}\" -map \"[v$LAST]\" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -r $FPS $WORK/video_only.mp4"
eval "$CMD"

echo "== [4/5] 混音 + 字幕 =="
VID="$WORK/video_only.mp4"
python3 - "$WORK/sub.ass" "${DUR[@]}" <<'PYEOF'
import sys
out, durs = sys.argv[1], [float(x) for x in sys.argv[2:]]
subs = [
"在 Mac 上跑 DeepSeek Harness，还停在命令行？",
"开源项目 Deepseek Harness Launcher，原生菜单栏启动器",
"下载 DMG，一步装好",
"拖进 Applications，打开即用",
"原生 macOS 菜单栏启动器",
"鼠标一点，服务就绪",
"自动拉起 dsh 服务，打开浏览器",
"直接开聊，编码 Agent 帮你干活",
"会话完成，角标提醒，点击直达现场",
"归档管理，会话收纳，清理一次搞定",
"删除前二次确认，防误删",
"插件版本自动检测，更新不迷路",
"插件市场，搜索即得，一键安装",
"卸载二次确认，防误操作",
"装卸闭环，插件生态开放",
"内置更新检查，新版本不迷路",
"完整日志，出问题有据可查",
"dsh 服务生命周期，一键重启",
"原生设置：自动启动、更新检查全都有",
"原生 · 轻量 · 开源，让 Harness 在 Mac 上更好用",
"开源地址见简介，Star 支持一下",
]
XFD = 0.3
def ts(t):
    h=int(t//3600); m=int(t%3600//60); s=t%60
    return f"{h}:{m:02d}:{s:05.2f}"
lines = []
off = 0.0
for i, d in enumerate(durs):
    if i > 0: off += durs[i-1] - XFD
    start = max(0.0, off + 0.25)
    end = off + d - 0.25
    lines.append(f"Dialogue: 0,{ts(start)},{ts(end)},Sub,,0,0,0,,{subs[i]}")
head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Hiragino Sans GB,52,&H00601F38,&H00FFFFFF,&H00FFFFFF,&H96000000,0,0,0,0,100,100,0,0,1,3,0,2,60,60,54,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
with open(out, "w") as f:
    f.write(head)
    f.write("\n".join(lines) + "\n")
print(f"ASS 字幕已生成: {len(lines)} 句")
PYEOF

V1DUR=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$AUD/vo_v4_1.wav")
$FF -y -v error -i "$AUD/vo_v4_1.wav" -i "$AUD/vo_v4_2.wav" -i "$AUD/bgm.wav" -filter_complex \
  "[1:a]adelay=$(python3 -c "print(int($V1DUR*1000))"):all=1[s2];[0:a]volume=1.0[v1];[s2]volume=1.0[v2];[2:a]volume=0.30,apad[bg];[v1][v2][bg]amix=inputs=3:duration=longest:dropout_transition=0,apad[a]" \
  -map "[a]" -c:a pcm_s16le -t 120 "$WORK/audio_full.wav"
VDUR=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VID")
$FF -y -v error -i "$VID" -i "$WORK/audio_full.wav" \
  -vf "subtitles=$WORK/sub.ass" -af "volume=6dB" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest "$OUT/dhl_intro_v4.mp4"

echo "== [5/5] 输出验证 =="
OUTD=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT/dhl_intro_v4.mp4")
echo "成片时长: $OUTD s"
echo "OUTPUT: $OUT/dhl_intro_v4.mp4"
