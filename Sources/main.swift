import AppKit
import Foundation
import Darwin

private enum LauncherState { case stopped, checking, running, failed }
private enum PortChoice { case reuse(Int), launch(Int) }
private enum DSHInstallMode: Equatable { case firstInstall, upgrade, repair, dshUpdate(version: String) }

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

final class DHLLauncher: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private var process: Process?
    private var selectedPort: Int?
    private var state: LauncherState = .stopped
    // Only guards the automatic open that happens when the backend becomes ready.
    // Manual menu clicks must always be allowed to open a fresh browser page.
    private var didAutoOpenBrowser = false
    private var openWhenReady = false
    /// 重启 dsh 后待完成的一次「页面接管」：新进程就绪时把已打开的浏览器
    /// 标签页导航到新 token 入口。旧标签持有的是旧进程的认证，仅前置会
    /// 留下一张死页面，用户看来就像「重启没有生效」。
    private var relaunchingAfterRestart = false
    /// 菜单栏图标旁的短暂状态文案（如「正在重启…」/「已重启 ✓」）。
    /// 点击菜单项后菜单即关闭，反馈必须出现在菜单栏本身才能被看见；
    /// makeStatusImage 重建图标时按此保持 variableLength 不裁剪文案。
    private var statusTitleOverride: String?
    // 插件兼容性检查：代际号随停止/重启递增，让旧调度自灭（与轮询链同理）；
    // 已提示过的插件记入集合，避免同一次运行为同一插件反复弹窗。
    private var pluginCompatGeneration = 0
    private var pluginCompatAlerted = Set<String>()
    private var autoUpdateTimer: Timer?
    private var settingsWindow: SettingsWindowController?
    private var pendingUpdate: UpdateManifest?
    private var updateCheckInFlight = false
    private var updateDownloadInFlight = false
    private var updateDownloadWindow: UpdateDownloadWindowController?
    private var updateMenuItem: NSMenuItem?
    private var updateMenuRow: MenuRowView?
    private var dshUpdateMenuItem: NSMenuItem?
    private var dshUpdateMenuRow: MenuRowView?
    private var portMenuRow: MenuRowView?
    private var dshInstallWindow: DSHInstallWindowController?
    private var dshInstallHandle: DSHRuntimeInstallHandle?
    private var dshInstallProgressTracker: DSHInstallProgressTracker?
    private var terminateAfterDSHInstall = false
    // 会话完成提醒：内置 dsh-session-notify 插件把主会话 turn/end 记录在
    // Harness 侧，启动器轮询后以菜单栏角标（Foxmail 风格）+ 菜单区块呈现。
    private let sessionNotifyStore = SessionNotifyStore()
    private var sessionNotifyMenuItems: [NSMenuItem] = []
    private var sessionNotifyFailureStreak = 0
    private var sessionNotifyUnavailableLogged = false
    // dsh 重启瞬间（stop → start）可能同端口先后起两条轮询链，代际号让旧链自灭。
    private var sessionNotifyLoopID = 0
    // 插件更新提醒：内置 dsh-plugin-manager 提供 /dsh-plugin-manager/updates，
    // 启动器周期性读回可更新数量写进菜单；外部/旧实例没有该接口，静默降级。
    private var pluginUpdatesMenuItem: NSMenuItem?
    private var pluginUpdatesMenuRow: MenuRowView?
    private var pluginUpdatesLoopID = 0
    private var pluginUpdatesFailureStreak = 0
    private var pluginUpdatesUnavailableLogged = false
    private var pluginUpdatesAvailableCount = 0
    // 插件更新的进度窗口：与 dsh 安装共用 DSHInstallWindowController（同一套布局/
    // 进度条/已用时长），插件侧只换文案角色，保证三种更新的进度界面一致。
    private var pluginUpdateWindow: DSHInstallWindowController?
    private var pluginUpdateProgressActive = false
    private var pluginUpdateFinishedAt: String?
    private var pluginUpdateDismissScheduled = false
    // A notification can be clicked while dsh is still starting. Keep the
    // target until the Harness page and its client are ready.
    private var pendingSessionId: String?
    private var browserOpenInFlight = false
    private var lastBrowserOpenAt = Date.distantPast
    private var pendingBrowserOpenCompletions: [() -> Void] = []
    // dsh 0.1.5-rc.2 起 Web 首页需要 token 认证：进程启动时在 stdout 打印
    // `dsh web: http://127.0.0.1:<port>/?token=…`。打开浏览器必须用这个
    // 带 token 的入口 URL（首次访问换取绑定域名的 cookie）；旧版无 token，
    // 打印的 URL 同样可用。stdout 回调在后台线程，读写需持 webURLLock。
    private let webURLLock = NSLock()
    private var authenticatedWebURL: URL?
    private let settings = LauncherSettings.shared
    private let updateService = UpdateService()
    private let dshUpdateService = DSHVersionService()
    private var dshUpdateCheckInFlight = false
    // 最近一次检查的完整报告：菜单再次点击时直接进入更新确认，免二次联网检查。
    private var dshUpdateReport: DSHUpdateReport?
    private let logLock = NSLock()
    private lazy var globalHotKeyManager = GlobalHotKeyManager { [weak self] in
        self?.openDHL()
    }
    private let basePort = 3080
    private let maxPort = 3099

    private var rootURL: URL { URL(fileURLWithPath: FileManager.default.currentDirectoryPath).deletingLastPathComponent().appendingPathComponent("deepseek-harness-launcher") }
    private var pluginURL: URL { Bundle.main.resourceURL?.appendingPathComponent("DSHArchiveManager") ?? rootURL.appendingPathComponent("Plugins/DSHArchiveManager") }
    private var pluginManagerURL: URL { Bundle.main.resourceURL?.appendingPathComponent("DSHPluginManager") ?? rootURL.appendingPathComponent("Plugins/DSHPluginManager") }
    private var sessionNotifyPluginURL: URL { Bundle.main.resourceURL?.appendingPathComponent("DSHSessionNotify") ?? rootURL.appendingPathComponent("Plugins/DSHSessionNotify") }
    private var bundledPlugins: [BundledPlugin] {
        [
            BundledPlugin(linkName: "dsh-archive-manager", bundleMarker: "DSHArchiveManager", url: pluginURL),
            BundledPlugin(linkName: "dsh-plugin-manager", bundleMarker: "DSHPluginManager", url: pluginManagerURL),
            BundledPlugin(linkName: "dsh-session-notify", bundleMarker: "DSHSessionNotify", url: sessionNotifyPluginURL)
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
        statusItem.menu?.delegate = self
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        menu.showsStateColumn = false
        menu.autoenablesItems = false
        let open = menuRowItem(title: "打开 Deepseek Harness", action: #selector(openDHL), keyEquivalent: "o")
        let port = menuRowItem(title: "端口：未运行", action: nil, enabled: { false }); port.tag = 1001
        portMenuRow = port.view as? MenuRowView
        let restart = menuRowItem(title: "重启 Deepseek Harness", action: #selector(restartDSH), keyEquivalent: "r")
        let update = menuRowItem(title: "检测启动器（DHL）更新", action: #selector(checkForUpdates))
        update.tag = 1002; updateMenuItem = update; updateMenuRow = update.view as? MenuRowView
        let dshUpdate = menuRowItem(title: "检查 Deepseek Harness 更新", action: #selector(checkDSHForUpdates))
        dshUpdate.tag = 1003; dshUpdateMenuItem = dshUpdate; dshUpdateMenuRow = dshUpdate.view as? MenuRowView
        let pluginUpdates = menuRowItem(title: "插件管理", action: #selector(openPluginManager))
        pluginUpdates.tag = 1004; pluginUpdatesMenuItem = pluginUpdates; pluginUpdatesMenuRow = pluginUpdates.view as? MenuRowView
        let settingsItem = makeSettingsMenuItem()
        let logs = menuRowItem(title: "打开日志", action: #selector(openLogs), keyEquivalent: "l")
        let quit = menuRowItem(title: "退出 Deepseek Harness", action: #selector(quit), keyEquivalent: "q")
        [open, port, restart, NSMenuItem.separator(), update, dshUpdate, pluginUpdates, settingsItem, logs, quit].forEach(menu.addItem)
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

    /// 菜单「插件管理」行的标题：只在有可更新插件时才带数字，平时保持朴素。
    private func setPluginUpdatesMenuTitle(_ count: Int) {
        let title = count > 0 ? "插件管理 · \(count) 个可更新" : "插件管理"
        pluginUpdatesMenuItem?.title = title
        pluginUpdatesMenuRow?.title = title
    }

    private func scheduleDSHUpdateCheck() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.performDSHUpdateCheck(interactive: false)
        }
    }

    @objc private func checkDSHForUpdates() {
        guard dshInstallHandle == nil else {
            showInfo(title: "正在安装或更新 Deepseek Harness", message: "请等待当前安装/更新完成后再试。")
            return
        }
        // 已知有更新时直接进入更新确认，避免重复联网检查。
        if let report = dshUpdateReport, report.isUpdate {
            presentDSHUpdate(report: report)
            return
        }
        performDSHUpdateCheck(interactive: true)
    }

    private func performDSHUpdateCheck(interactive: Bool) {
        guard DSHRuntimeSupport.isInstalled() else {
            setDSHUpdateMenuTitle("检查 Deepseek Harness 更新")
            return
        }
        // 安装/更新进行中不做检查：结果只会被下一次安装覆盖。
        guard dshInstallHandle == nil else {
            if interactive { showInfo(title: "正在安装或更新 Deepseek Harness", message: "请等待当前安装/更新完成后再试。") }
            return
        }
        guard !dshUpdateCheckInFlight else { return }
        dshUpdateCheckInFlight = true
        if interactive { setDSHUpdateMenuTitle("正在检查 Deepseek Harness 更新…") }
        dshUpdateService.check { [weak self] result in
            guard let self else { return }
            self.dshUpdateCheckInFlight = false
            switch result {
            case .checked(let report):
                self.applyDSHUpdateReport(report, interactive: interactive)
            case .failed(let message):
                self.dshUpdateReport = nil
                self.setDSHUpdateMenuTitle("检查 Deepseek Harness 更新")
                self.appendLogString("dsh 更新检查失败：\(message)\n")
                if interactive { self.showInfo(title: "检查 Deepseek Harness 更新失败", message: message) }
            }
        }
    }

    /// 检查结果落地：日志 → 菜单标题 → 需要时弹窗。自动检查只改菜单标题（dsh 更新
    /// 从不静默安装，是否更新由用户决定），被用户跳过的版本连标题都不再改。
    private func applyDSHUpdateReport(_ report: DSHUpdateReport, interactive: Bool) {
        appendLogString("dsh 更新检查：当前 v\(report.current)；" + report.messages.joined(separator: "；") + "\n")
        for warning in report.warnings { appendLogString("dsh 更新检查提示：\(warning)\n") }

        guard report.isUpdate else {
            dshUpdateReport = nil
            setDSHUpdateMenuTitle("检查 Deepseek Harness 更新")
            if interactive {
                var message = "当前版本：v\(report.current)"
                if compareDSHVersions(report.best.version, report.current) != .orderedSame {
                    // 当前装的是比 npm / GitHub 上更新的版本（例如提前用了内测版）。
                    message += "\n已发布的最新版本：v\(report.best.version)（\(report.best.channel.label)）"
                }
                showInfo(title: "Deepseek Harness 已是最新版本", message: message)
            }
            return
        }

        dshUpdateReport = report
        if DSHUpdatePlanner.shouldAnnounce(report, interactive: interactive, skipped: settings.skippedDSHVersion) {
            setDSHUpdateMenuTitle("Deepseek Harness 更新可用：v\(report.best.version)（\(report.best.channel.label)）")
        } else {
            setDSHUpdateMenuTitle("检查 Deepseek Harness 更新（已跳过 v\(report.best.version)）")
            appendLogString("dsh v\(report.best.version) 已被跳过，自动检查不再提示\n")
        }
        if interactive { presentDSHUpdate(report: report) }
    }

    /// 更新确认：把所有比当前新的版本列进下拉让用户选（只有一个时退化成单版本提示），
    /// 选项为 更新 / 稍后 / 跳过此版本（跳过会被记住，菜单里仍能看到并随时取消）。
    /// 卡片里的「来源」行：GitHub Release · 发布于 2026-09-22 / npm next 标签。
    private static func sourceLine(for candidate: DSHUpdateCandidate) -> String {
        var text = candidate.source.label
        if let date = candidate.publishedAt { text += " · 发布于 \(dshDayString(date))" }
        return text
    }

    private func presentDSHUpdate(report: DSHUpdateReport) {
        let choices = DSHUpdatePlanner.selectableUpdates(report)
        guard let newest = choices.first ?? (report.isUpdate ? report.best : nil) else { return }
        let multiple = choices.count > 1
        let chosen = { multiple ? $0 : newest }

        let alert = NSAlert()
        AlertDesign.style(alert, tone: .update)
        alert.messageText = multiple ? "Deepseek Harness 有 \(choices.count) 个可选更新版本" : "发现 Deepseek Harness 新版本"
        // 正文只留一句话：版本号、来源、日期与说明都放进下面的卡片，避免一屏文字墙。
        alert.informativeText = state == .running
            ? "更新会从 npm 下载所选版本并自动重启 Deepseek Harness；会话、归档与插件数据不受影响。"
            : "更新会从 npm 下载所选版本，下次启动 Deepseek Harness 时生效。"

        var rows: [NSView] = []
        var picker: DSHUpdateVersionPicker?
        if multiple {
            // 下拉里是所有比当前新的已发布版本，默认选中最新的一版。
            let chooser = DSHUpdateVersionPicker(
                candidates: choices,
                selected: newest,
                width: AlertDesign.cardWidth - 28,
                height: releaseNotesHeight(for: newest.notes)
            )
            picker = chooser
            rows.append(contentsOf: chooser.rows)
        } else {
            rows.append(AlertDesign.versionRow(from: report.current, to: newest.version, channel: newest.channel))
            rows.append(AlertDesign.captionRow("来源：", Self.sourceLine(for: newest)))
            let pane = makeReleaseNotesText(width: AlertDesign.cardWidth - 28, height: releaseNotesHeight(for: newest.notes))
            renderReleaseNotes(newest.notes, into: pane.textView)
            rows.append(pane.scroll)
        }

        var footnote: String?
        if let stable = report.newestStable, stable.version != newest.version,
           compareDSHVersions(stable.version, report.current) == .orderedDescending {
            footnote = "最新正式版是 v\(stable.version)，可在下拉里改选。"
        }
        alert.accessoryView = AlertDesign.accessory(card: AlertDesign.card(rows: rows), footnote: footnote)

        let selected = { picker.map { chosen($0.selection) } ?? newest }
        let skipState = { DSHUpdatePlanner.isSkipped(version: selected().version, skipped: self.settings.skippedDSHVersion) }
        alert.addButton(withTitle: "更新到 v\(newest.version)")
        alert.addButton(withTitle: "稍后")
        alert.addButton(withTitle: skipState() ? "取消跳过此版本" : "跳过此版本")

        // 预发布版本不设为默认按钮：回车不该顺手装上内测版。
        let applyDefaultButton = { (channel: DSHReleaseChannel) in
            alert.buttons[0].keyEquivalent = channel.isPrerelease ? "" : "\r"
            alert.buttons[1].keyEquivalent = channel.isPrerelease ? "\r" : ""
        }
        applyDefaultButton(newest.channel)
        picker?.onChange = { candidate in
            alert.buttons[0].title = "更新到 v\(candidate.version)"
            alert.buttons[2].title = DSHUpdatePlanner.isSkipped(version: candidate.version, skipped: self.settings.skippedDSHVersion)
                ? "取消跳过此版本"
                : "跳过此版本"
            applyDefaultButton(candidate.channel)
        }

        switch alert.runModal() {
        case .alertFirstButtonReturn:
            updateDSHNow(to: selected().version)
        case .alertThirdButtonReturn:
            let version = selected().version
            if DSHUpdatePlanner.isSkipped(version: version, skipped: settings.skippedDSHVersion) {
                settings.skippedDSHVersion = nil
                setDSHUpdateMenuTitle("Deepseek Harness 更新可用：v\(newest.version)（\(newest.channel.label)）")
                appendLogString("已取消跳过 dsh v\(version)\n")
            } else {
                settings.skippedDSHVersion = version
                dshUpdateReport = nil
                setDSHUpdateMenuTitle("检查 Deepseek Harness 更新（已跳过 v\(version)）")
                appendLogString("用户跳过 dsh v\(version) 的更新提示\n")
            }
        default:
            appendLogString("用户选择稍后更新 dsh（最新 v\(newest.version)，可选 \(choices.count) 个版本）\n")
        }
    }

    /// 菜单「立即更新」：从 npm 安装指定版本替换 runtime。dsh 正在运行/启动中时
    /// 先停止再更新，完成后自动重启回到运行状态；未运行则只更新，下次启动生效。
    private func updateDSHNow(to version: String) {
        guard dshInstallHandle == nil else {
            showInfo(title: "正在安装或更新 Deepseek Harness", message: "请等待当前安装/更新完成后再试。")
            return
        }
        let wasActive = state == .running || state == .checking
        let port = selectedPort ?? basePort
        let beginInstall: () -> Void = { [weak self] in
            guard let self else { return }
            self.setState(.checking)
            let environment = LauncherEnvironment.nodeEnvironment(preferOffline: false)
            guard let npmPath = LauncherEnvironment.executablePath(named: "npm", environment: environment) else {
                self.fail("未找到 npm。请先安装 Node.js（包含 npm），或把 Node 加入标准安装路径后重试")
                return
            }
            self.beginDSHInstall(port: port, npmPath: npmPath, environment: environment, mode: .dshUpdate(version: version), relaunchAfterInstall: wasActive)
        }
        if wasActive {
            stopDHL(completion: beginInstall)
        } else {
            beginInstall()
        }
    }

    @objc private func openDHL() {
        openDHLForSession(nil)
    }

    private func openDHLForSession(_ sessionId: String?) {
        pendingSessionId = sessionId.flatMap { $0.isEmpty ? nil : $0 }
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
        let target = pendingSessionId
        pendingSessionId = nil
        openWebPage(on: port) { [weak self] in
            guard let target else { return }
            self?.requestSessionOpen(sessionId: target, port: port)
        }
    }

    /// Hand a target session to the Harness client. This is best-effort: an
    /// external Harness may not have the bundled plugin, in which case the
    /// caller still opens the normal Harness home page.
    private func requestSessionOpen(sessionId: String, port: Int) {
        guard !sessionId.isEmpty,
              let url = URL(string: "http://127.0.0.1:\(port)/dsh-session-notify/open"),
              let body = try? JSONSerialization.data(withJSONObject: ["sessionId": sessionId]) else { return }
        ServiceProbe.postJSON(at: url, body: body, timeout: 1)
    }

    private func openBrowserWhenReadyIfNeeded() {
        guard !didAutoOpenBrowser, settings.openBrowserOnReady || openWhenReady || relaunchingAfterRestart else { return }
        didAutoOpenBrowser = true
        openWhenReady = false
        // 重启后的接管只消费一次：关旧标签页、开新页面。dsh 会话全部
        // 持久化，不加这个可见循环用户无法分辨重启是否真的发生。
        let restartTakeover = relaunchingAfterRestart
        relaunchingAfterRestart = false
        guard state == .running, let port = selectedPort else { return }
        let target = pendingSessionId
        pendingSessionId = nil
        if restartTakeover {
            let stamp = String(formatLogTimestamp().dropFirst(11).prefix(8)) // HH:mm:ss
            setPortMenuTitle("端口：\(port) · 已重启 \(stamp)")
            showStatusTitle("已重启 ✓", autoDismissAfter: 6)
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                guard let self, self.state == .running, self.selectedPort == port else { return }
                self.setPortMenuTitle("端口：\(port)")
            }
        }
        openWebPage(on: port, intent: .automatic, restartTakeover: restartTakeover) { [weak self] in
            guard let target else { return }
            self?.requestSessionOpen(sessionId: target, port: port)
        }
    }

    /// 打开 Harness 页面。`intent` 决定节流策略：菜单点击/热键永远生效，
    /// 后端就绪后的自动打开仍受 2 秒冷却保护，避免连开多个标签页。
    /// `restartTakeover`：重启 dsh 后为 true——先关闭旧的 Harness 标签页，
    /// 再打开新进程入口页面，构成可见的「先退出再打开」循环。
    private func openWebPage(
        on port: Int,
        path: String = "/",
        intent: BrowserOpenIntent = .manual,
        restartTakeover: Bool = false,
        completion: @escaping () -> Void = {}
    ) {
        guard let url = webRootURL(for: port, path: path) else {
            completion()
            return
        }
        guard !BrowserConnectionSupport.shouldDefer(
            intent: intent, inFlight: browserOpenInFlight, lastOpenAt: lastBrowserOpenAt, now: Date()
        ) else {
            if browserOpenInFlight {
                pendingBrowserOpenCompletions.append(completion)
            } else {
                completion()
            }
            return
        }
        browserOpenInFlight = true
        // 连接仅是页面存在的启发式信号（keep-alive 会在标签页全关后仍保持
        // 连接一段时间），配合注入客户端的 presence 心跳才能准确判断。
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let clientPIDs = Set(self.lsofConnections(toPort: port).map(\.pid))
            let table = self.processTable()
            let pagePresence = self.pagePresence(port: port)
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard self.state == .running, self.selectedPort == port else {
                    self.finishBrowserOpen(port: port, error: nil, completion: completion)
                    return
                }
                if let active = pagePresence, !active {
                    self.appendLogString("Harness 页面已全部关闭，重新打开页面\n")
                    self.deliverPage(url, to: nil, port: port, completion: completion)
                    return
                }
                let browser = self.browserConnected(clientPIDs: clientPIDs, table: table, port: port)
                self.deliverPage(url, to: browser, port: port, restartTakeover: restartTakeover, completion: completion)
            }
        }
    }

    /// 打开页面用的入口 URL：dsh 打印过带 token 的认证入口就优先用它
    /// （0.1.5-rc.2 起首页 401，裸 URL 打不开），否则回退裸地址（旧版）。
    /// token 只对根路径有效，非根 path 一律走裸地址（插件路由无需认证）。
    private func webRootURL(for port: Int, path: String = "/") -> URL? {
        if path == "/" {
            webURLLock.lock()
            let authenticated = authenticatedWebURL
            webURLLock.unlock()
            if let authenticated, authenticated.port == port {
                return authenticated
            }
        }
        return BrowserConnectionSupport.pageURL(port: port, path: path)
    }

    /// 从 dsh stdout 捕获 `dsh web: <url>` 入口行（含 0.1.5-rc.2 起的
    /// ?token= 认证参数）。URL 是进程生命周期内有效的认证入口，任何时刻
    /// 交给浏览器都能完成 token → cookie 兑换。
    private func captureWebURL(from output: String, port: Int) {
        guard let url = HarnessWebCompatibility.webEntryURL(fromOutput: output, port: port) else { return }
        webURLLock.lock()
        authenticatedWebURL = url
        webURLLock.unlock()
        appendLogString("捕获 Web 认证入口 URL\n")
    }

    /// 查询注入客户端的页面心跳。nil = 接口不存在（外部 Harness / 旧插件），
    /// 此时保留「有连接就前置浏览器」的降级行为。
    private func pagePresence(port: Int) -> Bool? {
        guard let url = URL(string: "http://127.0.0.1:\(port)/dsh-session-notify/presence") else { return nil }
        guard let body = ServiceProbe.body(at: url, timeout: 1) else { return nil }
        return BrowserConnectionSupport.presenceActive(body)
    }

    /// 检测到已有 Harness 页面时，先用 Apple Events 选中匹配的标签页，
    /// 不再把 URL 重新交给浏览器。后者在 Chromium/Safari 中会创建重复
    /// 标签页；自动化被拒绝或浏览器不支持时，降级为仅前置浏览器。
    /// 例外：`restartTakeover`（重启 dsh 后）会先关闭匹配的旧标签页，再
    /// 打开新进程的入口页面——dsh 的会话/工作区全部持久化，仅刷新页面看
    /// 起来与重启前完全一样，「先退出再打开」的可见循环才能让用户确认
    /// 重启真的发生了。
    private func deliverPage(
        _ url: URL,
        to browser: NSRunningApplication?,
        port: Int,
        restartTakeover: Bool = false,
        completion: @escaping () -> Void = {}
    ) {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        let openInBrowser = { [weak self] in
            guard let self else { return }
            if let bundleID = browser?.bundleIdentifier,
               let browserURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                NSWorkspace.shared.open([url], withApplicationAt: browserURL, configuration: configuration) { [weak self] _, error in
                    DispatchQueue.main.async {
                        self?.finishBrowserOpen(port: port, error: error, completion: completion)
                    }
                }
                return
            }
            NSWorkspace.shared.open(url, configuration: configuration) { [weak self] _, error in
                DispatchQueue.main.async {
                    self?.finishBrowserOpen(port: port, error: error, completion: completion)
                }
            }
        }

        if let browser {
            let browserName = browser.localizedName ?? "浏览器"
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                // 重启接管：先关旧标签页，再新开页面（关不掉也照常新开，
                // 保证重启后总有一张可用的新页面）。
                if restartTakeover {
                    let close = BrowserAutomationSupport.closeHarnessTab(
                        bundleIdentifier: browser.bundleIdentifier, targetURL: url
                    )
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        switch close {
                        case .closed:
                            self.appendLogString("dsh 已重启，已关闭 \(browserName) 的旧 Harness 标签页，正在打开新页面\n")
                        case .missing:
                            self.appendLogString("dsh 已重启，未找到 \(browserName) 的旧 Harness 标签页，直接打开新页面\n")
                        case .unsupported:
                            self.appendLogString("dsh 已重启，\(browserName) 不支持标签关闭，直接打开新页面（旧标签可手动关闭）\n")
                        case .failed(let message):
                            self.appendLogString("dsh 已重启，关闭 \(browserName) 旧标签页失败（\(message)），直接打开新页面\n")
                        case .focused:
                            break
                        }
                        openInBrowser()
                    }
                    return
                }
                let result = BrowserAutomationSupport.focusHarnessTab(
                    bundleIdentifier: browser.bundleIdentifier, targetURL: url
                )
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    switch result {
                    case .focused:
                        self.appendLogString("检测到 \(browserName) 已连接 Harness 端口 \(port)，已定位并前置 Harness 标签页\n")
                    case .missing:
                        _ = browser.activate(options: [.activateIgnoringOtherApps])
                        self.appendLogString("检测到 \(browserName) 已连接 Harness 端口 \(port)，但未找到匹配标签页；已前置浏览器\n")
                    case .unsupported:
                        _ = browser.activate(options: [.activateIgnoringOtherApps])
                        self.appendLogString("检测到 \(browserName) 已连接 Harness 端口 \(port)，该浏览器不支持标签定位；已前置浏览器\n")
                    case .failed(let message):
                        _ = browser.activate(options: [.activateIgnoringOtherApps])
                        self.appendLogString("定位 \(browserName) Harness 标签页失败（\(message)）；已前置浏览器\n")
                    case .closed:
                        break
                    }
                    self.finishBrowserOpen(port: port, error: nil, completion: completion)
                }
            }
            return
        }
        appendLogString("未检测到已连接 Harness 的浏览器，用默认浏览器打开 \(url.absoluteString)\n")
        openInBrowser()
    }

    private func finishBrowserOpen(
        port: Int,
        error: Error?,
        completion: @escaping () -> Void = {}
    ) {
        browserOpenInFlight = false
        if let error {
            appendLogString("打开 Deepseek Harness Web 页面失败：\(error.localizedDescription)\n")
        } else {
            lastBrowserOpenAt = Date()
        }
        let completions = pendingBrowserOpenCompletions
        pendingBrowserOpenCompletions = []
        completion()
        completions.forEach { $0() }
    }

    /// 找出正在访问 Harness 端口的浏览器。检测走 `lsof` 客户端连接 +
    /// `ps` 父子链定位浏览器主进程，不需要任何授权。标签页选择只在
    /// 已命中浏览器且用户主动打开 Harness 时才通过 Apple Events 执行。
    private func browserConnected(clientPIDs: Set<Int32>, table: [Int32: (ppid: Int32, command: String)], port: Int) -> NSRunningApplication? {
        guard !clientPIDs.isEmpty else { return nil }
        // Chromium 的连接常记在 Helper(Network) 等子进程名下，且这类
        // 进程不是 AppKit 意义上的「应用」；沿父子链向上找到浏览器
        // 主进程再激活。
        for pid in clientPIDs.sorted() {
            guard let mainPID = walkToMainAppPID(startingAt: pid, table: table) else { continue }
            guard let app = NSRunningApplication(processIdentifier: mainPID),
                  app.bundleIdentifier != Bundle.main.bundleIdentifier else { continue }
            if app.executableURL?.path.contains("/node") == true { continue }
            return app
        }
        appendLogString("端口 \(port) 有客户端连接但未找到对应浏览器进程\n")
        return nil
    }

    private struct LsofEntry { let pid: Int32; let command: String; let name: String }

    /// 同步跑一次 lsof。lsof -i 在连接多时可能超过几十毫秒，调用方应放到
    /// 后台队列执行，避免阻塞主线程。
    private func lsofConnections(toPort port: Int) -> [LsofEntry] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        // -iTCP:@127.0.0.1:port 只看连到该端口的连接；-n 不做 DNS 反查（快）
        task.arguments = ["-nP", "-a", "-iTCP:\(port)", "-sTCP:ESTABLISHED", "-Fpn"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do { try task.run() } catch { return [] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        guard let output = String(data: data, encoding: .utf8) else { return [] }
        let pids = BrowserConnectionSupport.clientPIDs(output, port: port)
        return pids.map { LsofEntry(pid: $0, command: "", name: "") }.sorted { $0.pid < $1.pid }
    }

    /// 一次 `ps` 拉全表：pid -> (ppid, 命令路径)，供向上找主进程用。
    private func processTable() -> [Int32: (ppid: Int32, command: String)] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-axo", "pid=,ppid=,command="]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do { try task.run() } catch { return [:] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        guard let output = String(data: data, encoding: .utf8) else { return [:] }
        var table: [Int32: (Int32, String)] = [:]
        for line in output.split(separator: "\n") {
            let columns = line.split(separator: " ", omittingEmptySubsequences: true)
            guard columns.count >= 3,
                  let pid = Int32(columns[0]), let ppid = Int32(columns[1]) else { continue }
            // command 可能带空格（含 .app 路径），取剩余全部列
            let command = columns[2...].joined(separator: " ")
            table[pid] = (ppid, command)
        }
        return table
    }

    /// 沿父子链向上找第一个「真正的应用」（AppKit 能识别的浏览器主进程）。
    /// 最多上溯 6 层，防止 ps 时序抖动导致死循环。
    private func walkToMainAppPID(startingAt pid: Int32, table: [Int32: (ppid: Int32, command: String)]) -> Int32? {
        var applications: [Int32: String] = [:]
        for app in NSWorkspace.shared.runningApplications {
            applications[app.processIdentifier] = app.bundleIdentifier ?? ""
        }
        return BrowserConnectionSupport.browserPID(
            start: pid, parents: table.mapValues { $0.ppid }, applications: applications
        )
    }

    private func stopDHL(completion: (() -> Void)? = nil) {
        cancelDSHInstall()
        let trackedPID = process?.processIdentifier ?? 0
        process = nil; selectedPort = nil; didAutoOpenBrowser = false; openWhenReady = false; pendingSessionId = nil
        pluginCompatGeneration += 1
        // 旧进程的 token 随进程失效，重开后必须用新进程打印的入口 URL。
        webURLLock.lock(); authenticatedWebURL = nil; webURLLock.unlock()
        setState(.stopped)
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var pids = self?.managedDSHPIDs() ?? []
            if trackedPID > 0 && !pids.contains(trackedPID) { pids.insert(trackedPID, at: 0) }
            for pid in pids { self?.terminateProcessGroup(pid: pid) }
            DispatchQueue.main.async {
                completion?()
            }
        }
    }

    /// Restart the managed dsh instance: stop every managed process, then start
    /// fresh (reuses the installed runtime; triggers an upgrade only when a
    /// bundled dsh version differs).
    @objc private func restartDSH() {
        guard dshInstallHandle == nil else {
            showInfo(title: "正在安装或更新 Deepseek Harness", message: "请等待当前安装/更新完成后再重启。")
            return
        }
        setPortMenuTitle("正在重启 Deepseek Harness…")
        // 点击后菜单立即关闭，重启过程（约 4 秒）的反馈只能放在菜单栏本身，
        // 否则用户只看到页面卡一下、无从分辨重启是否发生。
        showStatusTitle("正在重启…")
        appendLogString("用户请求重启 dsh…\n")
        stopDHL { [weak self] in
            guard let self else { return }
            self.appendLogString("dsh 已停止，正在重新启动…\n")
            self.start()
        }
        // stopDHL 的同步段会清空 openWhenReady，置位必须放在其后。重启完成后
        // 接管已打开的页面：旧 token 随旧进程失效，必须让浏览器加载新进程的
        // 入口 URL，否则用户看到的还是重启前的旧页面。
        openWhenReady = true
        relaunchingAfterRestart = true
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
        if updateDownloadInFlight {
            updateDownloadWindow?.present()
            return
        }
        if let pendingUpdate { presentUpdate(manifest: pendingUpdate); return }
        performUpdateCheck(interactive: true)
    }

    private var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    private func scheduleAutoUpdateChecks() {
        autoUpdateTimer?.invalidate(); autoUpdateTimer = nil
        let interval = settings.updateIntervalHours * 3600
        // 一个定时器驱动两条独立链路：启动器自身的自动检测受「自动检测更新」开关
        // 控制；dsh 的检查只改菜单提示、从不静默安装，因此只跟随「检查频率」——
        // 开关关闭时用户仍然能看到「有新版 dsh 可用」，是否更新由他自己决定。
        autoUpdateTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard let self else { return }
            if self.settings.autoUpdateEnabled { self.performUpdateCheck(interactive: false) }
            self.performDSHUpdateCheck(interactive: false)
            // 插件探测要联网，按「检查频率」跟着抖动一次；是否真的发请求由
            // 「自动检测插件更新」开关决定（关闭时该函数直接返回）。
            self.requestPluginUpdatesRefresh()
        }
        guard settings.autoUpdateEnabled else {
            setUpdateMenuTitle("检测启动器（DHL）更新")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            self?.performUpdateCheck(interactive: false)
        }
    }

    private func performUpdateCheck(interactive: Bool) {
        guard !updateCheckInFlight else { return }
        updateCheckInFlight = true
        if interactive { setUpdateMenuTitle("正在检测启动器更新…") }
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
                self.setUpdateMenuTitle("检测启动器（DHL）更新")
                if interactive { self.showInfo(title: "已是最新版本", message: "当前版本：v\(self.currentVersion)") }
            case .noPublishedRelease:
                self.pendingUpdate = nil
                self.setUpdateMenuTitle("检测启动器（DHL）更新")
                if interactive { self.showInfo(title: "暂无可用更新", message: "项目暂未发布可下载安装的 \(LauncherBrand.fullName) 版本。") }
            case .failed(let message):
                self.setUpdateMenuTitle("检测启动器（DHL）更新")
                self.appendLogString("更新检查失败：\(message)\n")
                if interactive { self.showInfo(title: "检测启动器更新失败", message: message) }
            }
        }
    }

    private func presentUpdate(manifest: UpdateManifest) {
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .update)
        alert.messageText = "发现 \(LauncherBrand.fullName) 新版本"
        alert.informativeText = "下载更新包后由你确认安装；安装会替换当前 App 并重启 Deepseek Harness。"

        var rows: [NSView] = [
            AlertDesign.versionRow(from: currentVersion, to: manifest.version, channel: nil)
        ]
        if let published = updatePublishedCaption(manifest.publishedAt) {
            rows.append(AlertDesign.captionRow("来源：", "GitHub Release · \(published)"))
        }
        if let notes = manifest.notes, !notes.isEmpty {
            let pane = makeReleaseNotesText(width: AlertDesign.cardWidth - 28, height: releaseNotesHeight(for: notes))
            renderReleaseNotes(notes, into: pane.textView)
            rows.append(pane.scroll)
        }
        alert.accessoryView = AlertDesign.accessory(
            card: AlertDesign.card(rows: rows),
            footnote: manifest.notes?.isEmpty == false ? nil : "该版本未提供更新说明。"
        )
        alert.addButton(withTitle: "下载更新")
        alert.addButton(withTitle: "稍后")
        if alert.runModal() == .alertFirstButtonReturn { downloadUpdate(manifest) }
    }

    /// 卡片里的「来源」副标题：把 Release 的发布时间写成一行短文案。
    private func updatePublishedCaption(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let iso = ISO8601DateFormatter()
        guard let date = iso.date(from: raw) else { return nil }
        return "发布于 \(dshDayString(date))"
    }

    private func downloadUpdate(_ manifest: UpdateManifest) {
        guard !updateDownloadInFlight else {
            updateDownloadWindow?.present()
            return
        }
        updateDownloadInFlight = true
        setUpdateMenuTitle("正在下载更新…")
        let progressWindow = UpdateDownloadWindowController(version: manifest.version)
        updateDownloadWindow = progressWindow
        progressWindow.present()
        updateService.download(manifest, onProgress: { [weak progressWindow] progress in
            progressWindow?.update(progress)
        }) { [weak self, weak progressWindow] result in
            guard let self else { return }
            self.updateDownloadInFlight = false
            progressWindow?.dismiss()
            self.updateDownloadWindow = nil
            switch result {
            case .success(let url):
                self.setUpdateMenuTitle("更新可用：v\(manifest.version)")
                let alert = NSAlert()
                AlertDesign.style(alert, tone: .success)
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
            showInfo(title: "正在安装 Deepseek Harness", message: "首次安装尚未完成，请等待安装结束后再更新 Deepseek Harness Launcher。")
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

    private func showInfo(title: String, message: String, tone: AlertTone = .info) {
        let alert = NSAlert()
        AlertDesign.style(alert, tone: tone)
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
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
                    self.monitorSessionNotify(port: port)
                    self.monitorPluginUpdates(port: port)
                    self.openBrowserWhenReadyIfNeeded()
                    self.schedulePluginCompatibilityCheck(port: port)
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
        HarnessWebCompatibility.isHarnessWebBody(body)
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
            AlertDesign.style(alert, tone: .question)
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
        AlertDesign.style(alert, tone: .question)
        alert.messageText = "首次安装 Deepseek Harness"
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

    private func beginDSHInstall(
        port: Int,
        npmPath: String,
        environment: [String: String],
        mode: DSHInstallMode,
        relaunchAfterInstall: Bool = true
    ) {
        let updateVersion: String?
        if case .dshUpdate(let version) = mode { updateVersion = version } else { updateVersion = nil }
        let isUpgrade = mode == .upgrade
        let isRepair = mode == .repair
        let isDSHUpdate = updateVersion != nil
        // 重启若转入安装/更新流程，反馈由安装窗口接管，菜单栏文案不再适用。
        showStatusTitle(nil)
        switch mode {
        case .upgrade:
            setPortMenuTitle("正在更新 Deepseek Harness（可能需要几分钟）…")
            appendLogString("检测到新版本 dsh，开始低内存更新（npm ci，按锁定版本）…\n")
        case .repair:
            setPortMenuTitle("正在修复 Deepseek Harness 运行环境…")
            appendLogString("检测到已有 DeepSeek Harness 数据但运行环境缺失，开始重建 runtime（npm ci，保留用户数据）…\n")
        case .firstInstall:
            setPortMenuTitle("正在安装 Deepseek Harness（首次可能需要几分钟）…")
            appendLogString("本地未检测到 DeepSeek Harness，开始执行下载安装。官方命令：npx @deepseek-ai/dsh web\n")
        case .dshUpdate(let version):
            setPortMenuTitle("正在更新 Deepseek Harness 到 v\(version)（可能需要几分钟）…")
            appendLogString("用户请求更新 dsh：开始下载 v\(version)（npm install，指定版本）…\n")
        }
        let commandText: String
        let initialStatus: String
        let initialDetail: String
        switch mode {
        case .upgrade:
            commandText = "更新命令：npm ci（锁定版本）"
            initialStatus = "检测到新的 Deepseek Harness 版本"
            initialDetail = "正在更新 runtime，请保持网络连接。"
        case .repair:
            commandText = "重建运行环境：npm ci（锁定版本）"
            initialStatus = "检测到已有 Deepseek Harness 数据，正在重建运行环境"
            initialDetail = "正在重建 runtime，你的会话、归档与插件数据不会受影响。"
        case .firstInstall:
            commandText = "安装命令：npx @deepseek-ai/dsh web"
            initialStatus = "本地未检测到 Deepseek Harness"
            initialDetail = "正在执行下载安装，请保持网络连接。"
        case .dshUpdate(let version):
            commandText = "更新命令：npm install @deepseek-ai/dsh@\(version)"
            initialStatus = "正在更新 Deepseek Harness 到 v\(version)"
            initialDetail = "正在下载并安装新版本，请保持网络连接。"
        }
        let installWindow = DSHInstallWindowController(commandText: commandText) { [weak self] in
            self?.cancelDSHInstall()
        }
        dshInstallWindow = installWindow
        dshInstallProgressTracker = DSHInstallProgressTracker()
        installWindow.present()
        installWindow.update(status: initialStatus, detail: initialDetail, percentage: nil)
        dshInstallHandle = DSHRuntimeSupport.install(
            npmPath: npmPath,
            environment: environment,
            force: isUpgrade || isRepair || isDSHUpdate,
            packageSpec: updateVersion.map { "@deepseek-ai/dsh@\($0)" },
            onOutput: { [weak self, weak installWindow] text in
                self?.appendLog(Data(text.utf8), prefix: "npm")
                guard let self else { return }
                let snapshot = self.dshInstallProgressTracker?.consume(text)
                DispatchQueue.main.async {
                    installWindow?.update(
                        status: isRepair ? "正在重建运行环境…" : (isUpgrade || isDSHUpdate) ? "正在更新 Deepseek Harness…" : "正在安装 Deepseek Harness…",
                        detail: snapshot?.detail,
                        percentage: snapshot?.percentage
                    )
                }
            }
        ) { [weak self, weak installWindow] result in
            guard let self else { return }
            self.dshInstallHandle = nil
            self.dshInstallProgressTracker = nil
            installWindow?.dismiss()
            self.dshInstallWindow = nil
            switch result {
            case .success(let executableURL):
                if isDSHUpdate {
                    self.dshUpdateReport = nil
                    // 已经装上了，之前跳过的同一版本就没有意义了。
                    if let installed = updateVersion,
                       DSHUpdatePlanner.isSkipped(version: installed, skipped: self.settings.skippedDSHVersion) {
                        self.settings.skippedDSHVersion = nil
                    }
                    self.setDSHUpdateMenuTitle("检查 Deepseek Harness 更新")
                    if relaunchAfterInstall, self.state != .stopped {
                        self.appendLogString("dsh 更新完成，正在同步更新已安装插件…\n")
                        self.updateProfilePlugins(executableURL: executableURL, environment: environment) {
                            self.appendLogString("dsh 更新完成，正在重新启动…\n")
                            self.launchInstalledDSH(port: self.selectedPort ?? port, executableURL: executableURL, environment: environment)
                        }
                    } else {
                        self.setState(.stopped)
                        self.appendLogString("dsh 已更新到 v\(updateVersion ?? "")，下次启动生效\n")
                        self.showInfo(title: "Deepseek Harness 已更新", message: "已更新到 v\(updateVersion ?? "")，下次启动时生效。")
                    }
                    return
                }
                guard self.state != .stopped else { return }
                if isUpgrade, relaunchAfterInstall {
                    // App 内置锁文件升级同样是 dsh 版本变化，插件需要跟上
                    self.appendLogString("dsh runtime 安装完成，正在同步更新已安装插件…\n")
                    self.updateProfilePlugins(executableURL: executableURL, environment: environment) {
                        self.launchInstalledDSH(port: self.selectedPort ?? port, executableURL: executableURL, environment: environment)
                    }
                    return
                }
                self.appendLogString("dsh runtime 安装完成，开始启动…\n")
                self.launchInstalledDSH(port: self.selectedPort ?? port, executableURL: executableURL, environment: environment)
            case .failure(let error):
                self.openWhenReady = false
                if case .cancelled = error as? DSHRuntimeError {
                    self.appendLogString(isUpgrade || isDSHUpdate ? "dsh 更新已取消，原 runtime 保持不变\n" : isRepair ? "dsh 运行环境重建已取消，用户数据保持不变\n" : "dsh 首次安装已取消，临时安装目录已清理\n")
                } else if self.state != .stopped || isDSHUpdate {
                    // 手动更新流程即使外部已置为 stopped，也要明确告知更新结果
                    self.showDSHInstallFailure(error)
                }
            }
            if self.terminateAfterDSHInstall {
                self.terminateAfterDSHInstall = false
                NSApp.terminate(nil)
            }
        }
    }

    /// dsh 版本更新后同步更新 profile 里已安装的插件。插件依赖的
    /// @deepseek-ai/* peer 随 dsh 版本演进，旧插件会因 API 移除而加载失败
    /// （0.1.5-rc.2 移除 dsh-settings 的 settingsNamespace 导出即是一例，
    /// 导致 dsh 完全无法启动）。通过 dsh 自带的 plugin 子命令（转发
    /// pnpm）执行 `update --latest`：file:/github: 等本地与固定源依赖
    /// 不受影响。失败只记日志，不阻塞启动——插件更新是尽力而为的增强。
    private func updateProfilePlugins(executableURL: URL, environment: [String: String], completion: @escaping () -> Void) {
        var env = environment
        let pnpmBin = DSHRuntimeSupport.dshHomeURL.appendingPathComponent("pnpm-bin", isDirectory: true)
        env["PATH"] = "\(pnpmBin.path):\(env["PATH"] ?? "")"
        let task = Process()
        task.executableURL = executableURL
        task.arguments = ["plugin", "--profile", "web", "update", "--latest"]
        task.currentDirectoryURL = DSHRuntimeSupport.dshHomeURL
        task.environment = env
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            if let text = String(data: data, encoding: .utf8) { self?.appendLog(Data(text.utf8), prefix: "plugin-update") }
        }
        var finished = false
        let finish: (String) -> Void = { [weak self] note in
            guard !finished else { return }
            finished = true
            pipe.fileHandleForReading.readabilityHandler = nil
            if let self {
                self.appendLogString("\(note)（插件更新输出已记入日志）\n")
            }
            DispatchQueue.main.async { completion() }
        }
        task.terminationHandler = { terminated in
            finish(terminated.terminationStatus == 0 ? "插件同步更新完成" : "插件同步更新失败（exit \(terminated.terminationStatus)），继续启动 dsh")
        }
        do {
            try task.run()
            // pnpm 偶发网络挂起时不能卡住启动：超时按失败处理并继续。
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 300) { [weak task] in
                guard let task, task.isRunning else { return }
                task.terminate()
                finish("插件同步更新超时（5 分钟），继续启动 dsh")
            }
        } catch {
            appendLogString("无法启动插件更新命令：\(error.localizedDescription)，继续启动 dsh\n")
            finish("插件同步更新未能启动")
        }
    }

    private func cancelDSHInstall() {
        guard dshInstallHandle != nil else { return }
        dshInstallWindow?.markCancelling()
        dshInstallHandle?.cancel()
        appendLogString("用户取消 dsh 安装，临时安装目录将被清理\n")
        if state == .checking { setState(.stopped) }
    }

    /// 版本定向更新后的启动失败兜底：保留了回退快照时，询问用户是否回退
    /// 到更新前版本并重启。返回 true 表示已接管（回退并重启），调用方应
    /// 跳过常规失败流程。典型场景：新 dsh 移除了插件依赖的 API，插件加载
    /// 失败导致进程起不来——回退旧版本立即恢复可用。
    private func offerUpdateRollbackIfNeeded(reason: String) -> Bool {
        guard DSHRuntimeSupport.hasRollback() else { return false }
        let previous = DSHRuntimeSupport.rollbackVersion() ?? "未知版本"
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .error)
        alert.messageText = "Deepseek Harness 新版本启动失败"
        alert.informativeText = "\(reason)。\n可能是已安装的插件与新版本不兼容（具体原因见日志）。\n是否回退到更新前的 v\(previous) 并重新启动？"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "回退并重启")
        alert.addButton(withTitle: "查看日志")
        alert.addButton(withTitle: "保持新版本")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            guard DSHRuntimeSupport.performRollback() else {
                appendLogString("dsh 回退失败（快照换入异常），按常规失败处理\n")
                return false
            }
            appendLogString("dsh 新版本启动失败，已回退到 v\(previous)，正在重新启动…\n")
            process = nil
            selectedPort = nil
            setState(.stopped)
            start()
            return true
        case .alertSecondButtonReturn:
            openLogs()
            return false
        default:
            return false
        }
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
            if data.isEmpty {
                handle.readabilityHandler = nil
            } else {
                self?.appendLog(data, prefix: "stdout")
                if let text = String(data: data, encoding: .utf8) {
                    self?.captureWebURL(from: text, port: port)
                }
            }
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
                // 重启/更新会先停掉旧实例、紧接着启动新实例。旧实例的
                // terminationHandler 在自己的队列上排空管道、写日志，等它回到
                // 主线程时 state 往往已经从 .stopped 走到 .checking，而 process
                // 已指向新实例（或已被 stopDHL 清空）。此时若照旧走失败分支，
                // 用户会在重启成功后收到一条「启动失败／进程已退出」的弹窗，
                // 并且 pollUntilReady 依赖的 process 引用会被误清。
                // 只有退出的仍是当前受管进程，才算真正的启动失败。
                guard self.process === terminatedProcess else {
                    self.appendLogString("旧实例退出不计入启动失败（当前受管实例已更换）\n")
                    return
                }
                self.process = nil
                self.selectedPort = nil
                // 版本更新后的首次启动失败优先提供回退，而非直接报错
                if self.state == .checking, self.offerUpdateRollbackIfNeeded(reason: "\(LauncherBrand.fullName) 进程已退出（code=\(terminatedProcess.terminationStatus)）") { return }
                self.fail("\(LauncherBrand.fullName) 进程已退出，请查看日志")
            }
        }
        do {
            try task.run()
            process = task; selectedPort = port; didAutoOpenBrowser = false; pollUntilReady(port: port, startedAt: Date())
        } catch {
            fail("无法启动 Deepseek Harness：\(error.localizedDescription)")
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
            if offerUpdateRollbackIfNeeded(reason: "\(LauncherBrand.fullName) 启动超过 10 分钟") { return }
            fail("\(LauncherBrand.fullName) 启动超过 10 分钟，请检查网络和日志")
            return
        }
        if Int(elapsed) > 0 && Int(elapsed) % 30 == 0 {
            setPortMenuTitle("正在安装或启动 Deepseek Harness（已等待 \(Int(elapsed)) 秒）…")
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
        ServiceProbe.body(at: url) { [weak self] body in
            guard let self, self.state != .stopped else { return }
            if let body, self.isHarnessWebBody(body) {
                self.setState(.running)
                // 新版本 dsh 首次启动成功：回退快照完成使命，释放磁盘
                if DSHRuntimeSupport.hasRollback() {
                    DSHRuntimeSupport.discardRollback()
                    self.appendLogString("dsh 新版本启动成功，已清理回退快照\n")
                }
                self.monitorArchivePlugin(port: port)
                self.monitorSessionNotify(port: port)
                self.monitorPluginUpdates(port: port)
                self.openBrowserWhenReadyIfNeeded()
                self.schedulePluginCompatibilityCheck(port: port)
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

    // MARK: - 插件兼容性检查

    private struct PluginInstalledList: Decodable {
        let items: [PluginCompatibilitySupport.InstalledPlugin]
    }

    /// 启动/重启进入 running 后调度一次兼容性检查。dsh 加载插件需要几秒
    /// （monitorArchivePlugin 同样给了约 10 秒窗口），过早探测会把「还在
    /// 加载」误判成「未加载」。代际号随停止/重启递增，旧调度自动失效。
    private func schedulePluginCompatibilityCheck(port: Int) {
        pluginCompatGeneration += 1
        let generation = pluginCompatGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard let self,
                  self.state == .running, self.selectedPort == port,
                  generation == self.pluginCompatGeneration else { return }
            self.runPluginCompatibilityCheck(port: port)
        }
    }

    private func runPluginCompatibilityCheck(port: Int) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            var issues: [PluginCompatibilitySupport.Issue] = []
            let home = FileManager.default.homeDirectoryForCurrentUser
            // 插件管理器可用才说明这是启动器管理的实例（内置插件已链接）；
            // 外部/旧实例没有这些路由，静默跳过，避免把正常降级误报成问题。
            if let body = ServiceProbe.body(at: URL(string: "http://127.0.0.1:\(port)/dsh-plugin-manager/installed") ?? URL(fileURLWithPath: "/"), timeout: 3),
               let data = body.data(using: .utf8),
               let list = try? JSONDecoder().decode(PluginInstalledList.self, from: data) {
                issues += PluginCompatibilitySupport.scan(
                    plugins: list.items,
                    profileModules: home.appendingPathComponent(".dsh/profiles/web/node_modules"),
                    runtimeModules: home.appendingPathComponent(".dsh/runtime/node_modules")
                )
                // 内置插件接口缺失 = 没随当前 dsh 加载（启动时补链接也救不回
                // 的场景：dsh 版本演进移除了插件依赖的 API）。
                let archiveOK = (ServiceProbe.body(at: URL(string: "http://127.0.0.1:\(port)/dsh-archive-manager/archives") ?? URL(fileURLWithPath: "/"), timeout: 3) ?? "").contains("items")
                if !archiveOK {
                    issues.append(PluginCompatibilitySupport.Issue(
                        pluginName: "dsh-archive-manager", version: nil,
                        reason: "归档管理插件未随当前 dsh 加载", userPlugin: false
                    ))
                }
                let notifyOK = (ServiceProbe.body(at: URL(string: "http://127.0.0.1:\(port)/dsh-session-notify/events") ?? URL(fileURLWithPath: "/"), timeout: 3) ?? "").contains("bootId")
                if !notifyOK {
                    issues.append(PluginCompatibilitySupport.Issue(
                        pluginName: "dsh-session-notify", version: nil,
                        reason: "会话完成通知插件未随当前 dsh 加载", userPlugin: false
                    ))
                }
            }
            guard !issues.isEmpty else { return }
            DispatchQueue.main.async {
                guard let self, self.state == .running, self.selectedPort == port else { return }
                self.appendLogString("检测到 \(issues.count) 个插件兼容性问题：\(issues.map(\.pluginName).joined(separator: "、"))\n")
                self.presentPluginIssues(issues)
            }
        }
    }

    /// 逐个呈现兼容性问题；「忽略」只对本次启动器运行生效。
    private func presentPluginIssues(_ issues: [PluginCompatibilitySupport.Issue]) {
        guard !issues.isEmpty else { return }
        var remaining = issues
        let issue = remaining.removeFirst()
        if pluginCompatAlerted.contains(issue.pluginName) {
            presentPluginIssues(remaining)
            return
        }
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .warning)
        alert.messageText = "插件可能与当前 dsh 版本不兼容"
        let versionSuffix = issue.version.map { "（v\($0)）" } ?? ""
        alert.informativeText = "\(issue.pluginName)\(versionSuffix)：\(issue.reason)。\n\n\(issue.userPlugin ? "可尝试升级到适配版本，或卸载该插件；操作后需重启 dsh 生效。" : "可重启 dsh 重试加载；若持续出现，请更新启动器以获取适配的内置插件。")"
        alert.alertStyle = .warning
        alert.addButton(withTitle: issue.userPlugin ? "升级插件" : "重启 dsh")
        if issue.userPlugin { alert.addButton(withTitle: "卸载插件") }
        alert.addButton(withTitle: "忽略")
        let answer = alert.runModal()
        if issue.userPlugin {
            switch answer {
            case .alertFirstButtonReturn: upgradePluginIssue(issue, remaining: remaining)
            case .alertSecondButtonReturn: uninstallPluginIssue(issue, remaining: remaining)
            default:
                pluginCompatAlerted.insert(issue.pluginName)
                presentPluginIssues(remaining)
            }
        } else {
            switch answer {
            case .alertFirstButtonReturn:
                appendLogString("用户选择重启 dsh 以重试加载内置插件\n")
                restartDSH()
            default:
                pluginCompatAlerted.insert(issue.pluginName)
                presentPluginIssues(remaining)
            }
        }
    }

    /// 调插件管理器的升级接口（dsh plugin update，pnpm 可能跑几分钟）。
    private func upgradePluginIssue(_ issue: PluginCompatibilitySupport.Issue, remaining: [PluginCompatibilitySupport.Issue]) {
        guard let port = selectedPort,
              let url = URL(string: "http://127.0.0.1:\(port)/dsh-plugin-manager/update") else {
            presentPluginIssues(remaining)
            return
        }
        appendLogString("正在升级插件 \(issue.pluginName)…\n")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = PluginCompatibilitySupport.postPluginCommand(url: url, name: issue.pluginName, timeout: 300)
            DispatchQueue.main.async {
                guard let self else { return }
                if result.ok {
                    self.appendLogString("插件 \(issue.pluginName) 升级流程完成\n")
                    self.askRestartAfterPluginChange(plugin: issue.pluginName, remaining: remaining)
                } else {
                    self.appendLogString("插件 \(issue.pluginName) 升级失败：\(result.error)\n")
                    self.showInfo(title: "插件升级失败", message: "\(issue.pluginName)：\(result.error)")
                    self.presentPluginIssues(remaining)
                }
            }
        }
    }

    private func uninstallPluginIssue(_ issue: PluginCompatibilitySupport.Issue, remaining: [PluginCompatibilitySupport.Issue]) {
        guard let port = selectedPort,
              let url = URL(string: "http://127.0.0.1:\(port)/dsh-plugin-manager/uninstall") else {
            presentPluginIssues(remaining)
            return
        }
        appendLogString("正在卸载插件 \(issue.pluginName)…\n")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = PluginCompatibilitySupport.postPluginCommand(url: url, name: issue.pluginName, timeout: 300)
            DispatchQueue.main.async {
                guard let self else { return }
                if result.ok {
                    self.pluginCompatAlerted.remove(issue.pluginName)
                    self.appendLogString("插件 \(issue.pluginName) 已卸载\n")
                    self.askRestartAfterPluginChange(plugin: issue.pluginName, remaining: remaining)
                } else {
                    self.appendLogString("插件 \(issue.pluginName) 卸载失败：\(result.error)\n")
                    self.showInfo(title: "插件卸载失败", message: "\(issue.pluginName)：\(result.error)")
                    self.presentPluginIssues(remaining)
                }
            }
        }
    }

    private func askRestartAfterPluginChange(plugin: String, remaining: [PluginCompatibilitySupport.Issue]) {
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .question)
        alert.messageText = "重启 dsh 使变更生效"
        alert.informativeText = "\(plugin) 的变更需要重启 dsh 后生效。现在重启吗？"
        alert.addButton(withTitle: "立即重启")
        alert.addButton(withTitle: "稍后")
        if alert.runModal() == .alertFirstButtonReturn {
            restartDSH()
        } else {
            presentPluginIssues(remaining)
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
        showStatusTitle(nil)
        appendLogString("\(message)\n"); setState(.failed)
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .error)
        alert.messageText = "\(LauncherBrand.fullName) 启动失败"
        alert.informativeText = message
        alert.addButton(withTitle: "打开日志")
        alert.addButton(withTitle: "关闭")
        if alert.runModal() == .alertFirstButtonReturn { openLogs() }
    }

    private func showDSHInstallFailure(_ error: Error) {
        let command = "npx @deepseek-ai/dsh web"
        appendLogString("dsh 安装失败，建议手动执行：\(command)\n")
        setState(.failed)
        let alert = NSAlert()
        AlertDesign.style(alert, tone: .error)
        alert.messageText = "Deepseek Harness 安装失败"
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
              let base = NSImage(contentsOf: url) else {
            return NSImage(size: NSSize(width: 18, height: 18))
        }
        let unread = sessionNotifyStore.unreadCount
        // 有角标或状态文案时菜单栏占位必须可变长，否则标题会被裁剪。
        statusItem.length = (unread > 0 || statusTitleOverride != nil)
            ? NSStatusItem.variableLength : NSStatusItem.squareLength
        guard unread > 0, let badge = makeSessionNotifyBadgeImage(base: base, text: SessionNotifyStore.badgeText(for: unread)) else {
            let image = base.copy() as! NSImage
            image.size = NSSize(width: 20, height: 20)
            image.isTemplate = true
            return image
        }
        return badge
    }

    /// 在菜单栏图标旁显示一段短暂的反馈文案。title 为 nil 时清除。
    /// dismissAfter 秒后自动清除（用于「已重启 ✓」这类确认性提示）；
    /// 期间若被新的状态文案替换，旧定时器不会误清。
    private func showStatusTitle(_ title: String?, autoDismissAfter dismissAfter: TimeInterval? = nil) {
        statusTitleOverride = title
        statusItem.button?.title = title ?? ""
        statusItem.button?.image = makeStatusImage()
        guard let dismissAfter else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + dismissAfter) { [weak self] in
            guard let self, self.statusTitleOverride == title else { return }
            self.showStatusTitle(nil)
        }
    }

    /// Foxmail 式未读角标：template 剪影按菜单栏明暗手动着色，右下角叠一枚
    /// 红色胶囊 + 白色数字。template 机制无法只给局部上色，因此合成图关闭
    /// template 并在每次轮询/打开菜单时重绘，外观切换后最多滞后一个轮询周期。
    private func makeSessionNotifyBadgeImage(base: NSImage, text: String) -> NSImage? {
        let iconSide: CGFloat = 18
        let badgeFont = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .bold)
        let textSize = (text as NSString).size(withAttributes: [.font: badgeFont])
        let badgeHeight: CGFloat = 11
        let badgeWidth = max(badgeHeight, ceil(textSize.width) + 6)
        let size = NSSize(width: iconSide + badgeWidth - 3, height: iconSide + 2)

        let image = NSImage(size: size)
        image.lockFocus()
        let iconRect = NSRect(x: 0, y: size.height - iconSide, width: iconSide, height: iconSide)
        base.draw(in: iconRect)
        let appearance = statusItem.button?.window?.effectiveAppearance ?? NSApp.effectiveAppearance
        let isDark = appearance.bestMatch(from: [NSAppearance.Name.aqua, NSAppearance.Name.darkAqua]) == .darkAqua
        (isDark ? NSColor.white : NSColor.black).setFill()
        iconRect.fill(using: .sourceAtop)

        let badgeRect = NSRect(x: size.width - badgeWidth, y: 0, width: badgeWidth, height: badgeHeight)
        NSColor.systemRed.setFill()
        NSBezierPath(roundedRect: badgeRect, xRadius: badgeHeight / 2, yRadius: badgeHeight / 2).fill()
        let textPoint = NSPoint(
            x: badgeRect.midX - textSize.width / 2,
            y: badgeRect.midY - textSize.height / 2
        )
        (text as NSString).draw(at: textPoint, withAttributes: [.font: badgeFont, .foregroundColor: NSColor.white])
        image.unlockFocus()
        image.isTemplate = false
        return image
    }

    // MARK: - 会话完成提醒

    /// 每次轮询有新完成事件时重建菜单顶部的「会话完成」区块；打开菜单
    /// (menuNeedsUpdate) 时也刷新一次，保证区块与角标和当前外观一致。
    private func rebuildSessionNotifyMenuSection() {
        guard let menu = statusItem.menu else { return }
        for item in sessionNotifyMenuItems { menu.removeItem(item) }
        sessionNotifyMenuItems = []
        let events = sessionNotifyStore.recent(limit: 6)
        guard !events.isEmpty else {
            statusItem.button?.image = makeStatusImage()
            return
        }
        var items: [NSMenuItem] = [NSMenuItem.separator()]
        let header = menuRowItem(title: "会话完成（\(sessionNotifyStore.unreadCount) 个未读）", action: nil, enabled: { false })
        items.append(header)
        for event in events {
            let row = menuRowItem(title: SessionNotifyStore.menuTitle(for: event), action: #selector(openSessionFromNotify(_:)))
            row.representedObject = event.sessionId
            items.append(row)
        }
        items.append(menuRowItem(title: "清除完成提醒", action: #selector(clearSessionNotify)))
        items.append(NSMenuItem.separator())
        for (offset, item) in items.enumerated() {
            menu.insertItem(item, at: offset)
            sessionNotifyMenuItems.append(item)
        }
        statusItem.button?.image = makeStatusImage()
    }

    /// 轮询内置 dsh-session-notify 插件：仅在本启动器管理的 Harness 上存在；
    /// 复用外部实例时接口 404，静默降级（与归档插件的基础模式一致）。
    private func monitorSessionNotify(port: Int) {
        sessionNotifyLoopID += 1
        sessionNotifyFailureStreak = 0
        pollSessionNotify(port: port, loopID: sessionNotifyLoopID)
    }

    private func pollSessionNotify(port: Int, loopID: Int) {
        guard loopID == sessionNotifyLoopID, state == .running, selectedPort == port,
              let url = URL(string: "http://127.0.0.1:\(port)/dsh-session-notify/events?after=\(sessionNotifyStore.pollAfterSeq)") else { return }
        ServiceProbe.body(at: url, timeout: 2) { [weak self] body in
            guard let self, loopID == self.sessionNotifyLoopID, self.state == .running, self.selectedPort == port else { return }
            if let feed = body.flatMap(SessionNotifyFeed.parse) {
                self.sessionNotifyFailureStreak = 0
                let ingested = self.sessionNotifyStore.ingest(feed)
                if !ingested.isEmpty {
                    // completions 是这一轮新增的 turn/end 数；角标按会话去重，所以同一
                    // 会话连跑多轮时数字不会跟着涨。resumed 是「用户又在该会话里发消息」，
                    // 对应的未读提醒已被撤销——会话在跑，角标就不该亮。
                    if !ingested.completions.isEmpty {
                        self.appendLogString("收到 \(ingested.completions.count) 条会话完成提醒，\(self.sessionNotifyStore.unreadCount) 个会话未读（\(SessionNotifyStore.reasonLabel(ingested.completions.last?.reason ?? ""))）\n")
                    }
                    if !ingested.resumed.isEmpty {
                        self.appendLogString("会话收到新消息，已撤销其完成提醒（\(ingested.resumed.count) 个会话）\n")
                    }
                    self.rebuildSessionNotifyMenuSection()
                }
            } else {
                self.sessionNotifyFailureStreak += 1
                if self.sessionNotifyFailureStreak == 40 && !self.sessionNotifyUnavailableLogged {
                    self.sessionNotifyUnavailableLogged = true
                    self.appendLogString("会话完成通知插件不可用（当前 Harness 未加载内置插件），重启 dsh 后可用\n")
                }
            }
            // 轮询顺带重绘角标，外观切换后最多滞后一个轮询周期。
            statusItem.button?.image = makeStatusImage()
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) {
                self.pollSessionNotify(port: port, loopID: loopID)
            }
        }
    }

    // MARK: - 插件更新检测

    /// 轮询内置 dsh-plugin-manager 的插件更新结果：仅在本启动器管理的 Harness
    /// 上存在；复用外部/旧实例时接口 404，静默降级（与会话完成通知一致）。
    /// 代际号随停止/重启递增，让旧轮询链自灭。
    private func monitorPluginUpdates(port: Int) {
        pluginUpdatesLoopID += 1
        let loopID = pluginUpdatesLoopID
        pluginUpdatesFailureStreak = 0
        pluginUpdatesAvailableCount = 0
        setPluginUpdatesMenuTitle(0)
        pollPluginUpdates(port: port, loopID: loopID)
        // 插件探测要联网、一次可能耗时几秒：等服务与插件加载稳定后只发一次
        // 刷新请求，结果由插件写进自己的缓存，下一轮轮询读回。
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, loopID == self.pluginUpdatesLoopID,
                  self.state == .running, self.selectedPort == port else { return }
            self.requestPluginUpdatesRefresh()
        }
    }

    private func pollPluginUpdates(port: Int, loopID: Int) {
        guard loopID == pluginUpdatesLoopID, state == .running, selectedPort == port else { return }
        // 开关只控制后台检测：关闭时连 GET 都不发（插件侧缓存过期时 GET 自身
        // 也会触发联网刷新）；轮询链保留，把开关重新打开即自动恢复。
        guard settings.autoCheckPluginUpdates,
              let url = URL(string: "http://127.0.0.1:\(port)/dsh-plugin-manager/updates") else {
            scheduleNextPluginUpdatesPoll(port: port, loopID: loopID)
            return
        }
        ServiceProbe.body(at: url, timeout: 2) { [weak self] body in
            guard let self, loopID == self.pluginUpdatesLoopID,
                  self.state == .running, self.selectedPort == port else { return }
            self.applyPluginUpdatesBody(body)
            self.scheduleNextPluginUpdatesPoll(port: port, loopID: loopID)
        }
    }

    private func scheduleNextPluginUpdatesPoll(port: Int, loopID: Int) {
        guard loopID == pluginUpdatesLoopID else { return }
        // 没有更新在跑时 10 秒够用；一旦插件在更新就快轮询，进度窗口才不会一跳一跳。
        let delay: TimeInterval = pluginUpdateProgressActive ? 1 : 10
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, loopID == self.pluginUpdatesLoopID,
                  self.state == .running, self.selectedPort == port else { return }
            self.pollPluginUpdates(port: port, loopID: loopID)
        }
    }

    private func applyPluginUpdatesBody(_ body: String?) {
        guard let snapshot = PluginUpdatesSnapshot.parse(body) else {
            // 404 / 格式不符都按「插件不可用」处理。插件加载要几秒，早期失败
            // 属于正常降级，攒够约一分钟再记一次日志（最多一次）。
            pluginUpdatesFailureStreak += 1
            if pluginUpdatesFailureStreak == 6 && !pluginUpdatesUnavailableLogged {
                pluginUpdatesUnavailableLogged = true
                appendLogString("插件更新接口不可用（当前 Harness 未加载插件管理器），后台自动检测已跳过\n")
            }
            return
        }
        pluginUpdatesFailureStreak = 0
        let count = max(snapshot.summary.updateAvailable, 0)
        if count != pluginUpdatesAvailableCount {
            appendLogString("插件更新检测：\(count) 个已安装插件可更新\n")
        }
        pluginUpdatesAvailableCount = count
        setPluginUpdatesMenuTitle(count)
        applyPluginUpdateProgress(snapshot.progress)
        applyPluginUpdateBatchResult(snapshot.lastBatch)
    }

    /// 把插件侧的更新进度映射到进度窗口：文案、进度条与 dsh 安装完全同款，
    /// 只有措辞不同（见 ProgressWindowWording.pluginUpdate）。
    private func applyPluginUpdateProgress(_ progress: PluginUpdatesSnapshot.Progress?) {
        let active = progress?.active == true
        pluginUpdateProgressActive = active
        guard active else {
            // 更新收尾：窗口切到"已完成"再自动收起，用户可以跟着进度条看到结束。
            guard pluginUpdateWindow != nil, !pluginUpdateDismissScheduled else { return }
            pluginUpdateDismissScheduled = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                guard let self else { return }
                self.pluginUpdateDismissScheduled = false
                self.pluginUpdateWindow?.dismiss()
                self.pluginUpdateWindow = nil
            }
            return
        }
        // dsh 正在安装/更新时不再叠一个插件窗口：两者都会重启 Harness。
        guard dshInstallWindow == nil else { return }

        guard let presentation = PluginUpdatePresentation.progress(progress) else { return }
        if pluginUpdateWindow == nil {
            pluginUpdateWindow = DSHInstallWindowController(wording: .pluginUpdate) { /* 隐藏窗口，不打断更新 */ }
            pluginUpdateWindow?.present()
        }
        pluginUpdateWindow?.update(status: presentation.status, detail: presentation.detail, percentage: presentation.percentage)
    }

    /// 批量更新结束（面板点了「全部更新」）：日志 + 窗口上给一句收尾。
    private func applyPluginUpdateBatchResult(_ batch: PluginUpdatesSnapshot.Batch?) {
        guard let finishedAt = batch?.finishedAt, !finishedAt.isEmpty else { return }
        // 同一个批次只收尾一次（轮询会反复读到同样的 finishedAt）。
        guard finishedAt != pluginUpdateFinishedAt else { return }
        guard let summary = PluginUpdatePresentation.batchSummary(batch) else { return }
        pluginUpdateFinishedAt = finishedAt
        appendLogString("\(summary)（插件批量更新）\n")
        pluginUpdateWindow?.update(status: summary, detail: "重启 dsh 之后新版本生效。", percentage: 100)
    }

    /// 触发插件后台刷新：`?refresh=1` 只发出去、不等长结果（探测结果由插件
    /// 写进缓存，下一轮轮询就能读到），避免阻塞主线程。
    private func requestPluginUpdatesRefresh() {
        guard settings.autoCheckPluginUpdates, state == .running, let port = selectedPort,
              let url = URL(string: "http://127.0.0.1:\(port)/dsh-plugin-manager/updates?refresh=1") else { return }
        ServiceProbe.body(at: url, timeout: 2) { _ in }
    }

    /// 菜单「插件管理」：与「打开 Deepseek Harness」一致，打开 Harness 页面
    /// （用户在那里手动检查/更新插件），不新增弹窗。
    @objc private func openPluginManager() {
        openDHL()
    }

    @objc private func openSessionFromNotify(_ sender: NSMenuItem) {
        let sessionId = sender.representedObject as? String
        sessionNotifyStore.markAllRead()
        rebuildSessionNotifyMenuSection()
        appendLogString("用户查看会话完成提醒：\(sessionId ?? "")\n")
        if state == .running, let port = selectedPort {
            openWebPage(on: port) { [weak self] in
                guard let sessionId else { return }
                self?.requestSessionOpen(sessionId: sessionId, port: port)
            }
        } else {
            openDHLForSession(sessionId)
        }
    }

    @objc private func clearSessionNotify() {
        sessionNotifyStore.markAllRead()
        rebuildSessionNotifyMenuSection()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuildSessionNotifyMenuSection()
    }
}

let app = NSApplication.shared; let delegate = DHLLauncher(); app.delegate = delegate; app.run()
