import AppKit
import Foundation

final class UpdateDownloadWindowController: NSWindowController, NSWindowDelegate {
    private let versionLabel: NSTextField
    private let progress: NSProgressIndicator
    private let detailLabel: NSTextField

    init(version: String) {
        versionLabel = NSTextField(labelWithString: "正在更新到 v\(version)…")
        progress = NSProgressIndicator()
        detailLabel = NSTextField(labelWithString: "正在准备下载…")

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 220),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = LauncherBrand.fullName
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        configureWindow()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present() {
        guard let window else { return }
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func update(_ snapshot: UpdateDownloadProgress) {
        if let fraction = snapshot.fraction {
            progress.isIndeterminate = false
            progress.stopAnimation(nil)
            progress.doubleValue = fraction * 100
            detailLabel.stringValue = "正在下载 \(Int((fraction * 100).rounded()))%（\(byteText(snapshot.bytesWritten))/\(byteText(snapshot.totalBytes ?? snapshot.bytesWritten))）"
        } else {
            progress.isIndeterminate = true
            progress.startAnimation(nil)
            detailLabel.stringValue = "正在下载…（已完成 \(byteText(snapshot.bytesWritten))）"
        }
    }

    func dismiss() {
        window?.orderOut(nil)
    }

    private func configureWindow() {
        guard let window, let contentView = window.contentView else { return }
        let effect = NSVisualEffectView(frame: contentView.bounds)
        effect.autoresizingMask = [.width, .height]
        effect.material = .contentBackground
        effect.blendingMode = .withinWindow
        effect.state = .active
        contentView.addSubview(effect)

        let icon = NSImageView(frame: NSRect(x: 34, y: 78, width: 64, height: 64))
        icon.image = Bundle.main.image(forResource: "DHL")
        icon.imageScaling = .scaleProportionallyUpOrDown
        effect.addSubview(icon)

        versionLabel.frame = NSRect(x: 126, y: 145, width: 390, height: 30)
        versionLabel.font = .systemFont(ofSize: 21, weight: .semibold)
        versionLabel.textColor = .labelColor
        effect.addSubview(versionLabel)

        progress.frame = NSRect(x: 126, y: 103, width: 390, height: 18)
        progress.style = .bar
        progress.controlSize = .regular
        progress.minValue = 0
        progress.maxValue = 100
        progress.isIndeterminate = true
        progress.isDisplayedWhenStopped = true
        progress.startAnimation(nil)
        effect.addSubview(progress)

        detailLabel.frame = NSRect(x: 126, y: 66, width: 390, height: 24)
        detailLabel.font = .systemFont(ofSize: 15)
        detailLabel.textColor = .secondaryLabelColor
        effect.addSubview(detailLabel)

        window.delegate = self
        window.standardWindowButton(.miniaturizeButton)?.isEnabled = true
        window.standardWindowButton(.closeButton)?.toolTip = "关闭窗口（下载继续）"
    }

    private func byteText(_ bytes: Int64) -> String {
        let value = Double(max(0, bytes))
        if value >= 1024 * 1024 {
            return String(format: "%.0f MB", value / (1024 * 1024))
        }
        if value >= 1024 {
            return String(format: "%.0f KB", value / 1024)
        }
        return "\(bytes) B"
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        true
    }
}
