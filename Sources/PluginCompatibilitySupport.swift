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
/// 移除而加载失败）。启动器自带的内置插件**完全不参与扫描**（见
/// `bundledPluginNames`）：它们的加载状态由就绪探针只写日志，不进兼容性告警。
///
/// 区间求值按 npm 的 semver 语义实现（`*`/`x`-range、`^`、`~`、`||`、空白分隔的比较子，
/// 以及「预发布版本只在同 base 的比较子出现预发布时才满足」的门控），版本比较复用
/// `compareDSHVersions`（DSHUpdateSupport.swift）。以前这里复用启动器的 `compareVersions`，
/// 那套面向 `x.y.z-a.b-SNAPSHOT` 会把 `rc.1` 与 `rc.6` 判成相等——等于把不兼容的插件
/// 报成兼容，用户升完 dsh 才发现插件全挂。
enum PluginCompatibilitySupport {
    /// 插件管理器 /installed 接口返回的一条插件记录。
    struct InstalledPlugin: Decodable {
        let name: String
        let version: String?
        let source: String
        let broken: Bool?
    }

    /// 启动器随包分发的内置插件。它们**永不参与兼容性扫描**。
    ///
    /// 为什么不在扫描范围里：内置插件跟着 App 一起分发，用户既升不了级、也卸不掉，
    /// 弹「插件可能与当前 dsh 版本不兼容」只会把人引去「重启 dsh」白折腾一次——
    /// 下一次启动同样的判定再来一遍。它们"有没有随当前 dsh 加载"另有就绪探针，
    /// 只写日志（见 main.swift 的 monitorArchivePlugin / monitorSessionNotify）。
    ///
    /// 名字集合是兜底：插件管理器通常把这三个标成 `source: "bundled"`，但软链目标
    /// 判定失败（App 被移动、旧版本接口）时可能标成 `user`/`broken`，那种也不许进扫描。
    static let bundledPluginNames: Set<String> = [
        "dsh-archive-manager",
        "dsh-plugin-manager",
        "dsh-session-notify",
    ]

    /// 一个需要用户处理的兼容性问题。只会来自用户插件（见 `bundledPluginNames`）。
    struct Issue {
        let pluginName: String
        let version: String?
        let reason: String
    }

    /// 判定单个比较子是否满足。comparator 形如 `>=0.1.0`、`<0.2.0`、
    /// `^0.1.2`、`~1.2.0`、`=3.0.0`、`3.0.0`、`*`、`0.1.x`。
    ///
    /// `^`/`~`/x-range 都先展开成 `>=` + `<` 的上下界再比，比较本身用
    /// `compareDSHVersions`（npm 语义）——启动器自己的 `compareVersions` 会把
    /// `rc.1` 和 `rc.6` 当成同一个版本，用它判 peer 区间会把明明不兼容的插件判成兼容。
    static func satisfiesComparator(_ version: String, _ comparator: String) -> Bool {
        let atoms = expandComparator(comparator)
        return atoms.allSatisfy { satisfiesAtom(version, $0) }
    }

    private static func satisfiesAtom(_ version: String, _ atom: (op: String, value: String)) -> Bool {
        if crossesExclusiveUpperBound(version, atom) { return false }
        let order = compareDSHVersions(version, atom.value)
        switch atom.op {
        case ">=": return order != .orderedAscending
        case "<=": return order != .orderedDescending
        case ">": return order == .orderedDescending
        case "<": return order == .orderedAscending
        default: return order == .orderedSame
        }
    }

