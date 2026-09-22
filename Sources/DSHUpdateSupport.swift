import Foundation

// MARK: - 结果模型

enum DSHUpdateCheckResult {
    case checked(DSHUpdateReport)
    case failed(String)
}

enum DSHVersionParser {
    static func version(from output: String) -> String? {
        let pattern = #"\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(output.startIndex..., in: output)
        guard let match = regex.firstMatch(in: output, range: range),
              let swiftRange = Range(match.range, in: output) else { return nil }
        return String(output[swiftRange])
    }
}

/// 发布通道。dsh 用 npm 语义的预发布后缀（rc/beta/alpha/dev），菜单和弹窗都必须
/// 标出来：否则用户会把内测版当成正式版升级，而这正是「检查更新」最容易误导人的地方。
enum DSHReleaseChannel: Equatable {
    case stable
    case releaseCandidate
    case beta
    case alpha
    case development
    case other(String)

    static func detect(from version: String) -> DSHReleaseChannel {
        let value = normalizedDSHVersion(version)
        guard let dash = value.firstIndex(of: "-") else { return .stable }
        let prerelease = value[value.index(after: dash)...]
        guard let head = prerelease.split(whereSeparator: { $0 == "." || $0 == "-" }).first else { return .stable }
        switch head.lowercased() {
        case "rc": return .releaseCandidate
        case "beta": return .beta
        case "alpha": return .alpha
        case "dev", "snapshot": return .development
        case let other: return .other(other)
        }
    }

    var label: String {
        switch self {
        case .stable: return "正式版"
        case .releaseCandidate: return "候选版"
        case .beta: return "公测版"
        case .alpha: return "内测版"
        case .development: return "开发版"
        case .other(let value): return "\(value) 版"
        }
    }

    var isPrerelease: Bool { self != .stable }
}

/// 候选版本是从哪儿发现的：GitHub Release、npm 的某个 dist-tag，或只有 npm 版本列表。
enum DSHUpdateSource: Equatable {
    case githubRelease
    case npmTag(String)
    case npmRegistry

    var label: String {
        switch self {
        case .githubRelease: return "GitHub Release"
        case .npmTag(let tag): return "npm \(tag) 标签"
        case .npmRegistry: return "npm 版本列表"
        }
    }
}

struct DSHUpdateCandidate: Equatable {
    let version: String
    let source: DSHUpdateSource
    let channel: DSHReleaseChannel
    let publishedAt: Date?
    let notes: String?

    init(version: String, source: DSHUpdateSource, publishedAt: Date? = nil, notes: String? = nil) {
        self.version = normalizedDSHVersion(version)
        self.source = source
        self.channel = DSHReleaseChannel.detect(from: self.version)
        self.publishedAt = publishedAt
        self.notes = notes
    }
}

/// 一次检查的完整结果：菜单、弹窗、日志都从这里取数，避免各处自己再算一遍。
struct DSHUpdateReport: Equatable {
    let current: String
    /// 已发布的最新版本（可能等于、甚至旧于当前安装的版本）。
    let best: DSHUpdateCandidate
    /// 最新正式版，用于给「最新的是预发布版」补一条提示。
    let newestStable: DSHUpdateCandidate?
    let candidates: [DSHUpdateCandidate]
    let npmMetadataAvailable: Bool
    /// 写进日志的查询摘要。
    let messages: [String]
    /// 部分来源失败或候选被丢弃的原因。
    let warnings: [String]

    var isUpdate: Bool { compareDSHVersions(best.version, current) == .orderedDescending }
}

// MARK: - 版本比较

