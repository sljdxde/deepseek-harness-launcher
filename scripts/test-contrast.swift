import AppKit

/// 界面文字对比度回归。
///
/// 起因：夜间模式下设置窗口的勾选框标签几乎看不见——放大截图量出标签是
/// #070808、卡片是 #1D1E1E，对比度 1.20:1，用户只能看到几个白色勾。
/// 同类问题还出现在所有用 `tertiaryLabelColor` 的小字上（深色 2.26:1、
/// 浅色 1.88:1，都低于 WCAG AA 的 4.5:1）。
///
/// 这里把「哪些语义色能用来写正文」变成可执行的判据，而不是靠肉眼验收：
///   1. 解析系统语义色在深色/浅色下的实际像素值，算 WCAG 对比度；
///   2. 断言正文/次要文字达到 AA（4.5:1），禁用态不低于 3:1；
///   3. 反例守卫：源码里不许再出现 tertiaryLabelColor 作为文字颜色。
///
/// 编译：swiftc scripts/test-contrast.swift -o build/test-contrast -framework AppKit

@main
struct ContrastChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    // MARK: - WCAG 2.1 相对亮度与对比度

    static func linear(_ channel: CGFloat) -> Double {
        let c = Double(channel)
        return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }

    static func luminance(_ color: NSColor) -> Double {
        guard let srgb = color.usingColorSpace(.sRGB) else { return 0 }
        return 0.2126 * linear(srgb.redComponent)
            + 0.7152 * linear(srgb.greenComponent)
            + 0.0722 * linear(srgb.blueComponent)
    }

    /// 前景（可能带透明度）叠在背景上的实际颜色，再算对比度。
    /// 系统语义色常带 alpha，直接比会算错。
    static func contrast(_ foreground: NSColor, on background: NSColor) -> Double {
        guard let fg = foreground.usingColorSpace(.sRGB),
              let bg = background.usingColorSpace(.sRGB) else { return 0 }
        let alpha = fg.alphaComponent
        let composed = NSColor(
            srgbRed: fg.redComponent * alpha + bg.redComponent * (1 - alpha),
            green: fg.greenComponent * alpha + bg.greenComponent * (1 - alpha),
            blue: fg.blueComponent * alpha + bg.blueComponent * (1 - alpha),
            alpha: 1
        )
        let a = luminance(composed), b = luminance(bg)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    /// 设置窗口卡片底色 = controlBackgroundColor 以 0.78 叠在 windowBackgroundColor 上。
    static func cardBackground() -> NSColor {
        let base = NSColor.windowBackgroundColor
        let card = NSColor.controlBackgroundColor
        guard let c = card.usingColorSpace(.sRGB), let b = base.usingColorSpace(.sRGB) else { return base }
        let alpha: CGFloat = 0.78
        return NSColor(
            srgbRed: c.redComponent * alpha + b.redComponent * (1 - alpha),
            green: c.greenComponent * alpha + b.greenComponent * (1 - alpha),
            blue: c.blueComponent * alpha + b.blueComponent * (1 - alpha),
            alpha: 1
        )
    }

    static let aaNormal: Double = 4.5
    /// 次要文字（层级用）的下限。系统 secondaryLabelColor 在浅色下只有 3.95:1，
    /// 达不到 AA 的 4.5 —— 这是 Apple 自己定的层级灰。允许它存在的前提是：
    /// 它只用来表达「这是次要信息」，绝不承载必须读到的内容（提示、版本号、
    /// 失败原因一律用正文色，由下面的源码守卫锁死）。
    static let aaSecondary: Double = 3.5
    /// 非文本 / 大字 / 禁用态的最低要求。
    static let aaNonText: Double = 3.0

    static func main() {
        let appearances: [(String, NSAppearance)] = [
            ("深色", NSAppearance(named: .darkAqua)!),
            ("浅色", NSAppearance(named: .aqua)!)
        ]

        for (name, appearance) in appearances {
            appearance.performAsCurrentDrawingAppearance {
                let card = cardBackground()

                // MARK: - 1. 正文与次要文字必须过 AA
                let label = contrast(.labelColor, on: card)
                check(label >= aaNormal, "\(name)：labelColor 对比度 \(String(format: "%.2f", label)):1 低于 AA")

                let secondary = contrast(.secondaryLabelColor, on: card)
                check(
                    secondary >= aaSecondary,
                    "\(name)：secondaryLabelColor 对比度 \(String(format: "%.2f", secondary)):1 低于 \(aaSecondary):1，"
                        + "连「次要信息」都读不出来"
                )

                // MARK: - 2. 三级色只能当装饰，不能写正文
                // 记录它的实测值：断言的是「确实不达标」，防止有人把它改回文字颜色
                // 却以为没问题。
                let tertiary = contrast(.tertiaryLabelColor, on: card)
                check(
                    tertiary < aaNormal,
                    "\(name)：tertiaryLabelColor 对比度 \(String(format: "%.2f", tertiary)):1 竟然达到 AA，"
                        + "请复核本测试的前提（系统色值变了）"
                )

                // MARK: - 3. 强调色 / 链接色要能当可点文字
                let accent = contrast(.controlAccentColor, on: card)
                check(
                    accent >= aaNonText,
                    "\(name)：controlAccentColor 对比度 \(String(format: "%.2f", accent)):1 低于 3:1，"
                        + "开关字形会看不清"
                )
                let link = contrast(.linkColor, on: card)
                check(
                    link >= aaNormal,
                    "\(name)：linkColor 对比度 \(String(format: "%.2f", link)):1 低于 AA，「立即检查」读不出来"
                )

                // MARK: - 4. 勾选框标签的两种真实形态
                // 历史 bug：标签在深色窗口里被解析成近黑（#070808 on #1D1E1E = 1.2:1），
                // 用户只看到几个白勾。修法是显式写 labelColor —— 这里断言「标签色」
                // 与「开关字形色」各自都能看清。
                let switchGlyph = contrast(.controlAccentColor, on: card)
                check(
                    switchGlyph >= aaNonText,
                    "\(name)：开关字形对比度 \(String(format: "%.2f", switchGlyph)):1 低于 3:1"
                )
                if name == "深色" {
                    // 深色卡片上，近黑文字是最典型的失败形态；white 必须明显更亮。
                    let white = contrast(.white, on: card)
                    check(
                        white >= aaNormal,
                        "深色：白色文字对比度 \(String(format: "%.2f", white)):1 低于 AA"
                    )
                }
            }
        }

        // MARK: - 5. 关键文案必须用正文色
        // 阈值只能证明「某个色号够亮」，证明不了「那行关键文字用了它」。
        // 这里直接按语义锁：必须被读到的文案，颜色参数只能是 labelColor。
        let required = [
            ("SettingsWindowController.swift", "后台检查常开：发现新版本只在菜单栏提示"),
            ("SettingsWindowController.swift", "当前版本 v\\(version)")
        ]
        let sourcesDir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources")
        for (file, needle) in required {
            let path = sourcesDir.appendingPathComponent(file)
            let text = (try? String(contentsOf: path, encoding: .utf8)) ?? ""
            guard let line = text.components(separatedBy: .newlines).first(where: { $0.contains(needle) }) else {
                failures.append("\(file)：找不到应受保护的关键文案「\(needle)」")
                continue
            }
            if !line.contains("color: .labelColor") {
                failures.append("\(file)：关键文案必须用 labelColor（当前：\(line.trimmingCharacters(in: .whitespaces)))")
            }
        }

        // MARK: - 6. 反例守卫：源码里不许再用三级色写文字
        // 说明：本项在 test.sh 里另有一条 rg 守卫，这里做同样的判断便于单独跑。
        let sources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources")
        let files = (try? FileManager.default.contentsOfDirectory(atPath: sources.path)) ?? []
        for file in files where file.hasSuffix(".swift") {
            guard let text = try? String(contentsOf: sources.appendingPathComponent(file), encoding: .utf8) else { continue }
            for (index, line) in text.components(separatedBy: .newlines).enumerated() {
                // 注释里提到这个词是正常的（就是在解释为什么不用它）。
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard !trimmed.hasPrefix("//"), !trimmed.hasPrefix("///") else { continue }
                if line.contains("tertiaryLabelColor") {
                    failures.append(
                        "\(file):\(index + 1) 仍用 tertiaryLabelColor 作为文字颜色"
                            + "（深色 2.3:1 / 浅色 1.9:1，读不出来）：\(trimmed)"
                    )
                }
            }
        }

        // MARK: - 7. 动态颜色不许用 .cgColor 冻结
        // layer.backgroundColor = 语义色.cgColor 会在赋值那一刻解析成固定 RGBA：
        // 浅色下创建的窗口切到夜间后仍是浅色底（实测纯白卡片配白字）。
        // 设置窗口的卡片用 DynamicLayerView，AlertDesign 的卡片在外观回调里重设。
        let frozenPattern = try! NSRegularExpression(
            pattern: #"layer\??\.(backgroundColor|borderColor)\s*=\s*[^\n]*\.cgColor"#
        )
        for file in files where file.hasSuffix(".swift") {
            let path = sourcesDir.appendingPathComponent(file)
            guard let text = try? String(contentsOf: path, encoding: .utf8) else { continue }
            for (index, line) in text.components(separatedBy: .newlines).enumerated() {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard !trimmed.hasPrefix("//"), !trimmed.hasPrefix("///") else { continue }
                let range = NSRange(line.startIndex..., in: line)
                guard frozenPattern.firstMatch(in: line, range: range) != nil else { continue }
                // 在 performAsCurrentDrawingAppearance 里赋值是允许的（会随外观重跑）。
                let context = text.components(separatedBy: .newlines)
                    .prefix(index + 1).suffix(6).joined(separator: "\n")
                if context.contains("performAsCurrentDrawingAppearance") { continue }
                failures.append(
                    "\(file):\(index + 1) 直接用 .cgColor 赋值图层颜色会把动态色冻结成当前外观：\(trimmed)"
                )
            }
        }

        if failures.isEmpty {
            print("contrast checks passed")
            return
        }
        for failure in failures { print("✗ \(failure)") }
        exit(1)
    }
}
