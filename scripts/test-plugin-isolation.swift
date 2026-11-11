import Foundation

// 插件隔离与启动恢复的判定（见 Sources/PluginIsolationSupport.swift）。
//
// 锚点是一次真实故障：@openviking/dsh-memory-plugin 0.5.0 的 shared/ 不在 git 里，
// 子目录克隆装出来缺模块，dsh 启动即以退出码 1 结束，用户点启动/重启全部失败。
// 这里的用例锁住三件事：能从那种 stderr 里认出是谁干的、认不出时绝不瞎隔离、
// 以及隔离后的启动命令在没有隔离项时与历史命令逐字节一致。
//
// 编译：swiftc scripts/test-plugin-isolation.swift Sources/PluginIsolationSupport.swift Sources/PluginSourceCheck.swift

@main
struct PluginIsolationTests {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func checkEqual<T: Equatable>(_ lhs: T, _ rhs: T, _ message: String) {
        if lhs != rhs { failures.append("\(message)：实际 \(lhs)，期望 \(rhs)") }
    }

    /// 2026-09-22 事故日志里的真实 stderr（截掉与判定无关的行）。
    static let realIncidentStderr = """
    (node:86928) ExperimentalWarning: SQLite is an experimental feature and might change at any time
    Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to apply loader entry openviking-memory (@deepseek-ai/cordis-plugin-group): failed to import loader entry openviking-memory-runtime (@openviking/dsh-memory-plugin): Cannot find module '/Users/yuzhou/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin/shared/ov-http.mjs' imported from /Users/yuzhou/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin/client.mjs
        at finalizeResolution (node:internal/modules/esm/resolve:275:11)
      code: 'ERR_MODULE_NOT_FOUND',
      url: 'file:///Users/yuzhou/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin/shared/ov-http.mjs'
    }
    Node.js v22.23.2
    """

    /// `dsh web --dump-config` 的真实片段：自己的 group 行、别人身上的补丁行、嵌套子行。
    static let realDumpConfig = """
    # == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app
      - id: web-settings
        name: '@deepseek-ai/dsh-settings-web'
    # == @openviking/dsh-memory-plugin
    - id: openviking-memory
      name: '@deepseek-ai/cordis-plugin-group'
      group: true
      isolate:
        openvikingMemory: true
      config:
        - id: openviking-memory-runtime
          name: '@openviking/dsh-memory-plugin'
    # == @tt-a1i/archify-dsh
    - id: archify-skill-filesystem
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: archify-plugin
    # == @deepseek-ai/dsh-base, patched by @tt-a1i/archify-dsh
    - id: agent
      name: '@deepseek-ai/dsh-agent'
    """

