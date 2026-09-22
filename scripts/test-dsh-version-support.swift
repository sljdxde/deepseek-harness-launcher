import Foundation

@main
struct DSHVersionSupportChecks {
    static func main() {
        precondition(DSHVersionParser.version(from: "0.1.1-rc.2\n") == "0.1.1-rc.2")
        precondition(DSHVersionParser.version(from: "1.2.3") == "1.2.3")
        precondition(DSHVersionParser.version(from: "no version here") == nil)
        precondition(compareVersions("0.1.1-rc.2", "0.1.1") == .orderedAscending)
        precondition(compareVersions("1.0.0", "1.0.0") == .orderedSame)
        precondition(
            LauncherEnvironment.npmRegistryCandidates(environment: [:]) ==
                ["https://registry.npmmirror.com", "https://registry.npmjs.org"]
        )
        precondition(
            LauncherEnvironment.npmRegistryCandidates(environment: ["DHL_NPM_REGISTRY": "https://npm.example.test/"]) ==
                ["https://npm.example.test", "https://registry.npmmirror.com", "https://registry.npmjs.org"]
        )
        // First-install memory budget: fetch concurrency must stay modest so
        // npm's concurrent tarball fetch/extract cannot balloon peak RSS.
        precondition(LauncherEnvironment.nodeEnvironment()["npm_config_maxsockets"] == "16")

        checkDSHVersionOrdering()
        checkNpmMetadata()
        checkReleaseFeed()
        checkPlanner()
        checkSkipPolicy()
        print("dsh version support checks passed")
    }

    /// dsh 的版本号是 npm 语义：启动器自身的 compareVersions 只分辨「同 base 的预发布」，
    /// 分不出 alpha.1 / alpha.2，所以更新判断必须用 compareDSHVersions。
    static func checkDSHVersionOrdering() {
        precondition(compareVersions("0.1.7-alpha.1", "0.1.7-alpha.2") == .orderedSame) // 旧比较器的局限
        precondition(compareDSHVersions("0.1.7-alpha.2", "0.1.7-alpha.1") == .orderedDescending)
        precondition(compareDSHVersions("0.1.5-rc.3", "0.1.5-rc.2") == .orderedDescending)
        precondition(compareDSHVersions("0.1.7-alpha.1", "0.1.5-rc.2") == .orderedDescending)
        precondition(compareDSHVersions("0.1.5-rc.2", "0.1.5") == .orderedAscending)   // 预发布低于同 base 正式版
        precondition(compareDSHVersions("0.1.5-rc.2", "0.1.5-beta.3") == .orderedDescending)
        precondition(compareDSHVersions("0.1.5-rc.2", "0.1.5-rc.2") == .orderedSame)
        precondition(compareDSHVersions("1.0.0", "1.0.0+build.7") == .orderedSame)     // 构建元数据不参与比较
        precondition(compareDSHVersions("0.2.0", "0.1.9") == .orderedDescending)
        precondition(compareDSHVersions("0.1.5-alpha.1", "0.1.5-alpha") == .orderedDescending)

        precondition(normalizedDSHVersion("dsh-v0.1.7-alpha.1") == "0.1.7-alpha.1")
        precondition(normalizedDSHVersion("v0.1.5-rc.2") == "0.1.5-rc.2")
        precondition(normalizedDSHVersion(" 0.1.5-rc.2 ") == "0.1.5-rc.2")
        precondition(compareDSHVersions("dsh-v0.1.7-alpha.1", "0.1.7-alpha.1") == .orderedSame)

        precondition(DSHReleaseChannel.detect(from: "0.1.5-rc.2") == .releaseCandidate)
        precondition(DSHReleaseChannel.detect(from: "0.1.7-alpha.1") == .alpha)
        precondition(DSHReleaseChannel.detect(from: "0.2.0-beta.1") == .beta)
        precondition(DSHReleaseChannel.detect(from: "0.2.0") == .stable)
        precondition(DSHReleaseChannel.detect(from: "dsh-v0.1.7-alpha.1") == .alpha)
        precondition(DSHReleaseChannel.alpha.label == "内测版")
        precondition(DSHReleaseChannel.alpha.isPrerelease)
        precondition(!DSHReleaseChannel.stable.isPrerelease)
    }

