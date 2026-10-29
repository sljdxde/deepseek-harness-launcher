# UI 边界审计：提示框、窗口与菜单

范围：启动器原生界面（`Sources/*.swift`、`Installer/main.swift`）与随包的 Harness 侧边栏界面
（`Plugins/*/client`）。聚焦同一类问题：**内容超出容器、控件落到屏幕外、模态把主线程锁死**。

## 1. 事故复盘（Intel Mac：升级 dsh 后弹窗占满屏幕、软件卡死）

现象是三条独立缺陷叠在一起，缺一条都不会演变成「只能强杀」：

1. **报错内容里全是用户没装过的东西**。`/dsh-plugin-manager/installed` 的「core bundle」判定
   只硬编码了 `@deepseek-ai/dsh-base`、`dsh-web-app`、`dsh-headless` 三个名字，而 profile 的
   `dsh.profile.bundles` 里还有一串 `@deepseek-ai/dsh-experimental-*`（本机 9 个）。它们被标成
   `source: "user"`，于是「用户插件」扫描把它们当第三方插件逐个判 peer 兼容性。
2. **一个插件报十几行**。dsh 升级后 runtime 里的 peer 版本整体位移，一个 bundle 声明的十几个
   peer 同时不满足，全部用 `；` 拼进同一条 reason。
3. **弹窗随行数线性长高，且不会自动收进屏幕**。实测 40 行正文把 `NSAlert` 顶到 1449pt，而
   1080p 屏的 `visibleFrame` 只有 968pt：底部按钮整排落到屏幕外。旧写法又是「一个 issue 一个
   NSAlert 串行 `runModal()`」，`runModal` 同步占住主线程、默认不响应 Esc → 点不到按钮、
   退不掉 App，只能强杀。这就是「占满整个屏幕、无法关闭、软件卡死」。

## 2. 现在的护栏（四层）

- **内容封顶**（`AlertBoundary.setBoundedText`）：正文超过 240 字符就折进高度封顶的可滚动面板，
  窗口不再随行数长高。锚定：`scripts/test-alert-design.swift`。
- **屏幕预算**（`AlertBoundary.detailHeightCap`）：面板高度 = min(220, 可视高 − 300)，小屏自动变矮。
  锚定：同一测试，直接注入 `visibleHeight` 断言纯函数。
- **显示前复核**（`AlertBoundary.configureForPresentation`）：量一次窗口高度，仍然超屏就逐层压缩
  （压面板 → 折正文 → 压正文），并挂上 Esc。锚定：同一测试里「未走护栏」与「更新弹窗压小屏」两条用例。
  压缩时有两个必须同时成立的前提，缺一个就变成「压了等于没压」（都是本轮实测出来的）：
  - 要压的是**压得动**的面板，不是「第一个滚动视图」——`NSPopUpButton` 内部自带一个没有高度
    约束的滚动视图，先撞上它就直接退出压缩（`AlertBoundary.shrinkablePanes`）；
  - 改完面板约束之后还要把外层容器的 frame 一起收缩——`AlertDesign.card` 建好时按
    `stack.fittingSize` 定了一次 frame 就再不重算，而 NSAlert 是按 accessory 的 frame 摆窗口的。
    实测面板从 300 压到 72 后窗口仍停在 574pt，跟着 `fittingSize` 收卡片 frame 才降到 346pt
    （`AlertBoundary.refitFrames`）。
  两条护栏共用同一份只读面板构造 `AlertBoundary.textPane`（说明面板与详情面板都走它），
  否则「scroll 自持一条可修改的高度约束」这条不变量会在其中一处悄悄断掉。
- **模态不叠加**（`AlertDesign.runIfIdle`）：后台定时器触发的提示在已有弹窗时并入日志，不叠第二层。
  锚定：`scripts/test.sh` 的字符串门禁。

统一入口只有 `AlertDesign.run` / `AlertBoundary.run`（后者是安装器用的同一实现），
门禁会直接拒绝任何 `alert.runModal()`。

**为什么把实现拆进 `Sources/AlertBoundary.swift`**：安装器是独立编译目标，
`AlertDesign` 依赖发布通道（`DSHReleaseChannel`）等 App 侧类型拖不进去，而安装器的失败弹窗
恰恰是最需要护栏的一处。拆开后两个目标共用同一套封顶逻辑，不是两份相似实现。

## 3. 本轮修掉的其它边界问题

按严重度排序，均可复现/可断言：

- **安装器的三重锁死**（`Installer/main.swift`）：失败弹窗把 `install-from-app.sh` 的原始输出
  直接塞进 `informativeText`（长度不可控）→ 与事故同源；主窗口 `styleMask: [.titled]` 且关闭
  按钮被隐藏，没有任何退出入口；`task.waitUntilExit()` 没有超时，脚本一挂就永远停在进度窗口。
  现在：正文走护栏 + Esc；子进程输出改写成安装日志文件（原来的 `readDataToEndOfFile` 要等
  所有写端关闭，而超时退出后读端一关，还在跑的 `ditto`/`cp` 会吃到 SIGPIPE），失败与超时文案
  都把日志路径告诉用户；15 分钟看门狗到点后把界面还给用户，并**不 kill 子进程**——脚本可能
  正停在 `mv` 旧 App / `ditto` 新 App 中间，从外面打断会留下半份安装目录。
- **设置窗口不可缩放又没有滚动**：高度由内容决定（538pt），一旦高于屏幕可视区，底部「保存/取消」
  出屏且拖不回来。现在内容整列放进滚动视图，窗口高度受屏幕预算约束。踩到的坑：`NSClipView`
  默认不翻转坐标，documentView 的初始可视区是文档**底部**，必须用 `TopLeftClipView`；
  documentView 宽度也必须给绝对值，改成 `== scroll.widthAnchor` 会形成循环引用、被压缩成 299pt。
