import Foundation

/// Who asked for the page. Manual clicks must always navigate; the automatic
/// open that fires when the backend becomes ready may be throttled.
enum BrowserOpenIntent {
    case manual
    case automatic
}

/// What to do once the connected browser (if any) is known.
struct BrowserOpenPlan {
    /// Bring the already-connected browser forward before handing it the URL.
    let activatesConnectedBrowser: Bool
    /// Always true. Raising the browser alone is what caused "the browser opens
    /// but never jumps to the page": the URL has to reach the browser so it can
    /// focus the existing Harness tab (or open one) instead of leaving whatever
    /// tab was last active in front.
    let opensURL: Bool
}

/// Pure parsing/selection helpers. A socket is a heuristic, not a tab inventory.
enum BrowserConnectionSupport {
    /// The web entry point of a Harness instance.
    static func pageURL(port: Int, path: String = "/") -> URL? {
        guard port > 0, port < 65536 else { return nil }
        let suffix = path.isEmpty || path == "/" ? "/" : (path.hasPrefix("/") ? path : "/" + path)
        return URL(string: "http://127.0.0.1:\(port)\(suffix)")
    }

    static func plan(connectedBrowser: Bool) -> BrowserOpenPlan {
        BrowserOpenPlan(activatesConnectedBrowser: connectedBrowser, opensURL: true)
    }

    /// Drop duplicate opens only. An in-flight open is skipped for every intent;
    /// the 2s cool-down applies to the automatic open alone so that repeated
    /// menu clicks are never swallowed.
    static func shouldDefer(intent: BrowserOpenIntent, inFlight: Bool, lastOpenAt: Date, now: Date) -> Bool {
        if inFlight { return true }
        guard intent == .automatic else { return false }
        return now.timeIntervalSince(lastOpenAt) < 2
    }

    static let browserBundleIDs: Set<String> = [
        "com.google.chrome", "com.apple.safari", "com.microsoft.edgemac",
        "com.brave.browser", "company.thebrowser.browser", "com.vivaldi.vivaldi",
        "com.operasoftware.opera", "org.chromium.chromium", "org.mozilla.firefox",
        "com.apple.safaritechnologypreview"
    ]

    /// lsof -Fpn emits process (p) and socket name (n) records.
    /// Only outbound loopback connections to the exact server port count.
    static func clientPIDs(_ output: String, port: Int) -> Set<Int32> {
        let peers: Set<String> = ["127.0.0.1:\(port)", "[::1]:\(port)", "[::ffff:127.0.0.1]:\(port)"]
        var current: Int32?
        var result = Set<Int32>()
        for line in output.split(separator: "\n") {
            if line.first == "p" { current = Int32(line.dropFirst()) }
            if line.first == "n", let pid = current {
                let endpoints = line.dropFirst().components(separatedBy: "->")
                guard endpoints.count == 2, peers.contains(endpoints[1]) else { continue }
                let local = endpoints[0]
                guard local.hasPrefix("127.0.0.1:") || local.hasPrefix("[::1]:") || local.hasPrefix("[::ffff:127.0.0.1]:") else { continue }
                result.insert(pid)
            }
        }
        return result
    }

    /// Stop at the first GUI application: never activate a terminal/IDE merely
    /// because a descendant curl/node process connected to the service.
    static func browserPID(start: Int32, parents: [Int32: Int32], applications: [Int32: String]) -> Int32? {
        var current = start
        var visited = Set<Int32>()
        for _ in 0..<16 {
            guard current > 1, visited.insert(current).inserted else { return nil }
            if let bundle = applications[current] {
                return browserBundleIDs.contains(bundle.lowercased()) ? current : nil
            }
            guard let parent = parents[current] else { return nil }
            current = parent
        }
        return nil
    }
}
