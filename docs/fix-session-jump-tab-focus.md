# Bug 分析：菜单「会话完成」点进去，浏览器没有跳到该会话

> 影响版本：v0.3.1 - v0.3.10（`BrowserAutomationSupport` 建起来之后一直如此）
> 修复状态：本地修复，未提测

## 一、现象

菜单栏「会话完成」区块里点某条提醒，期望是**在已打开的 Harness 标签页里直接看到那个会话**。
实际经常「没反应」：Chrome 被切到前台，但停在用户原来那个标签页（常常是别的网页），
Harness 标签页在后台悄悄换了会话，用户以为没跳。

## 二、日志证据

`~/Library/Logs/Deepseek Harness Launcher/dhl.log`，统计整个文件：

```console
$ grep -c "未找到匹配标签页" dhl.log
9
$ grep -c "已定位并前置 Harness 标签页" dhl.log
0
```

**9 次点击、9 次「未找到匹配标签页」，0 次成功。** 也就是说「精确选中已有标签」
这个能力自上线以来一次都没生效过，每次都退化成「只前置浏览器」：

```
[15:29:51] 用户查看会话完成提醒：session-f5fdfff1-…
[15:29:51] 检测到 Google Chrome 已连接 Harness 端口 3080，但未找到匹配标签页；已前置浏览器
```

## 三、原因分析

`BrowserAutomationSupport.tabScript` 用 **整串 URL 相等** 匹配标签页：

```applescript
if targetURLs contains (URL of browserTab as text) then   -- 列表里是
                                                          -- http://127.0.0.1:3080/ 等整串
```

而浏览器里那张标签页的地址几乎不可能是干净的根地址：

| 来源 | 标签页真实 URL |
|------|----------------|
| dsh 0.1.5-rc.2+ 入口行 `dsh web: http://127.0.0.1:<port>/?token=…` | `…/?token=…`（token 换 cookie 前就是它） |
| 客户端留下 `#` 片段 / 尾斜杠差异 | `…#/…`、`…`（无尾斜杠） |
| 手工输入 `localhost` / `[::1]` | 别的 authority 写法 |

整串比较对上述任何一种都不成立 → `missing` → 调用方只 `browser.activate()`：
Chrome 切到前台，但显示的是**它自己当前那个标签**。会话本身其实换成功了
（插件 `/commands` 的 claim/ack 链路正常，插件侧 `viewed` 事件证明客户端已切到目标会话），
用户看到的是「切了浏览器、没切会话」。

### 为什么「会话本身是对的」

同一批点击在插件事件流里都能看到 1-7 秒后目标会话的 `viewed` 记录：

```console
13:42:01 点击 session-b536ad48 → 13:42:02 viewed session-b536ad48
14:16:11 点击 session-a8193f3e → 14:16:13 viewed session-a8193f3e
14:28:01 点击 session-a8193f3e → 14:28:03 viewed session-a8193f3e
```

说明链路里坏的只有「选中标签」这一步，`/dsh-session-notify/open` → claim → `uiWorkspace.openSession`
是通的。所以修复只能落在标签匹配上，不必动插件协议。

## 四、修复

1. **匹配改为按 origin**（`scheme://host:port`，不带尾斜杠）：
   标签 URL 必须等于 origin，或以 `origin + / ? #` 开头才算命中。
   这样 `?token=…`、`#…`、尾斜杠、localhost/[::1]/127.0.0.1 全都命中，
   而 `:30800` 这种「前缀陷阱」不会被误判。
2. **失败留下证据**：脚本在没命中时把浏览器自己报出来的标签页地址带回启动器
   （`missing` + 每行一个 URL，最多 4 条），启动器写进日志：
   `…但未找到匹配标签页（2 个已开标签：http://127.0.0.1:3080/?token=… | …）；已前置浏览器`。
   下次再出问题，从日志就能直接看出浏览器当时开的是什么。
3. **跳转请求的送达结果也进日志**：`POST /dsh-session-notify/open` 非 200（外部 Harness、
   旧插件、插件未加载）时写一行，避免「点了没跳」完全无痕。
