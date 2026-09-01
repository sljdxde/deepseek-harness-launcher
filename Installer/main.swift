import AppKit
import Foundation

final class InstallerDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
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

        let title = NSTextField(labelWithString: "正在安装 Deepseek Harness Launcher")
        title.font = .systemFont(ofSize: 19, weight: .semibold)
        title.textColor = .labelColor
        title.frame = NSRect(x: 128, y: 129, width: 270, height: 28)
        content.addSubview(title)

        statusLabel = NSTextField(wrappingLabelWithString: "正在退出旧版本并准备替换应用…")
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.frame = NSRect(x: 128, y: 83, width: 260, height: 38)
        content.addSubview(statusLabel)

        spinner = NSProgressIndicator(frame: NSRect(x: 128, y: 57, width: 18, height: 18))
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.startAnimation(nil)
        content.addSubview(spinner)

        let detail = NSTextField(labelWithString: "完成后会自动重新启动 Deepseek Harness Launcher。")
        detail.font = .systemFont(ofSize: 12)
        detail.textColor = .tertiaryLabelColor
        detail.frame = NSRect(x: 154, y: 56, width: 240, height: 18)
        content.addSubview(detail)
    }

    private func install() {
        let volumeURL = Bundle.main.bundleURL.deletingLastPathComponent()
        let sourceApp = volumeURL.appendingPathComponent(".DHL-payload.app")
        let script = Bundle.main.resourceURL?.appendingPathComponent("install-from-app.sh")
        let destination = preferredInstallDirectory()

        guard FileManager.default.fileExists(atPath: sourceApp.path),
              let script, FileManager.default.isExecutableFile(atPath: script.path) else {
            finishFailure("未找到安装包内容。请从 DHL.dmg 中直接打开“双击完成安装或更新”。")
            return
        }

        setStatus("正在退出旧版本并替换到 \(destination.path)…")
        let arguments = [script.path, sourceApp.path, destination.path, "--no-open"]
        let result = runInstaller(arguments: arguments, needsAdmin: needsAdministrator(for: destination))

        guard result.status == 0 else {
            let detail = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
            finishFailure(detail.isEmpty ? "安装失败，请关闭 Deepseek Harness Launcher 后重试。" : detail)
            return
        }

        let target = destination.appendingPathComponent("DHL.app")
        guard FileManager.default.fileExists(atPath: target.path) else {
            finishFailure("安装完成后未找到 DHL.app。")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.spinner.stopAnimation(nil)
            self.statusLabel.stringValue = "已更新，正在重新启动 Deepseek Harness Launcher…"
            NSWorkspace.shared.open(target)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) {
                NSApp.terminate(nil)
            }
        }
    }

    private func preferredInstallDirectory() -> URL {
        let applications = URL(fileURLWithPath: "/Applications", isDirectory: true)
        if FileManager.default.fileExists(atPath: applications.appendingPathComponent("DHL.app").path) ||
            FileManager.default.fileExists(atPath: applications.appendingPathComponent("DSH.app").path) ||
            FileManager.default.isWritableFile(atPath: applications.path) {
            return applications
        }
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
    }

    private func needsAdministrator(for destination: URL) -> Bool {
        destination.path.hasPrefix("/Applications") && !FileManager.default.isWritableFile(atPath: destination.path)
    }

    private func runInstaller(arguments: [String], needsAdmin: Bool) -> (status: Int32, output: String) {
        let task = Process()
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe

        if needsAdmin {
            let command = arguments.map(shellQuote).joined(separator: " ")
            let appleScript = "do shell script \"\(escapeAppleScript(command))\" with administrator privileges"
            task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            task.arguments = ["-e", appleScript]
        } else {
            task.executableURL = URL(fileURLWithPath: "/bin/zsh")
            task.arguments = arguments
        }

        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return (1, error.localizedDescription)
        }

        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return (task.terminationStatus, output)
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

    private func finishFailure(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.spinner.stopAnimation(nil)
            self?.window.orderOut(nil)
            let alert = NSAlert()
            alert.messageText = "未能安装 Deepseek Harness Launcher"
            alert.informativeText = message
            alert.alertStyle = .critical
            alert.addButton(withTitle: "好")
            alert.runModal()
            NSApp.terminate(nil)
        }
    }
}

let app = NSApplication.shared
let delegate = InstallerDelegate()
app.delegate = delegate
app.run()
