# 启动器性能与资源占用优化建议（macOS + Windows 同步）

> 状态：建议稿，未改代码。
> 测量：2026-11-13 14:1x，本机 macOS，DHL 0.4.0（已运行 21 分钟）。
> 范围：只列启动器自身可控项。「关窗回收 WKWebView」已按决定排除。

## 1. 结论

- 唯一的大额内存项是内置窗口的 WebContent 进程（实测约 890 MB），已排除；剩下的收益集中在三类：**没有变化时的重绘与落盘**、**启动关键路径上的同步 I/O**、**等 token 的方式**。
- 两个平台各有对方已经做对的一件事，适合同批修：

  | 能力 | macOS | Windows |
  |---|---|---|
  | 角标未变化不重绘 | 缺：每 3.5 s 重读 PNG 并合成 | 有：`tray.go` 用 `lastBadge` 提前返回 |
  | 未读落盘脏检查 | 有：`persistUnreadIfChanged` | 缺：每 10 s 全量写一次 settings |
  | loopback 连接复用 | 有：`URLSession.shared` | 缺：每次探测新建 `http.Client` |
  | 日志句柄 | 缺：每块输出 open/seek/write/close | 有：`applog` 常驻文件句柄 |

- 用户能感知的最大一项是 **P2-3 等 token 的方式**：实测 spawn→窗口 15-29 s，其中 dsh 就绪只要 4-5 s，其余都在等 stdout 里的 token。

## 2. 优化项

### P1-1 角标重绘去抖（macOS 缺，Windows 已有）

**现状**

- macOS：`Sources/main.swift:2398` 的 `makeStatusImage()` 每次调用都 `NSImage(contentsOf:)` 重读 256×256 的 PNG，再 `lockFocus` 合成一张新图；`Sources/main.swift:2558` 在每次 3.5 s 轮询结束时无条件重绘。另有 `setState`(:2338)、`showStatusTitle`(:2452)、`refreshUpdateIndicator`(:2430)、菜单区块重建(:2474/:2510) 四个入口。
- Windows：`windows/internal/app/tray.go:36-45` 用 `lastBadge` 判等提前返回，`windows/internal/app/monitor.go:93-102` 再用 `lastPaintedUnread` 兜一层，形态已经正确。

**改法**

- macOS：把底图缓存成静态资源（不要每次从 bundle 读盘）；把 `StatusBadgeSupport.plan` + `isDark` + `statusTitleOverride` 作为 key 缓存合成结果，key 未变直接复用旧 `NSImage`。轮询里改成「未读数或更新态变化才重绘」，照搬 Windows 的 `lastPaintedUnread` 思路。
- Windows：不改逻辑，补一条单测断言「`badgeState` 相等时不调用 `SetIcon`」。

**收益**：去掉约 17 次/分的 PNG 解码 + AppKit 绘制；macOS 空闲 CPU 预计降 0.1-0.3 个百分点（估值，需实测）。
**风险**：低。`isDark` 必须进缓存 key，否则深浅色切换后不刷新。
**验收**：加临时计数日志，空闲 10 分钟无状态变化时合成次数 = 0。

### P1-2 轮询只在下游状态变化时刷新（Windows 现缺陷）

**现状**

- Windows：`monitor.go:202` 在插件轮询循环里每轮都调 `refreshBadgeAndMenu()`；它经 `actions.go:476 persistSessionUnread()` 走到 `actions.go:425 saveSettings()`（全量 marshal + 写 tmp + rename），等于**每 10 秒写一次 settings.json**。同一路径还会 `refreshOpenPanel()`（`actions.go:300`），面板打开时每 10 秒重建一次模型并 ExecJS。
- macOS：只在确有新增/撤销时重建菜单区块，落盘有脏检查；但轮询里的角标重绘仍是无条件（见 P1-1）。

**改法**

- Windows：把 `refreshBadgeAndMenu()` 移出轮询循环，只在 summary / active / 未读数变化时调用；`persistSessionUnread` 加「未读集合未变则跳过」的脏检查，对齐 macOS 的 `persistUnreadIfChanged`。
- macOS：随 P1-1 把轮询重绘改成条件触发。

