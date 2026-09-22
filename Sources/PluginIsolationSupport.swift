import Foundation

/// 插件隔离：dsh 因为某个插件起不来时，把它从下一次启动里禁用掉，保证服务能拉起来。
///
/// 为什么需要这一层：插件是 dsh 启动时按 `package.json` 的 `dsh.profile.bundles` 逐个
/// import 的，任何一个抛错整个进程就以退出码 1 结束——用户点「启动／重启」全都失败，
/// 而且插件管理器的 HTTP 接口随 dsh 一起死，没有任何在线恢复通道。
///
/// 隔离手段用的是 dsh 自己的 patch 覆盖层（`--patch <file>`，可重复、最后应用、优先级最高），
/// 条目语义是 `- id: <行 id>` + `disabled: true`：
/// - 不改 profile 的 `dependencies` 与 `dsh.profile.bundles`：那两处 `dsh plugin` 每次都会
///   reconcile 回来，改了反而会被覆盖；
/// - 不跑 pnpm、不删用户数据，恢复就是删掉一条记录；
/// - 只写启动器私有目录下的一个文件，卸载启动器即无痕。
///
/// 已知代价（如实告知用户，不做静默兜底）：禁用一个 group 行会连带禁掉它注入给别的
/// bundle 的服务，依赖它的行会以「pending (waiting for services: …)」再失败一次，
/// 那时由上层继续隔离下一个嫌疑插件或转入安全模式。
enum PluginIsolationSupport {
    /// 不许隔离的 bundle：dsh 本体与启动器自带的内置插件。把它们禁了等于把项目禁了。
    static let protectedBundles: Set<String> = [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-archive-manager",
        "dsh-plugin-manager",
        "dsh-session-notify"
    ]

    /// 一次启动会话里最多连续隔离几个插件，超过就不再逐个试、直接转安全模式。
    static let maxIsolationsPerBoot = 3

    struct IsolatedPlugin: Codable, Equatable {
        let bundle: String
        /// 该 bundle 在装配树里贡献的顶层行 id（隔离就是给这些行写 disabled）。
        let rowIds: [String]
        let reason: String
        let isolatedAt: String
    }

    /// 隔离状态文件名（JSON）与由它渲染出的 patch 文件名（YAML）。
    static let stateFileName = "plugin-isolation.json"
    static let patchFileName = "plugin-isolation.yml"

    // MARK: - 失败归因

    /// node_modules 之后的包名（含 @scope/name 两段式）。
    private static let packageFromPathRe = try! NSRegularExpression(
        pattern: #"node_modules/((?:@[^/"'\s]+/)?[^/"'\s]+)"#
    )
    /// loader 报错里的条目：`failed to import loader entry <id> (<包名或文件 URL>)`。
    private static let loaderEntryRe = try! NSRegularExpression(
        pattern: #"failed to (?:import|apply) loader entry (\S+) \(([^)]+)\)"#
    )
    /// pnpm/裸依赖缺失：`Cannot find package '<name>' imported from ...`。
    private static let missingPackageRe = try! NSRegularExpression(
        pattern: #"Cannot find package '([^']+)'"#
    )

