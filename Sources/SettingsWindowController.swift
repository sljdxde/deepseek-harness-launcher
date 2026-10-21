import AppKit
import Foundation

/// 设置窗口。
///
/// 版式约定（改这里之前先读）：
/// - 窗口标题只写「启动器设置」，内容顶部的是**应用名**，不再重复一遍窗口标题；
/// - 所有间距走 4/8/12/16/20 的倍数，卡片内部统一「标题 14 / 行距 8 / 底部 14」；
/// - 三张卡片用同一个标签列宽（`labelColumn`），勾选项与标签行左缘对齐；
/// - 卡片不写死高度，高度由内容顶出来——写死高度正是「控件溢出卡片、底部按钮被
///   挤出可视区」这类问题的来源（scripts/test-settings-window.swift 会断言子视图
///   必须落在卡片内）。
final class SettingsWindowController: NSWindowController, NSWindowDelegate, NSTextFieldDelegate {
    private let onSave: () -> Bool
    private let onCheckNow: () -> Void
    private let settings = LauncherSettings.shared

    private let pluginUpdateCheckbox = NSButton(checkboxWithTitle: "自动检测插件更新", target: nil, action: nil)
    private let openBrowserCheckbox = NSButton(checkboxWithTitle: "就绪后自动打开浏览器", target: nil, action: nil)
    private let launchAtLoginCheckbox = NSButton(checkboxWithTitle: "登录 macOS 时自动启动", target: nil, action: nil)
    private let globalHotKeyCheckbox = NSButton(checkboxWithTitle: "启用全局快捷键呼出", target: nil, action: nil)
    private let globalHotKeyButton = NSButton(title: "", target: nil, action: nil)
    private var hotKeyEventMonitor: Any?
    private var isRecordingHotKey = false
    private var pendingHotKeyModifiers: UInt32 = 0x1800
    private var pendingHotKeyKeyCode: UInt32 = 2
    private var pendingHotKeyDisplay = "⌃⌥D"
    private let intervalField = NSTextField(string: "6")
    private let intervalStepper = NSStepper()
    private var hotkeyLabel: NSTextField?

    private let windowWidth: CGFloat = 520
    private let cardInset: CGFloat = 16
    /// 标签列宽：卡片左内缩 16 + 这一列，就是控件列的起点，三张卡片共用。
    private let labelColumn: CGFloat = 80

