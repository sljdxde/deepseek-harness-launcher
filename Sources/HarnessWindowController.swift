import AppKit
import WebKit

/// Harness 内置窗口：启动器自己持有的 `WKWebView` 窗口。
///
/// 为什么不再用浏览器：菜单栏「打开 Harness」和「会话完成」跳转以前都落在系统
/// 浏览器上，而 macOS 只能把 AppleScript 发给「最近启动」的同 bundle 实例。
/// `chrome-devtools-mcp` / agent-browser 这类自动化浏览器常驻时，真正连着 Harness
/// 的 Chrome 永远不是被寻址的那个，标签定位必然落空，最后只能新开一个标签页——
/// 用户看到的就是「点已完成任务，又开了一个窗口」。
///
/// 这个窗口把页面收归启动器自己：只有一个窗口、没有 AppleScript、没有标签匹配。
/// 历史上「跳转到某个会话」还要通过 `dsh-session-notify` 插件命令切会话；会话完成
/// 提醒下线后，这个入口连同启动器侧的发送链路一起移除（插件端点留给 Windows 托盘）。
///
/// 它同时也是普通浏览器行为的最小替身：外链交给系统浏览器、`<input type=file>`
/// 用原生文件选择器、下载落到 `~/Downloads`、JS alert/confirm/prompt 用原生弹窗。
/// 这些都不是锦上添花——少一个，Harness 界面就有功能会「点了没反应」。
final class HarnessWindowController: NSWindowController, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let logger: (String) -> Void
    private let onClose: () -> Void
    /// 页面**连不上**当前端口（不是 401、不是内容错误）时回调，参数是这次要加载的
    /// 端口。启动器据此立刻确认「端口上还有没有 dsh」——没有就重新拉起。
    /// 只在窗口里贴一张「Could not connect」的兜底页，用户就永远出不来了：
    /// 下一次点「打开」还是同一个空端口，重载也一样（历史事故现场）。
    var onConnectionFailure: ((Int?) -> Void)?

    private var webView: WKWebView!
    /// 已请求加载的页面端口。SPA 内部路由不会改它；换端口/重载才会。
    private(set) var loadedPort: Int?
    private(set) var loadedEntryURL: URL?
    /// 失败兜底页正在显示：此时 loadedPort 已清空，下一次「打开」会重新加载。
    private(set) var showingFailurePage = false
    /// `WKDownload.delegate` 是 weak，必须在这里强持有，否则下载会中途丢代理。
    private var activeDownloads: [WKDownload] = []
    /// 页面 `didFinish` 后要执行的一次性回调（会话跳转必须等页面开始轮询后再投递
    /// 命令：命令的「焦点优先领取」窗口只有 2.5 秒，页面还没加载完就入队，会被
    /// 别处残留的浏览器页面先领走——那正是这次要修掉的现象）。
    private var pageReadyCallbacks: [() -> Void] = []

    /// 窗口尺寸来自 `HarnessWindowSupport`，方便和单测共用同一套边界。
    init(logger: @escaping (String) -> Void = { _ in }, onClose: @escaping () -> Void = {}) {
        self.logger = logger
        self.onClose = onClose
        let size = HarnessWindowSupport.defaultWindowSize
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: size.width, height: size.height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = HarnessWindowSupport.windowTitle
        window.minSize = HarnessWindowSupport.minimumWindowSize
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.setFrameAutosaveName("HarnessMainWindow")
        super.init(window: window)
        window.delegate = self
        buildWebView(in: window)
        if !window.setFrameUsingName("HarnessMainWindow") {
            window.center()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: - 构建

    private func buildWebView(in window: NSWindow) {
        let configuration = WKWebViewConfiguration()
        // 默认数据仓：cookie / localStorage 跟着 App 走，重启启动器后页面状态还在
        // （会话列表、主题、工作区选择都属于 Harness 自己的持久状态）。
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = true
        window.contentView?.addSubview(webView)
        self.webView = webView
    }

    // MARK: - 对外入口

    /// 显示窗口；`reload` 为 true 时用 `entryURL` 重新加载页面。
    ///
    /// 调用方（`main.swift`）已经通过 `HarnessWindowSupport.action` 决定「新建/重载/
    /// 只前置」，这里只执行，不再做判断——判断全在可单测的 Support 里。
    ///
    /// - Parameter whenReady: 页面 `didFinish` 后执行一次；不重载（只前置）时立即执行。
    ///   会话跳转用它保证「页面先开始轮询、命令后入队」。
    func show(entryURL: URL?, reload: Bool, whenReady: (() -> Void)? = nil) {
        if reload, let entryURL {
            if let whenReady { pageReadyCallbacks.append(whenReady) }
            load(entryURL)
            present()
            return
        }
        present()
        whenReady?()
    }

    func closeWindow() {
        window?.performClose(nil)
    }

    private func present() {
        guard let window else { return }
        if window.isMiniaturized { window.deminiaturize(nil) }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    private func load(_ url: URL) {
        loadedPort = url.port
        loadedEntryURL = url
        showingFailurePage = false
        logger("内置窗口加载 Harness 页面（端口 \(url.port.map(String.init) ?? "?")）")
        webView?.load(URLRequest(url: url))
    }

    private func presentFailure(message: String, detail: String? = nil) {
        // 清掉「已加载」标记：下次点击会走 openAndLoad/showAndLoad 重新加载。
        loadedPort = nil
        loadedEntryURL = nil
        showingFailurePage = true
        pageReadyCallbacks.removeAll()
        webView?.loadHTMLString(HarnessWindowSupport.failureHTML(message: message, detail: detail), baseURL: nil)
        logger("内置窗口页面加载失败：\(message)\(detail.map { "（\($0)）" } ?? "")")
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        logger("内置 Harness 窗口已关闭（dsh 继续在后台运行）")
        onClose()
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let frameIsMain = navigationAction.targetFrame?.isMainFrame ?? true
        if HarnessWindowSupport.navigationRedirect(
            url: url, harnessPort: loadedPort, frameIsMainFrame: frameIsMain
        ) != nil {
            // 外链不留在没有地址栏的窗口里：文档、外站、mailto、file 一律交给系统。
            logger("内置窗口外链交由系统打开：\(url.host ?? url.scheme ?? "未知")")
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame == nil {
            // window.open / target=_blank：同源页面就在本窗口里打开（不新建第二个
            // Harness 窗口——「又一个窗口」正是这次要修掉的东西）。
            if HarnessWindowSupport.linkAction(url: url, harnessPort: loadedPort) == .inWindow {
                webView.load(navigationAction.request)
            } else {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame,
           let http = navigationResponse.response as? HTTPURLResponse,
           http.statusCode == 401 {
            // 401 = 启动器手里没有这个实例的认证入口（外部启动的 dsh、或旧 token
            // 在重启后失效）。不要把这行文案留在窗口里让用户以为是插件坏了。
            decisionHandler(.cancel)
            // 不在决策回调里同步发起新导航：先让本次响应结束，下一拍再切兜底页。
            DispatchQueue.main.async { [weak self] in
                self?.presentFailure(
                    message: HarnessWindowSupport.authenticationFailureMessage,
                    detail: "当前 dsh 实例没有向启动器打印 token 入口；它可能是外部启动的，或刚刚重启过。"
                )
            }
            return
        }
        if !navigationResponse.canShowMIMEType, navigationResponse.isForMainFrame {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        attach(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        attach(download)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !showingFailurePage else { return }
        logger("内置窗口页面加载完成（端口 \(loadedPort.map(String.init) ?? "?")）")
        let callbacks = pageReadyCallbacks
        pageReadyCallbacks = []
        callbacks.forEach { $0() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard !showingFailurePage else { return }
        let failedPort = loadedPort
        presentFailure(message: "Harness 页面加载失败", detail: error.localizedDescription)
        reportConnectionFailure(error, port: failedPort)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard !showingFailurePage else { return }
        // 被取消的导航（外链改道、JS 中断）不是错误，别把兜底页盖上去。
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        let failedPort = loadedPort
        presentFailure(message: "Harness 页面打不开", detail: error.localizedDescription)
        reportConnectionFailure(nsError, port: failedPort)
    }

    /// 连接失败（端口上没人）交回启动器：它会再确认一次服务是否还在，必要时重启。
    /// 认证/内容类失败不在此列——那种情况重启也没用，兜底页里的提示才是正解。
    /// `port` 必须在 `presentFailure` 之前取：它会把 loadedPort 清掉。
    private func reportConnectionFailure(_ error: Error, port: Int?) {
        guard let onConnectionFailure else { return }
        let nsError = error as NSError
        guard RuntimeHealthSupport.isConnectionFailure(nsError) else { return }
        onConnectionFailure(port)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // WebKit 内容进程崩溃：dsh 还活着，页面只是没了。直接重载，别让用户盯着白屏。
        logger("内置窗口的 WebKit 内容进程退出，重新加载页面")
        if let entryURL = loadedEntryURL {
            load(entryURL)
        }
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if HarnessWindowSupport.linkAction(url: url, harnessPort: loadedPort) == .inWindow {
            webView.load(navigationAction.request)
        } else {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        // 附件上传 / 目录选择：WKWebView 不提供文件面板，必须由宿主接
        // `runOpenPanelWith`，否则点「添加附件」没有任何反应。
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.canCreateDirectories = false
        guard let window else {
            completionHandler(nil)
            return
        }
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        showInfoAlert(title: "Harness 页面", message: message)
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .info)
        alert.messageText = "Harness 页面"
        AlertDesign.setBoundedText(message, on: alert)
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        completionHandler(AlertDesign.run(alert, escapeButtonIndex: 1) == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .info)
        alert.messageText = "Harness 页面"
        AlertDesign.setBoundedText(prompt, on: alert)
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: AlertDesign.cardWidth, height: 24)
        alert.accessoryView = field
        let response = AlertDesign.run(alert, escapeButtonIndex: 1)
        completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
    }

    private func showInfoAlert(title: String, message: String) {
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .info)
        alert.messageText = title
        AlertDesign.setBoundedText(message, on: alert)
        alert.addButton(withTitle: "好")
        AlertDesign.run(alert, escapeButtonIndex: 0)
    }

    // MARK: - WKDownloadDelegate

    private func attach(_ download: WKDownload) {
        activeDownloads.append(download)
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads", isDirectory: true)
        let destination = HarnessWindowSupport.downloadDestination(
            directory: downloads,
            suggestedFilename: suggestedFilename,
            fileExists: { FileManager.default.fileExists(atPath: $0.path) }
        )
        logger("内置窗口下载文件到 \(destination.lastPathComponent)")
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        activeDownloads.removeAll { $0 === download }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        activeDownloads.removeAll { $0 === download }
        logger("内置窗口下载失败：\(error.localizedDescription)")
    }
}