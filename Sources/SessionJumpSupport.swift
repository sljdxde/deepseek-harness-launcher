import Foundation

/// 点击菜单栏「会话完成」→ 在已打开的 Harness 标签页里直接看到那个会话。
///
/// 这条链路被反复改坏过（整串 URL 匹配不上、跳转请求没投递、重启后接管顺序错），
/// 而原来的判断全写在 `main.swift` 的异步回调里，测试二进制加载不了 App 主类，
/// 只能靠 grep 字符串——那种断言挡不住任何行为回归。所以把**决策**抽到这里，
/// `main.swift` 只负责把计划翻译成 AppleScript / NSWorkspace / HTTP 调用
/// （CODING_STANDARDS §2：可测试逻辑不进 main.swift）。
///
/// 链路分三步，每一步都能单独喂输入、断言输出：
/// 1. `clickDisposition`：这次点击是直接跳、先启动 dsh、还是等运行环境装完；
/// 2. `pagePlan`：页面要不要重开、重启接管要不要先关旧标签、要不要选中已有标签；
/// 3. `focusPlan` + 日志：AppleScript 的结果怎么解释、失败时怎么降级、日志怎么写。
///
/// 特别地：**任何分支都必须投递「打开会话」命令**（`FocusPlan.sendsSessionOpen`
/// 恒为 true）。标签没选中只影响「用户看不看得见」，不能连会话一起不切——那正是
/// 「点了没反应」的一半。
enum SessionJumpSupport {
    /// 已连接 Harness 的浏览器（lsof 连接 + ps 父子链找到的那个进程）。
    /// `instanceCount` 是同一 bundle 正在运行的实例数：macOS 只把 AppleScript
    /// 事件发给**最近启动**的那个实例，两者可能不是同一个（自动化浏览器常驻时）。
    struct BrowserInfo: Equatable {
        let name: String
        let bundleIdentifier: String?
        let instanceCount: Int
    }

    /// 同 bundle 的一个浏览器实例。`startedAt` 是内核记录的进程启动时刻：
    /// macOS 只把同 bundle 的 AppleScript 事件发给**最近启动**的实例，只有
    /// 「真正连着 Harness 的实例恰好是最新启动的」时，标签选中/关闭才作用在
    /// 用户面前那个窗口上。读不到启动时刻时传 nil——那意味着无法证明事件会
    /// 落到正确实例，按不可达处理。
    struct BrowserInstance: Equatable {
        let pid: Int32
        let startedAt: TimeInterval?
    }

    // MARK: - 多实例寻址

    /// 这一次标签自动化会不会作用到真正连着 Harness 的实例上。
    ///
    /// 多实例时 macOS 把 AppleScript 事件发给**最近启动**的那个实例。被寻址的
    /// 别的实例里**也可能开着一个 Harness 标签页**（自动化浏览器 `chrome-devtools-mcp`
    /// 恢复出来的旧页面、上一次进程留下的 401 页），此时焦点脚本会报告 "found"——
    /// 它确实选中了，只是选中了错误窗口里的那一页。2026-11-03 实测：点完成提醒后
    /// 日志写着「已定位并前置 Harness 标签页」，用户看到的却是另一个 Chrome 里的
    /// 空白/401 页面。所以必须在发脚本**之前**判定可达性：不可达就完全不碰任何
    /// 标签页，改为只前置真正连着的那个实例。
    ///
    /// 保守规则：启动时刻读不到，或与已连接实例同秒启动（先后不确定），都判不可达。
    static func appleScriptReachesConnectedInstance(
        connectedPID: Int32,
        instances: [BrowserInstance]
    ) -> Bool {
        guard instances.count > 1 else { return true }
        guard let connected = instances.first(where: { $0.pid == connectedPID }),
              let connectedStartedAt = connected.startedAt else { return false }
        for other in instances where other.pid != connectedPID {
            guard let startedAt = other.startedAt else { return false }
            if startedAt >= connectedStartedAt { return false }
        }
        return true
    }

    // MARK: - 点击处置

    /// 点击一条完成提醒时该走哪条路。
    enum ClickDisposition: Equatable {
        /// 实例在跑：直接开页面（或前置）并投递会话。
        case jumpInPlace
        /// 实例没在跑：先启动，就绪后再开页面并投递会话（不能丢这次点击）。
        case startThenJump
        /// 正在安装/更新运行环境：等安装结束、页面可打开时再跳。
        case waitForInstall
    }

