#!/bin/zsh
# 版本号同步：**这是 AGENTS.md「版本号落点」的唯一入口**
#
# AGENTS.md 规定改版本号时必须同步四处：
#   Resources/Info.plist            → CFBundleShortVersionString
#   Resources/InstallerInfo.plist   → CFBundleShortVersionString（与上者一致）
#   README.md                       → 「当前 App 版本」那一行
#   README.en.md                    → 「The current App version is」那一行
# 手改四处容易漏掉一处（历史上 v0.2.0 就出现过 tag/包内版本不一致），所以统一走
# 本脚本；不要直接编辑上面四个文件里的版本号。
#
# 用法：
#   ./scripts/bump-version.sh 0.3.11-1.1-SNAPSHOT    # 开发中
#   ./scripts/bump-version.sh 0.3.11-1.1             # 提测
#   ./scripts/bump-version.sh 0.3.11                 # 正式发布
#
# 每处改动打印「<文件>: <旧值> → <新值>」；本来就等于目标值的那处打印「（无变化）」，
# 因此同一版本重复执行是幂等的。结束时读回四个文件断言一致，任何一步对不上就 exit 1；
# 版本号格式不合法则打印用法并 exit 2（此时不改动任何文件）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INFO_PLIST="$ROOT/Resources/Info.plist"
INSTALLER_PLIST="$ROOT/Resources/InstallerInfo.plist"
README_DOC="$ROOT/README.md"
README_EN_DOC="$ROOT/README.en.md"

# 与 scripts/test.sh 校验版本号用的正则保持一致（AGENTS.md「版本号规则」）。
VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+\.[0-9]+(-SNAPSHOT)?)?$'
# README 里版本号所在句子的标记（中文一份、英文一份）。
README_MARKER='当前 App 版本'
README_EN_MARKER='The current App version is'

usage() {
  print -u2 "用法：./scripts/bump-version.sh <版本号>"
  print -u2 "  开发中：./scripts/bump-version.sh 0.3.11-1.1-SNAPSHOT"
  print -u2 "  提测：  ./scripts/bump-version.sh 0.3.11-1.1"
  print -u2 "  正式：  ./scripts/bump-version.sh 0.3.11"
}

version="${1:-}"
if [[ $# -ne 1 || -z $version ]]; then
  usage
  exit 2
fi
if ! print -r -- "$version" | grep -Eqx "$VERSION_PATTERN"; then
  print -u2 "版本号格式不合法：$version"
  print -u2 "允许：x.y.z-a.b-SNAPSHOT（开发） / x.y.z-a.b（提测） / x.y.z（正式）"
  usage
  exit 2
fi

for file in "$INFO_PLIST" "$INSTALLER_PLIST" "$README_DOC" "$README_EN_DOC"; do
  [[ -f $file ]] || { print -u2 "缺少文件：$file"; exit 1; }
done

# 注意：zsh 里 path 是绑定 PATH 的特殊变量，参数名一律不能用 path。
plist_version() {
  plutil -extract CFBundleShortVersionString raw "$1"
}

# 从 README 的标记句里取出反引号包住的当前版本号；取不到时输出空串。
doc_version() {
  local target="$1" marker="$2" found
  found="$(grep -F -- "$marker" "$target" | head -n 1 \
    | grep -oE '`[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+\.[0-9]+(-SNAPSHOT)?)?`' \
    | head -n 1 | tr -d '`' || true)"
  print -r -- "$found"
}

set_plist_version() {
  local target="$1" label="$2" old
  old="$(plist_version "$target")"
  if [[ $old == "$version" ]]; then
    print "$label: $old → $version（无变化）"
    return 0
  fi
  plutil -replace CFBundleShortVersionString -string "$version" "$target"
  print "$label: $old → $version"
}

# 只替换标记句里那个反引号版本号，同文件其它反引号路径（如仓库名）不受影响。
set_doc_version() {
  local target="$1" label="$2" marker="$3" old
  old="$(doc_version "$target" "$marker")"
  if [[ -z $old ]]; then
    print -u2 "$label: 没找到「$marker」句中的版本号，未改动，请先检查该文件"
    exit 1
  fi
  if [[ $old == "$version" ]]; then
    print "$label: $old → $version（无变化）"
    return 0
  fi
  MARKER="$marker" NEWV="$version" perl -i -pe '
    if (!$done && index($_, $ENV{MARKER}) >= 0) {
      $done = 1 if s/`[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9]+\.[0-9]+(?:-SNAPSHOT)?)?`/`$ENV{NEWV}`/;
    }
  ' "$target"
  print "$label: $old → $version"
}

# 先做只读预检：两份 README 的标记句都在才动手，免得 plist 改了才发现文档对不上。
for spec in "README.md:$README_DOC:$README_MARKER" "README.en.md:$README_EN_DOC:$README_EN_MARKER"; do
  label="${spec%%:*}"
  rest="${spec#*:}"
  target="${rest%%:*}"
  marker="${rest#*:}"
  if [[ -z "$(doc_version "$target" "$marker")" ]]; then
    print -u2 "$label: 没找到「$marker」句中的版本号，未改动任何文件，请先检查该文件"
    exit 1
  fi
done

set_plist_version "$INFO_PLIST" "Resources/Info.plist"
set_plist_version "$INSTALLER_PLIST" "Resources/InstallerInfo.plist"
set_doc_version "$README_DOC" "README.md" "$README_MARKER"
set_doc_version "$README_EN_DOC" "README.en.md" "$README_EN_MARKER"

# 读回断言：四个落点必须都等于目标版本，否则回滚也救不回来，直接报错退出。
failed=0
for pair in \
  "Resources/Info.plist:$(plist_version "$INFO_PLIST")" \
  "Resources/InstallerInfo.plist:$(plist_version "$INSTALLER_PLIST")" \
  "README.md:$(doc_version "$README_DOC" "$README_MARKER")" \
  "README.en.md:$(doc_version "$README_EN_DOC" "$README_EN_MARKER")"; do
  label="${pair%%:*}"
  actual="${pair#*:}"
  if [[ $actual != "$version" ]]; then
    print -u2 "校验失败：$label 现在是 $actual，期望 $version"
    failed=1
  fi
done
if (( failed )); then
  exit 1
fi

print "版本号已同步为 $version（Info.plist / InstallerInfo.plist / README.md / README.en.md 四处一致）"
