#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 前置自检：本脚本的源码不变量检查全部走 ripgrep，缺它时 zsh 只报
# 「command not found: rg」然后立刻退出——看起来像测试挂了，实际是工具链缺件。
# CI 用 brew 装 ripgrep，开发机通常没有；但 harness 自带一份，先回退到它，
# 真找不到再给一句能照做的提示（否则每次都要手工往 PATH 里加）。
if ! command -v rg >/dev/null 2>&1; then
  for candidate in ~/.dsh/runtime/node_modules/@vscode/ripgrep-*/bin/rg(N); do
    if [[ -x $candidate ]]; then
      path=(${candidate:h} $path); export PATH
      print "回归：使用 harness 自带的 ripgrep（$candidate）"
      break
    fi
  done
fi
if ! command -v rg >/dev/null 2>&1; then
  print -u2 "缺少 ripgrep：回归里的源码不变量检查依赖它（macOS: brew install ripgrep）"
  exit 127
fi

# 参数：默认全量回归；--fast 跳过打包（universal 构建、安装器、DMG），只跑断言。
# 迭代单条测试用 scripts/test-one.sh <suite>，别为此整跑一遍。
FAST=0
for arg in "$@"; do
  case $arg in
    --fast) FAST=1 ;;
    -h|--help)
      print "用法：scripts/test.sh [--fast]"
      print "  --fast  跳过打包三件套（universal 构建 / 安装器 / DMG），只跑断言"
      exit 0 ;;
    *)
      print -u2 "未知参数：$arg（唯一支持的参数是 --fast）"
      exit 2 ;;
  esac
done
node --check "$ROOT/Plugins/DSHArchiveManager/lib/index.js"
node --check "$ROOT/Plugins/DSHArchiveManager/client/client.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/running-session-ids.test.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/legacy-session-headers.test.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/workspace-auto-archive.test.js"
node --test "$ROOT/Plugins/DSHArchiveManager/test/health-route.test.js"
rg -q 'patchWorkspaceDeleteForAutoArchive' "$ROOT/Plugins/DSHArchiveManager/lib/index.js"
node --check "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
node --check "$ROOT/Plugins/DSHSessionNotify/client/client.js"
node --test "$ROOT/Plugins/DSHSessionNotify/test/session-notify.test.js"
node --test "$ROOT/Plugins/DSHSessionNotify/test/client.test.js"
if rg -q 'stopRunningAgents|需要二次确认删除|只能删除已归档' "$ROOT/Plugins/DSHArchiveManager/lib/index.js"; then
  echo "archive deletion must not perform runtime or archive-state validation" >&2
  exit 1
fi
rg -Fq 'body: JSON.stringify({ sessionIds: confirmIds })' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
node --check "$ROOT/Plugins/DSHPluginManager/lib/index.js"
node --check "$ROOT/Plugins/DSHPluginManager/client/client.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-manager.test.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/client-toasts.test.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
# 客户端 UI 渲染冒烟：纯函数测不到的组件接线（工具栏/行内标记/批量轮询/多选/降级）。
node "$ROOT/Plugins/DSHPluginManager/test/client-render.smoke.mjs"
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-manager.integration.test.js"
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-updates.test.js"
# 安装前的源码 import 校验（残缺克隆不许换掉能用版本）。
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-source-imports.test.js"
# 插件写操作的安全网：装坏要撤销、回滚不许吞错、必需组件不许被拆。
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-mutation-safety.test.js"
# 升级前的 dsh 版本兼容门禁（区间语义与 Sources/PluginCompatibilitySupport.swift 同口径）。
node --test "$ROOT/Plugins/DSHPluginManager/test/plugin-peer-compat.test.js"
if rg -q 'npx |git clone|github.com' "$ROOT/Plugins/DSHPluginManager/lib/index.js" >/dev/null && ! rg -q 'installCandidates|git\+' "$ROOT/Plugins/DSHPluginManager/lib/index.js"; then
  echo "plugin manager must expose npm-first / git-fallback install candidates" >&2
  exit 1
fi
rg -q 'dsh-plugin-manager' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -q 'sidebar.footer.action' "$ROOT/Plugins/DSHPluginManager/client/client.js"
# 插件版本检测与更新：双源判定、老克隆补标记、按来源分派更新动作、后台检测开关。
rg -q 'comparePluginVersions' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'classifyPluginSource' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'decidePluginUpdate' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq '.dsh-source.json' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'readRepositoryHint' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'GIT_TERMINAL_PROMPT' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq "'/dsh-plugin-manager/updates'" "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq "'/dsh-plugin-manager/update-many'" "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq '/dsh-plugin-manager/updates' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq 'update-many' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq '/dsh-plugin-manager/updates' "$ROOT/Sources/main.swift"
rg -Fq 'autoCheckPluginUpdates' "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/SettingsWindowController.swift" "$ROOT/Sources/main.swift"
rg -Fq 'decidePluginUpdate' "$ROOT/Plugins/DSHPluginManager/test/plugin-updates.test.js"
# 「忽略这个版本」：服务端记录 + 两个接口，客户端行内/批量入口，且不把忽略写进检测缓存。
rg -Fq "'/dsh-plugin-manager/ignore'" "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq "'/dsh-plugin-manager/unignore'" "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'isUpdateIgnored' "$ROOT/Plugins/DSHPluginManager/lib/index.js" "$ROOT/Plugins/DSHPluginManager/test/plugin-updates.test.js"
rg -Fq '/dsh-plugin-manager/ignore' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq '/dsh-plugin-manager/unignore' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq 'ignorableEntries' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
# 门禁判「这次升级有没有让环境更差」：已装版本同样不满足的 peer 只提示、不阻止。
rg -Fq 'readInstalledPeerDependencies' "$ROOT/Plugins/DSHPluginManager/lib/index.js" "$ROOT/Plugins/DSHPluginManager/test/plugin-peer-compat.test.js"
# 客户端更新 UI 的纯函数（多选/框选/角标/进度/批量 toast）必须有单测。
rg -Fq 'bandSelection' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'rangeSelection' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'updatesBadgeText' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'batchToast' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -Fq 'progressStepText' "$ROOT/Plugins/DSHPluginManager/test/client-updates.test.js"
rg -q "register\([^\n]*PluginTrigger" "$ROOT/Plugins/DSHPluginManager/client/client.js"
# 侧边栏底部动作：宿主把该 slot 渲染成 Settings 旁边的一行 nowrap flex，
# 两个占位者都声称整行宽，第二个就会被排到侧边栏右边缘之外（DOM 里存在、
# 屏幕上看不见）。因此每个动作自己占一整行（容器 wrap + flex:0 0 100%），
# 折叠态（56px 竖栏）退回 36px 圆形图标按钮。
# 通过 slot 标记的 :has() 命中容器，不得依赖宿主 CSS-module 的哈希类名。
for client in "$ROOT/Plugins/DSHArchiveManager/client/client.js" "$ROOT/Plugins/DSHPluginManager/client/client.js"; do
  rg -Fq "div:has(> [data-slot='sidebar.footer.action']){flex-wrap:wrap}" "$client"
  rg -Fq 'flex:0 0 100%' "$client"
  rg -q '\-rail\{' "$client"
done
if rg -q '\[class\$="_footerActions"\]' "$ROOT/Plugins/DSHArchiveManager/client/client.js" "$ROOT/Plugins/DSHPluginManager/client/client.js"; then
  echo "sidebar footer layout must not patch the shell's hashed CSS-module class" >&2
  exit 1
