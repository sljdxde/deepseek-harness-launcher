import Foundation
import AppKit

@main
struct BrowserConnectionTests {
    static func main() {
        let sample = """
        p2043
        n127.0.0.1:59072->127.0.0.1:3080
        n127.0.0.1:59073->127.0.0.1:3080
        p43799
        n127.0.0.1:3080->127.0.0.1:59072
        p9
        n127.0.0.1:60000->127.0.0.1:30800
        p10
        n[::1]:60000->[::1]:3080
        p11
        n192.168.1.2:60000->192.168.1.3:3080
        pbad
        n127.0.0.1:59074->127.0.0.1:3080
        """
        precondition(BrowserConnectionSupport.clientPIDs(sample, port: 3080) == [2043, 10])
        precondition(BrowserConnectionSupport.clientPIDs("", port: 3080).isEmpty)
        precondition(BrowserConnectionSupport.clientPIDs(sample, port: 3081).isEmpty)
        let parents: [Int32: Int32] = [2043: 1847, 1847: 1, 20: 21, 21: 20, 30: 31]
        let apps: [Int32: String] = [1847: "com.google.Chrome", 31: "com.apple.Terminal"]
        precondition(BrowserConnectionSupport.browserPID(start: 2043, parents: parents, applications: apps) == 1847)
        precondition(BrowserConnectionSupport.browserPID(start: 1847, parents: parents, applications: apps) == 1847)
        precondition(BrowserConnectionSupport.browserPID(start: 20, parents: parents, applications: apps) == nil)
        precondition(BrowserConnectionSupport.browserPID(start: 30, parents: parents, applications: apps) == nil)
        precondition(BrowserConnectionSupport.browserPID(start: 99, parents: parents, applications: apps) == nil)
        // A detected Harness page must be activated without handing the URL to
        // Chrome again: NSWorkspace.open creates a duplicate tab instead of
        // selecting the already-open Harness tab.
        precondition(!BrowserConnectionSupport.plan(connectedBrowser: true).opensURL)
        precondition(BrowserConnectionSupport.plan(connectedBrowser: true).activatesConnectedBrowser)
        precondition(BrowserConnectionSupport.plan(connectedBrowser: false).opensURL)
        precondition(!BrowserConnectionSupport.plan(connectedBrowser: false).activatesConnectedBrowser)
        let now = Date()
        // Manual clicks are never swallowed by the throttle; only in-flight opens are.
        precondition(!BrowserConnectionSupport.shouldDefer(intent: .manual, inFlight: false, lastOpenAt: now, now: now))
        precondition(BrowserConnectionSupport.shouldDefer(intent: .manual, inFlight: true, lastOpenAt: .distantPast, now: now))
        precondition(BrowserConnectionSupport.shouldDefer(intent: .automatic, inFlight: false, lastOpenAt: now.addingTimeInterval(-0.5), now: now))
        precondition(!BrowserConnectionSupport.shouldDefer(intent: .automatic, inFlight: false, lastOpenAt: now.addingTimeInterval(-5), now: now))
        precondition(BrowserConnectionSupport.pageURL(port: 3080)?.absoluteString == "http://127.0.0.1:3080/")
        precondition(BrowserConnectionSupport.pageURL(port: 3081, path: "/sessions")?.absoluteString == "http://127.0.0.1:3081/sessions")
        precondition(BrowserConnectionSupport.pageURL(port: 0) == nil)
        // presence 心跳解析：标签页全关（active=false）必须触发重新打开页面；
        // 缺失/非法响应返回 nil，保持「有连接就前置」的降级行为。
        precondition(BrowserConnectionSupport.presenceActive(#"{"active":true,"clients":2}"#) == true)
        precondition(BrowserConnectionSupport.presenceActive(#"{"active":false,"clients":0}"#) == false)
        precondition(BrowserConnectionSupport.presenceActive("{}") == nil)
        precondition(BrowserConnectionSupport.presenceActive("not json") == nil)
        precondition(BrowserConnectionSupport.presenceActive(nil) == nil)
        // 标签匹配必须按 origin（scheme://host:port）判定，而不是整串 URL：
        // 入口 URL 带 `?token=…`、客户端可能留 `#` 片段或尾斜杠，整串比较会
        // 一个标签都匹配不上（实测日志里 9 次点击 9 次「未找到匹配标签页」）。
        // 标签定位失败的日志明细：单实例且没有任何标签时保持原文案不变；
        // 有标签 / 多实例时把「实际地址」「实例数」写进去，否则无法判断是
        // 页面没开、还是 AppleScript 寻址到了另一个浏览器实例。
        precondition(BrowserConnectionSupport.tabReportDetail(tabs: [], instanceCount: 1, browserName: "Google Chrome") == "")
        let detailOne = BrowserConnectionSupport.tabReportDetail(
            tabs: ["http://127.0.0.1:3080/?token=t"], instanceCount: 1, browserName: "Google Chrome"
        )
        precondition(detailOne.contains("1 个已开标签"))
        precondition(detailOne.contains("http://127.0.0.1:3080/?token=t"))
        precondition(!detailOne.contains("实例在运行"))
        let detailMulti = BrowserConnectionSupport.tabReportDetail(
            tabs: ["chrome://newtab/"], instanceCount: 2, browserName: "Google Chrome"
        )
        precondition(detailMulti.contains("2 个实例在运行"))
        precondition(detailMulti.contains("最近启动"))
        // 长 URL 截断、只列前 limit 条，避免日志被几十个标签号塞满。
        let many = (0..<9).map { _ in String(repeating: "x", count: 300) }
        let detailMany = BrowserConnectionSupport.tabReportDetail(tabs: many, instanceCount: 1, browserName: "Safari")
        precondition(detailMany.contains("9 个已开标签"))
        precondition(detailMany.contains("…"))
        precondition(detailMany.components(separatedBy: " | ").count == 4)
        let harnessURL = URL(string: "http://127.0.0.1:3080/")!
        let origins = BrowserAutomationSupport.harnessOrigins(for: harnessURL)
        precondition(origins == ["http://127.0.0.1:3080", "http://localhost:3080", "http://[::1]:3080"])
        // 带 token 的入口 URL 得到同一组 origin（query 不参与判定）。
        let tokenURL = URL(string: "http://127.0.0.1:3080/?token=abc123")!
        precondition(BrowserAutomationSupport.harnessOrigins(for: tokenURL) == origins)
        // 非 loopback（外部/公网 Harness）保留自己的 authority，不做 127.0.0.1 折叠。
        let remoteURL = URL(string: "https://harness.example.com/web/")!
        precondition(BrowserAutomationSupport.harnessOrigins(for: remoteURL) == ["https://harness.example.com"])
        let chromeScript = BrowserAutomationSupport.browserFocusScript(
            bundleIdentifier: "com.google.Chrome", targetURL: harnessURL
        )
        precondition(chromeScript?.contains("tell application id \"com.google.Chrome\"") == true)
        precondition(chromeScript?.contains("active tab index") == true)
        precondition(chromeScript?.contains("repeat with tabIndex from") == true)
        precondition(chromeScript?.contains("index of browserTab") == false)
        precondition(chromeScript?.contains("http://localhost:3080") == true)
        // origin 判定：精确相等或紧跟 / ? # 才算命中，`:30800` 不会被误判。
        precondition(chromeScript?.contains("on matchesHarnessOrigin(tabURL, origins)") == true)
        precondition(chromeScript?.contains("tabURL starts with (base & \"?\")") == true)
        precondition(chromeScript?.contains("tabURL starts with (base & \"#\")") == true)
        precondition(chromeScript?.contains("my matchesHarnessOrigin(tabURL, targetOrigins)") == true)
        precondition(chromeScript?.contains("targetURLs contains") == false)
        // 匹配失败要把浏览器自己的标签页地址带回来（诊断证据）。
        precondition(chromeScript?.contains("return \"missing\" & linefeed & tabReport") == true)
        precondition(NSAppleScript(source: chromeScript!) != nil)
        let safariScript = BrowserAutomationSupport.browserFocusScript(
            bundleIdentifier: "com.apple.Safari", targetURL: harnessURL
        )
        precondition(safariScript?.contains("current tab of browserWindow") == true)
        precondition(safariScript?.contains("on matchesHarnessOrigin(tabURL, origins)") == true)
        precondition(NSAppleScript(source: safariScript!) != nil)
        precondition(BrowserAutomationSupport.browserFocusScript(bundleIdentifier: "org.mozilla.firefox", targetURL: harnessURL) == nil)
        // 脚本返回值的解析：missing 之后每行一个标签页地址，超过上限只留前几条。
        precondition(BrowserAutomationSupport.parseTabScriptResult("found") == .focused)
        precondition(BrowserAutomationSupport.parseTabScriptResult("closed") == .closed)
        precondition(BrowserAutomationSupport.parseTabScriptResult("missing\n") == .missing(tabs: []))
        precondition(
            BrowserAutomationSupport.parseTabScriptResult("missing\nhttp://127.0.0.1:3080/?token=t\nhttps://example.com/\n")
                == .missing(tabs: ["http://127.0.0.1:3080/?token=t", "https://example.com/"])
        )
        let manyTabs = "missing\n" + (0..<9).map { "https://example.com/\($0)\n" }.joined()
        precondition(BrowserAutomationSupport.parseTabScriptResult(manyTabs)
            == .missing(tabs: (0..<BrowserAutomationSupport.missingTabReportLimit).map { "https://example.com/\($0)" }))
        precondition(BrowserAutomationSupport.parseTabScriptResult("") != .focused)
        precondition(BrowserAutomationSupport.parseTabScriptResult("garbage") == .failed("浏览器自动化未返回预期结果"))
        // 重启接管：先关闭匹配的旧标签页（dsh 会话全部持久化，仅刷新看
        // 不出重启发生过），再由启动器新开入口页面。匹配仍按去 query 的
        // origin 进行，任何 token 打开的标签都能关掉。
        let entryURL = URL(string: "http://127.0.0.1:3080/?token=newtoken")!
        let chromeClose = BrowserAutomationSupport.browserCloseScript(
            bundleIdentifier: "com.google.Chrome", targetURL: entryURL
        )
        precondition(chromeClose?.contains("close browserTab") == true)
        precondition(chromeClose?.contains("return \"closed\"") == true)
        precondition(chromeClose?.contains("newtoken") == false) // 匹配地址不带 token
        precondition(BrowserAutomationSupport.browserFocusScript(bundleIdentifier: "com.google.Chrome", targetURL: harnessURL)?.contains("close browserTab") == false)
        let safariClose = BrowserAutomationSupport.browserCloseScript(
            bundleIdentifier: "com.apple.Safari", targetURL: entryURL
        )
        precondition(safariClose?.contains("close browserTab") == true)
        precondition(NSAppleScript(source: chromeClose!) != nil)
        print("PASS: connection direction, exact port, IPv6, deduplication, malformed records, helper ancestry, cycles, non-browser exclusion, existing-browser reuse, intent throttle, page URL, origin-based tab matching, missing-tab report, restart tab close")
    }
}
