import Foundation

// 点击菜单栏「会话完成」→ 跳转到那个会话的完整决策链单测。
//
// 这条链路被反复改坏过（整串 URL 匹配标签、跳转请求没投递、重启接管顺序错、
// 多实例时把「页面在另一个 Chrome 实例里」误报成「页面没开」），而判断逻辑
// 原来全写在 main.swift 的异步回调里，测试二进制加载不了 App 主类——只能 grep
// 字符串，挡不住行为回归。现在决策抽到 Sources/SessionJumpSupport.swift，
// 这里逐条锁死：
//   1. 点击处置：直接跳 / 先启动再跳 / 等运行环境装完再跳；
//   2. 页面阶段：重开页面、重启接管先关旧标签、还是精确选中已有标签；
//   3. 多实例寻址判定：AppleScript 只发给最近启动的实例，只有连着 Harness 的
//      实例恰好是最新启动的才允许发标签页脚本（另一个实例里也可能有 Harness
//      标签页，选中它＝把用户带去错误窗口）；
//   4. 不可达时的呈现选择：页面可见 → 只前置；不可见/未知 → 按 pid 定向在正确
//      实例里新开标签（只前置对「用户切到别的标签」无效，等于点了没反应）；
//   5. 标签选中失败：单实例 vs 多实例的诊断不同、降级动作不同、日志必须留证据；
//   6. 不变式：任何分支都必须投递「打开会话」命令 + 必须收尾（否则后续点击被吞）。
//
// 编译：swiftc scripts/test-session-jump.swift Sources/SessionJumpSupport.swift \
//        Sources/BrowserConnectionSupport.swift Sources/BrowserAutomationSupport.swift \
//        -o build/test-session-jump -framework AppKit

