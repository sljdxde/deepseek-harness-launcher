#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ROOT

# 只跑一条 swift 测试：编译命令（含它依赖的 Sources 列表）从 scripts/test.sh 里
# 原样抽出来执行，依赖列表因此只有一处真相——手抄那串 Sources 是过去迭代时的主要
# 出错点（少一个文件就是一堆 undefined symbol，和多写一个文件的报错长得差不多）。
# 提取走 grep 而不是 rg：这条命令不该再依赖 ripgrep。

suite=${1:-}
if [[ -z $suite || $suite == -h || $suite == --help ]]; then
  print "用法：scripts/test-one.sh <suite>"
  print "  suite 是 scripts/test-<suite>.swift 的中段："
  print "    $(cd "$ROOT/scripts" && ls test-*.swift | sed 's/^test-//; s/\.swift$//' | tr '\n' ' ')"
  print "  需要隔离环境的 suite（dsh-runtime-support）请跑 ./scripts/test.sh 全量。"
  exit 0
fi

test_file="$ROOT/scripts/test-$suite.swift"
if [[ ! -f $test_file ]]; then
  print -u2 "没有 $test_file"
  exit 2
fi

matches="$(grep -n -F "test-$suite" "$ROOT/scripts/test.sh")"
if print -r -- "$matches" | grep -q -E '^[0-9]+:DSH_HOME='; then
  print -u2 "test-$suite 依赖环境隔离（DSH_HOME），请用 ./scripts/test.sh 全量跑"
  exit 2
fi

lines=("${(@f)$(print -r -- "$matches" | grep -E '^[0-9]+:(swiftc |"\$ROOT/build/)' | cut -d: -f1)}")
if (( ${#lines} == 0 )); then
  print -u2 "在 scripts/test.sh 里找不到 test-$suite 的编译/运行行（写法变了？）"
  exit 2
fi

cd "$ROOT"
for ln in $lines; do
  cmd="$(sed -n "${ln}p" "$ROOT/scripts/test.sh")"
  print "→ $cmd"
  eval "$cmd"
done
