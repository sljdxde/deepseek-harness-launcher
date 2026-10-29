import AppKit

/// 提示框的可达性护栏：长正文封顶、屏幕预算、Esc、弹窗不叠加。
///
/// 为什么要从 `AlertDesign` 里单独拆出来：安装器（`Installer/main.swift`）是独立
/// 编译目标，只链这一个文件就能拿到同一套护栏；`AlertDesign` 还依赖发布通道
/// （`DSHReleaseChannel`）等 App 侧类型，拖不进安装器。安装器的失败弹窗会把
/// `install-from-app.sh` 的原始输出直接塞进正文——和真机事故「提示框占满屏幕、
/// 软件卡死」是同一条路径（完整复盘见 `docs/ui-boundary-audit.md`）。
///
/// 护栏分三层，缺一不可：
/// 1. **内容封顶**（`setBoundedText`）：超过 `detailCharacterThreshold` 的正文转成
///    高度封顶的可滚动面板，NSAlert 不再随行数线性长高；
/// 2. **屏幕预算**（`detailHeightCap`）：面板高度再按当前屏幕 `visibleFrame` 收一道，
///    老 Intel Mac 接 1024x768 甚至更低分辨率时自动变矮；
/// 3. **显示前复核**（`configureForPresentation`）：量一次窗口实际高度，仍然超屏就
///    继续压缩（压面板 → 折正文 → 只留一行），保证按钮永远可达。第 1、2 层是各调用点
///    的责任，第 3 层兜住「以后有人新加弹窗忘了走护栏」。
enum AlertBoundary {
    /// 正文超过这个字符数就不再直接放进 `informativeText`。
    ///
    /// `NSAlert` 的高度随正文行数线性增长，且**不会**自动收进屏幕：实测 40 行正文
    /// 在 968pt 可视高的屏幕上把窗口顶到 1449pt，底部按钮整排落到屏幕外，
    /// `runModal()` 同步阻塞主线程，用户既点不到按钮也关不掉 App。
    static let detailCharacterThreshold = 240

    /// 可滚动详情面板的绝对高度上限。
    static let maxDetailHeight: CGFloat = 220

    /// 详情面板的最小高度：再小就几乎读不到内容，此时宁可压缩正文。
    static let minDetailHeight: CGFloat = 72

    /// Esc 的 keyEquivalent。单独抽出来给测试断言，避免「以为挂上了其实写错了字符」。
    static let escapeKeyEquivalent = "\u{1b}"

    /// 窗口里除详情面板之外的固定开销（图标 + 标题 + 摘要 + 按钮 + 边距）实测下限。
    /// 用它把「屏幕还剩多少高度」换算成面板可用高度。
    static let chromeHeightBudget: CGFloat = 300

    /// 单行文案（菜单项、状态栏）的默认最大字符数：包名与版本号来自远端，长度不受本地控制。
    static let maxSingleLineCharacters = 72

    // MARK: - 屏幕预算

    /// 当前可用屏幕的可视区高度；没有窗口服务器（命令行工具、headless）返回 nil。
    static var visibleScreenHeight: CGFloat? {
        (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame.height
    }

    /// 详情面板在当前屏幕上的高度上限：`maxDetailHeight` 与「可视高 - 固定开销」取小，
    /// 再兜到不小于 `minDetailHeight`。
    static func detailHeightCap(visibleHeight: CGFloat? = visibleScreenHeight) -> CGFloat {
        guard let visibleHeight else { return maxDetailHeight }
        return min(maxDetailHeight, max(minDetailHeight, visibleHeight - chromeHeightBudget))
    }

    // MARK: - 正文封顶

    /// 把可能很长的文本折成一行：换行折叠成 ` / `，超长加省略号。
    /// 用于菜单项与状态栏文案——`MenuRowView` 的行宽固定，NSMenu 也不会自己收窄，
    /// 不封顶的话文案会被切掉或和快捷键重叠。
    static func singleLine(_ text: String, limit: Int = maxSingleLineCharacters) -> String {
        let collapsed = text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " / ")
        guard collapsed.count > limit else { return collapsed }
        return String(collapsed.prefix(limit - 1)) + "…"
    }

    /// 按字符数截断（单行用途：日志行、失败原因）。
    static func summarized(_ text: String, limit: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > limit else { return trimmed }
        return String(trimmed.prefix(max(1, limit - 1))) + "…"
    }