    static func checkNpmMetadata() {
        let combined = Data(#"{"dist-tags":{"latest":"0.1.5-rc.2","next":"0.1.5-rc.3","alpha":"0.1.7-alpha.1"},"versions":["0.1.5-rc.2","0.1.5-rc.3"]}"#.utf8)
        guard let metadata = DSHNpmMetadata.decode(combined) else { preconditionFailure("combined npm metadata must decode") }
        precondition(metadata.distTags["alpha"] == "0.1.7-alpha.1")
        precondition(metadata.contains(version: "0.1.5-rc.2"))
        precondition(!metadata.contains(version: "0.1.7-alpha.1"))  // 镜像滞后：tag 有了、tarball 还没有
        precondition(metadata.summary.contains("latest 0.1.5-rc.2"))
        precondition(metadata.summary.contains("alpha 0.1.7-alpha.1"))

        // 单字段兜底：`npm view <pkg> version --json` 只有裸字符串。
        let single = Data(#""0.1.5-rc.2""#.utf8)
        precondition(DSHNpmMetadata.decode(single)?.distTags["latest"] == "0.1.5-rc.2")
        precondition(DSHNpmMetadata.decode(Data("not json".utf8)) == nil)
    }

    static func checkReleaseFeed() {
        let feed = Data(#"""
        <?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>v0.1.7-alpha.1</title>
            <link rel="alternate" href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.1"/>
            <updated>2026-09-22T06:16:27Z</updated>
            <content type="html">&lt;h2&gt;Highlights&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Faster starts&lt;/li&gt;&lt;li&gt;&lt;code&gt;dsh web&lt;/code&gt; flag&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;See &lt;a href="https://example.test/notes"&gt;notes&lt;/a&gt;&lt;/p&gt;</content>
          </entry>
          <entry>
            <title>v0.1.6-alpha.2</title>
            <link rel="alternate" href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2"/>
            <updated>2026-09-17T13:30:16Z</updated>
            <content type="html"></content>
          </entry>
        </feed>
        """#.utf8)
        let entries = DSHReleaseFeedParser.entries(fromFeedXML: feed)
        precondition(entries.count == 2)
        precondition(entries[0].version == "0.1.7-alpha.1")
        precondition(entries[0].tag == "dsh-v0.1.7-alpha.1")
        precondition(entries[0].publishedAt != nil)
        precondition(entries[0].htmlURL?.hasSuffix("/releases/tag/dsh-v0.1.7-alpha.1") == true)
        guard let notes = entries[0].notes else { preconditionFailure("release notes must be converted to markdown") }
        precondition(notes.contains("### Highlights"))
        precondition(notes.contains("- Faster starts"))
        precondition(notes.contains("`dsh web`"))
        precondition(notes.contains("[notes](https://example.test/notes)"))
        precondition(entries[1].version == "0.1.6-alpha.2")
        precondition(entries[1].notes == nil)

        // HTML 实体与标签必须被清掉，否则弹窗里会出现 &lt;div&gt; 这类噪声。
        precondition(DSHReleaseFeedParser.plainText(fromHTMLFragment: "a &amp; b <div>c</div>") == "a & b c")
        precondition(DSHReleaseFeedParser.entries(fromFeedXML: Data("<feed></feed>".utf8)).isEmpty)
    }

    static func checkPlanner() {
        let npm = DSHNpmMetadata(
            distTags: ["latest": "0.1.5-rc.2", "next": "0.1.5-rc.3", "alpha": "0.1.7-alpha.1"],
            versions: ["0.1.5-rc.2", "0.1.5-rc.3", "0.1.7-alpha.1"]
        )
        let releases = [
            DSHReleaseEntry(version: "0.1.7-alpha.1", tag: "dsh-v0.1.7-alpha.1", publishedAt: nil, notes: "### New", htmlURL: nil),
            DSHReleaseEntry(version: "0.1.5-rc.2", tag: "dsh-v0.1.5-rc.2", publishedAt: nil, notes: nil, htmlURL: nil)
        ]
        // 真实场景：npm 的 latest 停在 0.1.5-rc.2（= 已安装），GitHub 上已经发了 0.1.7-alpha.1。
        let report = DSHUpdatePlanner.report(current: "0.1.5-rc.2", npm: npm, releases: releases)
        precondition(report.best.version == "0.1.7-alpha.1")
        precondition(report.best.channel == .alpha)
        precondition(report.best.source == .githubRelease)   // 同版本时 GitHub 优先（带说明）
        precondition(report.best.notes == "### New")
        precondition(report.isUpdate)
        precondition(report.newestStable == nil)
        precondition(report.messages.contains { $0.contains("GitHub Release 最新") })
        precondition(report.messages.contains { $0.contains("npm dist-tags") })
        precondition(report.warnings.isEmpty)
        // 去重后三个候选：0.1.7-alpha.1（GitHub+alpha 标签）、0.1.5-rc.3（next 标签）、0.1.5-rc.2（GitHub+latest 标签）。
        precondition(report.candidates.count == 3)
        precondition(report.candidates.map(\.version) == ["0.1.7-alpha.1", "0.1.5-rc.3", "0.1.5-rc.2"])

        // 已是最新：npm latest 与 GitHub 最新都等于已安装版本。
        let current = DSHUpdatePlanner.report(
            current: "0.1.7-alpha.1",
            npm: DSHNpmMetadata(distTags: ["latest": "0.1.7-alpha.1"], versions: ["0.1.7-alpha.1"]),
            releases: [DSHReleaseEntry(version: "0.1.7-alpha.1", tag: "dsh-v0.1.7-alpha.1", publishedAt: nil, notes: nil, htmlURL: nil)]
        )
        precondition(!current.isUpdate)
        precondition(current.best.version == "0.1.7-alpha.1")

        // 当前装的是比所有已发布版本都新的版本（提前用了内测版）：不算「有更新」。
        let ahead = DSHUpdatePlanner.report(
            current: "0.1.8-alpha.1",
            npm: DSHNpmMetadata(distTags: ["latest": "0.1.5-rc.2"], versions: ["0.1.5-rc.2"]),
            releases: []
        )
        precondition(!ahead.isUpdate)
        precondition(ahead.best.version == "0.1.5-rc.2")

        // GitHub 刚发的 tag 还没进 npm：必须丢弃并说明，否则点更新会 ETARGET。
        let unpublished = DSHUpdatePlanner.report(
            current: "0.1.5-rc.2",
            npm: DSHNpmMetadata(distTags: ["latest": "0.1.5-rc.2"], versions: ["0.1.5-rc.2"]),
            releases: [DSHReleaseEntry(version: "0.1.7-alpha.1", tag: "dsh-v0.1.7-alpha.1", publishedAt: nil, notes: nil, htmlURL: nil)]
        )
        precondition(unpublished.best.version == "0.1.5-rc.2")
        precondition(!unpublished.isUpdate)
        precondition(unpublished.warnings.contains { $0.contains("0.1.7-alpha.1") })

        // GitHub 挂了但 npm 可用：仍然要能发现 next 标签上的新版本。
        let feedDown = DSHUpdatePlanner.report(
            current: "0.1.5-rc.2",
            npm: npm,
            releases: [],
            githubError: "Release feed HTTP 500"
        )
        precondition(feedDown.best.version == "0.1.7-alpha.1")
        precondition(feedDown.warnings.contains { $0.contains("GitHub Release") })

        // 两条来源都没有：不要谎报「已是最新」，交给调用方当失败处理。
        let empty = DSHUpdatePlanner.report(current: "0.1.5-rc.2", npm: nil, releases: [], npmError: "npm view 无输出")
        precondition(empty.candidates.isEmpty)
        precondition(!empty.isUpdate)
        precondition(!empty.warnings.isEmpty)

        // 正式版 + 预发布并存：提示最新，同时告诉用户最新正式版是哪一版。
        let mixed = DSHUpdatePlanner.report(
            current: "0.1.4",
            npm: DSHNpmMetadata(distTags: ["latest": "0.1.5", "alpha": "0.1.7-alpha.1"], versions: ["0.1.5", "0.1.7-alpha.1"]),
            releases: []
        )
        precondition(mixed.best.version == "0.1.7-alpha.1")
        precondition(mixed.newestStable?.version == "0.1.5")
    }

    static func checkSkipPolicy() {
        let report = DSHUpdatePlanner.report(
            current: "0.1.5-rc.2",
            npm: DSHNpmMetadata(distTags: ["alpha": "0.1.7-alpha.1"], versions: ["0.1.7-alpha.1"]),
            releases: []
        )
        precondition(report.isUpdate)
        // 自动检查：跳过过的版本不再提示；手动检查：永远弹窗（让用户能改主意）。
        precondition(DSHUpdatePlanner.shouldAnnounce(report, interactive: false, skipped: nil))
        precondition(!DSHUpdatePlanner.shouldAnnounce(report, interactive: false, skipped: "0.1.7-alpha.1"))
        precondition(DSHUpdatePlanner.shouldAnnounce(report, interactive: true, skipped: "0.1.7-alpha.1"))
        // GitHub tag 形式与 npm 版本形式视为同一版本。
        precondition(DSHUpdatePlanner.isSkipped(version: "0.1.7-alpha.1", skipped: "dsh-v0.1.7-alpha.1"))
        precondition(!DSHUpdatePlanner.isSkipped(version: "0.1.7-alpha.2", skipped: "0.1.7-alpha.1"))
        // 无关版本不参与提示：没有更新时怎么都不弹。
        let current = DSHUpdatePlanner.report(current: "0.1.5-rc.2", npm: DSHNpmMetadata(distTags: ["latest": "0.1.5-rc.2"], versions: ["0.1.5-rc.2"]), releases: [])
        precondition(!DSHUpdatePlanner.shouldAnnounce(current, interactive: true, skipped: nil))
    }
}
