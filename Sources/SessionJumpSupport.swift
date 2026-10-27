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

    static func focusPlan(result: BrowserTabFocusResult, browser: BrowserInfo) -> FocusPlan {
        switch result {
        case .focused:
            return FocusPlan(diagnosis: .focused, activateBrowser: false)
        case .closed:
            return FocusPlan(diagnosis: .closed, activateBrowser: false)
        case .missing(let tabs):
            let diagnosis: FocusDiagnosis = browser.instanceCount > 1
                ? .wrongBrowserInstance(tabs: tabs)
                : .noHarnessTab(tabs: tabs)
            return FocusPlan(diagnosis: diagnosis, activateBrowser: true)
        case .unsupported:
            return FocusPlan(diagnosis: .unsupported, activateBrowser: true)
        case .failed(let message):
            return FocusPlan(diagnosis: .failed(message), activateBrowser: true)
        }
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
        case .failed(let message):
            return "定位 \(browser.name) Harness 标签页失败（\(message)）；已前置浏览器"
        }
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
