import AppKit

/// 一个会在**外观变化时重新解析动态颜色**的 NSView。
///
/// 为什么需要它：`layer.backgroundColor = NSColor.xxx.cgColor` 会在赋值那一刻
/// 把动态颜色（跟随浅色/深色的语义色）解析成固定的 RGBA。窗口先以浅色创建、
/// 系统随后切到夜间模式时，图层仍停在浅色值——实测设置窗口的卡片在深色下
/// 是纯白底（255,255,255），配白色文字直接糊成一片。
///
/// AppKit 不会替 `CALayer` 做这件事：`viewDidChangeEffectiveAppearance` 是
/// 唯一可靠的时机，在它里面用当前 appearance 重新取 `cgColor`。
///
/// 用法：把「怎么用当前外观画自己」写进 `apply` 闭包，构造时立即执行一次，
/// 之后每次外观变化自动重跑。
final class DynamicLayerView: NSView {
    /// `apply(view, appearance)`：在 appearance 生效的上下文里重设图层颜色。
    private let apply: (DynamicLayerView, NSAppearance) -> Void

    init(apply: @escaping (DynamicLayerView, NSAppearance) -> Void) {
        self.apply = apply
        super.init(frame: .zero)
        refresh()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        refresh()
    }

    /// 按当前 `effectiveAppearance` 重设颜色。测试直接调它来模拟外观切换。
    func refresh() {
        let appearance = effectiveAppearance
        // 必须把 appearance 设为「当前绘制外观」，否则 cgColor 仍按进程级外观解析。
        appearance.performAsCurrentDrawingAppearance { [self] in
            apply(self, appearance)
        }
    }
}