4. 重启接管的「关闭旧标签页」复用同一套匹配，同样从整串比较改为 origin 比较。

## 四之二、第二个根因：同一浏览器跑着多个实例（环境侧，尚未根治）

修好 URL 匹配后仍然复现，实测发现这台机器上 `com.google.Chrome` 有**两个实例**：

```console
$ lsappinfo list | grep -A4 '"Google Chrome"'
 pid = 711  type="Foreground"                       # 用户自己的 Chrome（2 天）
 pid = 661  type="BackgroundOnly"                    # agent-browser 常驻的自动化 Chrome
```

- `lsof` 命中的是 711（它才连到 3080）；
- 但 `tell application id "com.google.Chrome"` 只把事件发给**最近启动**的那个实例，
  也就是 661（自动化浏览器，标签页里根本没有 Harness 页面）；
- 先 `activate` 711 再发事件也没用（实测两种顺序都返回同一批标签）；
  这是 macOS / Chrome 的限制，不是参数问题。

实测证据（AE 枚举到的标签）：

```console
pid 711 (用户 Chrome, 2 天) : 前/后各激活一次，AE 仍返回 661 的两个标签
AE 返回的标签            : chrome://newtab/ | http://127.0.0.1:8931/原型-…html
```

`agent-browser` 是**常驻 daemon**（PID 7898，已跑 2 天），它拉起的 Chrome 会一直在，
所以这不再是偶发：只要它活着，标签定位就必然落空。

现在的处置：启动器把「实例数」写进日志（`…有 2 个实例在运行，AppleScript 只会发给
最近启动的那个，页面可能在另一个实例里`），不再让「未找到匹配标签页」冒充「页面没开」。

### 四之三、2026-10-22 复现：agent-browser 的无头 Chrome 再次抢走寻址

同一条链路又被报「点击已完成无法正确跳转」。这次的事实链（全部现场可查）：

```console
$ grep "未找到匹配标签页" dhl.log | tail -1
[10:07:55] 检测到 Google Chrome 已连接 Harness 端口 3080，但未找到匹配标签页
（2 个已开标签：chrome://newtab/ | http://127.0.0.1:8747/play.html?...；
Google Chrome 有 2 个实例在运行，AppleScript 只会发给最近启动的那个…）；已前置浏览器

$ lsof -nP -a -iTCP:3080 -sTCP:ESTABLISHED | grep Google
Google 1462    # ppid=1285，用户自己的 Chrome（foreground）

$ lsappinfo list | grep -A2 '"Google Chrome".*com.google.Chrome'
pid = 1285  type="Foreground"      # 用户 Chrome，Harness 页面在这里
pid = 93211 type="BackgroundOnly"  # agent-browser daemon 拉起的 --headless=new Chrome，后启动

$ osascript -e 'tell application id "com.google.Chrome" to get URL of every tab of every window'
chrome://newtab/ | http://127.0.0.1:8747/play.html?...   # 枚举到的是 93211 的标签
```

结论：**代码没有回归**（当前 `/Applications` 的 0.3.10-1.2 二进制已含 origin 匹配），
是环境里的第二个 Chrome 实例（agent-browser 常驻 daemon，`--headless=new`）比用户
Chrome 后启动，AppleScript 按「最近启动」寻址于是永远落在它身上。lsof 找到的连接实例
（1285）与 AppleScript 能寻址的实例（93211）不是同一个，标签定位必然落空。

这次的可测改进：

- 诊断单独抽成 `wrongBrowserInstance`（多实例未命中）与 `noHarnessTab`（单实例未命中），
  日志在「未找到匹配标签页」之外明确写出「AppleScript 寻址到了另一个实例（N 个实例在运行，
  事件只发给最近启动的那个，Harness 页面在真正连接的这个实例里）」，并给可执行建议
  「退出那个后台/自动化浏览器实例后即可恢复精确选中标签页」；
- 这套判断全部在 `Sources/SessionJumpSupport.swift`，`main.swift` 只执行，行为由
  `scripts/test-session-jump.swift` 锁住（见第六节）。

### 四之四、2026-11-03 复现：被寻址的实例里也有一个 Harness 标签页