/// `dsh` 的版本号是标准 npm 语义（`0.1.7-alpha.1`、`0.1.5-rc.3`）。启动器自身用的
/// `compareVersions` 面向 `x.y.z-a.b[-SNAPSHOT]`，会把 `alpha.1` 与 `alpha.2` 当成
/// 同一个版本，因此 dsh 的更新判断必须另用一套：先比基础版本，再按 semver 比较预
/// 发布标识——数字段按数值、数字段低于字母段、字母段按字典序，前缀相同则标识更多
/// 的一方更高；同 base 下预发布版本低于正式版。
func compareDSHVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
    let left = parseDSHVersion(lhs)
    let right = parseDSHVersion(rhs)

    for index in 0..<max(left.base.count, right.base.count) {
        let l = index < left.base.count ? left.base[index] : 0
        let r = index < right.base.count ? right.base[index] : 0
        if l < r { return .orderedAscending }
        if l > r { return .orderedDescending }
    }
    switch (left.prerelease, right.prerelease) {
    case (nil, nil):
        return .orderedSame
    case (nil, .some):
        return .orderedDescending
    case (.some, nil):
        return .orderedAscending
    case (.some(let l), .some(let r)):
        for index in 0..<max(l.count, r.count) {
            if index >= l.count { return .orderedAscending }
            if index >= r.count { return .orderedDescending }
            switch (l[index], r[index]) {
            case (.number(let a), .number(let b)):
                if a != b { return a < b ? .orderedAscending : .orderedDescending }
            case (.text(let a), .text(let b)):
                if a != b { return a < b ? .orderedAscending : .orderedDescending }
            case (.number, .text):
                return .orderedAscending
            case (.text, .number):
                return .orderedDescending
            }
        }
        return .orderedSame
    }
}

/// GitHub 的 Release tag 形如 `dsh-v0.1.7-alpha.1`，npm 上是 `0.1.7-alpha.1`。
func normalizedDSHVersion(_ raw: String) -> String {
    var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    for prefix in ["dsh-v", "dsh-"] where value.hasPrefix(prefix) {
        value.removeFirst(prefix.count)
        return value
    }
    if value.hasPrefix("v"), value.dropFirst().first?.isNumber == true {
        value.removeFirst()
    }
    return value
}

private enum DSHPrereleaseIdentifier: Equatable {
    case number(Int)
    case text(String)
}

private struct ParsedDSHVersion {
    var base: [Int]
    var prerelease: [DSHPrereleaseIdentifier]?
}

private func parseDSHVersion(_ raw: String) -> ParsedDSHVersion {
    let value = normalizedDSHVersion(raw)
    // 构建元数据（`+build`）不参与比较。
    let withoutBuild = value.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? value
    let parts = withoutBuild.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    let base = String(parts.first ?? "").split(separator: ".").map { Int($0) ?? 0 }
    let prerelease = parts.count > 1
        ? String(parts[1]).split(separator: ".").map { token -> DSHPrereleaseIdentifier in
            if let number = Int(token) { return .number(number) }
            return .text(String(token).lowercased())
        }
        : nil
    return ParsedDSHVersion(
        base: base.isEmpty ? [0] : base,
        prerelease: (prerelease?.isEmpty ?? true) ? nil : prerelease
    )
}

// MARK: - npm 元数据

/// `npm view @deepseek-ai/dsh dist-tags versions --json` 的输出。
struct DSHNpmMetadata: Equatable {
    var distTags: [String: String] = [:]
    var versions: [String] = []

    static func decode(_ data: Data) -> DSHNpmMetadata? {
        // npm 会往 stdout 之外写告警（本机有代理时 Node 会打印 UNDICI-EHPA），
        // 调用方已经把 stderr 分开了；这里再丢掉 JSON 之前的杂音，双保险。
        let payload = data.drop { byte in
            byte != UInt8(ascii: "{") && byte != UInt8(ascii: "\"") && byte != UInt8(ascii: "[")
        }
        guard !payload.isEmpty,
              let object = try? JSONSerialization.jsonObject(with: Data(payload), options: [.fragmentsAllowed]) else { return nil }
        var metadata = DSHNpmMetadata()
        if let dictionary = object as? [String: Any] {
            if let tags = dictionary["dist-tags"] as? [String: String] {
                metadata.distTags = tags
            } else if let tags = dictionary["dist-tags"] as? [String: Any] {
                metadata.distTags = tags.compactMapValues { $0 as? String }
            }
            if let versions = dictionary["versions"] as? [String] {
                metadata.versions = versions
            }
        } else if let single = object as? String, !single.isEmpty {
            // `npm view <pkg> version --json` 的兜底：只有一个字符串。
            metadata.distTags = ["latest": single]
            metadata.versions = [single]
        }
        return metadata.distTags.isEmpty && metadata.versions.isEmpty ? nil : metadata
    }