    /// 一个比较子 → 若干 `(操作符, 版本)`。空串与 `*`/`x` 是「不约束」。
    private static func expandComparator(_ raw: String) -> [(op: String, value: String)] {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "*" || trimmed == "x" || trimmed == "X" { return [] }
        if let head = trimmed.first, head == "^" || head == "~" {
            return caretOrTildeAtoms(String(trimmed.dropFirst()), caret: head == "^")
        }
        let op: String
        let value: String
        switch true {
        case trimmed.hasPrefix(">="): (op, value) = (">=", String(trimmed.dropFirst(2)))
        case trimmed.hasPrefix("<="): (op, value) = ("<=", String(trimmed.dropFirst(2)))
        case trimmed.hasPrefix(">"): (op, value) = (">", String(trimmed.dropFirst()))
        case trimmed.hasPrefix("<"): (op, value) = ("<", String(trimmed.dropFirst()))
        case trimmed.hasPrefix("="): (op, value) = ("=", String(trimmed.dropFirst()))
        default: (op, value) = ("=", trimmed)
        }
        if value.isEmpty || value.hasPrefix("x") || value.hasPrefix("X") { return [] }
        if value.contains("x") || value.contains("X") { return xRangeAtoms(value) }
        return [(op, value)]
    }

    /// `^1.2.3` → `>=1.2.3 <2.0.0`；`^0.2.5` → `>=0.2.5 <0.3.0`；`^0.0.3` → `>=0.0.3 <0.0.4`。
    /// `~1.2.3` → `>=1.2.3 <1.3.0`。以前 `^0.0.3` 的上界被算成 `0.1.0`，等于把 0.0.4～0.0.9
    /// 全放进来（npm 只允许补丁位浮动）。
    private static func caretOrTildeAtoms(_ base: String, caret: Bool) -> [(op: String, value: String)] {
        let parts = base.split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
        let major = parts.first ?? 0
        let minor = parts.count > 1 ? parts[1] : 0
        let patch = parts.count > 2 ? parts[2] : 0
        let upper: String
        if !caret {
            upper = "\(major).\(minor + 1).0"
        } else if major > 0 {
            upper = "\(major + 1).0.0"
        } else if minor > 0 {
            upper = "0.\(minor + 1).0"
        } else {
            upper = "0.0.\(patch + 1)"
        }
        return [(">=", base), ("<", upper)]
    }

    /// `0.1.x` → `>=0.1.0 <0.2.0`；`1.x` → `>=1.0.0 <2.0.0`。旧实现把带 `x` 的区间
    /// 当成精确版本比较，结果恒不兼容。
    private static func xRangeAtoms(_ value: String) -> [(op: String, value: String)] {
        let tokens = value.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        let wildcard = tokens.firstIndex(where: { $0 == "x" || $0 == "X" || $0.isEmpty }) ?? tokens.count
        let numbers = tokens.prefix(wildcard).compactMap { Int($0) }
        switch numbers.count {
        case 0: return []
        case 1: return [(">=", "\(numbers[0]).0.0"), ("<", "\(numbers[0] + 1).0.0")]
        default: return [(">=", "\(numbers[0]).\(numbers[1]).0"), ("<", "\(numbers[0]).\(numbers[1] + 1).0")]
        }
    }

    /// 完整区间：`||` 分支任一满足即可，分支内空白分隔的比较子须全部满足。
    ///
    /// 求值规则刻意**不**照搬 npm 默认的预发布门控：npm 要求「版本带 rc 时，区间里必须
    /// 有一个同 base 的预发布比较子」才算满足，而 dsh 生态常态就是装 rc 版 runtime，
    /// 那样会把所有只写正式区间（`>=0.1.0 <0.2.0`）的插件一律报成不兼容，警告变成噪音。
    /// 这里保留真正的两条安全性：预发布之间按 semver 严格排序（`rc.1 < rc.6`），
    /// 以及越过排他上界的预发布不算满足（`<0.2.0` 不接受 `0.2.0-rc.9`——那已经是
    /// 插件明确排除的 0.2 线）。
    static func satisfiesRange(_ version: String, range: String) -> Bool {
        for alternative in range.components(separatedBy: "||") {
            if satisfiesBranch(version, alternative) { return true }
        }
        return false
    }

    private static func satisfiesBranch(_ version: String, _ branch: String) -> Bool {
        let comparators = joinSplitComparators(branch)
        if comparators.isEmpty { return true }
        return comparators.allSatisfy { satisfiesComparator(version, $0) }
    }