fi
# 竖栏里只显示图标，且只在明确的 wide === false 时切换（折叠动画期间保持宽行）。
rg -Fq "const rail = wide === false" "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq "rail ? 'dsh-pm-trigger dsh-pm-trigger-rail' : 'dsh-pm-trigger'" "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq '!rail && h' "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq "wide === false ? 'dsh-archive-trigger dsh-archive-trigger-rail' : 'dsh-archive-trigger'" "$ROOT/Plugins/DSHArchiveManager/client/client.js"
# 市场分类筛选必须留退出口：下拉里的「全部分类」与 chip 的「再点一次取消筛选」，
# 否则从「更多分类」里选中分类后就再也回不到全部（渲染冒烟场景 10 断言行为）。
rg -Fq "h('option', { value: 'all' }, '全部分类')" "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq "setCategory(category === cat ? 'all' : cat)" "$ROOT/Plugins/DSHPluginManager/client/client.js"
rg -Fq "全部分类" "$ROOT/Plugins/DSHPluginManager/test/client-render.smoke.mjs"
rg -q '/dsh-plugin-manager/installed' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/marketplace' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/install' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/uninstall' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q '/dsh-plugin-manager/update' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'cleanupPluginSources' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
# 本地开发目录的数据安全红线：自动更新绝不改 plugin-sources 之外的用户目录。
rg -q 'dev-linked' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
# 安装验收必须回读真实状态（pnpm 退出码 0 ≠ 装上了）。
rg -q '没有出现在 node_modules 里' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
# 批量更新遇本地开发链接插件：跳过并如实标注，不报「失败」。
rg -q 'isDevLinkedSource' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'awesome-dsh-plugin' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'ensurePnpmPath' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'corepack' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'pnpm-bin' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -q 'dsh-plugin-manager' "$ROOT/Plugins/DSHArchiveManager/cordis.patch.yml"
# 会话完成通知：插件随启动器打包、patch 注入并由菜单栏轮询。
rg -q 'dsh-session-notify' "$ROOT/Plugins/DSHArchiveManager/cordis.patch.yml"
rg -Fq 'DSHSessionNotify' "$ROOT/scripts/build-app.sh" "$ROOT/scripts/build-universal.sh" "$ROOT/Sources/main.swift"
rg -Fq 'BundledPlugin(linkName: "dsh-session-notify", bundleMarker: "DSHSessionNotify", url: sessionNotifyPluginURL)' "$ROOT/Sources/main.swift"
rg -q '/dsh-session-notify/events' "$ROOT/Plugins/DSHSessionNotify/lib/index.js" "$ROOT/Sources/main.swift"
# 页面存活心跳：标签页全关后 keep-alive 连接仍在，必须靠注入客户端的
# presence（轮询心跳 + pagehide bye）判断是否需要新开页面。
rg -q '/dsh-session-notify/presence' "$ROOT/Plugins/DSHSessionNotify/lib/index.js" "$ROOT/Plugins/DSHSessionNotify/client/client.js" "$ROOT/Sources/main.swift"
rg -q 'presenceActive' "$ROOT/Sources/BrowserConnectionSupport.swift" "$ROOT/Sources/main.swift"
rg -q '/dsh-session-notify/open' "$ROOT/Plugins/DSHSessionNotify/lib/index.js" "$ROOT/Sources/main.swift"
rg -q '/dsh-session-notify/commands/claim' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
# 会话跳转入口：dsh 客户端的 Session controller（ctx.sessions）没有 open，
# 跳转动作在 Workspace controller 服务 uiWorkspace.openSession 上（未声明的
# 服务只能经 ctx.get 取）。曾经这里锁的是 `ctx.sessions.open`——那个调用从来
# 不存在，TypeError 被空 catch 吞掉，于是「点完成提醒只前置浏览器、不切会话」
# 一直无人发现。正向断言新入口，反向断言旧写法不许回来。
rg -Fq "ctx.get('uiWorkspace')" "$ROOT/Plugins/DSHSessionNotify/client/client.js"
rg -Fq 'workspace.openSession(sessionId)' "$ROOT/Plugins/DSHSessionNotify/client/client.js"
if rg -q 'ctx\.sessions\.open\(' "$ROOT/Plugins/DSHSessionNotify/client/client.js"; then
  echo "session jump must go through uiWorkspace.openSession: ctx.sessions has no open()" >&2
  exit 1
fi
# 看过即已读：注入客户端把「用户正在看的会话」随 750ms 轮询上报（可见且有焦点
# 才算），插件只在观看目标变化时记一条 viewed，启动器把那份未读撤掉。少了任何
# 一环，人盯着结果看的时候角标还亮着。
rg -Fq 'viewing=' "$ROOT/Plugins/DSHSessionNotify/client/client.js"
rg -Fq 'viewingSession' "$ROOT/Plugins/DSHSessionNotify/client/client.js"
rg -Fq "kind: 'viewed'" "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'viewingNow' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'event.isView' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq 'ingested.viewed' "$ROOT/Sources/main.swift"
rg -Fq 'viewingNow' "$ROOT/Plugins/DSHSessionNotify/test/session-notify.test.js"
rg -Fq 'retracted.viewed' "$ROOT/scripts/test-session-notify.swift"
# viewed 只在**该会话确实挂着未读完成**时才记：750ms 一次轮询、用户来回切会话时每次
# 都记会把 50 条缓冲区占满，真正的完成提醒被挤出去。
rg -Fq 'lastKindBySession' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'pendingCompletion' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
# 菜单正在屏幕上（追踪中）时不许增删条目：轮询每 3.5 秒就可能带来新提醒，摘掉鼠标下
# 那一行会让点击落到已摘除的条目上（「点了没反应」）。延后到菜单关闭再补重建。
rg -Fq 'deferWhileMenuOpen' "$ROOT/Sources/main.swift"
rg -Fq 'sessionNotifyMenuRebuildPending' "$ROOT/Sources/main.swift"
rg -Fq 'func menuDidClose' "$ROOT/Sources/main.swift"
# 插件兼容性告警按插件计数：一个插件踩多个 peer 只报一条（日志行/弹窗都按插件走）；
# peer 按 Node 顺序解析（插件自带、profile 提升的都要算）；浏览器侧的 react/react-dom
# 由外壳注入，不能当成「运行时里不存在」劝用户卸载。
# 内置插件（归档管理 / 插件管理 / 会话完成通知）永不参与兼容性扫描：用户升不了也
# 卸不掉，报警只会把人引去白重启。名字集合是兜底（旧接口可能把它们标成 user/broken）。
rg -Fq 'mergeByPlugin' "$ROOT/Sources/PluginCompatibilitySupport.swift" "$ROOT/scripts/test-plugin-compatibility.swift"
rg -Fq 'resolvePeerVersion' "$ROOT/Sources/PluginCompatibilitySupport.swift" "$ROOT/scripts/test-plugin-compatibility.swift"
rg -Fq 'shellProvidedClientPeers' "$ROOT/Sources/PluginCompatibilitySupport.swift" "$ROOT/scripts/test-plugin-compatibility.swift"
rg -Fq 'bundledPluginNames' "$ROOT/Sources/PluginCompatibilitySupport.swift" "$ROOT/scripts/test-plugin-compatibility.swift"
# 内置插件也不许再被构造成「插件可能与当前 dsh 版本不兼容」的 Issue：它们的加载状态
# 只由就绪探针写日志（monitorArchivePlugin）。这两条理由字符串是旧告警路径的指纹，
# 出现即代表「为启动器自带插件弹窗」的老逻辑回来了。
if rg -Fq 'reason: "归档管理插件未随当前 dsh 加载"' "$ROOT/Sources/main.swift"; then
  echo "内置插件不许进兼容性告警（用户不需要为启动器自带插件重启 dsh）" >&2
  exit 1
fi
if rg -Fq 'reason: "会话完成通知插件未随当前 dsh 加载"' "$ROOT/Sources/main.swift"; then
  echo "内置插件不许进兼容性告警（用户不需要为启动器自带插件重启 dsh）" >&2
  exit 1
