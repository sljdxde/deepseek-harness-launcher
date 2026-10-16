import AppKit
import Foundation

/// 菜单栏角标的本地单测：角标是**画**出来的，符号/坐标写错不会崩，只会画歪、
/// 画重叠或干脆看不见，字符串断言抓不到。所以这里离屏合成每一状态再逐点验像素。
///
/// 合成用的底图是测试自造的实心方块（真实剪影是异形图，采样点会落到透明处），
/// 这样「剪影按菜单栏明暗染白/染黑」也能直接断言。
///
/// 需要肉眼看图时加 `STATUS_BADGE_PREVIEW=<path>` 跑一次，会把四种状态在深/浅
/// 两种菜单栏背景下的合成结果拼成一张放大预览图（默认不落盘，保持测试纯净）。
@main
struct StatusBadgeChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func main() {
        _ = NSApplication.shared
        checkPlan()
        checkPlainIcon()
        checkTint()
        checkUnreadOnly()
        checkUpdateOnly()
        checkBoth()
        writePreviewIfRequested()
        if !failures.isEmpty {
            for failure in failures { print("status badge checks failed: \(failure)") }
            exit(1)
        }
        print("status badge checks passed")
    }

    // MARK: - 状态推导

    static func checkPlan() {
        let none = StatusBadgeSupport.plan(unreadText: nil, updateAvailable: false)
        check(none == StatusBadgeSupport.Plan(unreadText: nil, updateGlyph: nil), "没有任何状态时不该画角标")

        let unread = StatusBadgeSupport.plan(unreadText: "3", updateAvailable: false)
        check(unread == StatusBadgeSupport.Plan(unreadText: "3", updateGlyph: nil), "只有未读时只画数字胶囊")

        let update = StatusBadgeSupport.plan(unreadText: nil, updateAvailable: true)
        check(update == StatusBadgeSupport.Plan(unreadText: nil, updateGlyph: "↑"), "只有更新时只画更新箭头")

        let both = StatusBadgeSupport.plan(unreadText: "12", updateAvailable: true)
        check(both == StatusBadgeSupport.Plan(unreadText: "12", updateGlyph: "↑"), "两者都有时两枚角标都要画")

        // 占位：没角标、没状态文案时退回方形（否则菜单栏会白白变宽）。
        check(!StatusBadgeSupport.needsVariableLength(none, hasTitle: false), "无角标无文案时应保持方形占位")
        check(StatusBadgeSupport.needsVariableLength(none, hasTitle: true), "有状态文案时必须可变长")
        check(StatusBadgeSupport.needsVariableLength(unread, hasTitle: false), "有未读角标时必须可变长")
        check(StatusBadgeSupport.needsVariableLength(update, hasTitle: false), "有更新角标时必须可变长")
    }

    // MARK: - 合成

    static func checkPlainIcon() {
        let image = StatusBadgeSupport.image(base: solidBase(), plan: plan(nil, false), isDark: true)
        check(image.isTemplate, "没有角标时必须保持 template，交给系统染菜单栏明暗")
        check(abs(image.size.width - 20) < 0.01 && abs(image.size.height - 20) < 0.01,
              "无角标合成图应是 20×20，实际 \(image.size)")
    }

    static func checkTint() {
        for isDark in [true, false] {
            let image = StatusBadgeSupport.image(base: solidBase(), plan: plan(nil, true), isDark: isDark)
            check(!image.isTemplate, "有角标时不能再走 template（局部上色会失效）")
            // 剪影内部一点（图标占 y ∈ [2, 20)）必须是菜单栏明暗对应的那一种颜色。
            guard let color = pixel(image, x: 1, y: 10)?.usingColorSpace(.deviceRGB) else {
                failures.append("取不到剪影像素（isDark=\(isDark)）")
                continue
            }
            let expected: CGFloat = isDark ? 1 : 0
            check(abs(color.redComponent - expected) < 0.08
                    && abs(color.greenComponent - expected) < 0.08
                    && abs(color.blueComponent - expected) < 0.08,
                  "\(isDark ? "深" : "浅")色菜单栏下剪影应染成\(isDark ? "白" : "黑")，实际 \(color)")
        }
    }

    static func checkUnreadOnly() {
        let image = StatusBadgeSupport.image(base: solidBase(), plan: plan("3", false), isDark: true)
        let pill = NSRect(x: image.size.width - StatusBadgeSupport.badgeSide, y: 0,
                          width: StatusBadgeSupport.badgeSide, height: StatusBadgeSupport.badgeSide)
        let pillStats = stats(image, rect: pill)
        check(pillStats.redish >= 20, "未读胶囊底色应是红色，实际红色像素 \(pillStats.redish)")
        check(pillStats.whitish > 0, "未读胶囊里应画出数字")
        check(pillStats.blueish == 0, "只有未读时不该出现更新角标的蓝色")

        // 更新角标的位置（右上）必须是空的：否则「没更新」时也亮着蓝点。
        let disk = NSRect(x: image.size.width - StatusBadgeSupport.badgeSide,
                          y: StatusBadgeSupport.compositeHeight - StatusBadgeSupport.badgeSide,
                          width: StatusBadgeSupport.badgeSide, height: StatusBadgeSupport.badgeSide)
        check(stats(image, rect: disk).blueish == 0, "没有可用更新时右上角不该有蓝色圆盘")
    }

    static func checkUpdateOnly() {
        let image = StatusBadgeSupport.image(base: solidBase(), plan: plan(nil, true), isDark: true)
        check(!image.isTemplate, "有更新角标时必须是合成图")
        let disk = NSRect(x: image.size.width - StatusBadgeSupport.badgeSide,
                          y: StatusBadgeSupport.compositeHeight - StatusBadgeSupport.badgeSide,
                          width: StatusBadgeSupport.badgeSide, height: StatusBadgeSupport.badgeSide)
        let diskStats = stats(image, rect: disk)
        check(diskStats.blueish >= 20, "更新圆盘底色应是蓝色，实际蓝色像素 \(diskStats.blueish)")
        check(diskStats.whitish > 0, "更新圆盘里应画出向上箭头")
        check(diskStats.redish == 0, "没有未读时不该出现未读胶囊的红色")

        // 圆盘画在右上：左下（未读胶囊位置）必须空着。
        let pill = NSRect(x: image.size.width - StatusBadgeSupport.badgeSide, y: 0,
                          width: StatusBadgeSupport.badgeSide, height: StatusBadgeSupport.badgeSide)
        check(stats(image, rect: pill).redish == 0, "没有未读时左下角不该有红色胶囊")
    }

    static func checkBoth() {
        let image = StatusBadgeSupport.image(base: solidBase(), plan: plan("12", true), isDark: true)
        let side = StatusBadgeSupport.badgeSide
        let pill = NSRect(x: image.size.width - side, y: 0, width: side, height: side)
        let disk = NSRect(x: image.size.width - side, y: StatusBadgeSupport.compositeHeight - side,
                          width: side, height: side)
        let pillStats = stats(image, rect: pill)
        let diskStats = stats(image, rect: disk)
        check(pillStats.redish >= 15, "两者都有时未读胶囊仍要画出来，实际红色像素 \(pillStats.redish)")
        check(diskStats.blueish >= 15, "两者都有时更新圆盘仍要画出来，实际蓝色像素 \(diskStats.blueish)")

        // 两枚角标上下排开、不许压在一起：胶囊最上面一行仍是红的，圆盘最下面
        // 一行是蓝的。若圆盘被画到胶囊上面（或反之），整行会被另一种颜色盖掉。
        let pillTopRow = NSRect(x: pill.minX, y: side - 1, width: side, height: 1)
        let diskBottomRow = NSRect(x: disk.minX, y: side, width: side, height: 1)
        let topRowStats = stats(image, rect: pillTopRow)
        let bottomRowStats = stats(image, rect: diskBottomRow)
        check(topRowStats.redish >= 4,
              "胶囊最上面一行应是红色，实际红色像素 \(topRowStats.redish)（两枚角标重叠了？）")
        check(bottomRowStats.blueish >= 4,
              "圆盘最下面一行应是蓝色，实际蓝色像素 \(bottomRowStats.blueish)（两枚角标重叠了？）")

        // 宽度要有上限：角标再宽也不该把菜单栏撑成一长条。
        check(image.size.width <= 36, "合成图过宽：\(image.size.width)")
        check(abs(image.size.height - StatusBadgeSupport.compositeHeight) < 0.01,
              "两枚角标同时出现时高度不该变：\(image.size.height)")
    }

    // MARK: - helpers

    static func plan(_ unreadText: String?, _ updateAvailable: Bool) -> StatusBadgeSupport.Plan {
        StatusBadgeSupport.plan(unreadText: unreadText, updateAvailable: updateAvailable)
    }

    /// 测试专用底图：18×18 实心黑块，剪影区每个像素都能被断言到。
    static func solidBase() -> NSImage {
        let image = NSImage(size: NSSize(width: StatusBadgeSupport.iconSide, height: StatusBadgeSupport.iconSide))
        image.lockFocus()
        NSColor.black.setFill()
        NSRect(x: 0, y: 0, width: StatusBadgeSupport.iconSide, height: StatusBadgeSupport.iconSide).fill()
        image.unlockFocus()
        return image
    }

    static func bitmap(_ image: NSImage) -> NSBitmapImageRep? {
        guard let tiff = image.tiffRepresentation else { return nil }
        return NSBitmapImageRep(data: tiff)
    }

    /// NSBitmapImageRep.colorAt 的原点在左上、且按屏幕倍率放大（Retina 上 1 pt = 2 px），
    /// 而 lockFocus 绘制坐标系原点在左下：这里按倍率换算并把 y 翻过来。
    static func pixel(_ image: NSImage, x: Int, y: Int) -> NSColor? {
        guard let rep = bitmap(image), image.size.width > 0 else { return nil }
        let scale = CGFloat(rep.pixelsWide) / image.size.width
        let px = Int(CGFloat(x) * scale)
        let py = rep.pixelsHigh - 1 - Int(CGFloat(y) * scale)
        guard px >= 0, py >= 0, px < rep.pixelsWide, py < rep.pixelsHigh else { return nil }
        return rep.colorAt(x: px, y: py)?.usingColorSpace(.deviceRGB)
    }

    static func isReddish(_ color: NSColor?) -> Bool {
        guard let color else { return false }
        return color.redComponent > 0.6 && color.greenComponent < 0.5 && color.blueComponent < 0.5
    }

    static func isBlueish(_ color: NSColor?) -> Bool {
        guard let color else { return false }
        return color.blueComponent > 0.6 && color.redComponent < 0.5
    }

    struct RegionStats {
        var redish = 0
        var blueish = 0
        var whitish = 0
        var other = 0
    }

    static func stats(_ image: NSImage, rect: NSRect) -> RegionStats {
        var result = RegionStats()
        let x0 = Int(rect.minX.rounded(.down)), x1 = Int(rect.maxX.rounded(.up))
        let y0 = Int(rect.minY.rounded(.down)), y1 = Int(rect.maxY.rounded(.up))
        for x in x0..<x1 {
            for y in y0..<y1 {
                guard let color = pixel(image, x: x, y: y) else { continue }
                if isReddish(color) { result.redish += 1 }
                else if isBlueish(color) { result.blueish += 1 }
                else if color.alphaComponent > 0.5, color.redComponent > 0.75, color.greenComponent > 0.75, color.blueComponent > 0.75 {
                    result.whitish += 1
                } else { result.other += 1 }
            }
        }
        return result
    }

    /// 肉眼验收用：`STATUS_BADGE_PREVIEW=/tmp/badge.png ./build/test-status-badge`。
    static func writePreviewIfRequested() {
        guard let path = ProcessInfo.processInfo.environment["STATUS_BADGE_PREVIEW"], !path.isEmpty else { return }
        let states: [(String, StatusBadgeSupport.Plan)] = [
            ("none", plan(nil, false)),
            ("unread", plan("3", false)),
            ("update", plan(nil, true)),
            ("both", plan("12", true))
        ]
        let scale: CGFloat = 6
        let cell = NSSize(width: 40, height: 24)
        let canvas = NSImage(size: NSSize(width: cell.width * CGFloat(states.count) * scale,
                                          height: cell.height * 2 * scale))
        canvas.lockFocus()
        for (row, background) in [NSColor(white: 0.15, alpha: 1), NSColor(white: 0.95, alpha: 1)].enumerated() {
            for (column, state) in states.enumerated() {
                let origin = NSPoint(x: CGFloat(column) * cell.width * scale,
                                     y: CGFloat(1 - row) * cell.height * scale)
                background.setFill()
                NSRect(origin: origin, size: NSSize(width: cell.width * scale, height: cell.height * scale)).fill()
                let badge = StatusBadgeSupport.image(base: solidBase(), plan: state.1, isDark: row == 0)
                NSGraphicsContext.current?.imageInterpolation = .none
                badge.draw(in: NSRect(x: origin.x + 4 * scale, y: origin.y + 4 * scale,
                                      width: badge.size.width * scale, height: badge.size.height * scale))
            }
        }
        canvas.unlockFocus()
        guard let rep = bitmap(canvas), let png = rep.representation(using: .png, properties: [:]) else {
            failures.append("预览图写不出来")
            return
        }
        do {
            try png.write(to: URL(fileURLWithPath: path))
            print("status badge preview: \(path)")
        } catch {
            failures.append("预览图写入失败：\(error.localizedDescription)")
        }
    }
}
