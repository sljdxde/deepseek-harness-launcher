import AppKit

/// 提示框的语气：决定 SF Symbol 图标与配色。macOS 的原生 `NSAlert` 只给
/// 「标题 + 一段正文 + 按钮」，把版本号、来源、说明全塞进正文会又长又平；
/// 这里把结构化信息放进圆角卡片（accessory），正文只留一句话。
enum AlertTone {
    case info
    case success
    case warning
    case error
    case update
    case question

    var symbolName: String {
        switch self {
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .error: return "xmark.octagon.fill"
        case .update: return "arrow.down.circle.fill"
        case .question: return "questionmark.circle.fill"
        }
    }

    var tint: NSColor {
        switch self {
        case .info, .question, .update: return .controlAccentColor
        case .success: return .systemGreen
        case .warning: return .systemOrange
        case .error: return .systemRed
        }
    }
}

enum AlertDesign {
    static let cardWidth: CGFloat = 430

    /// 图标槽：默认是应用图标，换成同语气的 SF Symbol 更像系统提示（配色跟随强调色，
    /// 深浅色外观都能读）。
    static func icon(for tone: AlertTone) -> NSImage? {
        let configuration = NSImage.SymbolConfiguration(pointSize: 40, weight: .regular)
        guard let symbol = NSImage(systemSymbolName: tone.symbolName, accessibilityDescription: nil)?
            .withSymbolConfiguration(configuration) else { return nil }
        // 直接把符号压成单色：palette 配置在离屏/无外观上下文里会掉层（只剩一个
        // 实心圆），手工着色在任何渲染路径下都稳定，也更接近系统「实心图标」观感。
        let size = symbol.size
        let tinted = NSImage(size: size)
        tinted.lockFocus()
        symbol.draw(in: NSRect(origin: .zero, size: size))
        tone.tint.set()
        NSRect(origin: .zero, size: size).fill(using: .sourceAtop)
        tinted.unlockFocus()
        return tinted
    }

    /// 统一给 NSAlert 上妆：语气图标 + 系统提示样式。
    static func style(_ alert: NSAlert, tone: AlertTone) {
        alert.alertStyle = tone == .error || tone == .warning ? .warning : .informational
        if let icon = icon(for: tone) { alert.icon = icon }
    }

    // MARK: - 卡片

    /// 圆角信息卡：内部是纵向排列的行，外边距固定；调用方把整卡塞进
    /// `alert.accessoryView`，尺寸由内容撑开。
    static func card(rows: [NSView], width: CGFloat = cardWidth) -> NSView {
        AlertCardView(rows: rows, width: width)
    }

    /// 「v0.1.5-rc.2 → v0.1.7-alpha.1」+ 通道小标签。数字用等宽字体，
    /// 版本号不会因为字宽抖动。
    static func versionRow(from current: String, to candidate: String, channel: DSHReleaseChannel?) -> NSView {
        let currentLabel = NSTextField(labelWithString: "v\(current)")
        currentLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        currentLabel.textColor = .secondaryLabelColor

        let arrow = NSTextField(labelWithString: "→")
        arrow.font = NSFont.systemFont(ofSize: 13)
        arrow.textColor = .tertiaryLabelColor

        let candidateLabel = NSTextField(labelWithString: "v\(candidate)")
        candidateLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        candidateLabel.textColor = .labelColor

        var views: [NSView] = [currentLabel, arrow, candidateLabel]
        // 启动器自身的版本没有发布通道，只有 dsh 才给标签。
        if let channel { views.append(pill(channel.label, color: pillColor(for: channel))) }
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        // 胶囊没有文字基线，用 firstBaseline 会把它顶到下一行的高度上。
        row.alignment = .centerY
        row.spacing = 8
        return row
    }

    /// 「来源：GitHub Release · 发布于 2026-09-22」这类次要说明行。
    static func captionRow(_ caption: String, _ value: String) -> NSView {
        let captionLabel = NSTextField(labelWithString: caption)
        captionLabel.font = NSFont.systemFont(ofSize: 12)
        captionLabel.textColor = .tertiaryLabelColor
        captionLabel.setContentHuggingPriority(.required, for: .horizontal)

        let valueLabel = NSTextField(labelWithString: value)
        valueLabel.font = NSFont.systemFont(ofSize: 12)
        valueLabel.textColor = .secondaryLabelColor
        valueLabel.lineBreakMode = .byTruncatingTail

        let row = NSStackView(views: [captionLabel, valueLabel])
        row.orientation = .horizontal
        row.alignment = .firstBaseline
        row.spacing = 4
        return row
    }

    /// 次要提示（小字、三级色），放在卡片下面。
    static func footnote(_ text: String, width: CGFloat = cardWidth) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = NSFont.systemFont(ofSize: 11)
        label.textColor = .tertiaryLabelColor
        label.preferredMaxLayoutWidth = width
        return label
    }

    /// 卡片 + 卡片下的次要说明，直接作为 `alert.accessoryView`。
    static func accessory(card: NSView, footnote: String?) -> NSView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        stack.addArrangedSubview(card)
        if let footnote, !footnote.isEmpty {
            stack.addArrangedSubview(AlertDesign.footnote(footnote))
        }
        stack.layoutSubtreeIfNeeded()
        let size = stack.fittingSize
        stack.frame = NSRect(origin: .zero, size: NSSize(width: max(size.width, cardWidth), height: max(size.height, 1)))
        return stack
    }

    static func pill(_ text: String, color: NSColor) -> NSView {
        AlertPillView(text: text, color: color)
    }

    static func pillColor(for channel: DSHReleaseChannel) -> NSColor {
        switch channel {
        case .stable: return .systemGreen
        case .releaseCandidate: return .controlAccentColor
        case .beta: return .systemTeal
        case .alpha, .development: return .systemOrange
        case .other: return .systemGray
        }
    }
}

/// 圆角信息卡：layer 背景 + 一条分隔线质感的内描边，内部纵向堆叠。
private final class AlertCardView: NSView {
    private let stack = NSStackView()
    private let insets = NSEdgeInsets(top: 12, left: 14, bottom: 12, right: 14)
    private let cardWidth: CGFloat

    init(rows: [NSView], width: CGFloat) {
        self.cardWidth = width
        super.init(frame: NSRect(x: 0, y: 0, width: width, height: 10))
        wantsLayer = true
        if let layer {
            layer.cornerRadius = 10
            layer.cornerCurve = .continuous
            layer.borderWidth = 1
            layer.borderColor = NSColor.separatorColor.withAlphaComponent(0.7).cgColor
            layer.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.55).cgColor
        }

        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        for row in rows { stack.addArrangedSubview(row) }
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: insets.left),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -insets.right),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: insets.top),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -insets.bottom)
        ])

        let height = stack.fittingSize.height + insets.top + insets.bottom
        setFrameSize(NSSize(width: width, height: ceil(height)))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

/// 通道小标签：胶囊底 + 同色文字，比纯文字更像 macOS 的状态标记。
private final class AlertPillView: NSView {
    init(text: String, color: NSColor) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.cornerCurve = .continuous
        layer?.backgroundColor = color.withAlphaComponent(0.16).cgColor

        let label = NSTextField(labelWithString: text)
        label.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        label.textColor = color
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 7),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -7),
            label.topAnchor.constraint(equalTo: topAnchor, constant: 2),
            label.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -2)
        ])
        setContentHuggingPriority(.required, for: .horizontal)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
