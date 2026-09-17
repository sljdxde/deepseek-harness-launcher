import AppKit
import Foundation

/// Renders the Markdown release notes returned by GitHub Releases into a
/// styled attributed string for the update alert. The launcher targets
/// macOS 12, where `AttributedString(markdown:)` only interprets inline
/// syntax, so block structure (headings, lists, code fences, rules) is
/// parsed line by line here and inline spans (`**bold**`, `` `code` ``,
/// links) are tokenized by hand.
enum ReleaseNotesMarkdown {
    static func attributedString(from markdown: String, baseFont: NSFont = NSFont.systemFont(ofSize: 12)) -> NSAttributedString {
        let output = NSMutableParagraphStyle()
        output.lineSpacing = 2
        output.paragraphSpacing = 5
        output.paragraphSpacingBefore = 2

        let baseAttributes: [NSAttributedString.Key: Any] = [
            .font: baseFont,
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: output
        ]
        let result = NSMutableAttributedString()
        var lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        // Trailing blank lines only inflate the alert; drop them once.
        while lines.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { lines.removeLast() }

        var index = 0
        var needsGap = false
        while index < lines.count {
            let rawLine = lines[index]
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            index += 1

            if line.isEmpty {
                needsGap = true
                continue
            }
            defer { needsGap = false }

            // Fenced code block: ``` … ``` rendered as a monospaced block.
            if line.hasPrefix("```") {
                var fence: [String] = []
                while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    fence.append(lines[index])
                    index += 1
                }
                if index < lines.count { index += 1 } // consume the closing fence
                result.append(codeBlock(fence, baseFont: baseFont, spaced: needsGap))
                needsGap = true
                continue
            }

            // Horizontal rule: --- / *** / ___
            if isHorizontalRule(line) {
                result.append(horizontalRule(spaced: needsGap))
                needsGap = true
                continue
            }

            // ATX heading: # … ######
            if let heading = headingLevel(line) {
                let text = String(line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "#")))
                let size: CGFloat = heading <= 2 ? 14 : 12.5
                let attributes = baseAttributes.merging([
                    .font: NSFont.systemFont(ofSize: size, weight: .semibold)
                ]) { _, new in new }
                result.append(renderInline(text, attributes: attributes))
                result.append(NSAttributedString(string: "\n", attributes: baseAttributes))
                continue
            }

            // List item: - / * / + bullet or "1." / "1)" ordered.
            if let marker = listMarker(line) {
                let indent = String(repeating: "  ", count: marker.indentLevel)
                let paragraph = NSMutableParagraphStyle()
                paragraph.setParagraphStyle(output)
                paragraph.headIndent = (indent as NSString).size(withAttributes: baseAttributes).width
                paragraph.firstLineHeadIndent = 0
                let attributes = baseAttributes.merging([.paragraphStyle: paragraph]) { _, new in new }
                result.append(renderInline("\(indent)\(marker.label) ", attributes: attributes))
                result.append(renderInline(marker.text, attributes: attributes))
                result.append(NSAttributedString(string: "\n", attributes: baseAttributes))
                continue
            }

            // Plain paragraph.
            result.append(renderInline(line, attributes: baseAttributes))
            result.append(NSAttributedString(string: "\n", attributes: baseAttributes))
        }
        return result
    }

    // MARK: - Blocks

    private static func isHorizontalRule(_ line: String) -> Bool {
        let characters = line.drop(while: { $0 == " " })
        guard let first = characters.first, "-*_".contains(first) else { return false }
        let body = characters.filter { $0 != " " }
        return body.count >= 3 && body.allSatisfy { "-*_".contains($0) }
    }

    private static func headingLevel(_ line: String) -> Int? {
        guard line.hasPrefix("#") else { return nil }
        let marks = line.prefix(while: { $0 == "#" }).count
        let rest = line.dropFirst(marks)
        return (1...6).contains(marks) && rest.first == " " ? marks : nil
    }

    private struct ListMarker {
        let label: String
        let text: String
        let indentLevel: Int
    }

    private static func listMarker(_ line: String) -> ListMarker? {
        let indentWidth = line.prefix(while: { $0 == " " }).count
        let body = line.drop(while: { $0 == " " })
        // Bullet items.
        if let first = body.first, "-*+".contains(first) {
            let rest = body.dropFirst().drop(while: { $0 == " " })
            guard !rest.isEmpty else { return nil }
            return ListMarker(label: "•", text: String(rest), indentLevel: min(indentWidth / 2, 4))
        }
        // Ordered items: "1." / "1)".
        let digits = body.prefix(while: \.isNumber)
        if let stop = body.dropFirst(digits.count).first, digits.count <= 3, ".)".contains(stop) {
            let rest = body.dropFirst(digits.count + 1).drop(while: { $0 == " " })
            guard !rest.isEmpty else { return nil }
            return ListMarker(label: "\(digits).", text: String(rest), indentLevel: min(indentWidth / 2, 4))
        }
        return nil
    }

    private static func codeBlock(_ fence: [String], baseFont: NSFont, spaced: Bool) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 1
        paragraph.paragraphSpacing = 5
        paragraph.paragraphSpacingBefore = spaced ? 5 : 2
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: baseFont.pointSize - 0.5, weight: .regular),
            .foregroundColor: NSColor.secondaryLabelColor,
            .paragraphStyle: paragraph
        ]
        let text = fence.isEmpty ? " " : fence.joined(separator: "\n")
        return NSAttributedString(string: text + "\n", attributes: attributes)
    }

    private static func horizontalRule(spaced: Bool) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.paragraphSpacing = 5
        paragraph.paragraphSpacingBefore = spaced ? 5 : 2
        return NSAttributedString(
            string: "────────────────────────────\n",
            attributes: [
                .font: NSFont.systemFont(ofSize: 8),
                .foregroundColor: NSColor.tertiaryLabelColor,
                .paragraphStyle: paragraph
            ]
        )
    }

    // MARK: - Inline spans

    /// Tokenizes one line of inline Markdown (bold, italic, code, links) into
    /// an attributed string. Anything unrecognized is kept as literal text so
    /// malformed notes degrade to readable plain text.
    private static func renderInline(_ text: String, attributes: [NSAttributedString.Key: Any]) -> NSAttributedString {
        let result = NSMutableAttributedString()
        var plain = ""
        var index = text.startIndex

        func flushPlain() {
            guard !plain.isEmpty else { return }
            result.append(NSAttributedString(string: plain, attributes: attributes))
            plain = ""
        }

        let boldFont = boldVariant(of: attributes)
        let italicFont = italicVariant(of: attributes)

        while index < text.endIndex {
            let character = text[index]

            if character == "`" {
                if let closing = text[text.index(after: index)...].firstIndex(of: "`") {
                    flushPlain()
                    let code = String(text[text.index(after: index)..<closing])
                    result.append(NSAttributedString(string: code, attributes: codeAttributes(from: attributes)))
                    index = text.index(after: closing)
                    continue
                }
            }

            if character == "*" || character == "_" {
                let double = text[index...].hasPrefix(String(repeating: character, count: 2))
                let needle = double ? String(repeating: character, count: 2) : String(character)
                if let range = text[text.index(after: index)...].range(of: needle) {
                    let inner = String(text[text.index(index, offsetBy: needle.count)..<range.lowerBound])
                    // `_` inside a word (snake_case) must stay literal: single
                    // underscores only emphasize around a phrase-like span.
                    let looksIntraword = character == "_" && !double && !inner.contains(" ")
                    guard !inner.isEmpty, !inner.contains("\n"), !looksIntraword else {
                        plain.append(character)
                        index = text.index(after: index)
                        continue
                    }
                    flushPlain()
                    var innerAttributes = attributes
                    if double, let base = attributes[.font] as? NSFont {
                        innerAttributes[.font] = boldFont ?? NSFont.systemFont(ofSize: base.pointSize, weight: .bold)
                    } else if let base = attributes[.font] as? NSFont {
                        innerAttributes[.font] = italicFont ?? NSFont.systemFont(ofSize: base.pointSize).italic()
                    }
                    // Nested `code` inside bold still renders monospaced.
                    result.append(renderInline(inner, attributes: innerAttributes))
                    index = range.upperBound
                    continue
                }
                plain.append(character)
                index = text.index(after: index)
                continue
            }

            if character == "[", let closing = text[index...].firstIndex(of: "]") {
                let label = String(text[text.index(after: index)..<closing])
                let afterBracket = text.index(after: closing)
                if afterBracket < text.endIndex, text[afterBracket] == "(",
                   let end = text[afterBracket...].firstIndex(of: ")") {
                    let target = String(text[text.index(after: afterBracket)..<end])
                    flushPlain()
                    var linkAttributes = attributes
                    linkAttributes[.link] = target.hasPrefix("http") || target.hasPrefix("https") ? target : nil
                    linkAttributes[.foregroundColor] = NSColor.linkColor
                    result.append(NSAttributedString(string: label, attributes: linkAttributes))
                    index = text.index(after: end)
                    continue
                }
            }

            plain.append(character)
            index = text.index(after: index)
        }
        flushPlain()
        return result
    }

    private static func codeAttributes(from attributes: [NSAttributedString.Key: Any]) -> [NSAttributedString.Key: Any] {
        var code = attributes
        if let base = attributes[.font] as? NSFont {
            code[.font] = NSFont.monospacedSystemFont(ofSize: base.pointSize - 0.5, weight: .regular)
        }
        code[.foregroundColor] = NSColor.secondaryLabelColor
        return code
    }

    private static func boldVariant(of attributes: [NSAttributedString.Key: Any]) -> NSFont? {
        guard let base = attributes[.font] as? NSFont else { return nil }
        return base.isBold ? base : NSFont.systemFont(ofSize: base.pointSize, weight: .bold)
    }

    private static func italicVariant(of attributes: [NSAttributedString.Key: Any]) -> NSFont? {
        guard let base = attributes[.font] as? NSFont else { return nil }
        return NSFont.systemFont(ofSize: base.pointSize).italic()
    }
}

private extension NSFont {
    func italic() -> NSFont {
        let descriptor = fontDescriptor.withSymbolicTraits(fontDescriptor.symbolicTraits.union(.italic))
        return NSFont(descriptor: descriptor, size: pointSize) ?? self
    }

    var isBold: Bool {
        fontDescriptor.symbolicTraits.contains(.bold)
    }
}
