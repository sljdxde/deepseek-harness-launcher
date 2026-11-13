import Foundation

/// 用户停用插件与 dsh 启动参数。
///
/// 启动器**不会**自动隔离/跳过/回退插件：dsh 起不来时只如实报错，不改用户的
/// profile。历史上那套「stderr 归因 → 逐个排除 → 安全模式 → 启动前静态预检」的
/// 纯函数与单测已整体删除（主流程 0 调用，留着只会让插件相关改动维护两套语义）。
///
/// 现在只剩两件主流程真会用到的事：
/// - `bootArguments(...)`：拼 `dsh web --patch ... --no-open --port ...`；
/// - 用户在插件管理面板里明确停用的插件（`plugin-manager/disabled.json`），
///   渲染成启动器自己的 `--patch` overlay（`disabled: true`）。
///
/// overlay 必须是顶格 YAML 列表；没有停用项或写失败时返回 nil，绝不把空文件/
/// 不存在的路径递给 dsh（dsh 对这两种都是致命错误）。
enum PluginIsolationSupport {
    /// 用户在插件管理面板里「停用」的插件。
    struct DisabledPlugin: Codable, Equatable {
        let bundle: String
        /// 该 bundle 在装配树里贡献的顶层行 id（面板服务端从 dump-config 发现）。
        let rowIds: [String]
        let disabledAt: String?
    }

    /// 面板不允许停用的 bundle：core 两层与插件管理器自身。服务端也会拦，
    /// 这里再兜一次——状态文件可能被手改。
    static let undisableableBundles: Set<String> = [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-manager"
    ]

    /// 用户停用状态与 overlay 的落点（都在 `$DSH_HOME/plugin-manager/` 下）。
    static let disabledStateFileName = "disabled.json"
    static let disabledPatchFileName = "plugin-disabled.yml"
    static let disabledStateDirectoryName = "plugin-manager"

    static func disabledStateURL(home: URL) -> URL {
        home.appendingPathComponent(disabledStateDirectoryName, isDirectory: true)
            .appendingPathComponent(disabledStateFileName)
    }

    static func disabledPatchDirectory(home: URL) -> URL {
        home.appendingPathComponent(disabledStateDirectoryName, isDirectory: true)
    }

    /// 行 id 会被写进 YAML，来源是外部插件输出：只放过保守字符集。
    static func isSafeRowId(_ id: Substring) -> Bool {
        !id.isEmpty && id.count <= 128 && id.allSatisfy { $0.isLetter || $0.isNumber || "_.:@/-".contains($0) }
    }

    static func isSafeRowId(_ id: String) -> Bool { isSafeRowId(Substring(id)) }

    /// bundle 名来自状态文件（可能被手改）：只认 npm 包名形状，且拒绝路径穿越。
    static func isSafeBundleName(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 128 && !name.contains("..")
            && name.allSatisfy { $0.isLetter || $0.isNumber || "_.@/-".contains($0) }
    }

    /// 状态文件只解码、不渲染；任何畸形字段一律丢弃——停用状态坏掉时宁可「全部启用」，
    /// 也不能让用户连 dsh 都起不来。不可停用的 bundle 在这里再兜一次。
    static func readDisabledState(url: URL) -> [DisabledPlugin] {
        guard let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(DisabledStateFile.self, from: data) else { return [] }
        var seen = Set<String>()
        return file.disabled.compactMap { entry in
            guard isSafeBundleName(entry.bundle),
                  !undisableableBundles.contains(entry.bundle),
                  seen.insert(entry.bundle).inserted else { return nil }
            let safeIds = entry.rowIds.filter(isSafeRowId)
            guard !safeIds.isEmpty else { return nil }
            return DisabledPlugin(bundle: entry.bundle, rowIds: safeIds, disabledAt: entry.disabledAt)
        }
    }

    /// 把用户停用项渲染成一个 overlay，按行 id 去重。
    static func renderCombinedDisabledPatch(disabled: [DisabledPlugin]) -> String {
        var seen = Set<String>()
        var ids: [String] = []
        for entry in disabled where !undisableableBundles.contains(entry.bundle) {
            for id in entry.rowIds where isSafeRowId(id) && seen.insert(id).inserted { ids.append(id) }
        }
        return ids.map { "- id: \($0)\n  disabled: true\n" }.joined()
    }

    /// 落盘 overlay；没有可停用的行时返回 nil，写失败也返回 nil。
    static func stagedDisabledPatchFile(
        disabled: [DisabledPlugin],
        directory: URL
    ) -> URL? {
        let text = renderCombinedDisabledPatch(disabled: disabled)
        guard !text.isEmpty else { return nil }
        let url = directory.appendingPathComponent(disabledPatchFileName)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: .atomic)
            return url
        } catch { return nil }
    }

    /// 常规启动参数。顺序即优先级：`--patch` 后应用的覆盖最后生效，所以用户停用层
    /// 排在最后。某个路径为 nil/空时直接跳过——dsh 对「不存在的 --patch 文件」是
    /// 致命错误，宁可少传一个 overlay，也绝不把不存在的路径递过去。
    static func bootArguments(
        port: Int,
        basePatch: String?,
        disabledPatch: String? = nil
    ) -> [String] {
        var arguments = ["web"]
        for path in [basePatch, disabledPatch] {
            if let path, !path.isEmpty { arguments += ["--patch", path] }
        }
        return arguments + ["--no-open", "--port", String(port)]
    }
}

/// `disabled.json` 的外层结构：版本与时间戳供人排查，读取时只关心 disabled。
private struct DisabledStateFile: Decodable {
    let version: Int?
    let updatedAt: String?
    let disabled: [PluginIsolationSupport.DisabledPlugin]
}
