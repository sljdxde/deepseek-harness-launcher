import AppKit

/// 菜单栏图标的角标合成：**会话未读**（Foxmail 式红色胶囊 + 数字，右下）与
/// **有可用更新**（蓝底向上箭头圆盘，右上）。
///
/// 为什么要单独合成一张图：菜单栏剪影走的是 template 机制，系统按菜单栏明暗
/// 自己染色，而 template 没法只给局部上色。所以这里先把剪影按明暗染成白/黑，
/// 再把角标叠上去，产出一张普通图（`isTemplate = false`）。
///
/// 两种角标同时存在时上下排开（圆盘在上、胶囊在下），合成图高度保持不变
/// （20，与只用一种角标时一致），菜单栏不会因为多了角标而变高。
enum StatusBadgeSupport {
    /// 剪影本身是 18×18，合成图高 20（上下各留 1pt 余量，与历史版本一致）。
    static let iconSide: CGFloat = 18
    static let compositeHeight: CGFloat = 20
    /// 未读胶囊与更新圆盘各占角标区的一半，两者首尾相接不重叠。
    static let badgeSide: CGFloat = 10

    /// 角标要画什么：未读文案（nil 表示没有未读）与更新箭头符号（nil 表示没有更新）。
    struct Plan: Equatable {
        let unreadText: String?
        let updateGlyph: String?
    }

    /// 未读角标只给「未读条数」用；更新角标固定一个向上箭头。
    static let updateGlyph = "↑"

    /// 由调用方给的两条链路状态推出角标内容。会话未读条数 ≤ 0 时由调用方传 nil。
    static func plan(unreadText: String?, updateAvailable: Bool) -> Plan {
        Plan(unreadText: unreadText, updateGlyph: updateAvailable ? updateGlyph : nil)
    }

    /// 有角标（或菜单栏上还有状态文案）时必须用可变长占位，否则文案/角标被裁掉。
    static func needsVariableLength(_ plan: Plan, hasTitle: Bool) -> Bool {
        plan.unreadText != nil || plan.updateGlyph != nil || hasTitle
    }

    /// 合成菜单栏图标。没有任何角标时退化成 template 剪影（交给系统染色）。
    static func image(base: NSImage, plan: Plan, isDark: Bool) -> NSImage {
        guard plan.unreadText != nil || plan.updateGlyph != nil else {
            let image = base.copy() as! NSImage
            image.size = NSSize(width: 20, height: compositeHeight)
            image.isTemplate = true
            return image
        }

        let pillFont = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .bold)
        let pillTextSize = (plan.unreadText as NSString?)?.size(withAttributes: [.font: pillFont]) ?? .zero
        // 胶囊宽度只跟数字走：没有未读时它不参与布局，免得宽度凭空多出一块。
        let pillWidth = plan.unreadText == nil ? badgeSide : max(badgeSide, ceil(pillTextSize.width) + 6)
        let badgeWidth = max(pillWidth, badgeSide)
        let size = NSSize(width: iconSide + badgeWidth - 3, height: compositeHeight)

        let image = NSImage(size: size)
        image.lockFocus()

        // 剪影画在左上（AppKit 的 lockFocus 坐标系原点在左下，所以 y 取 20 - 18）。
        let iconRect = NSRect(x: 0, y: size.height - iconSide, width: iconSide, height: iconSide)
        base.draw(in: iconRect)
        (isDark ? NSColor.white : NSColor.black).setFill()
        iconRect.fill(using: .sourceAtop)

        if let text = plan.unreadText {
            let rect = NSRect(x: size.width - pillWidth, y: 0, width: pillWidth, height: badgeSide)
            NSColor.systemRed.setFill()
            NSBezierPath(roundedRect: rect, xRadius: badgeSide / 2, yRadius: badgeSide / 2).fill()
            let textPoint = NSPoint(
                x: rect.midX - pillTextSize.width / 2,
                y: rect.midY - pillTextSize.height / 2
            )
            (text as NSString).draw(at: textPoint, withAttributes: [.font: pillFont, .foregroundColor: NSColor.white])
        }

        if let glyph = plan.updateGlyph {
            let rect = NSRect(x: size.width - badgeSide, y: size.height - badgeSide, width: badgeSide, height: badgeSide)
            let font = NSFont.systemFont(ofSize: 8, weight: .bold)
            let glyphSize = (glyph as NSString).size(withAttributes: [.font: font])
            // 蓝色与未读的红色区分开：红=会话要处理，蓝=有新版本可用。
            NSColor.systemBlue.setFill()
            NSBezierPath(ovalIn: rect).fill()
            let glyphPoint = NSPoint(
                x: rect.midX - glyphSize.width / 2,
                y: rect.midY - glyphSize.height / 2
            )
            (glyph as NSString).draw(at: glyphPoint, withAttributes: [.font: font, .foregroundColor: NSColor.white])
        }

        image.unlockFocus()
        image.isTemplate = false
        return image
    }
}