fi
# 内置插件的就绪探测只认确定性证据：
# - 探针走零成本的 /health（重接口 /archives 要读会话日志，本机热启 2.3s、冷启 >4s，
#   拿它当就绪探针就是误报来源）；
# - 判定分 ready/missing/unknown 三态，只有整段窗口最后一次响应是 404 才算 missing
#   并留下「未随当前 dsh 加载」的日志结论；超时、5xx、200 但形状不符都只能是 unknown。
# 旧实现「1.5s 超时轮询 40 次」/「web 就绪 12s 后单次 3s 判定」把「慢」误报成
# 「插件未随当前 dsh 加载」，重启 dsh 也不会好，因为下次启动照样慢。
rg -Fq 'BuiltinPluginProbePolicy' "$ROOT/Sources/ArchivePluginSupport.swift" "$ROOT/scripts/test-launcher-support.swift"
rg -Fq 'BuiltinPluginVerdict' "$ROOT/Sources/ArchivePluginSupport.swift" "$ROOT/Sources/main.swift" "$ROOT/scripts/test-launcher-support.swift"
rg -Fq 'BuiltinPluginReadiness.inspect' "$ROOT/Sources/main.swift" "$ROOT/scripts/test-launcher-support.swift"
rg -Fq 'policy: .readiness' "$ROOT/Sources/main.swift"
rg -Fq "'/dsh-archive-manager/health'" "$ROOT/Plugins/DSHArchiveManager/lib/index.js" "$ROOT/Sources/main.swift"
# 兜底判定必须保留：health 404 时回退到重接口再确认一次（老版本插件 / 同名第三方插件），
# 不能让「没有 /health」直接等于「没加载」。
rg -Fq 'legacyEndpointFallback' "$ROOT/Sources/main.swift" "$ROOT/Sources/ArchivePluginSupport.swift"
rg -Fq 'case .unknown:' "$ROOT/Sources/main.swift"
# 原子写要自己收干净临时文件：进程被杀留下的 <file>.<pid>.tmp 会一直躺在 profile 里
# （实测 ~/.dsh/profiles/web/.plugin-updates.json.11800.tmp），写同一个文件前收掉
# 「进程已不在」的那些；活进程（EPERM）的一律保留。
rg -Fq 'reapStaleStaging' "$ROOT/Plugins/DSHPluginManager/lib/index.js" "$ROOT/Plugins/DSHArchiveManager/lib/index.js"
rg -Fq 'EPERM' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'ignored.json.999999.tmp' "$ROOT/Plugins/DSHPluginManager/test/plugin-updates.test.js"
# git 来源的更新检测要能穿过 raw.githubusercontent 被限速/断流的网络（实测 14～60 秒
# 且中途断流）：raw 失败时用 api.github.com 兜一次，否则这类插件永远显示「失败」。
rg -Fq 'api.github.com/repos/' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'readRemoteJSON' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
rg -Fq 'raw 卡住/超时时用 api.github.com 兜底' "$ROOT/Plugins/DSHPluginManager/test/plugin-updates.test.js"
rg -q '"\./client": "\./client/client.js"' "$ROOT/Plugins/DSHSessionNotify/package.json"
rg -q '"client"' "$ROOT/Plugins/DSHSessionNotify/package.json"
rg -q 'monitorSessionNotify' "$ROOT/Sources/main.swift"
# 菜单栏角标：会话未读（红胶囊）+ 后台检查到的可用更新（蓝箭头圆盘），两条链路
# 共用一张合成图。角标是「画」出来的，符号/坐标写错不会崩、只会画歪或看不见，
# 所以除源码不变量外还有 scripts/test-status-badge.swift 逐像素验证。
rg -q 'StatusBadgeSupport' "$ROOT/Sources/main.swift"
rg -Fq 'private var updateAvailable: Bool' "$ROOT/Sources/main.swift"
rg -Fq 'pendingUpdate != nil || (dshUpdateBadgeVisible' "$ROOT/Sources/main.swift"
# 标题 / 角标 / tooltip 必须来自同一个判断：跳过记录之外的最高版本（bestAnnounceable）。
# 只比对 best 的旧口径会让「在下拉里跳过次新版本」清掉整份报告，下一轮又按 best 公告。
rg -Fq 'DSHUpdatePlanner.bestAnnounceable' "$ROOT/Sources/main.swift" "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'private func applyDSHUpdatePresentation()' "$ROOT/Sources/main.swift"
if rg -q 'makeSessionNotifyBadgeImage' "$ROOT/Sources/main.swift"; then
  echo "badge drawing must live in StatusBadgeSupport so it can be tested offscreen" >&2
  exit 1
fi
# 后台检查常开：设置里不许再有「要不要自动检查更新」的开关。历史上它一关，启动器
# 自检就只剩手动点击（用户会以为根本没有后台定时任务），而 dsh 检查却照跑。
if rg -q 'autoUpdateEnabled' "$ROOT/Sources" "$ROOT/scripts/test-settings-window.swift"; then
  echo "update checks must stay always-on: no autoUpdateEnabled toggle" >&2
  exit 1
fi
rg -Fq 'scheduleAutoUpdateChecks' "$ROOT/Sources/main.swift"
rg -Fq 'self.performUpdateCheck(interactive: false)' "$ROOT/Sources/main.swift"
rg -Fq 'self.performDSHUpdateCheck(interactive: false)' "$ROOT/Sources/main.swift"
# 首检只排一次：启动传 true，保存设置重挂定时器时用默认 false。否则每保存一次设置
# 就多排一个 8 秒首检（多一轮联网检查），6 小时周期也被反复推后。
rg -Fq 'scheduleAutoUpdateChecks(initialCheck: true)' "$ROOT/Sources/main.swift"
rg -Fq 'scheduleAutoUpdateChecks(initialCheck: Bool = false)' "$ROOT/Sources/main.swift"
rg -Fq 'self.scheduleAutoUpdateChecks()' "$ROOT/Sources/main.swift"
rg -Fq 'AutoUpdateSchedule.intervalSeconds' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateSupport.swift"
rg -q 'dsh-session-notify' "$ROOT/scripts/uninstall.sh"
rg -q 'DSHSessionNotify' "$ROOT/Plugins/DSHPluginManager/lib/index.js"
if rg -Fq 'alert.informativeText = manifest.notes' "$ROOT/Sources/main.swift"; then
  echo "update notes must be rendered as markdown, not dumped into informativeText" >&2
  exit 1
fi
rg -q 'ReleaseNotesMarkdown.attributedString' "$ROOT/Sources/DSHUpdateVersionPicker.swift"
rg -q 'UpdateDownloadWindowController' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateDownloadWindowController.swift"
rg -q 'UpdateDownloadProgress' "$ROOT/Sources/UpdateSupport.swift"
rg -q 'miniaturizable' "$ROOT/Sources/UpdateDownloadWindowController.swift"
# 三种更新的进度窗口都走 DSHInstallWindowController，必须可最小化。
rg -Fq '.titled, .closable, .miniaturizable' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq 'static let pluginUpdate = ProgressWindowWording(' "$ROOT/Sources/DSHInstallWindowController.swift"
# 插件更新不弹原生窗口（进度归插件管理面板呈现），启动器只更新角标与日志。
if rg -Fq 'DSHInstallWindowController(wording: .pluginUpdate)' "$ROOT/Sources/main.swift"; then
  echo "plugin updates must not pop the native progress window (panel renders progress)" >&2
  exit 1
fi
rg -Fq 'PluginUpdatesSnapshot.parse' "$ROOT/Sources/main.swift"
rg -Fq '/dsh-plugin-manager/updates' "$ROOT/Sources/main.swift"
rg -q 'onProgress' "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/main.swift"
rg -Fq 'DSHPluginManager' "$ROOT/scripts/build-app.sh" "$ROOT/scripts/build-universal.sh" "$ROOT/Sources/main.swift"
rg -q 'window.isOpaque = true' "$ROOT/Sources/SettingsWindowController.swift"
rg -q 'visualEffect.blendingMode = .withinWindow' "$ROOT/Sources/SettingsWindowController.swift"
rg -q 'checkbox.contentTintColor = .labelColor' "$ROOT/Sources/SettingsWindowController.swift"
if rg -q 'feedField|updateFeedURL|更新清单' "$ROOT/Sources/SettingsWindowController.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/main.swift"; then
  echo "update source must be fixed to GitHub Releases" >&2
  exit 1
