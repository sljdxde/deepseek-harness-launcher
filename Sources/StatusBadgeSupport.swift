import AppKit

/// 菜单栏图标的角标合成：**有可用更新**（蓝底向上箭头圆盘，右上）。
///
/// 为什么要单独合成一张图：菜单栏剪影走的是 template 机制，系统按菜单栏明暗
/// 自己染色，而 template 没法只给局部上色。所以这里先把剪影按明暗染成白/黑，
/// 再把角标叠上去，产出一张普通图（`isTemplate = false`）。
///
/// 会话完成状态不在这里画：它完全交给 DSH 自己的侧栏状态点，启动器不再维护
/// 第二套未读口径（菜单栏数字、Dock 数字、侧栏红点曾经各说各话）。
enum StatusBadgeSupport {
    /// 剪影本身是 18×18，合成图高 20（上下各留 1pt 余量，与历史版本一致）。
    static let iconSide: CGFloat = 18
    static let compositeHeight: CGFloat = 20
    /// 角标区宽度，与剪影右侧重叠 3pt 后合成。
    static let badgeSide: CGFloat = 10

    /// 角标要画什么：更新箭头符号（nil 表示没有更新）。
    struct Plan: Equatable {
        let updateGlyph: String?
    }

    /// 更新角标固定一个向上箭头。
    static let updateGlyph = "↑"

    /// 由更新检查结论推出角标内容。
    static func plan(updateAvailable: Bool) -> Plan {
        Plan(updateGlyph: updateAvailable ? updateGlyph : nil)
    }

    /// 有角标（或菜单栏上还有状态文案）时必须用可变长占位，否则文案/角标被裁掉。
    static func needsVariableLength(_ plan: Plan, hasTitle: Bool) -> Bool {
        plan.updateGlyph != nil || hasTitle
    }

    /// 合成菜单栏图标。没有角标时退化成 template 剪影（交给系统染色）。
    static func image(base: NSImage, plan: Plan, isDark: Bool) -> NSImage {
        guard plan.updateGlyph != nil else {
            let image = base.copy() as! NSImage
            image.size = NSSize(width: 20, height: compositeHeight)
            image.isTemplate = true
            return image
        }

        let size = NSSize(width: iconSide + badgeSide - 3, height: compositeHeight)

        let image = NSImage(size: size)
        image.lockFocus()

        // 剪影画在左上（AppKit 的 lockFocus 坐标系原点在左下，所以 y 取 20 - 18）。
        let iconRect = NSRect(x: 0, y: size.height - iconSide, width: iconSide, height: iconSide)
        base.draw(in: iconRect)
        (isDark ? NSColor.white : NSColor.black).setFill()
        iconRect.fill(using: .sourceAtop)

        if let glyph = plan.updateGlyph {
            let rect = NSRect(x: size.width - badgeSide, y: size.height - badgeSide, width: badgeSide, height: badgeSide)
            let font = NSFont.systemFont(ofSize: 8, weight: .bold)
            let glyphSize = (glyph as NSString).size(withAttributes: [.font: font])
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