    static func clickDisposition(isRunning: Bool, hasPort: Bool, isInstalling: Bool) -> ClickDisposition {
        if isInstalling { return .waitForInstall }
        return (isRunning && hasPort) ? .jumpInPlace : .startThenJump
    }

    // MARK: - 页面阶段

    /// 拿到浏览器检测结果后，页面该怎么处理。
    struct PagePlan: Equatable {
        /// 交给 NSWorkspace 打开（新页面）；已有页面时绝不这么做——那会开出重复标签。
        let reopensPage: Bool
        /// 重启接管：先关旧标签页，再打开新页面（让「真的重启过」可见）。
        let closesOldTab: Bool
        /// 用 AppleScript 选中已打开的 Harness 标签。
        let focusesTab: Bool

        var usesConnectedBrowser: Bool { focusesTab || closesOldTab }
    }

    /// - Parameter presenceActive: `GET /dsh-session-notify/presence` 的结论。
    ///   nil = 插件接口不存在（外部 Harness / 旧插件），保持「有连接就当页面还在」。
    static func pagePlan(
        presenceActive: Bool?,
        browser: BrowserInfo?,
        restartTakeover: Bool
    ) -> PagePlan {
        // 心跳明确说页面全关（keep-alive 连接还在的窗口期）：重开页面。
        if presenceActive == false {
            return PagePlan(reopensPage: true, closesOldTab: false, focusesTab: false)
        }
        guard browser != nil else {
            return PagePlan(reopensPage: true, closesOldTab: false, focusesTab: false)
        }
        if restartTakeover {
            return PagePlan(reopensPage: true, closesOldTab: true, focusesTab: false)
        }
        return PagePlan(reopensPage: false, closesOldTab: false, focusesTab: true)
    }

    // MARK: - 标签选中的结果与降级

    /// AppleScript 结果的解释。`wrongBrowserInstance` 与 `noHarnessTab` 的区别是
    /// 关键：多实例时「找不到标签页」不代表页面没开，而是页面在另一个实例里，
    /// 日志必须说清楚，否则用户会以为插件坏了、反复重启 dsh。
    enum FocusDiagnosis: Equatable {
        case focused
        case closed
        case noHarnessTab(tabs: [String])
        case wrongBrowserInstance(tabs: [String])
        /// 多实例且 AppleScript 只会落到别的实例：标签自动化被跳过，只前置了
        /// 真正连着 Harness 的浏览器（连标签页内容都没读，避免误选错误窗口）。
        case unreachableInstance(instanceCount: Int)
        case unsupported
        case failed(String)
    }

    struct FocusPlan: Equatable {
        let diagnosis: FocusDiagnosis
        /// 选不中标签时至少把已连接的浏览器前置，别让点击看起来毫无反应。
        let activateBrowser: Bool
        /// 恒 true：会话开关必须投递（标签没选中也要切会话）。
        let sendsSessionOpen: Bool = true
        /// 恒 true：流程必须收尾（清 inFlight、跑 completion），早退会把后续点击吞掉。
        let completes: Bool = true
    }

    /// - Parameter addressedConnectedInstance: 这次 AppleScript 是否真的寻址到了
    ///   连着 Harness 的实例（由 `appleScriptReachesConnectedInstance` 事先判定）。
    ///   只有不可达时，「找不到标签页」才该解释成「页面在另一个实例里」；可达时
    ///   多实例下找不到就是真的没有 Harness 标签页。
    static func focusPlan(
        result: BrowserTabFocusResult,
        browser: BrowserInfo,
        addressedConnectedInstance: Bool = true
    ) -> FocusPlan {
        switch result {
        case .focused:
            return FocusPlan(diagnosis: .focused, activateBrowser: false)
        case .closed:
            return FocusPlan(diagnosis: .closed, activateBrowser: false)
        case .missing(let tabs):
            let diagnosis: FocusDiagnosis = (browser.instanceCount > 1 && !addressedConnectedInstance)
                ? .wrongBrowserInstance(tabs: tabs)
                : .noHarnessTab(tabs: tabs)
            return FocusPlan(diagnosis: diagnosis, activateBrowser: true)
        case .unsupported:
            return FocusPlan(diagnosis: .unsupported, activateBrowser: true)
        case .failed(let message):
            return FocusPlan(diagnosis: .failed(message), activateBrowser: true)
        }
    }

