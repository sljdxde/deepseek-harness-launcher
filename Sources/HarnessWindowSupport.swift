import Foundation

/// 内置 Harness 窗口（WKWebView）的决策层。
///
/// 背景：以前「点会话完成」的落点是**系统浏览器**，而 macOS 只能把 AppleScript
/// 发给「最近启动」的同 bundle 实例；这台机器上 `chrome-devtools-mcp` / agent-browser
/// 这类自动化浏览器常驻时，标签定位必然落空，只能退化成「新开一个标签页」——用户
/// 看到的正是「又开了一个窗口」。内置窗口把页面变成启动器自己的 `WKWebView`：
/// 没有浏览器实例、没有 AppleScript、没有标签页匹配，窗口只有一个，跳转就是
/// 「把窗口拿到前面 + 通过插件命令切会话」。
///
/// 这里放**可单测的判断**（`main.swift` 只把结论翻译成 AppKit/WKWebView 调用）：
/// 1. `action(context:entryURL:forceReload:)`：这次点击该新建窗口、重载、还是只前置；
/// 2. `linkAction(url:harnessPort:)`：页面里的链接留在窗口内还是交给系统浏览器；
/// 3. `downloadDestination(...)`：下载文件名清洗与不覆盖已有文件；
/// 4. `failureHTML(...)`：加载失败时的可读兜底页。
///
/// 约定：页面只属于**本机 loopback + 当前端口**。同源导航（SPA 路由、插件页面）
/// 留在窗口内，任何其它地址（文档链接、`mailto:`、外站）一律外开——窗口不是浏览器，
/// 不留导航历史，也不该把用户困在一个没有地址栏的窗口里。
enum HarnessWindowSupport {
    /// 窗口标题栏文案。页面自己的 `<title>` 是 "DeepSeek Harness"，窗口统一用品牌名。
    static let windowTitle = "Deepseek Harness"

    /// 窗口是否真的在用户眼前。最小化、或窗口在别的 Space 都不算「已呈现」——
    /// 点 Dock 图标应该把它拿回来，而不是被「isVisible 仍为 true」骗过去。
    static func isWindowPresented(visible: Bool, miniaturized: Bool, onActiveSpace: Bool) -> Bool {
        visible && !miniaturized && onActiveSpace
    }

    /// macOS 窗口默认尺寸：Harness 界面在 1280×860 下是完整三栏布局，再小侧栏会挤。
    static let defaultWindowSize = CGSize(width: 1280, height: 860)
    static let minimumWindowSize = CGSize(width: 960, height: 600)

    /// 一次「打开/跳转」动作。
    enum WindowAction: Equatable {
        /// 还没有窗口：新建并加载入口 URL。
        case openAndLoad(URL)
        /// 窗口在，但页面属于旧端口/旧 token（或强制重载）：前置并重新加载。
        case showAndLoad(URL)
        /// 窗口在且页面就是当前服务：只前置拿焦点，不重载（重载会打断正在跑的回合）。
        case showOnly
        /// dsh 没在跑 / 还没拿到端口：先启动，就绪后再走上面三种之一。
        case waitForRuntime
    }

    /// 判断用的现场快照。`loadedPort` 是**已请求加载**的页面端口（不是页面
    /// 当前 URL 的端口，SPA 内部路由不该被当成换端口）。
    struct Context: Equatable {
        var isRunning: Bool
        var targetPort: Int?
        var windowExists: Bool
        var loadedPort: Int?
        var loadedEntryURL: URL?

        init(isRunning: Bool, targetPort: Int?, windowExists: Bool, loadedPort: Int?, loadedEntryURL: URL?) {
            self.isRunning = isRunning
            self.targetPort = targetPort
            self.windowExists = windowExists
            self.loadedPort = loadedPort
            self.loadedEntryURL = loadedEntryURL
        }
    }

    /// - Parameter forceReload: dsh 重启后旧 token 失效，必须让窗口重新加载新入口；
    ///   此时即使端口没变也要重载（页面自己会重连失败成一张死页面）。
    static func action(context: Context, entryURL: URL?, forceReload: Bool) -> WindowAction {
        guard context.isRunning, let targetPort = context.targetPort, let entryURL else {
            return .waitForRuntime
        }
        guard context.windowExists, let loadedPort = context.loadedPort else {
            return .openAndLoad(entryURL)
        }
        let staleToken: Bool
        if let loadedEntryURL = context.loadedEntryURL {
            staleToken = loadedEntryURL != entryURL
        } else {
            // 不知道旧页面用的哪个入口：宁可重载一次，也不要把 401 页留在眼前。
            staleToken = true
        }
        if forceReload || loadedPort != targetPort || staleToken {
            return .showAndLoad(entryURL)
        }
        return .showOnly
    }

    // MARK: - 链接与导航

    enum LinkAction: Equatable {
        case inWindow
        case external
    }

    static let loopbackHosts: Set<String> = ["127.0.0.1", "localhost", "::1"]

    static func normalizedHost(_ url: URL) -> String? {
        guard let host = url.host?.lowercased() else { return nil }
        // URL.host 对 IPv6 可能带方括号，去掉后统一比较。
        return (host.hasPrefix("[") && host.hasSuffix("]")) ? String(host.dropFirst().dropLast()) : host
    }

