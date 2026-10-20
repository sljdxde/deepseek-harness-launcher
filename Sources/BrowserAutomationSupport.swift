import Foundation

/// Result of trying to select an already-open Harness browser tab. Every
/// non-success result intentionally has a caller-side fallback to activating
/// the browser, so browser automation is an enhancement rather than a hard
/// dependency.
enum BrowserTabFocusResult: Equatable {
    case focused
    /// The matched tab was closed (restart takeover: the old page held the
    /// previous process's token and dsh keeps all session state, so a plain
    /// reload looks identical — close + fresh open makes the restart visible).
    case closed
    /// No tab sits on the Harness origin. `tabs` carries the URLs the browser
    /// actually reported (bounded by the script), so a jump that lands on no
    /// tab leaves evidence in the launcher log instead of vanishing.
    case missing(tabs: [String])
    case unsupported
    case failed(String)
}

/// Apple Events are used only after the socket-based detector has identified
/// a browser that is already connected to Harness. This keeps ordinary launch,
/// installation, and service probing free of automation prompts.
enum BrowserAutomationSupport {
    private static let chromiumBundleIDs: Set<String> = [
        "com.google.chrome", "com.microsoft.edgemac", "com.brave.browser",
        "company.thebrowser.browser", "com.vivaldi.vivaldi", "com.operasoftware.opera",
        "org.chromium.chromium"
    ]
    private static let safariBundleIDs: Set<String> = [
        "com.apple.safari", "com.apple.safaritechnologypreview"
    ]

    /// How many of the browser's own tab URLs the script reports back on a miss.
    static let missingTabReportLimit = 4

    static func focusHarnessTab(bundleIdentifier: String?, targetURL: URL) -> BrowserTabFocusResult {
        guard let bundleIdentifier,
              let source = browserFocusScript(bundleIdentifier: bundleIdentifier, targetURL: targetURL) else {
            return .unsupported
        }
        return executeTabScript(source)
    }

    /// Close the first tab matching the Harness URL. Used by the restart
    /// takeover so the relaunch is observable: the old tab goes away and the
    /// launcher opens a fresh page on the new process's entry URL.
    static func closeHarnessTab(bundleIdentifier: String?, targetURL: URL) -> BrowserTabFocusResult {
        guard let bundleIdentifier,
              let source = browserCloseScript(bundleIdentifier: bundleIdentifier, targetURL: targetURL) else {
            return .unsupported
        }
        return executeTabScript(source)
    }

    static func executeTabScript(_ source: String) -> BrowserTabFocusResult {
        guard let script = NSAppleScript(source: source) else {
            return .failed("无法创建浏览器自动化脚本")
        }
        var error: NSDictionary?
        let result = script.executeAndReturnError(&error)
        if let error {
            let message = error[NSAppleScript.errorMessage] as? String ?? error.description
            return .failed(message)
        }
        return parseTabScriptResult(result.stringValue ?? "")
    }

    /// The scripts answer with a single line: `found` / `closed` / `missing`.
    /// The `missing` form appends one tab URL per line (see `tabScript`), which
    /// is the only record of what the browser was actually showing.
    static func parseTabScriptResult(_ value: String) -> BrowserTabFocusResult {
        let lines = value.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let head = lines.first else { return .failed("浏览器自动化未返回预期结果") }
        switch head {
        case "found": return .focused
        case "closed": return .closed
        case "missing":
            let tabs = lines.dropFirst()
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            return .missing(tabs: Array(tabs.prefix(missingTabReportLimit)))
        default: return .failed("浏览器自动化未返回预期结果")
        }
    }

    /// Kept separate from execution so it can be tested without sending an
    /// Apple Event or triggering macOS's Automation authorization dialog.
    static func browserFocusScript(bundleIdentifier: String, targetURL: URL) -> String? {
        tabScript(bundleIdentifier: bundleIdentifier, targetURL: targetURL, action: "focus")
    }

    /// Script source of `closeHarnessTab`, exposed for unit tests.
    static func browserCloseScript(bundleIdentifier: String, targetURL: URL) -> String? {
        tabScript(bundleIdentifier: bundleIdentifier, targetURL: targetURL, action: "close")
    }