fi
rg -Fq 'sljdxde/deepseek-harness-launcher' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'api.github.com/repos' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'Deepseek.Harness.Launcher.dmg' "$ROOT/Sources/UpdateSupport.swift"
if rg -Fq 'DHL.dmg' "$ROOT/Sources/UpdateSupport.swift"; then
  echo "update asset must use the full DMG name" >&2
  exit 1
fi
rg -q 'case \.noPublishedRelease' "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/main.swift"
rg -q "return \{ inject: \['slots', 'locale'\], apply \}" "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q 'dsh-archive-select-all' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
rg -q 'selectAllRef\.current\.indeterminate' "$ROOT/Plugins/DSHArchiveManager/client/client.js"
plutil -lint "$ROOT/Resources/Info.plist"
plutil -extract CFBundleExecutable raw "$ROOT/Resources/Info.plist" | grep -qx 'DHL'
plutil -extract CFBundleDisplayName raw "$ROOT/Resources/Info.plist" | grep -qx 'Deepseek Harness Launcher'
plutil -extract CFBundleName raw "$ROOT/Resources/Info.plist" | grep -qx 'Deepseek Harness Launcher'
# 版本号规则见 AGENTS.md：正式 x.y.z；提测 x.y.z-a.b；开发 x.y.z-a.b-SNAPSHOT。
# 门禁只校验格式规则与两处 plist 一致性，不锁定具体版本号。
APP_VERSION="$(plutil -extract CFBundleShortVersionString raw "$ROOT/Resources/Info.plist")"
INSTALLER_VERSION="$(plutil -extract CFBundleShortVersionString raw "$ROOT/Resources/InstallerInfo.plist")"
VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+\.[0-9]+(-SNAPSHOT)?)?$'
echo "$APP_VERSION" | grep -Eqx "$VERSION_PATTERN" || { echo "Info.plist 版本不符合 AGENTS.md 规则: $APP_VERSION" >&2; exit 1; }
echo "$INSTALLER_VERSION" | grep -Eqx "$VERSION_PATTERN" || { echo "InstallerInfo.plist 版本不符合 AGENTS.md 规则: $INSTALLER_VERSION" >&2; exit 1; }
[[ "$APP_VERSION" == "$INSTALLER_VERSION" ]] || { echo "版本不一致: $APP_VERSION vs $INSTALLER_VERSION" >&2; exit 1; }
rg -Fq '正在安装 DHL' "$ROOT/Installer/main.swift"
rg -Fq '已更新，正在重新启动 DHL' "$ROOT/Installer/main.swift"
zsh -n "$ROOT/scripts/install.sh"
zsh -n "$ROOT/scripts/install-from-app.sh"
zsh -n "$ROOT/scripts/uninstall.sh"
rg -q "cleanup_legacy_volumes" "$ROOT/scripts/uninstall.sh"
rg -q "unregister_legacy_paths" "$ROOT/scripts/uninstall.sh" "$ROOT/scripts/install-from-app.sh"
rg -q "remove_backups" "$ROOT/scripts/uninstall.sh"
rg -q "remove_dsh_runtime" "$ROOT/scripts/uninstall.sh"
rg -q "runtime.installing-" "$ROOT/scripts/uninstall.sh"
rg -q "prune_backups" "$ROOT/scripts/install-from-app.sh"
rg -q "xattr -dr com.apple.quarantine" "$ROOT/scripts/install-from-app.sh"
zsh -n "$ROOT/scripts/Install DHL.command"
zsh -n "$ROOT/scripts/build-installer-app.sh"
zsh -n "$ROOT/scripts/swift-slice.sh"
zsh -n "$ROOT/scripts/build-dmg.sh"
"$ROOT/scripts/test-installer.sh"
# 安装器测试必须限定进程停止作用域：禁止回归运行杀掉真实安装的 launcher/dsh。
rg -q 'DHL_STOP_SCOPE' "$ROOT/scripts/install-from-app.sh" "$ROOT/scripts/test-installer.sh"
# 夹具必须先 exec 成 launcher argv 再跑安装器（否则 DHL_STOP_SCOPE=target 下安装器
# 认不出它），而且等它退出的代码必须有上限：裸 wait 在竞态下会把整个回归挂死
# （实测卡死 20 分钟，看起来像「测试跑不完」）。
rg -Fq 'exec_ready' "$ROOT/scripts/test-installer.sh"
if rg -q '^[[:space:]]*wait "\$PID"' "$ROOT/scripts/test-installer.sh"; then
  echo "installer test must not wait for the fixture without a timeout" >&2
  exit 1
fi
rg -q 'signal_processes launcher_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'signal_processes dsh_pids KILL' "$ROOT/scripts/install-from-app.sh"
rg -q 'wait_for_processes launcher_pids' "$ROOT/scripts/install-from-app.sh"
rg -q 'Previous app backup' "$ROOT/scripts/install-from-app.sh"
if rg -q 'tell application id|DHL_SKIP_BUNDLE_QUIT|DSH_SKIP_BUNDLE_QUIT' "$ROOT/scripts/install-from-app.sh"; then
  echo "installer must stop old processes without Apple Events" >&2
  exit 1
fi
rg -q 'ensureBundledPluginLinks' "$ROOT/Sources/main.swift"
rg -q 'ensureBundledPluginLink' "$ROOT/Sources/ArchivePluginSupport.swift"
rg -q 'BundledPlugin\(' "$ROOT/Sources/main.swift"
rg -Fq 'Plugins/DSHPluginManager' "$ROOT/Sources/main.swift"
rg -q 'executablePath\(named: "npm"' "$ROOT/Sources/main.swift"
rg -q 'DSHRuntimeSupport.install' "$ROOT/Sources/main.swift"
rg -q 'runtime.installing-' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'cleanupInterruptedInstalls' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -Fq '已检测到完整 dsh runtime，跳过 npm 下载' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'SIGKILL' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'cordis-plugin-group/package.json' "$ROOT/Sources/DSHRuntimeSupport.swift"
# 启动期不得强制装/更新运行环境：有更新只代表「可以更新」，是否更新由用户决定，
# 拒绝后必须仍能用现有环境启动（「装不装」的判据 isInstalled 与「能不能用」的
# canAttemptLaunch 必须分开，别把还能跑的环境判死）。被中断的替换要把快照换回来，
# 而不是逼用户重装一次。
rg -Fq 'RuntimeLaunchPlanner.plan' "$ROOT/Sources/main.swift" "$ROOT/Sources/RuntimeLaunchPlanner.swift"
rg -Fq 'RuntimeLaunchInput(' "$ROOT/Sources/main.swift"
rg -Fq 'canAttemptLaunch' "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/main.swift"
rg -Fq 'guard confirmBundledRuntimeUpgrade(upgrade) else' "$ROOT/Sources/main.swift"
rg -Fq 'guard confirmRuntimeRebuild() else' "$ROOT/Sources/main.swift"
rg -Fq 'declineRuntimeRebuild' "$ROOT/Sources/main.swift"
rg -Fq 'deferredBundledRuntimeVersion' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'fixRuntimeFromMenu' "$ROOT/Sources/main.swift"
# 反例守卫：启动流程里不许再出现「检测到需要升级就直接开装」的老路径。
if rg -Fq 'needsRuntimeUpgrade(environment: environment) {' "$ROOT/Sources/main.swift"; then
  echo "startup must not begin a runtime upgrade without user confirmation" >&2
  exit 1
