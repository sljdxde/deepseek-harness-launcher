#!/bin/bash
# DHL 宣传视频 30s 拼接脚本（分镜稿 v2 + 浅蓝白包装风）
# 用法: bash build.sh <vdir>
# 每个片段按目标时长 setpts 加速/减速，13 片段填满 ~29.5s，字幕按镜头边界校准
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
SHOTS="$VDIR/shots"
GFX="$VDIR/gfx"
AUD="$VDIR/audio"
OUT="$VDIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FONT="/System/Library/Fonts/Hiragino Sans GB.ttc"
W=1280; H=720; FPS=30

# prep <in> <out> <t>  统一为 1280x720@30，裁掉顶部菜单栏/豆包横幅(4K:160px)并裁16:9，setpts 加速到目标时长 t
prep() {
  local in=$1 out=$2 t=$3
  local sd=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$in")
  local sc=$(echo "$sd / $t" | bc -l)
  $FF -y -v error -i "$in" -vf "crop=3555:2000:142:160,scale=$W:$H:force_original_aspect_ratio=decrease,pad=$W:$H:(ow-iw)/2:(oh-ih)/2,setpts=$sc*PTS,fps=$FPS,format=yuv420p" -an -c:v libx264 -preset fast -crf 18 "$out"
}
card() { # card <png> <t> <out> 静态图转片段
  $FF -y -v error -loop 1 -i "$1" -t "$2" -vf "scale=$W:$H:force_original_aspect_ratio=decrease,pad=$W:$H:(ow-iw)/2:(oh-ih)/2,fps=$FPS,format=yuv420p" -an -c:v libx264 -preset fast -crf 18 "$3"
}

echo "== [1/5] 素材存在性检查 =="
MISS=0
for f in "$AUD/vo_s1.wav" "$AUD/vo_s2.wav" "$AUD/bgm.wav" "$GFX/gfx_05_infocard.png" "$GFX/gfx_08_teaser.png" "$GFX/gfx_15_outro.png"; do
  [ -f "$f" ] || { echo "MISSING: $f"; MISS=1; }
done
REAL_SHOTS=("$SHOTS/shot01_terminal.mp4" "$SHOTS/shot02_launch.mp4" "$SHOTS/shot03_menubar.mp4" "$SHOTS/shot04_browser.mp4" "$SHOTS/shot09_archive.mp4" "$SHOTS/shot10_confirm.mp4" "$SHOTS/shot11_plugin.mp4" "$SHOTS/shot12_badge.mp4" "$SHOTS/shot13_back.mp4" "$SHOTS/shot14_settings.mp4")
for f in "${REAL_SHOTS[@]}"; do
  [ -f "$f" ] || { echo "MISSING: $f"; MISS=1; }
done
[ $MISS -eq 1 ] && { echo "ABORT: 必需素材缺失"; exit 1; }

echo "== [2/5] 视频片段统一化(目标时长: 1/2/3/4/5/8/9/10/11/12/13/14/15) =="
SEG=()
prep "$SHOTS/shot01_terminal.mp4" "$WORK/seg01.mp4" 3.1; SEG+=("$WORK/seg01.mp4")
prep "$SHOTS/shot02_launch.mp4" "$WORK/seg02.mp4" 2.0; SEG+=("$WORK/seg02.mp4")
prep "$SHOTS/shot03_menubar.mp4" "$WORK/seg03.mp4" 3.1; SEG+=("$WORK/seg03.mp4")
prep "$SHOTS/shot04_browser.mp4" "$WORK/seg04.mp4" 2.7; SEG+=("$WORK/seg04.mp4")
card "$GFX/gfx_05_infocard.png" 2.7 "$WORK/seg05.mp4"; SEG+=("$WORK/seg05.mp4")
card "$GFX/gfx_08_teaser.png" 1.2 "$WORK/seg08.mp4"; SEG+=("$WORK/seg08.mp4")
prep "$SHOTS/shot09_archive.mp4" "$WORK/seg09.mp4" 3.1; SEG+=("$WORK/seg09.mp4")
prep "$SHOTS/shot10_confirm.mp4" "$WORK/seg10.mp4" 2.7; SEG+=("$WORK/seg10.mp4")
prep "$SHOTS/shot11_plugin.mp4" "$WORK/seg11.mp4" 3.1; SEG+=("$WORK/seg11.mp4")
prep "$SHOTS/shot12_badge.mp4" "$WORK/seg12.mp4" 2.3; SEG+=("$WORK/seg12.mp4")
prep "$SHOTS/shot13_back.mp4" "$WORK/seg13.mp4" 2.3; SEG+=("$WORK/seg13.mp4")
prep "$SHOTS/shot14_settings.mp4" "$WORK/seg14.mp4" 2.0; SEG+=("$WORK/seg14.mp4")
card "$GFX/gfx_15_outro.png" 2.7 "$WORK/seg15.mp4"; SEG+=("$WORK/seg15.mp4")

