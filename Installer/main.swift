import AppKit
import Foundation

final class InstallerDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    /// 本次运行的安装日志路径，供失败文案引用（用户按「打开日志」的同一目录找）。
    private var installerLogPath = ""
    private var statusLabel: NSTextField!
    private var spinner: NSProgressIndicator!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.install()
        }
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 210),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.title = "双击完成安装或更新"
        window.isReleasedWhenClosed = false
        window.center()
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true

        let content = NSVisualEffectView(frame: window.contentView?.bounds ?? .zero)
        content.autoresizingMask = [.width, .height]
        content.material = .contentBackground
        content.blendingMode = .withinWindow
        content.state = .active
        window.contentView = content

        let iconView = NSImageView(frame: NSRect(x: 32, y: 82, width: 72, height: 72))
        iconView.image = Bundle.main.image(forResource: "DHL")
        iconView.imageScaling = .scaleProportionallyUpOrDown
        content.addSubview(iconView)

        let title = NSTextField(labelWithString: "正在安装 DHL")
        title.font = .systemFont(ofSize: 19, weight: .semibold)
        title.textColor = .labelColor
        title.frame = NSRect(x: 128, y: 129, width: 270, height: 28)
        // 定宽单行标签：默认 byClipping 会从字中间硬切，看不出还有内容被藏掉。
        title.lineBreakMode = .byTruncatingTail
        content.addSubview(title)

        statusLabel = NSTextField(wrappingLabelWithString: "正在退出旧版本并准备替换应用…")
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.frame = NSRect(x: 128, y: 83, width: 260, height: 38)
        // 状态行会带上安装目标路径，长路径必须在两行内收住（38pt 只放得下两行 13pt）。
        statusLabel.maximumNumberOfLines = 2
        statusLabel.lineBreakMode = .byTruncatingTail
        content.addSubview(statusLabel)

        spinner = NSProgressIndicator(frame: NSRect(x: 128, y: 57, width: 18, height: 18))
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.startAnimation(nil)
        content.addSubview(spinner)

        let detail = NSTextField(labelWithString: "完成后会自动重新启动 DHL。")
        detail.font = .systemFont(ofSize: 12)
        detail.textColor = .tertiaryLabelColor
        detail.frame = NSRect(x: 154, y: 56, width: 240, height: 18)
        detail.lineBreakMode = .byTruncatingTail
        content.addSubview(detail)
    }

    private func install() {
        let volumeURL = Bundle.main.bundleURL.deletingLastPathComponent()
        let bundledSource = Bundle.main.resourceURL?.appendingPathComponent("Deepseek Harness Launcher.app")
        let siblingSource = volumeURL.appendingPathComponent(".Deepseek Harness Launcher-payload.app")
        let legacySiblingSource = volumeURL.appendingPathComponent(".DHL-payload.app")
        let sourceApp = [bundledSource, siblingSource, legacySiblingSource].compactMap { $0 }.first {
            FileManager.default.fileExists(atPath: $0.path)
        }
        let script = Bundle.main.resourceURL?.appendingPathComponent("install-from-app.sh")
        let destination = preferredInstallDirectory()

        guard let sourceApp,
              let script, FileManager.default.isExecutableFile(atPath: script.path) else {
            finishFailure("未找到安装包内容。请重新下载完整的 Deepseek Harness Launcher.dmg 后打开安装器。")
            return
        }

        // 日志路径只算一次：文件名带秒级时间戳，算两次可能跨秒，
        // 失败文案里告诉用户的路径就和真正写的那份不是同一个文件。
        let logURL = installerLogURL()
        installerLogPath = logURL.path
        setStatus("正在退出旧版本并替换到 \(destination.path)…")
        let arguments = [script.path, sourceApp.path, destination.path, "--no-open"]
        let result = runInstaller(arguments: arguments, needsAdmin: needsAdministrator(for: destination), logURL: logURL)

        if result.status == Self.installTimeoutExitCode {
            // 超时不是「脚本失败」：文案由看门狗写好（含「别重复打开安装器」），
            // 不再拼一遍脚本残存输出，免得用户以为已经出错。
            finishFailure(result.output, title: "安装尚未确认完成")
            return
        }
        guard result.status == 0 else {
            let detail = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
            finishFailure("""
            \(detail.isEmpty ? "安装失败，请关闭 DHL 后重试。" : detail)

            安装日志：\(installerLogPath)
            """)
            return
        }

        let target = destination.appendingPathComponent("Deepseek Harness Launcher.app")
        guard FileManager.default.fileExists(atPath: target.path) else {
            finishFailure("安装完成后未找到 Deepseek Harness Launcher.app。")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.spinner.stopAnimation(nil)
            self.statusLabel.stringValue = "已更新，正在重新启动 DHL…"
            NSWorkspace.shared.open(target)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) {
                NSApp.terminate(nil)
            }
        }
    }

    private func preferredInstallDirectory() -> URL {
        let applications = URL(fileURLWithPath: "/Applications", isDirectory: true)
        if FileManager.default.fileExists(atPath: applications.appendingPathComponent("Deepseek Harness Launcher.app").path) ||
            FileManager.default.fileExists(atPath: applications.appendingPathComponent("DHL.app").path) ||
            FileManager.default.fileExists(atPath: applications.appendingPathComponent("DSH.app").path) ||
            FileManager.default.isWritableFile(atPath: applications.path) {
            return applications
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
    }

    private func needsAdministrator(for destination: URL) -> Bool {
        destination.path.hasPrefix("/Applications") && !FileManager.default.isWritableFile(atPath: destination.path)
    }

    /// 看门狗上限：正常替换是秒级，多出来的时间全部留给「管理员授权弹窗等人输入」。
    static let installTimeoutSeconds: TimeInterval = 15 * 60
    /// 超时专用退出码（124 = GNU timeout 的约定），与脚本自身的失败区分开。
    static let installTimeoutExitCode: Int32 = 124

    private func runInstaller(
        arguments: [String],
        needsAdmin: Bool,
        logURL: URL
    ) -> (status: Int32, output: String) {
        // 子进程输出写文件、不写管道：超时之后安装器会退出，管道读端一关，还在跑的
        // `ditto`/`cp` 就会吃到 SIGPIPE——那才是真的把半份安装留在磁盘上。
        guard prepareLogFile(logURL), let handle = try? FileHandle(forWritingTo: logURL) else {
            return (1, "无法写入安装日志：\(logURL.path)（目录不可写或磁盘已满）")
        }
        let task = Process()
        task.standardOutput = handle
        task.standardError = handle
        let userHome = FileManager.default.homeDirectoryForCurrentUser.path

        if needsAdmin {
            let command = "DHL_USER_HOME=\(shellQuote(userHome)) " + arguments.map(shellQuote).joined(separator: " ")
            let appleScript = "do shell script \"\(escapeAppleScript(command))\" with administrator privileges"
            task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            task.arguments = ["-e", appleScript]
        } else {
            task.executableURL = URL(fileURLWithPath: "/bin/zsh")
            task.arguments = arguments
            var environment = ProcessInfo.processInfo.environment
            environment["DHL_USER_HOME"] = userHome
            task.environment = environment
        }

        do {
            try task.run()
        } catch {
            try? handle.close()
            return (1, error.localizedDescription)
        }
        // 子进程持有自己那份 fd，父进程可以立刻关掉。
        try? handle.close()

        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .userInitiated).async {
            task.waitUntilExit()
            finished.signal()
        }
        let tail = installerLogTail(logURL)
        guard finished.wait(timeout: .now() + Self.installTimeoutSeconds) == .success else {
            // 卡死的安装器没有关闭按钮（不让用户中途打断文件替换），所以只能自己收场：
            // 否则用户只剩「强制退出」一条路，正是这次事故的形态。
            // 这里**故意不 kill 子进程**：脚本可能正停在 `mv` 旧 App / `ditto` 新 App
            // 中间，从外面打断会留下半份安装，比多等一会儿更糟。安装器只是把界面还给用户。
            let minutes = Int(Self.installTimeoutSeconds / 60)
            return (Self.installTimeoutExitCode, """
            安装器等了 \(minutes) 分钟还没等到结果，这个窗口先关闭。
            安装脚本可能仍在后台继续：请不要立刻再开一次安装器（两个脚本会抢同一份文件）。
            稍后到「应用程序」里确认 DHL 是否已更新；没有的话等一两分钟再重开安装器。
            安装日志：\(logURL.path)
            """)
        }
        return (task.terminationStatus, tail)
    }

    /// 安装日志位置：与启动器的 `dhl.log` 同一个目录，用户在「打开日志」里就能找到。
    private func installerLogURL() -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let directory = home.appendingPathComponent("Library/Logs/Deepseek Harness Launcher", isDirectory: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return directory.appendingPathComponent("installer-\(formatter.string(from: Date())).log")
    }

    /// 建目录与空文件；失败返回 false（调用方直接报错，不再静默丢弃输出）。
    private func prepareLogFile(_ url: URL) -> Bool {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !fm.fileExists(atPath: url.path) {
                fm.createFile(atPath: url.path, contents: nil)
            }
            return fm.isWritableFile(atPath: url.path)
        } catch {
            return false
        }
    }

    /// 只取日志尾部：npm / cp 的报错都在最后，而超长正文由 AlertBoundary 折进滚动面板，
    /// 这里再兜一层上限，避免一次读进几十 MB。
    private func installerLogTail(_ url: URL, maxBytes: Int = 64 * 1024) -> String {
        guard let data = try? Data(contentsOf: url) else { return "" }
        let slice = data.count > maxBytes ? data.suffix(maxBytes) : data
        return String(data: slice, encoding: .utf8) ?? ""
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }

    private func escapeAppleScript(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }

    private func setStatus(_ text: String) {
        DispatchQueue.main.async { [weak self] in
            self?.statusLabel.stringValue = text
        }
    }

    private func finishFailure(_ message: String, title: String = "未能安装 DHL") {
        DispatchQueue.main.async { [weak self] in
            self?.spinner.stopAnimation(nil)
            self?.window.orderOut(nil)
            let alert = NSAlert()
            alert.messageText = title
            alert.alertStyle = .critical
            // 失败原因来自 install-from-app.sh 的原始输出，长度不可控（npm / cp / hdiutil
            // 的报错可能上百行）。护栏必须装在这里：正文超阈值就折进高度封顶的可滚动面板，
            // 否则 NSAlert 会随行数长到比屏幕还高，按钮落到屏幕外、runModal 又关不掉，
            // 而安装器主窗口连关闭按钮都没有——只能强杀。见 docs/ui-boundary-audit.md。
            AlertBoundary.setBoundedText(
                message,
                on: alert,
                summary: "安装没有完成。完整原因可在下方滚动查看。",
                width: 360
            )
            alert.addButton(withTitle: "好")
            AlertBoundary.run(alert, escapeButtonIndex: 0)
            NSApp.terminate(nil)
        }
    }
}

let app = NSApplication.shared
let delegate = InstallerDelegate()
app.delegate = delegate
app.run()
