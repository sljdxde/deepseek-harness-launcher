import AppKit
import Foundation

/// 提示框外观与「更新到哪个版本」选择器的本地单测：这些组件是纯 AppKit
/// 视图，不需要窗口也能构造、量尺寸、触发动作，因此可以直接断言——
/// 之前它们只被 scripts/test.sh 的字符串断言覆盖，符号名写错、面板被压成
/// 一条细线、下拉与内部选中项不一致这类问题都测不出来。
@main
struct AlertDesignChecks {
    static func main() {
        _ = NSApplication.shared
        checkTones()
        checkRows()
        checkCard()
        checkNotesPane()
        checkVersionPicker()
        checkAlertStyling()
        print("alert design checks passed")
    }

    // MARK: - helpers

    static func find<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
        if let hit = view as? T { return hit }
        for sub in view.subviews {
            if let hit = find(type, in: sub) { return hit }
        }
        return nil
    }

    static func allClassNames(in view: NSView) -> [String] {
        [String(describing: type(of: view))] + view.subviews.flatMap { allClassNames(in: $0) }
    }

    static func allTexts(in view: NSView) -> [String] {
        var texts: [String] = []
        if let field = view as? NSTextField { texts.append(field.stringValue) }
        if let textView = view as? NSTextView { texts.append(textView.string) }
        for sub in view.subviews { texts.append(contentsOf: allTexts(in: sub)) }
        return texts
    }

    // MARK: - 语气图标

    static func checkTones() {
        precondition(AlertTone.update.symbolName == "arrow.down.circle.fill")
        precondition(AlertTone.error.symbolName == "xmark.octagon.fill")
        precondition(AlertTone.success.symbolName == "checkmark.circle.fill")
        precondition(AlertTone.warning.symbolName == "exclamationmark.triangle.fill")
        precondition(AlertTone.question.symbolName == "questionmark.circle.fill")
        precondition(AlertTone.info.symbolName == "info.circle.fill")
        precondition(AlertTone.error.tint == .systemRed)
        precondition(AlertTone.success.tint == .systemGreen)
        precondition(AlertTone.warning.tint == .systemOrange)

        // 符号名写错会得到 nil，弹窗就退回默认 App 图标——这里逐个兜住。
        for tone in [AlertTone.info, .success, .warning, .error, .update, .question] {
            guard let icon = AlertDesign.icon(for: tone) else {
                preconditionFailure("\(tone.symbolName) 无法加载")
            }
            precondition(icon.size.width > 8 && icon.size.height > 8, "图标尺寸异常：\(icon.size)")
        }
    }

    // MARK: - 行

    static func checkRows() {
        let withPill = AlertDesign.versionRow(from: "0.1.5-rc.2", to: "0.1.7-alpha.1", channel: .alpha)
        let texts = allTexts(in: withPill)
        precondition(texts.contains("v0.1.5-rc.2"))
        precondition(texts.contains("→"))
        precondition(texts.contains("v0.1.7-alpha.1"))
        precondition(texts.contains("内测版"))
        precondition(allClassNames(in: withPill).contains { $0.contains("AlertPillView") })
        // 胶囊没有文字基线：用 firstBaseline 会被顶到下一行的高度上，必须 centerY。
        precondition((withPill as? NSStackView)?.alignment == .centerY)

        // 启动器自身的版本没有发布通道 → 不出现胶囊。
        let plain = AlertDesign.versionRow(from: "0.3.5-1.1-SNAPSHOT", to: "0.3.5", channel: nil)
        precondition(allTexts(in: plain).contains("v0.3.5"))
        precondition(!allClassNames(in: plain).contains { $0.contains("AlertPillView") })

        let caption = AlertDesign.captionRow("来源：", "GitHub Release · 发布于 2026-09-22")
        precondition(allTexts(in: caption) == ["来源：", "GitHub Release · 发布于 2026-09-22"])

        let note = AlertDesign.footnote("更新不会影响会话与归档。")
        precondition(note.stringValue == "更新不会影响会话与归档。")
        precondition(note.preferredMaxLayoutWidth == AlertDesign.cardWidth)
        precondition(note.textColor == .tertiaryLabelColor)
    }

    // MARK: - 卡片

    static func checkCard() {
        let one = AlertDesign.card(rows: [AlertDesign.captionRow("来源：", "GitHub Release")])
        precondition(one.frame.width == AlertDesign.cardWidth)
        precondition(one.frame.height > 20, "卡片高度被压扁：\(one.frame.height)")

        let three = AlertDesign.card(rows: (1...3).map { AlertDesign.captionRow("第 \($0) 行：", "值") })
        precondition(three.frame.height > one.frame.height, "三行卡片不该比一行还矮")

        // 卡片内部必须真的装得下这些行，不能出现 0 尺寸的层。
        let accessory = AlertDesign.accessory(card: three, footnote: "小字说明")
        precondition(accessory.frame.width >= AlertDesign.cardWidth)
        precondition(accessory.frame.height > three.frame.height)
        precondition(allTexts(in: accessory).contains("小字说明"))

        let withoutFootnote = AlertDesign.accessory(card: one, footnote: nil)
        precondition(allTexts(in: withoutFootnote) == allTexts(in: one))
    }

    // MARK: - 说明面板

    static func checkNotesPane() {
        let pane = makeReleaseNotesText(width: 300, height: 160)
        // NSScrollView 没有 intrinsic size：只靠 frame 放进 NSStackView 会被压成一条
        // 细线（真实踩过），所以必须有显式宽高约束。
        precondition(pane.scroll.translatesAutoresizingMaskIntoConstraints == false)
        let sizes = pane.scroll.constraints.filter { $0.firstAttribute == .width || $0.firstAttribute == .height }
        precondition(sizes.count == 2, "说明面板缺少显式尺寸约束")
        precondition(pane.scroll.fittingSize.height == 160)
        precondition(pane.scroll.borderType == .noBorder)
        precondition(pane.scroll.backgroundColor == .clear)

        renderReleaseNotes(nil, into: pane.textView)
        precondition(pane.textView.string == "该版本未提供更新说明。")
        renderReleaseNotes("   ", into: pane.textView)
        precondition(pane.textView.string == "该版本未提供更新说明。")

        renderReleaseNotes("## 本次更新\n\n- 支持多版本选择", into: pane.textView)
        let rendered = pane.textView.string
        precondition(rendered.contains("本次更新"))
        precondition(rendered.contains("支持多版本选择"))

        precondition(releaseNotesHeight(for: nil) == 140)
        precondition(releaseNotesHeight(for: "a\nb") == 140)
        precondition(releaseNotesHeight(for: String(repeating: "line\n", count: 40)) == 300)

        let day = Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 22, hour: 12))!
        precondition(dshDayString(day) == "2026-09-22")
    }

    // MARK: - 版本选择器

    static func makeCandidates() -> [DSHUpdateCandidate] {
        [
            DSHUpdateCandidate(version: "0.1.7-alpha.1", source: .githubRelease, publishedAt: nil, notes: "### 新版本说明"),
            DSHUpdateCandidate(version: "0.1.6-alpha.2", source: .githubRelease, publishedAt: nil, notes: nil),
            DSHUpdateCandidate(version: "0.1.5-rc.3", source: .npmTag("next"), publishedAt: nil, notes: nil)
        ]
    }

    static func checkVersionPicker() {
        let candidates = makeCandidates()
        let picker = DSHUpdateVersionPicker(candidates: candidates, selected: candidates[0], width: 400, height: 150)
        precondition(picker.rows.count == 3)
        precondition(picker.selection == candidates[0])
        precondition(picker.view.frame.height > 150, "选择器高度没算进说明面板")

        let texts = allTexts(in: picker.view)
        precondition(texts.contains("更新到："))
        precondition(texts.contains("来源：GitHub Release"))
        precondition(texts.contains(where: { $0.contains("新版本说明") }))

        guard let popup = find(NSPopUpButton.self, in: picker.view) else {
            preconditionFailure("选择器里没有下拉")
        }
        precondition(popup.itemTitles == ["v0.1.7-alpha.1 · 内测版", "v0.1.6-alpha.2 · 内测版", "v0.1.5-rc.3 · 候选版"])

        // 切换版本：内部选中项、来源行、说明面板、回调都要跟着变。
        var changes: [String] = []
        picker.onChange = { changes.append($0.version) }
        popup.selectItem(at: 1)
        if let action = popup.action { _ = NSApp.sendAction(action, to: popup.target, from: popup) }
        precondition(picker.selection == candidates[1])
        precondition(changes == ["0.1.6-alpha.2"])
        let afterSwitch = allTexts(in: picker.view)
        precondition(afterSwitch.contains(where: { $0.contains("该版本未提供更新说明") }))
        precondition(!afterSwitch.contains(where: { $0.contains("新版本说明") }))

        popup.selectItem(at: 2)
        if let action = popup.action { _ = NSApp.sendAction(action, to: popup.target, from: popup) }
        precondition(picker.selection.version == "0.1.5-rc.3")
        precondition(changes == ["0.1.6-alpha.2", "0.1.5-rc.3"])
        // 说明面板没有内容时详情行会多一段「未提供更新说明」，所以按包含判断。
        precondition(allTexts(in: picker.view).contains { $0.contains("来源：npm next 标签") })

        // 传进来的版本不在候选里（用的是上一次检查的结果）：退回第一项，
        // 不能出现「下拉显示 A、内部却是 B」。
        let stale = DSHUpdateVersionPicker(candidates: candidates, selected: DSHUpdateCandidate(version: "0.1.9", source: .npmRegistry), width: 400, height: 120)
        precondition(stale.selection == candidates[0])

        // 单个候选也能构造（调用方只在多版本时才用它，这里保证不会崩）。
        let single = DSHUpdateVersionPicker(candidates: [candidates[0]], selected: candidates[0], width: 400, height: 120)
        precondition(single.selection.version == "0.1.7-alpha.1")
        precondition(single.rows.count == 3)

        // 空候选是异常输入，但不能崩（弹窗那边会直接走单版本分支）。
        let empty = DSHUpdateVersionPicker(candidates: [], selected: candidates[0], width: 400, height: 120)
        precondition(empty.selection == candidates[0])
        precondition(find(NSPopUpButton.self, in: empty.view)?.numberOfItems == 0)
    }

    // MARK: - NSAlert 上妆

    static func checkAlertStyling() {
        let warning = NSAlert()
        AlertDesign.style(warning, tone: .warning)
        precondition(warning.alertStyle == .warning)
        precondition(warning.icon != nil)

        let error = NSAlert()
        AlertDesign.style(error, tone: .error)
        precondition(error.alertStyle == .warning)

        let info = NSAlert()
        AlertDesign.style(info, tone: .info)
        precondition(info.alertStyle == .informational)

        // 说明面板塞进 alert accessory 后不能塌成 0 高。
        let update = NSAlert()
        AlertDesign.style(update, tone: .update)
        update.messageText = "发现 Deepseek Harness 新版本"
        update.informativeText = "更新会从 npm 下载所选版本并自动重启 Deepseek Harness。"
        update.accessoryView = AlertDesign.accessory(
            card: AlertDesign.card(rows: [
                AlertDesign.versionRow(from: "0.1.5-rc.2", to: "0.1.7-alpha.1", channel: .alpha),
                AlertDesign.captionRow("来源：", "GitHub Release"),
                makeReleaseNotesText(width: AlertDesign.cardWidth - 28, height: 140).scroll
            ]),
            footnote: "最新正式版是 v0.1.5-rc.2，可在下拉里改选。"
        )
        update.addButton(withTitle: "更新到 v0.1.7-alpha.1")
        update.addButton(withTitle: "稍后")
        update.layout()
        guard let content = update.window.contentView else { preconditionFailure("alert 没有 contentView") }
        precondition(content.bounds.width > AlertDesign.cardWidth)
        let accessoryHeight = update.accessoryView?.frame.height ?? 0
        precondition(accessoryHeight > 200, "accessory 高度异常：\(accessoryHeight)")
    }
}
