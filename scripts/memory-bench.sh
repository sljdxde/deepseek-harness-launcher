#!/bin/zsh
set -euo pipefail
# Measures the peak RSS of a lockfile-based dsh first install and fails when it
# exceeds the threshold (MB) passed as $1. Used by CI as the first-install gate.
#
# 门禁抓的是「退回裸 npm install 全量解析（曾达约 3GB）」这类回退，不是卡死当前
# 锁定树：现在的锁文件 724 个包（dsh 0.2.2）实测峰值约 1.2GB，冷缓存首装（真实
# 首次安装，瓶颈在网络）只有 190-220MB；CI 暖缓存命中时依赖全在本地、npm 一次性
# reify 整棵树，峰值最高但仍在 1.2GB 量级。阈值取 1792MB：高于实测峰值，也高于
# 启动器给 npm 的堆上限 1536MB（npmMaxOldSpaceSizeMB），但仍远低于裸解析的 3GB。
#
# The heap ceiling and fetch concurrency are read from the Swift sources so
# this script can never drift from the real install configuration.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THRESHOLD_MB="${1:-1792}"

HEAP_MB="$(rg -o 'npmMaxOldSpaceSizeMB = [0-9]+' "$ROOT/Sources/DSHRuntimeSupport.swift" | grep -oE '[0-9]+' | head -1)"
SOCKETS="$(rg -o 'npm_config_maxsockets"\] = "[0-9]+' "$ROOT/Sources/LauncherEnvironment.swift" | grep -oE '[0-9]+' | head -1)"
if [[ -z "$HEAP_MB" || -z "$SOCKETS" ]]; then
  echo "无法从源码读取 npmMaxOldSpaceSizeMB / npm_config_maxsockets" >&2
  exit 1
fi
if [[ ! -s "$ROOT/Resources/dsh-runtime/package.json" || ! -s "$ROOT/Resources/dsh-runtime/package-lock.json" ]]; then
  echo "缺少 Resources/dsh-runtime 的 package.json / package-lock.json" >&2
  exit 1
fi

PREFIX="$(mktemp -d "${TMPDIR:-/tmp}/dsh-memory-bench.XXXXXX")"
trap 'rm -rf "$PREFIX"' EXIT
cp "$ROOT/Resources/dsh-runtime/package.json" "$ROOT/Resources/dsh-runtime/package-lock.json" "$PREFIX/"

export NODE_OPTIONS="--max-old-space-size=$HEAP_MB"
export npm_config_maxsockets="$SOCKETS"
export npm_config_prefer_offline=true
export npm_config_audit=false
export npm_config_fund=false
export npm_config_legacy_peer_deps=false

RAW="$(/usr/bin/time -l npm ci --prefix "$PREFIX" --no-audit --no-fund --prefer-offline --registry https://registry.npmmirror.com 2>&1)"
printf '%s\n' "$RAW" | grep -E 'added [0-9]+ packages' | tail -1
PEAK_KB="$(printf '%s\n' "$RAW" | awk '/maximum resident set size/{print $1}' | tail -1)"
if [[ -z "$PEAK_KB" ]]; then
  printf '%s\n' "$RAW" | tail -20
  echo "无法解析峰值 RSS" >&2
  exit 1
fi
PEAK_MB=$((PEAK_KB / 1024 / 1024))
echo "peak RSS: ${PEAK_MB} MB (heap ceiling ${HEAP_MB}MB, maxsockets ${SOCKETS})"
if (( PEAK_MB > THRESHOLD_MB )); then
  echo "FAIL: 首次安装峰值 ${PEAK_MB}MB 超过阈值 ${THRESHOLD_MB}MB" >&2
  exit 1
fi
echo "PASS: 首次安装峰值 ${PEAK_MB}MB <= ${THRESHOLD_MB}MB"