    init(onSave: @escaping () -> Bool, onCheckNow: @escaping () -> Void) {
        self.onSave = onSave
        self.onCheckNow = onCheckNow

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: windowWidth, height: 420),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "启动器设置"
        window.isReleasedWhenClosed = false
        // Keep a native glass surface without letting the desktop bleed
        // through and wash out the settings text.
        window.isOpaque = true
        window.backgroundColor = .windowBackgroundColor
        window.titlebarAppearsTransparent = false
        window.titleVisibility = .visible
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
        if !window.isVisible {
            // 窗口是复用的（isReleasedWhenClosed = false）：上次点「取消」时界面上那些
            // 未保存的编辑（勾选状态、检查间隔、刚录但没保存的快捷键）不能留到下次打开
            // ——照已保存的设置重新填一遍。窗口已经可见时不重填，否则会把正在改的内容冲掉。
            loadSettings()
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - 布局

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

        globalHotKeyCheckbox.target = self
        globalHotKeyCheckbox.action = #selector(globalHotKeyCheckChanged)

        let column = makeColumn([
            makeHeader(),
            makeCard(
                title: "启动行为",
                rows: [configureCheckbox(openBrowserCheckbox), configureCheckbox(launchAtLoginCheckbox)]
            ),
            makeCard(
                title: "快捷呼出",
                rows: [configureCheckbox(globalHotKeyCheckbox), makeHotKeyRow()]
            ),
            makeCard(
                title: "更新检查",
                rows: [configureCheckbox(pluginUpdateCheckbox), makeIntervalRow(), makeSourceRow(), makeUpdateHint()],
                accessory: makeCheckNowButton()
            ),
            makeFooter()
        ])
        column.translatesAutoresizingMaskIntoConstraints = false

        let root = NSView()
        root.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(column)
        visualEffect.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: visualEffect.leadingAnchor, constant: 24),
            root.trailingAnchor.constraint(equalTo: visualEffect.trailingAnchor, constant: -24),
            root.topAnchor.constraint(equalTo: visualEffect.topAnchor, constant: 20),
            root.bottomAnchor.constraint(equalTo: visualEffect.bottomAnchor, constant: -18),
            column.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            column.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            column.topAnchor.constraint(equalTo: root.topAnchor),
            column.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            root.widthAnchor.constraint(equalToConstant: windowWidth - 48)
        ])

        // 高度由内容决定：窗口不写死高度，卡片也不写死高度，避免「底部一片空白」
        // 和「控件被挤出卡片」两种相反的毛病。
        contentView.layoutSubtreeIfNeeded()
        let height = ceil(contentView.fittingSize.height)
        window.setContentSize(NSSize(width: windowWidth, height: height))

        window.standardWindowButton(.closeButton)?.toolTip = "关闭设置"
        window.standardWindowButton(.miniaturizeButton)?.isEnabled = true
    }

    /// 顶部：应用图标 + 应用名 + 一句用途说明。窗口标题已经写着「启动器设置」，
    /// 这里不再重复同一句话。
    private func makeHeader() -> NSView {
        let name = makeLabel("Deepseek Harness Launcher", size: 15, weight: .semibold, color: .labelColor)
        let subtitle = makeLabel("偏好与更新", size: 12, weight: .regular, color: .secondaryLabelColor)
        let titles = NSStackView(views: [name, subtitle])
        titles.orientation = .vertical
        titles.alignment = .leading
        titles.spacing = 2

        var views: [NSView] = []
        if let icon = NSApp.applicationIconImage {
            let iconView = NSImageView()
            iconView.image = icon
            iconView.imageScaling = .scaleProportionallyUpOrDown
            iconView.translatesAutoresizingMaskIntoConstraints = false
            iconView.widthAnchor.constraint(equalToConstant: 36).isActive = true
            iconView.heightAnchor.constraint(equalToConstant: 36).isActive = true
            views.append(iconView)
        }
        views.append(titles)

        let header = NSStackView(views: views)
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 10
        return header
    }

    /// 纵向栈：把每个子视图的宽度钉到栈宽。
    ///
    /// 不能只靠 `alignment = .width`：纵向栈的 `.width` 对「行」这种本身有内在宽度的
    /// 视图不生效，结果是整列按内容宽度收缩、右对齐——卡片会缩成一条，勾选框也会
    /// 缩进到卡片中间。所以宽度用显式约束钉住，子视图内部的横向栈靠 spacer 吃掉余量。
    private func makeColumn(_ views: [NSView], spacing: CGFloat = 12) -> NSStackView {
        let stack = NSStackView(views: views)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = spacing
        for view in views {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        return stack
    }

    /// 一张卡片：小标题 + 若干行。高度由内容顶出来，不写死。
    private func makeCard(title: String, rows: [NSView], accessory: NSView? = nil) -> NSView {
        let card = NSView()
        card.wantsLayer = true
        card.layer?.cornerRadius = 10
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.78).cgColor
        card.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.7).cgColor
        card.layer?.borderWidth = 1

        let headerLabel = makeLabel(title, size: 12, weight: .semibold, color: .secondaryLabelColor)
        headerLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        let headerSpacer = NSView()
        headerSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let header = NSStackView(views: [headerLabel, headerSpacer] + (accessory.map { [$0] } ?? []))
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 8

        let stack = makeColumn([header] + rows, spacing: 8)
        stack.setCustomSpacing(12, after: header)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: cardInset),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -cardInset),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14)
        ])
        return card
    }

    /// 「标签 + 控件」行：标签列宽固定，控件列因此在三张卡片里纵向对齐。
    private func makeRow(label: String, controls: [NSView], captureLabel: ((NSTextField) -> Void)? = nil) -> NSView {
        let titleLabel = makeLabel(label, size: 13, weight: .regular, color: .labelColor)
        titleLabel.widthAnchor.constraint(equalToConstant: labelColumn - 8).isActive = true
        titleLabel.setContentHuggingPriority(.required, for: .horizontal)
        captureLabel?(titleLabel)
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let row = NSStackView(views: [titleLabel] + controls + [spacer])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 8
        return row
    }

    private func makeHotKeyRow() -> NSView {
        globalHotKeyButton.target = self
        globalHotKeyButton.action = #selector(toggleHotKeyRecording)
        globalHotKeyButton.bezelStyle = .rounded
        globalHotKeyButton.controlSize = .regular
        globalHotKeyButton.font = NSFont.systemFont(ofSize: 13)
        globalHotKeyButton.setAccessibilityLabel("全局快捷键")
        globalHotKeyButton.widthAnchor.constraint(equalToConstant: 128).isActive = true
        // 录制按钮跟着勾选框一起变灰，所以要把标签留一份引用。
        return makeRow(label: "快捷键", controls: [globalHotKeyButton]) { self.hotkeyLabel = $0 }
    }

    private func makeIntervalRow() -> NSView {
        configureTextField(intervalField, placeholder: "6")
        intervalField.alignment = .right
        intervalField.target = self
        intervalField.action = #selector(intervalFieldChanged)
        intervalField.delegate = self
        intervalField.widthAnchor.constraint(equalToConstant: 48).isActive = true
        intervalField.setAccessibilityLabel("检查频率（小时）")

        intervalStepper.minValue = 1
        intervalStepper.maxValue = 168
        intervalStepper.increment = 1
        intervalStepper.valueWraps = false
        intervalStepper.target = self
        intervalStepper.action = #selector(intervalStepperChanged)
        intervalStepper.translatesAutoresizingMaskIntoConstraints = false

        let unit = makeLabel("小时一次", size: 13, weight: .regular, color: .secondaryLabelColor)
        return makeRow(label: "检查频率", controls: [intervalField, intervalStepper, unit])
    }

    private func makeSourceRow() -> NSView {
        let value = makeLabel("GitHub Releases · deepseek-harness-launcher", size: 12, weight: .regular, color: .secondaryLabelColor)
        value.lineBreakMode = .byTruncatingMiddle
        return makeRow(label: "更新来源", controls: [value])
    }

    /// 为什么没有「要不要自动检查」的开关：后台检查常开，只提示不自动安装。
    private func makeUpdateHint() -> NSView {
        let hint = makeLabel("后台检查常开：发现新版本只在菜单栏提示，不会自动安装。", size: 11, weight: .regular, color: .tertiaryLabelColor)
        hint.lineBreakMode = .byTruncatingTail
        return hint
    }

    private func makeCheckNowButton() -> NSView {
        let button = NSButton(title: "立即检查", target: self, action: #selector(checkNow))
        button.isBordered = false
        button.font = NSFont.systemFont(ofSize: 12)
        button.contentTintColor = .linkColor
        button.setContentHuggingPriority(.required, for: .horizontal)
        return button
    }

    private func makeFooter() -> NSView {
        let separator = NSBox()
        separator.boxType = .separator
        separator.translatesAutoresizingMaskIntoConstraints = false

        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let versionLabel = makeLabel("当前版本 v\(version)", size: 11, weight: .regular, color: .tertiaryLabelColor)

        let cancelButton = NSButton(title: "取消", target: self, action: #selector(cancel))
        cancelButton.bezelStyle = .rounded
        cancelButton.controlSize = .regular
        cancelButton.setContentHuggingPriority(.required, for: .horizontal)
        let saveButton = NSButton(title: "保存", target: self, action: #selector(save))
        saveButton.bezelStyle = .rounded
        saveButton.controlSize = .regular
        saveButton.keyEquivalent = "\r"
        saveButton.setContentHuggingPriority(.required, for: .horizontal)

        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let row = NSStackView(views: [versionLabel, spacer, cancelButton, saveButton])
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 8

        let footer = makeColumn([separator, row], spacing: 12)
        separator.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return footer
    }

    private func makeLabel(_ text: String, size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = NSFont.systemFont(ofSize: size, weight: weight)
        label.textColor = color
        label.lineBreakMode = .byTruncatingTail
        return label
    }

    @discardableResult
    private func configureCheckbox(_ checkbox: NSButton) -> NSButton {
        checkbox.translatesAutoresizingMaskIntoConstraints = false
        checkbox.setButtonType(.switch)
        checkbox.font = NSFont.systemFont(ofSize: 13)
        // Keep the switch glyph native while retaining readable label color.
        checkbox.contentTintColor = .labelColor
        checkbox.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        return checkbox
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

    // MARK: - 设置读写

    private func loadSettings() {
        pluginUpdateCheckbox.state = settings.autoCheckPluginUpdates ? .on : .off
        openBrowserCheckbox.state = settings.openBrowserOnReady ? .on : .off
        launchAtLoginCheckbox.state = settings.launchAtLogin ? .on : .off
        globalHotKeyCheckbox.state = settings.globalHotKeyEnabled ? .on : .off
        pendingHotKeyModifiers = settings.globalHotKeyModifiers
        pendingHotKeyKeyCode = settings.globalHotKeyKeyCode
        pendingHotKeyDisplay = settings.globalHotKeyDisplay
        globalHotKeyButton.title = pendingHotKeyDisplay
        globalHotKeyButton.bezelColor = nil
        setHotKeyControlsEnabled(settings.globalHotKeyEnabled)
        let interval = max(settings.updateIntervalHours, 1)
        intervalField.doubleValue = interval
        intervalStepper.doubleValue = interval
    }

    @objc private func intervalStepperChanged() {
        intervalField.doubleValue = intervalStepper.doubleValue
    }

    @objc private func intervalFieldChanged() {
        intervalStepper.doubleValue = intervalField.doubleValue
    }

    func controlTextDidEndEditing(_ notification: Notification) {
        guard let field = notification.object as? NSTextField, field === intervalField else { return }
        intervalStepper.doubleValue = intervalField.doubleValue
    }

    private func setHotKeyControlsEnabled(_ enabled: Bool) {
        globalHotKeyButton.isEnabled = enabled
        hotkeyLabel?.textColor = enabled ? .labelColor : .tertiaryLabelColor
    }

    @objc private func checkNow() {
        onCheckNow()
    }

    @objc private func cancel() {
        cancelRecording()
        window?.close()
    }

    @objc private func globalHotKeyCheckChanged() {
        let enabled = globalHotKeyCheckbox.state == .on
        setHotKeyControlsEnabled(enabled)
        if !enabled { cancelRecording() }
    }

    @objc private func toggleHotKeyRecording() {
        if isRecordingHotKey {
            cancelRecording()
            return
        }
        isRecordingHotKey = true
        globalHotKeyButton.title = "请按下快捷键…"
        globalHotKeyButton.bezelColor = .controlAccentColor
        hotKeyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            if event.keyCode == 53 {
                self.cancelRecording()
                return nil
            }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            guard !flags.intersection([.command, .control, .option]).isEmpty,
                  let character = event.charactersIgnoringModifiers?.uppercased().first.map(String.init) else {
                return event
            }
            let modifiers = GlobalHotKey.carbonModifiers(from: flags)
            self.pendingHotKeyModifiers = modifiers
            self.pendingHotKeyKeyCode = UInt32(event.keyCode)
            self.pendingHotKeyDisplay = GlobalHotKey.modifierSymbols(modifiers) + character
            self.cancelRecording()
            return nil
        }
    }

    private func cancelRecording() {
        if let hotKeyEventMonitor { NSEvent.removeMonitor(hotKeyEventMonitor) }
        hotKeyEventMonitor = nil
        isRecordingHotKey = false
        globalHotKeyButton.bezelColor = nil
        globalHotKeyButton.title = pendingHotKeyDisplay
    }

    @objc private func save() {
        let previousHotKeyEnabled = settings.globalHotKeyEnabled
        let previousHotKeyModifiers = settings.globalHotKeyModifiers
        let previousHotKeyKeyCode = settings.globalHotKeyKeyCode
        let previousHotKeyDisplay = settings.globalHotKeyDisplay

        settings.autoCheckPluginUpdates = pluginUpdateCheckbox.state == .on
        settings.openBrowserOnReady = openBrowserCheckbox.state == .on
        settings.launchAtLogin = launchAtLoginCheckbox.state == .on
        settings.updateIntervalHours = max(intervalField.doubleValue, 1)
        settings.globalHotKeyEnabled = globalHotKeyCheckbox.state == .on
        settings.globalHotKeyModifiers = pendingHotKeyModifiers
        settings.globalHotKeyKeyCode = pendingHotKeyKeyCode
        settings.globalHotKeyDisplay = pendingHotKeyDisplay

        guard onSave() else {
            settings.globalHotKeyEnabled = previousHotKeyEnabled
            settings.globalHotKeyModifiers = previousHotKeyModifiers
            settings.globalHotKeyKeyCode = previousHotKeyKeyCode
            settings.globalHotKeyDisplay = previousHotKeyDisplay
            return
        }

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

        window?.close()
    }
}
