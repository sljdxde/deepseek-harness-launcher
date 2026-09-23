import Foundation

/// 插件源码的相对 import 能不能落地——拉起 dsh 之前的静态预检。
///
/// 为什么要静态查而不是等它失败：dsh 的插件树是全有或全无的，任何一个 bundle 的 import
/// 不成立，整个进程就以退出码 1 结束。真实事故里坏掉的正是「上游把 `shared/` 改成打包时
/// 生成、git 目录安装拿不到」这一类百分百能在磁盘上查出来的问题——没必要让用户先看到一次
/// 「启动失败」再等自愈。
///
/// 判定口径与 `Plugins/DSHPluginManager` 里的 JS 版（`findUnresolvableLocalImports`）
/// 一致，两边各自解释同一套规则：只看解析后仍落在包目录内的相对路径（`../` 出界的交给
/// pnpm 的布局，报出来只会是误报），并跳过测试目录与 `node_modules`（dsh 启动不加载它们）。
///
/// 预检只负责「挑出可疑」；隔离、重试、安全模式由 PluginIsolationSupport 与启动器主流程
/// 决定。任何 IO 失败都按「查不出来 = 不动它」处理——预检自己绝不能变成故障源。
enum PluginSourceCheck {
    /// 一条 import 语句里的模块说明符：静态 from、re-export、动态 import()、裸副作用。
    private static let importRegexes: [NSRegularExpression] = [
        try! NSRegularExpression(pattern: #"(?:^|[\s;(=])(?:import|export)\b[^;'"]*?from\s*["']([^"']+)["']"#, options: [.anchorsMatchLines]),
        try! NSRegularExpression(pattern: #"\bimport\s*\(\s*["']([^"']+)["']\s*\)"#),
        try! NSRegularExpression(pattern: #"(?:^|[\s;])import\s*["']([^"']+)["']"#, options: [.anchorsMatchLines])
    ]

    /// Node 允许省扩展名时补齐的后缀（含 TS：有的插件带 loader 跑 .mts）。
    private static let moduleExtensions = ["", ".mjs", ".js", ".cjs", ".mts", ".ts", ".cts"]
    private static let moduleFileExtensions: Set<String> = ["mjs", "cjs", "js", "mts", "cts"]
    /// 不参与预检的目录：不是这个包的运行时代码。
    private static let skippedDirectories: Set<String> = [
        "node_modules", ".git", "test", "tests", "__tests__", "fixtures", "coverage"
    ]

    struct Gap: Equatable {
        let importer: String
        let specifier: String
    }

    private static func specifiers(in source: String) -> [String] {
        var found = Set<String>()
        let range = NSRange(source.startIndex..., in: source)
        for regex in importRegexes {
            for match in regex.matches(in: source, range: range) {
                guard let captured = Range(match.range(at: 1), in: source) else { continue }
                found.insert(String(source[captured]))
            }
        }
        return found.sorted()
    }

    /// 测试文件不参与：dsh 启动不加载它们，而插件仓库的测试引用到仓库里的 fixture 是常态。
    private static func isRuntimeModule(_ name: String) -> Bool {
        guard let dot = name.lastIndex(of: ".") else { return false }
        let ext = String(name[name.index(after: dot)...])
        guard moduleFileExtensions.contains(ext) else { return false }
        let stem = String(name[..<dot])
        return !stem.hasSuffix(".test") && !stem.hasSuffix(".spec")
    }

    private static func runtimeModules(under root: URL, finder: FileManager) -> [URL] {
        guard let enumerator = finder.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [],
            errorHandler: { _, _ in true }
        ) else { return [] }
        var out: [URL] = []
        let rootComponents = root.pathComponents
        for case let url as URL in enumerator {
            // 落在被跳过目录里的整棵子树都不看（FileManager.DirectoryEnumerator 没有
            // skipSubtree，只能按路径成分判断）。
            let components = url.pathComponents
            if components.count > rootComponents.count + 1 {
                let inner = Array(components[(rootComponents.count + 1)..<components.count - 1])
                if inner.contains(where: { skippedDirectories.contains($0) }) { continue }
            }
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true { continue }
            if isRuntimeModule(url.lastPathComponent) { out.append(url) }
        }
        return out
    }

    private static func resolvesAsModule(_ target: URL, finder: FileManager) -> Bool {
        for ext in moduleExtensions where finder.fileExists(atPath: target.path + ext) { return true }
        for ext in moduleExtensions.dropFirst()
        where finder.fileExists(atPath: target.appendingPathComponent("index" + ext).path) { return true }
        return false
    }

    /// 这个包目录里有哪些相对 import 落不了地。空数组表示「没问题」或「无从判断」
    /// （目录不存在、读不动、不是包目录），后者一律按不动它处理。
    static func unresolvableLocalImports(in directory: URL, fileManager finder: FileManager = .default) -> [Gap] {
        let root = directory.standardizedFileURL
        guard finder.fileExists(atPath: root.path) else { return [] }
        var gaps: [Gap] = []
        for file in runtimeModules(under: root, finder: finder) {
            guard let source = try? String(contentsOf: file, encoding: .utf8) else { continue }
            let importer = file.path.hasPrefix(root.path + "/")
                ? String(file.path.dropFirst(root.path.count + 1))
                : file.lastPathComponent
            let parent = file.deletingLastPathComponent().standardizedFileURL
            for specifier in specifiers(in: source) {
                guard specifier.hasPrefix(".") else { continue }
                let resolved = URL(fileURLWithPath: parent.path + "/" + specifier).standardizedFileURL
                guard resolved.path.hasPrefix(root.path + "/") else { continue }
                if !resolvesAsModule(resolved, finder: finder) {
                    gaps.append(Gap(importer: importer, specifier: specifier))
                }
            }
        }
        return gaps.sorted { ($0.importer, $0.specifier) < ($1.importer, $1.specifier) }
    }
}
