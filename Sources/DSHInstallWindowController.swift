import AppKit
import Foundation

final class DSHInstallWindowController: NSWindowController {
    private let statusLabel: NSTextField
    private let commandLabel: NSTextField
    private let detailLabel: NSTextField
    private let progress: NSProgressIndicator
    private let progressLabel: NSTextField
    private let cancelButton: NSButton
    private let onCancel: () -> Void
    private var elapsedTimer: Timer?
    private var startedAt = Date()
    private var baseDetail = "正在执行下载安装，请保持网络连接。"

    init(onCancel: @escaping () -> Void) {
        self.onCancel = onCancel
        statusLabel = NSTextField(labelWithString: "本地未检测到 DeepSeek Harness")
        commandLabel = NSTextField(labelWithString: "安装命令：npx @deepseek-ai/dsh web")
        detailLabel = NSTextField(wrappingLabelWithString: "正在执行下载安装，请保持网络连接。")
        progress = NSProgressIndicator()
        progressLabel = NSTextField(labelWithString: "安装进度：正在下载 npm 依赖")
        cancelButton = NSButton(title: "取消安装", target: nil, action: nil)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 280),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "首次安装 dsh"
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
        if elapsedTimer == nil {
            startedAt = Date()
            elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                self?.refreshElapsedDetail()
            }
        }
        refreshElapsedDetail()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func update(status: String, detail: String? = nil, percentage: Double? = nil) {
        statusLabel.stringValue = status
        if let detail, !detail.isEmpty {
            baseDetail = detail
        }
        progress.isIndeterminate = percentage == nil
        if progress.isIndeterminate {
            progress.startAnimation(nil)
        } else {
            progress.stopAnimation(nil)
            progress.doubleValue = max(0, min(100, percentage ?? 0))
        }
        if let percentage {
            progressLabel.stringValue = String(format: "安装进度：%.2f%%", locale: Locale(identifier: "en_US_POSIX"), percentage)
        } else {
            progressLabel.stringValue = "安装进度：正在下载 npm 依赖"
        }
        refreshElapsedDetail()
    }

    func markCancelling() {
        cancelButton.isEnabled = false
        statusLabel.stringValue = "正在取消安装…"
        detailLabel.stringValue = "正在清理临时安装目录。"
    }

    func dismiss() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        window?.orderOut(nil)
    }

    deinit {
        elapsedTimer?.invalidate()
    }

    private func refreshElapsedDetail() {
        let elapsed = max(0, Int(Date().timeIntervalSince(startedAt)))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        let duration = minutes > 0 ? "已等待 \(minutes) 分 \(seconds) 秒" : "已等待 \(seconds) 秒"
        detailLabel.stringValue = "\(baseDetail)\n\(duration)"
    }

    private func configureWindow() {
        guard let window, let contentView = window.contentView else { return }
        let effect = NSVisualEffectView(frame: contentView.bounds)
        effect.autoresizingMask = [.width, .height]
        effect.material = .contentBackground
        effect.blendingMode = .withinWindow
        effect.state = .active
        contentView.addSubview(effect)

        let icon = NSImageView(frame: NSRect(x: 28, y: 180, width: 58, height: 58))
        icon.image = Bundle.main.image(forResource: "DHL")
        icon.imageScaling = .scaleProportionallyUpOrDown
        effect.addSubview(icon)

        statusLabel.frame = NSRect(x: 108, y: 218, width: 350, height: 24)
        statusLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        statusLabel.textColor = .labelColor
        effect.addSubview(statusLabel)

        commandLabel.frame = NSRect(x: 108, y: 193, width: 350, height: 18)
        commandLabel.font = .systemFont(ofSize: 12, weight: .medium)
        commandLabel.textColor = .secondaryLabelColor
        effect.addSubview(commandLabel)

        detailLabel.frame = NSRect(x: 108, y: 130, width: 350, height: 54)
        detailLabel.font = .systemFont(ofSize: 13)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.maximumNumberOfLines = 3
        effect.addSubview(detailLabel)

        progress.frame = NSRect(x: 108, y: 88, width: 210, height: 18)
        progress.style = .bar
        progress.controlSize = .regular
        progress.minValue = 0
        progress.maxValue = 100
        progress.isIndeterminate = true
        progress.isDisplayedWhenStopped = true
        progress.isHidden = false
        effect.addSubview(progress)

        progressLabel.frame = NSRect(x: 108, y: 62, width: 350, height: 18)
        progressLabel.font = .systemFont(ofSize: 12)
        progressLabel.textColor = .secondaryLabelColor
        effect.addSubview(progressLabel)

        cancelButton.frame = NSRect(x: 335, y: 82, width: 120, height: 30)
        cancelButton.bezelStyle = .rounded
        cancelButton.target = self
        cancelButton.action = #selector(cancelPressed)
        effect.addSubview(cancelButton)

        let note = NSTextField(labelWithString: "安装完成后会自动打开 DeepSeek Harness Web 页面。")
        note.frame = NSRect(x: 108, y: 18, width: 350, height: 20)
        note.font = .systemFont(ofSize: 12)
        note.textColor = .tertiaryLabelColor
        effect.addSubview(note)

        window.delegate = self
    }

    @objc private func cancelPressed() {
        onCancel()
    }
}

extension DSHInstallWindowController: NSWindowDelegate {
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        onCancel()
        return false
    }
}