fi
rg -Fq 'restoreRuntimeSnapshot' "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/main.swift"
rg -Fq 'runtimeSnapshotURL' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -Fq '已从快照恢复现有运行环境' "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/scripts/test-dsh-runtime-support.swift"
rg -Fq 'restore_interrupted_runtime' "$ROOT/scripts/uninstall.sh"
# 卸载不得删掉用户唯一一份运行环境：runtime.previous-* 是「替换 runtime 中途被打断」
# 时的完整快照，正式 runtime 缺失时要先换回去（zsh 里 local path 会让 PATH 变空，
# 所以必须用绝对路径调用 mv）。
rg -Fq '/bin/mv "$snapshot"' "$ROOT/scripts/uninstall.sh"
rg -Fq 'runtime.broken-' "$ROOT/scripts/uninstall.sh"
rg -q 'DSHInstallWindowController' "$ROOT/Sources/main.swift"
rg -q 'DSHInstallProgressTracker' "$ROOT/Sources/main.swift"
rg -Fq '本地未检测到 DeepSeek Harness' "$ROOT/Sources/DSHInstallWindowController.swift" "$ROOT/Sources/main.swift"
rg -Fq '安装命令：npx @deepseek-ai/dsh web' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq '安装进度：正在下载 npm 依赖' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq '安装完成后会自动打开 DeepSeek Harness Web 页面' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -Fq '打开 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -Fq '退出 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -Fq '重启 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -q 'restartDSH' "$ROOT/Sources/main.swift"
rg -q 'stopDHL \{' "$ROOT/Sources/main.swift"
# 重启竞态：旧实例的 terminationHandler 可能在新实例已启动后才回到主线程，
# 必须比对「当前受管进程」身份，否则重启成功也会弹「启动失败」并清空新实例引用。
rg -Fq 'guard self.process === terminatedProcess else {' "$ROOT/Sources/main.swift"
rg -Fq '旧实例退出不计入启动失败' "$ROOT/Sources/main.swift"
if rg -Fq 'menuRowItem(title: "打开 Deepseek Harness Launcher"' "$ROOT/Sources/main.swift" || rg -Fq 'menuRowItem(title: "退出 Deepseek Harness Launcher"' "$ROOT/Sources/main.swift"; then
  echo "menu labels must use the shorter Deepseek Harness name" >&2
  exit 1
fi
if rg -Fq '停止后台' "$ROOT/Sources/main.swift"; then
  echo "obsolete Stop Backend menu item must not be present" >&2
  exit 1
fi
rg -q 'if elapsedTimer == nil' "$ROOT/Sources/DSHInstallWindowController.swift"
if rg -q '预计时长|预计剩余|estimate' "$ROOT/Sources/DSHInstallWindowController.swift" "$ROOT/Sources/DSHInstallProgress.swift" "$ROOT/Sources/main.swift"; then
  echo "installation UI must not show fabricated time estimates" >&2
  exit 1
fi
rg -q 'progress\.isIndeterminate = true' "$ROOT/Sources/DSHInstallWindowController.swift"
rg -q 'openWhenReady' "$ROOT/Sources/main.swift"
rg -q 'openBrowserWhenReadyIfNeeded' "$ROOT/Sources/main.swift"
rg -q 'installWindow\.present\(\)' "$ROOT/Sources/main.swift"
rg -q 'NSRunningApplication' "$ROOT/Sources/main.swift"
rg -q 'createsNewApplicationInstance = false' "$ROOT/Sources/main.swift"
# Web 入口复用已有页面：用 lsof 客户端连接 + ps 父子链找浏览器主进程，
# 命中后由 Apple Events 选中已有 Harness 标签，避免 NSWorkspace.open 重复创建标签页。
rg -q 'BrowserConnectionSupport' "$ROOT/Sources/main.swift"
rg -q 'clientPIDs' "$ROOT/Sources/BrowserConnectionSupport.swift"
rg -q 'browserPID' "$ROOT/Sources/BrowserConnectionSupport.swift"
rg -q 'BrowserAutomationSupport' "$ROOT/Sources/main.swift"
rg -q 'NSAppleScript' "$ROOT/Sources/BrowserAutomationSupport.swift"
rg -q 'browserFocusScript' "$ROOT/Sources/BrowserAutomationSupport.swift"
plutil -extract NSAppleEventsUsageDescription raw "$ROOT/Resources/Info.plist" | grep -q '定位并打开已存在的 Deepseek Harness'
rg -Fq 'BrowserConnectionTests' "$ROOT/scripts/test-browser-connection.swift"
xcrun swiftc -o /tmp/dsh-test-browser-connection "$ROOT/Sources/BrowserConnectionSupport.swift" "$ROOT/Sources/BrowserAutomationSupport.swift" "$ROOT/scripts/test-browser-connection.swift" -framework AppKit
/tmp/dsh-test-browser-connection
# 会话提醒跳转的决策链必须留在可单测的 SessionJumpSupport 里（main.swift 只执行）：
# 点击处置 / 页面重开 / 重启接管关旧标签 / 单实例与多实例的失败诊断 / 失败降级顺序。
# 这些判断曾散在 main.swift 的异步回调里，改一处坏另一处、grep 字符串又抓不住。
rg -Fq 'SessionJumpSupport' "$ROOT/Sources/main.swift" "$ROOT/Sources/SessionJumpSupport.swift" "$ROOT/scripts/test-session-jump.swift"
rg -Fq 'clickDisposition' "$ROOT/Sources/main.swift" "$ROOT/Sources/SessionJumpSupport.swift" "$ROOT/scripts/test-session-jump.swift"
rg -Fq 'pagePlan' "$ROOT/Sources/main.swift" "$ROOT/Sources/SessionJumpSupport.swift" "$ROOT/scripts/test-session-jump.swift"
rg -Fq 'focusPlan' "$ROOT/Sources/main.swift" "$ROOT/Sources/SessionJumpSupport.swift" "$ROOT/scripts/test-session-jump.swift"
# 任何分支都要投递「打开会话」命令：标签没选中只影响看得见看不见，不能连会话一起不切。
rg -Fq 'sendsSessionOpen' "$ROOT/Sources/SessionJumpSupport.swift" "$ROOT/scripts/test-session-jump.swift"
rg -Fq 'requestSessionOpen' "$ROOT/Sources/main.swift"
# 反例守卫：标签定位失败的文案与分支只许在 SessionJumpSupport 里定义，回退到
# main.swift 的 switch 就是把可测逻辑又塞回不可测的地方。
if rg -q '未找到匹配标签页' "$ROOT/Sources/main.swift"; then
  echo "标签定位失败的判断/文案只许在 SessionJumpSupport（main.swift 只调用）" >&2
  exit 1
fi
rg -q -- '--registry' "$ROOT/Sources/DSHRuntimeSupport.swift"
if rg -q 'npx --prefer-offline --yes @deepseek-ai/dsh' "$ROOT/Sources/main.swift" "$ROOT/Sources/DSHUpdateSupport.swift"; then
  echo "launcher must not bootstrap dsh through npx" >&2
  exit 1
fi
rg -q 'npm_config_legacy_peer_deps.*false' "$ROOT/Sources/LauncherEnvironment.swift"
rg -q 'npm_config_fetch_retries' "$ROOT/Sources/LauncherEnvironment.swift"
# First-install memory budget: fetch concurrency is capped at 16 and npm's V8
# heap ceiling is bounded (see npmMaxOldSpaceSizeMB) so a fresh dsh install
# stays far below the ~3GB peak that unbounded settings produced.
rg -q 'npm_config_maxsockets.*"16"' "$ROOT/Sources/LauncherEnvironment.swift"
if rg -q 'npm_config_maxsockets.*"50"' "$ROOT/Sources/LauncherEnvironment.swift"; then
  echo "npm fetch concurrency must stay at 16 for the first-install memory budget" >&2
  exit 1
