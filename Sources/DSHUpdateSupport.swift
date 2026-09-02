import Foundation

enum DSHUpdateCheckResult {
    case current(String)
    case available(current: String, latest: String)
    case failed(String)
}

enum DSHVersionParser {
    static func version(from output: String) -> String? {
        let pattern = #"\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(output.startIndex..., in: output)
        guard let match = regex.firstMatch(in: output, range: range),
              let swiftRange = Range(match.range, in: output) else { return nil }
        return String(output[swiftRange])
    }
}

final class DSHVersionService {
    private let environment: [String: String]

    init(environment: [String: String] = LauncherEnvironment.nodeEnvironment()) {
        self.environment = environment
    }

    func check(completion: @escaping (DSHUpdateCheckResult) -> Void) {
        guard DSHRuntimeSupport.isInstalled() else {
            completion(.failed("dsh 尚未安装"))
            return
        }
        var currentVersion: String?
        var latestVersion: String?
        let group = DispatchGroup()
        group.enter()
        runCurrentVersion { currentVersion = $0; group.leave() }
        group.enter()
        runLatestVersion { latestVersion = $0; group.leave() }
        group.notify(queue: .main) {
            guard let currentVersion else {
                completion(.failed("无法读取当前 dsh 版本"))
                return
            }
            guard let latestVersion else {
                completion(.failed("无法读取 npm 上的 dsh 最新版本"))
                return
            }
            let result: DSHUpdateCheckResult
            if compareVersions(currentVersion, latestVersion) == .orderedAscending {
                result = .available(current: currentVersion, latest: latestVersion)
            } else {
                result = .current(latestVersion)
            }
            completion(result)
        }
    }

    private func runCurrentVersion(completion: @escaping (String?) -> Void) {
        guard DSHRuntimeSupport.isInstalled() else {
            completion(nil)
            return
        }
        var env = environment
        env["npm_config_prefer_offline"] = "true"
        run(executable: DSHRuntimeSupport.executableURL.path, arguments: ["--version"], environment: env) { output in
            completion(output.flatMap(DSHVersionParser.version(from:)))
        }
    }

    private func runLatestVersion(completion: @escaping (String?) -> Void) {
        var env = environment
        env["npm_config_prefer_offline"] = "false"
        run(executable: "npm", arguments: ["view", "@deepseek-ai/dsh", "version"], environment: env) { output in
            completion(output.flatMap(DSHVersionParser.version(from:)))
        }
    }

    private func run(executable: String, arguments: [String], environment: [String: String], completion: @escaping (String?) -> Void) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        task.arguments = [executable] + arguments
        task.environment = environment
        let pipe = Pipe()
        let lock = NSLock()
        var outputData = Data()
        task.standardOutput = pipe
        task.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
            } else {
                lock.lock(); outputData.append(data); lock.unlock()
            }
        }
        task.terminationHandler = { _ in
            pipe.fileHandleForReading.readabilityHandler = nil
            let remaining = pipe.fileHandleForReading.readDataToEndOfFile()
            lock.lock(); outputData.append(remaining); let output = String(data: outputData, encoding: .utf8); lock.unlock()
            completion(output)
        }
        do {
            try task.run()
        } catch {
            completion(nil)
        }
    }

}
