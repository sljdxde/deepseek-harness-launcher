import AppKit
import Foundation

@main
struct ReleaseNotesChecks {
    static func main() {
        let base = NSFont.systemFont(ofSize: 12)

        func fontOf(_ attributed: NSAttributedString, at index: Int) -> NSFont? {
            attributed.attribute(.font, at: index, effectiveRange: nil) as? NSFont
        }

        func effectiveRange(_ attributed: NSAttributedString, at index: Int) -> NSRange {
            var range = NSRange()
            attributed.attribute(.font, at: index, longestEffectiveRange: &range, in: NSRange(location: 0, length: attributed.length))
            return range
        }

        // 真实 Release 正文形态：标题、列表、行内样式混排。
        let notes = """
        ## 更新内容

        - **新增**会话完成通知
        - 修复 `markdown` 渲染
        - 前往 [发布页](https://github.com/sljdxde/deepseek-harness-launcher) 查看详情

        ### 其他

        snake_case_name 不应斜体
        """
        let rendered = ReleaseNotesMarkdown.attributedString(from: notes, baseFont: base)
        let plain = rendered.string

        // 标题行去掉 ## 前缀。
        precondition(!plain.contains("##"))
        precondition(!plain.contains("**"))
        precondition(!plain.contains("`markdown`"))
        precondition(plain.contains("更新内容"))
        precondition(plain.contains("• 修复 markdown 渲染"))
        precondition(plain.contains("snake_case_name 不应斜体"))

        // 标题加粗、字号大于正文（semibold 不带 .bold symbolic trait，按 weight 断言）。
        let headingRange = (plain as NSString).range(of: "更新内容")
        precondition(headingRange.location != NSNotFound)
        let headingFont = fontOf(rendered, at: headingRange.location)
        let headingTraits = headingFont?.fontDescriptor.object(forKey: .traits) as? [NSFontDescriptor.TraitKey: Any]
        let headingWeight = headingTraits?[.weight] as? NSFont.Weight
        precondition(headingFont?.pointSize == 14)
        precondition(headingWeight == .semibold || headingWeight == .bold)

        // 行内加粗作用于“新增”。
        let boldRange = (plain as NSString).range(of: "新增")
        precondition(boldRange.location != NSNotFound)
        let boldFont = fontOf(rendered, at: boldRange.location)
        precondition(boldFont?.fontDescriptor.symbolicTraits.contains(.bold) == true)

        // 行内代码使用等宽字体。
        let codeRange = (plain as NSString).range(of: "markdown")
        precondition(codeRange.location != NSNotFound)
        precondition(fontOf(rendered, at: codeRange.location)?.fontName.contains("Menlo") == true ||
                     fontOf(rendered, at: codeRange.location)?.fontName.contains("Monospace") == true)

        // 链接属性挂在链接文字上。
        let linkRange = (plain as NSString).range(of: "发布页")
        precondition(linkRange.location != NSNotFound)
        let link = rendered.attribute(.link, at: linkRange.location, effectiveRange: nil) as? String
        precondition(link == "https://github.com/sljdxde/deepseek-harness-launcher")

        // 下划线词组保持字面量，不产生斜体。
        let snakeRange = (plain as NSString).range(of: "snake_case_name")
        let italicTrait = fontOf(rendered, at: snakeRange.location)?.fontDescriptor.symbolicTraits.contains(.italic)
        precondition(italicTrait != true)

        // 代码块整段等宽、保留内部换行。
        let fenced = ReleaseNotesMarkdown.attributedString(from: "正文\n```sh\nnpm ci\nnpm run build\n```\n尾部", baseFont: base)
        precondition(fenced.string.contains("npm ci\nnpm run build"))
        let npmRange = (fenced.string as NSString).range(of: "npm ci")
        precondition(fontOf(fenced, at: npmRange.location)?.fontName.contains("Menlo") == true ||
                     fontOf(fenced, at: npmRange.location)?.fontName.contains("Monospace") == true)

        // 水平分隔线渲染为分隔符而不是 --- 字面量。
        let ruled = ReleaseNotesMarkdown.attributedString(from: "上文\n\n---\n\n下文", baseFont: base)
        precondition(!ruled.string.contains("---"))
        precondition(ruled.string.contains("─"))

        // 纯文本与畸形标记原样保留（降级为可读文本）。
        let plainText = ReleaseNotesMarkdown.attributedString(from: "普通一行", baseFont: base)
        precondition(plainText.string == "普通一行\n")
        let broken = ReleaseNotesMarkdown.attributedString(from: "未闭合 ** 加粗", baseFont: base)
        precondition(broken.string == "未闭合 ** 加粗\n")

        print("release notes checks passed")
    }
}
