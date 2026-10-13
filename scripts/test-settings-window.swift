import AppKit
import Foundation

/// 设置窗口的状态一致性（纯 AppKit，不需要事件循环）：
/// - 窗口是复用的（isReleasedWhenClosed = false），**点「取消」关窗后重新打开，
///   界面必须回到已保存的设置**——否则用户看到的是被自己取消掉的勾选/间隔/快捷键，
///   会以为设置已经生效（例如以为「自动检测更新」已关，其实还开着）；
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
        let expectedAuto = settings.autoUpdateEnabled ? NSControl.StateValue.on : .off
        let autoBox = checkbox("自动检测启动器（DHL）更新")
        check(autoBox != nil, "找不到「自动检测启动器（DHL）更新」勾选框")
        check(autoBox?.state == expectedAuto, "打开设置时勾选状态应反映已保存的设置")

        let expectedInterval = max(settings.updateIntervalHours, 1)
        let intervalField = textFields(in: content).first { field in
            abs(field.doubleValue - expectedInterval) < 0.001 || field.placeholderString != nil
        }
        check(intervalField != nil, "找不到检查间隔输入框")

        // 模拟：改了勾选与间隔，然后点「取消」（关窗），再打开设置。
        autoBox?.state = expectedAuto == .on ? .off : .on
        intervalField?.doubleValue = expectedInterval + 7
        controller.close()
        controller.present()

        check(autoBox?.state == expectedAuto,
              "取消后再打开设置，勾选状态必须回到已保存的设置（未保存的编辑不该留在界面上）")
        check(abs((intervalField?.doubleValue ?? 0) - expectedInterval) < 0.001,
              "取消后再打开设置，检查间隔必须回到已保存的值（实际 \((intervalField?.doubleValue ?? -1))，期望 \(expectedInterval)）")

        // 窗口已经可见时 present() 不能把正在编辑的内容冲掉。
        autoBox?.state = expectedAuto == .on ? .off : .on
        controller.present()
        check(autoBox?.state != expectedAuto, "窗口已打开时 present() 不该重填控件、冲掉正在改的内容")
        controller.close()

        if failures.isEmpty {
            print("settings window checks passed")
        } else {
            for failure in failures { print("settings window check failed: \(failure)") }
            exit(1)
        }
    }
}