fi
rg -q 'npmMaxOldSpaceSizeMB' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'appendCapturedOutput' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'maxCapturedOutputBytes' "$ROOT/Sources/DSHRuntimeSupport.swift"
# Lockfile-based first install: the bundled dsh-runtime spec must exist, the
# install path must switch to `npm ci` when it is present, and build scripts
# must ship it inside the app bundle.
test -s "$ROOT/Resources/dsh-runtime/package.json"
test -s "$ROOT/Resources/dsh-runtime/package-lock.json"
rg -q 'bundledRuntimeSpec' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q '"ci", "--prefix"' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'Resources/dsh-runtime' "$ROOT/scripts/build-app.sh" "$ROOT/scripts/build-universal.sh"
if [[ "$(rg -c -- '--no-package-lock' "$ROOT/Sources/DSHRuntimeSupport.swift")" != "1" ]]; then
  echo "--no-package-lock must only appear once, on the fallback (no bundled spec) install path" >&2
  exit 1
fi
# Irregular-update path: version mismatch must drive a forced lockfile reinstall
rg -q 'needsRuntimeUpgrade' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'bundledDSHVersion' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'installedDSHVersion' "$ROOT/Sources/DSHRuntimeSupport.swift"
rg -q 'force: isUpgrade' "$ROOT/Sources/main.swift"
rg -q 'DSHInstallMode' "$ROOT/Sources/main.swift"
rg -q 'hasHarnessInstall' "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/main.swift"
rg -q 'case firstInstall, upgrade, repair' "$ROOT/Sources/main.swift"
rg -Fq '检测到已有 DeepSeek Harness 安装' "$ROOT/Sources/main.swift"
rg -Fq '不影响你的会话、归档与插件数据' "$ROOT/Sources/main.swift"
if rg -q 'npm_config_progress.*false|--progress=false' "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/LauncherEnvironment.swift"; then
  echo "npm installation progress must remain enabled" >&2
  exit 1
fi
rg -q '启动超过 10 分钟' "$ROOT/Sources/main.swift"
rg -q 'DSHRuntimeSupport.isInstalled' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -q 'runtime.installing-' "$ROOT/Sources/main.swift" "$ROOT/scripts/install-from-app.sh" "$ROOT/scripts/uninstall.sh"
rg -q '正在安装 Deepseek Harness' "$ROOT/Sources/main.swift"
rg -q '"web",' "$ROOT/Sources/main.swift"
rg -Fq 'npx @deepseek-ai/dsh web' "$ROOT/Sources/main.swift" "$ROOT/README.md"
if rg -q 'func applicationWillTerminate' "$ROOT/Sources/main.swift"; then
  echo "launcher exit must not synchronously stop the Harness backend" >&2
  exit 1
fi
rg -q 'menu\.showsStateColumn = false' "$ROOT/Sources/main.swift"
rg -q 'item\.offStateImage = nil' "$ROOT/Sources/main.swift"
rg -q 'let settingsItem = makeSettingsMenuItem()' "$ROOT/Sources/main.swift"
rg -Fq 'menuRowItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")' "$ROOT/Sources/main.swift"
rg -Fq 'keyEquivalent: ","' "$ROOT/Sources/main.swift"
rg -Fq 'keyEquivalentModifierMask = keyEquivalent.isEmpty ? [] : [.command]' "$ROOT/Sources/main.swift"
rg -Fq 'RegisterEventHotKey' "$ROOT/Sources/GlobalHotKey.swift"
rg -Fq '"view", "@deepseek-ai/dsh", "version"' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'scheduleDSHUpdateCheck' "$ROOT/Sources/main.swift"
rg -Fq 'ServiceProbe.body' "$ROOT/Sources/main.swift"
rg -Fq 'nodeEnvironment' "$ROOT/Sources/LauncherEnvironment.swift"
rg -Fq '检查 Deepseek Harness 更新' "$ROOT/Sources/main.swift"
# dsh 更新检查：npm dist-tags + GitHub Release 双来源（npm 的 latest 常落后于刚发的
# Release），是否安装由用户决定（更新/稍后/跳过此版本），跳过会被记住。
rg -Fq '["view", "@deepseek-ai/dsh", "dist-tags", "versions", "--json"]' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'deepseek-ai/deepseek-harness/releases.atom' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'compareDSHVersions' "$ROOT/Sources/NpmVersionSupport.swift" "$ROOT/Sources/DSHUpdateSupport.swift" "$ROOT/scripts/test-dsh-version-support.swift"
rg -Fq 'static func bestAnnounceable' "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'checkAnnounceable' "$ROOT/scripts/test-dsh-version-support.swift"
if rg -q 'DSHUpdatePlanner\.shouldAnnounce' "$ROOT/Sources" "$ROOT/scripts"; then
  echo "dsh 公告口径只能有一个入口（bestAnnounceable），不要再引入 shouldAnnounce" >&2
  exit 1
fi
rg -Fq 'if interactive { presentDSHUpdate(report: report) }' "$ROOT/Sources/main.swift"
rg -Fq '跳过此版本' "$ROOT/Sources/main.swift"
rg -Fq 'skippedDSHVersion' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateSupport.swift"
# 「忽略/跳过」是两条链路都有的能力（启动器自更新以前没有，角标会一直亮到更新为止）：
# 跳过的版本不进菜单标题、不亮角标，但手动点菜单仍会弹窗，所以第三个按钮要在
# 「跳过此版本 / 取消跳过此版本」之间切换。
rg -Fq 'skippedLauncherVersion' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'LauncherUpdatePolicy.shouldAnnounce' "$ROOT/Sources/main.swift"
rg -Fq 'skipped ? "取消跳过此版本" : "跳过此版本"' "$ROOT/Sources/main.swift"
# 跳过记录只在「真的装上了 ≥ 跳过版本」之后作废（检查开头的自愈），以及用户点
# 「取消跳过」。历史 bug 是在安装脚本动手前就清空：hdiutil/安装失败时版本没换成，
# 跳过决定却已经丢了。清空点只有这两处；新增第三处请连同这条断言一起改。
rg -Fq 'LauncherUpdatePolicy.shouldClearSkip' "$ROOT/Sources/main.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/scripts/test-update-support.swift"
if [[ "$(rg -c 'skippedLauncherVersion = nil' "$ROOT/Sources/main.swift")" != "2" ]]; then
  echo "skippedLauncherVersion 只允许在「检查开头自愈」与「取消跳过」两处清空" >&2
  exit 1
fi
# 菜单标题只在 LauncherMenuTitle 里定义：四个检查结果各自写字面量，正是「.failed 只改
# 标题、角标却不动」那类不一致的来源。
rg -Fq 'enum LauncherMenuTitle' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq 'LauncherMenuTitle.launcherUpdate' "$ROOT/Sources/main.swift"
rg -Fq 'LauncherMenuTitle.idle' "$ROOT/Sources/main.swift"
rg -Fq 'launcherUpdate(pendingVersion: nil)' "$ROOT/scripts/test-update-support.swift"
if rg -Fq '检测启动器（DHL）更新' "$ROOT/Sources/main.swift"; then
  echo "菜单标题必须走 LauncherMenuTitle，main.swift 里不许再写标题字面量" >&2
  exit 1
fi
# main.swift 约 2700 行且主类只有一个：定位靠 // MARK 分区，少一段等于那一段又得靠
# grep 从头翻。新增章节时把名字加进这个列表。
for section in 顶部辅助类型 生命周期 状态栏与菜单 'dsh 更新检查' 浏览器打开与连接探测 进程停止与重启 设置窗口与全局快捷键 启动器自更新 启动与端口选择 运行环境安装与恢复 会话完成提醒与菜单栏角标; do
  if ! rg -Fq "// MARK: - $section" "$ROOT/Sources/main.swift"; then
    echo "main.swift 缺少 // MARK 分区：$section" >&2
    exit 1
  fi
