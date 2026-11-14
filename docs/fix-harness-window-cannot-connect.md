# 修复：更新/首装后内置窗口停在「Harness 页面打不开」，再也进不去

## 现象

其他机器上（更新后或首次安装）启动器内置窗口只显示一张失败卡片：

- 标题：`Harness 页面打不开`
- 详情：`Could not connect to the server.`
- 提示：菜单栏「打开 Deepseek Harness」重试、外部 dsh、「重启 Deepseek Harness」

关键在**「怎么也进不去」**：卡片上的三条建议里，前两条都只会把同一个地址再加载一遍，
第三条（重启）用户未必会点，于是界面永久卡死。

## 根因

`Could not connect to the server.` 不是启动器写的文案，仓库与 `~/.dsh/runtime`
里都搜不到这串字——它是 WKWebView 对 `NSURLErrorCannotConnectToHost` 的
`localizedDescription`。也就是说：**窗口被要求加载的 loopback 端口上没有任何进程在监听。**

真正的问题是启动器没有察觉「它以为还在跑的那个 dsh 已经没了」，有两种进入方式：

1. **接管（复用）已有实例**：`findPort()` 发现端口上已有 dsh 应答，就 `reuse` 该端口
   并把状态置为 `running`。但这条路径**拿不到 `Process` 句柄**，也就没有
   `terminationHandler`。那个实例后来退出（终端 Ctrl-C、旧版本更新留下的孤儿进程被
   回收、手动 `npx` 的终端被关掉），启动器毫无察觉：`state` 仍是 `running`、
   `selectedPort` 指向空端口。
2. **自己拉起的实例卡死**：进程还活着但不再应答（事件循环被占死）。`terminationHandler`
   只在进程真的退出时触发，这种情况同样漏过。

之后每次「打开」都会走
`openDHLForSession` → `presentHarnessWindow` → `resolveHarnessEntryURL` →
`HarnessWindowSupport.action`。由于 `loadedPort` 与目标端口一致、入口 URL 也没变，
判定结果是 `.showOnly`——**连重载都不做**，窗口就停在那张死页面上。重载同样没用，
因为地址本身已经没人服务。这就是「怎么也进不去」。

Windows 侧原本有 `watchAdopted` 覆盖了第 1 种情况的一半，但：

- 判定失效后没有清 `c.port`，`刷新页面`/`打开` 仍会把窗口指向那个空端口；
- 完全没有覆盖第 2 种情况（自己拉起的实例卡死）。

## 修复

两边都引入「运行期存活看护」，判据抽成可单测的纯函数。

macOS（`Sources/RuntimeHealthSupport.swift` + `Sources/main.swift`）：

- `startHealthMonitors` 里挂一个 5 秒节拍（`.common` 模式，菜单打开时也跑），
  就绪后持续探测当前端口是否还是 dsh；
- 连续 3 次无应答 → 判定实例已死 → `recoverDeadHarness`：清状态、清失效 token，
  走正常 `start()` 重新拉起一个**受本启动器管理**的实例；
- 进程还活着但连续 6 次无应答 → 判定卡死，同样重启（用更长预算，避免打断长回合）；
- 恢复成功后 `relaunchingAfterRestart` 让内置窗口自动加载新入口，用户不需要点任何东西。

窗口侧（`Sources/HarnessWindowController.swift`）：

- 新增 `onConnectionFailure` 回调；`didFail`/`didFailProvisionalNavigation` 在
  `RuntimeHealthSupport.isConnectionFailure` 判定为「连不上」时立刻回传端口，
  启动器马上确认一次服务是否还在——不用等 5 秒节拍；
- 认证失败（401）、导航被取消、内容类型错误**不**触发重启：那类问题重启解决不了。

Windows（`windows/internal/app/runtimewatch.go`）：

- `watchRuntime(port, owned)` 取代 `watchAdopted`，自己拉起的实例也纳入看护；
- 阈值与 macOS 对齐：死端口 3 次、存活但卡死 6 次；
- `recoverDeadRuntime` **先清 `c.port`** 再重启，堵住「刷新/打开仍指向死端口」；
- 自管实例走 `Restart()`（由它负责停掉卡死的进程树），接管实例走 `Start()`。

## 验证

- 真机复现（接管路径）：外部起一个 dsh → 启动器接管（日志出现
  `内置窗口页面加载失败：Harness 页面要求认证`）→ `kill` 掉那个 dsh →
  12 秒后日志出现 `端口上已没有 dsh 在应答（端口 3380），正在重新启动…`，
  端口重新应答（HTTP 401 = 服务就绪）。修复前同样的操作只会一直停在失败页。
- 新增 `scripts/test-runtime-health.swift`（阈值、错误分类、探测间隔）与
  `windows/internal/app/runtimewatch_test.go`（两套预算、预算大小关系、间隔）。
- `scripts/test.sh` 增加源码守卫：`startRuntimeWatchdog` / `recoverDeadHarness` /
  `onConnectionFailure` / `isConnectionFailure` 任一被删就红。
- `./scripts/test.sh --fast` 全绿；Windows 侧 `GOOS=windows go vet ./...` 与
  `go test -c` 通过。

## 教训

- **「状态」不等于「事实」**：`state == .running` 只说明启动器曾经启动成功，
  不说明端口现在还有人应答。凡是「我启动过」被当成「它还在」的地方，都要有一个
  持续复核。
- **兜底页必须自带出路**：一张写着「打不开」的页面，如果没有一条能真正改变状态的
  动作，它就是死路。修复时优先让系统自己恢复，而不是把责任推给用户点菜单。
- **复用外部进程等于放弃进程生命周期**：拿到别人的端口就再也收不到它的退出事件，
  这类「借来的运行状态」必须自带探活。