    /// 只读滚动面板的唯一构造点：提示框详情面板与更新弹窗的「说明」面板共用。
    ///
    /// 必须只有一份实现，因为 `fitWithinScreen` 依赖一条不变量——**scroll 自持一条可以
    /// 修改的高度约束**。两处各写一遍时，任何一处漏掉约束（NSScrollView 没有 intrinsic
    /// content size，放进 NSStackView 只靠 frame 会被压成一条细线）或被写成 `required`，
    /// 压缩就会静默失效，窗口重新长回屏幕外。
    /// - Parameter style: 逐面板微调；调用方若自己渲染富文本，传入的属性会覆盖这里的默认值。
    static func textPane(
        _ text: String = "",
        width: CGFloat,
        height: CGFloat,
        style: (NSTextView) -> Void = { textView in
            textView.font = NSFont.systemFont(ofSize: 12)
            textView.textColor = .secondaryLabelColor
        }
    ) -> (scroll: NSScrollView, textView: NSTextView) {
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 0, height: 2)
        textView.textContainer?.lineFragmentPadding = 0
        textView.minSize = NSSize(width: width, height: height)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        style(textView)
        textView.string = text

        let scroll = NSScrollView()
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        scroll.backgroundColor = .clear
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            scroll.widthAnchor.constraint(equalToConstant: width),
            scroll.heightAnchor.constraint(equalToConstant: height)
        ])
        return (scroll, textView)
    }

    /// 只读、可滚动的正文面板，高度由调用方给出（通常来自 `detailHeight(for:)`）。
    static func scrollableText(_ text: String, width: CGFloat, height: CGFloat) -> NSScrollView {
        textPane(text, width: width, height: height).scroll
    }

    /// 按行数估算面板高度，并夹在屏幕预算内。
    static func detailHeight(for text: String) -> CGFloat {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).count
        return min(detailHeightCap(), max(minDetailHeight, CGFloat(max(lines, 4)) * 17 + 18))
    }

    /// 把一段可能很长的正文安全地放进提示框：短文本走正文；超长时正文只留 `summary`，
    /// 完整内容放进可滚动面板。`wrap` 让调用方把面板包进自己的卡片（App 侧用圆角卡片，
    /// 安装器直接用最简面板）。
    /// - Returns: 是否走了「折进面板」分支（false 表示原文直接进正文）。
    @discardableResult
    static func setBoundedText(
        _ text: String,
        on alert: NSAlert,
        summary: String = "内容较长，可在下方滚动查看；完整内容见日志。",
        width: CGFloat = 402,
        wrap: (NSView) -> NSView = { $0 }
    ) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > detailCharacterThreshold else {
            alert.informativeText = trimmed
            return false
        }
        // 已有 accessory（更新弹窗的结构卡片）时不覆盖：改为截断正文，
        // 窗口高度继续由「卡片 + 一小段正文」决定。
        guard alert.accessoryView == nil else {
            alert.informativeText = summarized(trimmed, limit: detailCharacterThreshold) + "\n…（完整内容见日志）"
            return false
        }
        alert.informativeText = summary
        alert.accessoryView = wrap(scrollableText(trimmed, width: width, height: detailHeight(for: trimmed)))
        return true
    }

    // MARK: - 统一弹窗入口

    /// 当前是否已经有一个 modal 提示框在跑。后台定时器触发的提示（插件兼容性检查、
    /// 会话提醒）用它避免在用户正在看的弹窗上再叠一层。
    private(set) static var isModalPresented = false

    /// 统一弹窗入口。所有提示框都应该走这里，而不是直接 `alert.runModal()`：
    /// 只有这一处统一挂 Esc、复核窗口高度、收窗口位置，并让后台触发的提示能检测到
    /// 「已有 modal」。
    @discardableResult
    static func run(_ alert: NSAlert, escapeButtonIndex: Int? = nil) -> NSApplication.ModalResponse {
        configureForPresentation(alert, escapeButtonIndex: escapeButtonIndex)
        NSApp.activate(ignoringOtherApps: true)
        isModalPresented = true
        defer { isModalPresented = false }
        return alert.runModal()
    }

    /// 后台触发的提示用这个：已有弹窗时直接跳过（返回 nil），绝不往用户正在看的
    /// modal 上叠第二层——那是最容易变成「两个框互相等、谁也关不掉」的形态。
    @discardableResult
    static func runIfIdle(_ alert: NSAlert, escapeButtonIndex: Int? = nil) -> NSApplication.ModalResponse? {
        guard !isModalPresented else { return nil }
        return run(alert, escapeButtonIndex: escapeButtonIndex)
    }

    /// 弹窗前的统一收尾：挂 Esc、把窗口压回屏幕内、对齐可视区。
    ///
    /// Esc 是硬护栏：`NSAlert` 默认只有第一个按钮吃回车，Esc 什么也不做；一旦按钮
    /// 落到屏幕外，鼠标点不到、键盘也关不掉，`runModal()` 会永久占住主线程（真机事故）。
    ///
    /// 窗口定位只是兜底，**不是**超屏窗口的可达性保证：`runModal()` 显示时会自己重新
    /// 居中窗口（实测 60 行正文的窗口 run 之前钉到屏幕底边，run 之后仍被居中到屏幕外；
    /// modal 循环里用 timer 改 origin 也压不住）。真正保证按钮可达的是 `fitWithinScreen`。
    /// - Parameter visibleHeight: 注入的屏幕预算，默认取当前屏幕；单测用它模拟小屏。
    static func configureForPresentation(
        _ alert: NSAlert,
        escapeButtonIndex: Int?,
        visibleHeight: CGFloat? = visibleScreenHeight
    ) {
        if let index = escapeButtonIndex, alert.buttons.indices.contains(index) {
            alert.buttons[index].keyEquivalent = escapeKeyEquivalent
        }
        fitWithinScreen(alert, visibleHeight: visibleHeight)
        clampOrigin(alert, visibleHeight: visibleHeight)
    }

    /// 窗口仍然高于屏幕可视区时逐层压缩：先压详情面板，再重建面板，最后压正文。
    ///
    /// 每一步都单调让窗口变矮，所以一定收敛。走到这里说明调用方忘了走第 1、2 层护栏
    /// （或屏幕确实放不下），此时的取舍是**宁可少显示内容也不让按钮出屏**：完整内容
    /// 永远还在日志里，而一个关不掉的 modal 会让整个软件失去响应。
    ///
    /// 例外：accessory 里有可操作控件（更新弹窗的「版本下拉」）时**绝不销毁它**——
    /// 那是用户唯一能选版本的地方，宁可只压缩正文。
    /// 销毁之外还有得救：卡片里的**只读**面板（更新弹窗的说明面板）照样可以压矮，
    /// 所以第 1 步不看 `interactive`，只有第 2、3 步的「丢面板」才绕着交互控件走。
    private static func fitWithinScreen(_ alert: NSAlert, visibleHeight: CGFloat?) {
        guard let visibleHeight else { return }
        alert.layout()
        guard alert.window.frame.height > visibleHeight else { return }
        let interactive = isInteractive(alert.accessoryView)

        // 1) 先按屏幕预算压**所有**只读面板的高度（改的只是约束，卡片外观与里面的控件都不动）。
        //    这一步不看 `interactive`：更新弹窗里既有版本下拉又有说明面板，
        //    下拉必须留着，但面板可以压矮。
        let panes = shrinkablePanes(in: alert.accessoryView)
        if !panes.isEmpty {
            var step = 0
            while alert.window.frame.height > visibleHeight, step < 5,
                  shrinkPanes(panes, to: max(minDetailHeight, visibleHeight - chromeHeightBudget - CGFloat(step) * 40)) {
                refitFrames(in: alert.accessoryView)
                alert.layout()
                step += 1
            }
            if alert.window.frame.height <= visibleHeight { return }
        }
        // 2) 压不动，或者压根没走护栏（没有 accessory 却塞了超长正文）：把全部文字
        //    重建成一块按预算定高的裸面板——丢掉圆角卡片，但一个字都不少。
        //    accessory 里有交互控件时不销毁，留给第 3 步只压正文。
        if !interactive {
            let full = detailText(alert)
            if !full.isEmpty {
                alert.informativeText = summarized(full, limit: 32)
                alert.accessoryView = scrollableText(
                    full, width: fallbackPanelWidth, height: max(minDetailHeight, visibleHeight - chromeHeightBudget)
                )
                alert.layout()
                if alert.window.frame.height <= visibleHeight { return }
            }
        }
        // 3) 最后一步：正文压成一行摘要。有交互控件时正文只压自己（面板里的说明用户
        //    还看得见，不必并进摘要）；没有交互控件时 accessory 要被丢掉，先把面板
        //    文本并进摘要再截——内容在日志里，按钮可达优先。
        alert.informativeText = summarized(interactive ? alert.informativeText : detailText(alert), limit: 32)
        if !interactive { alert.accessoryView = nil }
        alert.layout()
    }

    /// accessory 里有没有「用户必须能点到」的控件。
    private static func isInteractive(_ view: NSView?) -> Bool {
        guard let view else { return false }
        if view is NSButton || view is NSStepper || view is NSSlider { return true }
        if let field = view as? NSTextField, field.isEditable { return true }
        return view.subviews.contains(where: isInteractive)
    }

    /// 兜底面板宽度：与 `AlertDesign.cardWidth - 28` 对齐，1024 宽的老屏也放得下。
    private static let fallbackPanelWidth: CGFloat = 402

    /// 弹窗当前的「详细内容」：正文 + 详情面板里的文本。压缩时靠它保证内容不丢。
    private static func detailText(_ alert: NSAlert) -> String {
        let body = alert.informativeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let textView = findTextView(in: alert.accessoryView) else { return body }
        let detail = textView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if detail.isEmpty || detail == body { return body }
        return body + "\n\n" + detail
    }

    /// scroll 自持的那条高度约束（`textPane` 加的），没有则返回 nil。
    private static func heightConstraint(of scroll: NSScrollView) -> NSLayoutConstraint? {
        scroll.constraints.first {
            $0.firstAttribute == .height && ($0.firstItem as? NSScrollView) === scroll && $0.secondItem == nil
        }
    }

    /// 找出 accessory 里所有「压得动」的只读面板：**全部**而不是第一个。
    /// 判据是自带可修改的高度约束且自身不含交互控件——NSPopUpButton 内部也有滚动视图，
    /// 但它没有这条约束，只取第一个会直接卡在那一层上（实测更新弹窗压不动）。
    private static func shrinkablePanes(in view: NSView?) -> [NSScrollView] {
        guard let view else { return [] }
        if let scroll = view as? NSScrollView,
           !isInteractive(scroll),
           heightConstraint(of: scroll) != nil {
            return [scroll]
        }
        return view.subviews.flatMap { shrinkablePanes(in: $0) }
    }

    /// 把一组面板一起压到目标高度。
    /// - Returns: 是否真的改小了任意一块（全都已到目标时返回 false，调用方转下一层）。
    private static func shrinkPanes(_ panes: [NSScrollView], to height: CGFloat) -> Bool {
        var shrunk = false
        for pane in panes {
            guard let constraint = heightConstraint(of: pane), height < constraint.constant else { continue }
            constraint.constant = height
            shrunk = true
        }
        return shrunk
    }

    /// 约束改完之后，自底向上把外层容器的 frame 高度一起收进 `fittingSize`。
    ///
    /// 少了这一步，压面板对窗口高度**毫无作用**：`AlertDesign.card` 这类容器建好时按
    /// `stack.fittingSize` 定了一次 frame，之后不再跟着内部约束重算，而 NSAlert 摆放
    /// accessory 用的就是它的 frame（实测面板从 300 压到 72 后，卡片仍是 356、窗口仍是
    /// 574；把卡片 frame 跟着 fittingSize 收缩，窗口才降到 346）。
    /// 只往矮的方向改，且 `fittingSize` 为 0 时保持原样，避免把容器压成一条线。
    private static func refitFrames(in view: NSView?) {
        guard let view else { return }
        for sub in view.subviews { refitFrames(in: sub) }
        let fitting = view.fittingSize
        if fitting.height > 0, fitting.height < view.frame.height {
            view.frame.size.height = fitting.height
        }
    }

    private static func findTextView(in view: NSView?) -> NSTextView? {
        guard let view else { return nil }
        if let hit = view as? NSTextView { return hit }
        for sub in view.subviews {
            if let hit = findTextView(in: sub) { return hit }
        }
        return nil
    }

    /// 把窗口 origin 收进可视区（best effort：`runModal` 之后仍可能重新居中）。
    private static func clampOrigin(_ alert: NSAlert, visibleHeight: CGFloat?) {
        let window = alert.window
        guard let screen = window.screen ?? NSScreen.main else { return }
        var visible = screen.visibleFrame
        // 注入的预算比真实屏幕更小时（单测模拟小屏），按注入值收位，断言才有意义。
        if let visibleHeight, visibleHeight < visible.height {
            visible = NSRect(x: visible.minX, y: visible.maxY - visibleHeight, width: visible.width, height: visibleHeight)
        }
        let frame = window.frame
        guard frame.width > 0, frame.height > 0, frame.height <= visible.height else { return }
        var origin = frame.origin
        origin.y = min(max(origin.y, visible.minY), visible.maxY - frame.height)
        origin.x = min(max(origin.x, visible.minX), visible.maxX - frame.width)
        if origin != frame.origin { window.setFrameOrigin(origin) }
    }
}
