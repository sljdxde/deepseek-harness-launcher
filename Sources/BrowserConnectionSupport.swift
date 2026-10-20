import Foundation

/// Who asked for the page. Manual clicks must always navigate; the automatic
/// open that fires when the backend becomes ready may be throttled.
enum BrowserOpenIntent {
    case manual
    case automatic
}

/// What to do once the connected browser (if any) is known.
struct BrowserOpenPlan {
    /// Bring the already-connected browser forward without creating a second
    /// Harness tab. Selecting a specific browser tab requires browser
    /// automation permission, so this launcher deliberately does not attempt it.
    let activatesConnectedBrowser: Bool
    /// A URL is only opened when no Harness page is connected. Passing the same
    /// URL to Chrome through NSWorkspace does not select an existing tab; it
    /// creates another one.
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
        BrowserOpenPlan(activatesConnectedBrowser: connectedBrowser, opensURL: !connectedBrowser)
    }

    /// GET /dsh-session-notify/presence 的响应解析：注入客户端的心跳汇总。
    /// Chrome keep-alive 会在标签页全部关闭后仍保持一段时间的 ESTABLISHED
    /// 连接，socket 检测因此可能高估「页面还开着」；心跳不存在时必须新开
    /// 页面。返回 nil 表示响应缺失或非法（外部 Harness / 旧插件），调用方
    /// 保持「有连接就前置」的降级行为。
    static func presenceActive(_ body: String?) -> Bool? {
        guard let body, let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let active = object["active"] as? Bool else { return nil }
        return active
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

    /// 标签定位失败时的日志明细（含括号，无信息时为空串）。
    ///
    /// 两个事实必须一起写进日志，否则「未找到匹配标签页」无法定位是哪一种：
    /// - 浏览器自己报出来的标签地址：说明 AppleScript 实际寻址到了哪个实例；
    /// - 同 bundle 的实例数：macOS 只把 AppleScript 事件发给**最近启动**的那个实例，
    ///   而 `lsof` 找到的可能是另一个（例如 agent-browser 这类自动化浏览器常驻时）。
    ///   多实例下「未找到标签页」并不等于页面没开，而是页面在不被寻址的实例里。
    static func tabReportDetail(
        tabs: [String],
        instanceCount: Int,
        browserName: String,
        limit: Int = 4
    ) -> String {
        var details: [String] = []
        if !tabs.isEmpty {
            let shown = tabs.prefix(limit).map { $0.count > 160 ? String($0.prefix(160)) + "…" : $0 }
            details.append("\(tabs.count) 个已开标签：" + shown.joined(separator: " | "))
        }
        if instanceCount > 1 {
            details.append("\(browserName) 有 \(instanceCount) 个实例在运行，AppleScript 只会发给最近启动的那个，页面可能在另一个实例里")
        }
        guard !details.isEmpty else { return "" }
        return "（" + details.joined(separator: "；") + "）"
    }
}