    private static func firstMatch(in text: String, _ regex: NSRegularExpression, group: Int) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              let captured = Range(match.range(at: group), in: text) else { return nil }
        return String(text[captured])
    }

    private static func allMatches(in text: String, _ regex: NSRegularExpression, group: Int) -> [String] {
        let range = NSRange(text.startIndex..., in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            Range(match.range(at: group), in: text).map { String(text[$0]) }
        }
    }

    /// 从一段路径里取出包名（`…/node_modules/@a/b/shared/x.mjs` → `@a/b`）。
    static func packageName(fromPath path: String) -> String? {
        firstMatch(in: path, packageFromPathRe, group: 1)
    }

    /// dsh 启动失败的 stderr 里能不能认出是哪个包坏了。认不出就返回 nil（上层转安全模式，
    /// 绝不瞎猜——隔离错插件会让用户以为数据丢了）。
    /// 取最后一次出现：一个坏 bundle 会连带触发多条错误，最后一条才指向真正的导入方。
    static func attributedBundle(stderr: String, protected: Set<String> = protectedBundles) -> String? {
        let entries = allMatches(in: stderr, loaderEntryRe, group: 2)
        for raw in entries.reversed() {
            // 括号里可能是包名，也可能是 file:// 路径，两种都要能认。
            guard let name = raw.hasPrefix("file://") || raw.contains("node_modules/")
                ? packageName(fromPath: raw) : (raw.isEmpty ? nil : raw) else { continue }
            if !protected.contains(name) { return name }
        }
        if let pkg = firstMatch(in: stderr, missingPackageRe, group: 1), !protected.contains(pkg) { return pkg }
        // 兜底：ERR_MODULE_NOT_FOUND 的 url 字段指向谁，就是谁的锅。
        for url in allMatches(in: stderr, packageFromPathRe, group: 1).reversed() where !protected.contains(url) {
            return url
        }
        return nil
    }

    // MARK: - 行 id 提取

    /// 从 `dsh web --dump-config` 的输出里取某个 bundle **自己贡献**的顶层行 id。
    ///
    /// dump 用 `# == <包名>` 注释标注每段来源：`# == @openviking/dsh-memory-plugin` 是它
    /// 自己的行，`# == @deepseek-ai/dsh-base, patched by X` 是 X 打在别人身上的补丁行。
    /// 只取前者：禁别人的行不是「隔离这个插件」。嵌套条目（缩进的 `- id:`）由父 group
    /// 继承 disabled，因此只认顶格的条目。
    static func ownRowIds(fromDumpConfig dump: String, bundle: String) -> [String] {
        var ownSection = false
        var ids: [String] = []
        for line in dump.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("# == ") {
                let owners = line.dropFirst(5).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                // `patched by` 段里第一个包名是被改的那个，不是贡献者。
                ownSection = !line.contains("patched by") && owners.first == bundle
                continue
            }
            guard ownSection, line.hasPrefix("- id: ") else { continue }
            let id = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            if isSafeRowId(id) { ids.append(id) }
        }
        return ids
    }

    /// 回退路径：真实插件的 `cordis.patch.yml` 用 `- insert:` 块往里插自己的行
    /// （`- id:` 顶格写在 patch 里是「覆盖别人的行」，禁那种行等于拆别人的台），
    /// 所以这里只取 `insert:` 块里的 id。dump-config 拿不到时用它。
    static func insertedRowIds(fromPatchYAML yaml: String) -> [String] {
        var ids: [String] = []
        // nil = 不在 insert 块里；-1 = 在块里但还没遇到第一行；其余 = 第一行的缩进量。
        var anchor: Int?
        for line in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let indent = line.prefix(while: { $0 == " " }).count
            let body = line.dropFirst(indent)
            if body.isEmpty || body.hasPrefix("#") { continue }
            if indent == 0 {
                anchor = body.hasPrefix("- insert:") ? -1 : nil
                continue
            }
            guard body.hasPrefix("- id:"), let level = anchor else { continue }
            let id = body.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard isSafeRowId(id) else { continue }
            if level == -1 {
                anchor = indent
                ids.append(id)
            } else if indent == level {
                // 更深一层的是这条新行自己 config 里的子行，父行禁用即连带生效。
                ids.append(id)
            }
        }
        return ids
    }

    /// 行 id 会被写进 YAML，而它的来源是外部插件的输出——只放过保守字符集。
    static func isSafeRowId(_ id: Substring) -> Bool {
        !id.isEmpty && id.count <= 128 && id.allSatisfy { $0.isLetter || $0.isNumber || "_.:@/-".contains($0) }
    }

    static func isSafeRowId(_ id: String) -> Bool { isSafeRowId(Substring(id)) }

    // MARK: - patch 渲染与状态文件

    /// 渲染隔离 overlay。没有条目时返回空串，调用方据此**不传** `--patch`
    /// （dsh 对空 patch 文件与不存在的 patch 文件都是致命错误，绝不能把这种路径递给它）。
    ///
    /// patch 文件本身是一个顶格的 YAML 列表（真实插件写的是 `- insert:`，覆盖层写的是
    /// `- id:` + `disabled:`），所以条目必须从第 0 列开始——缩进会让它变成别人的 config。
    static func renderIsolationPatch(_ isolated: [IsolatedPlugin]) -> String {
        isolated.flatMap { entry in
            entry.rowIds.filter(isSafeRowId).map { "- id: \($0)\n  disabled: true\n" }
        }.joined()
    }

    /// 读状态文件。缺失／畸形一律按「没有隔离过」处理，绝不让恢复机制自己变成故障源。
    static func readState(url: URL) -> [IsolatedPlugin] {
        guard let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([IsolatedPlugin].self, from: data) else { return [] }
        return entries.filter { !$0.bundle.isEmpty && $0.rowIds.contains(where: isSafeRowId) && !protectedBundles.contains($0.bundle) }
    }

    /// 原子写（临时文件 + replace），失败返回 false 让调用方如实记日志。
    static func writeState(_ entries: [IsolatedPlugin], url: URL) -> Bool {
        guard let data = try? JSONEncoder.outputFormatCompatible(entries) else { return false }
        let staging = url.appendingPathExtension("tmp")
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: staging, options: .atomic)
            try FileManager.default.replaceItemAt(url, withItemAt: staging).map { _ in () }
            return true
        } catch {
            try? FileManager.default.removeItem(at: staging)
            return false
        }
    }

    /// 把 overlay 落盘并返回路径；没有条目时返回 nil（不传 --patch）。
    /// 写失败也返回 nil：宁可回到「没有隔离」的原始行为，也不递一个不存在/半截的文件给 dsh。
    static func stagedPatchFile(entries: [IsolatedPlugin], directory: URL) -> URL? {
        let text = renderIsolationPatch(entries)
        guard !text.isEmpty else { return nil }
        let url = directory.appendingPathComponent(patchFileName)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: .atomic)
            return url
        } catch { return nil }
    }

    // MARK: - 启动参数

    /// 常规启动参数。`isolationPatch` 为 nil 时保持与历史完全一致的一条命令。
    /// 两个 patch 路径都可能为 nil：dsh 对「不存在的 --patch 文件」是致命错误，
    /// 所以宁可少传一个 overlay，也绝不把不存在的路径递过去。
    static func bootArguments(port: Int, basePatch: String?, isolationPatch: String?) -> [String] {
        var arguments = ["web"]
        for path in [basePatch, isolationPatch] {
            if let path, !path.isEmpty { arguments += ["--patch", path] }
        }
        return arguments + ["--no-open", "--port", String(port)]
    }

    /// 安全模式：从随包分发的 web 模板新建一个只含 base + web-app 的 profile 起来。
    /// 不带任何 --patch（内置插件的 overlay 在这个 profile 里未必可解析，带上就可能连
    /// 安全模式都起不来），也不碰用户的 web profile。
    static func safeModeArguments(port: Int) -> [String] {
        ["--profile", "rescue", "--from-default-profile", "web", "--no-open", "--port", String(port)]
    }

    /// 把一个嫌疑包名落成一条隔离记录：优先用 dump-config 的权威映射，拿不到再退回
    /// 包自己 `cordis.patch.yml` 的顶层 id。两条路都找不到可禁的行就返回 nil——
    /// 写一条禁不掉任何东西的 overlay 只会让下次启动以同样的方式失败。
    static func isolationEntry(
        bundle: String,
        dumpConfig: String?,
        ownPatchYAML: String?,
        reason: String,
        isolatedAt: String
    ) -> IsolatedPlugin? {
        guard !protectedBundles.contains(bundle) else { return nil }
        var rowIds = dumpConfig.map { ownRowIds(fromDumpConfig: $0, bundle: bundle) } ?? []
        if rowIds.isEmpty {
            rowIds = ownPatchYAML.map { insertedRowIds(fromPatchYAML: $0) } ?? []
        }
        let safe = rowIds.filter(isSafeRowId)
        guard !safe.isEmpty else { return nil }
        return IsolatedPlugin(bundle: bundle, rowIds: safe, reason: reason, isolatedAt: isolatedAt)
    }

    // MARK: - 恢复决策

    enum RecoveryDecision: Equatable {
        /// 隔离这个 bundle 后重试；rowIds 由调用方去 dump-config／包内 patch 解析。
        case isolate(bundle: String)
        /// 认不出嫌疑对象，或隔离额度用尽 → 安全模式。
        case safeMode(reason: String)
        /// 连安全模式都不该再自动尝试（比如刚因安全模式失败过）。
        case giveUp(reason: String)
    }

    /// 纯决策：给定这次失败的归因结果与本次会话已经隔离过什么，下一步做什么。
    static func decideRecovery(
        attributed: String?,
        alreadyIsolated: Set<String>,
        isolationsThisBoot: Int,
        maxIsolations: Int = maxIsolationsPerBoot
    ) -> RecoveryDecision {
        guard let attributed, !attributed.isEmpty else {
            return .safeMode(reason: "无法从启动日志里确定是哪个插件导致失败")
        }
        if alreadyIsolated.contains(attributed) {
            return .safeMode(reason: "\(attributed) 已被隔离过，仍然起不来")
        }
        guard isolationsThisBoot < maxIsolations else {
            return .safeMode(reason: "本次启动已连续隔离 \(isolationsThisBoot) 个插件")
        }
        return .isolate(bundle: attributed)
    }
}

private extension JSONEncoder {
    /// 带缩进的可读输出（状态文件人要看，也要能手改）。
    static func outputFormatCompatible<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(value)
    }
}