    /// 页面里的链接留在窗口内还是交给系统浏览器。
    ///
    /// 只放行「http(s) + loopback + 当前端口」：插件页面、SPA 路由、附件预览都是
    /// 这种地址；外站/文档链接/`mailto:`/`file:` 外开。端口不匹配也算外开——同一个
    /// 127.0.0.1 上的其它服务如果被塞进这个窗口，用户就失去了浏览器地址栏这个
    /// 「这是谁」的唯一线索。
    static func linkAction(url: URL, harnessPort: Int?) -> LinkAction {
        guard let scheme = url.scheme?.lowercased() else { return .external }
        // 兜底页/空白页由启动器自己发起（loadHTMLString → about:blank）：必须留在
        // 窗口内，否则 401 兜底页会被「外链改道」规则取消，只剩一张白屏。
        if scheme == "about" { return .inWindow }
        guard scheme == "http" || scheme == "https" else {
            return .external
        }
        guard let harnessPort, let port = url.port ?? defaultPort(scheme: scheme) else { return .external }
        guard port == harnessPort, let host = normalizedHost(url), loopbackHosts.contains(host) else {
            return .external
        }
        return .inWindow
    }

    private static func defaultPort(scheme: String) -> Int? {
        switch scheme {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

    /// 页面自己发起的哪类导航需要改走系统浏览器；`nil` 表示照常放行。
    /// `frameIsMainFrame == false`（iframe）永远放行，插件内嵌面板依赖它。
    static func navigationRedirect(url: URL, harnessPort: Int?, frameIsMainFrame: Bool) -> URL? {
        guard frameIsMainFrame else { return nil }
        return linkAction(url: url, harnessPort: harnessPort) == .external ? url : nil
    }

    // MARK: - 下载

    /// 下载落点：`~/Downloads` 下的安全文件名，绝不覆盖已有文件。
    ///
    /// 文件名来自页面/服务端，长度和字符都不受控，必须清洗：去掉路径分隔符与
    /// 控制字符，超长截断，纯空白/纯点号退回 `download`。重名时插入 ` (n)`，
    /// 因为静默覆盖用户刚下载的文件是数据丢失。
    static func downloadDestination(
        directory: URL,
        suggestedFilename: String?,
        fileExists: (URL) -> Bool
    ) -> URL {
        let cleaned = sanitizedFilename(suggestedFilename)
        let candidate = directory.appendingPathComponent(cleaned)
        guard fileExists(candidate) else { return candidate }
        let ext = candidate.pathExtension
        let stem = ext.isEmpty ? cleaned : String(cleaned.dropLast(ext.count + 1))
        for index in 1...999 {
            let name = ext.isEmpty ? "\(stem) (\(index))" : "\(stem) (\(index)).\(ext)"
            let next = directory.appendingPathComponent(name)
            if !fileExists(next) { return next }
        }
        return directory.appendingPathComponent("\(cleaned)-\(UUID().uuidString.prefix(8))")
    }

    static func sanitizedFilename(_ raw: String?) -> String {
        let fallback = "download"
        guard let raw, !raw.isEmpty else { return fallback }
        var name = raw.replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        name = name.unicodeScalars
            .filter { scalar in
                !(scalar.value < 0x20) && scalar.value != 0x7F
            }
            .reduce(into: "") { $0.unicodeScalars.append($1) }
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        while name.hasPrefix(".") { name.removeFirst() }
        if name.isEmpty { return fallback }
        if name.count > 120 {
            let ext = (name as NSString).pathExtension
            let stem = (name as NSString).deletingPathExtension
            let budget = max(1, 120 - ext.count - 1)
            name = ext.isEmpty ? String(stem.prefix(120)) : "\(stem.prefix(budget)).\(ext)"
        }
        return name.isEmpty ? fallback : name
    }

    // MARK: - 失败兜底页

    /// 加载失败/401 时窗口里显示的可读页面（不留白屏，也不把原始错误 URL 塞给用户）。
    static func failureHTML(message: String, detail: String? = nil) -> String {
        func escape(_ text: String) -> String {
            text.replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
                .replacingOccurrences(of: "\"", with: "&quot;")
        }
        let detailBlock = detail.map { "<p class=\"detail\">\(escape($0))</p>" } ?? ""
        return """
        <!doctype html>
        <html lang="zh-CN"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root { color-scheme: light dark; }
          body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
                 font: 14px/1.7 -apple-system, "PingFang SC", sans-serif; background: #f6f6f6; color: #222; }
          @media (prefers-color-scheme: dark) { body { background: #1c1c1e; color: #f2f2f2; } }
          .card { max-width: 560px; padding: 28px 32px; border-radius: 14px; background: rgba(255,255,255,.72);
                  box-shadow: 0 8px 30px rgba(0,0,0,.08); }
          @media (prefers-color-scheme: dark) { .card { background: rgba(255,255,255,.06); } }
          h1 { margin: 0 0 10px; font-size: 17px; }
          p { margin: 6px 0; }
          .detail { color: #888; font-size: 12px; word-break: break-all; }
          .hint { margin-top: 14px; color: #888; font-size: 12px; }
        </style></head>
        <body><main class="card">
          <h1>\(escape(message))</h1>
          \(detailBlock)
          <p class="hint">菜单栏图标 → 「打开 Deepseek Harness」可重试；如果 dsh 是外部启动的，内置窗口拿不到它的认证入口，请在设置里改回浏览器打开，或用「重启 Deepseek Harness」让启动器接管。</p>
        </main></body></html>
        """
    }

    /// 401 的专用文案：这不是网络错误，是「启动器没有这个实例的认证入口」。
    static let authenticationFailureMessage = "Harness 页面要求认证"
}