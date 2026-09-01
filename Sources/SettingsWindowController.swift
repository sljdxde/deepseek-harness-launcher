import AppKit
import Foundation

final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    private let onSave: () -> Void
    private let onCheckNow: () -> Void
    private let settings = LauncherSettings.shared

    private let autoUpdateCheckbox = NSButton(checkboxWithTitle: "自动检查更新", target: nil, action: nil)
    private let openBrowserCheckbox = NSButton(checkboxWithTitle: "DHL 就绪后自动打开浏览器", target: nil, action: nil)
    private let launchAtLoginCheckbox = NSButton(checkboxWithTitle: "登录 macOS 时自动启动 DHL", target: nil, action: nil)
    private let intervalField = NSTextField(string: "6")

    init(onSave: @escaping () -> Void, onCheckNow: @escaping () -> Void) {
        self.onSave = onSave
        self.onCheckNow = onCheckNow

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 600, height: 460),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "DHL 设置"
        window.isReleasedWhenClosed = false
        // Keep a native glass surface without letting the desktop bleed
        // through and wash out the settings text.
        window.isOpaque = true
        window.backgroundColor = .windowBackgroundColor
        window.titlebarAppearsTransparent = false
        window.titleVisibility = .visible
        window.minSize = NSSize(width: 560, height: 430)
        window.delegate = nil
        super.init(window: window)
        window.delegate = self
        configureWindow()
        loadSettings()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present() {
        guard let window else { return }
        if !window.isVisible { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func configureWindow() {
        guard let window else { return }
        guard let contentView = window.contentView else { return }

        let visualEffect = NSVisualEffectView()
        visualEffect.translatesAutoresizingMaskIntoConstraints = false
        visualEffect.material = .contentBackground
        visualEffect.blendingMode = .withinWindow
        visualEffect.state = .active
        visualEffect.alphaValue = 1
        visualEffect.wantsLayer = true
        visualEffect.layer?.cornerRadius = 12
        visualEffect.layer?.masksToBounds = true
        contentView.addSubview(visualEffect)
        NSLayoutConstraint.activate([
            visualEffect.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            visualEffect.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            visualEffect.topAnchor.constraint(equalTo: contentView.topAnchor),
            visualEffect.bottomAnchor.constraint(equalTo: contentView.bottomAnchor)
        ])

        let root = NSView()
        root.translatesAutoresizingMaskIntoConstraints = false
        visualEffect.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: visualEffect.leadingAnchor, constant: 30),
            root.trailingAnchor.constraint(equalTo: visualEffect.trailingAnchor, constant: -30),
            root.topAnchor.constraint(equalTo: visualEffect.topAnchor, constant: 24),
            root.bottomAnchor.constraint(equalTo: visualEffect.bottomAnchor, constant: -22)
        ])

        let title = makeLabel("DHL 设置", size: 21, weight: .semibold, color: .labelColor)
        let subtitle = makeLabel("启动器偏好与更新", size: 13, weight: .regular, color: .secondaryLabelColor)
        root.addSubview(title)
        root.addSubview(subtitle)
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            title.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor),
            title.topAnchor.constraint(equalTo: root.topAnchor),
            subtitle.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            subtitle.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 4)
        ])

        let startupCard = makeCard()
        let startupTitle = makeLabel("启动行为", size: 13, weight: .semibold, color: .secondaryLabelColor)
        startupCard.addSubview(startupTitle)
        configureCheckbox(openBrowserCheckbox)
        configureCheckbox(launchAtLoginCheckbox)
        startupCard.addSubview(openBrowserCheckbox)
        startupCard.addSubview(launchAtLoginCheckbox)
        NSLayoutConstraint.activate([
            startupTitle.leadingAnchor.constraint(equalTo: startupCard.leadingAnchor, constant: 16),
            startupTitle.topAnchor.constraint(equalTo: startupCard.topAnchor, constant: 12),
            openBrowserCheckbox.leadingAnchor.constraint(equalTo: startupCard.leadingAnchor, constant: 16),
            openBrowserCheckbox.topAnchor.constraint(equalTo: startupTitle.bottomAnchor, constant: 8),
            openBrowserCheckbox.trailingAnchor.constraint(lessThanOrEqualTo: startupCard.trailingAnchor, constant: -16),
            launchAtLoginCheckbox.leadingAnchor.constraint(equalTo: startupCard.leadingAnchor, constant: 16),
            launchAtLoginCheckbox.topAnchor.constraint(equalTo: openBrowserCheckbox.bottomAnchor, constant: 4),
            launchAtLoginCheckbox.trailingAnchor.constraint(lessThanOrEqualTo: startupCard.trailingAnchor, constant: -16),
            startupCard.heightAnchor.constraint(equalToConstant: 104)
        ])
        root.addSubview(startupCard)
        NSLayoutConstraint.activate([
            startupCard.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            startupCard.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            startupCard.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 20)
        ])

        let updateCard = makeCard()
        let updateTitle = makeLabel("自动更新", size: 13, weight: .semibold, color: .secondaryLabelColor)
        updateCard.addSubview(updateTitle)
        configureCheckbox(autoUpdateCheckbox)
        updateCard.addSubview(autoUpdateCheckbox)

        let intervalLabel = makeLabel("检查频率", size: 13, weight: .regular, color: .labelColor)
        let intervalSuffix = makeLabel("小时一次", size: 13, weight: .regular, color: .secondaryLabelColor)
        updateCard.addSubview(intervalLabel)
        updateCard.addSubview(intervalSuffix)
        configureTextField(intervalField, placeholder: "6")
        intervalField.alignment = .right
        intervalField.widthAnchor.constraint(equalToConstant: 64).isActive = true
        updateCard.addSubview(intervalField)

        let sourceLabel = makeLabel("更新来源", size: 13, weight: .regular, color: .labelColor)
        let sourceValue = makeLabel("GitHub Releases · deepseek-harness-launcher", size: 13, weight: .regular, color: .secondaryLabelColor)
        updateCard.addSubview(sourceLabel)
        updateCard.addSubview(sourceValue)

        NSLayoutConstraint.activate([
            updateTitle.leadingAnchor.constraint(equalTo: updateCard.leadingAnchor, constant: 16),
            updateTitle.topAnchor.constraint(equalTo: updateCard.topAnchor, constant: 12),
            autoUpdateCheckbox.leadingAnchor.constraint(equalTo: updateCard.leadingAnchor, constant: 16),
            autoUpdateCheckbox.topAnchor.constraint(equalTo: updateTitle.bottomAnchor, constant: 8),
            autoUpdateCheckbox.trailingAnchor.constraint(lessThanOrEqualTo: updateCard.trailingAnchor, constant: -16),
            intervalLabel.leadingAnchor.constraint(equalTo: updateCard.leadingAnchor, constant: 16),
            intervalLabel.centerYAnchor.constraint(equalTo: intervalField.centerYAnchor),
            intervalField.leadingAnchor.constraint(equalTo: updateCard.leadingAnchor, constant: 150),
            intervalField.topAnchor.constraint(equalTo: autoUpdateCheckbox.bottomAnchor, constant: 7),
            intervalField.heightAnchor.constraint(equalToConstant: 26),
            intervalSuffix.leadingAnchor.constraint(equalTo: intervalField.trailingAnchor, constant: 8),
            intervalSuffix.centerYAnchor.constraint(equalTo: intervalField.centerYAnchor),
            sourceLabel.leadingAnchor.constraint(equalTo: updateCard.leadingAnchor, constant: 16),
            sourceLabel.centerYAnchor.constraint(equalTo: sourceValue.centerYAnchor),
            sourceValue.leadingAnchor.constraint(equalTo: updateCard.leadingAnchor, constant: 150),
            sourceValue.trailingAnchor.constraint(lessThanOrEqualTo: updateCard.trailingAnchor, constant: -16),
            sourceValue.topAnchor.constraint(equalTo: intervalField.bottomAnchor, constant: 12),
            updateCard.heightAnchor.constraint(equalToConstant: 142)
        ])
        root.addSubview(updateCard)
        NSLayoutConstraint.activate([
            updateCard.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            updateCard.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            updateCard.topAnchor.constraint(equalTo: startupCard.bottomAnchor, constant: 14)
        ])

        let versionLabel = makeLabel("当前版本 v\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0")", size: 12, weight: .regular, color: .secondaryLabelColor)
        root.addSubview(versionLabel)

        let checkButton = NSButton(title: "检查更新", target: self, action: #selector(checkNow))
        checkButton.bezelStyle = .rounded
        checkButton.controlSize = .regular
        checkButton.setContentHuggingPriority(.required, for: .horizontal)
        let cancelButton = NSButton(title: "取消", target: self, action: #selector(cancel))
        cancelButton.bezelStyle = .rounded
        cancelButton.controlSize = .regular
        cancelButton.setContentHuggingPriority(.required, for: .horizontal)
        let saveButton = NSButton(title: "保存", target: self, action: #selector(save))
        saveButton.bezelStyle = .rounded
        saveButton.controlSize = .regular
        saveButton.keyEquivalent = "\r"
        saveButton.setContentHuggingPriority(.required, for: .horizontal)
        let buttons = NSStackView(views: [checkButton, cancelButton, saveButton])
        buttons.orientation = .horizontal
        buttons.spacing = 8
        buttons.alignment = .centerY
        buttons.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(buttons)
        NSLayoutConstraint.activate([
            versionLabel.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            versionLabel.centerYAnchor.constraint(equalTo: buttons.centerYAnchor),
            buttons.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            buttons.topAnchor.constraint(equalTo: updateCard.bottomAnchor, constant: 16),
            buttons.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        window.standardWindowButton(.closeButton)?.toolTip = "关闭设置"
        window.standardWindowButton(.miniaturizeButton)?.isEnabled = true
        window.standardWindowButton(.zoomButton)?.isEnabled = true
    }

    private func makeCard() -> NSView {
        let card = NSView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.wantsLayer = true
        card.layer?.cornerRadius = 12
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.78).cgColor
        card.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.75).cgColor
        card.layer?.borderWidth = 1
        return card
    }

    private func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = NSFont.systemFont(ofSize: size, weight: weight)
        label.textColor = color
        label.lineBreakMode = .byTruncatingTail
        return label
    }

    private func configureCheckbox(_ checkbox: NSButton) {
        checkbox.translatesAutoresizingMaskIntoConstraints = false
        checkbox.setButtonType(.switch)
        checkbox.font = NSFont.systemFont(ofSize: 13)
        // Keep the switch glyph native while retaining readable label color.
        checkbox.contentTintColor = .labelColor
        checkbox.setContentHuggingPriority(.defaultHigh, for: .horizontal)
    }

    private func configureTextField(_ field: NSTextField, placeholder: String) {
        field.translatesAutoresizingMaskIntoConstraints = false
        field.placeholderString = placeholder
        field.font = NSFont.systemFont(ofSize: 13)
        field.bezelStyle = .roundedBezel
        field.drawsBackground = true
        field.backgroundColor = .textBackgroundColor
        field.textColor = .textColor
        field.focusRingType = .default
        field.lineBreakMode = .byTruncatingTail
    }

    private func loadSettings() {
        autoUpdateCheckbox.state = settings.autoUpdateEnabled ? .on : .off
        openBrowserCheckbox.state = settings.openBrowserOnReady ? .on : .off
        launchAtLoginCheckbox.state = settings.launchAtLogin ? .on : .off
        intervalField.stringValue = String(format: "%.0f", settings.updateIntervalHours)
    }

    @objc private func checkNow() {
        onCheckNow()
    }

    @objc private func cancel() {
        window?.close()
    }

    @objc private func save() {
        settings.autoUpdateEnabled = autoUpdateCheckbox.state == .on
        settings.openBrowserOnReady = openBrowserCheckbox.state == .on
        settings.launchAtLogin = launchAtLoginCheckbox.state == .on
        settings.updateIntervalHours = max(intervalField.doubleValue, 1)

        do {
            try LoginItemManager.setEnabled(settings.launchAtLogin)
        } catch {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "开机启动设置失败"
            alert.informativeText = error.localizedDescription
            alert.addButton(withTitle: "好")
            alert.runModal()
            return
        }

        onSave()
        window?.close()
    }
}
