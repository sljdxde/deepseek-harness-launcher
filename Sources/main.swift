import AppKit
import Foundation
import Darwin

private enum LauncherState { case stopped, checking, running, failed }
private enum PortChoice { case reuse(Int), launch(Int) }
private enum DSHInstallMode { case firstInstall, upgrade, repair }

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
    // Only guards the automatic open that happens when the backend becomes ready.
    // Manual menu clicks must always be allowed to open a fresh browser page.
    private var didAutoOpenBrowser = false
    private var openWhenReady = false
    private var autoUpdateTimer: Timer?
    private var settingsWindow: SettingsWindowController?
    private var pendingUpdate: UpdateManifest?
    private var updateCheckInFlight = false
    private var updateMenuItem: NSMenuItem?
    private var updateMenuRow: MenuRowView?
    private var dshUpdateMenuItem: NSMenuItem?
    private var dshUpdateMenuRow: MenuRowView?
    private var portMenuRow: MenuRowView?
    private var dshInstallWindow: DSHInstallWindowController?
    private var dshInstallHandle: DSHRuntimeInstallHandle?
    private var dshInstallProgressTracker: DSHInstallProgressTracker?
    private var terminateAfterDSHInstall = false
    private let settings = LauncherSettings.shared
    private let updateService = UpdateService()
    private let dshUpdateService = DSHVersionService()
    private var dshUpdateCheckInFlight = false
    private let logLock = NSLock()
    private lazy var globalHotKeyManager = GlobalHotKeyManager { [weak self] in
        self?.openDHL()
    }
    private let basePort = 3080
    private let maxPort = 3099

    private var rootURL: URL { URL(fileURLWithPath: FileManager.default.currentDirectoryPath).deletingLastPathComponent().appendingPathComponent("deepseek-harness-launcher") }
    private var pluginURL: URL { Bundle.main.resourceURL?.appendingPathComponent("DSHArchiveManager") ?? rootURL.appendingPathComponent("Plugins/DSHArchiveManager") }
    private var pluginManagerURL: URL { Bundle.main.resourceURL?.appendingPathComponent("DSHPluginManager") ?? rootURL.appendingPathComponent("Plugins/DSHPluginManager") }
    private var bundledPlugins: [BundledPlugin] {
        [
            BundledPlugin(linkName: "dsh-archive-manager", bundleMarker: "DSHArchiveManager", url: pluginURL),
            BundledPlugin(linkName: "dsh-plugin-manager", bundleMarker: "DSHPluginManager", url: pluginManagerURL)
        ]
    }
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
        NSApp.setActivationPolicy(.accessory); configureStatusItem(); applyGlobalHotKey(showAlert: false); start(); scheduleAutoUpdateChecks(); scheduleDSHUpdateCheck()
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
        let open = menuRowItem(title: "打开 Deepseek Harness", action: #selector(openDHL), keyEquivalent: "o")
        let port = menuRowItem(title: "端口：未运行", action: nil, enabled: { false }); port.tag = 1001
        portMenuRow = port.view as? MenuRowView
        let update = menuRowItem(title: "检查更新", action: #selector(checkForUpdates))
        update.tag = 1002; updateMenuItem = update; updateMenuRow = update.view as? MenuRowView
        let dshUpdate = menuRowItem(title: "检查 dsh 更新", action: #selector(checkDSHForUpdates))
        dshUpdate.tag = 1003; dshUpdateMenuItem = dshUpdate; dshUpdateMenuRow = dshUpdate.view as? MenuRowView
        let settingsItem = makeSettingsMenuItem()
        let logs = menuRowItem(title: "打开日志", action: #selector(openLogs), keyEquivalent: "l")
        let quit = menuRowItem(title: "退出 Deepseek Harness", action: #selector(quit), keyEquivalent: "q")
        [open, port, NSMenuItem.separator(), update, dshUpdate, settingsItem, logs, quit].forEach(menu.addItem)
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

    private func setDSHUpdateMenuTitle(_ title: String) {
        dshUpdateMenuItem?.title = title
        dshUpdateMenuRow?.title = title
    }

    private func scheduleDSHUpdateCheck() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.performDSHUpdateCheck(interactive: false)
        }
    }

    @objc private func checkDSHForUpdates() {
        performDSHUpdateCheck(interactive: true)
    }

    private func performDSHUpdateCheck(interactive: Bool) {
        guard DSHRuntimeSupport.isInstalled() else {
            setDSHUpdateMenuTitle("检查 dsh 更新")
            return
        }
        guard !dshUpdateCheckInFlight else { return }
        dshUpdateCheckInFlight = true
        if interactive { setDSHUpdateMenuTitle("正在检查 dsh 更新…") }
        dshUpdateService.check { [weak self] result in
            guard let self else { return }
            self.dshUpdateCheckInFlight = false
            switch result {
            case .available(let current, let latest):
                self.setDSHUpdateMenuTitle("dsh 更新可用：v\(latest)")
                if interactive { self.presentDSHUpdate(current: current, latest: latest) }
            case .current(let version):
                self.setDSHUpdateMenuTitle("检查 dsh 更新")
                if interactive { self.showInfo(title: "dsh 已是最新版本", message: "当前版本：v\(version)") }
            case .failed(let message):
                self.setDSHUpdateMenuTitle("检查 dsh 更新")
                self.appendLogString("dsh 更新检查失败：\(message)\n")
                if interactive { self.showInfo(title: "检查 dsh 更新失败", message: message) }
            }
        }
    }

    private func presentDSHUpdate(current: String, latest: String) {
        let alert = NSAlert()
        alert.messageText = "发现 dsh 新版本 v\(latest)"
        alert.informativeText = "当前使用 v\(current)。dsh 随 App 内置：更新 \(LauncherBrand.fullName) 到包含 v\(latest) 的版本后，下次启动会自动完成低内存升级。也可前往 npm 查看更新说明。"
        alert.addButton(withTitle: "打开 npm")
        alert.addButton(withTitle: "关闭")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(URL(string: "https://www.npmjs.com/package/@deepseek-ai/dsh")!)
        }
    }

    @objc private func openDHL() {
        if let installWindow = dshInstallWindow {
            openWhenReady = true
            installWindow.present()
            return
        }
        guard state == .running, let port = selectedPort else {
            openWhenReady = true
            if state == .stopped || state == .failed { start() }
            return
        }
        openWebPage(on: port)
    }

    private func openBrowserWhenReadyIfNeeded() {
        guard !didAutoOpenBrowser, settings.openBrowserOnReady || openWhenReady else { return }
        didAutoOpenBrowser = true
        openWhenReady = false
        guard state == .running, let port = selectedPort else { return }
        openWebPage(on: port)
    }

    private func openWebPage(on port: Int) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.open(url, configuration: configuration) { [weak self] _, error in
            guard let error else { return }
            DispatchQueue.main.async {
                self?.appendLogString("打开 DeepSeek Harness Web 页面失败：\(error.localizedDescription)\n")
            }
        }
    }

    private func focusExistingBrowserTab(for url: URL) -> Bool {
        let supportedBrowserIDs = [
            "com.google.chrome",
            "com.apple.safari",
            "com.microsoft.edgemac",
            "com.brave.browser",
            "company.thebrowser.browser",
            "com.vivaldi.vivaldi",
            "com.operasoftware.opera",
            "org.chromium.chromium",
            "com.apple.safaritechnologypreview"
        ]
        var browserIDs = NSWorkspace.shared.runningApplications
            .compactMap(\.bundleIdentifier)
            .filter { supportedBrowserIDs.contains($0.lowercased()) }
        if let defaultAppURL = NSWorkspace.shared.urlForApplication(toOpen: url),
           let defaultBundleID = Bundle(url: defaultAppURL)?.bundleIdentifier,
           supportedBrowserIDs.contains(defaultBundleID.lowercased()),
           !browserIDs.contains(where: { $0.caseInsensitiveCompare(defaultBundleID) == .orderedSame }) {
            browserIDs.append(defaultBundleID)
        }
        for bundleID in browserIDs {
            guard let script = browserFocusScript(for: bundleID, url: url) else { continue }
            var error: NSDictionary?
            if let result = NSAppleScript(source: script)?.executeAndReturnError(&error), result.booleanValue {
                return true
            }
        }
        return false
    }

    private func browserFocusScript(for bundleID: String, url: URL) -> String? {
        let absoluteURL = url.absoluteString
        let targetURL = absoluteURL.hasSuffix("/") ? String(absoluteURL.dropLast()) : absoluteURL
        let safeTargetURL = targetURL.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        switch bundleID.lowercased() {
        case "com.google.chrome", "com.microsoft.edgemac", "com.brave.browser", "com.operasoftware.opera", "org.chromium.chromium", "com.vivaldi.vivaldi", "company.thebrowser.browser":
            return """
            tell application id "\(bundleID)"
                activate
                set targetURL to "\(safeTargetURL)"
                repeat with w in windows
                    repeat with i from 1 to (count of tabs of w)
                        set t to tab i of w
                        try
                            set tabURL to (URL of t) as text
                            if tabURL is targetURL or tabURL starts with (targetURL & "/") or tabURL starts with (targetURL & "?") then
                                set active tab index of w to i
                                set index of w to 1
                                return true
                            end if
                        end try
                    end repeat
                end repeat
                return false
            end tell
            """
        case "com.apple.safari", "com.apple.safaritechnologypreview":
            return """
            tell application id "\(bundleID)"
                activate
                set targetURL to "\(safeTargetURL)"
                repeat with w in windows
                    repeat with t in tabs of w
                        try
                            set tabURL to (URL of t) as text
                            if tabURL is targetURL or tabURL starts with (targetURL & "/") or tabURL starts with (targetURL & "?") then
                                set current tab of w to t
                                set index of w to 1
                                return true
                            end if
                        end try
                    end repeat
                end repeat
                return false
            end tell
            """
        default:
            return nil
        }
    }

    private func stopDHL(completion: (() -> Void)? = nil) {
        cancelDSHInstall()
        let trackedPID = process?.processIdentifier ?? 0
        process = nil; selectedPort = nil; didAutoOpenBrowser = false; openWhenReady = false; setState(.stopped)
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var pids = self?.managedDSHPIDs() ?? []
            if trackedPID > 0 && !pids.contains(trackedPID) { pids.insert(trackedPID, at: 0) }
            for pid in pids { self?.terminateProcessGroup(pid: pid) }
            DispatchQueue.main.async {
                completion?()
            }
        }
    }

    private func managedDSHPIDs() -> [Int32] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-axo", "pid=,state=,command="]
        let pipe = Pipe(); task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
        do { try task.run() } catch { return [] }
        // ps output can exceed the 64KB pipe buffer; waiting before draining
        // deadlocks (ps blocks on write, waitUntilExit never returns).
        let outputData = pipe.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        guard let output = String(data: outputData, encoding: .utf8) else { return [] }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let runtimeDSH = DSHRuntimeSupport.executableURL.path
        let runtimeRoot = DSHRuntimeSupport.runtimeURL.path
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
            let isInstalledDSH = executable == runtimeDSH ||
                (command.contains(runtimeRoot) && managedPatches.contains(where: command.contains))
            let isRuntimeInstallProcess = command.contains("\(home)/.dsh/runtime.installing-") &&
                ["npm", "node", "/usr/local/bin/npm", "/usr/local/bin/node", "/opt/homebrew/bin/npm", "/opt/homebrew/bin/node"].contains(executable)
            if isInstalledDSH { return pid }
            if isRuntimeInstallProcess { return pid }
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
            settingsWindow = SettingsWindowController(
                onSave: { [weak self] in
                    guard let self else { return false }
                    let applied = self.applyGlobalHotKey()
                    self.scheduleAutoUpdateChecks()
                    return applied
                },
                onCheckNow: { [weak self] in self?.performUpdateCheck(interactive: true) }
            )
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.present()
    }

    @discardableResult
    private func applyGlobalHotKey(showAlert: Bool = true) -> Bool {
        let applied = globalHotKeyManager.apply(
            enabled: settings.globalHotKeyEnabled,
            modifiers: settings.globalHotKeyModifiers,
            keyCode: settings.globalHotKeyKeyCode
        )
        if !applied {
            appendLogString("全局快捷键注册失败：\(settings.globalHotKeyDisplay)\n")
            if showAlert {
                showInfo(title: "全局快捷键冲突", message: "\(settings.globalHotKeyDisplay) 已被其他应用占用，请在设置中更换。")
            }
        }
        return applied
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
        if dshInstallHandle != nil {
            showInfo(title: "正在安装 dsh", message: "首次安装尚未完成，请等待安装结束后再更新 Deepseek Harness Launcher。")
            return
        }
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

    @objc private func quit() {
        if dshInstallHandle != nil {
            terminateAfterDSHInstall = true
            cancelDSHInstall()
            return
        }
        stopDHL { NSApp.terminate(nil) }
    }

    private func start() {
        if dshInstallHandle != nil { return }
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
                    self.openBrowserWhenReadyIfNeeded()
                case .launch(let port):
                    self.launch(port: port)
                }
            }
        }
    }

    private func findPort() -> PortChoice? {
        for port in basePort...maxPort {
            if canBind(port: port) { return .launch(port) }
            if dshResponds(on: port) { return .reuse(port) }
        }
        return nil
    }

    private func dshResponds(on port: Int) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/"), let body = ServiceProbe.body(at: url) else { return false }
        return isHarnessWebBody(body)
    }

    private func isHarnessWebBody(_ body: String) -> Bool {
        // The Web UI HTML does not reliably contain the product title; use
        // stable DeepSeek/dsh asset markers instead.
        return body.localizedCaseInsensitiveContains("deepseek") &&
            body.localizedCaseInsensitiveContains("dsh")
    }

    private func dshHasArchivePlugin(on port: Int) -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/dsh-archive-manager/archives"), let body = ServiceProbe.body(at: url) else { return false }
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
        let environment = LauncherEnvironment.nodeEnvironment(preferOffline: false)
        guard let npmPath = LauncherEnvironment.executablePath(named: "npm", environment: environment) else {
            fail("未找到 npm。请先安装 Node.js（包含 npm），或把 Node 加入标准安装路径后重试")
            return
        }
        if DSHRuntimeSupport.isInstalled() {
            // 新版本 App 自带更新的 dsh 锁定文件时，用 npm ci 做一次低内存更新
            if DSHRuntimeSupport.needsRuntimeUpgrade(environment: environment) {
                beginDSHInstall(port: port, npmPath: npmPath, environment: environment, mode: .upgrade)
                return
            }
            launchInstalledDSH(port: port, executableURL: DSHRuntimeSupport.executableURL, environment: environment)
            return
        }
        // runtime 缺失但本机已安装/使用过 DeepSeek Harness（profile 或依赖树存在）：
        // 这不是首次安装，而是运行环境被清理或损坏，应在保留会话/归档/插件数据
        // 的前提下重建 runtime，避免误导性的「首次安装」引导。
        if DSHRuntimeSupport.hasHarnessInstall() {
            let alert = NSAlert()
            alert.messageText = "检测到已有 DeepSeek Harness 安装"
            alert.informativeText = "本机已检测到 DeepSeek Harness 数据，但运行环境缺失，将重新安装运行环境（不影响你的会话、归档与插件数据）。启动器会优先尝试更快的镜像，失败后自动回退到官方源。"
            alert.alertStyle = .informational
            alert.addButton(withTitle: "重新安装")
            alert.addButton(withTitle: "取消")
            guard alert.runModal() == .alertFirstButtonReturn else {
                setState(.stopped)
                return
            }
            beginDSHInstall(port: port, npmPath: npmPath, environment: environment, mode: .repair)
            return
        }
        let alert = NSAlert()
        alert.messageText = "首次安装 dsh"
        alert.informativeText = "首次安装会下载较多 npm 依赖，可能需要几分钟。启动器会优先尝试更快的镜像，失败后自动回退到官方源。"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "开始安装")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else {
            setState(.stopped)
            return
        }
        beginDSHInstall(port: port, npmPath: npmPath, environment: environment, mode: .firstInstall)
    }

    private func beginDSHInstall(port: Int, npmPath: String, environment: [String: String], mode: DSHInstallMode) {
        let isUpgrade = mode == .upgrade
        let isRepair = mode == .repair
        if isUpgrade {
            setPortMenuTitle("正在更新 dsh（可能需要几分钟）…")
            appendLogString("检测到新版本 dsh，开始低内存更新（npm ci，按锁定版本）…\n")
        } else if isRepair {
            setPortMenuTitle("正在修复 dsh 运行环境…")
            appendLogString("检测到已有 DeepSeek Harness 数据但运行环境缺失，开始重建 runtime（npm ci，保留用户数据）…\n")
        } else {
            setPortMenuTitle("正在安装 dsh（首次可能需要几分钟）…")
            appendLogString("本地未检测到 DeepSeek Harness，开始执行下载安装。官方命令：npx @deepseek-ai/dsh web\n")
        }
        let installWindow = DSHInstallWindowController(commandText: isUpgrade ? "更新命令：npm ci（锁定版本）" : isRepair ? "重建运行环境：npm ci（锁定版本）" : "安装命令：npx @deepseek-ai/dsh web") { [weak self] in
            self?.cancelDSHInstall()
        }
        dshInstallWindow = installWindow
        dshInstallProgressTracker = DSHInstallProgressTracker()
        installWindow.present()
        installWindow.update(
            status: isUpgrade ? "检测到新的 dsh 版本" : isRepair ? "检测到已有 dsh 数据，正在重建运行环境" : "本地未检测到 DeepSeek Harness",
            detail: isUpgrade ? "正在更新 runtime，请保持网络连接。" : isRepair ? "正在重建 runtime，你的会话、归档与插件数据不会受影响。" : "正在执行下载安装，请保持网络连接。",
            percentage: nil
        )
        dshInstallHandle = DSHRuntimeSupport.install(npmPath: npmPath, environment: environment, force: isUpgrade || isRepair, onOutput: { [weak self, weak installWindow] text in
            self?.appendLog(Data(text.utf8), prefix: "npm")
            guard let self else { return }
            let snapshot = self.dshInstallProgressTracker?.consume(text)
            DispatchQueue.main.async {
                installWindow?.update(
                    status: isUpgrade ? "正在更新 dsh…" : isRepair ? "正在重建运行环境…" : "正在安装 dsh…",
                    detail: snapshot?.detail,
                    percentage: snapshot?.percentage
                )
            }
        }) { [weak self, weak installWindow] result in
            guard let self else { return }
            self.dshInstallHandle = nil
            self.dshInstallProgressTracker = nil
            installWindow?.dismiss()
            self.dshInstallWindow = nil
            switch result {
            case .success(let executableURL):
                guard self.state != .stopped else { return }
                self.appendLogString("dsh runtime 安装完成，开始启动…\n")
                self.launchInstalledDSH(port: self.selectedPort ?? port, executableURL: executableURL, environment: environment)
            case .failure(let error):
                self.openWhenReady = false
                if case .cancelled = error as? DSHRuntimeError {
                    self.appendLogString(isUpgrade ? "dsh 更新已取消，原 runtime 保持不变\n" : isRepair ? "dsh 运行环境重建已取消，用户数据保持不变\n" : "dsh 首次安装已取消，临时安装目录已清理\n")
                } else if self.state != .stopped {
                    self.showDSHInstallFailure(error)
                }
            }
            if self.terminateAfterDSHInstall {
                self.terminateAfterDSHInstall = false
                NSApp.terminate(nil)
            }
        }
    }

    private func cancelDSHInstall() {
        guard dshInstallHandle != nil else { return }
        dshInstallWindow?.markCancelling()
        dshInstallHandle?.cancel()
        appendLogString("用户取消 dsh 安装，临时安装目录将被清理\n")
        if state == .checking { setState(.stopped) }
    }

    private func launchInstalledDSH(port: Int, executableURL: URL, environment: [String: String]) {
        let task = Process(); task.executableURL = executableURL
        let arguments = [
            "web",
            "--patch", patchPath,
            "--no-open",
            "--port", String(port)
        ]
        task.arguments = arguments
        task.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        task.environment = environment

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

        let command = ([executableURL.path] + arguments).joined(separator: " ")
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
                self.fail("\(LauncherBrand.fullName) 进程已退出，请查看日志")
            }
        }
        do {
            try task.run()
            process = task; selectedPort = port; didAutoOpenBrowser = false; pollUntilReady(port: port, startedAt: Date())
        } catch {
            fail("无法启动 dsh：\(error.localizedDescription)")
        }
    }

    private func ensurePluginLink() {
        let profiles = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".dsh/profiles", isDirectory: true)
        let locations = [
            profiles.appendingPathComponent("node_modules", isDirectory: true),
            profiles.appendingPathComponent("web/node_modules", isDirectory: true)
        ]
        if !ensureBundledPluginLinks(plugins: bundledPlugins, profileURLs: locations) {
            appendLogString("无法更新内置插件链接，保留现有插件配置\n")
        }
    }

    private func pollUntilReady(port: Int, startedAt: Date) {
        guard process?.isRunning == true else { return }
        let elapsed = Date().timeIntervalSince(startedAt)
        // A cold dsh runtime bootstrap can still take several minutes. Do not
        // mistake that startup phase for a dead Harness process.
        guard elapsed < 10 * 60 else {
            terminateProcessGroup(pid: process?.processIdentifier ?? 0)
            fail("\(LauncherBrand.fullName) 启动超过 10 分钟，请检查网络和日志")
            return
        }
        if Int(elapsed) > 0 && Int(elapsed) % 30 == 0 {
            setPortMenuTitle("正在安装或启动 dsh（已等待 \(Int(elapsed)) 秒）…")
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        ServiceProbe.body(at: url) { [weak self] body in
            guard let self, self.state != .stopped else { return }
            if let body, self.isHarnessWebBody(body) {
                self.setState(.running)
                self.monitorArchivePlugin(port: port)
                self.openBrowserWhenReadyIfNeeded()
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    self.pollUntilReady(port: port, startedAt: startedAt)
                }
            }
        }
    }

    private func monitorArchivePlugin(port: Int, attempts: Int = 0) {
        guard attempts < 40 else {
            appendLogString("归档增强插件不可用，\(LauncherBrand.fullName) 将以基础模式运行\n")
            return
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/dsh-archive-manager/archives") else { return }
        ServiceProbe.body(at: url) { [weak self] body in
            guard let self, self.state != .stopped else { return }
            if body?.contains("items") == true {
                self.appendLogString("归档增强插件已就绪\n")
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.monitorArchivePlugin(port: port, attempts: attempts + 1)
            }
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
        setPortMenuTitle(portTitle)
    }

    private func setPortMenuTitle(_ title: String) {
        statusItem.menu?.item(withTag: 1001)?.title = title
        portMenuRow?.title = title
    }

    private func fail(_ message: String) {
        openWhenReady = false
        appendLogString("\(message)\n"); setState(.failed)
        let alert = NSAlert(); alert.messageText = "\(LauncherBrand.fullName) 启动失败"; alert.informativeText = message; alert.alertStyle = .warning; alert.addButton(withTitle: "打开日志"); alert.addButton(withTitle: "关闭")
        if alert.runModal() == .alertFirstButtonReturn { openLogs() }
    }

    private func showDSHInstallFailure(_ error: Error) {
        let command = "npx @deepseek-ai/dsh web"
        appendLogString("dsh 安装失败，建议手动执行：\(command)\n")
        setState(.failed)
        let alert = NSAlert()
        alert.messageText = "dsh 安装失败"
        alert.informativeText = "\(Self.summarizedInstallError(error.localizedDescription))\n\n如果 npm 持续下载失败，请在终端手动执行下面的官方命令，完成后重新打开 Deepseek Harness Launcher：\n\n\(command)"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "复制命令")
        alert.addButton(withTitle: "打开日志")
        alert.addButton(withTitle: "关闭")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(command, forType: .string)
        case .alertSecondButtonReturn:
            openLogs()
        default:
            break
        }
    }

    // npm failure output can be tens of thousands of characters; an alert that
    // tall pushes its buttons off-screen and wedges the app in runModal.
    private static func summarizedInstallError(_ text: String) -> String {
        guard text.count > 1500 else { return text }
        return "…（输出过长，仅保留末尾，完整内容请用「打开日志」查看）\n" + String(text.suffix(1500))
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
