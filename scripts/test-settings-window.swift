import AppKit
import Foundation

/// 设置窗口的状态一致性（纯 AppKit，不需要事件循环）：
/// - 后台检查是**常开**的：设置里没有「要不要自动检查更新」的开关，「检查频率」
///   必须始终可编辑（历史上它跟着那个开关一起变灰，用户看到灰输入框会以为没有
///   后台检查）；
/// - 窗口是复用的（isReleasedWhenClosed = false），**点「取消」关窗后重新打开，
///   界面必须回到已保存的设置**——否则用户看到的是被自己取消掉的勾选/间隔/快捷键，
///   会以为设置已经生效（例如以为「自动检测插件更新」已关，其实还开着）；
/// - 打开时控件与已保存设置的映射要一一对应。
///
/// 只读写界面与 LauncherSettings 的**读**路径：全程不调用 save()，不碰用户偏好文件。
@main
struct SettingsWindowChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func buttons(in view: NSView) -> [NSButton] {
        ((view as? NSButton).map { [$0] } ?? []) + view.subviews.flatMap { buttons(in: $0) }
    }

    static func textFields(in view: NSView) -> [NSTextField] {
        ((view as? NSTextField).map { [$0] } ?? []) + view.subviews.flatMap { textFields(in: $0) }
    }

    static func firstView<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
        if let hit = view as? T { return hit }
        for sub in view.subviews {
            if let hit = firstView(type, in: sub) { return hit }
        }
        return nil
    }

    static func firstControl<T: NSControl>(_ type: T.Type, in view: NSView) -> T? {
        if let hit = view as? T { return hit }
        for sub in view.subviews {
            if let hit = firstControl(type, in: sub) { return hit }
        }
        return nil
    }

    static func main() {
        _ = NSApplication.shared
        let settings = LauncherSettings.shared
        let controller = SettingsWindowController(onSave: { true }, onCheckNow: {})
        guard let content = controller.window?.contentView else {
            print("settings window checks failed: 没有 contentView")
            exit(1)
        }

        func checkbox(_ title: String) -> NSButton? {
            buttons(in: content).first { $0.title == title }
        }

        // 后台检查常开：既没有那个开关，频率输入框也不会因为它而变灰。
        check(checkbox("自动检测启动器（DHL）更新") == nil,
              "「自动检测启动器（DHL）更新」开关应已移除：后台检查常开，只提示不静默安装")
        let intervalField = textFields(in: content).first { $0.placeholderString == "6" }
        check(intervalField != nil, "找不到检查间隔输入框")
        check(intervalField?.isEnabled == true, "检查频率必须始终可编辑（不受任何开关牵制）")
        check(firstControl(NSStepper.self, in: content)?.isEnabled == true, "检查频率的步进器必须始终可用")

        let expectedPlugin = settings.autoCheckPluginUpdates ? NSControl.StateValue.on : .off
        let pluginBox = checkbox("自动检测插件更新")
        check(pluginBox != nil, "找不到「自动检测插件更新」勾选框")
        check(pluginBox?.state == expectedPlugin, "打开设置时勾选状态应反映已保存的设置")

        let expectedInterval = max(settings.updateIntervalHours, 1)
        check(abs((intervalField?.doubleValue ?? 0) - expectedInterval) < 0.001,
              "打开设置时间隔应反映已保存的值（实际 \((intervalField?.doubleValue ?? -1))，期望 \(expectedInterval)）")

        // 模拟：改了勾选与间隔，然后点「取消」（关窗），再打开设置。
        pluginBox?.state = expectedPlugin == .on ? .off : .on
        intervalField?.doubleValue = expectedInterval + 7
        controller.close()
        controller.present()

        check(pluginBox?.state == expectedPlugin,
              "取消后再打开设置，勾选状态必须回到已保存的设置（未保存的编辑不该留在界面上）")
        check(abs((intervalField?.doubleValue ?? 0) - expectedInterval) < 0.001,
              "取消后再打开设置，检查间隔必须回到已保存的值（实际 \((intervalField?.doubleValue ?? -1))，期望 \(expectedInterval)）")

        // 窗口已经可见时 present() 不能把正在编辑的内容冲掉。
        pluginBox?.state = expectedPlugin == .on ? .off : .on
        controller.present()
        check(pluginBox?.state != expectedPlugin, "窗口已打开时 present() 不该重填控件、冲掉正在改的内容")
        controller.close()

        // 版式：更新卡片高度是固定的（170→148 削过一次），里面的控件一旦溢出卡片，
        // 底部按钮就会被挤出可视区，而这对纯逻辑断言完全不可见。
        // 只遍历 root 的三张卡片本身是空转的——卡片自己当然在 root 里，溢出的是卡片
        // 里的子视图。定位不到卡片必须失败，否则层级一变断言就静默通过。
        // 边界：设置窗口是自撑高度、不可缩放、没有滚动条。当前实测 538pt（含标题栏），
        // 而 1280x800 / 1366x768 这类小屏的 NSScreen.visibleFrame 只有约 683-700pt；
        // 窗口一旦长过它，底部「保存/取消」就被顶出屏幕，而且不可缩放、找不回来。
        // 660pt 是给这两档小屏留出菜单栏/Dock 余量后的预算。
        let window = controller.window
        if let window {
            check(window.frame.height <= 660,
                  "设置窗口高度 \(Int(window.frame.height))pt 超出小屏预算 660pt：底部按钮会出屏")
            check(window.styleMask.contains(.closable), "设置窗口必须可关闭")
            check(window.styleMask.contains(.miniaturizable), "设置窗口必须可最小化")
        }
        controller.window?.layoutIfNeeded()
        // 内容整列放在滚动视图里（窗口高度受屏幕预算约束时靠它把「保存/取消」滚出来），
        // 所以根视图是 documentView，不再是 visualEffect 的直接子视图。
        guard let scroll = firstView(NSScrollView.self, in: content),
              let root = scroll.documentView, !root.subviews.isEmpty else {
            print("settings window check failed: 找不到设置窗口的滚动容器/根视图（版式断言会空转）")
            exit(1)
        }
        // 宽度回归锚点：documentView 一旦改成跟随容器宽度，AppKit 会按内容收缩
        // （实测 299pt），窗口右侧空出一条大空白，而这个问题在「高度由内容决定」
        // 的写法下不会被任何其它断言抓到。
        check(abs(root.frame.width - (520 - 48)) < 1,
              "设置窗口内容宽度必须等于 windowWidth - 左右内缩：\(root.frame.width)")
        check(abs(content.bounds.width - 520) < 1,
              "设置窗口的 contentView 宽度必须是 520：\(content.bounds.width)")
        check(scroll.contentView is TopLeftClipView,
              "裁剪视图必须翻转坐标：默认不翻转时窗口一打开就停在内容底部")
        check(scroll.scrollerStyle == .overlay, "滚动条必须用覆盖式：传统式会占掉内容宽度")

        // 窗口高度预算（纯函数，屏幕大小在测试机器上不可控，所以直接喂可视高）。
        let fits = SettingsWindowController.windowHeight(contentHeight: 538, visibleHeight: 968)
        check(fits.height == 538 && !fits.scrolls, "屏幕够高时窗口按内容开、不需要滚动：\(fits)")
        let small = SettingsWindowController.windowHeight(contentHeight: 538, visibleHeight: 500)
        check(small.height == 476 && small.scrolls,
              "500pt 可视高时窗口必须收到 476pt 并打开滚动：\(small)")
        let tiny = SettingsWindowController.windowHeight(contentHeight: 538, visibleHeight: 200)
        check(tiny.height == SettingsWindowController.minimumContentHeight,
              "极矮屏幕也要守住下限：\(tiny)")
        let headless = SettingsWindowController.windowHeight(contentHeight: 538, visibleHeight: nil)
        check(headless.height == 538 && !headless.scrolls, "没有窗口服务器时按内容开：\(headless)")
        check(window?.frame.height == fits.height || (window?.frame.height ?? 0) <= 660,
              "实际窗口高度应等于预算：\(window?.frame.height ?? -1)")
        for subview in root.subviews {
            // 标签列刻意左移 2pt 做视觉对齐（makeLabel 的历史行为），所以只卡
            // 「别越出可视区」这一条，并给 2pt 容差。
            let allowed = root.bounds.insetBy(dx: -2, dy: -2)
            check(allowed.contains(subview.frame),
                  "设置窗口控件超出可视区：\(type(of: subview)) \(subview.frame) 不在 \(root.bounds)")
        }

        // 更新卡片按标题文字定位（makeLabel 建的是 NSTextField，superview 就是卡片），
        // 然后逐个检查卡片内子视图——卡片高度是固定 148pt，行数一多就会顶出去。
        let updateTitleLabel = textFields(in: content).first { $0.stringValue == "更新检查" }
        guard let updateCard = updateTitleLabel?.superview else {
            print("settings window check failed: 找不到「更新检查」卡片，无法断言卡片内版式")
            exit(1)
        }
        check(!updateCard.subviews.isEmpty, "「更新检查」卡片里没有子视图：卡片内版式断言会空转")
        let cardBounds = updateCard.bounds.insetBy(dx: -2, dy: -2)
        for subview in updateCard.subviews {
            check(cardBounds.contains(subview.frame),
                  "更新卡片控件溢出卡片：\(type(of: subview)) \(subview.frame) 不在 \(updateCard.bounds)")
        }
        writePreviewIfRequested(content)

        if failures.isEmpty {
            print("settings window checks passed")
        } else {
            for failure in failures { print("settings window check failed: \(failure)") }
            exit(1)
        }
    }

    /// 肉眼验收用：`SETTINGS_PREVIEW=/tmp/settings.png ./build/test-settings-window`。
    static func writePreviewIfRequested(_ content: NSView) {
        guard let path = ProcessInfo.processInfo.environment["SETTINGS_PREVIEW"], !path.isEmpty else { return }
        guard let rep = content.bitmapImageRepForCachingDisplay(in: content.bounds) else {
            failures.append("设置窗口预览图创建失败")
            return
        }
        content.cacheDisplay(in: content.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            failures.append("设置窗口预览图编码失败")
            return
        }
        do {
            try png.write(to: URL(fileURLWithPath: path))
            print("settings preview: \(path)")
        } catch {
            failures.append("设置窗口预览图写入失败：\(error.localizedDescription)")
        }
    }
}
