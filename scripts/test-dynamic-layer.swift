import AppKit

/// `DynamicLayerView` 的外观回调回归。
///
/// 起因：设置窗口的卡片用 `layer.backgroundColor = 语义色.cgColor` 上色。
/// `cgColor` 在赋值那一刻就把动态色解析成固定 RGBA —— 窗口若先在浅色下创建，
/// 之后系统切到夜间模式，卡片仍是纯白底（实测 255,255,255），配白色文字糊成
/// 一片，这就是「夜间模式下字体看不清」的另一半原因。
///
/// 这里锁死：同一个视图在浅色与深色下必须解析出**不同**的图层颜色。

@main
struct DynamicLayerChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func rgb(_ color: CGColor?) -> (Int, Int, Int)? {
        guard let components = color?.components, components.count >= 3 else { return nil }
        return (Int(components[0] * 255), Int(components[1] * 255), Int(components[2] * 255))
    }

    static func main() {
        let view = DynamicLayerView { view, appearance in
            let background = NSColor.controlBackgroundColor.withAlphaComponent(0.78)
            appearance.performAsCurrentDrawingAppearance {
                view.layer?.backgroundColor = background.cgColor
            }
        }
        view.wantsLayer = true

        // 浅色
        view.appearance = NSAppearance(named: .aqua)
        view.refresh()
        let light = rgb(view.layer?.backgroundColor)

        // 深色（同一个视图，不重建 —— 正是真实路径）
        view.appearance = NSAppearance(named: .darkAqua)
        view.refresh()
        let dark = rgb(view.layer?.backgroundColor)

        check(light != nil, "浅色下必须解析出图层底色")
        check(dark != nil, "深色下必须解析出图层底色")
        if let light, let dark {
            check(light != dark, "浅色 \(light) 与深色 \(dark) 的卡片底色相同：动态色被冻结了")
            // 深色卡片必须比浅色暗，否则夜间会是亮底。
            let lightLum = 0.2126 * Double(light.0) + 0.7152 * Double(light.1) + 0.0722 * Double(light.2)
            let darkLum = 0.2126 * Double(dark.0) + 0.7152 * Double(dark.1) + 0.0722 * Double(dark.2)
            check(darkLum < lightLum, "深色卡片 \(dark) 不比浅色 \(light) 暗，夜间会出现亮底")
        }

        // 外观切回来必须能恢复，不能单向固化。
        view.appearance = NSAppearance(named: .aqua)
        view.refresh()
        let backToLight = rgb(view.layer?.backgroundColor)
        let restored: Bool
        switch (backToLight, light) {
        case let (back?, light?): restored = back == light
        default: restored = false
        }
        check(restored, "切回浅色后应恢复为 \(String(describing: light))，实际 \(String(describing: backToLight))")

        if failures.isEmpty {
            print("dynamic layer checks passed")
            return
        }
        for failure in failures { print("✗ \(failure)") }
        exit(1)
    }
}