**收益**：Windows 每天少约 8600 次 settings 写盘、少无谓的面板重渲染；macOS 少无谓绘制。
**风险**：低；漏刷新最多滞后一个轮询周期。
**验收**：Windows 空闲 10 分钟 `settings.json` 的 mtime 不变。

### P1-3 轮询节奏随可见性/活跃度降频（两侧）

**现状**：macOS 会话轮询 3.5 s（`main.swift:2559`）、插件轮询 10 s（`main.swift:2605`）；Windows 会话轮询 3.5 s（`monitor.go:27`/`:105`）、插件轮询 10 s 或 1 s（`monitor.go:196-201`）。两条链永久运行，不区分窗口是否可见。

**改法**：窗口不可见或应用不活跃时，会话轮询降到 10-15 s、插件轮询降到 30 s；恢复可见立即补拉一次。事件语义不变——`?after=seq` 游标保证不丢事件。

**收益**：后台唤醒次数约降 70%，影响电池与后台 CPU。
**风险**：角标最多延迟一个周期；必须保证「恢复可见立即拉一次」。
**验收**：空闲 10 分钟的 wakeups 下降；角标延迟 ≤ 15 s。

### P2-1 loopback HTTP 连接复用（Windows 缺）

**现状**：`windows/internal/launch/launch.go:374-383` 的 `probeGet` 每次新建 `http.Client`，3.5 s 与 10 s 两条轮询链每次都重新建 TCP 连接。macOS 的 `Sources/ServiceProbe.swift` 用 `URLSession.shared`，天然复用。

**改法**：Windows 提一个包级 `probeClient`（`Timeout: 1500ms`，`MaxIdleConnsPerHost: 4`），所有 loopback 探测共用；macOS 无需改。

**收益**：空闲时每 10 分钟约 230 次新建连接（3.5 s 一条 + 10 s 一条）降到接近复用；CPU 收益很小，属于稳定性/能耗卫生。
**风险**：低。
**验收**：loopback 连接数稳定，无新增超时。

### P2-2 启动关键路径去同步（macOS；Windows 部分）

**现状**

- macOS：`main.swift:1669-1690` 从主队列进入 `launch(port:)`（:1719），其中 `bundledUpgradeTarget`（`DSHRuntimeSupport.swift:103-120`，内含一次实测 50-70 ms 的 `dsh --version`）、读 lock JSON、`ensurePluginLink()`（`main.swift:2202`，扫两个 `node_modules` 目录）全在主线程。
- Windows：`controller.go:281 Start()` 同步执行 `launch.Prepare()`（解压内置插件 + 建软链）与 `FindPort()`；`actions.go:42` / `actions.go:180` 从菜单动作同步进入（只有 `app.go:155` 用了 `go`）。Prepare 是磁盘/解压工作，插件多的版本会卡住首帧。

**改法**：macOS 把「计划计算」（版本探测 + 插件链接检查）整段挪到后台队列，回主队列只做 switch；Windows 把 `Prepare()` + `FindPort()` 挪进 goroutine，或统一从 `app.go:155` 那条 `go c.Start()` 进入。

**收益**：macOS 首屏少约 100 ms 主线程占用；Windows 点开时不再有 Prepare 造成的首帧卡顿。
**风险**：低。注意顺序：`FindPort` 必须先于拉起进程，`Prepare` 必须先于 `Start`。
**验收**：macOS 冷启动 `sample` 里主线程不再出现 `dsh --version`；Windows 首帧时间下降。

### P2-3 等 token 的方式（两侧；收益最大，需产品确认）

**现状**

- macOS：`main.swift:771-791` 每 250 ms 轮询 token 快照，最长 240 次（60 s）；日志实测 spawn→窗口 21 s / 29 s / 15 s，其中 dsh 就绪 4-5 s。
- Windows：`controller.go:560-565` 只等 3 s（`launch.go:104-115`，25 ms 自旋）就退回裸 URL，可能落到 401 兜底页。

**改法（建议 B）**

- A：确认 dsh 是否把 token 落到文件（本机 `~/.dsh` 未发现 token 文件，需 DSH 侧确认）。
- B：窗口先显示「正在连接 Harness…」骨架页，token 出现后在回调里导航到带 token 的 URL；超时再走现有失败页。两平台共用同一语义，Windows 顺带消掉 401 抖动。