@main
struct SessionJumpChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func checkEqual<T: Equatable>(_ actual: T, _ expected: T, _ label: String) {
        if actual != expected { failures.append("\(label)：期望 \(expected)，实际 \(actual)") }
    }

    static func main() {
        let chrome = SessionJumpSupport.BrowserInfo(name: "Google Chrome", bundleIdentifier: "com.google.Chrome", instanceCount: 1)
        let chromeMulti = SessionJumpSupport.BrowserInfo(name: "Google Chrome", bundleIdentifier: "com.google.Chrome", instanceCount: 2)
        let safari = SessionJumpSupport.BrowserInfo(name: "Safari", bundleIdentifier: "com.apple.Safari", instanceCount: 1)

        // MARK: - 1. 点击处置（菜单点击 / 提醒点击）
        // 实例在跑：立刻开页面并投递会话，不该先重启。
        checkEqual(SessionJumpSupport.clickDisposition(isRunning: true, hasPort: true, isInstalling: false),
                   .jumpInPlace, "实例在跑应直接跳")
        // 没在跑（或还没拿到端口）：先启动，再把这次点击补上——不能因为「晚了几秒」丢掉点击。
        checkEqual(SessionJumpSupport.clickDisposition(isRunning: false, hasPort: false, isInstalling: false),
                   .startThenJump, "没在跑应先启动再跳")
        checkEqual(SessionJumpSupport.clickDisposition(isRunning: true, hasPort: false, isInstalling: false),
                   .startThenJump, "没有端口等同没就绪，应先启动再跳")
        // 正在装/更新运行环境：等装完，别在安装中途去开一个旧进程的页面。
        checkEqual(SessionJumpSupport.clickDisposition(isRunning: false, hasPort: false, isInstalling: true),
                   .waitForInstall, "安装运行环境时应等安装完成")
        checkEqual(SessionJumpSupport.clickDisposition(isRunning: true, hasPort: true, isInstalling: true),
                   .waitForInstall, "安装优先于直接跳")

        // MARK: - 2. 页面阶段计划
        // 每条用例：presence 心跳、有没有已连接的浏览器、是不是重启接管。
        let pageCases: [(name: String, presence: Bool?, browser: SessionJumpSupport.BrowserInfo?, restart: Bool, expect: (reopen: Bool, close: Bool, focus: Bool))] = [
            ("外部实例无心跳、无浏览器", nil, nil, false, (true, false, false)),
            ("有连接但找不到浏览器", true, nil, false, (true, false, false)),
            ("页面心跳说全关（连接还挂着）", false, chrome, false, (true, false, false)),
            ("页面心跳缺失、浏览器已连接", nil, chrome, false, (false, false, true)),
            ("页面还在、浏览器已连接", true, chrome, false, (false, false, true)),
            ("重启接管：有关着的旧标签", true, chrome, true, (true, true, false)),
            ("重启接管：心跳缺失", nil, chrome, true, (true, true, false)),
            ("重启接管但没有页面：无旧标签可关", false, chrome, true, (true, false, false)),
            ("重启接管但没有浏览器", nil, nil, true, (true, false, false)),
        ]
        for item in pageCases {
            let plan = SessionJumpSupport.pagePlan(
                presenceActive: item.presence, browser: item.browser, restartTakeover: item.restart
            )
            checkEqual(plan.reopensPage, item.expect.reopen, "页面计划[\(item.name)].重开页面")
            checkEqual(plan.closesOldTab, item.expect.close, "页面计划[\(item.name)].先关旧标签")
            checkEqual(plan.focusesTab, item.expect.focus, "页面计划[\(item.name)].选中已有标签")
            // 互斥：重开页面时绝不交给 AppleScript 选标签（会开出重复标签）。
            check(!(plan.reopensPage && plan.focusesTab), "页面计划[\(item.name)]：重开页面与选中标签互斥")
            checkEqual(plan.usesConnectedBrowser, item.expect.focus || item.expect.close,
                       "页面计划[\(item.name)].是否沿用已连接浏览器")
        }

        // MARK: - 3. 标签选中结果 → 诊断 / 降级 / 日志
        let evidenceTabs = ["chrome://newtab/", "http://127.0.0.1:8747/play.html"]
        let focused = SessionJumpSupport.focusPlan(result: .focused, browser: chrome)
        checkEqual(focused.diagnosis, .focused, "选中成功诊断")
        check(!focused.activateBrowser, "选中成功不该再走「仅前置浏览器」降级")
        let focusedLog = SessionJumpSupport.focusLog(focused, browser: chrome, port: 3080)
        check(focusedLog.contains("已定位并前置 Harness 标签页"), "成功日志应说明标签已选中：\(focusedLog)")
        check(!focusedLog.contains("已前置浏览器"), "成功时不应出现降级文案：\(focusedLog)")

        // 单实例：页面可能真的没开（或 URL 真不匹配）。日志要留下浏览器报出的标签。
        let singleMissing = SessionJumpSupport.focusPlan(result: .missing(tabs: evidenceTabs), browser: chrome)
        checkEqual(singleMissing.diagnosis, .noHarnessTab(tabs: evidenceTabs), "单实例未命中诊断")
        check(singleMissing.activateBrowser, "未命中时必须前置浏览器")
        let singleLog = SessionJumpSupport.focusLog(singleMissing, browser: chrome, port: 3080)
        check(singleLog.contains("未找到匹配标签页"), "单实例未命中应如实说未找到：\(singleLog)")
        check(singleLog.contains("chrome://newtab/"), "未命中日志必须带上浏览器实际标签作为证据：\(singleLog)")
        check(!singleLog.contains("另一个"), "单实例不该甩锅给「另一个实例」：\(singleLog)")

        // 多实例：AppleScript 只发给最近启动的实例，页面在真正连接的那个里。
        // 这是本机实测的「点了没反应」——诊断必须区分开，别让用户以为插件坏了。
        // 只有「已确认脚本寻址不到连着 Harness 的实例」时才允许把未命中解释成
        // 「页面在另一个实例里」；可达时的未命中就是真的没有 Harness 标签页。
        let multiMissing = SessionJumpSupport.focusPlan(
            result: .missing(tabs: evidenceTabs), browser: chromeMulti, addressedConnectedInstance: false
        )
        checkEqual(multiMissing.diagnosis, .wrongBrowserInstance(tabs: evidenceTabs), "多实例未命中诊断")
        check(multiMissing.activateBrowser, "多实例未命中时仍要前置已连接实例")
        let multiLog = SessionJumpSupport.focusLog(multiMissing, browser: chromeMulti, port: 3080)
        check(multiLog.contains("另一个"), "多实例日志应点名「另一个实例」：\(multiLog)")
        check(multiLog.contains("2 个实例在运行"), "多实例日志应写明实例数：\(multiLog)")
        check(multiLog.contains("已前置浏览器"), "多实例日志应说明已前置浏览器：\(multiLog)")
        check(multiLog.contains("退出"), "多实例日志应给出可执行建议（退出后台/自动化浏览器）：\(multiLog)")
        check(multiLog.contains("play.html"), "多实例日志同样要带标签证据：\(multiLog)")

        // 已确认寻址到连着 Harness 的实例：多实例下未命中就是「页面真的没开」，
        // 不能再甩锅给另一个实例（那会让用户去关一个无关的浏览器）。
        let multiReachableMissing = SessionJumpSupport.focusPlan(
            result: .missing(tabs: evidenceTabs), browser: chromeMulti, addressedConnectedInstance: true
        )
        checkEqual(multiReachableMissing.diagnosis, .noHarnessTab(tabs: evidenceTabs),
                   "寻址可达时多实例未命中应诊断为没有标签页")
        let multiReachableLog = SessionJumpSupport.focusLog(multiReachableMissing, browser: chromeMulti, port: 3080)
        check(!multiReachableLog.contains("另一个"), "寻址可达时不该甩锅给另一个实例：\(multiReachableLog)")

        let unsupported = SessionJumpSupport.focusPlan(result: .unsupported, browser: safari)
        checkEqual(unsupported.diagnosis, .unsupported, "不支持自动化的诊断")
        check(unsupported.activateBrowser, "不支持自动化时降级为前置")
        check(SessionJumpSupport.focusLog(unsupported, browser: safari, port: 3080).contains("不支持标签定位"),
              "不支持自动化的日志")

        let failed = SessionJumpSupport.focusPlan(result: .failed("权限被拒绝"), browser: chrome)
        checkEqual(failed.diagnosis, .failed("权限被拒绝"), "自动化失败的诊断")
        check(failed.activateBrowser, "自动化失败时降级为前置")
        check(SessionJumpSupport.focusLog(failed, browser: chrome, port: 3080).contains("权限被拒绝"),
              "自动化失败的日志要带上原因")

        let closed = SessionJumpSupport.focusPlan(result: .closed, browser: chrome)
        checkEqual(closed.diagnosis, .closed, "已关闭标签的诊断")
        check(!closed.activateBrowser, "已关闭标签不需要再前置")

        // MARK: - 3b. 多实例寻址判定（什么时候能安全地发 AppleScript）
        // 内核启动时刻：数字越大＝启动越晚＝越可能收到 AppleScript。
        func instance(_ pid: Int32, _ startedAt: TimeInterval?) -> SessionJumpSupport.BrowserInstance {
            SessionJumpSupport.BrowserInstance(pid: pid, startedAt: startedAt)
        }
        // 单实例永远是可达的（macOS 别无选择）。
        check(SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 100, instances: [instance(100, 10)]
        ), "单实例必须判可达")
        // 连着 Harness 的恰好是最新启动的实例：AppleScript 会落在它身上。
        check(SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 200, instances: [instance(100, 10), instance(200, 20)]
        ), "已连接实例最新启动时应判可达")
        // 另一个实例后启动（自动化浏览器常驻/恢复出旧页面）：脚本会落到它身上，
        // 选中它自己的 Harness 标签页＝把用户带去错误窗口。
        check(!SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 100, instances: [instance(100, 10), instance(200, 20)]
        ), "别的实例更新时应判不可达")
        check(!SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 100, instances: [instance(100, 10), instance(200, 20), instance(300, 30)]
        ), "三实例中已连接的不是最新时也应判不可达")
        // 同秒启动：先后不确定，保守判不可达（宁可只前置浏览器，也不跳错窗口）。
        check(!SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 100, instances: [instance(100, 10), instance(200, 10)]
        ), "启动时刻相同应判不可达（无法确定寻址目标）")
        // 启动时刻读不到：无法证明会落到正确实例，同样按不可达处理。
        check(!SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 100, instances: [instance(100, nil), instance(200, 20)]
        ), "已连接实例启动时刻未知应判不可达")
        check(!SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 100, instances: [instance(100, 10), instance(200, nil)]
        ), "别的实例启动时刻未知应判不可达")
        // 连着 Harness 的实例不在列表里（列表陈旧 / 进程刚退出）：不能冒险。
        check(!SessionJumpSupport.appleScriptReachesConnectedInstance(
            connectedPID: 999, instances: [instance(100, 10), instance(200, 20)]
        ), "找不到已连接实例时应判不可达")

        // 不可达时的计划：只前置已连接浏览器，不选中/关闭任何标签页，但会话命令
        // 仍必须投递（切会话不能因为「看不见标签」一起丢掉）。
        let unreachable = SessionJumpSupport.unreachableInstancePlan(browser: chromeMulti)
        checkEqual(unreachable.diagnosis, .unreachableInstance(instanceCount: 2), "不可达实例诊断")
        check(unreachable.activateBrowser, "不可达时应前置真正连着 Harness 的浏览器")
        check(unreachable.sendsSessionOpen, "不可达时仍必须投递打开会话命令")
        check(unreachable.completes, "不可达时也必须收尾，否则下一次点击被吞")
        let unreachableLog = SessionJumpSupport.focusLog(unreachable, browser: chromeMulti, port: 3080)
        check(unreachableLog.contains("2 个实例"), "不可达日志应写明实例数：\(unreachableLog)")
        check(unreachableLog.contains("未改动另一个实例的标签页"), "不可达日志应说明没有碰另一个实例：\(unreachableLog)")
        check(unreachableLog.contains("已前置真正连接 Harness 的浏览器"), "不可达日志应说明前置了正确实例：\(unreachableLog)")
        check(unreachableLog.contains("退出"), "不可达日志应给出恢复精确选中的建议：\(unreachableLog)")
        check(!unreachableLog.contains("已定位并前置 Harness 标签页"), "不可达时绝不能谎报标签已选中：\(unreachableLog)")

        // 不可达 + 页面不可见：这一下必须新开标签，日志要说明「你正在看的标签
        // 选不中」且已新开，不能只说「已前置」。
        let unreachableNewTab = SessionJumpSupport.unreachableNewTabPlan(browser: chromeMulti)
        checkEqual(unreachableNewTab.diagnosis, .unreachableInstanceNewTab(instanceCount: 2),
                   "不可达新开标签诊断")
        check(unreachableNewTab.activateBrowser, "新开标签后仍应前置浏览器")
        check(unreachableNewTab.sendsSessionOpen && unreachableNewTab.completes, "新开标签计划同样要投递+收尾")
        let newTabLog = SessionJumpSupport.focusLog(unreachableNewTab, browser: chromeMulti, port: 3080)
        check(newTabLog.contains("选中不了你正在看的 Harness 标签"),
              "新开标签日志应说明原标签选不中：\(newTabLog)")
        check(newTabLog.contains("新开一个 Harness 标签"), "新开标签日志应说明已新开：\(newTabLog)")
        check(newTabLog.contains("原标签保留"), "新开标签日志应说明原标签还在：\(newTabLog)")
        check(!newTabLog.contains("已定位并前置 Harness 标签页"), "新开标签不能谎报原标签已选中：\(newTabLog)")
        let newTabFailed = SessionJumpSupport.unreachableNewTabFailedPlan(browser: chromeMulti)
        checkEqual(newTabFailed.diagnosis, .unreachableInstanceNewTabFailed(instanceCount: 2),
                   "新开标签失败诊断")
        let newTabFailedLog = SessionJumpSupport.focusLog(newTabFailed, browser: chromeMulti, port: 3080)
        check(newTabFailedLog.contains("事件投递失败"), "投递失败必须留痕：\(newTabFailedLog)")
        check(!newTabFailedLog.contains("新开一个 Harness 标签并切到"), "投递失败不能装成已新开：\(newTabFailedLog)")

        // 何时只前置、何时必须新开：只有明确看到页面可见才敢「只前置」。
        checkEqual(SessionJumpSupport.unreachablePresentation(pageVisible: true), .activateOnly,
                   "页面可见时应只前置")
        checkEqual(SessionJumpSupport.unreachablePresentation(pageVisible: false), .openNewTabInConnectedInstance,
                   "页面不可见时必须新开标签")
        checkEqual(SessionJumpSupport.unreachablePresentation(pageVisible: nil), .openNewTabInConnectedInstance,
                   "可见性未知时应保守新开标签（宁多开一张也不要不响应）")

        let unreachableClose = SessionJumpSupport.unreachableCloseLog(browser: chromeMulti, newTabOpened: true)
        check(unreachableClose.contains("2 个实例"), "不可达的关旧标签日志应写明实例数：\(unreachableClose)")
        check(unreachableClose.contains("无法确认关闭旧标签") && unreachableClose.contains("新开页面"),
              "不可达时重启接管应如实说明跳过关闭并定向新开页：\(unreachableClose)")
        let unreachableCloseFallback = SessionJumpSupport.unreachableCloseLog(
            browser: chromeMulti, newTabOpened: false
        )
        check(unreachableCloseFallback.contains("事件投递失败"), "定向新开页失败要留痕：\(unreachableCloseFallback)")

        // 不变式：**任何**结果都必须投递「打开会话」并收尾流程。
        // 否则就会出现「浏览器起来了但还是旧会话」或下一次点击被 inFlight 吞掉。
        let allPlans = [focused, singleMissing, multiMissing, unsupported, failed, closed,
                        unreachable, unreachableNewTab, newTabFailed]
        for (index, plan) in allPlans.enumerated() {
            check(plan.sendsSessionOpen, "焦点计划[\(index)]：任何分支都必须投递打开会话命令")
            check(plan.completes, "焦点计划[\(index)]：任何分支都必须收尾（清 inFlight / 跑 completion）")
        }

        // MARK: - 4. 重启接管的「关旧标签」日志
        let closeClosed = SessionJumpSupport.closeLog(result: .closed, browser: chrome)
        check(closeClosed.contains("已关闭") && closeClosed.contains("正在打开新页面"), "关旧标签成功日志：\(closeClosed)")
        let closeMissing = SessionJumpSupport.closeLog(result: .missing(tabs: evidenceTabs), browser: chrome)
        check(closeMissing.contains("未找到") && closeMissing.contains("直接打开新页面"), "关旧标签未命中日志：\(closeMissing)")
        check(closeMissing.contains("play.html"), "关旧标签未命中也要带标签证据：\(closeMissing)")
        let closeMissingMulti = SessionJumpSupport.closeLog(
            result: .missing(tabs: evidenceTabs),
            browser: SessionJumpSupport.BrowserInfo(name: "Google Chrome", bundleIdentifier: "com.google.Chrome", instanceCount: 3)
        )
        check(closeMissingMulti.contains("3 个实例在运行"), "关旧标签未命中应写明实例数：\(closeMissingMulti)")
        check(SessionJumpSupport.closeLog(result: .unsupported, browser: chrome).contains("不支持标签关闭"), "不支持关闭的日志")
        check(SessionJumpSupport.closeLog(result: .failed("x"), browser: chrome).contains("旧标签页失败"), "关闭失败日志")
        checkEqual(SessionJumpSupport.closeLog(result: .focused, browser: chrome), "", "关闭流程收到 focused 时不需要日志")

        // MARK: - 5. 端到端顺序仿真
        // 用纯计划函数串出「一次点击按什么顺序做什么」，锁住两个最容易复发的顺序错误：
        // 先关旧标签再开新页面；失败先前置再投递会话（而不是只做其中一半）。
        func simulate(
            disposition: SessionJumpSupport.ClickDisposition,
            presence: Bool?,
            browser: SessionJumpSupport.BrowserInfo?,
            restartTakeover: Bool,
            focusResult: BrowserTabFocusResult,
            sessionId: String?,
            reachable: Bool = true,
            pageVisible: Bool? = true,
            newTabOpened: Bool = true
        ) -> [String] {
            var steps: [String] = []
            switch disposition {
            case .jumpInPlace: steps.append("page")
            case .startThenJump: steps.append("start"); steps.append("page")
            case .waitForInstall: steps.append("waitInstall"); steps.append("page")
            }
            let plan = SessionJumpSupport.pagePlan(presenceActive: presence, browser: browser, restartTakeover: restartTakeover)
            // 不可达的重启接管整段由 deliverPageWithoutTabAutomation 处理：
            // 关旧标签的 AppleScript 会作用到别的实例，改为按 pid 定向新开页面。
            let handledWithoutAutomation = !reachable && plan.closesOldTab
            if plan.closesOldTab {
                if reachable {
                    steps.append("closeTab")
                } else if newTabOpened {
                    steps.append("closeSkipped")
                    steps.append("newTab")
                    steps.append("log")
                } else {
                    steps.append("closeSkipped")
                    steps.append("log")
                    steps.append("openPage")
                }
            }
            if !handledWithoutAutomation {
                if plan.reopensPage {
                    steps.append("openPage")
                } else if plan.focusesTab {
                    if reachable {
                        steps.append("focusTab")
                        let focusPlan = SessionJumpSupport.focusPlan(
                            result: focusResult, browser: browser!, addressedConnectedInstance: true
                        )
                        if focusPlan.activateBrowser { steps.append("activateBrowser") }
                        steps.append("log")
                    } else {
                        // 不可达：一次标签页脚本都不发。页面可见 → 前置即可；
                        // 看不见（用户切到了别的标签）→ 在连接实例里新开一个标签。
                        let focusPlan: SessionJumpSupport.FocusPlan
                        switch SessionJumpSupport.unreachablePresentation(pageVisible: pageVisible) {
                        case .activateOnly:
                            focusPlan = SessionJumpSupport.unreachableInstancePlan(browser: browser!)
                        case .openNewTabInConnectedInstance:
                            if newTabOpened {
                                steps.append("newTab")
                                focusPlan = SessionJumpSupport.unreachableNewTabPlan(browser: browser!)
                            } else {
                                focusPlan = SessionJumpSupport.unreachableNewTabFailedPlan(browser: browser!)
                            }
                        }
                        if focusPlan.activateBrowser { steps.append("activateBrowser") }
                        steps.append("log")
                    }
                }
            }
            if sessionId != nil { steps.append("sendSessionOpen") }
            return steps
        }

        // 页面还在、单实例、选中成功：只选标签 + 投递会话，绝不重复开页面。
        let happy = simulate(
            disposition: .jumpInPlace, presence: true, browser: chrome, restartTakeover: false,
            focusResult: .focused, sessionId: "session-1"
        )
        checkEqual(happy, ["page", "focusTab", "log", "sendSessionOpen"], "成功跳转的顺序")
        check(!happy.contains("openPage"), "已打开页面时不能再开新标签")
        check(!happy.contains("activateBrowser"), "选中成功不需要降级前置")

        // 本机现状：多实例且 AppleScript 只会落到另一个实例 → 一次标签页脚本都
        // 不发；Harness 页就是可见标签时前置即可，会话必须照切。
        let multi = simulate(
            disposition: .jumpInPlace, presence: nil, browser: chromeMulti, restartTakeover: false,
            focusResult: .missing(tabs: evidenceTabs), sessionId: "session-2",
            reachable: false, pageVisible: true
        )
        checkEqual(multi, ["page", "activateBrowser", "log", "sendSessionOpen"],
                   "多实例不可达但页面可见时的顺序")
        check(!multi.contains("focusTab"), "多实例不可达时必须跳过标签选中（那会跳到错误窗口）")
        let activateIndex = multi.firstIndex(of: "activateBrowser")!
        let logIndex = multi.firstIndex(of: "log")!
        let openIndex = multi.firstIndex(of: "sendSessionOpen")!
        check(activateIndex < logIndex && logIndex < openIndex, "不可达时：先前置、再记日志、最后也必须投递会话")

        // 用户切到了别的标签（Harness 页不可见）：只前置什么也不会发生，
        // 必须在真正连接的实例里新开标签，把会话送到眼前。
        let multiHiddenTab = simulate(
            disposition: .jumpInPlace, presence: true, browser: chromeMulti, restartTakeover: false,
            focusResult: .missing(tabs: evidenceTabs), sessionId: "session-2d",
            reachable: false, pageVisible: false
        )
        checkEqual(multiHiddenTab, ["page", "newTab", "activateBrowser", "log", "sendSessionOpen"],
                   "多实例不可达且页面不可见时应新开标签")
        check(!multiHiddenTab.contains("focusTab"), "新开标签路径同样不能发 AppleScript")
        check(multiHiddenTab.firstIndex(of: "newTab")! < multiHiddenTab.firstIndex(of: "sendSessionOpen")!,
              "新开标签必须在投递会话之前（新页面才能领取命令）")

        // 新开标签事件投递失败：退回只前置，日志必须如实降级，不能装成成功。
        let multiHiddenTabFailed = simulate(
            disposition: .jumpInPlace, presence: true, browser: chromeMulti, restartTakeover: false,
            focusResult: .missing(tabs: evidenceTabs), sessionId: "session-2e",
            reachable: false, pageVisible: false, newTabOpened: false
        )
        checkEqual(multiHiddenTabFailed, ["page", "activateBrowser", "log", "sendSessionOpen"],
                   "新开标签失败时应退回只前置并记日志")
        check(!multiHiddenTabFailed.contains("newTab"), "投递失败时不能假装新开了标签")

        // 多实例但连着 Harness 的实例就是最新启动的：AppleScript 安全，仍走精确选中。
        let multiReachable = simulate(
            disposition: .jumpInPlace, presence: true, browser: chromeMulti, restartTakeover: false,
            focusResult: .focused, sessionId: "session-2b", reachable: true
        )
        checkEqual(multiReachable, ["page", "focusTab", "log", "sendSessionOpen"],
                   "寻址可达的多实例仍应精确选中标签")

        // 多实例不可达 + 重启接管：旧标签关不掉（关的是另一个实例），按 pid 在
        // 真正连接的实例里新开页面；事件投递失败才退回默认方式打开。
        let unreachableTakeover = simulate(
            disposition: .jumpInPlace, presence: true, browser: chromeMulti, restartTakeover: true,
            focusResult: .focused, sessionId: "session-2c", reachable: false
        )
        checkEqual(unreachableTakeover, ["page", "closeSkipped", "newTab", "log", "sendSessionOpen"],
                   "不可达的重启接管应跳过关旧标签并定向新开页")
        let unreachableTakeoverFallback = simulate(
            disposition: .jumpInPlace, presence: true, browser: chromeMulti, restartTakeover: true,
            focusResult: .focused, sessionId: "session-2f", reachable: false, newTabOpened: false
        )
        checkEqual(unreachableTakeoverFallback, ["page", "closeSkipped", "log", "openPage", "sendSessionOpen"],
                   "定向新开页失败时应退回默认方式打开")

        // 页面全关（keep-alive 还在）：重开页面，而不是对着空标签跑自动化。
        let reopen = simulate(
            disposition: .jumpInPlace, presence: false, browser: chrome, restartTakeover: false,
            focusResult: .focused, sessionId: "session-3"
        )
        checkEqual(reopen, ["page", "openPage", "sendSessionOpen"], "页面全关时应重开页面")

        // 没有已连接的浏览器（外部实例 / 首次打开）：直接打开页面。
        let noBrowser = simulate(
            disposition: .jumpInPlace, presence: nil, browser: nil, restartTakeover: false,
            focusResult: .focused, sessionId: "session-4"
        )
        checkEqual(noBrowser, ["page", "openPage", "sendSessionOpen"], "无浏览器时应打开页面")

        // 重启接管 + 等待期间点了一条提醒：先关旧标签、再开新页面、最后补投会话。
        let takeover = simulate(
            disposition: .startThenJump, presence: true, browser: chrome, restartTakeover: true,
            focusResult: .focused, sessionId: "session-5"
        )
        checkEqual(takeover, ["start", "page", "closeTab", "openPage", "sendSessionOpen"], "重启接管的顺序")
        let closeIdx = takeover.firstIndex(of: "closeTab")!
        let reopenIdx = takeover.firstIndex(of: "openPage")!
        check(closeIdx < reopenIdx, "重启接管必须先关旧标签再开新页面，否则会留下两张 Harness 标签")

        // 自动化失败 / 浏览器不支持：仍要前置 + 投递会话。
        for (label, result) in [("失败", BrowserTabFocusResult.failed("denied")), ("不支持", .unsupported)] {
            let steps = simulate(
                disposition: .jumpInPlace, presence: true, browser: chrome, restartTakeover: false,
                focusResult: result, sessionId: "session-6"
            )
            checkEqual(steps, ["page", "focusTab", "activateBrowser", "log", "sendSessionOpen"], "\(label)时的降级顺序")
        }

        // 菜单里点「打开 Harness」而不是某条提醒（sessionId == nil）：不应投递会话命令。
        let plainOpen = simulate(
            disposition: .jumpInPlace, presence: true, browser: chrome, restartTakeover: false,
            focusResult: .focused, sessionId: nil
        )
        checkEqual(plainOpen, ["page", "focusTab", "log"], "普通打开不需要投递会话命令")

        // MARK: - 6. 与标签匹配/脚本生成的历史回归联动
        // 详细断言在 test-browser-connection.swift；这里只锁「跳转链路仍按 origin 匹配」
        // 这一条：换成整串 URL 比较会让所有点击退化成「仅前置浏览器」。
        let target = URL(string: "http://127.0.0.1:3080/?token=abc")!
        let origins = BrowserAutomationSupport.harnessOrigins(for: target)
        check(origins.contains("http://127.0.0.1:3080"), "跳转目标应按 origin 匹配（token 不参与）")
        check(BrowserAutomationSupport.browserFocusScript(
            bundleIdentifier: "com.google.Chrome", targetURL: target
        )?.contains("matchesHarnessOrigin") == true, "标签脚本必须用 origin 匹配")

        if !failures.isEmpty {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
        print("PASS: click disposition, page plan, focus diagnosis (single/multi instance), "
              + "multi-instance addressing guard, unreachable presentation (activate/new tab), "
              + "fallback order, close-then-open takeover, session-open invariant, origin-based jump")
    }
}