    static func main() {
        let support = PluginIsolationSupport.self

        // MARK: - 失败归因

        checkEqual(
            support.attributedBundle(stderr: realIncidentStderr) ?? "nil",
            "@openviking/dsh-memory-plugin",
            "真实事故 stderr 应认出坏插件"
        )
        checkEqual(
            support.attributedBundle(stderr: "failed to import loader entry row-a (file:///x/node_modules/@scope/pkg/entry.mjs)") ?? "nil",
            "@scope/pkg",
            "loader 条目括号里是 file URL 时按路径取包名"
        )
        checkEqual(
            support.attributedBundle(stderr: "failed to import loader entry row-a (file:///x/node_modules/plain-pkg/entry.mjs)") ?? "nil",
            "plain-pkg",
            "非 scoped 包名也要取对"
        )
        checkEqual(
            support.attributedBundle(stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'some-dep' imported from /x/index.mjs") ?? "nil",
            "some-dep",
            "缺整包时按包名归因"
        )
        check(
            support.attributedBundle(stderr: realIncidentStderr).map { !$0.isEmpty } == true,
            "归因结果不应为空串"
        )
        check(
            support.attributedBundle(stderr: "failed to import loader entry x (@deepseek-ai/dsh-base)") == nil,
            "内置 base 不许被隔离"
        )
        check(
            support.attributedBundle(stderr: "failed to import loader entry x (dsh-plugin-manager)") == nil,
            "插件管理器自身不许被隔离"
        )
        check(
            support.attributedBundle(stderr: "(node:1) Warning: something unrelated\nServer listening") == nil,
            "认不出来时返回 nil，交给上层转安全模式"
        )
        checkEqual(
            support.attributedBundle(stderr: """
            failed to import loader entry a (@first/pkg)
            failed to import loader entry b (@second/pkg)
            """) ?? "nil",
            "@second/pkg",
            "多条错误取最后一条（前面的多是连带失败）"
        )
        checkEqual(
            support.attributedBundle(
                stderr: "failed to import loader entry a (@deepseek-ai/dsh-base)\nfailed to import loader entry b (@user/pkg)",
                protected: support.protectedBundles
            ) ?? "nil",
            "@user/pkg",
            "内置嫌疑要跳过、继续找下一个可隔离的"
        )
        checkEqual(support.packageName(fromPath: "/a/b/node_modules/@scope/name/shared/x.mjs") ?? "nil", "@scope/name", "路径取包名")
        checkEqual(support.packageName(fromPath: "/a/b/no-node-modules/x.mjs") ?? "nil", "nil", "没有 node_modules 段时不猜包名")

        // MARK: - 行 id 提取

        checkEqual(support.ownRowIds(fromDumpConfig: realDumpConfig, bundle: "@openviking/dsh-memory-plugin").joined(separator: ","), "openviking-memory", "只取自己贡献的顶层行（嵌套子行由父 group 继承 disabled）")
        checkEqual(support.ownRowIds(fromDumpConfig: realDumpConfig, bundle: "@tt-a1i/archify-dsh").joined(separator: ","), "archify-skill-filesystem", "`patched by` 段里的行不算自己的")
        check(support.ownRowIds(fromDumpConfig: realDumpConfig, bundle: "no-such-bundle").isEmpty, "bundle 不在树里时返回空（调用方据此放弃隔离）")

        // 真实插件的 patch 形状（@openviking/dsh-memory-plugin 与 dsh-notify 都是这个写法）。
        checkEqual(
            support.insertedRowIds(fromPatchYAML: """
            - insert:
                - id: openviking-memory
                  name: '@deepseek-ai/cordis-plugin-group'
                  group: true
                  config:
                    - id: openviking-memory-runtime
                      name: '@openviking/dsh-memory-plugin'
            """).joined(separator: ","),
            "openviking-memory",
            "只取 insert 块里的新行，嵌套子行不取（父 group 已连带禁用）"
        )
        checkEqual(
            support.insertedRowIds(fromPatchYAML: """
            - id: agent
              config:
                model: deepseek-flash
            - insert:
                - id: my-row
            - id: session
              disabled: false
            """).joined(separator: ","),
            "my-row",
            "顶格 `- id:` 是在改别人的行，隔离绝不能碰"
        )
        check(support.isSafeRowId("openviking-memory"), "常规 id 放行")
        check(!support.isSafeRowId("a\n  disabled: true\n- id: b"), "换行注入拒绝（行 id 来自外部输出，会被写进 YAML）")
        check(!support.isSafeRowId("id: with spaces"), "含空格拒绝")
        check(!support.isSafeRowId("quote'key"), "引号拒绝")
        check(!support.isSafeRowId(""), "空 id 拒绝")
        check(!support.isSafeRowId(String(repeating: "a", count: 129)), "超长 id 拒绝")

        // MARK: - overlay 渲染与启动参数

        let openviking = support.IsolatedPlugin(
            bundle: "@openviking/dsh-memory-plugin",
            rowIds: ["openviking-memory", "bad\ninjected"],
            reason: "ERR_MODULE_NOT_FOUND",
            isolatedAt: "2026-09-22T12:00:00Z"
        )
        checkEqual(
            support.renderIsolationPatch([openviking]),
            "- id: openviking-memory\n  disabled: true\n",
            "overlay 必须是顶格 YAML 列表（缩进会被读成别人的 config），并过滤不安全 id"
        )
        checkEqual(support.renderIsolationPatch([]), "", "没有隔离项时渲染空串（调用方据此不传 --patch）")

        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/App/DSHArchiveManager/cordis.patch.yml", isolationPatch: nil).joined(separator: " "),
            "web --patch /App/DSHArchiveManager/cordis.patch.yml --no-open --port 3080",
            "没有隔离项时启动命令与历史完全一致（不许改变现有行为）"
        )
        checkEqual(
            support.bootArguments(port: 3081, basePatch: "/base.yml", isolationPatch: "/iso.yml").joined(separator: " "),
            "web --patch /base.yml --patch /iso.yml --no-open --port 3081",
            "隔离 overlay 作为第二个 --patch，且排在透传给 app 的参数之前"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: nil, isolationPatch: "/iso.yml").joined(separator: " "),
            "web --patch /iso.yml --no-open --port 3080",
            "内置插件的 patch 文件缺失时不传它（缺失路径对 dsh 是致命错误）"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: nil, isolationPatch: nil).joined(separator: " "),
            "web --no-open --port 3080",
            "两个 patch 都没有时退化成最小命令，仍然不传 --patch"
        )
        checkEqual(support.safeModeArguments(port: 3099).joined(separator: " "), "--profile rescue --from-default-profile web --no-open --port 3099", "安全模式不带任何 --patch")

        // MARK: - 状态文件

        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("dhl-isolation-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: tmp) }
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let stateURL = tmp.appendingPathComponent(support.stateFileName)

        check(support.readState(url: stateURL).isEmpty, "状态文件不存在时按空处理")
        check(support.writeState([openviking], url: stateURL), "写状态文件应成功")
        checkEqual(support.readState(url: stateURL).count, 1, "写后读回一条")
        checkEqual(support.readState(url: stateURL).first?.rowIds.joined(separator: ",") ?? "nil", "openviking-memory,bad\ninjected", "状态文件保留原始记录（渲染时再过滤）")

        try? "[not json".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "畸形状态文件按空处理，恢复机制自己不能变成故障源")
        try? "[{\"bundle\":\"dsh-plugin-manager\",\"rowIds\":[\"x\"],\"reason\":\"r\",\"isolatedAt\":\"t\"}]".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "内置插件的隔离记录直接丢弃（可能被手改过）")
        try? "[{\"bundle\":\"\",\"rowIds\":[\"x\"],\"reason\":\"r\",\"isolatedAt\":\"t\"}]".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "空 bundle 名丢弃")
        try? "[{\"bundle\":\"a\",\"rowIds\":[\"\"],\"reason\":\"r\",\"isolatedAt\":\"t\"}]".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "没有安全行 id 的记录丢弃（等于隔离无效）")

        check(support.stagedPatchFile(entries: [], directory: tmp) == nil, "没有隔离项时不产出 patch 文件（dsh 对空文件与缺失文件都是致命错误）")
        let staged = support.stagedPatchFile(entries: [openviking], directory: tmp)
        check(staged?.lastPathComponent == support.patchFileName, "有隔离项时产出 overlay 文件")
        check((staged.flatMap { try? String(contentsOf: $0, encoding: .utf8) })?.isEmpty == false, "overlay 文件内容非空")
        check(
            support.stagedPatchFile(entries: [openviking], directory: URL(fileURLWithPath: "/System/Library/CoreFinder/x")) == nil,
            "写不进去时返回 nil（宁可回到没有隔离的原始行为，也不递半截文件给 dsh）"
        )

        // MARK: - 行归属映射与逐个排除阶梯

        let rowsMap = support.bundleRowIds(fromDumpConfig: realDumpConfig)
        checkEqual(rowsMap["@openviking/dsh-memory-plugin"]?.joined(separator: ",") ?? "nil", "openviking-memory", "dump 一次解析出全部 bundle 的行")
        checkEqual(rowsMap["@tt-a1i/archify-dsh"]?.joined(separator: ",") ?? "nil", "archify-skill-filesystem", "别的 bundle 的行也要收进来")
        check((rowsMap["@deepseek-ai/dsh-base"] ?? []).isEmpty, "`patched by` 段不该被算成谁的新行")
        checkEqual(support.bundleOwning(rowId: "openviking-memory-runtime", in: rowsMap) ?? "nil", "nil", "别人的子行不认，避免误禁")
        checkEqual(support.bundleOwning(rowId: "archify-skill-filesystem", in: rowsMap) ?? "nil", "@tt-a1i/archify-dsh", "行 id 反查归属")

        checkEqual(
            support.attributedRowIds(stderr: "failed to import loader entry openviking-memory-runtime (@openviking/dsh-memory-plugin)\nfailed to apply loader entry archify-row (x)").joined(separator: ","),
            "archify-row,openviking-memory-runtime",
            "行 id 按最后出现优先（后面的才是真正没起来的行）"
        )
        check(
            support.attributedRowIds(stderr: "failed to import loader entry bad\nid:\n  disabled: true (x)").isEmpty,
            "不安全字符的行 id 直接丢弃（会被写进 YAML）"
        )
        checkEqual(
            support.isolatableBundles(fromProfileManifest: """
            { "dsh": { "profile": { "bundles": [
              "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@openviking/dsh-memory-plugin", "dsh-notify"
            ] } } }
            """).joined(separator: ","),
            "@openviking/dsh-memory-plugin,dsh-notify",
            "core 层不可隔离，第三方按 manifest 顺序排队"
        )
        check(support.isolatableBundles(fromProfileManifest: "not json").isEmpty, "manifest 读不懂就当没有候选，交给安全模式")

        // MARK: - 隔离记录

        checkEqual(
            support.isolationEntry(bundle: "@openviking/dsh-memory-plugin", rowIds: ["openviking-memory"], reason: "r", isolatedAt: "t")?.rowIds.joined(separator: ",") ?? "nil",
            "openviking-memory", "有可禁的行才生成记录"
        )
        check(support.isolationEntry(bundle: "@a/b", rowIds: [], reason: "r", isolatedAt: "t") == nil, "没有可禁的行就不隔离（写了等于没写）")
        check(support.isolationEntry(bundle: "dsh-plugin-manager", rowIds: ["x"], reason: "r", isolatedAt: "t") == nil, "内置插件不给生成隔离记录")
        checkEqual(
            support.isolationEntry(bundle: "@a/b", rowIds: ["ok-row", "bad\ninjected"], reason: "r", isolatedAt: "t")?.rowIds.joined(separator: ",") ?? "nil",
            "ok-row", "不安全行 id 被过滤掉"
        )

        // MARK: - 恢复决策

        let emptyInput = support.RecoveryInput(attributedBundle: nil, attributedRowIds: [], rowIdOwners: [], candidateBundles: [], isolatedBundles: [], isolationsThisBoot: 0)
        check(support.decideRecovery(emptyInput) == .safeMode(reason: "没有可隔离的第三方插件，dsh 本体或内置插件出了问题"), "什么都没点名且没有候选 → 安全模式")
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: "@a/b", attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: [], isolationsThisBoot: 0))
                == .isolate(bundle: "@a/b", source: .stderrBundle),
            "日志点名了包 → 只禁它"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: nil, attributedRowIds: ["row-x"], rowIdOwners: ["@c/d"], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: [], isolationsThisBoot: 0))
                == .isolate(bundle: "@c/d", source: .stderrRow),
            "只点名了行 → 按行反查 bundle，优先于瞎猜"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: nil, attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: [], isolationsThisBoot: 1))
                == .isolate(bundle: "@a/b", source: .bisect),
            "什么都认不出 → 从候选列表逐个排除，而不是一把全砍"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: "@a/b", attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: ["@a/b"], isolationsThisBoot: 1))
                == .isolate(bundle: "@c/d", source: .bisect),
            "点名的已经禁过了 → 继续排除下一个"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: nil, attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b"], isolatedBundles: ["@a/b"], isolationsThisBoot: 1))
                == .safeMode(reason: "已隔离 1 个插件仍起不来：@a/b"),
            "第三方全禁完仍失败 → 安全模式"
        )
        check(support.decideRecovery(emptyInput) != .isolate(bundle: "@a/b", source: .bisect), "决策不会凭空发明插件名")

        // MARK: - 用户停用（面板写入、启动器读取的 --patch overlay）

        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/base.yml", isolationPatch: nil, disabledPatch: "/disabled.yml").joined(separator: " "),
            "web --patch /base.yml --patch /disabled.yml --no-open --port 3080",
            "用户停用 overlay 排在内置插件补丁之后"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/base.yml", isolationPatch: "/iso.yml", disabledPatch: "/disabled.yml").joined(separator: " "),
            "web --patch /base.yml --patch /iso.yml --patch /disabled.yml --no-open --port 3080",
            "三个槽位都传时顺序固定：base → 崩溃隔离 → 用户停用（最后生效）"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/base.yml", isolationPatch: nil, disabledPatch: nil).joined(separator: " "),
            "web --patch /base.yml --no-open --port 3080",
            "没有停用项时不改变现有启动命令"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/base.yml", deckPatch: "/deck.yml", isolationPatch: "/iso.yml", disabledPatch: "/disabled.yml").joined(separator: " "),
            "web --patch /base.yml --patch /deck.yml --patch /iso.yml --patch /disabled.yml --no-open --port 3080",
            "侧栏 Deck 接管补丁排在 base 之后、崩溃隔离/用户停用之前"
        )

        checkEqual(
            support.undisableableReason(for: "@deepseek-ai/dsh-base") ?? "nil",
            "dsh 核心层，停用后 Harness 无法启动",
            "core base 不可停用"
        )
        checkEqual(
            support.undisableableReason(for: "@deepseek-ai/dsh-web-app") ?? "nil",
            "dsh Web 界面层，停用后没有可用的 Harness 界面",
            "core web-app 不可停用"
        )
        checkEqual(
            support.undisableableReason(for: "dsh-plugin-manager") ?? "nil",
            "插件管理器自身，停用后无法从界面恢复",
            "插件管理器自身不可停用"
        )
        check(support.undisableableReason(for: "dsh-archive-manager") == nil, "内置归档插件允许用户主动停用")
        check(support.undisableableReason(for: "dsh-session-notify") == nil, "内置通知插件允许用户主动停用")

        let contextPlugin = support.DisabledPlugin(bundle: "dsh-context", rowIds: ["dsh-context"], disabledAt: "2026-11-11T00:00:00Z")
        let archivePlugin = support.DisabledPlugin(bundle: "dsh-archive-manager", rowIds: ["dsh-archive-manager"], disabledAt: "2026-11-11T00:00:00Z")
        let basePlugin = support.DisabledPlugin(bundle: "@deepseek-ai/dsh-base", rowIds: ["session"], disabledAt: "2026-11-11T00:00:00Z")
        let managerPlugin = support.DisabledPlugin(bundle: "dsh-plugin-manager", rowIds: ["dsh-plugin-manager"], disabledAt: "2026-11-11T00:00:00Z")
        let crashIsolated = support.IsolatedPlugin(bundle: "@a/b", rowIds: ["row-x", "dsh-context", "bad\ninjected"], reason: "r", isolatedAt: "t")

        checkEqual(
            support.renderCombinedDisabledPatch(isolation: [], disabled: [contextPlugin, archivePlugin]),
            "- id: dsh-context\n  disabled: true\n- id: dsh-archive-manager\n  disabled: true\n",
            "用户停用正常渲染；内置插件（非 core/管理器）允许停用"
        )
        checkEqual(
            support.renderCombinedDisabledPatch(isolation: [], disabled: [basePlugin, managerPlugin]),
            "",
            "不可停用的 core/管理器即使状态文件里有记录也不渲染"
        )
        checkEqual(
            support.renderCombinedDisabledPatch(isolation: [crashIsolated], disabled: [contextPlugin]),
            "- id: dsh-context\n  disabled: true\n- id: row-x\n  disabled: true\n",
            "崩溃隔离与用户停用合并、按行 id 去重，且不安全 id 被过滤"
        )
        check(
            support.renderCombinedDisabledPatch(isolation: [crashIsolated], disabled: [contextPlugin]).hasPrefix("- id: dsh-context\n"),
            "用户停用的行排在崩溃隔离之前（冲突时用户意图优先）"
        )
        checkEqual(support.renderCombinedDisabledPatch(isolation: [], disabled: []), "", "没有任何条目时渲染空串")

        let deckPlugin = support.DisabledPlugin(bundle: "dsh-sidebar-deck", rowIds: ["dsh-sidebar-deck"], disabledAt: "2026-11-11T00:00:00Z")
        checkEqual(
            support.renderCombinedDisabledPatch(isolation: [], disabled: [deckPlugin]),
            "- id: dsh-sidebar-deck\n  disabled: true\n- id: ui-sidebar\n  disabled: false\n",
            "停用侧栏 Deck：禁用 Deck 行，并把官方侧栏行重新启用"
        )
        check(
            support.renderCombinedDisabledPatch(isolation: [], disabled: [deckPlugin])
                .hasSuffix("- id: ui-sidebar\n  disabled: false\n"),
            "重新启用条目追加在最后（覆盖层后应用、优先级最高）"
        )
        check(
            !support.renderCombinedDisabledPatch(isolation: [], disabled: [contextPlugin]).contains("ui-sidebar"),
            "没停用 Deck 时不碰官方侧栏行"
        )
        check(support.replacementRows["dsh-sidebar-deck"] == ["ui-sidebar"], "Deck 的接管行关系固定")

        check(support.renderSidebarDeckPatch().contains("- id: ui-sidebar\n  disabled: true"), "Deck 接管补丁停用官方侧栏")
        check(support.renderSidebarDeckPatch().contains("- id: dsh-sidebar-deck\n"), "Deck 接管补丁插入自己")
        check(support.isSidebarDeckDisabled(in: [deckPlugin]), "状态里能识别 Deck 被用户停用")
        check(!support.isSidebarDeckDisabled(in: [contextPlugin]), "其它插件停用不影响 Deck 判定")
        let deckPatchDir = FileManager.default.temporaryDirectory.appendingPathComponent("dhl-deck-\\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: deckPatchDir) }
        if let deckPatchURL = support.stagedSidebarDeckPatchFile(directory: deckPatchDir) {
            let text = (try? String(contentsOf: deckPatchURL, encoding: .utf8)) ?? ""
            checkEqual(text, support.renderSidebarDeckPatch(), "Deck 接管补丁能落盘且内容一致")
        } else {
            check(false, "Deck 接管补丁应能写入临时目录")
        }

        let disabledRoot = FileManager.default.temporaryDirectory.appendingPathComponent("dhl-disabled-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: disabledRoot) }
        try? FileManager.default.createDirectory(at: disabledRoot, withIntermediateDirectories: true)
        let disabledStateURL = support.disabledStateURL(home: disabledRoot)
        check(disabledStateURL.path.hasSuffix("/plugin-manager/disabled.json"), "状态文件落点在 $DSH_HOME/plugin-manager/disabled.json")
        check(support.disabledPatchDirectory(home: disabledRoot).lastPathComponent == "plugin-manager", "overlay 与状态文件在同一目录")

        check(!support.isSafeBundleName("../evil"), "bundle 名拒绝路径穿越")
        check(support.isSafeBundleName("@scope/name"), "正常 scoped 包名放行")
        check(support.readDisabledState(url: disabledStateURL).isEmpty, "状态文件不存在时按没有停用处理")
        try? FileManager.default.createDirectory(at: support.disabledPatchDirectory(home: disabledRoot), withIntermediateDirectories: true)
        try? """
        {
          "version": 1,
          "updatedAt": "2026-11-11T00:00:00Z",
          "disabled": [
            { "bundle": "dsh-context", "rowIds": ["dsh-context", "bad\\ninjected"], "disabledAt": "t" },
            { "bundle": "dsh-plugin-manager", "rowIds": ["dsh-plugin-manager"], "disabledAt": "t" },
            { "bundle": "@deepseek-ai/dsh-base", "rowIds": ["session"], "disabledAt": "t" },
            { "bundle": "../evil", "rowIds": ["x"], "disabledAt": "t" },
            { "bundle": "empty-rows", "rowIds": [], "disabledAt": "t" },
            { "bundle": "dsh-context", "rowIds": ["duplicate"], "disabledAt": "t" }
          ]
        }
        """.write(to: disabledStateURL, atomically: true, encoding: .utf8)
        let readBack = support.readDisabledState(url: disabledStateURL)
        checkEqual(readBack.count, 1, "只保留合法、去重、含安全行 id 的记录，实际 \(readBack.count) 条")
        checkEqual(readBack.first?.bundle ?? "nil", "dsh-context", "保留合法的 bundle")
        checkEqual(readBack.first?.rowIds.joined(separator: ",") ?? "nil", "dsh-context", "不安全行 id 被过滤")

        try? "[not json".write(to: disabledStateURL, atomically: true, encoding: .utf8)
        check(support.readDisabledState(url: disabledStateURL).isEmpty, "畸形 JSON 不能让启动器变成故障源")

        try? FileManager.default.removeItem(at: disabledStateURL)
        check(support.stagedDisabledPatchFile(disabled: [], directory: support.disabledPatchDirectory(home: disabledRoot)) == nil, "没有停用项时不产出 overlay")
        let stagedDisabled = support.stagedDisabledPatchFile(disabled: [contextPlugin], directory: support.disabledPatchDirectory(home: disabledRoot))
        checkEqual(stagedDisabled?.lastPathComponent ?? "nil", support.disabledPatchFileName, "有停用项时产出 overlay 文件")
        checkEqual(
            (stagedDisabled.flatMap { try? String(contentsOf: $0, encoding: .utf8) }) ?? "",
            "- id: dsh-context\n  disabled: true\n",
            "overlay 是可被 dsh 解析的顶格 YAML 列表"
        )
        check(
            support.stagedDisabledPatchFile(disabled: [contextPlugin], directory: URL(fileURLWithPath: "/System/Library/CoreFinder/x")) == nil,
            "写不进去时返回 nil（宁可不停用，也不递半截文件给 dsh）"
        )

        // MARK: - 启动前静态预检

        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("dhl-preflight-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        func write(_ relative: String, _ body: String) {
            let url = root.appendingPathComponent(relative)
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? body.write(to: url, atomically: true, encoding: .utf8)
        }
        func gaps(in sub: String) -> [String] {
            PluginSourceCheck.unresolvableLocalImports(in: sub.isEmpty ? root : root.appendingPathComponent(sub))
                .map { "\($0.importer) -> \($0.specifier)" }
        }

        write("index.mjs", "import { a } from './lib/a.mjs';\nexport const all = a;\n")
        write("lib/a.mjs", "export const a = 1\n")
        write("servers/mcp.mjs", "import '../lib/a.mjs';\nexport const s = 1;\n")
        check(gaps(in: "").isEmpty, "完整源码不报")

        write("client.mjs", "import { http } from './shared/ov-http.mjs';\nexport const c = http;\n")
        checkEqual(gaps(in: "").joined(separator: ","), "client.mjs -> ./shared/ov-http.mjs", "缺整个 shared/ 要报（真实事故形状）")

        write("shared/ov-http.mjs", "export const http = 1\n")
        check(gaps(in: "").isEmpty, "补上 shared/ 之后不报")

        write("dynamic.mjs", "const load = () => import('./maybe-later.mjs');\nexport const d = load;\n")
        checkEqual(gaps(in: "").joined(separator: ","), "dynamic.mjs -> ./maybe-later.mjs", "动态 import 也查")

        write("reexport.mjs", "export { x } from './gone.mjs';\n")
        check(gaps(in: "").contains("reexport.mjs -> ./gone.mjs"), "re-export 也查")

        // 换下一组用例前把上面那些"故意缺文件"的样本清干净，否则会串味。
        for stale in ["index.mjs", "client.mjs", "dynamic.mjs", "reexport.mjs", "servers", "shared"] {
            try? fm.removeItem(at: root.appendingPathComponent(stale))
        }
        write("plain.mjs", "import { x } from './plain';\nexport const p = x;\n")
        write("plain.js", "export const x = 1\n")
        write("dirimport.mjs", "import { y } from './dir/';\nexport const q = y;\n")
        write("dir/index.mjs", "export const y = 1\n")
        write("bare.mjs", "import { llm } from '@deepseek-ai/dsh-llm';\nexport const b = llm;\n")
        check(gaps(in: "").isEmpty, "省扩展名、目录 index、裸包名都不误报")

        write("outside.mjs", "import { z } from '../../other-pkg/z.mjs';\nexport const o = z;\n")
        check(gaps(in: "").isEmpty, "指向包外的相对路径不报（pnpm 布局另有解析）")

        write("index.test.mjs", "import { fix } from './fixture.mjs';\nexport const t = fix;\n")
        write("test/only-tests.mjs", "import { g } from './gone-in-tests.mjs';\nexport const u = g;\n")
        write("node_modules/dep/x.mjs", "import { n } from './missing-in-deps.mjs';\nexport const v = n;\n")
        check(gaps(in: "").isEmpty, "测试文件、test/ 目录、node_modules 里的缺失都不拦启动")

        check(PluginSourceCheck.unresolvableLocalImports(in: root.appendingPathComponent("no-such-dir")).isEmpty,
              "目录不存在时返回空（预检自己不能变成故障源）")

        if !failures.isEmpty {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
        print("plugin isolation checks passed")
    }
}
