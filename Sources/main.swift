import AppKit
import Foundation
import Darwin

private enum LauncherState { case stopped, checking, running, failed }
private enum PortChoice { case reuse(Int), launch(Int) }

// macOS 26 may add a semantic icon column to menu groups (notably for
// "设置…"). Drawing every actionable row through the same view keeps the
// title and shortcut columns stable while preserving native menu behavior.
private final class MenuRowView: NSView {
    var title: String { didSet { needsDisplay = true } }
    let shortcut: String
    private let enabled: () -> Bool
    private var trackingArea: NSTrackingArea?

    init(title: String, shortcut: String, enabled: @escaping () -> Bool = { true }) {
        self.title = title
        self.shortcut = shortcut
        self.enabled = enabled
        super.init(frame: NSRect(x: 0, y: 0, width: 360, height: 30))
        autoresizingMask = [.width]
        wantsLayer = true
    }

    required init?(coder: NSCoder) { nil }

    override func updateTrackingAreas() {
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .inVisibleRect, .mouseEnteredAndExited],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard enabled(), bounds.contains(convert(event.locationInWindow, from: nil)) else { return }
        let item = enclosingMenuItem
        let action = item?.action
        let target = item?.target
        enclosingMenuItem?.menu?.cancelTracking()
        if let action, let target {
            NSApp.sendAction(action, to: target, from: item)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let highlighted = enclosingMenuItem?.isHighlighted == true
        if highlighted {
            let highlightRect = bounds.insetBy(dx: 8, dy: 2)
            NSColor.selectedContentBackgroundColor.setFill()
            NSBezierPath(roundedRect: highlightRect, xRadius: 10, yRadius: 10).fill()
        }

        let isEnabled = enabled()
        let foregroundColor: NSColor
        if highlighted {
            foregroundColor = NSColor.selectedMenuItemTextColor
        } else if isEnabled {
            foregroundColor = NSColor.labelColor
        } else {
            foregroundColor = NSColor.tertiaryLabelColor
        }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.menuFont(ofSize: 0),
            .foregroundColor: foregroundColor
        ]
        let textSize = title.size(withAttributes: attributes)
        title.draw(
            at: NSPoint(x: 32, y: (bounds.height - textSize.height) / 2),
            withAttributes: attributes
        )
        guard !shortcut.isEmpty else { return }
        let shortcutSize = shortcut.size(withAttributes: attributes)
        shortcut.draw(
            at: NSPoint(x: max(32, bounds.width - shortcutSize.width - 35), y: (bounds.height - shortcutSize.height) / 2),
            withAttributes: attributes
        )
    }
}