同一条链路又被报「已完成任务点击，定位会出现问题」。这次的现象与以往相反：
日志写的是**成功**，`found` 也确实发生了，但用户看到的是**另一个窗口**里的页面。

```console
$ grep "用户查看会话完成提醒" -A1 dhl.log | tail -2
[10:28:59] 用户查看会话完成提醒：session-2faab170-…
[10:28:59] 检测到 Google Chrome 已连接 Harness 端口 3080，已定位并前置 Harness 标签页

$ lsof -nP -a -iTCP:3080 -sTCP:ESTABLISHED | grep Google
Google 4376    # ppid=4366，用户自己的 Chrome（Harness 页面真正在这里）

$ ps -p 4366,87662 -o pid,lstart,command
  4366  Tue Nov  2 17:53:44 2026  .../Google Chrome                                   # 用户 Chrome
 87662  Tue Nov  3 10:01:37 2026  .../Google Chrome --user-data-dir=…/chrome-devtools-mcp/…  # 自动化浏览器，后启动
```

`87662` 是自动化工具（`chrome-devtools-mcp`）拉起的第二个 Chrome；它的标签页里有
一张 `http://127.0.0.1:3080/?token=jpMi55W…`——上一次运行留下的**过期 token 页面**
（打开即 401）。AppleScript 按「最近启动」只寻址 `87662`，脚本在它的标签里按 origin
匹配成功 → 选中那张 401 页并 `activate` → 用户被带到错误的浏览器窗口。

也就是说，**多实例下的 `found` 也可能是假的**：真正连着 Harness 的实例（`4366`）
根本没被寻址，被选中的是另一个实例里的同名 origin 页面。

这次的可测改进：

- 发标签页脚本**之前**先判可达性：`SessionJumpSupport.appleScriptReachesConnectedInstance`，
  用内核启动时刻（`proc_pidinfo`，不用 `NSRunningApplication.launchDate`——它对
  非 LaunchServices 启动的实例是 nil）判断「真正连着 Harness 的实例是不是最新启动的」；
  启动时刻读不到或同秒启动都按不可达保守处理；
- 不可达时**一次标签页脚本都不发**（不选中、也不关闭）：那只会作用在错误实例上。
  改为前置真正连着 Harness 的实例，并通过插件把「打开会话」命令投递给页面；重启接管
  则跳过关旧标签、直接开新页面；
- 日志不再谎报成功：「…但同 bundle 有 N 个实例在运行，AppleScript 只会发给最近启动的
  那个（不是连着 Harness 的这个）；未改动另一个实例的标签页，已前置真正连接 Harness
  的浏览器并投递会话。退出那个后台/自动化浏览器实例后即可恢复精确选中标签页」；
- 判定与文案全部在 `Sources/SessionJumpSupport.swift`，`main.swift` 只落地，行为由
  `scripts/test-session-jump.swift` 锁住（可达/不可达/同秒/时刻未知/实例缺失、端到端
  步骤顺序「不选中标签页也必须投递会话」）。

根治仍是环境层面的：退出那个自动化/后台浏览器实例，别让它在 `127.0.0.1:<port>` 上
留下 Harness 标签页。

### 四之五、2026-11-03 复测：「只前置浏览器」对「用户切到别的标签」无效

四之四的保守处置（不可达时只 `activate` 浏览器 + 投递会话）发布后仍被报
「浏览器开着别的 tab，点完成的任务，跳不过来」。日志里能看到它按设计走了新路径：

```console
[11:14:57] 检测到 Google Chrome 已连接 Harness 端口 3080，但同 bundle 有 2 个实例在运行，
           AppleScript 只会发给最近启动的那个（不是连着 Harness 的这个）；
           未改动另一个实例的标签页，已前置真正连接 Harness 的浏览器并投递会话。
```

问题在于：用户的 Harness 标签在同一个 Chrome 里，但当前选中的是**别的标签**。
`activate` 只会把 Chrome 窗口提到前面，标签不会换，会话命令虽然切了会话，人却
看不见——用户视角仍是「点了没反应」。而 AppleScript 又只能发到错误实例，
`NSWorkspace.open` 同样可能落到「最近启动」的另一个实例。