done
rg -Fq 'isSkipped' "$ROOT/scripts/test-update-support.swift" "$ROOT/scripts/test-dsh-version-support.swift"
# 跳过之后菜单行必须回到普通标题：再挂一个「（已跳过 vX）」长标题，正是用户抱怨的
# 「那行一直占在最显眼的位置」。
if rg -Fq '（已跳过' "$ROOT/Sources/main.swift"; then
  echo "skipped versions must not leave a long menu title behind" >&2
  exit 1
fi
# 多个新版本时让用户挑：下拉列出全部比当前新的候选，切换时刷新说明与按钮。
rg -Fq 'DSHUpdatePlanner.selectableUpdates' "$ROOT/Sources/main.swift" "$ROOT/Sources/DSHUpdateSupport.swift"
rg -Fq 'NSPopUpButton' "$ROOT/Sources/DSHUpdateVersionPicker.swift"
rg -Fq 'DSHUpdateVersionPicker(' "$ROOT/Sources/main.swift"
# 提示框统一外观：SF Symbol 语气图标 + 圆角信息卡，正文不堆细节。
rg -Fq 'AlertDesign.style' "$ROOT/Sources/main.swift"
rg -Fq 'AlertDesign.accessory' "$ROOT/Sources/main.swift"
rg -Fq 'AlertDesign.card' "$ROOT/Sources/main.swift"
rg -Fq 'NSImage.SymbolConfiguration' "$ROOT/Sources/AlertDesign.swift"
rg -Fq 'cornerCurve = .continuous' "$ROOT/Sources/AlertDesign.swift"
# 会话完成提醒按会话计数：同一会话连跑多轮不能把角标数字刷高。
rg -Fq 'events.removeAll { $0.sessionId == event.sessionId }' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq '个会话未读' "$ROOT/Sources/main.swift"
rg -Fq 'sessionLabelFromId' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
# 排队消息场景：被打断的回合不算完成；新一轮开始（turn/start）要撤销该会话的未读提醒。
rg -Fq "if (reason === 'aborted') return null;" "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'summarizeTurnStart' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq "kind: 'resumed'" "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'event.isResume' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq '已撤销其完成提醒' "$ROOT/Sources/main.swift"
# 会话完成提醒：行标签用工作区名（回退标题/短 id），点一条只清那一条，列表保留。
rg -Fq 'SessionNotifyWorkspaceIndex' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq 'storages/workspace.json' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq 'static func menuLabel' "$ROOT/Sources/SessionNotifySupport.swift"
rg -Fq 'SessionNotifyWorkspaceIndex.load()' "$ROOT/Sources/main.swift"
rg -Fq 'sessionNotifyStore.markRead(sessionId)' "$ROOT/Sources/main.swift"
rg -Fq 'SessionNotifyWorkspaceIndex' "$ROOT/scripts/test-session-notify.swift"
rg -Fq 'snapshotEvents' "$ROOT/Plugins/DSHSessionNotify/lib/index.js"
rg -Fq 'selectableUpdates' "$ROOT/scripts/test-dsh-version-support.swift"
# 自动检查只改菜单标题：不得出现「检查完直接安装」的路径。
if rg -q 'applyDSHUpdateReport.*updateDSHNow|performDSHUpdateCheck.*updateDSHNow' "$ROOT/Sources/main.swift"; then
  echo "dsh updates must never install without the user choosing Update" >&2
  exit 1
fi
rg -Fq 'npm dist-tags' "$ROOT/README.md" "$ROOT/README.en.md"
# README 里的「当前 App 版本」必须与包内版本一致：脚本化之前两边各走各的
# （README 停在 0.3.9，包内已是 0.3.10-1.1），用户照 README 会以为是另一版。
rg -Fq "当前 App 版本为 \`$APP_VERSION\`" "$ROOT/README.md"
rg -Fq "The current App version is \`$APP_VERSION\`" "$ROOT/README.en.md"
if rg -Fq 'dsh 检查只比较 npm 最新版本' "$ROOT/README.md"; then
  echo "README must document the dual-source dsh update check" >&2
  exit 1
