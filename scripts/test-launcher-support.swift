import Foundation

@main
struct LauncherSupportChecks {
    static func main() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("dhl-launcher-support-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let profile = root.appendingPathComponent("profile/node_modules", isDirectory: true)
        let shared = root.appendingPathComponent("profiles/node_modules", isDirectory: true)
        let currentPlugin = root.appendingPathComponent("Deepseek Harness Launcher.app/Contents/Resources/DSHArchiveManager", isDirectory: true)
        let currentManager = root.appendingPathComponent("Deepseek Harness Launcher.app/Contents/Resources/DSHPluginManager", isDirectory: true)
        let stalePlugin = root.appendingPathComponent("DSH.app/Contents/Resources/DSHArchiveManager", isDirectory: true)
        try FileManager.default.createDirectory(at: currentPlugin, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: currentManager, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)

        let archive = BundledPlugin(linkName: "dsh-archive-manager", bundleMarker: "DSHArchiveManager", url: currentPlugin)
        let manager = BundledPlugin(linkName: "dsh-plugin-manager", bundleMarker: "DSHPluginManager", url: currentManager)

        // Stale launcher link (points at an older DSH.app bundle) is repaired.
        let link = profile.appendingPathComponent("dsh-archive-manager")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: stalePlugin)
        precondition(!FileManager.default.fileExists(atPath: link.path))

