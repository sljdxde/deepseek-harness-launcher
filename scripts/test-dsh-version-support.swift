import Foundation

@main
struct DSHVersionSupportChecks {
    static func main() {
        precondition(DSHVersionParser.version(from: "0.1.1-rc.2\n") == "0.1.1-rc.2")
        precondition(DSHVersionParser.version(from: "1.2.3") == "1.2.3")
        precondition(DSHVersionParser.version(from: "no version here") == nil)
        precondition(compareVersions("0.1.1-rc.2", "0.1.1") == .orderedAscending)
        precondition(compareVersions("1.0.0", "1.0.0") == .orderedSame)
        precondition(
            LauncherEnvironment.npmRegistryCandidates(environment: [:]) ==
                ["https://registry.npmmirror.com", "https://registry.npmjs.org"]
        )
        precondition(
            LauncherEnvironment.npmRegistryCandidates(environment: ["DHL_NPM_REGISTRY": "https://npm.example.test/"]) ==
                ["https://npm.example.test", "https://registry.npmmirror.com", "https://registry.npmjs.org"]
        )
        // First-install memory budget: fetch concurrency must stay modest so
        // npm's concurrent tarball fetch/extract cannot balloon peak RSS.
        precondition(LauncherEnvironment.nodeEnvironment()["npm_config_maxsockets"] == "16")
        print("dsh version support checks passed")
    }
}
