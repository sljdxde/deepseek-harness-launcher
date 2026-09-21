import Foundation

/// 插件与当前 dsh 运行时的兼容性检查。
///
/// 数据全部取自本机文件与 loopback 接口，不依赖插件生态预先注册元数据：
/// - 插件清单：GET /dsh-plugin-manager/installed（插件管理器已区分
///   user / bundled / broken）；
/// - 用户插件声明的 peerDependencies：profile 的 node_modules/<pkg>/package.json；
/// - peer 包在当前 dsh runtime 里的实际版本：~/.dsh/runtime/node_modules/<peer>/package.json。
///
/// 判定规则与 `updateProfilePlugins` 的注释一致：插件依赖的 @deepseek-ai/*
/// peer 随 dsh 版本演进，声明区间不满足即视为可能不兼容（旧插件会因 API
/// 移除而加载失败）。内置插件不带 peer，其「是否随 dsh 加载」由启动器的
/// 接口探针判定（见 main.swift 的 monitorArchivePlugin / monitorSessionNotify）。
///
/// 版本比较复用 `compareVersions`（UpdateSupport.swift）。区间求值按 semver
/// 近似实现：`*`、空串恒真；`||` 任一分支满足即可；空白分隔的比较子按
/// `>=`/`<=`/`>`/`<`/`=`/精确/`^`/`~` 解释。预发布后缀（rc.N 等）视为低于
/// 同 base 的正式版，与 compareVersions 的排序语义一致。
enum PluginCompatibilitySupport {
    /// 插件管理器 /installed 接口返回的一条插件记录。
    struct InstalledPlugin: Decodable {
        let name: String
        let version: String?
        let source: String
        let broken: Bool?
    }

    /// 一个需要用户处理的兼容性问题。
    struct Issue {
        let pluginName: String
        let version: String?
        let reason: String
        /// user 插件可在提示里选择升级/卸载；内置插件只提示。
        let userPlugin: Bool
    }

    /// 判定单个比较子是否满足。comparator 形如 `>=0.1.0`、`<0.2.0`、
    /// `^0.1.2`、`~1.2.0`、`=3.0.0`、`3.0.0`、`*`。
    static func satisfiesComparator(_ version: String, _ comparator: String) -> Bool {
        let trimmed = comparator.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "*" || trimmed == "latest" { return true }
        if trimmed.hasPrefix(">=") { return compareVersions(version, String(trimmed.dropFirst(2))) != .orderedAscending }
        if trimmed.hasPrefix("<=") { return compareVersions(version, String(trimmed.dropFirst(2))) != .orderedDescending }
        if trimmed.hasPrefix(">") { return compareVersions(version, String(trimmed.dropFirst())) == .orderedDescending }
        if trimmed.hasPrefix("<") { return compareVersions(version, String(trimmed.dropFirst())) == .orderedAscending }
        if trimmed.hasPrefix("=") { return compareVersions(version, String(trimmed.dropFirst())) == .orderedSame }
        if trimmed.hasPrefix("^") || trimmed.hasPrefix("~") {
            return satisfiesCaretOrTilde(version, String(trimmed.dropFirst()), caret: trimmed.hasPrefix("^"))
        }
        return compareVersions(version, trimmed) == .orderedSame
    }

    /// `^`/`~` 区间：^ 约束到第一个非零主段，~ 约束到次版本。
    private static func satisfiesCaretOrTilde(_ version: String, _ base: String, caret: Bool) -> Bool {
        let parts = base.split(separator: ".").compactMap { Int($0) }
        let lower = base
        let upper: String
        switch (caret, parts.first ?? 0, parts.count > 1 ? parts[1] : 0) {
        case (true, 0, let minor) where minor > 0:
            upper = "0.\(minor + 1).0"
        case (true, let major, _) where major > 0:
            upper = "\(major + 1).0.0"
        default: // ^0.0.x 与 ~x.y：约束到次版本
            let major = parts.first ?? 0
            let minor = parts.count > 1 ? parts[1] : 0
            upper = "\(major).\(minor + 1).0"
        }
        return compareVersions(version, lower) != .orderedAscending &&
            compareVersions(version, upper) == .orderedAscending
    }