final class DHLLauncher: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private var process: Process?
    private var selectedPort: Int?
    private var state: LauncherState = .stopped
    private var didOpenBrowser = false
    private var pollTimer: Timer?
    private var autoUpdateTimer: Timer?
    private var settingsWindow: SettingsWindowController?
    private var pendingUpdate: UpdateManifest?
    private var updateCheckInFlight = false
    private var updateMenuItem: NSMenuItem?
    private var updateMenuRow: MenuRowView?
    private var portMenuRow: MenuRowView?
    private let settings = LauncherSettings.shared
    private let updateService = UpdateService()
    private let logLock = NSLock()
    private let basePort = 3080
    private let maxPort = 3099

    private var rootURL: URL { URL(fileURLWithPath: FileManager.default.currentDirectoryPath).deletingLastPathComponent().appendingPathComponent("deepseek-harness-launcher") }
    private var pluginURL: URL { Bundle.main.resourceURL?.appendingPathComponent("DSHArchiveManager") ?? rootURL.appendingPathComponent("Plugins/DSHArchiveManager") }
    private var patchPath: String { pluginURL.appendingPathComponent("cordis.patch.yml").path }
    private var logURL: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let logs = home.appendingPathComponent("Library/Logs/Deepseek Harness Launcher", isDirectory: true)
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let current = logs.appendingPathComponent("dhl.log")
        let legacy = home.appendingPathComponent("Library/Logs/DHL Launcher/dhl.log")
        if !FileManager.default.fileExists(atPath: current.path), FileManager.default.fileExists(atPath: legacy.path) {
            try? FileManager.default.copyItem(at: legacy, to: current)
        }
        return current
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory); configureStatusItem(); start(); scheduleAutoUpdateChecks()
    }

    private func configureStatusItem() {
        statusItem.button?.image = makeStatusImage()
        statusItem.button?.toolTip = "\(LauncherBrand.fullName) (\(LauncherBrand.shortName))"
        statusItem.menu = makeMenu()
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        menu.showsStateColumn = false
        menu.autoenablesItems = false
        let open = menuRowItem(title: "打开 \(LauncherBrand.fullName)", action: #selector(openDHL), keyEquivalent: "o")
        let port = menuRowItem(title: "端口：未运行", action: nil, enabled: { false }); port.tag = 1001
        portMenuRow = port.view as? MenuRowView
        let restart = menuRowItem(title: "重新启动", action: #selector(restartDHL), keyEquivalent: "r")
        let stop = menuRowItem(title: "停止后台", action: #selector(stopDHL), keyEquivalent: "s")
        let update = menuRowItem(title: "检查更新", action: #selector(checkForUpdates))
        update.tag = 1002; updateMenuItem = update; updateMenuRow = update.view as? MenuRowView
        let settingsItem = makeSettingsMenuItem()
        let logs = menuRowItem(title: "打开日志", action: #selector(openLogs), keyEquivalent: "l")
        let quit = menuRowItem(title: "退出 \(LauncherBrand.fullName)", action: #selector(quit), keyEquivalent: "q")
        [open, port, NSMenuItem.separator(), restart, stop, NSMenuItem.separator(), update, settingsItem, logs, quit].forEach(menu.addItem)
        return menu
    }

    private func menuRowItem(title: String, action: Selector?, keyEquivalent: String = "", enabled: @escaping () -> Bool = { true }) -> NSMenuItem {
        let item = NSMenuItem(title: "", action: action, keyEquivalent: keyEquivalent)
        item.target = self
        item.isEnabled = enabled()
        item.keyEquivalentModifierMask = keyEquivalent.isEmpty ? [] : [.command]
        item.image = nil
        item.onStateImage = nil
        item.offStateImage = nil
        item.mixedStateImage = nil
        item.state = .off
        item.indentationLevel = 0
        let shortcut = keyEquivalent.isEmpty ? "" : (keyEquivalent == "," ? "⌘," : "⌘ \(keyEquivalent.uppercased())")
        item.view = MenuRowView(title: title, shortcut: shortcut, enabled: enabled)
        return item
    }

    private func makeSettingsMenuItem() -> NSMenuItem {
        menuRowItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")
    }

    private func setUpdateMenuTitle(_ title: String) {
        updateMenuItem?.title = title
        updateMenuRow?.title = title
    }

    @objc private func openDHL() {
        guard let port = selectedPort else {
            if state == .stopped || state == .failed { start() }
            return
        }
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:\(port)/")!)
    }

    @objc private func restartDHL() { stopDHL(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { self.start() } }

    @objc private func stopDHL() {
        pollTimer?.invalidate(); pollTimer = nil
        let trackedPID = process?.processIdentifier ?? 0
        let discoveredPIDs = managedDSHPIDs()
        process = nil; selectedPort = nil; didOpenBrowser = false; setState(.stopped)
        var pids = discoveredPIDs
        if trackedPID > 0 && !pids.contains(trackedPID) { pids.insert(trackedPID, at: 0) }
        for pid in pids { terminateProcessGroup(pid: pid) }
    }

    private func managedDSHPIDs() -> [Int32] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-axo", "pid=,state=,command="]
        let pipe = Pipe(); task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
        do { try task.run(); task.waitUntilExit() } catch { return [] }
        guard let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) else { return [] }
        let launcherPath = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/DHL").path
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let managedPatches = [
            patchPath,
            "/Applications/Deepseek Harness Launcher.app/Contents/Resources/DSHArchiveManager/cordis.patch.yml",
            "\(home)/Applications/Deepseek Harness Launcher.app/Contents/Resources/DSHArchiveManager/cordis.patch.yml",
            "/Applications/DHL.app/Contents/Resources/DSHArchiveManager/cordis.patch.yml",
            "\(home)/Applications/DHL.app/Contents/Resources/DSHArchiveManager/cordis.patch.yml",
            "/Applications/DSH.app/Contents/Resources/DSHArchiveManager/cordis.patch.yml",
            "\(home)/Applications/DSH.app/Contents/Resources/DSHArchiveManager/cordis.patch.yml"
        ]
        return output.split(whereSeparator: \.isNewline).compactMap { line in
            let fields = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
            guard fields.count == 3, let pid = Int32(fields[0]), fields[1].first != "Z" else { return nil }
            let command = String(fields[2])
            let executable = command.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true).first.map(String.init) ?? ""
            let isLauncher = command == launcherPath || command.hasPrefix(launcherPath + " ") ||
                executable.hasSuffix("/DHL.app/Contents/MacOS/DHL") || executable.hasSuffix("/DSH.app/Contents/MacOS/DSH")
            if isLauncher { return pid }
            if ["npm", "node", "/usr/local/bin/npm", "/usr/local/bin/node", "/opt/homebrew/bin/npm", "/opt/homebrew/bin/node"].contains(executable) && managedPatches.contains(where: command.contains) { return pid }
            return nil
        }
    }

    private func terminateProcessGroup(pid: Int32) {
        func signal(_ value: Int32) {
            _ = Darwin.kill(-pid, value)
            _ = Darwin.kill(pid, value)
        }
        func exited() -> Bool {
            let groupAlive = Darwin.kill(-pid, 0) == 0
            let processAlive = Darwin.kill(pid, 0) == 0
            return !groupAlive && !processAlive
        }
        signal(SIGTERM)
        for _ in 0..<20 {
            if exited() { return }
            usleep(100_000)
        }
        appendLogString("\(LauncherBrand.fullName) 未在宽限期内退出，执行强制终止\n")
        signal(SIGKILL)
        for _ in 0..<20 {
            if exited() { return }
            usleep(100_000)
        }
        appendLogString("无法确认 \(LauncherBrand.fullName) 进程组已退出\n")
    }

    @objc private func openLogs() { NSWorkspace.shared.open(logURL) }
    @objc private func openSettings() {
        if settingsWindow == nil {
            settingsWindow = SettingsWindowController(onSave: { [weak self] in self?.scheduleAutoUpdateChecks() }, onCheckNow: { [weak self] in self?.performUpdateCheck(interactive: true) })
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.present()
    }

    @objc private func checkForUpdates() {
        if let pendingUpdate { presentUpdate(manifest: pendingUpdate); return }
        performUpdateCheck(interactive: true)
    }

    private var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    private func scheduleAutoUpdateChecks() {
        autoUpdateTimer?.invalidate(); autoUpdateTimer = nil
        guard settings.autoUpdateEnabled else {
            setUpdateMenuTitle("检查更新")
            return
        }
        let interval = settings.updateIntervalHours * 3600
        autoUpdateTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            self?.performUpdateCheck(interactive: false)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            self?.performUpdateCheck(interactive: false)
        }
    }

    private func performUpdateCheck(interactive: Bool) {
        guard !updateCheckInFlight else { return }
        updateCheckInFlight = true
        if interactive { setUpdateMenuTitle("正在检查更新…") }
        updateService.check(currentVersion: currentVersion) { [weak self] result in
            guard let self else { return }
            self.updateCheckInFlight = false
            switch result {
            case .available(let manifest):
                self.pendingUpdate = manifest
                self.setUpdateMenuTitle("更新可用：v\(manifest.version)")
                if interactive { self.presentUpdate(manifest: manifest) }
            case .current:
                self.pendingUpdate = nil
                self.setUpdateMenuTitle("检查更新")
                if interactive { self.showInfo(title: "已是最新版本", message: "当前版本：v\(self.currentVersion)") }
            case .noPublishedRelease:
                self.pendingUpdate = nil
                self.setUpdateMenuTitle("检查更新")
                if interactive { self.showInfo(title: "暂无可用更新", message: "项目暂未发布可下载安装的 \(LauncherBrand.fullName) 版本。") }
            case .failed(let message):
                self.setUpdateMenuTitle("检查更新")
                self.appendLogString("更新检查失败：\(message)\n")
                if interactive { self.showInfo(title: "检查更新失败", message: message) }
            }
        }
    }

    private func presentUpdate(manifest: UpdateManifest) {
        let alert = NSAlert()
        alert.messageText = "发现 \(LauncherBrand.fullName) 新版本 v\(manifest.version)"
        alert.informativeText = manifest.notes?.isEmpty == false ? manifest.notes! : "下载更新包后，在 Finder 中打开并安装。"
        alert.addButton(withTitle: "下载更新")
        alert.addButton(withTitle: "稍后")
        if alert.runModal() == .alertFirstButtonReturn { downloadUpdate(manifest) }
    }

    private func downloadUpdate(_ manifest: UpdateManifest) {
        setUpdateMenuTitle("正在下载更新…")
        updateService.download(manifest) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let url):
                self.setUpdateMenuTitle("更新可用：v\(manifest.version)")
                let alert = NSAlert()
                alert.messageText = "更新包已下载"
                alert.informativeText = "是否立即安装 v\(manifest.version) 并重启 \(LauncherBrand.fullName)？当前后台进程会先关闭，安装完成后重新启动。"
                alert.addButton(withTitle: "安装并重启")
                alert.addButton(withTitle: "稍后安装")
                if alert.runModal() == .alertFirstButtonReturn {
                    self.installUpdateAndRestart(url)
                } else {
                    NSWorkspace.shared.activateFileViewerSelecting([url])
                }
            case .failure(let error):
                self.setUpdateMenuTitle("更新可用：v\(manifest.version)")
                self.showInfo(title: "下载更新失败", message: error.localizedDescription)
            }
        }
    }

    private func installUpdateAndRestart(_ dmgURL: URL) {
        appendLogString("用户确认安装更新：\(dmgURL.path)\n")
        stopDHL()
        let appURL = Bundle.main.bundleURL
        let appDirectory = appURL.deletingLastPathComponent()
        let pid = ProcessInfo.processInfo.processIdentifier
        let quote: (String) -> String = { value in "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let script = """
        set -e
        DMG=\(quote(dmgURL.path))
        APP=\(quote(appURL.path))
        DEST=\(quote(appDirectory.path))
        TARGET=\(quote(appDirectory.appendingPathComponent("Deepseek Harness Launcher.app").path))
        PID=\(pid)
        for i in {1..100}; do
          kill -0 "$PID" 2>/dev/null || break
          sleep 0.1
        done
        MOUNT="$(mktemp -d "${TMPDIR:-/tmp}/dhl-update.XXXXXX")"
        cleanup() { hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true; rmdir "$MOUNT" >/dev/null 2>&1 || true; }
        trap cleanup EXIT
        hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" >/dev/null
        test -d "$MOUNT/.Deepseek Harness Launcher-payload.app"
        if [[ "$APP" != "$TARGET" && -e "$APP" ]]; then
          OLD_BACKUP="$DEST/DHL.app.backup-$(date +%Y%m%d-%H%M%S)"
          mv "$APP" "$OLD_BACKUP"
        fi
        if [[ -e "$TARGET" ]]; then
          BACKUP="$DEST/Deepseek Harness Launcher.app.backup-$(date +%Y%m%d-%H%M%S)"
          mv "$TARGET" "$BACKUP"
        fi
        ditto "$MOUNT/.Deepseek Harness Launcher-payload.app" "$TARGET"
        open "$TARGET"
        """
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/zsh")
        task.arguments = ["-c", script]
        task.standardInput = FileHandle.nullDevice
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            NSApp.terminate(nil)
        } catch {
            showInfo(title: "启动更新助手失败", message: error.localizedDescription)
        }
    }

    private func showInfo(title: String, message: String) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.addButton(withTitle: "好"); alert.runModal()
    }

    @objc private func quit() { NSApp.terminate(nil) }

    private func start() {
        if state == .checking { return }
        if state == .running { openDHL(); return }
        setState(.checking)
        DispatchQueue.global(qos: .userInitiated).async {
            let choice = self.findPort()
            DispatchQueue.main.async {
                guard let choice else { self.fail("3080–3099 均不可用"); return }
                switch choice {
                case .reuse(let port):
                    self.selectedPort = port
                    self.setState(.running)
                    self.monitorArchivePlugin(port: port)
                    if self.settings.openBrowserOnReady && !self.didOpenBrowser { self.didOpenBrowser = true; self.openDHL() }
                case .launch(let port):
                    self.launch(port: port)
                }
            }
        }
    }

    private func findPort() -> PortChoice? {
        for port in basePort...maxPort {
            if dshResponds(on: port) { return .reuse(port) }
            if canBind(port: port) { return .launch(port) }
        }
        return nil
    }

    private func dshResponds(on port: Int) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/"), let data = try? Data(contentsOf: url), let body = String(data: data, encoding: .utf8) else { return false }
        return body.localizedCaseInsensitiveContains("DeepSeek Harness")
    }

    private func dshHasArchivePlugin(on port: Int) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/dsh-archive-manager/archives"), let data = try? Data(contentsOf: url), let body = String(data: data, encoding: .utf8) else { return false }
        return body.contains("items")
    }

    private func canBind(port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0); guard fd >= 0 else { return false }; defer { close(fd) }
        var reuse: Int32 = 1
        _ = withUnsafePointer(to: &reuse) { pointer in
            setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, pointer, socklen_t(MemoryLayout<Int32>.size))
        }
        var address = sockaddr_in(); address.sin_family = sa_family_t(AF_INET); address.sin_port = in_port_t(port).bigEndian; address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        return withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 } }
    }

    private func launch(port: Int) {
        ensurePluginLink()
        let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        let arguments = [
            "npx", "--prefer-offline", "--yes", "@deepseek-ai/dsh",
            "--profile", "web",
            "--patch", patchPath,
            "--no-open",
            "--port", String(port)
        ]
        task.arguments = arguments
        task.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        var env = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let launchPaths = [
            "\(home)/opt/node/bin",
            "\(home)/.volta/bin",
            "\(home)/.nvm/current/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin"
        ]
        env["PATH"] = (launchPaths + [env["PATH"] ?? "/usr/bin:/bin"]).joined(separator: ":")
        env["npm_config_prefer_offline"] = "true"
        env["npm_config_audit"] = "false"
        env["npm_config_fund"] = "false"
        task.environment = env

        let stdoutPipe = Pipe(); let stderrPipe = Pipe()
        task.standardOutput = stdoutPipe; task.standardError = stderrPipe
        stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil } else { self?.appendLog(data, prefix: "stdout") }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil } else { self?.appendLog(data, prefix: "stderr") }
        }

        let command = arguments.joined(separator: " ")
        appendLogString("启动命令：\(command)\n")
        task.terminationHandler = { [weak self] terminatedProcess in
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            let remainingOut = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            let remainingErr = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            if !remainingOut.isEmpty { self?.appendLog(remainingOut, prefix: "stdout") }
            if !remainingErr.isEmpty { self?.appendLog(remainingErr, prefix: "stderr") }
            self?.appendLogString("\(LauncherBrand.fullName) 进程退出：code=\(terminatedProcess.terminationStatus), reason=\(terminatedProcess.terminationReason.rawValue)\n")
            DispatchQueue.main.async {
                guard let self, self.state != .stopped else { return }
                self.process = nil
                self.selectedPort = nil
                self.pollTimer?.invalidate(); self.pollTimer = nil
                self.fail("\(LauncherBrand.fullName) 进程已退出，请查看日志")
            }
        }
        do {
            try task.run()
            process = task; selectedPort = port; didOpenBrowser = false; pollUntilReady(port: port)
        } catch {
            fail("无法启动 npx：\(error.localizedDescription)")
        }
    }

    private func ensurePluginLink() {
        let profile = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh/profiles/web/node_modules", isDirectory: true)
        if !ensureArchivePluginLink(pluginURL: pluginURL, profileURL: profile) {
            appendLogString("无法更新归档增强插件链接，保留现有插件配置\n")
        }
    }

    private func pollUntilReady(port: Int) {
        var attempts = 0
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }; attempts += 1
            if self.dshResponds(on: port) {
                timer.invalidate()
                self.setState(.running)
                self.monitorArchivePlugin(port: port)
                    if self.settings.openBrowserOnReady && !self.didOpenBrowser { self.didOpenBrowser = true; self.openDHL() }
            } else if attempts >= 100 {
                timer.invalidate()
                self.fail("\(LauncherBrand.fullName) 启动超时，请查看日志")
            }
        }
    }

    private func monitorArchivePlugin(port: Int) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            for _ in 0..<40 {
                if self?.dshHasArchivePlugin(on: port) == true {
                    DispatchQueue.main.async { [weak self] in self?.appendLogString("归档增强插件已就绪\n") }
                    return
                }
                Thread.sleep(forTimeInterval: 0.25)
            }
            DispatchQueue.main.async { [weak self] in self?.appendLogString("归档增强插件不可用，\(LauncherBrand.fullName) 将以基础模式运行\n") }
        }
    }

    private func appendLog(_ data: Data, prefix: String? = nil) {
        if let prefix { appendLogString("[\(formatLogTimestamp())] [\(prefix)] ", includeTimestamp: false) }
        logLock.lock(); defer { logLock.unlock() }
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
        guard let handle = try? FileHandle(forWritingTo: logURL) else { return }
        defer { try? handle.close() }
        do {
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } catch {
            // Logging must never interrupt the launcher lifecycle.
        }
    }

    private func appendLogString(_ text: String, includeTimestamp: Bool = true) {
        let value = includeTimestamp ? "[\(formatLogTimestamp())] \(text)" : text
        appendLog(Data(value.utf8))
    }

    private func setState(_ next: LauncherState) {
        state = next
        statusItem.button?.image = makeStatusImage()
        let portTitle = selectedPort.map { "端口：\($0)" } ?? "端口：未运行"
        statusItem.menu?.item(withTag: 1001)?.title = portTitle
        portMenuRow?.title = portTitle
    }

    private func fail(_ message: String) {
        appendLogString("\(message)\n"); setState(.failed)
        let alert = NSAlert(); alert.messageText = "\(LauncherBrand.fullName) 启动失败"; alert.informativeText = message; alert.alertStyle = .warning; alert.addButton(withTitle: "打开日志"); alert.addButton(withTitle: "关闭")
        if alert.runModal() == .alertFirstButtonReturn { openLogs() }
    }

    private func makeStatusImage() -> NSImage {
        // 基于上游 deepseek-harness-desktop 的菜单栏图标（干净单 path 剪影），
        // 作为 template 接入：深色菜单栏自动显示为白色、浅色为黑色。
        guard let url = Bundle.main.url(forResource: "menubar-creature", withExtension: "png"),
              let image = NSImage(contentsOf: url) else {
            return NSImage(size: NSSize(width: 18, height: 18))
        }
        image.size = NSSize(width: 20, height: 20)
        image.isTemplate = true
        return image
    }
}

let app = NSApplication.shared; let delegate = DHLLauncher(); app.delegate = delegate; app.run()
