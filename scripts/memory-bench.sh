#!/bin/zsh
set -euo pipefail
# Measures the peak RSS of a lockfile-based dsh first install and fails when it
# exceeds the threshold (MB) passed as $1. Used by CI as the first-install
# memory gate: with the bundled lockfile (`npm ci`) the peak is ~0.25-0.6GB,
# far below the ~3GB that a bare `npm install` resolution used to reach.
#
# The heap ceiling and fetch concurrency are read from the Swift sources so
# this script can never drift from the real install configuration.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
THRESHOLD_MB="${1:-1024}"

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