echo "可用片段: ${#SEG[@]} 个"
echo "== [3/5] 片段拼接(xfade 淡入淡出) =="
DURS=()
for s in "${SEG[@]}"; do d=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$s"); DURS+=("$d"); done
XFD=0.3
CMD="$FF -y"
INP=()
for i in "${!SEG[@]}"; do CMD="$CMD -i ${SEG[$i]}"; INP+=("[$i:v]"); done
FILTER=""
PREV=""
OFF=0.0
for i in "${!SEG[@]}"; do
  if [ $i -eq 0 ]; then
    FILTER="${INP[$i]}format=yuv420p[v0];"
    PREV="[v0]"
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
VDUR=$($FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VID")
# 旁白: S1 从0开始 + S2(加速到<=15s)从14.68s接续 + BGM 音量0.3
$FF -y -v error -i "$AUD/vo_s1.wav" -i "$AUD/vo_s2.wav" -i "$AUD/bgm.wav" -filter_complex \
  "[1:a]atempo=1.14,adelay=14680:all=1[s2];[0:a]volume=1.0[v1];[s2]volume=1.0[v2];[2:a]volume=0.30[bg];[v1][v2][bg]amix=inputs=3:duration=longest:dropout_transition=0[a]" \
  -map "[a]" -c:a pcm_s16le "$WORK/audio_full.wav"
# 字幕(ASS 浅蓝白) 时间轴按镜头边界校准(净时长: 3.1/2.0/3.1/2.7/2.7/1.2/3.1/2.7/3.1/2.3/2.3/2.0/2.7, xfade=0.3)
cat > "$WORK/sub.ass" <<EOF
[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Hiragino Sans GB,52,&H00601F38,&H00FFFFFF,&H00FFFFFF,&H96000000,0,0,0,0,100,100,0,0,1,3,0,2,60,60,54,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.50,0:00:03.00,Sub,,0,0,0,,在 Mac 上跑 DeepSeek Harness，还停在命令行手动 npx？
Dialogue: 0,0:00:03.10,0:00:04.70,Sub,,0,0,0,,试试 Deepseek Harness Launcher，原生菜单栏启动器
Dialogue: 0,0:00:04.80,0:00:09.90,Sub,,0,0,0,,鼠标一点，服务就绪，自动打开浏览器
Dialogue: 0,0:00:10.00,0:00:13.20,Sub,,0,0,0,,零 WebView，纯 Swift 原生，轻量省内存
Dialogue: 0,0:00:13.30,0:00:18.40,Sub,,0,0,0,,内置归档管理，会话清理一次搞定
Dialogue: 0,0:00:18.50,0:00:21.20,Sub,,0,0,0,,插件市场一键安装，功能随时扩展
Dialogue: 0,0:00:21.30,0:00:23.20,Sub,,0,0,0,,会话完成，菜单栏角标提醒，点击直达现场
Dialogue: 0,0:00:23.30,0:00:26.90,Sub,,0,0,0,,任何时候点一下菜单栏，回到 Harness，不重复开窗
Dialogue: 0,0:00:27.00,0:00:29.20,Sub,,0,0,0,,原生，轻量，开源，让 Harness 在 Mac 上更好用
EOF
$FF -y -v error -i "$VID" -i "$WORK/audio_full.wav" \
  -vf "subtitles=$WORK/sub.ass" -af "volume=6dB" \
  -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest "$OUT/dhl_intro_30s.mp4"

echo "== [5/5] 输出验证 =="
$FP -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT/dhl_intro_30s.mp4"
echo "OUTPUT: $OUT/dhl_intro_30s.mp4"
