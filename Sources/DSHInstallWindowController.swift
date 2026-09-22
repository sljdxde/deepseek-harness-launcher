import AppKit
import Foundation

/// 进度窗口的文案角色：dsh 安装、插件更新共用同一套窗口布局、进度条与"已用时长"，
/// 让三种更新（启动器自身 / dsh / 插件）的进度界面观感一致。
/// `dshInstall` 的文案就是原来硬编码的那一份，保持默认行为不变。
struct ProgressWindowWording {
    var title: String
    var status: String
    var command: String
    var detail: String
    var progressIdle: String
    var progressFormat: String
    var actionTitle: String
    var note: String
    var cancellingStatus: String
    var cancellingDetail: String
    /// true 表示那个按钮是"隐藏窗口"（更新继续），false 表示真的取消。
    var actionHides: Bool

    static let dshInstall = ProgressWindowWording(
        title: "Deepseek Harness 安装",
        status: "本地未检测到 DeepSeek Harness",
        command: "安装命令：npx @deepseek-ai/dsh web",
        detail: "正在执行下载安装，请保持网络连接。",
        progressIdle: "安装进度：正在下载 npm 依赖",
        progressFormat: "安装进度：%.2f%%",
        actionTitle: "取消安装",
        note: "安装完成后会自动打开 DeepSeek Harness Web 页面。",
        cancellingStatus: "正在取消安装…",
        cancellingDetail: "正在清理临时安装目录。",
        actionHides: false
    )

    static let pluginUpdate = ProgressWindowWording(
        title: "插件更新",
        status: "正在更新插件…",
        command: "更新方式：dsh plugin update（pnpm）",
        detail: "正在下载并安装新版本，请保持网络连接。",
        progressIdle: "更新进度：正在准备…",
        progressFormat: "更新进度：%.2f%%",
        actionTitle: "隐藏窗口",
        note: "服务端插件代码在重启 dsh 之后生效。",
        cancellingStatus: "正在隐藏窗口…",
        cancellingDetail: "更新会继续在后台进行。",
        actionHides: true
    )
}

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
    private let wording: ProgressWindowWording

    convenience init(commandText: String = "安装命令：npx @deepseek-ai/dsh web", onCancel: @escaping () -> Void) {
        var dictionary = ProgressWindowWording.dshInstall
        dictionary.command = commandText
        self.init(wording: dictionary, onCancel: onCancel)
    }

    init(wording: ProgressWindowWording, onCancel: @escaping () -> Void) {
        self.onCancel = onCancel
        self.wording = wording
        statusLabel = NSTextField(labelWithString: wording.status)
        commandLabel = NSTextField(labelWithString: wording.command)
        detailLabel = NSTextField(wrappingLabelWithString: wording.detail)
        progress = NSProgressIndicator()
        progressLabel = NSTextField(labelWithString: wording.progressIdle)
        cancelButton = NSButton(title: wording.actionTitle, target: nil, action: nil)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 280),
            // 三种更新（启动器 / dsh / 插件）都用这个窗口：必须能最小化，
            // 更新跑几分钟时用户可以把它收进 Dock，不影响干活。
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = wording.title
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)
        baseDetail = wording.detail
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
            progressLabel.stringValue = String(format: wording.progressFormat, locale: Locale(identifier: "en_US_POSIX"), percentage)
        } else {
            progressLabel.stringValue = wording.progressIdle
        }
        refreshElapsedDetail()
    }

    func markCancelling() {
        cancelButton.isEnabled = false
        statusLabel.stringValue = wording.cancellingStatus
        detailLabel.stringValue = wording.cancellingDetail
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

        let note = NSTextField(labelWithString: wording.note)
        note.frame = NSRect(x: 108, y: 18, width: 350, height: 20)
        note.font = .systemFont(ofSize: 12)
        note.textColor = .tertiaryLabelColor
        effect.addSubview(note)

        window.delegate = self
    }

    @objc private func cancelPressed() {
        // 插件更新走 pnpm，中途打断只会留下半个 profile：那个按钮是"隐藏窗口"。
        if wording.actionHides {
            dismiss()
            return
        }
        onCancel()
    }
}

extension DSHInstallWindowController: NSWindowDelegate {
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if wording.actionHides {
            dismiss()
            return false
        }
        onCancel()
        return false
    }
}
