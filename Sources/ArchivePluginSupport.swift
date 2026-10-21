import Foundation

/// A bundled plugin that the launcher ships inside the app bundle and links
/// into each web profile's node_modules at launch.
struct BundledPlugin {
    let linkName: String      // package name used for the node_modules symlink, e.g. "dsh-archive-manager"
    let bundleMarker: String  // app-resource directory name, e.g. "DSHArchiveManager" (also detects stale links)
    let url: URL
}

/// 内置插件就绪探测的预算与判定。
///
/// 探针打的是插件自己的 HTTP 接口。它们不保证便宜：实测
/// `/dsh-archive-manager/archives` 在 139 个会话（115MB 日志、25 个归档会话）的库上
/// 热启要 2.3-2.5s、冷启超过 4s——每次都要遍历持久化列表，再折叠归档会话的标题
/// （标题只在事件流里，等于把每份归档会话日志整份读一遍）。dsh 启动后插件树也可能
/// 晚于 web 端就绪。
///
/// 所以内置插件改用零成本的 `/health` 接口做就绪探针（路由与重接口注册在同一个
/// effect 里：能探到 health 就说明插件真的接进了 dsh），并且判定只看**确定证据**：
/// 成百上千分之一的慢响应不能再变成用户可见的「插件不兼容」。
///
/// 原来的「1.5s 超时轮询 40 次」和「web 就绪 12s 后单次 3s 判定」把「慢」当成了
/// 「没加载」：既弹出「插件可能与当前 dsh 版本不兼容」的假告警（重启 dsh 也不会好，
/// 因为下次启动照样慢），又让归档插件永远判不就绪（连带回退快照都从不清理）。
/// 窗口要按最坏耗时给，不能按空闲时的响应给。
struct BuiltinPluginProbePolicy: Equatable {
    /// 单次请求的等待上限。
    let timeout: TimeInterval
    /// 两次尝试之间的间隔。
    let interval: TimeInterval
    /// 从第一次尝试起的总窗口；到点仍没拿到确定结论才下判断。
    let deadline: TimeInterval

    /// 常规就绪等待：覆盖冷启与插件树加载的最坏耗时。
    static let readiness = BuiltinPluginProbePolicy(timeout: 3, interval: 1, deadline: 120)
    /// 兼容性巡检：只用来确认「确定性 404」，窗口给足；health 是内存响应，探多少次都便宜。
    static let compatibility = BuiltinPluginProbePolicy(timeout: 3, interval: 2, deadline: 90)
    /// 老版本插件没有 /health 时的兜底接口（重接口）：窗口短一些，避免重复长时间探测。
    static let compatibilityFallback = BuiltinPluginProbePolicy(timeout: 8, interval: 2, deadline: 30)
}

/// 内置插件就绪探测的结论。
///
/// **只有 `.missing` 可以变成用户可见的告警**：它表示整段窗口里最后一次拿到的响应
/// 确定是 404（插件没把路由挂上）。超时、连接失败、5xx、200 但响应形状不符都只算
/// 「证据不足」（`.unknown`），一律不告警——误报比漏报更伤：用户会照弹窗去重启、
/// 升级，折腾一圈发现插件本来是好的，下次照样报。
enum BuiltinPluginVerdict: Equatable {
    case ready
    case missing
    case unknown
}

/// 内置插件「是否已随当前 dsh 加载」的探针判定。
/// fetch/sleep/now 全部注入：单测不碰网络、不真睡。
enum BuiltinPluginReadiness {
    /// 在 `policy.deadline` 内轮询：
    /// - 任意一次 `200` 且响应体带标记 → `.ready`；
    /// - 窗口结束时**最后一次**响应是 `404` → `.missing`；
    /// - 其余（最后一次没响应 / 非 404 状态 / 形状不符）→ `.unknown`。
    ///
    /// 判定前先看窗口是否还够，避免窗口到点后再多打一发请求。
    static func inspect(
        port: Int,
        path: String,
        marker: String,
        policy: BuiltinPluginProbePolicy,
        fetch: (URL, TimeInterval) -> (status: Int?, body: String?)?,
        sleep: (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) },
        now: () -> TimeInterval = { Date.timeIntervalSinceReferenceDate }
    ) -> BuiltinPluginVerdict {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)"), !marker.isEmpty else { return .unknown }
        let startedAt = now()
        var firstAttempt = true
        var lastStatus: Int?
        while true {
            if !firstAttempt, now() - startedAt >= policy.deadline {
                return lastStatus == 404 ? .missing : .unknown
            }
            firstAttempt = false
            let response = fetch(url, policy.timeout)
            lastStatus = response?.status
            if let response, response.status == 200, let body = response.body, body.contains(marker) {
                return .ready
            }
            sleep(policy.interval)
        }
    }
}

@discardableResult
func ensureBundledPluginLink(
    plugin: BundledPlugin,
    profileURL: URL,
    fileManager: FileManager = .default
) -> Bool {
    let link = profileURL.appendingPathComponent(plugin.linkName)
    do {
        try fileManager.createDirectory(at: profileURL, withIntermediateDirectories: true)

        // fileExists(atPath:) follows symlinks and returns false for a dangling
        // link left by an older DSH installation. Read the link itself first so
        // upgrades can replace stale links without touching third-party plugins.
        if let destination = try? fileManager.destinationOfSymbolicLink(atPath: link.path) {
            guard destination.contains(plugin.bundleMarker) else { return false }
            try fileManager.removeItem(at: link)
        } else if fileManager.fileExists(atPath: link.path) {
            return false
        }

        try fileManager.createSymbolicLink(at: link, withDestinationURL: plugin.url)
        return true
    } catch {
        return false
    }
}

@discardableResult
func ensureBundledPluginLinks(
    plugins: [BundledPlugin],
    profileURLs: [URL],
    fileManager: FileManager = .default
) -> Bool {
    var available = false
    for profileURL in profileURLs {
        for plugin in plugins {
            if ensureBundledPluginLink(plugin: plugin, profileURL: profileURL, fileManager: fileManager) {
                available = true
            } else if fileManager.fileExists(atPath: profileURL.appendingPathComponent(plugin.linkName).path) {
                available = true
            }
        }
    }
    return available
}
