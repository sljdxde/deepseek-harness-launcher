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
        let harnessURL = URL(string: "http://127.0.0.1:3080/")!
        let localURLs = BrowserAutomationSupport.localHarnessURLStrings(for: harnessURL)
        precondition(localURLs.contains("http://127.0.0.1:3080/"))
        precondition(localURLs.contains("http://localhost:3080/"))
        precondition(localURLs.contains("http://[::1]:3080/"))
        let chromeScript = BrowserAutomationSupport.browserFocusScript(
            bundleIdentifier: "com.google.Chrome", targetURL: harnessURL
        )
        precondition(chromeScript?.contains("tell application id \"com.google.Chrome\"") == true)
        precondition(chromeScript?.contains("active tab index") == true)
        precondition(chromeScript?.contains("repeat with tabIndex from") == true)
        precondition(chromeScript?.contains("index of browserTab") == false)
        precondition(chromeScript?.contains("http://localhost:3080/") == true)
        precondition(NSAppleScript(source: chromeScript!) != nil)
        let safariScript = BrowserAutomationSupport.browserFocusScript(
            bundleIdentifier: "com.apple.Safari", targetURL: harnessURL
        )
        precondition(safariScript?.contains("current tab of browserWindow") == true)
        precondition(NSAppleScript(source: safariScript!) != nil)
        precondition(BrowserAutomationSupport.browserFocusScript(bundleIdentifier: "org.mozilla.firefox", targetURL: harnessURL) == nil)
        print("PASS: connection direction, exact port, IPv6, deduplication, malformed records, helper ancestry, cycles, non-browser exclusion, existing-browser reuse, intent throttle, page URL, browser automation scripts")
    }
}