fi
# 文档标点：区间与约数一律用 `-` / 「约」，不写 `~`。这套渲染器把成对的 `~` 当
# 删除线，中文写作又习惯拿它当区间符，结果是「0.3~0.6GB … ~3GB」整段被划掉并误读。
# 路径里的 `~/` 不动（`~` 后面不是数字），所以只堵「数字~数字」和「~数字」。
if rg -n -e '[0-9]~[0-9]' -e '~[0-9]' "$ROOT/README.md" "$ROOT/README.en.md" "$ROOT/TESTING.md" "$ROOT"/docs/*.md; then
  echo "文档里的区间/约数请用 - 或「约」，不要用 ~（成对的 ~ 会渲染成删除线）" >&2
  exit 1
fi
# 中英两份 README 是同一份内容的两个手写副本，长期以来一直漂移（补齐前：中文 11 个
# 二级标题 / 英文 10 个，表格行 24 vs 27）。这里卡结构与行数，不卡措辞：新增一节或
# 一行表格必须同时落到两份文件上。
for marker in '^## ' '^### ' '^\| '; do
  zh="$(rg -c "$marker" "$ROOT/README.md" || true)"
  en="$(rg -c "$marker" "$ROOT/README.en.md" || true)"
  if [[ "${zh:-0}" != "${en:-0}" ]]; then
    echo "中英 README 结构不一致：$marker 中文 ${zh:-0} 处 / 英文 ${en:-0} 处" >&2
    exit 1
  fi
done
rg -Fq 'globalHotKeyEnabled' "$ROOT/Sources/UpdateSupport.swift"
rg -Fq '请按下快捷键' "$ROOT/Sources/SettingsWindowController.swift"
# 复用的设置窗口：窗口不可见时 present() 必须重新按已保存设置填一遍控件。
rg -Fq 'loadSettings()' "$ROOT/Sources/SettingsWindowController.swift"
rg -Fq '取消后再打开设置，勾选状态必须回到已保存的设置' "$ROOT/scripts/test-settings-window.swift"
rg -Fq 'globalHotKeyManager' "$ROOT/Sources/main.swift"
if rg -q 'SettingsMenuItemView' "$ROOT/Sources/main.swift"; then
  echo "legacy settings-only menu view must be removed" >&2
  exit 1
fi
if rg -q '"web", "--no-open".*"--patch"' "$ROOT/Sources/main.swift"; then
  echo "invalid Harness argument order" >&2
  exit 1
fi
mkdir -p "$ROOT/build"
swiftc "$ROOT/scripts/test-update-support.swift" "$ROOT/Sources/UpdateSupport.swift" -o "$ROOT/build/test-update-support"
"$ROOT/build/test-update-support"
swiftc "$ROOT/scripts/test-plugin-compatibility.swift" "$ROOT/Sources/PluginCompatibilitySupport.swift" "$ROOT/Sources/NpmVersionSupport.swift" -o "$ROOT/build/test-plugin-compatibility"
"$ROOT/build/test-plugin-compatibility"
swiftc "$ROOT/scripts/test-release-notes.swift" "$ROOT/Sources/ReleaseNotesSupport.swift" -o "$ROOT/build/test-release-notes"
"$ROOT/build/test-release-notes"
swiftc "$ROOT/scripts/test-session-notify.swift" "$ROOT/Sources/SessionNotifySupport.swift" -o "$ROOT/build/test-session-notify"
swiftc "$ROOT/scripts/test-plugin-isolation.swift" "$ROOT/Sources/PluginIsolationSupport.swift" "$ROOT/Sources/PluginSourceCheck.swift" -o "$ROOT/build/test-plugin-isolation"
"$ROOT/build/test-plugin-isolation"
swiftc "$ROOT/scripts/test-plugin-updates.swift" "$ROOT/Sources/PluginUpdateSupport.swift" -o "$ROOT/build/test-plugin-updates"
"$ROOT/build/test-plugin-updates"
"$ROOT/build/test-session-notify"
# 点击「会话完成」→ 跳转：点击处置 / 页面计划 / 失败诊断 / 降级顺序 / 会话投递不变式。
swiftc "$ROOT/scripts/test-session-jump.swift" "$ROOT/Sources/SessionJumpSupport.swift" "$ROOT/Sources/BrowserConnectionSupport.swift" "$ROOT/Sources/BrowserAutomationSupport.swift" -o "$ROOT/build/test-session-jump" -framework AppKit
"$ROOT/build/test-session-jump"
# 提示框外观与版本选择器：纯 AppKit 视图，直接构造/量尺寸/触发动作来断言。
swiftc "$ROOT/scripts/test-alert-design.swift" "$ROOT/Sources/AlertDesign.swift" "$ROOT/Sources/DSHUpdateVersionPicker.swift" "$ROOT/Sources/ReleaseNotesSupport.swift" "$ROOT/Sources/NpmVersionSupport.swift" "$ROOT/Sources/DSHUpdateSupport.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/LauncherEnvironment.swift" "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/RuntimeLaunchPlanner.swift" -o "$ROOT/build/test-alert-design" -framework AppKit
"$ROOT/build/test-alert-design"
swiftc "$ROOT/scripts/test-launcher-support.swift" "$ROOT/Sources/ArchivePluginSupport.swift" "$ROOT/Sources/LogSupport.swift" -o "$ROOT/build/test-launcher-support"
"$ROOT/build/test-launcher-support"
# 菜单栏角标：离屏合成后逐像素验（画歪/画重叠/看不见都不会崩，只能这么测）。
swiftc "$ROOT/scripts/test-status-badge.swift" "$ROOT/Sources/StatusBadgeSupport.swift" -o "$ROOT/build/test-status-badge" -framework AppKit
"$ROOT/build/test-status-badge"
# 设置窗口是复用的：取消后再打开必须回到已保存的设置（否则界面显示的是被取消掉的
# 勾选与间隔，用户以为生效了）。
swiftc "$ROOT/scripts/test-settings-window.swift" "$ROOT/Sources/SettingsWindowController.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/LauncherEnvironment.swift" "$ROOT/Sources/GlobalHotKey.swift" -o "$ROOT/build/test-settings-window" -framework AppKit
"$ROOT/build/test-settings-window"
swiftc "$ROOT/scripts/test-global-hotkey.swift" "$ROOT/Sources/GlobalHotKey.swift" -o "$ROOT/build/test-global-hotkey"
"$ROOT/build/test-global-hotkey"
swiftc "$ROOT/scripts/test-dsh-version-support.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/LauncherEnvironment.swift" "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/RuntimeLaunchPlanner.swift" "$ROOT/Sources/NpmVersionSupport.swift" "$ROOT/Sources/DSHUpdateSupport.swift" -o "$ROOT/build/test-dsh-version-support"
"$ROOT/build/test-dsh-version-support"
swiftc "$ROOT/scripts/test-dsh-install-progress.swift" "$ROOT/Sources/DSHInstallProgress.swift" -o "$ROOT/build/test-dsh-install-progress"
"$ROOT/build/test-dsh-install-progress"
# 启动期运行环境决策：每个分支都必须是「直接启动」或「先问用户」，不允许自己开装。
swiftc "$ROOT/scripts/test-runtime-launch-plan.swift" "$ROOT/Sources/RuntimeLaunchPlanner.swift" -o "$ROOT/build/test-runtime-launch-plan"
"$ROOT/build/test-runtime-launch-plan"
swiftc "$ROOT/scripts/test-dsh-runtime-support.swift" "$ROOT/Sources/LauncherEnvironment.swift" "$ROOT/Sources/DSHRuntimeSupport.swift" "$ROOT/Sources/NpmVersionSupport.swift" "$ROOT/Sources/DSHUpdateSupport.swift" "$ROOT/Sources/UpdateSupport.swift" "$ROOT/Sources/RuntimeLaunchPlanner.swift" -o "$ROOT/build/test-dsh-runtime-support"
RUNTIME_TEST_HOME="$(mktemp -d /tmp/dsh-runtime-home.XXXXXX)"
# macOS ignores the HOME env var for NSHomeDirectory(); DSHRuntimeSupport honors
# DSH_HOME, so use it to isolate the runtime tests from the real ~/.dsh.
DSH_HOME="$RUNTIME_TEST_HOME" "$ROOT/build/test-dsh-runtime-support"
find "$RUNTIME_TEST_HOME" -depth -type f -delete 2>/dev/null || true
find "$RUNTIME_TEST_HOME" -depth -type l -delete 2>/dev/null || true
find "$RUNTIME_TEST_HOME" -depth -type d -empty -delete 2>/dev/null || true
# 打包三件套（universal 构建 / 安装器 / DMG）占了整轮回归的大头，却和逻辑改动
# 无关：迭代时用 --fast 跳过，提交前和 CI 仍然跑全量。
if (( FAST )); then
  echo "跳过打包（--fast）：universal 构建 / 安装器 / DMG 均未跑"
else
  "$ROOT/scripts/build-app.sh" >/dev/null
  test -x "$ROOT/build/Deepseek Harness Launcher.app/Contents/MacOS/DHL"
  plutil -extract CFBundleDisplayName raw "$ROOT/build/Deepseek Harness Launcher.app/Contents/Info.plist" | grep -qx 'Deepseek Harness Launcher'
  test -f "$ROOT/build/Deepseek Harness Launcher.app/Contents/Resources/DHL.icns"
  test -x "$ROOT/build/Deepseek Harness Launcher.app/Contents/Resources/install-from-app.sh"
  "$ROOT/scripts/build-universal.sh" >/dev/null
  lipo -info "$ROOT/build/Deepseek Harness Launcher.app/Contents/MacOS/DHL" | grep -q 'x86_64.*arm64\|arm64.*x86_64'
  test -f "$ROOT/build/Deepseek Harness Launcher.app/Contents/Resources/menubar-creature.png"
  codesign --verify --deep --strict "$ROOT/build/Deepseek Harness Launcher.app"
  "$ROOT/scripts/build-installer-app.sh" >/dev/null
  test -x "$ROOT/build/双击完成安装或更新.app/Contents/MacOS/DHLInstaller"
  test -x "$ROOT/build/双击完成安装或更新.app/Contents/Resources/install-from-app.sh"
  test -d "$ROOT/build/双击完成安装或更新.app/Contents/Resources/Deepseek Harness Launcher.app"
  lipo -info "$ROOT/build/双击完成安装或更新.app/Contents/MacOS/DHLInstaller" | grep -q 'x86_64.*arm64\|arm64.*x86_64'
  codesign --verify --deep --strict "$ROOT/build/双击完成安装或更新.app"
  rg -Fq 'appendingPathComponent(".Deepseek Harness Launcher-payload.app")' "$ROOT/Installer/main.swift"
  rg -Fq 'cp -R "$ROOT/build/Deepseek Harness Launcher.app" "$STAGE/.Deepseek Harness Launcher-payload.app"' "$ROOT/scripts/build-dmg.sh"
  if rg -Fq 'ln -s /Applications' "$ROOT/scripts/build-dmg.sh"; then
    echo "DMG must expose only the installation entry" >&2
    exit 1
  fi
  "$ROOT/scripts/build-dmg.sh" >/dev/null
  test -s "$ROOT/dist/Deepseek Harness Launcher.dmg"
  hdiutil verify "$ROOT/dist/Deepseek Harness Launcher.dmg" >/dev/null
fi
echo "Deepseek Harness Launcher regression checks passed"