**收益**：首屏从 15-29 s 降到约 5 s（视觉可用）；Windows 不再出现 401 兜底页。
**风险**：会多一次导航，页面状态重建；会话跳转的「页面就绪再投递」机制（macOS `pageReadyCallbacks`）要挂在最终 URL 加载完成之后。
**验收**：冷启动 3 次，窗口可见 < 6 s，无 401 页。

### P2-4 端口探测并行（两侧）

**现状**：`main.swift:1692-1703` 与 `launch.go:64-74` 都是 3080-3099 串行，每个「被占用但不是 dsh」的端口要等满 1.5 s 超时，最坏 20 次约 30 s。

**改法**：先把 20 个端口 `canBind` 扫一遍（纯本地，微秒级）；存在空闲端口就直接用（当前常态已经如此，不联网）；只有全部被占用时，才限并发（4-8）探测哪个是 dsh 并接管。

**收益**：最坏 30 s → 约 2 s；常态无变化。
**风险**：低；接管判定仍以 `IsHarnessWebBody` 为准。
**验收**：用 20 个占位监听器模拟，启动 < 3 s。

### P2-5 日志写入与上限（macOS 写法；两侧上限）

**现状**：macOS `main.swift:2317-2329` 收到每块 stdout/stderr 都 open+seek+write+close，且 `logLock` 把两个管道串行化；Windows 的 `applog.go` 已是常驻句柄。两侧 `dhl.log` 都没有大小上限（本机 123 KB）。

**改法**：macOS 改常驻 `FileHandle`（或 `DispatchIO`）追加写；两侧加「超过 N MB 轮转」（如 2 MB → `dhl.log.1`）。

**收益**：macOS 高频输出时少 syscall、少锁竞争；两侧日志不会无限增长。
**风险**：低，注意退出时 flush。
**验收**：流式输出 10 MB 时 macOS 的 syscall 数下降；日志不超过上限。

## 3. 明确不做

| 项 | 原因 |
|---|---|
| 关窗回收 WKWebView / WebView2 | 已决定不做。 |
| 给 node 进程加 `--max-old-space-size` | 只会在长会话里换来 GC 抖动，不省实际占用。 |
| 运行环境快照改 clonefile | 现状用 `moveItem` 同卷 rename，本来就不拷贝。 |
| 压缩 App 包体 | 5.4 MB / DMG 4.4 MB，收益小于改造成本。 |

## 4. 落地顺序（mac/win 同批提交）

1. **第一批：零行为变化，最容易验** —— P1-1 图标缓存、P1-2 去掉 Windows 每 10 s 落盘、P2-1 共享 HTTP client、P2-5 日志常驻句柄 + 上限。
2. **第二批：有可见行为** —— P1-3 可见性降频、P2-2 启动去同步。
3. **第三批：动产品语义** —— P2-3 token 骨架页、P2-4 端口并行。

每批一个提交，跑 macOS `./scripts/test.sh --fast`（提交前仍要全量）与 Windows `go test ./...` + 打包冒烟。

## 5. 验收指标（建议补进 TESTING.md）

| 指标 | 当前 | 目标 |
|---|---|---|
| macOS 空闲 10 min DHL CPU（窗口隐藏） | 待测（本机 3.4% 是含启动的平均值） | < 0.5% |
| macOS 空闲 10 min 角标合成次数 | 约 171 次 | 0 |
| Windows 空闲 10 min settings 写盘 | 约 60 次 | 0 |
| macOS 冷启动 → 窗口可见 | 15-29 s | < 6 s（P2-3 之后） |
| 20 个端口被占用时启动 | 最坏 30 s | < 3 s |
| `dhl.log` 24 h 体积 | 无上限 | ≤ 2 MB |

## 6. 代码位置索引

- macOS：`main.swift` 1669-1703、1719-1807、2065、2217-2245、2317-2329、2398-2425、2526-2561、2585-2611；`DSHRuntimeSupport.swift` 103-120；`StatusBadgeSupport.swift` 39-91。
- Windows：`controller.go` 281-330、556-570；`monitor.go` 27-107、172-205；`actions.go` 300-330、425-476；`launch/launch.go` 64-74、104-115、272-289、374-383；`tray.go` 34-59；`applog.go` 20-60。
