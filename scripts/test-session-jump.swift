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
//   3. 标签选中失败：单实例 vs 多实例的诊断不同、降级动作不同、日志必须留证据；
//   4. 不变式：任何分支都必须投递「打开会话」命令 + 必须收尾（否则后续点击被吞）。
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
        let multiMissing = SessionJumpSupport.focusPlan(result: .missing(tabs: evidenceTabs), browser: chromeMulti)
        checkEqual(multiMissing.diagnosis, .wrongBrowserInstance(tabs: evidenceTabs), "多实例未命中诊断")
        check(multiMissing.activateBrowser, "多实例未命中时仍要前置已连接实例")
        let multiLog = SessionJumpSupport.focusLog(multiMissing, browser: chromeMulti, port: 3080)
        check(multiLog.contains("另一个"), "多实例日志应点名「另一个实例」：\(multiLog)")
        check(multiLog.contains("2 个实例在运行"), "多实例日志应写明实例数：\(multiLog)")
        check(multiLog.contains("已前置浏览器"), "多实例日志应说明已前置浏览器：\(multiLog)")
        check(multiLog.contains("退出"), "多实例日志应给出可执行建议（退出后台/自动化浏览器）：\(multiLog)")
        check(multiLog.contains("play.html"), "多实例日志同样要带标签证据：\(multiLog)")

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

        // 不变式：**任何**结果都必须投递「打开会话」并收尾流程。
        // 否则就会出现「浏览器起来了但还是旧会话」或下一次点击被 inFlight 吞掉。
        let allPlans = [focused, singleMissing, multiMissing, unsupported, failed, closed]
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
            sessionId: String?
        ) -> [String] {
            var steps: [String] = []
            switch disposition {
            case .jumpInPlace: steps.append("page")
            case .startThenJump: steps.append("start"); steps.append("page")
            case .waitForInstall: steps.append("waitInstall"); steps.append("page")
            }
            let plan = SessionJumpSupport.pagePlan(presenceActive: presence, browser: browser, restartTakeover: restartTakeover)
            if plan.closesOldTab { steps.append("closeTab") }
            if plan.reopensPage {
                steps.append("openPage")
            } else if plan.focusesTab {
                steps.append("focusTab")
                let focusPlan = SessionJumpSupport.focusPlan(result: focusResult, browser: browser!)
                if focusPlan.activateBrowser { steps.append("activateBrowser") }
                steps.append("log")
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

        // 本机现状：多实例 + 页面在另一个实例里 → 选中失败，降级前置，但会话必须照切。
        let multi = simulate(
            disposition: .jumpInPlace, presence: nil, browser: chromeMulti, restartTakeover: false,
            focusResult: .missing(tabs: evidenceTabs), sessionId: "session-2"
        )
        checkEqual(multi, ["page", "focusTab", "activateBrowser", "log", "sendSessionOpen"], "多实例未命中的顺序")
        let activateIndex = multi.firstIndex(of: "activateBrowser")!
        let logIndex = multi.firstIndex(of: "log")!
        let openIndex = multi.firstIndex(of: "sendSessionOpen")!
        check(activateIndex < logIndex && logIndex < openIndex, "未命中时：先前置、再记日志、最后也必须投递会话")

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
              + "fallback order, close-then-open takeover, session-open invariant, origin-based jump")
    }
}
