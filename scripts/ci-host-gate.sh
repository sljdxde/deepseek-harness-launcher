#!/bin/bash
# 共享的 CI 宿主门禁（票 28/36 的流程收口，B3：两个 job 不再各抄一份 resolve/fetch/contract/version）。
#
# 做四件事，全部绑定到同一个目标 rc 版本：
#   1) resolve：baseline → 读 contracts/host-baseline.json 的 hostVersion；latest → npm view 取最大 -rc.N；
#   2) fetch  ：npm pack 下载宿主三个包的 tarball 并解出 d.ts（不安装、不启动宿主）；
#   3) contract：contract-snapshot --check 比对实装 d.ts 与 baseline；
#   4) version ：check-host-version 做三方（宿主 = 基线 = 本包）版本锁。
#
# 用法：scripts/ci-host-gate.sh <baseline|latest>
# 输出：stdout 末行 `resolved=<rc>`；若设置了 $GITHUB_OUTPUT，同时写入 resolved 供后续 step 引用。
set -euo pipefail

KIND="${1:-baseline}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/Plugins/DSHClientUILauncher"
HOST="${RUNNER_TEMP:-/tmp}/host"
PKGS="${RUNNER_TEMP:-/tmp}/pkgs"

case "$KIND" in
  baseline)
    RC="$(node -p "require('$PLUGIN/contracts/host-baseline.json').hostVersion")"
    ;;
  latest)
    RC="$(npm view @deepseek-ai/dsh versions --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const all=JSON.parse(s);const rc=all.filter(v=>/-rc\.\d+$/.test(v)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));process.stdout.write(rc.at(-1)??all.at(-1))})')"
    ;;
  *)
    echo "用法：$0 <baseline|latest>" >&2
    exit 2
    ;;
esac
echo "宿主门禁目标版本：$RC" >&2

mkdir -p "$HOST" "$PKGS"
for pkg in dsh-client-ui-layout dsh-client-ui-sidebar dsh-client-ui-slots; do
  npm pack "@deepseek-ai/$pkg@$RC" --pack-destination "$PKGS" >/dev/null
  tar -xzf "$PKGS"/deepseek-ai-"$pkg"-*.tgz -C "$PKGS"
  rm -rf "$HOST/$pkg"
  mv "$PKGS/package" "$HOST/$pkg"
done

node "$PLUGIN/tools/contract-snapshot.mjs" --check \
  --layout-from "$HOST/dsh-client-ui-layout" \
  --sidebar-from "$HOST/dsh-client-ui-sidebar" \
  --slots-from "$HOST/dsh-client-ui-slots"

node "$PLUGIN/tools/check-host-version.mjs" --host-version "$RC"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "resolved=$RC" >> "$GITHUB_OUTPUT"
fi
echo "resolved=$RC"