    func contains(version: String) -> Bool {
        versions.contains { $0.caseInsensitiveCompare(version) == .orderedSame }
    }

    var summary: String {
        guard !distTags.isEmpty else { return "npm 无 dist-tag" }
        let order = ["latest", "next", "beta", "alpha"]
        let sorted = distTags.keys.sorted { lhs, rhs in
            let l = order.firstIndex(of: lhs) ?? order.count
            let r = order.firstIndex(of: rhs) ?? order.count
            return l == r ? lhs < rhs : l < r
        }
        return "npm dist-tags：" + sorted.map { "\($0) \(distTags[$0] ?? "")" }.joined(separator: " / ")
    }
}

// MARK: - GitHub Release feed

struct DSHReleaseEntry: Equatable {
    let version: String
    let tag: String
    let publishedAt: Date?
    let notes: String?
    let htmlURL: String?
}

/// 解析 GitHub 的 `releases.atom`。启动器自身的更新链路已经在用 Atom feed 兜底
/// GitHub API 的匿名限流（403），dsh 的检查同样只走 feed：不需要 token、不受限流，
/// 一次请求就能拿到最近若干条 Release（含发布日期与说明）。
enum DSHReleaseFeedParser {
    private final class Delegate: NSObject, XMLParserDelegate {
        private var entries: [DSHReleaseEntry] = []
        private var insideEntry = false
        private var text = ""
        /// `<title>` 里的文本（形如 `v0.1.7-alpha.1`），仅作兜底。
        private var titleText = ""
        /// `link href` 里的 tag（形如 `dsh-v0.1.7-alpha.1`），真实 tag 以它为准。
        private var linkTag = ""
        private var htmlURL: String?
        private var publishedAt: String?
        private var contentHTML: String?

