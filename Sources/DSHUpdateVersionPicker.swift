import AppKit
import Foundation

/// dsh 更新弹窗里的说明面板：正文是 Markdown（GitHub Release 的正文被转成
/// Markdown 后进来），只读、可滚动、可换内容——切换版本时要重新渲染。
func makeReleaseNotesText(width: CGFloat, height: CGFloat) -> (scroll: NSScrollView, textView: NSTextView) {
    let textView = NSTextView()
    textView.isEditable = false
    textView.isSelectable = true
    textView.isRichText = false
    textView.drawsBackground = false
    textView.textContainerInset = NSSize(width: 0, height: 2)
    textView.textContainer?.lineFragmentPadding = 0
    textView.frame = NSRect(x: 0, y: 0, width: width, height: height)
    textView.minSize = NSSize(width: width, height: height)
    textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
    textView.isVerticallyResizable = true
    textView.isHorizontallyResizable = false
    textView.autoresizingMask = [.width]
    textView.textContainer?.widthTracksTextView = true

    let scroll = NSScrollView()
    scroll.documentView = textView
    scroll.hasVerticalScroller = true
    scroll.autohidesScrollers = true
    // 说明面板放在提示框的圆角卡片里：自带边框会变成「盒中盒」，直接用卡片底色。
    scroll.borderType = .noBorder
    scroll.backgroundColor = .clear
    scroll.drawsBackground = false
    scroll.frame = NSRect(x: 0, y: 0, width: width, height: height)
    // NSScrollView 没有 intrinsic content size：放进 NSStackView 时只靠 frame 会被
    // 压成一条细线，必须给显式约束。
    scroll.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
        scroll.widthAnchor.constraint(equalToConstant: width),
        scroll.heightAnchor.constraint(equalToConstant: height)
    ])
    return (scroll, textView)
}

func renderReleaseNotes(_ markdown: String?, into textView: NSTextView) {
    let text = (markdown ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let attributed = text.isEmpty
        ? NSAttributedString(string: "该版本未提供更新说明。", attributes: [
            .font: NSFont.systemFont(ofSize: 12),
            .foregroundColor: NSColor.secondaryLabelColor
        ])
        : ReleaseNotesMarkdown.attributedString(from: text)
    textView.textStorage?.setAttributedString(attributed)
}

/// 说明面板的高度按行数估，夹在 140–300 之间，别让弹窗忽大忽小。
func releaseNotesHeight(for markdown: String?) -> CGFloat {
    let lines = (markdown ?? "").split(separator: "\n").count
    return min(300, max(140, CGFloat(max(lines, 4)) * 18))
}

func dshDayString(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

/// 「更新到哪个版本」下拉：把比当前新的候选一次列全（最新的在最上面），切换时
/// 刷新该版本的来源、发布日期与说明，并回调让弹窗按钮跟着改文案。
/// 只有一个候选时调用方不会创建它，弹窗退化成原来的单版本提示。
final class DSHUpdateVersionPicker: NSObject {
    private let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 240, height: 26), pullsDown: false)
    private let detailLabel = NSTextField(labelWithString: "")
    private let notesTextView: NSTextView
    private let notesScrollView: NSScrollView
    private let candidates: [DSHUpdateCandidate]
    private(set) var selection: DSHUpdateCandidate
    /// 用户换版本时回调（弹窗用它更新按钮标题与默认按钮）。
    var onChange: ((DSHUpdateCandidate) -> Void)?

    init(candidates: [DSHUpdateCandidate], selected: DSHUpdateCandidate, width: CGFloat, height: CGFloat) {
        self.candidates = candidates
        self.selection = selected
        let notes = makeReleaseNotesText(width: width, height: height)
        self.notesTextView = notes.textView
        self.notesScrollView = notes.scroll
        super.init()

        popup.target = self
        popup.action = #selector(selectionChanged)
        for candidate in candidates {
            popup.addItem(withTitle: Self.title(for: candidate))
        }
        if let index = candidates.firstIndex(where: { $0.version == selected.version }) {
            popup.selectItem(at: index)
        }
        detailLabel.font = NSFont.systemFont(ofSize: 11)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.lineBreakMode = .byTruncatingTail
        render()
    }

    /// 卡片里的三行：`更新到：<下拉>` / 来源行 / 说明面板。由调用方塞进
    /// AlertDesign 的圆角卡片，保证和其它提示框长一个样。
    var rows: [NSView] { [popupRow, detailLabel, notesScrollView] }

    /// 独立预览用（测试与离屏渲染）：三行直接竖排。
    var view: NSView {
        let stack = NSStackView(views: rows)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.frame = NSRect(x: 0, y: 0, width: notesScrollView.frame.width, height: notesScrollView.frame.height + 54)
        stack.layoutSubtreeIfNeeded()
        return stack
    }

    private var popupRow: NSView {
        let caption = NSTextField(labelWithString: "更新到：")
        caption.font = NSFont.systemFont(ofSize: 12)
        caption.textColor = .secondaryLabelColor
        let row = NSStackView(views: [caption, popup])
        row.orientation = .horizontal
        row.alignment = .firstBaseline
        row.spacing = 8
        return row
    }

    @objc private func selectionChanged() {
        let index = popup.indexOfSelectedItem
        guard candidates.indices.contains(index) else { return }
        selection = candidates[index]
        render()
        onChange?(selection)
    }

    private func render() {
        detailLabel.stringValue = Self.detail(for: selection)
        renderReleaseNotes(selection.notes, into: notesTextView)
    }

    private static func title(for candidate: DSHUpdateCandidate) -> String {
        "v\(candidate.version) · \(candidate.channel.label)"
    }

    private static func detail(for candidate: DSHUpdateCandidate) -> String {
        var parts = ["来源：\(candidate.source.label)"]
        if let date = candidate.publishedAt {
            parts.append("发布于 \(dshDayString(date))")
        }
        if candidate.notes?.isEmpty != false {
            parts.append("该版本未提供更新说明")
        }
        return parts.joined(separator: " · ")
    }
}