- **`MenuRowView` 长文案压在快捷键上**：标题用 `draw(at:)` 从 x=32 一路画到底，行宽固定 360pt，
  超长（远端 npm 版本号、隔离插件的包名）会被菜单静默裁掉，而右侧快捷键仍按 `bounds.width` 定位，
  两者直接重叠。现在画进留出快捷键区的矩形并尾部省略。
- **「插件恢复」菜单行的文案从来没更新过**：`refreshRecoveryMenuItem` 只改 `NSMenuItem.title`，
  而带 view 的菜单项画的是 `MenuRowView.title`。用户永远只看到「插件恢复」，看不到
  「已隔离 N 个插件」「退出安全模式」这两种状态。现在通过 `setMenuRow` 同时改两处。
- **定宽单行标签按 `byClipping` 硬切**：安装进度窗口的状态行/详情行/进度行、下载窗口的版本行、
  安装器状态行——文案里带版本号时实测 451pt、458pt 超出 350pt 宽，从字中间硬切且看不出被切。
  统一改 `byTruncatingTail`。
- **菜单行与菜单栏文案封顶**：`AlertBoundary.singleLine`（默认 72 字符，菜单栏 20 字符）。
- **提权安装分支的转义把路径打死**（`scripts/Install DHL.command`）：原写法在 `printf %q`
  的结果外面又手动包了一层 `\"…\"`。`%q` 已经把空格变成 `\ `，再包引号后 root 的 `/bin/sh`
  在双引号内不认这个转义，DMG 卷名里的空格（`/Volumes/Deepseek Harness Launcher`）直接让路径
  找不到——只要目标目录不可写、用户走「双击 .command 安装」这条路径，提权必然失败。
  同时缺 `DHL_USER_HOME`（root 的 `$HOME` 是 `/var/root`，按用户目录的清理全打错目标）与
  `--no-open`（以 root 身份 `open` 用户的 App，会把 `~/Library` 的日志/偏好写成 root 属主）。
  现在与「双击完成安装或更新.app」共用同一套参数与转义，提权结束后再由当前用户 `open`。
  锚定：`scripts/test.sh` 对 `.command` 断言 `zsh -n` + `DHL_USER_HOME=` + `--no-open`，
  并禁止 `\"$SCRIPT_DIR` 这种手动包引号的形态。

## 4. 查过但确认不是问题

留个记录，省得下轮重复排查：

- **`NSTextView` 折超长不可断 token**：整条 URL / 单个超长单词不会撑破宽度，实测
  `byWordWrapping` 与 `byCharWrapping` 的 `usedHeight` 相同（AppKit 内部对超宽行自动断字符）。
- **三个 Harness 侧边栏插件（插件管理 / 归档 / 会话通知）的弹层**：容器已有
  `max-height:82vh`/`80vh` + `overflow-y:auto`，长标题用 `text-overflow:ellipsis`，
  文案一律 `textContent` 注入（无 `innerHTML` 撑高或注入风险）。
- **`NSMenu` 自身高度**：菜单项再多也由系统滚动/分页，不存在超出屏幕后点不到的问题。
- **更新弹窗的版本下拉**：候选版本来自远端 npm，数量不可控，但它是固定高度的 `NSPopUpButton`
  列表，不参与正文测高，压缩路径不会把它销毁（有专门用例）。

## 5. 已知残留风险（本轮刻意不改）

- 后台触发的「启动失败」弹窗仍可能叠在用户打开的弹窗之上（模态栈可以一层层关掉，不会卡死；
  而漏掉一次失败提示比多看一个框更糟）。只有兼容性提示走 `runIfIdle`。
- `NSAlert` 在 `runModal()` 时会自己重新居中窗口，**移动窗口不是**超屏的解法；保证手段只有
  「把窗口压回屏幕内」。若屏幕可视高小于 300pt，最后一层也只能保住正文，交互控件（更新弹窗的
  版本下拉）不会被销毁。带下拉的更新弹窗在极矮的屏幕上会先压说明面板、再砍正文摘要，
  最后仍然放不下时宁可让窗口略高于可视区——销毁版本下拉等于让用户没法选版本。
  这一档用户按 Esc 仍能关掉弹窗（`escapeButtonIndex` 挂在「稍后」上），不会回到事故里
  「点不到也关不掉」的状态。
- 安装器超时不 kill 子进程：脚本真死锁时需要人工介入，界面已把「别重复打开安装器」的处置说清。
- view-based 菜单项的 `NSMenuItem.title` 仍为空，VoiceOver 读不到行文案（可访问性，另行处理）。
- Harness 侧边栏（插件管理 / 归档 / 会话通知）本轮只做了粗查：长标题用 `overflow:ellipsis`、
  列表容器 `max-height:82vh` + `overflow-y:auto`，形态上没有同类「无界撑高」风险。

## 6. 下次改 UI 时的自检清单

1. 这段文字有长度上限吗？上限来自远端还是本地？超了会被谁裁掉、用户看得出被裁了吗？
2. 这个容器有高度上限吗？内容比屏幕高时，主操作按钮还点得到吗？
3. 这个弹窗是用户主动触发的，还是定时器/回调触发的？后者必须 `runIfIdle`。
4. 窗口不可缩放时，底部按钮是否可能落到可视区外？
5. 子进程/网络等待有没有超时？超时后有没有把界面还给用户的手段？
6. 这段字符串会不会经过第二层解释器（`osascript` / `sh -c` / `sudo`）？每层都有自己的转义规则，
   优先把参数交给 `printf %q` 并只转义一次，别手动补引号。