        func parse(_ data: Data) -> [DSHReleaseEntry] {
            let parser = XMLParser(data: data)
            parser.delegate = self
            parser.parse()
            return entries
        }

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
            text = ""
            if elementName == "entry" {
                insideEntry = true
                titleText = ""
                linkTag = ""
                htmlURL = nil
                publishedAt = nil
                contentHTML = nil
            }
            // 真实 feed 里 link 在 title 之前，但解析不能依赖顺序：两者分开存，
            // 收官时按「link tag 优先、title 兜底」取值。
            guard insideEntry, elementName == "link", let href = attributeDict["href"], href.contains("/releases/tag/") else { return }
            htmlURL = htmlURL ?? href
            let raw = URL(string: href)?.pathComponents.last ?? ""
            let decoded = raw.removingPercentEncoding ?? raw
            if !decoded.isEmpty, linkTag.isEmpty { linkTag = decoded }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard insideEntry else { return }
            text += string
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            guard insideEntry else { text = ""; return }
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            switch elementName {
            case "title" where titleText.isEmpty && !value.isEmpty:
                titleText = value
            case "updated" where publishedAt == nil && !value.isEmpty:
                publishedAt = value
            case "published" where publishedAt == nil && !value.isEmpty:
                publishedAt = value
            case "content" where contentHTML == nil && !value.isEmpty:
                contentHTML = text
            case "entry":
                insideEntry = false
                let rawTag = !linkTag.isEmpty ? linkTag : (titleText.isEmpty ? (htmlURL?.split(separator: "/").last.map(String.init) ?? "") : titleText)
                let version = normalizedDSHVersion(rawTag)
                if !version.isEmpty, version.first?.isNumber == true {
                    entries.append(DSHReleaseEntry(
                        version: version,
                        tag: rawTag,
                        publishedAt: DSHReleaseFeedParser.date(from: publishedAt),
                        notes: contentHTML.flatMap { DSHReleaseFeedParser.markdown(fromHTML: $0) },
                        htmlURL: htmlURL
                    ))
                }
            default:
                break
            }
            text = ""
        }
    }

    static func entries(fromFeedXML data: Data) -> [DSHReleaseEntry] {
        Delegate().parse(data)
    }

    static func date(from value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    /// Release 正文是 HTML（feed 的 `content`）。更新弹窗按 Markdown 渲染，所以这里做
    /// 一次轻量转换：先转换行内标记（粗体、行内代码、链接），再转换块级结构（标题、
    /// 列表、段落），顺序反了会把嵌套的链接和代码压成纯文本。
    static func markdown(fromHTML html: String, limit: Int = 4000) -> String? {
        var text = html.replacingOccurrences(of: "\r\n", with: "\n")
        // 代码块先处理：否则行内 <code> 规则会先把它拆开。
        text = replacing(text, pattern: #"(?is)<pre[^>]*>\s*<code[^>]*>(.*?)</code>\s*</pre>"#) { match, source in
            "```\n\(plainText(fromHTMLFragment: source.substring(with: match.range(at: 1))))\n```\n"
        }
        text = replacing(text, pattern: #"(?is)<(?:strong|b)[^>]*>(.*?)</(?:strong|b)>"#) { match, source in
            "**\(plainText(fromHTMLFragment: source.substring(with: match.range(at: 1))))**"
        }
        text = replacing(text, pattern: #"(?is)<(?:em|i)[^>]*>(.*?)</(?:em|i)>"#) { match, source in
            "*\(plainText(fromHTMLFragment: source.substring(with: match.range(at: 1))))*"
        }
        text = replacing(text, pattern: #"(?is)<code[^>]*>(.*?)</code>"#) { match, source in
            "`\(plainText(fromHTMLFragment: source.substring(with: match.range(at: 1))))`"
        }
        text = replacing(text, pattern: #"(?is)<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#) { match, source in
            let href = decodeEntities(source.substring(with: match.range(at: 1)))
            let label = plainText(fromHTMLFragment: source.substring(with: match.range(at: 2)))
            return href.isEmpty ? label : "[\(label)](\(href))"
        }
        text = replacing(text, pattern: #"(?is)<h[1-6][^>]*>(.*?)</h[1-6]>"#) { match, source in
            "### \(plainText(fromHTMLFragment: source.substring(with: match.range(at: 1))))\n\n"
        }
        text = replacing(text, pattern: #"(?is)<li[^>]*>(.*?)</li>"#) { match, source in
            "- \(plainText(fromHTMLFragment: source.substring(with: match.range(at: 1))))\n"
        }
        text = replacing(text, pattern: #"(?is)<(p|div)[^>]*>(.*?)</\1>"#) { match, source in
            "\(plainText(fromHTMLFragment: source.substring(with: match.range(at: 2))))\n\n"
        }
        text = text.replacingOccurrences(of: "<br />", with: "\n")
        text = text.replacingOccurrences(of: "<br/>", with: "\n")
        text = text.replacingOccurrences(of: "<br>", with: "\n")
        text = text.replacingOccurrences(of: "<[^>]+>", with: "", options: [.regularExpression])
        text = decodeEntities(text)
        text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: [.regularExpression])
        text = text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: "\n")
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return text.count > limit ? String(text.prefix(limit)) + "\n…" : text
    }

    /// 把一小段 HTML 压成纯文本（用于标签内的内容）。
    static func plainText(fromHTMLFragment fragment: String) -> String {
        var text = fragment.replacingOccurrences(of: "<[^>]+>", with: "", options: [.regularExpression])
        text = decodeEntities(text)
        return text.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 按正则逐处替换，回调拿到完整的匹配结果与原始串，便于按捕获组取值。
    private static func replacing(_ value: String, pattern: String, _ transform: (NSTextCheckingResult, NSString) -> String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
        let source = value as NSString
        var result = ""
        var cursor = 0
        regex.enumerateMatches(in: value, range: NSRange(location: 0, length: source.length)) { match, _, _ in
            guard let match else { return }
            result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            result += transform(match, source)
            cursor = match.range.location + match.range.length
        }
        result += source.substring(from: cursor)
        return result
    }

    private static func decodeEntities(_ value: String) -> String {
        var text = value
        let entities = [
            "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
            "&#39;": "'", "&apos;": "'", "&mdash;": "—", "&ndash;": "–"
        ]
        for (entity, replacement) in entities {
            text = text.replacingOccurrences(of: entity, with: replacement)
        }
        return text
    }
}

