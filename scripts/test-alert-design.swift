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
        checkAlertBoundaries()
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

    // MARK: - 边界：长正文 / 小屏 / Esc

    /// 真机事故回归：多行正文把 NSAlert 撑得比屏幕还高，底部按钮出屏后
    /// `runModal()` 无法退出（「提示框占满屏幕、软件卡死」）。这里断言两条护栏：
    /// 1) 长正文必须转成高度封顶的可滚动面板，弹窗总高不再随行数增长；
    /// 2) 即使窗口真的比屏幕高，`configureForPresentation` 也要把底边对齐
    ///    可视区底边（按钮在窗口底部），并给取消按钮挂上 Esc。
    static func checkAlertBoundaries() {
        precondition(AlertDesign.detailCharacterThreshold > 0)
        precondition(AlertDesign.maxDetailHeight > 0)
        precondition(AlertDesign.escapeKeyEquivalent == "\u{1b}")

        // 短正文照旧进 informativeText，不额外加面板。
        let short = NSAlert()
        AlertDesign.setBoundedText("插件 foo 需要 peer bar", on: short)
        precondition(short.informativeText == "插件 foo 需要 peer bar")
        precondition(short.accessoryView == nil)

        // 长正文：摘要 + 可滚动面板，面板高度封顶。
        let longLines = (0..<60).map { "• @deepseek-ai/dsh-experimental-bundle-\($0)：需要 peer >=0.3.0，当前为 0.4.0" }
        let longText = longLines.joined(separator: "\n")
        let huge = NSAlert()
        AlertDesign.setBoundedText(longText, on: huge)
        precondition(!huge.informativeText.contains("bundle-59"), "长正文不该整段塞进正文")
        guard let accessory = huge.accessoryView,
              let scroll = find(NSScrollView.self, in: accessory),
              let textView = find(NSTextView.self, in: accessory) else {
            preconditionFailure("长正文应转成可滚动面板")
        }
        precondition(scroll.hasVerticalScroller)
        precondition(scroll.fittingSize.height <= AlertDesign.maxDetailHeight + 1,
                     "详情面板高度未封顶：\(scroll.fittingSize.height)")
        precondition(textView.string == longText, "滚动面板应保留完整正文")

        // 已有结构卡片（更新弹窗）的正文再长也不覆盖卡片：只截断正文。
        let carded = NSAlert()
        let originalAccessory = AlertDesign.accessory(card: AlertDesign.card(rows: []), footnote: nil)
        carded.accessoryView = originalAccessory
        AlertDesign.setBoundedText(longText, on: carded)
        precondition(carded.accessoryView === originalAccessory, "不得覆盖更新弹窗的卡片")
        precondition(carded.informativeText.count <= AlertDesign.detailCharacterThreshold + 40)

        // 有界正文的弹窗整体收得进小屏：修这台机器 1280x800 / 1366x768 这类
        // 老 Intel Mac 时，visibleFrame 只有约 683-732pt，所以预算按 640 算，
        // 留出菜单栏/Dock 与窗口阴影。这是本事故的直接回归断言。
        huge.addButton(withTitle: "知道了")
        huge.addButton(withTitle: "打开日志")
        AlertDesign.configureForPresentation(huge, escapeButtonIndex: 0)
        precondition(huge.buttons[0].keyEquivalent == AlertDesign.escapeKeyEquivalent)
        precondition(huge.window.frame.height <= 640,
                     "有界正文的弹窗必须能塞进小屏：\(huge.window.frame)")

        // 不再随输入行数增长：超过面板封顶后，30 行与 1000 行走同一条路径，
        // 弹窗高度必须一致。
        func boundedAlertHeight(lines: Int) -> CGFloat {
            let text = (0..<lines).map { "• bundle-\($0)：需要 peer >=0.3.0，当前为 0.4.0" }.joined(separator: "\n")
            let alert = NSAlert()
            AlertDesign.setBoundedText(text, on: alert)
            alert.addButton(withTitle: "知道了")
            alert.layout()
            return alert.window.frame.height
        }
        let cappedSmall = boundedAlertHeight(lines: 30)
        let massive = boundedAlertHeight(lines: 1000)
        precondition(massive <= 640, "1000 行正文也必须被面板封顶：\(massive)")
        precondition(abs(massive - cappedSmall) < 1, "封顶后弹窗高度不能随行数增长：\(cappedSmall) vs \(massive)")

        // MARK: 护栏层（AlertBoundary）：安装器链的是这一层，不依赖 App 侧类型

        // 单行文案封顶：版本号与包名来自远端，长度不受本地控制。
        let longName = "已隔离 3 个插件：@deepseek-ai/" + String(repeating: "very-long-bundle", count: 8) + "（点按恢复）"
        let capped = AlertBoundary.singleLine(longName)
        precondition(capped.count <= AlertBoundary.maxSingleLineCharacters, "单行文案没封顶：\(capped.count)")
        precondition(capped.hasSuffix("…"), "封顶要留省略号，否则用户看不出内容被裁掉：\(capped)")
        precondition(AlertBoundary.singleLine("端口：3080") == "端口：3080", "短文案不该被改动")
        precondition(AlertBoundary.singleLine("a\nb").contains(" / "), "多行折叠成单行：\(AlertBoundary.singleLine("a\nb"))")

        // 屏幕预算：面板高度上限随屏幕收紧，而不是恒等于 220。
        precondition(AlertBoundary.detailHeightCap(visibleHeight: 968) == AlertBoundary.maxDetailHeight,
                     "大屏不该被预算压矮")
        precondition(AlertBoundary.detailHeightCap(visibleHeight: 480) == 180,
                     "480 可视高时面板应压到 180：\(AlertBoundary.detailHeightCap(visibleHeight: 480))")
        precondition(AlertBoundary.detailHeightCap(visibleHeight: 200) == AlertBoundary.minDetailHeight,
                     "极矮屏幕也要保住最小可读高度")
        precondition(AlertBoundary.detailHeightCap(visibleHeight: nil) == AlertBoundary.maxDetailHeight,
                     "没有屏幕（headless）时按上限开")

        // 安装器形态：无卡片、正文是 shell 原始输出（可能上百行）。
        let shellOutput = (0..<200).map { "npm ERR! 第 \($0) 行：EACCES permission denied /Applications/Deepseek Harness Launcher.app" }
            .joined(separator: "\n")
        let installer = NSAlert()
        installer.alertStyle = .critical
        installer.messageText = "未能安装 DHL"
        precondition(
            AlertBoundary.setBoundedText(shellOutput, on: installer, summary: "安装没有完成。", width: 360),
            "超长 shell 输出必须走「折进可滚动面板」分支"
        )
        precondition(installer.informativeText == "安装没有完成。")
        guard let installerScroll = find(NSScrollView.self, in: installer.accessoryView ?? NSView()),
              let installerText = find(NSTextView.self, in: installer.accessoryView ?? NSView()) else {
            preconditionFailure("安装器形态的长正文没转成可滚动面板")
        }
        precondition(installerText.string.contains("第 199 行"), "面板里必须保留完整原文，用户才查得出原因")
        precondition(installerScroll.fittingSize.height <= AlertBoundary.maxDetailHeight + 1,
                     "安装器弹窗面板高度未封顶：\(installerScroll.fittingSize.height)")
        installer.addButton(withTitle: "好")
        AlertBoundary.configureForPresentation(installer, escapeButtonIndex: 0)
        precondition(installer.buttons[0].keyEquivalent == AlertBoundary.escapeKeyEquivalent)
        if let visible = AlertBoundary.visibleScreenHeight {
            precondition(installer.window.frame.height <= visible + 1,
                         "安装器弹窗超出屏幕可视高：\(installer.window.frame.height) > \(visible)")
        }

        // MARK: 小屏预算（注入 visibleHeight，模拟老 Intel Mac 的低分辨率屏）

        // 已经走过「正文封顶」的弹窗，在 420pt 高的屏幕上仍然放不下时必须继续压：
        // 按钮可达优先于外观（这一档会丢掉圆角卡片，但一个字都不少）。
        let squeezed = NSAlert()
        AlertDesign.setBoundedText(longText, on: squeezed)
        squeezed.messageText = "检测到 12 个插件可能与当前 dsh 版本不兼容"
        squeezed.addButton(withTitle: "知道了")
        squeezed.layout()
        precondition(squeezed.window.frame.height > 420, "用例前提：默认面板在 420pt 屏幕上放不下")
        AlertBoundary.configureForPresentation(squeezed, escapeButtonIndex: 0, visibleHeight: 420)
        precondition(squeezed.window.frame.height <= 421,
                     "小屏预算没能把窗口压回屏幕内：\(squeezed.window.frame.height)")
        let keptText = find(NSTextView.self, in: squeezed.accessoryView ?? NSView())?.string ?? ""
        precondition(keptText.contains("bundle-59"), "压缩过程不许丢内容：\(keptText.prefix(40))")

        // 带交互控件的卡片（更新弹窗的版本下拉）不能被压缩流程销毁：
        // 那是用户唯一能选版本的入口，宁可只压正文。
        let pickerAlert = NSAlert()
        pickerAlert.messageText = "发现 Deepseek Harness 新版本"
        pickerAlert.informativeText = String(repeating: "更新说明", count: 200)
        let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 200, height: 25), pullsDown: false)
        popup.addItem(withTitle: "v0.4.0")
        pickerAlert.accessoryView = AlertDesign.card(rows: [popup])
        pickerAlert.addButton(withTitle: "更新")
        pickerAlert.addButton(withTitle: "稍后")
        AlertBoundary.configureForPresentation(pickerAlert, escapeButtonIndex: 1, visibleHeight: 300)
        precondition(find(NSPopUpButton.self, in: pickerAlert.accessoryView ?? NSView()) != nil,
                     "压缩不得销毁版本下拉")
        precondition(pickerAlert.informativeText.count <= 64,
                     "交互卡片场景至少要把超长正文压掉：\(pickerAlert.informativeText.count)")
        precondition(pickerAlert.buttons[1].keyEquivalent == AlertBoundary.escapeKeyEquivalent)

        // 交互卡片里的**只读面板**要能压：更新弹窗 = 版本下拉 + 说明面板，说明面板
        // 最高 300pt，老 Intel Mac（1024x768 可视高约 728）放不下时，压缩流程必须
        // 先压面板高度，而不是把整块卡片丢掉——用户既要点得到下拉，也得看得懂在更新什么。
        let longNotes = "## 本次更新\n\n" + String(repeating: "- 每一行都是更新内容\n", count: 60)
        func makePickerAlert(body: String) -> NSAlert {
            let alert = NSAlert()
            alert.messageText = "Deepseek Harness 有 3 个可选更新版本"
            alert.informativeText = body
            // 卡片里既要有说明面板，也要有下拉：`findScroll` 只取第一个滚动视图时，
            // 会撞上 NSPopUpButton 内部那个没有高度约束的滚动视图，压缩直接失效。
            let chooser = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 200, height: 25), pullsDown: false)
            chooser.addItem(withTitle: "v0.4.0")
            let pane = makeReleaseNotesText(width: 402, height: releaseNotesHeight(for: longNotes))
            renderReleaseNotes(longNotes, into: pane.textView)
            alert.accessoryView = AlertDesign.card(rows: [chooser, pane.scroll])
            alert.addButton(withTitle: "更新")
            alert.addButton(withTitle: "稍后")
            alert.layout()
            return alert
        }
        let tallPicker = makePickerAlert(
            body: "更新会从 npm 下载所选版本并自动重启 Deepseek Harness；会话、归档与插件数据不受影响。"
        )
        tallPicker.layout()
        precondition(tallPicker.window.frame.height > 420,
                     "用例前提：满高说明面板的更新弹窗在 420pt 屏上放不下：\(tallPicker.window.frame.height)")
        AlertBoundary.configureForPresentation(tallPicker, escapeButtonIndex: 1, visibleHeight: 420)
        precondition(tallPicker.window.frame.height <= 421,
                     "更新弹窗在小屏上没能压回屏幕内：\(tallPicker.window.frame.height)")
        precondition(find(NSPopUpButton.self, in: tallPicker.accessoryView ?? NSView()) != nil,
                     "压缩不得销毁版本下拉")
        let tallNotesText = find(NSTextView.self, in: tallPicker.accessoryView ?? NSView())?.string ?? ""
        precondition(tallNotesText.contains("每一行都是更新内容"),
                     "压缩不得丢掉说明内容：\(tallNotesText.prefix(40))")
        precondition(tallPicker.informativeText.count > 40,
                     "面板压得动时不该顺手砍正文：\(tallPicker.informativeText)")

        // 同一张卡片，正文也忘了封顶（440 字符）时：压面板不够，最后一层只砍正文，
        // 下拉与说明面板仍然原地留着——砍掉用户唯一的版本入口比少看一行正文严重得多。
        let crowdedPicker = makePickerAlert(body: String(repeating: "更新会从 npm 下载所选版本", count: 40))
        precondition(crowdedPicker.window.frame.height > 420, "用例前提：超长正文的更新弹窗放不下")
        AlertBoundary.configureForPresentation(crowdedPicker, escapeButtonIndex: 1, visibleHeight: 420)
        precondition(crowdedPicker.window.frame.height <= 421,
                     "砍完正文仍没回到屏内：\(crowdedPicker.window.frame.height)")
        precondition(find(NSPopUpButton.self, in: crowdedPicker.accessoryView ?? NSView()) != nil,
                     "最后一层不得销毁版本下拉")
        precondition(crowdedPicker.informativeText.count <= 64,
                     "正文忘走护栏时最后一层要砍正文：\(crowdedPicker.informativeText.count)")
        precondition(
            find(NSTextView.self, in: crowdedPicker.accessoryView ?? NSView())?.string.contains("每一行都是更新内容") == true,
            "砍正文时说明面板的内容不能跟着没"
        )

        // MARK: 忘了走护栏时的最后一层：configureForPresentation 自己把窗口压回屏幕内
        //
        // 前两条护栏（正文封顶 + 屏幕预算）是各调用点的责任；这一条兜住以后新加的
        // 弹窗忘了走它们。事故形态就是按钮掉到屏幕外、runModal 关不掉。
        let reckless = NSAlert()
        reckless.messageText = "未走护栏的提示框"
        reckless.informativeText = (0..<400).map { "line \($0): 一长串没有封顶的正文" }.joined(separator: "\n")
        reckless.addButton(withTitle: "好")
        reckless.addButton(withTitle: "查看日志")
        precondition(find(NSScrollView.self, in: reckless.accessoryView ?? NSView()) == nil,
                     "没走护栏时不该已经有面板")
        AlertBoundary.configureForPresentation(reckless, escapeButtonIndex: 0)
        precondition(reckless.informativeText.count <= 64, "忘走护栏时正文必须被折进面板：\(reckless.informativeText.count)")
        let recklessScroll = find(NSScrollView.self, in: reckless.accessoryView ?? NSView())
        precondition(recklessScroll != nil, "最后一层护栏必须补出可滚动面板")
        if let visible = AlertBoundary.visibleScreenHeight {
            precondition(reckless.window.frame.height <= visible + 1,
                         "最后一层没把窗口压回屏幕内：\(reckless.window.frame.height) > \(visible)")
        }
    }
}