        precondition(ensureBundledPluginLink(plugin: archive, profileURL: profile))
        let repairedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: link.path)
        precondition(repairedDestination == currentPlugin.path)

        // A third-party link must never be overwritten.
        let foreign = root.appendingPathComponent("foreign-plugin", isDirectory: true)
        try FileManager.default.removeItem(at: link)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: foreign)
        precondition(!ensureBundledPluginLink(plugin: archive, profileURL: profile))
        let preservedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: link.path)
        precondition(preservedDestination == foreign.path)

        // Both bundled plugins link into every profile location.
        try FileManager.default.removeItem(at: link)
        precondition(ensureBundledPluginLinks(plugins: [archive, manager], profileURLs: [shared, profile]))
        let sharedLink = shared.appendingPathComponent("dsh-archive-manager")
        let sharedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: sharedLink.path)
        precondition(sharedDestination == currentPlugin.path)
        let sharedManagerLink = shared.appendingPathComponent("dsh-plugin-manager")
        let sharedManagerDestination = try FileManager.default.destinationOfSymbolicLink(atPath: sharedManagerLink.path)
        precondition(sharedManagerDestination == currentManager.path)
        let profileManagerLink = profile.appendingPathComponent("dsh-plugin-manager")
        let profileManagerDestination = try FileManager.default.destinationOfSymbolicLink(atPath: profileManagerLink.path)
        precondition(profileManagerDestination == currentManager.path)

        // MARK: - 旧内置插件软链回收

        // 旧版本内置插件整体下线后，~/.dsh/profiles/**/node_modules 里会留下指向
        // App Resources 的悬空软链；插件管理器会把它们当成「装了但加载失败」的
        // user 插件。只回收确定属于旧内置包的软链，用户自装的同名插件一律保留。
        func linkDestination(_ url: URL) -> String? {
            try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)
        }

        let retiredProfiles = [
            root.appendingPathComponent("retired/shared/node_modules", isDirectory: true),
            root.appendingPathComponent("retired/web/node_modules", isDirectory: true)
        ]
        for dir in retiredProfiles { try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        let oldResources = root.appendingPathComponent("Old.app/Contents/Resources", isDirectory: true)

        let retiredLink = retiredProfiles[0].appendingPathComponent("dsh-more-menu")
        try FileManager.default.createSymbolicLink(
            at: retiredLink,
            withDestinationURL: oldResources.appendingPathComponent("DSHMoreMenu", isDirectory: true)
        )
        let retiredWebLink = retiredProfiles[1].appendingPathComponent("dsh-ui-enhance")
        try FileManager.default.createSymbolicLink(
            at: retiredWebLink,
            withDestinationURL: oldResources.appendingPathComponent("DSHUiEnhance", isDirectory: true)
        )
        // 旧安装包也用过相对目标，解析到 node_modules 所在目录后必须同样识别。
        let relativeLink = retiredProfiles[1].appendingPathComponent("dsh-launcher-settings")
        try FileManager.default.createSymbolicLink(
            atPath: relativeLink.path,
            withDestinationPath: "../../../Old.app/Contents/Resources/DSHLauncherSettings"
        )

        // 用户自装：真实目录、指向 local-plugins 的软链、以及名字带 marker 但
        // 不在 App 包内的软链，三种都不能被回收。
        let userDir = retiredProfiles[0].appendingPathComponent("dsh-sidebar-deck", isDirectory: true)
        try FileManager.default.createDirectory(at: userDir, withIntermediateDirectories: true)
        let userPlugin = root.appendingPathComponent("local-plugins/dsh-more-menu", isDirectory: true)
        try FileManager.default.createDirectory(at: userPlugin, withIntermediateDirectories: true)
        let userLink = retiredProfiles[0].appendingPathComponent("dsh-ui-enhance")
        try FileManager.default.createSymbolicLink(at: userLink, withDestinationURL: userPlugin)
        let lookalikeLink = retiredProfiles[1].appendingPathComponent("dsh-more-menu")
        try FileManager.default.createSymbolicLink(
            at: lookalikeLink,
            withDestinationURL: root.appendingPathComponent("somewhere/DSHMoreMenu", isDirectory: true)
        )

        // 当前仍在使用的内置插件链接绝不能进回收清单。
        precondition(!legacyBundledPluginLinks.keys.contains(archive.linkName))
        precondition(!legacyBundledPluginLinks.keys.contains(manager.linkName))
        let liveLink = retiredProfiles[0].appendingPathComponent("dsh-archive-manager")
        try FileManager.default.createSymbolicLink(at: liveLink, withDestinationURL: currentPlugin)

        let removed = removeLegacyBundledPluginLinks(profileURLs: retiredProfiles)
        precondition(
            Set(removed) == Set(["dsh-more-menu", "dsh-ui-enhance", "dsh-launcher-settings"]),
            "只回收指向旧 App 包的三个内置插件软链，实际：\(removed)"
        )
        precondition(linkDestination(retiredLink) == nil, "旧的绝对目标悬空软链已删除")
        precondition(linkDestination(retiredWebLink) == nil, "web profile 里的悬空软链已删除")
        precondition(linkDestination(relativeLink) == nil, "相对目标的旧软链已删除")
        precondition(FileManager.default.fileExists(atPath: userDir.path), "用户自装的同名真实目录保留")
        precondition(linkDestination(userLink) == userPlugin.path, "指向 local-plugins 的用户软链保留")
        precondition(linkDestination(lookalikeLink) != nil, "不在 Contents/Resources 内的同名软链保留")
        precondition(linkDestination(liveLink) == currentPlugin.path, "当前内置插件软链保留")
        precondition(removeLegacyBundledPluginLinks(profileURLs: retiredProfiles).isEmpty, "重复执行是幂等的")

        let timestamp = formatLogTimestamp(Date(timeIntervalSince1970: 0), timeZone: TimeZone(secondsFromGMT: 8 * 3600)!)
        precondition(timestamp == "1970-01-01 08:00:00 +0800")

        // MARK: - 内置插件就绪探针

        // 判定的唯一依据是「状态码 + 响应体」，不是「这次有没有等到响应」：
        // 只有确定性 404 才算未加载；超时/5xx/形状不符都只能是证据不足。
        let standardPolicy = BuiltinPluginProbePolicy(timeout: 3, interval: 1, deadline: 10)
        func verdict(
            _ responses: [(status: Int?, body: String?)],
            policy: BuiltinPluginProbePolicy = standardPolicy,
            marker: String = "\"ok\":true"
        ) -> BuiltinPluginVerdict {
            var index = 0
            var clock: TimeInterval = 0
            return BuiltinPluginReadiness.inspect(
                port: 3080, path: "/dsh-archive-manager/health", marker: marker, policy: policy,
                fetch: { _, _ in
                    let response = responses[min(index, responses.count - 1)]
                    index += 1
                    return response
                },
                sleep: { clock += $0 },
                now: { clock }
            )
        }

        precondition(verdict([(200, #"{"ok":true}"#)]) == .ready, "200 + 标记字段 = 就绪")
        precondition(verdict([(nil, nil)]) == .unknown, "整段窗口没有任何响应 = 证据不足，不许判未加载")
        precondition(verdict([(500, "boom")]) == .unknown, "5xx = 证据不足")
        precondition(verdict([(200, "{}")]) == .unknown, "200 但响应形状不符 = 证据不足")
        precondition(verdict([(404, "<html>404</html>")]) == .missing, "整段窗口最后一次是 404 = 确定未加载")
        precondition(
            verdict([(404, "<html>404</html>"), (200, #"{"ok":true}"#)]) == .ready,
            "先 404 后转好（插件树加载晚于 web）必须判就绪"
        )
        precondition(
            verdict([(404, "<html>404</html>"), (nil, nil)]) == .unknown,
            "404 之后又探不到响应 = 证据不足，不许沿用旧的 404 结论"
        )
        precondition(
            verdict([(200, #"{"ok":true,"bootId":"x"}"#)]) == .ready,
            "health 的 JSON 字段顺序不影响判定"
        )

        // 窗口要有耐心、且到点收手：deadline 5s、interval 2s 时在 0/2/4s 各探一次，
        // 第 6s 判定，不多打请求、不空转。
        var calls = 0
        var clock: TimeInterval = 0
        let boundedVerdict = BuiltinPluginReadiness.inspect(
            port: 3080, path: "/dsh-archive-manager/health", marker: "\"ok\":true",
            policy: BuiltinPluginProbePolicy(timeout: 3, interval: 2, deadline: 5),
            fetch: { _, _ in calls += 1; return (404, "<html>404</html>") },
            sleep: { clock += $0 },
            now: { clock }
        )
        precondition(boundedVerdict == .missing)
        precondition(calls == 3, "0s/2s/4s 各一次，窗口到点就收手")
        precondition(clock == 6)

        // 预算必须按最坏耗时给：health 是内存响应，但插件树加载与 dsh 启动可能很慢。
        // 退回单次 1.5s/3s 判定会把「慢」重新误判成「没加载」。
        precondition(BuiltinPluginProbePolicy.readiness.timeout >= 3)
        precondition(BuiltinPluginProbePolicy.readiness.deadline >= 60)
        precondition(BuiltinPluginProbePolicy.legacyEndpointFallback.deadline >= 20)

        // MARK: - 日志常驻句柄与轮转

        // 每块输出不再 open/seek/write/close；超过上限轮转成 .1，且轮转后句柄
        // 仍能继续写。上限设得很小，几百字节就能走到两条分支。
        let logDir = root.appendingPathComponent("logs", isDirectory: true)
        try FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let logURL = logDir.appendingPathComponent("dhl.log")
        let writer = LogFileWriter(url: logURL, maxBytes: 64)
        for _ in 0..<8 { writer.append(Data(repeating: 0x41, count: 20)) }
        writer.close()
        let rotatedSize = (try? FileManager.default.attributesOfItem(atPath: logURL.path)[.size] as? Int) ?? 0
        precondition(rotatedSize <= 64, "单个日志文件不得超过上限：\(String(describing: rotatedSize))")
        precondition(FileManager.default.fileExists(atPath: logURL.path + ".1"), "超限时必须留下 .1 备份")
        writer.append(Data("tail".utf8))
        writer.close()
        let tail = try Data(contentsOf: logURL)
        precondition(tail.suffix(4) == Data("tail".utf8), "轮转后句柄应能继续追加")

        print("launcher support checks passed")
    }
}