// MARK: - 选择与跳过

enum DSHUpdatePlanner {
    /// 把各来源的候选合并成一份报告。同版本的 GitHub Release 优先于 npm dist-tag，
    /// 因为它带发布日期与更新说明；只推荐确实发布到 npm 的版本，否则安装一定失败
    /// （历史上 npmmirror 滞后就出现过 ETARGET）。
    static func report(
        current: String,
        npm: DSHNpmMetadata?,
        releases: [DSHReleaseEntry],
        npmError: String? = nil,
        githubError: String? = nil
    ) -> DSHUpdateReport {
        var candidates: [DSHUpdateCandidate] = []
        var messages: [String] = []
        var warnings: [String] = []

        for entry in releases {
            guard !candidates.contains(where: { $0.version == entry.version }) else { continue }
            candidates.append(DSHUpdateCandidate(
                version: entry.version,
                source: .githubRelease,
                publishedAt: entry.publishedAt,
                notes: entry.notes
            ))
        }
        if let newest = releases.first {
            messages.append("GitHub Release 最新：v\(newest.version)")
        }
        if let githubError { warnings.append("GitHub Release 列表不可用（\(githubError)）") }

        if let npm {
            messages.append(npm.summary)
            for (tag, version) in npm.distTags where !version.isEmpty {
                let normalized = normalizedDSHVersion(version)
                guard !candidates.contains(where: { $0.version == normalized }) else { continue }
                candidates.append(DSHUpdateCandidate(version: normalized, source: .npmTag(tag)))
            }
            if let npmError { warnings.append("npm 元数据不完整（\(npmError)）") }
        } else if let npmError {
            warnings.append("npm 元数据不可用（\(npmError)）")
        }

        if candidates.isEmpty, let newest = npm?.versions.last {
            messages.append("npm 版本列表最新：v\(newest)")
            candidates.append(DSHUpdateCandidate(version: newest, source: .npmRegistry))
        }

        // 只推荐确实发布到 npm 的版本；镜像滞后时，GitHub 上一两天前刚发的 tag 可能
        // 还没有对应的 npm tarball，装到一半失败比不提示更糟。
        if let npm {
            if npm.versions.isEmpty {
                warnings.append("npm 版本列表为空，未能校验版本是否可安装")
            } else {
                let installable = candidates.filter { npm.contains(version: $0.version) }
                let dropped = candidates.filter { candidate in !installable.contains(where: { $0.version == candidate.version }) }
                if !dropped.isEmpty {
                    warnings.append("已忽略尚未发布到 npm 的版本：" + dropped.map { "v\($0.version)" }.joined(separator: "、"))
                }
                candidates = installable
            }
        } else {
            warnings.append("未能校验版本是否已发布到 npm")
        }

        let sorted = candidates.sorted { compareDSHVersions($0.version, $1.version) == .orderedDescending }
        guard let best = sorted.first else {
            // 一个候选都没有：用当前版本兜底，调用方据此报「未知」。
            return DSHUpdateReport(
                current: normalizedDSHVersion(current),
                best: DSHUpdateCandidate(version: current, source: .npmRegistry),
                newestStable: nil,
                candidates: [],
                npmMetadataAvailable: false,
                messages: messages,
                warnings: warnings + ["没有取到任何已发布版本"]
            )
        }
        return DSHUpdateReport(
            current: normalizedDSHVersion(current),
            best: best,
            newestStable: sorted.first { !$0.channel.isPrerelease },
            candidates: sorted,
            npmMetadataAvailable: npm?.versions.isEmpty == false,
            messages: messages,
            warnings: warnings
        )
    }

