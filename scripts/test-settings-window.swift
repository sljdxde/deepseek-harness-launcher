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

        // 版式：更新卡片少了一行，卡片仍必须完整落在窗口里（高度改错会把底部
        // 按钮挤出可视区，而这对纯逻辑断言是不可见的）。
        controller.window?.layoutIfNeeded()
        if let root = content.subviews.first?.subviews.first, !root.subviews.isEmpty {
            for subview in root.subviews {
                // 标签列刻意左移 2pt 做视觉对齐（makeLabel 的历史行为），所以只卡
                // 「别越出可视区」这一条，并给 2pt 容差。
                let allowed = root.bounds.insetBy(dx: -2, dy: -2)
                check(allowed.contains(subview.frame),
                      "设置窗口控件超出可视区：\(type(of: subview)) \(subview.frame) 不在 \(root.bounds)")
            }
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
