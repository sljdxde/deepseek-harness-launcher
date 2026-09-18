import Foundation

/// Result of trying to select an already-open Harness browser tab. Every
/// non-success result intentionally has a caller-side fallback to activating
/// the browser, so browser automation is an enhancement rather than a hard
/// dependency.
enum BrowserTabFocusResult {
    case focused
    case missing
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

    static func focusHarnessTab(bundleIdentifier: String?, targetURL: URL) -> BrowserTabFocusResult {
        guard let bundleIdentifier,
              let source = browserFocusScript(bundleIdentifier: bundleIdentifier, targetURL: targetURL) else {
            return .unsupported
        }
        guard let script = NSAppleScript(source: source) else {
            return .failed("无法创建浏览器自动化脚本")
        }
        var error: NSDictionary?
        let result = script.executeAndReturnError(&error)
        if let error {
            let message = error[NSAppleScript.errorMessage] as? String ?? error.description
            return .failed(message)
        }
        switch result.stringValue {
        case "found": return .focused
        case "missing": return .missing
        default: return .failed("浏览器自动化未返回预期结果")
        }
    }

    /// Kept separate from execution so it can be tested without sending an
    /// Apple Event or triggering macOS's Automation authorization dialog.
    static func browserFocusScript(bundleIdentifier: String, targetURL: URL) -> String? {
        let identifier = bundleIdentifier.lowercased()
        let urls = localHarnessURLStrings(for: targetURL)
        guard !urls.isEmpty else { return nil }
        if chromiumBundleIDs.contains(identifier) {
            return chromiumScript(applicationID: bundleIdentifier, urls: urls)
        }
        if safariBundleIDs.contains(identifier) {
            return safariScript(applicationID: bundleIdentifier, urls: urls)
        }
        return nil
    }

    /// A manually opened Harness page may use localhost or IPv6 while the
    /// launcher itself uses 127.0.0.1. They are the same local Harness port.
    static func localHarnessURLStrings(for targetURL: URL) -> [String] {
        guard let scheme = targetURL.scheme,
              let host = targetURL.host,
              let port = targetURL.port,
              ["127.0.0.1", "localhost", "::1"].contains(host.lowercased()) else {
            return [targetURL.absoluteString]
        }
        let path = targetURL.path.isEmpty ? "/" : targetURL.path
        let suffix = path == "/" ? ["/", ""] : [path]
        var urls = [String]()
        for candidateHost in ["127.0.0.1", "localhost", "[::1]"] {
            for candidatePath in suffix {
                urls.append("\(scheme)://\(candidateHost):\(port)\(candidatePath)")
            }
        }
        return urls
    }

    private static func chromiumScript(applicationID: String, urls: [String]) -> String {
        """
        tell application id \(appleScriptString(applicationID))
            set targetURLs to \(appleScriptList(urls))
            repeat with windowIndex from 1 to (count windows)
                set browserWindow to window windowIndex
                repeat with tabIndex from 1 to (count tabs of browserWindow)
                    set browserTab to tab tabIndex of browserWindow
                    if targetURLs contains (URL of browserTab as text) then
                        set active tab index of browserWindow to tabIndex
                        if windowIndex is not 1 then set index of browserWindow to 1
                        activate
                        return "found"
                    end if
                end repeat
            end repeat
            return "missing"
        end tell
        """
    }

    private static func safariScript(applicationID: String, urls: [String]) -> String {
        """
        tell application id \(appleScriptString(applicationID))
            set targetURLs to \(appleScriptList(urls))
            repeat with windowIndex from 1 to (count windows)
                set browserWindow to window windowIndex
                repeat with tabIndex from 1 to (count tabs of browserWindow)
                    set browserTab to tab tabIndex of browserWindow
                    if targetURLs contains (URL of browserTab as text) then
                        set current tab of browserWindow to browserTab
                        if windowIndex is not 1 then set index of browserWindow to 1
                        activate
                        return "found"
                    end if
                end repeat
            end repeat
            return "missing"
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