    /// 多实例且 AppleScript 只会落到别的实例：这一次**不做**标签选中/关闭
    /// （那会把用户带到另一个窗口里的旧页面），只前置真正连着 Harness 的实例。
    static func unreachableInstancePlan(browser: BrowserInfo) -> FocusPlan {
        FocusPlan(
            diagnosis: .unreachableInstance(instanceCount: browser.instanceCount),
            activateBrowser: true
        )
    }

    // MARK: - 日志文案

    /// 选中流程的结果日志（含成功路径与全部降级路径）；main.swift 只 append。
    static func focusLog(_ plan: FocusPlan, browser: BrowserInfo, port: Int) -> String {
        switch plan.diagnosis {
        case .focused:
            return "检测到 \(browser.name) 已连接 Harness 端口 \(port)，已定位并前置 Harness 标签页"
        case .closed:
            return "检测到 \(browser.name) 已关闭 Harness 标签页"
        case .noHarnessTab(let tabs):
            let detail = BrowserConnectionSupport.tabReportDetail(
                tabs: tabs, instanceCount: 1, browserName: browser.name
            )
            return "检测到 \(browser.name) 已连接 Harness 端口 \(port)，但未找到匹配标签页\(detail)；已前置浏览器"
        case .wrongBrowserInstance(let tabs):
            // 两个事实要一起说：AppleScript 寻址到了另一个实例；页面其实在已连接的那个里。
            // 再给一条能立刻行动的建议，否则「未找到标签页」只会让用户白重启 dsh。
            let detail = BrowserConnectionSupport.tabReportDetail(
                tabs: tabs, instanceCount: 1, browserName: browser.name
            )
            return "检测到 \(browser.name) 已连接 Harness 端口 \(port)，但 AppleScript 寻址到了另一个 \(browser.name) 实例"
                + "（\(browser.instanceCount) 个实例在运行，事件只发给最近启动的那个，Harness 页面在真正连接的这个实例里）"
                + "\(detail)；已前置浏览器。退出那个后台/自动化浏览器实例后即可恢复精确选中标签页"
        case .unsupported:
            return "检测到 \(browser.name) 已连接 Harness 端口 \(port)，该浏览器不支持标签定位；已前置浏览器"
        case .unreachableInstance(let instanceCount):
            // 事实三件事：连着的是哪个、为什么不能精确选中、这次实际做了什么。
            return "检测到 \(browser.name) 已连接 Harness 端口 \(port)，但同 bundle 有 \(instanceCount) 个实例在运行，"
                + "AppleScript 只会发给最近启动的那个（不是连着 Harness 的这个）；"
                + "未改动另一个实例的标签页，已前置真正连接 Harness 的浏览器并投递会话。"
                + "退出那个后台/自动化浏览器实例后即可恢复精确选中标签页"
        case .failed(let message):
            return "定位 \(browser.name) Harness 标签页失败（\(message)）；已前置浏览器"
        }
    }

    /// 「AppleScript 寻址不到已连接实例」时重启接管的收尾日志：旧标签无法
    /// 确认关闭（那条 AppleScript 只会落到另一个实例上），直接打开新页面。
    static func unreachableCloseLog(browser: BrowserInfo) -> String {
        "dsh 已重启，但同 bundle 有 \(browser.instanceCount) 个实例在运行，"
            + "AppleScript 只会发给最近启动的那个（不是连着 Harness 的这个），无法确认关闭旧标签；直接打开新页面（旧标签可手动关闭）"
    }

    /// 重启接管的「关旧标签页」结果日志；不需要记日志时返回空串。
    static func closeLog(result: BrowserTabFocusResult, browser: BrowserInfo) -> String {
        switch result {
        case .closed:
            return "dsh 已重启，已关闭 \(browser.name) 的旧 Harness 标签页，正在打开新页面"
        case .missing(let tabs):
            let detail = BrowserConnectionSupport.tabReportDetail(
                tabs: tabs, instanceCount: browser.instanceCount, browserName: browser.name
            )
            return "dsh 已重启，未找到 \(browser.name) 的旧 Harness 标签页\(detail)，直接打开新页面"
        case .unsupported:
            return "dsh 已重启，\(browser.name) 不支持标签关闭，直接打开新页面（旧标签可手动关闭）"
        case .failed(let message):
            return "dsh 已重启，关闭 \(browser.name) 旧标签页失败（\(message)），直接打开新页面"
        case .focused:
            return ""
        }
    }
}