这次的可测改进（保留「不碰错误实例」的前提，补上「把会话送到眼前」）：

- 注入客户端在 commands 轮询里附带 `visible=1/0`（`document.visibilityState`），
  并监听 `visibilitychange` 立刻补一次心跳——否则后台标签被节流后，启动器会拿到
  过期的「可见」，又退回只 `activate`；
- `/presence` 返回 `{ active, clients, visible }`；启动器在**不可达**时按
  `SessionJumpSupport.unreachablePresentation(pageVisible:)` 二选一：
  - 页面可见（Harness 就是当前标签）→ 只前置浏览器（`unreachableInstance`）；
  - 页面不可见 / 可见性未知 → 用**按 pid 定向**的 `GURL` Apple Event 在真正连接的
    实例里新开一个 Harness 标签（`BrowserAutomationSupport.openURL`），新标签会
    被前置，客户端随后领取会话命令切到目标会话。代价是多一张标签（原标签保留），
    日志写明「退出后台实例后即可恢复在原标签里直接切换」；
- 定向事件投递失败（浏览器拒绝 / 自动化权限被收回）→ 退回只前置并如实记日志，
  绝不装成成功；
- 重启接管在不可达时也改用按 pid 定向新开页面（用新进程的 token 入口），不再靠
  「默认实例」碰运气；
- 单实例 / AppleScript 可达时行为完全不变：仍是精确选中已有标签，不新开。

2026-11-03 实测按 pid 定向的 `GURL` 事件：目标实例（`chrome-devtools-mcp` 拉起的
Chrome）里确实多出目标页面，说明跨实例寻址可行；这正是四之四「已知的平台限制」
里那条「只能新开标签页」能力的落地用法。

### 已知的平台限制

- 按 PID 定向的 Apple Event **可行**（实测 `GURL` 事件能精确投递到指定实例），
  但它只能打开**新标签页**，不会复用/选中已有标签；
- 选中已有标签只能走 AppleScript（受上述实例寻址限制）或 Accessibility API
  （需要给启动器开「辅助功能」权限，与当前只用「自动化」权限的设计冲突）；
- 手写 Chrome 的 AEOM（`obj ` 对象说明符 + `getd`/`setd`）理论可行，实测未跑通，
  且完全无法单测，暂不采用；
- 多实例下的当下解法：退出后台/自动化浏览器实例（本例为 agent-browser daemon）后，
  AppleScript 重新落到唯一实例上，精确跳转立即恢复。2026-10-22 实测：

  ```console
  $ agent-browser close --all
  ✓ Closed session: default
  $ ps -axo pid,command | grep "MacOS/Google Chrome$"   # 只剩用户 Chrome 1285
  $ osascript -e 'tell application id "com.google.Chrome" to get URL of every tab of every window'
  …, http://127.0.0.1:3080/
  $ ./build/verify_focus    # 用启动器同一套 browserFocusScript 实测
  focus result: focused
  ```

- 启动器侧已做「不可达就不碰标签页」的保守处置（见四之四），并用按 pid 定向的
  `GURL` 事件补上「新开标签」能力（见四之五）：不会再被带到错误窗口，也能把会话
  送到眼前；但**在正确实例里精确选中已有标签页仍做不到**——那需要平台能力
  （按实例寻址 AppleScript 的 AEOM 未跑通，Accessibility 需要额外权限）。


## 五、回归验证清单

1. Chrome 只开一个 Harness 标签 → 菜单点完成提醒 → **该标签被选中并切到对应会话**，
   日志出现「已定位并前置 Harness 标签页」（不再出现「未找到匹配标签页」）；
2. Harness 标签在后台、前台是别的网页 → 点提醒 → Chrome 前台显示的是 Harness 标签，
   且是该会话；
