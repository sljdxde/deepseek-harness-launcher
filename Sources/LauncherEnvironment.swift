import Foundation

enum LauncherEnvironment {
    private static func homePath(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return home + "/" + path
    }

    private static func versionedNodePaths() -> [String] {
        let fileManager = FileManager.default
        let roots = [
            homePath(".nvm/versions/node"),
            homePath(".local/share/fnm/node-versions"),
            homePath("Library/Application Support/fnm/node-versions")
        ]
        return roots.flatMap { root -> [String] in
            guard let entries = try? fileManager.contentsOfDirectory(atPath: root) else { return [] }
            return entries.sorted(by: >).map { entry in
                if root.hasSuffix("fnm/node-versions") { return "\(root)/\(entry)/installation/bin" }
                if root.hasSuffix("Application Support/fnm/node-versions") { return "\(root)/\(entry)/installation/bin" }
                return "\(root)/\(entry)/bin"
            }
        }
    }

    static func nodeSearchPaths() -> [String] {
        var paths = [
            homePath("opt/node/bin"),
            homePath(".volta/bin"),
            homePath(".nvm/current/bin"),
            homePath(".fnm/aliases/default/bin"),
            homePath(".local/share/fnm/aliases/default/bin"),
            homePath(".asdf/shims"),
            homePath("Library/pnpm"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ]
        paths.insert(contentsOf: versionedNodePaths(), at: 3)
        var seen = Set<String>()
        return paths.filter { seen.insert($0).inserted }
    }

    static func nodeEnvironment(preferOffline: Bool? = nil) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let paths = nodeSearchPaths() + (env["PATH"] ?? "").split(separator: ":").map(String.init)
        var seen = Set<String>()
        env["PATH"] = paths.filter { seen.insert($0).inserted }.joined(separator: ":")
        env["npm_config_audit"] = "false"
        env["npm_config_fund"] = "false"
        env["npm_config_progress"] = "true"
        env["npm_config_update_notifier"] = "false"
        env["npm_config_fetch_retries"] = "3"
        env["npm_config_fetch_retry_factor"] = "2"
        env["npm_config_fetch_retry_mintimeout"] = "1000"
        env["npm_config_fetch_retry_maxtimeout"] = "10000"
        env["npm_config_fetch_timeout"] = "120000"
        // dsh has a large dependency graph; allow npm to fetch more tarballs
        // concurrently while retaining npm's normal retry behavior.
        env["npm_config_maxsockets"] = "50"
        // Keep npm's peer-dependency resolver enabled. dsh-app-boot relies on
        // peer packages such as cordis-plugin-group at runtime; legacy-peer-
        // deps would silently omit them and leave a broken npx cache.
        env["npm_config_legacy_peer_deps"] = "false"
        if let preferOffline {
            env["npm_config_prefer_offline"] = preferOffline ? "true" : "false"
        }
        return env
    }

    static func npmRegistryCandidates(
        environment: [String: String],
        detectedRegistry: String? = nil
    ) -> [String] {
        let explicit = environment["DHL_NPM_REGISTRY"]
            ?? environment["npm_config_registry"]
            ?? environment["NPM_CONFIG_REGISTRY"]
        let configured = explicit ?? detectedRegistry
        let defaults = [
            "https://registry.npmmirror.com",
            "https://registry.npmjs.org"
        ]
        var seen = Set<String>()
        let ordered: [String?]
        if explicit != nil {
            ordered = [explicit] + defaults
        } else if let configured,
                  !configured.contains("registry.npmjs.org"),
                  !configured.contains("registry.npmmirror.com") {
            ordered = [configured] + defaults
        } else {
            ordered = defaults
        }
        return ordered
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    static func executablePath(named name: String, environment: [String: String] = nodeEnvironment()) -> String? {
        let fileManager = FileManager.default
        for directory in (environment["PATH"] ?? "").split(separator: ":").map(String.init) {
            let candidate = URL(fileURLWithPath: directory).appendingPathComponent(name).path
            if fileManager.isExecutableFile(atPath: candidate) { return candidate }
        }
        return nil
    }
}
