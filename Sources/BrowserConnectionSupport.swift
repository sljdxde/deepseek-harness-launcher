import Foundation

/// Pure parsing/selection helpers. A socket is a heuristic, not a tab inventory.
enum BrowserConnectionSupport {
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