3. 标签地址手动改成 `localhost:3080` 或 `127.0.0.1:3080`（无尾斜杠）→ 仍能选中；
4. 有重复 Harness 标签时只选中最前面那一个（`windowIndex is not 1` 时把窗口提到最前）；
5. 关闭标签页后点提醒 → 走 presence 心跳路径重新开页面（原有行为不变）；
6. 重启接管（更新 dsh 后）→ 旧标签被关闭、新页面打开（close 走同一 origin 匹配）；
7. 多实例环境（agent-browser / chrome-devtools-mcp 常驻）→ 日志出现「AppleScript 只会
   发给最近启动的那个（不是连着 Harness 的这个）…」+ 实例数 +「退出那个后台/自动化浏览器
   实例」建议，且**不会被带到另一个实例的窗口**；
8. 多实例环境 + **用户切到别的标签**（Harness 标签在同一个 Chrome 里但不可见）→ 点提醒
   必须在真正连接的实例里**新开一个 Harness 标签并切到目标会话**（日志「选中不了你正在看的
   Harness 标签；已在真正连接 Harness 的浏览器里新开一个 Harness 标签…」），不能只前置浏览器；
9. 多实例环境 + Harness 标签**就是当前标签** → 只前置浏览器 + 切会话，不该多开标签；
10. 多实例环境里另一个实例也开着 Harness origin 的标签页（过期 token / 401 页）→ 点提醒
    不得跳到那个窗口（这是 2026-11-03 的假 `found`），日志必须写明「未改动另一个实例的标签页」；
11. 退出后台实例后再点提醒 → 日志回到「已定位并前置 Harness 标签页」。

## 六、测试覆盖（防「改 A 坏 B」）

这条链路的判断全在 `Sources/SessionJumpSupport.swift`（`main.swift` 只负责执行
AppleScript / NSWorkspace / HTTP），单测入口：

```sh
./scripts/test-one.sh session-jump      # 只跑这一条
./scripts/test.sh --fast                # 全量断言（含这一条）
```

`scripts/test-session-jump.swift` 锁住的不变量：

- **点击处置**：实例在跑才直接跳；没在跑先启动并在就绪后补跳；安装/更新运行环境时等装完；
- **页面计划**：presence 心跳说页面全关 → 重开页面（而不是对着空标签跑自动化）；
  重启接管 → 先关旧标签再开新页面；页面还在 → 只选中标签，绝不把 URL 再交给浏览器
  （否则会开出重复标签）；
- **失败诊断**：单实例未命中 vs 多实例未命中必须区分，日志必须带浏览器实际标签作为证据，
  多实例日志必须给「退出后台/自动化浏览器」的可执行建议；已确认寻址到连着 Harness 的
  实例时，多实例未命中不得再甩锅给「另一个实例」；
- **多实例寻址守卫**：只有连着 Harness 的实例是最新启动的才允许发标签页脚本；
  另一个实例更新/同秒启动/启动时刻未知/已连接实例不在列表里 → 判不可达，一次脚本都不发，
  只前置真正连接的实例，日志不得谎报「已定位并前置 Harness 标签页」；
- **不可达时的呈现选择**：页面可见 → 只前置（`activateOnly`）；不可见/可见性未知 →
  按 pid 定向在正确实例里新开标签（`openNewTabInConnectedInstance`），事件投递失败时
  退回只前置并如实记录；端到端顺序锁住「新开标签在投递会话之前」；
- **页面可见性上报**：commands 轮询携带 `visible=0/1`、`visibilitychange` 立即补心跳
  （`test-client`）；`/presence` 的 `visible` 字段解析：缺失返回 nil，绝不把缺失当 true
  （`test-browser-connection`）；
- **降级顺序**：未命中时「先前置浏览器 → 再记日志 → 最后仍投递打开会话」；
- **不变式**：任何分支都必须投递「打开会话」命令（标签没选中只影响看得见看不见），
  且必须收尾（清 inFlight / 跑 completion），否则下一次点击会被吞掉；
- **历史回归联动**：跳转仍按 origin 匹配（整串 URL 比较会让所有点击退化成「仅前置浏览器」），
  详细断言在 `scripts/test-browser-connection.swift`。

`scripts/test.sh` 另有反例守卫：标签定位失败的判断/文案只许在 `SessionJumpSupport`
里定义，`main.swift` 重新出现 `未找到匹配标签页` 的分支就判失败——防止可测逻辑再塞回
不可测的异步回调里。

