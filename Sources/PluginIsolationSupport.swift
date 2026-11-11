import Foundation

/// 【部分已停用】启动器**不会**再自动隔离/跳过/回退插件，dsh 启动失败时只如实记
/// 日志并报错；本文件与 Sources/PluginSourceCheck.swift 的纯函数及对应单测保留，
/// 仅为复用与语义回归。主流程现在用到的是两件事：
/// - bootArguments(...) 的三个 --patch 槽位（内置插件补丁 / 崩溃隔离(恒 nil) / 用户停用）；
/// - 用户在插件管理面板里明确停用的插件（`plugin-manager/disabled.json`，见下方
///   “用户停用”一节）与合并渲染逻辑。
/// 下方是原“崩溃隔离”的设计说明（历史口径，主流程已不自动执行）。
///
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

    /// 用户在插件管理面板里「停用」的插件。与上面的崩溃隔离**状态文件分开**：
    /// 崩溃隔离是启动器自动行为，用户停用是用户的明确意图，两者不能互相覆盖。
    /// 它们最终合并进同一个 --patch overlay（渲染时按行 id 去重）。
    struct DisabledPlugin: Codable, Equatable {
        let bundle: String
        /// 该 bundle 在装配树里贡献的顶层行 id（面板服务端从 dump-config 发现）。
        let rowIds: [String]
        let disabledAt: String?
    }

    /// 面板不允许停用的 bundle：core 两层与插件管理器自身。
    /// 注意这套清单**不是** `protectedBundles`（后者还含内置插件，是崩溃隔离的口径：
    /// 内置插件不自动隔离，但允许用户主动停用）。
    static let undisableableBundles: Set<String> = [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-manager"
    ]

    /// 用户停用状态与 overlay 的落点（都在 `$DSH_HOME/plugin-manager/` 下）。
    static let disabledStateFileName = "disabled.json"
    static let disabledPatchFileName = "plugin-disabled.yml"
    static let disabledStateDirectoryName = "plugin-manager"

    /// 接管型插件：生效时会顶掉某些官方行（写在自己 `cordis.patch.yml` 的
    /// `disabled: true` 里）。用户在面板里停用它时，必须把被顶掉的行放回来，
    /// 否则停用后界面上会永久缺一块（侧栏 Deck 就是这种插件：它接管左侧栏时
    /// 停用官方 `ui-sidebar`，停用 Deck 必须把官方侧栏启用回来）。
    ///
    /// 覆盖层排在最后，`disabled: false` 的重新启用条目追加在所有停用条目之后，
    /// 因此优先级最高。对没装 Deck 的部署，这条是幂等的 no-op。
    static let replacementRows: [String: [String]] = [
        "dsh-sidebar-deck": ["ui-sidebar"]
    ]

    /// 侧栏 Deck（自带布局插件）。它在 launcher 里不是 profile bundle，而是像归档
    /// 插件一样「链接进 node_modules + 由启动器补丁插入」；插入时同时停用官方侧栏
    /// 外壳。只有 Deck 资源就绪、且用户没在面板里停用它时才传这份补丁——任何一环
    /// 不满足都退回官方侧栏（失败开放，不制造白屏）。
    static let sidebarDeckBundle = "dsh-sidebar-deck"
    static let sidebarDeckPatchFileName = "sidebar-deck.yml"

    static func renderSidebarDeckPatch() -> String {
        """
        - id: ui-sidebar
          disabled: true
        - insert:
            - id: dsh-sidebar-deck
              name: 'dsh-sidebar-deck'
        """ + "\n"
    }

    /// 写 Deck 接管补丁；写失败返回 nil（调用方不传 --patch，官方侧栏照常工作）。
    static func stagedSidebarDeckPatchFile(directory: URL) -> URL? {
        let url = directory.appendingPathComponent(sidebarDeckPatchFileName)
        let text = renderSidebarDeckPatch()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: .atomic)
            return url
        } catch { return nil }
    }

    static func isSidebarDeckDisabled(in disabled: [DisabledPlugin]) -> Bool {
        disabled.contains { $0.bundle == sidebarDeckBundle }
    }

    /// 不可停用的原因（UI 的 tooltip 与服务端错误共用同一套口径）。
    static func undisableableReason(for bundle: String) -> String? {
        switch bundle {
        case "@deepseek-ai/dsh-base": return "dsh 核心层，停用后 Harness 无法启动"
        case "@deepseek-ai/dsh-web-app": return "dsh Web 界面层，停用后没有可用的 Harness 界面"
        case "dsh-plugin-manager": return "插件管理器自身，停用后无法从界面恢复"
        default: return nil
        }
    }

    static func disabledStateURL(home: URL) -> URL {
        home.appendingPathComponent(disabledStateDirectoryName, isDirectory: true)
            .appendingPathComponent(disabledStateFileName)
    }

    static func disabledPatchDirectory(home: URL) -> URL {
        home.appendingPathComponent(disabledStateDirectoryName, isDirectory: true)
    }

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

    /// stderr 里出现过的 loader entry 行 id，最后出现的排最前。
    /// 括号里是 `@deepseek-ai/cordis-plugin-group` 这类公共 group 时，包名给不出凶手，
    /// 但行 id 能——调用方拿 dump-config 的「bundle → 自己的行」映射反查即可。
    static func attributedRowIds(stderr: String) -> [String] {
        var seen = Set<String>()
        var ids: [String] = []
        for raw in allMatches(in: stderr, loaderEntryRe, group: 1).reversed() where isSafeRowId(raw) {
            if seen.insert(raw).inserted { ids.append(raw) }
        }
        return ids
    }

    /// 整份 dump-config → 每个 bundle 自己贡献的顶层行 id。一次解析，供整个恢复流程用。
    static func bundleRowIds(fromDumpConfig dump: String) -> [String: [String]] {
        var map: [String: [String]] = [:]
        var bundle: String?
        for line in dump.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("# == ") {
                let owners = line.dropFirst(5).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                bundle = (!line.contains("patched by") && !(owners.first ?? "").isEmpty) ? owners.first : nil
                continue
            }
            guard let owner = bundle, line.hasPrefix("- id: ") else { continue }
            let id = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
            if isSafeRowId(id) { map[owner, default: []].append(id) }
        }
        return map
    }

    /// 用行 id 反查它属于哪个 bundle（多个命中时取第一个）。
    static func bundleOwning(rowId: String, in rowsByBundle: [String: [String]]) -> String? {
        rowsByBundle.keys.sorted().first { rowsByBundle[$0]?.contains(rowId) == true }
    }

    /// profile 里用户可以被隔离的 bundle：排掉 dsh 自身的 core 层与启动器内置插件。
    /// 这些是「坏一个就整体起不来」的候选集，也是隔离预算的上限。
    static func isolatableBundles(fromProfileManifest json: String, protected: Set<String> = protectedBundles) -> [String] {
        guard let data = json.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let profile = (object["dsh"] as? [String: Any])?["profile"] as? [String: Any],
              let bundles = profile["bundles"] as? [Any] else { return [] }
        return bundles.compactMap { $0 as? String }.filter { !protected.contains($0) }
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
            // `@deepseek-ai/*` 与内置插件都是公共层：报错指到它们，真正的凶手是那一行
            // （由 attributedRowIds + dump-config 反查），不能把它们自己当嫌疑对象。
            if protected.contains(name) || name.hasPrefix("@deepseek-ai/") { continue }
            return name
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

    // MARK: - 用户停用（面板写入、启动器读取）

    /// bundle 名来自状态文件（可能被手改）：只认 npm 包名形状，且拒绝路径穿越。
    static func isSafeBundleName(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 128 && !name.contains("..")
            && name.allSatisfy { $0.isLetter || $0.isNumber || "_.@/-".contains($0) }
    }

    /// 状态文件只解码、不渲染；任何畸形字段一律丢弃——停用状态坏掉时宁可“全部启用”，
    /// 也不能让用户连 dsh 都起不来。不可停用的 bundle 在这里再兜一次（服务端也会拦）。
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

    /// 把「崩溃隔离」与「用户停用」合并成一个 overlay，按行 id 去重。
    ///
    /// 冲突取舍：用户停用**优先**（它的行 id 先收进来，且启动参数里它的 --patch 排在
    /// 最后、优先级最高）；崩溃隔离即使想保留同一行也只是写同样的 disabled: true，
    /// 不存在“隔离救回一个用户明确要停用的插件”这种语义。反过来，用户停用别的行
    /// 不影响崩溃隔离救场——两个来源的其余行都保留。
    static func renderCombinedDisabledPatch(isolation: [IsolatedPlugin], disabled: [DisabledPlugin]) -> String {
        var seen = Set<String>()
        var ids: [String] = []
        func collect(_ rowIds: [String]) {
            for id in rowIds where isSafeRowId(id) && seen.insert(id).inserted { ids.append(id) }
        }
        for entry in disabled where !undisableableBundles.contains(entry.bundle) { collect(entry.rowIds) }
        for entry in isolation where !protectedBundles.contains(entry.bundle) { collect(entry.rowIds) }
        // 接管型插件被停用：把它顶掉的官方行重新启用（见 replacementRows）。
        var reenableIds: [String] = []
        for entry in disabled {
            for rowId in replacementRows[entry.bundle] ?? [] where isSafeRowId(rowId) && !reenableIds.contains(rowId) {
                reenableIds.append(rowId)
            }
        }
        let disableText = ids.map { "- id: \($0)\n  disabled: true\n" }.joined()
        let reenableText = reenableIds.map { "- id: \($0)\n  disabled: false\n" }.joined()
        return disableText + reenableText
    }

    /// 落盘合并后的 overlay；没有可停用的行时返回 nil（调用方据此不传 --patch）。
    /// 写失败也返回 nil：宁可回到“一个插件都不停用”的原始行为，也不递半截文件给 dsh。
    static func stagedDisabledPatchFile(
        isolation: [IsolatedPlugin] = [],
        disabled: [DisabledPlugin],
        directory: URL
    ) -> URL? {
        let text = renderCombinedDisabledPatch(isolation: isolation, disabled: disabled)
        guard !text.isEmpty else { return nil }
        let url = directory.appendingPathComponent(disabledPatchFileName)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: .atomic)
            return url
        } catch { return nil }
    }

    // MARK: - 启动参数

    /// 常规启动参数。三个 patch 槽位都为空时保持与历史完全一致的一条命令。
    /// 顺序即优先级：`--patch` 后应用的覆盖最后生效，所以用户停用层排在最后；
    /// 某个路径为 nil/空时直接跳过——dsh 对「不存在的 --patch 文件」是致命错误，
    /// 宁可少传一个 overlay，也绝不把不存在的路径递过去。
    static func bootArguments(
        port: Int,
        basePatch: String?,
        deckPatch: String? = nil,
        isolationPatch: String?,
        disabledPatch: String? = nil
    ) -> [String] {
        var arguments = ["web"]
        for path in [basePatch, deckPatch, isolationPatch, disabledPatch] {
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
        rowIds: [String],
        reason: String,
        isolatedAt: String
    ) -> IsolatedPlugin? {
        guard !protectedBundles.contains(bundle) else { return nil }
        let safe = rowIds.filter(isSafeRowId)
        guard !safe.isEmpty else { return nil }
        return IsolatedPlugin(bundle: bundle, rowIds: safe, reason: reason, isolatedAt: isolatedAt)
    }

    // MARK: - 恢复决策

    enum RecoveryDecision: Equatable {
        /// 隔离这个 bundle 后重试（行 id 由调用方从 dump 映射或包内 patch 取得）。
        case isolate(bundle: String, source: IsolationSource)
        /// 候选集已经全部隔离过还是起不来 → 安全模式。
        case safeMode(reason: String)
        /// 连安全模式都不该再自动尝试（比如刚因安全模式失败过）。
        case giveUp(reason: String)
    }

    /// 这次隔离是谁提出来的，写进状态文件供用户看明白。
    enum IsolationSource: String, Equatable {
        case stderrBundle = "启动日志点名的插件"
        case stderrRow = "启动日志点名的插件行"
        case bisect = "逐个排除"
        case preflight = "启动前预检"
    }

    struct RecoveryInput: Equatable {
        /// stderr 直接认出来的包名。
        var attributedBundle: String?
        /// stderr 里的 loader 行 id（包名认不出时的线索，已按"最后出现优先"排序）。
        var attributedRowIds: [String]
        /// 行 id → bundle 的映射结果（调用方用 bundleRowIds(fromDumpConfig:) 预先算好）。
        var rowIdOwners: [String]
        /// profile 里可隔离的第三方 bundle，按 manifest 顺序。
        var candidateBundles: [String]
        var isolatedBundles: Set<String>
        var isolationsThisBoot: Int

        var isEmpty: Bool { attributedBundle == nil && rowIdOwners.isEmpty && candidateBundles.isEmpty }
    }

    /// 恢复阶梯：DSH 必须起来，插件能留多少留多少。
    ///
    /// 1. 日志点名了哪个包 → 只禁它；
    /// 2. 只点名了行（括号里是 `@deepseek-ai/cordis-plugin-group` 这类公共 group）→ 用
    ///    dump-config 的行归属反查到 bundle；
    /// 3. 什么都认不出（dsh 升级后最常见的插件 init 报错，stderr 里没有包名也没有行 id）→
    ///    **按候选列表逐个排除**：每次只多禁一个，失败退出只要几秒，代价是几次快速重试，
    ///    换来的是"只禁掉真正坏的那一个"，而不是一把全砍；
    /// 4. 第三方全禁完还不行 → 安全模式（连内置插件与 --patch 都不带）。
    static func decideRecovery(_ input: RecoveryInput) -> RecoveryDecision {
        if let bundle = input.attributedBundle, !input.isolatedBundles.contains(bundle) {
            return .isolate(bundle: bundle, source: .stderrBundle)
        }
        for owner in input.rowIdOwners where !input.isolatedBundles.contains(owner) {
            return .isolate(bundle: owner, source: .stderrRow)
        }
        for bundle in input.candidateBundles where !input.isolatedBundles.contains(bundle) {
            return .isolate(bundle: bundle, source: .bisect)
        }
        if input.isEmpty {
            return .safeMode(reason: "没有可隔离的第三方插件，dsh 本体或内置插件出了问题")
        }
        return .safeMode(
            reason: "已隔离 \(input.isolatedBundles.count) 个插件仍起不来：\(input.isolatedBundles.sorted().joined(separator: ", "))"
        )
    }

    // MARK: - 启动前预检

    /// 预检要扫的 bundle 目录（profile 的 node_modules 下）。
    static func bundleDirectory(for bundle: String, profileModules: String) -> String {
        "\(profileModules)/\(bundle)"
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

/// `disabled.json` 的外层结构：版本与时间戳供人排查，读取时只关心 disabled。
private struct DisabledStateFile: Decodable {
    let version: Int?
    let updatedAt: String?
    let disabled: [PluginIsolationSupport.DisabledPlugin]
}
