import Foundation
import Darwin

struct UpdateManifest: Codable {
    let version: String
    let dmgURL: String
    let notes: String?
    let publishedAt: String?
}

enum UpdateCheckResult {
    case unconfigured
    case current
    case available(UpdateManifest)
    case failed(String)
}

func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
    let left = lhs.split(separator: ".").map { Int($0) ?? 0 }
    let right = rhs.split(separator: ".").map { Int($0) ?? 0 }
    for index in 0..<max(left.count, right.count) {
        let l = index < left.count ? left[index] : 0
        let r = index < right.count ? right[index] : 0
        if l < r { return .orderedAscending }
        if l > r { return .orderedDescending }
    }
    return .orderedSame
}

final class LauncherSettings {
    static let shared = LauncherSettings()
    private let defaults = UserDefaults.standard

    private init() {
        defaults.register(defaults: [
            "autoUpdateEnabled": true,
            "updateIntervalHours": 6.0,
            "updateFeedURL": ProcessInfo.processInfo.environment["DSH_UPDATE_FEED_URL"] ?? "",
            "openBrowserOnReady": true,
            "launchAtLogin": false
        ])
    }

    var autoUpdateEnabled: Bool {
        get { defaults.bool(forKey: "autoUpdateEnabled") }
        set { defaults.set(newValue, forKey: "autoUpdateEnabled") }
    }

    var updateIntervalHours: Double {
        get { max(defaults.double(forKey: "updateIntervalHours"), 1) }
        set { defaults.set(max(newValue, 1), forKey: "updateIntervalHours") }
    }

    var updateFeedURL: String {
        get { defaults.string(forKey: "updateFeedURL") ?? "" }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "updateFeedURL") }
    }

    var openBrowserOnReady: Bool {
        get { defaults.bool(forKey: "openBrowserOnReady") }
        set { defaults.set(newValue, forKey: "openBrowserOnReady") }
    }

    var launchAtLogin: Bool {
        get { defaults.bool(forKey: "launchAtLogin") }
        set { defaults.set(newValue, forKey: "launchAtLogin") }
    }
}

enum LoginItemManager {
    private static let label = "com.local.dsh-launcher"

    static func setEnabled(_ enabled: Bool, appURL: URL = Bundle.main.bundleURL) throws {
        let agents = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        let plistURL = agents.appendingPathComponent("\(label).plist")
        if enabled {
            try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
            let payload: [String: Any] = [
                "Label": label,
                "ProgramArguments": ["/usr/bin/open", "-a", appURL.path],
                "RunAtLoad": true,
                "ProcessType": "Interactive"
            ]
            let data = try PropertyListSerialization.data(fromPropertyList: payload, format: .xml, options: 0)
            try data.write(to: plistURL, options: .atomic)
            bootstrap(plistURL)
        } else {
            bootout(plistURL)
            try? FileManager.default.removeItem(at: plistURL)
        }
    }

    private static func bootstrap(_ plistURL: URL) {
        runLaunchctl(["bootstrap", "gui/\(getuid())", plistURL.path])
    }

    private static func bootout(_ plistURL: URL) {
        runLaunchctl(["bootout", "gui/\(getuid())", plistURL.path])
    }

    private static func runLaunchctl(_ arguments: [String]) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        task.arguments = arguments
        try? task.run()
        task.waitUntilExit()
    }
}

final class UpdateService {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 60
        session = URLSession(configuration: configuration)
    }

    func check(currentVersion: String, feedURL: String, completion: @escaping (UpdateCheckResult) -> Void) {
        guard !feedURL.isEmpty else { DispatchQueue.main.async { completion(.unconfigured) }; return }
        guard let url = URL(string: feedURL), let scheme = url.scheme?.lowercased(), ["http", "https", "file"].contains(scheme) else {
            DispatchQueue.main.async { completion(.failed("更新源地址无效")) }
            return
        }

        if scheme == "file" {
            DispatchQueue.global(qos: .utility).async {
                do {
                    let data = try Data(contentsOf: url)
                    self.finishCheck(data: data, currentVersion: currentVersion, completion: completion)
                } catch { DispatchQueue.main.async { completion(.failed(error.localizedDescription)) } }
            }
            return
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        session.dataTask(with: request) { data, response, error in
            if let error { DispatchQueue.main.async { completion(.failed(error.localizedDescription)) }; return }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                DispatchQueue.main.async { completion(.failed("更新源返回了无效响应")) }
                return
            }
            self.finishCheck(data: data, currentVersion: currentVersion, completion: completion)
        }.resume()
    }

    func download(_ manifest: UpdateManifest, completion: @escaping (Result<URL, Error>) -> Void) {
        guard let url = URL(string: manifest.dmgURL), ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else {
            DispatchQueue.main.async { completion(.failure(UpdateError.invalidDownloadURL)) }
            return
        }
        let destination = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent("DSH-\(manifest.version).dmg")
        try? FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)

        if url.scheme?.lowercased() == "file" {
            do {
                try copyReplacing(source: url, destination: destination)
                DispatchQueue.main.async { completion(.success(destination)) }
            } catch { DispatchQueue.main.async { completion(.failure(error)) } }
            return
        }

        session.downloadTask(with: url) { temporaryURL, _, error in
            if let error { DispatchQueue.main.async { completion(.failure(error)) }; return }
            guard let temporaryURL else { DispatchQueue.main.async { completion(.failure(UpdateError.missingDownload)) }; return }
            do {
                try self.copyReplacing(source: temporaryURL, destination: destination)
                DispatchQueue.main.async { completion(.success(destination)) }
            } catch { DispatchQueue.main.async { completion(.failure(error)) } }
        }.resume()
    }

    private func finishCheck(data: Data, currentVersion: String, completion: @escaping (UpdateCheckResult) -> Void) {
        do {
            let manifest = try JSONDecoder().decode(UpdateManifest.self, from: data)
            let result: UpdateCheckResult = compareVersions(currentVersion, manifest.version) == .orderedAscending ? .available(manifest) : .current
            DispatchQueue.main.async { completion(result) }
        } catch { DispatchQueue.main.async { completion(.failed("更新清单格式无效")) } }
    }

    private func copyReplacing(source: URL, destination: URL) throws {
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.copyItem(at: source, to: destination)
    }
}

enum UpdateError: LocalizedError {
    case invalidDownloadURL
    case missingDownload

    var errorDescription: String? {
        switch self {
        case .invalidDownloadURL: return "更新包地址无效"
        case .missingDownload: return "未收到更新包"
        }
    }
}