    /// Origins (`scheme://host:port`, no trailing slash) a Harness page can be
    /// open on. Tab selection must compare **origins**, never whole URLs:
    /// the entry URL carries the launch token (`?token=…`) until the server
    /// exchanges it for a cookie, and the client may leave a `#` fragment or a
    /// trailing slash behind. An exact string compare therefore matches no tab
    /// at all — the launcher just activated the browser and every jump looked
    /// like a no-op. A manually opened page may also use localhost or IPv6
    /// while the launcher itself dials 127.0.0.1: same local Harness port.
    static func harnessOrigins(for targetURL: URL) -> [String] {
        guard let scheme = targetURL.scheme?.lowercased(), let host = targetURL.host?.lowercased() else {
            return []
        }
        let port = targetURL.port
        let loopbackHosts: Set<String> = ["127.0.0.1", "localhost", "::1"]
        if let port, loopbackHosts.contains(host) {
            return ["127.0.0.1", "localhost", "[::1]"].map { "\(scheme)://\($0):\(port)" }
        }
        // A non-loopback Harness (external/public URL) keeps its own authority.
        let authority = port.map { "\(host):\($0)" } ?? host
        return ["\(scheme)://\(authority)"]
    }

    /// Shared builder for the tab-matching scripts. `focus` selects and
    /// fronts the matched tab; `close` removes it. A tab matches when its URL
    /// is one of the Harness origins, or starts with that origin followed by
    /// `/`, `?` or `#` — so `?token=…`, `#fragment` and trailing-slash variants
    /// all count, while a different port (`:30800`) never does.
    private static func tabScript(bundleIdentifier: String, targetURL: URL, action: String) -> String? {
        let identifier = bundleIdentifier.lowercased()
        let origins = harnessOrigins(for: targetURL)
        guard !origins.isEmpty else { return nil }
        if chromiumBundleIDs.contains(identifier) {
            return browserTabScript(
                applicationID: bundleIdentifier, origins: origins, action: action, selectsCurrentTab: false
            )
        }
        if safariBundleIDs.contains(identifier) {
            return browserTabScript(
                applicationID: bundleIdentifier, origins: origins, action: action, selectsCurrentTab: true
            )
        }
        return nil
    }

    private static func browserTabScript(
        applicationID: String,
        origins: [String],
        action: String,
        selectsCurrentTab: Bool
    ) -> String {
        let selectTab = selectsCurrentTab
            ? """
            set current tab of browserWindow to browserTab
            """
            : """
            set active tab index of browserWindow to tabIndex
            """
        let matchAction = action == "close"
            ? """
            close browserTab
                    activate
                    return "closed"
            """
            : """
            \(selectTab)
                    if windowIndex is not 1 then set index of browserWindow to 1
                    activate
                    return "found"
            """
        return """
        on matchesHarnessOrigin(tabURL, origins)
            repeat with originIndex from 1 to (count origins)
                set base to item originIndex of origins
                if tabURL is base then return true
                if tabURL starts with (base & "/") then return true
                if tabURL starts with (base & "?") then return true
                if tabURL starts with (base & "#") then return true
            end repeat
            return false
        end matchesHarnessOrigin

        tell application id \(appleScriptString(applicationID))
            set targetOrigins to \(appleScriptList(origins))
            set tabReport to ""
            repeat with windowIndex from 1 to (count windows)
                set browserWindow to window windowIndex
                repeat with tabIndex from 1 to (count tabs of browserWindow)
                    set browserTab to tab tabIndex of browserWindow
                    set tabURL to ""
                    try
                        set tabURL to (URL of browserTab as text)
                    end try
                    if my matchesHarnessOrigin(tabURL, targetOrigins) then
                        \(matchAction)
                    end if
                    if tabURL is not "" then set tabReport to tabReport & tabURL & linefeed
                end repeat
            end repeat
            return "missing" & linefeed & tabReport
        end tell
        """
    }

    private static func appleScriptList(_ values: [String]) -> String {
        "{" + values.map(appleScriptString).joined(separator: ", ") + "}"
    }

    private static func appleScriptString(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "\"\(escaped)\""
    }
}