    /// `>= 0.1.0`（操作符后有空格）以前会被拆成 `>=` 与 `0.1.0` 两段，
    /// `>=` 就变成了「与空串比较」，整条区间退化成「必须精确等于 0.1.0」。
    private static func joinSplitComparators(_ branch: String) -> [String] {
        let operators: Set<String> = [">=", "<=", ">", "<", "=", "^", "~"]
        var out: [String] = []
        let tokens = branch.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).map(String.init)
        var index = 0
        while index < tokens.count {
            let token = tokens[index]
            if operators.contains(token), index + 1 < tokens.count {
                out.append(token + tokens[index + 1])
                index += 2
            } else {
                out.append(token)
                index += 1
            }
        }
        return out
    }

    /// 预发布版本（`0.2.0-rc.9`）：冒号后第一段带 `-`。
    private static func hasPrerelease(_ version: String) -> Bool {
        let cleaned = stripVersionPrefix(version)
        return cleaned.split(separator: "+").first.map { $0.contains("-") } ?? false
    }

    private static func stripVersionPrefix(_ version: String) -> String {
        version.hasPrefix("v") ? String(version.dropFirst()) : version
    }

    /// 版本自身的 `major.minor.patch`（去掉预发布与构建元数据）。
    private static func versionBase(_ version: String) -> String {
        let cleaned = stripVersionPrefix(version)
        return cleaned.split(separator: "-", maxSplits: 1).first.map(String.init) ?? cleaned
    }

    /// `0.2.0-rc.9` 对 `<0.2.0` 应当判不满足：插件排除的就是 0.2 这一条线，
    /// 预发布只是它的更早快照，不是「还在 0.1 线内」。
    private static func crossesExclusiveUpperBound(_ version: String, _ atom: (op: String, value: String)) -> Bool {
        guard atom.op == "<" || atom.op == "<=" else { return false }
        guard hasPrerelease(version), !hasPrerelease(atom.value) else { return false }
        return versionBase(version) == versionBase(atom.value)
    }

    /// 读取一个 package.json 的 name/version/peerDependencies 与「有没有客户端半」
    /// （`dsh.client` 声明，缺失返回 nil）。
    static func packageManifest(at url: URL) -> (name: String?, version: String?, peers: [String: String], clientHalf: Bool)? {
        guard let data = try? Data(contentsOf: url),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        let peers = (object["peerDependencies"] as? [String: String]) ?? [:]
        let dsh = object["dsh"] as? [String: Any]
        let clientHalf = (dsh?["client"] as? [String: Any]) != nil
        return (object["name"] as? String, object["version"] as? String, peers, clientHalf)
    }

    /// 浏览器侧由 Harness 外壳提供的模块：客户端模块系统把插件的 `require('react')`
    /// 解析到外壳自己的实例（内置插件就是 `const React = require('react')`），跟
    /// node_modules 里有没有这个包无关。runtime 里查不到它们一点都不代表插件坏了。
    static let shellProvidedClientPeers: Set<String> = ["react", "react-dom"]

    /// peer 包的**实际解析位置**，按 Node 的顺序找：插件自己的 node_modules →
    /// profile 的 node_modules（`~/.dsh/profiles/web/node_modules`）→ profile 根的
    /// node_modules（pnpm 把公共依赖提升到这里）→ dsh runtime 的 node_modules。
    /// 只看 runtime 一个位置会把提升到 profile 的 peer 误报成「不存在」。
    /// - Returns: 找到的版本号；四处都没有返回 nil。
    static func resolvePeerVersion(_ peer: String, pluginURL: URL, profileModules: URL, runtimeModules: URL) -> String? {
        let profileRootModules = profileModules
            .deletingLastPathComponent()        // ~/.dsh/profiles/web
            .deletingLastPathComponent()        // ~/.dsh/profiles
            .appendingPathComponent("node_modules")
        let candidates = [
            pluginURL.appendingPathComponent("node_modules").appendingPathComponent(peer),
            profileModules.appendingPathComponent(peer),
            profileRootModules.appendingPathComponent(peer),
            runtimeModules.appendingPathComponent(peer),
        ]
        for candidate in candidates {
            if let version = packageManifest(at: candidate.appendingPathComponent("package.json"))?.version {
                return version
            }
        }
        return nil
    }

    /// 对已安装插件做静态兼容性扫描。broken 残留与 peer 区间不满足都算问题；
    /// peer 在 runtime 中不存在（API 被移除）也算问题。**启动器自带的内置插件
    /// （归档管理 / 插件管理 / 会话完成通知）一律跳过**，见 `bundledPluginNames`。
    ///
    /// **每个插件最多返回一条** Issue：一个插件常同时踩到两个 peer（实测
    /// `dsh-connect-workbuddy`：`@earendil-works/pi-ai` 版本超界 + `react` 在运行时里
    /// 不存在），一条问题一条 Issue 的写法会把同一插件在日志里列两遍、把「5 个插件
    /// 兼容性问题」这种本该报插件数的数字报大，用户在第一条弹窗里升级完还会为同一个
    /// 插件再弹一次。多条原因合并进 reason（`；` 分隔），一次说清。
    /// - Parameters:
    ///   - plugins: 插件管理器 /installed 接口的清单。
    ///   - profileModules: ~/.dsh/profiles/web/node_modules。
    ///   - runtimeModules: ~/.dsh/runtime/node_modules。
    static func scan(
        plugins: [InstalledPlugin],
        profileModules: URL,
        runtimeModules: URL
    ) -> [Issue] {
        var collected: [Issue] = []
        for plugin in plugins {
            // 内置插件不是用户能处置的对象：插件管理器通常标成 bundled；名字集合
            // 兜住旧接口/软链判定失败时的误标（那会让它们以 user 或 broken 出现）。
            guard plugin.source != "bundled", !bundledPluginNames.contains(plugin.name) else { continue }
            if plugin.broken == true {
                collected.append(Issue(
                    pluginName: plugin.name, version: plugin.version,
                    reason: "安装不完整或已损坏"
                ))
                continue
            }
            guard plugin.source == "user" else { continue }
            let packageURL = profileModules.appendingPathComponent(plugin.name)
            guard let manifest = packageManifest(at: packageURL.appendingPathComponent("package.json")),
                  !manifest.peers.isEmpty else { continue }
            for (peer, range) in manifest.peers.sorted(by: { $0.key < $1.key }) {
                // 浏览器侧的 react/react-dom 来自外壳，不是 node_modules（见
                // shellProvidedClientPeers）。实测 dsh-connect-workbuddy 工作正常，却因为
                // 「依赖的 react 在运行时中不存在」被报警、还提供「卸载插件」按钮——
                // 把能用的插件劝退，比漏报更糟。
                if manifest.clientHalf, shellProvidedClientPeers.contains(peer) { continue }
                guard let installed = resolvePeerVersion(
                    peer, pluginURL: packageURL, profileModules: profileModules, runtimeModules: runtimeModules
                ) else {
                    collected.append(Issue(
                        pluginName: plugin.name, version: plugin.version,
                        reason: "依赖的 \(peer)（\(range)）在当前 dsh 运行时中不存在"
                    ))
                    continue
                }
                if !satisfiesRange(installed, range: range) {
                    collected.append(Issue(
                        pluginName: plugin.name, version: plugin.version,
                        reason: "需要 \(peer) \(range)，当前为 \(installed)"
                    ))
                }
            }
        }
        return mergeByPlugin(collected)
    }

    /// 同一插件的多条问题合成一条：原因用 `；` 串起来，插件名只出现一次
    /// （日志行与弹窗都按插件计数）。顺序沿用首个问题的出现顺序，提示稳定。
    static func mergeByPlugin(_ issues: [Issue]) -> [Issue] {
        var merged: [Issue] = []
        var indexByName: [String: Int] = [:]
        for issue in issues {
            guard let index = indexByName[issue.pluginName] else {
                indexByName[issue.pluginName] = merged.count
                merged.append(issue)
                continue
            }
            let previous = merged[index]
            merged[index] = Issue(
                pluginName: previous.pluginName,
                version: previous.version ?? issue.version,
                reason: "\(previous.reason)；\(issue.reason)"
            )
        }
        return merged
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