    /// 完整区间：`||` 分支任一满足即可，分支内空白分隔的比较子须全部满足。
    static func satisfiesRange(_ version: String, range: String) -> Bool {
        for alternative in range.components(separatedBy: "||") {
            let comparators = alternative
                .components(separatedBy: .whitespacesAndNewlines)
                .filter { !$0.isEmpty }
            if comparators.isEmpty { return true }
            if comparators.allSatisfy({ satisfiesComparator(version, $0) }) { return true }
        }
        return false
    }

    /// 读取一个 package.json 的 name/version/peerDependencies（缺失返回 nil）。
    static func packageManifest(at url: URL) -> (name: String?, version: String?, peers: [String: String])? {
        guard let data = try? Data(contentsOf: url),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        let peers = (object["peerDependencies"] as? [String: String]) ?? [:]
        return (object["name"] as? String, object["version"] as? String, peers)
    }

    /// 对已安装插件做静态兼容性扫描。broken 残留与 peer 区间不满足都算问题；
    /// peer 在 runtime 中不存在（API 被移除）也算问题。
    /// - Parameters:
    ///   - plugins: 插件管理器 /installed 接口的清单。
    ///   - profileModules: ~/.dsh/profiles/web/node_modules。
    ///   - runtimeModules: ~/.dsh/runtime/node_modules。
    static func scan(
        plugins: [InstalledPlugin],
        profileModules: URL,
        runtimeModules: URL
    ) -> [Issue] {
        var issues: [Issue] = []
        for plugin in plugins {
            if plugin.broken == true {
                issues.append(Issue(
                    pluginName: plugin.name, version: plugin.version,
                    reason: "安装不完整或已损坏", userPlugin: true
                ))
                continue
            }
            guard plugin.source == "user" else { continue }
            let packageURL = profileModules.appendingPathComponent(plugin.name)
            guard let manifest = packageManifest(at: packageURL.appendingPathComponent("package.json")),
                  !manifest.peers.isEmpty else { continue }
            for (peer, range) in manifest.peers.sorted(by: { $0.key < $1.key }) {
                let peerURL = runtimeModules.appendingPathComponent(peer).appendingPathComponent("package.json")
                guard let installed = packageManifest(at: peerURL)?.version else {
                    issues.append(Issue(
                        pluginName: plugin.name, version: plugin.version,
                        reason: "依赖的 \(peer)（\(range)）在当前 dsh 运行时中不存在", userPlugin: true
                    ))
                    continue
                }
                if !satisfiesRange(installed, range: range) {
                    issues.append(Issue(
                        pluginName: plugin.name, version: plugin.version,
                        reason: "需要 \(peer) \(range)，当前为 \(installed)", userPlugin: true
                    ))
                }
            }
        }
        return issues
    }

    /// 向插件管理器发一条同步 POST 命令（升级/卸载）。dsh plugin 走 pnpm，
    /// 可能持续数分钟，超时由调用方给出；只允许 loopback 地址。
    /// 必须在后台线程调用（内部用信号量等待）。
    static func postPluginCommand(url: URL, name: String, timeout: TimeInterval) -> (ok: Bool, error: String) {
        guard url.host == "127.0.0.1",
              let body = try? JSONSerialization.data(withJSONObject: ["name": name]) else {
            return (false, "无法构造请求")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let semaphore = DispatchSemaphore(value: 0)
        var payload: (status: Int?, text: String)?
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode
            payload = (status, data.flatMap { String(data: $0, encoding: .utf8) } ?? "")
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 5)
        task.cancel()
        guard let result = payload else { return (false, "请求超时") }
        // 接口约定：HTTP 200 且 JSON 里 ok 为真才算成功。
        guard result.status == 200,
              let data = result.text.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return (false, "接口返回异常（HTTP \(result.status.map(String.init) ?? "无")）")
        }
        if let ok = object["ok"] as? Bool, ok { return (true, "") }
        let message = (object["error"] as? String) ?? (object["note"] as? String) ?? "未知错误"
        return (false, message)
    }
}