    /// 弹窗里可选的更新目标：只列比当前版本新的候选（最新的在最前），并按 limit
    /// 截断，免得下拉里塞进整部发布历史。
    static func selectableUpdates(_ report: DSHUpdateReport, limit: Int = 10) -> [DSHUpdateCandidate] {
        let newer = report.candidates.filter { compareDSHVersions($0.version, report.current) == .orderedDescending }
        guard !newer.isEmpty else { return report.isUpdate ? [report.best] : [] }
        return Array(newer.prefix(max(1, limit)))
    }

    static func isSkipped(version: String, skipped: String?) -> Bool {
        guard let skipped, !skipped.isEmpty else { return false }
        return normalizedDSHVersion(skipped) == normalizedDSHVersion(version)
    }

    /// 自动检查只更新菜单提示、从不静默安装；被用户跳过的版本也不再改菜单标题。
    /// 手动检查永远给弹窗，让用户能改主意。
    static func shouldAnnounce(_ report: DSHUpdateReport, interactive: Bool, skipped: String?) -> Bool {
        guard report.isUpdate else { return false }
        if interactive { return true }
        return !isSkipped(version: report.best.version, skipped: skipped)
    }
}

// MARK: - 服务

final class DSHVersionService {
    /// dsh 的 Release 发布在 deepseek-ai/deepseek-harness，tag 形如 `dsh-v0.1.7-alpha.1`。
    /// 走 Atom feed 而不是 API：匿名 API 经常 403 限流（启动器自身更新已踩过）。
    static let releasesFeedURL = URL(string: "https://github.com/deepseek-ai/deepseek-harness/releases.atom")!

    private let environment: [String: String]
    private let session: URLSession
    private let feedURL: URL
    private let npmTimeout: TimeInterval

    init(
        environment: [String: String] = LauncherEnvironment.nodeEnvironment(),
        feedURL: URL = DSHVersionService.releasesFeedURL,
        requestTimeout: TimeInterval = 12,
        npmTimeout: TimeInterval = 25
    ) {
        self.environment = environment
        self.feedURL = feedURL
        self.npmTimeout = npmTimeout
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = requestTimeout
        configuration.timeoutIntervalForResource = requestTimeout
        self.session = URLSession(configuration: configuration)
    }

    func check(completion: @escaping (DSHUpdateCheckResult) -> Void) {
        guard DSHRuntimeSupport.isInstalled() else {
            completion(.failed("dsh 尚未安装"))
            return
        }
        var currentVersion: String?
        var npm: DSHNpmMetadata?
        var npmError: String?
        var releases: [DSHReleaseEntry] = []
        var githubError: String?

        let group = DispatchGroup()
        group.enter()
        runCurrentVersion { currentVersion = $0; group.leave() }
        group.enter()
        runNpmMetadata { metadata, error in npm = metadata; npmError = error; group.leave() }
        group.enter()
        fetchReleases { entries, error in releases = entries; githubError = error; group.leave() }

        group.notify(queue: .main) {
            guard let currentVersion else {
                completion(.failed("无法读取当前 dsh 版本"))
                return
            }
            // 两条来源都失败才算失败；任一可用就给出结论，另一条的失败写进警告。
            guard npm != nil || !releases.isEmpty else {
                completion(.failed(githubError ?? npmError ?? "无法读取已发布版本"))
                return
            }
            completion(.checked(DSHUpdatePlanner.report(
                current: currentVersion,
                npm: npm,
                releases: releases,
                npmError: npmError,
                githubError: githubError
            )))
        }
    }

    private func runCurrentVersion(completion: @escaping (String?) -> Void) {
        guard DSHRuntimeSupport.isInstalled() else {
            completion(nil)
            return
        }
        var env = environment
        env["npm_config_prefer_offline"] = "true"
        run(executable: DSHRuntimeSupport.executableURL.path, arguments: ["--version"], environment: env) { output in
            completion(output.flatMap(DSHVersionParser.version(from:)))
        }
    }

    private func runNpmMetadata(completion: @escaping (DSHNpmMetadata?, String?) -> Void) {
        var env = environment
        env["npm_config_prefer_offline"] = "false"
        // dist-tags 一次拿全（latest/next/beta/alpha）：npm 的 latest 往往落后于
        // GitHub 上刚发的 Release，只看 latest 就会漏掉新版本。
        run(executable: "npm", arguments: ["view", "@deepseek-ai/dsh", "dist-tags", "versions", "--json"], environment: env) { output in
            if let output, let data = output.data(using: .utf8), let metadata = DSHNpmMetadata.decode(data) {
                completion(metadata, nil)
                return
            }
            // 多字段查询在个别 npm 版本上会报错：退回单字段，至少拿到 latest。
            self.run(executable: "npm", arguments: ["view", "@deepseek-ai/dsh", "version", "--json"], environment: env) { fallback in
                if let fallback, let data = fallback.data(using: .utf8), let metadata = DSHNpmMetadata.decode(data) {
                    completion(metadata, "仅取到 npm latest")
                } else {
                    completion(nil, "npm view 无输出")
                }
            }
        }
    }

    private func fetchReleases(completion: @escaping ([DSHReleaseEntry], String?) -> Void) {
        var request = URLRequest(url: feedURL)
        request.setValue("DeepseekHarnessLauncher", forHTTPHeaderField: "User-Agent")
        request.setValue("application/atom+xml, application/xml;q=0.9, */*;q=0.8", forHTTPHeaderField: "Accept")
        session.dataTask(with: request) { data, response, error in
            if let error {
                completion([], error.localizedDescription)
                return
            }
            guard let data, !data.isEmpty else {
                completion([], "Release feed 为空")
                return
            }
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                completion([], "Release feed HTTP \(http.statusCode)")
                return
            }
            let entries = DSHReleaseFeedParser.entries(fromFeedXML: data)
            completion(entries, entries.isEmpty ? "Release feed 解析为空" : nil)
        }.resume()
    }

    /// 只把 **stdout** 交给调用方：npm 的告警（例如本机代理触发的
    /// `UNDICI-EHPA` 实验特性提示）走 stderr，混进来会污染 JSON 解析。
    /// 仅当 stdout 为空时才回落到 stderr，便于把失败原因报出来。
    private func run(executable: String, arguments: [String], environment: [String: String], completion: @escaping (String?) -> Void) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        task.arguments = [executable] + arguments
        task.environment = environment
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        let lock = NSLock()
        var outputData = Data()
        var errorData = Data()
        var finished = false
        task.standardOutput = stdoutPipe
        task.standardError = stderrPipe
        func drain(_ handle: FileHandle, into buffer: inout Data) {
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
            } else {
                lock.lock(); buffer.append(data); lock.unlock()
            }
        }
        stdoutPipe.fileHandleForReading.readabilityHandler = { drain($0, into: &outputData) }
        stderrPipe.fileHandleForReading.readabilityHandler = { drain($0, into: &errorData) }
        // npm 遇到卡住的镜像会一直挂着；检查必须在有限时间内给出结论。
        DispatchQueue.global().asyncAfter(deadline: .now() + npmTimeout) { [weak task] in
            guard let task, task.isRunning else { return }
            task.terminate()
        }
        task.terminationHandler = { _ in
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            let restOut = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            let restErr = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            lock.lock()
            outputData.append(restOut)
            errorData.append(restErr)
            let output = String(data: outputData.isEmpty ? errorData : outputData, encoding: .utf8)
            guard !finished else { lock.unlock(); return }
            finished = true
            lock.unlock()
            completion(output)
        }
        do {
            try task.run()
        } catch {
            completion(nil)
        }
    }
}
