import Foundation
import Darwin

struct UpdateManifest: Codable {
    let version: String
    let dmgURL: String
    let notes: String?
    let publishedAt: String?
}

struct UpdateDownloadProgress: Equatable {
    let bytesWritten: Int64
    let totalBytes: Int64?

    var fraction: Double? {
        guard let totalBytes, totalBytes > 0 else { return nil }
        return min(1, max(0, Double(bytesWritten) / Double(totalBytes)))
    }
}

enum UpdateCheckResult {
    case noPublishedRelease
    case current
    case available(UpdateManifest)
    case failed(String)
}

/// Version forms follow AGENTS.md: official releases are `x.y.z`, test
/// submissions are `x.y.z-a.b`, and in-development builds are
/// `x.y.z-a.b-SNAPSHOT`. Ranking within one base version: SNAPSHOT build <
/// its submission < official release; test suffixes compare numerically
/// component by component; the base `x.y.z` always dominates the suffix. A
/// development or submission build is therefore never prompted to "update"
/// onto an older official version. Unparsable numeric components fall back
/// to 0, as before.
func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
    let left = parseVersion(lhs)
    let right = parseVersion(rhs)
    for index in 0..<max(left.base.count, right.base.count) {
        let l = index < left.base.count ? left.base[index] : 0
        let r = index < right.base.count ? right.base[index] : 0
        if l < r { return .orderedAscending }
        if l > r { return .orderedDescending }
    }
    switch (left.testSuffix, right.testSuffix) {
    case (nil, .some):
        return .orderedDescending
    case (.some, nil):
        return .orderedAscending
    case (.some(let l), .some(let r)):
        for index in 0..<max(l.count, r.count) {
            let a = index < l.count ? l[index] : 0
            let b = index < r.count ? r[index] : 0
            if a < b { return .orderedAscending }
            if a > b { return .orderedDescending }
        }
        if left.isSnapshot != right.isSnapshot {
            return left.isSnapshot ? .orderedAscending : .orderedDescending
        }
    default:
        break
    }
    // 后缀与正式态一致、仅 SNAPSHOT 标记不同时（裸 x.y.z-SNAPSHOT 的兜底）。
    if left.isSnapshot != right.isSnapshot {
        return left.isSnapshot ? .orderedAscending : .orderedDescending
    }
    return .orderedSame
}

private struct ParsedVersion {
    let base: [Int]
    let testSuffix: [Int]?
    let isSnapshot: Bool
}

private func parseVersion(_ value: String) -> ParsedVersion {
    var base: [Int] = []
    var suffix: [Int]?
    var isSnapshot = false
    for token in value.split(separator: "-") {
        let components = token.split(separator: ".").map { Int($0) }
        if base.isEmpty && components.allSatisfy({ $0 != nil }) {
            base = components.map { $0! }
        } else if token == "SNAPSHOT" || components.contains(nil) {
            // 任何文本性后缀（SNAPSHOT / rc.2 / beta）都排在同 base 正式版之前。
            isSnapshot = true
        } else {
            suffix = components.map { $0! }
        }
    }
    return ParsedVersion(base: base, testSuffix: suffix, isSnapshot: isSnapshot)
}

final class LauncherSettings {
    static let shared = LauncherSettings()
    private let defaults = UserDefaults.standard

    private init() {
        defaults.register(defaults: [
            "autoUpdateEnabled": true,
            "autoCheckPluginUpdates": true,
            "updateIntervalHours": 6.0,
            "openBrowserOnReady": true,
            "launchAtLogin": false,
            "globalHotKeyEnabled": true,
            "globalHotKeyModifiers": 0x1800,
            "globalHotKeyKeyCode": 2,
            "globalHotKeyDisplay": "⌃⌥D"
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

    /// 后台自动检测已安装插件的新版本（默认开）。关闭只影响后台检测，
    /// 插件管理面板里的手动「检查更新」仍然可用。
    var autoCheckPluginUpdates: Bool {
        get { defaults.bool(forKey: "autoCheckPluginUpdates") }
        set { defaults.set(newValue, forKey: "autoCheckPluginUpdates") }
    }

    var openBrowserOnReady: Bool {
        get { defaults.bool(forKey: "openBrowserOnReady") }
        set { defaults.set(newValue, forKey: "openBrowserOnReady") }
    }

    /// 用户选择「跳过此版本」的 dsh 版本：自动检查只把菜单标题写成「已跳过 vX」，
    /// 不再当作可用更新提示；手动检查仍然弹窗，并可以在弹窗里取消跳过。
    var skippedDSHVersion: String? {
        get { defaults.string(forKey: "skippedDSHVersion") }
        set {
            if let newValue, !newValue.isEmpty {
                defaults.set(newValue, forKey: "skippedDSHVersion")
            } else {
                defaults.removeObject(forKey: "skippedDSHVersion")
            }
        }
    }

    var launchAtLogin: Bool {
        get { defaults.bool(forKey: "launchAtLogin") }
        set { defaults.set(newValue, forKey: "launchAtLogin") }
    }

    var globalHotKeyEnabled: Bool {
        get { defaults.bool(forKey: "globalHotKeyEnabled") }
        set { defaults.set(newValue, forKey: "globalHotKeyEnabled") }
    }

    var globalHotKeyModifiers: UInt32 {
        get { UInt32(defaults.integer(forKey: "globalHotKeyModifiers")) }
        set { defaults.set(Int(newValue), forKey: "globalHotKeyModifiers") }
    }

    var globalHotKeyKeyCode: UInt32 {
        get { UInt32(defaults.integer(forKey: "globalHotKeyKeyCode")) }
        set { defaults.set(Int(newValue), forKey: "globalHotKeyKeyCode") }
    }

    var globalHotKeyDisplay: String {
        get { defaults.string(forKey: "globalHotKeyDisplay") ?? "⌃⌥D" }
        set { defaults.set(newValue, forKey: "globalHotKeyDisplay") }
    }
}

enum LoginItemManager {
    private static let label = "com.local.dhl-launcher"

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
    static let repository = "sljdxde/deepseek-harness-launcher"
    // GitHub release assets cannot contain spaces; they are stored as dots.
    static let dmgAssetName = "Deepseek.Harness.Launcher.dmg"
    static let releasesPageURL = URL(string: "https://github.com/\(repository)/releases")!
    static let latestReleaseAPIURL = URL(string: "https://api.github.com/repos/\(repository)/releases/latest")!
    static let releasesFeedURL = URL(string: "https://github.com/\(repository)/releases.atom")!

    private struct GitHubRelease: Decodable {
        let tagName: String
        let name: String?
        let body: String?
        let publishedAt: String?
        let assets: [GitHubAsset]

        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case name
            case body
            case publishedAt = "published_at"
            case assets
        }
    }

    private struct GitHubAsset: Decodable {
        let name: String
        let browserDownloadURL: String

        enum CodingKeys: String, CodingKey {
            case name
            case browserDownloadURL = "browser_download_url"
        }
    }

    private final class AtomReleaseParser: NSObject, XMLParserDelegate {
        private var currentElement = ""
        private var currentText = ""
        private var insideEntry = false
        private var latestTag: String?
        private var latestTitle: String?

        func parse(_ data: Data) -> (tag: String, title: String?)? {
            let parser = XMLParser(data: data)
            parser.delegate = self
            guard parser.parse(), let latestTag else { return nil }
            return (latestTag, latestTitle)
        }

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
            currentElement = elementName
            currentText = ""
            if elementName == "entry" { insideEntry = true }
            if insideEntry, elementName == "link", let href = attributeDict["href"], href.contains("/releases/tag/") {
                let rawTag = URL(string: href)?.pathComponents.last ?? ""
                let tag = rawTag.removingPercentEncoding ?? rawTag
                if !tag.isEmpty { latestTag = tag }
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            currentText += string
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            if insideEntry, elementName == "title", latestTitle == nil {
                let value = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty { latestTitle = value }
            }
            if elementName == "entry" { insideEntry = false }
            currentElement = ""
            currentText = ""
        }
    }

    private let session: URLSession
    private let releasesURL: URL
    private let feedURL: URL
    private var activeDownload: DownloadDelegate?

    private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
        let destination: URL
        let onProgress: (UpdateDownloadProgress) -> Void
        let completion: (Result<URL, Error>) -> Void
        var session: URLSession?
        private var didFinish = false

        init(
            destination: URL,
            onProgress: @escaping (UpdateDownloadProgress) -> Void,
            completion: @escaping (Result<URL, Error>) -> Void
        ) {
            self.destination = destination
            self.onProgress = onProgress
            self.completion = completion
        }

        func start(url: URL) {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 30
            configuration.timeoutIntervalForResource = 60 * 60
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
            self.session = session
            session.downloadTask(with: url).resume()
        }

        func urlSession(
            _ session: URLSession,
            downloadTask: URLSessionDownloadTask,
            didWriteData bytesWritten: Int64,
            totalBytesWritten: Int64,
            totalBytesExpectedToWrite: Int64
        ) {
            let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : nil
            onProgress(UpdateDownloadProgress(bytesWritten: totalBytesWritten, totalBytes: total))
        }

        func urlSession(
            _ session: URLSession,
            downloadTask: URLSessionDownloadTask,
            didFinishDownloadingTo location: URL
        ) {
            do {
                try copyReplacing(source: location, destination: destination)
                let bytes = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.int64Value ?? 0
                onProgress(UpdateDownloadProgress(bytesWritten: bytes, totalBytes: bytes > 0 ? bytes : nil))
                finish(.success(destination))
            } catch {
                finish(.failure(error))
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if let error { finish(.failure(error)) }
        }

        private func finish(_ result: Result<URL, Error>) {
            guard !didFinish else { return }
            didFinish = true
            session?.invalidateAndCancel()
            completion(result)
        }

        private func copyReplacing(source: URL, destination: URL) throws {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.copyItem(at: source, to: destination)
        }
    }

    init(
        releasesURL: URL = UpdateService.latestReleaseAPIURL,
        feedURL: URL = UpdateService.releasesFeedURL,
        session: URLSession? = nil
    ) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 15
            configuration.timeoutIntervalForResource = 60
            self.session = URLSession(configuration: configuration)
        }
        self.releasesURL = releasesURL
        self.feedURL = feedURL
    }

    func check(currentVersion: String, completion: @escaping (UpdateCheckResult) -> Void) {
        guard let scheme = releasesURL.scheme?.lowercased(), ["http", "https", "file"].contains(scheme) else {
            DispatchQueue.main.async { completion(.failed("GitHub Releases 地址无效")) }
            return
        }

        if scheme == "file" {
            DispatchQueue.global(qos: .utility).async {
                do {
                    let data = try Data(contentsOf: self.releasesURL)
                    self.finishGitHubCheck(data: data, currentVersion: currentVersion, completion: completion)
                } catch { DispatchQueue.main.async { completion(.failed(error.localizedDescription)) } }
            }
            return
        }

        var request = URLRequest(url: releasesURL)
        request.setValue("Deepseek Harness Launcher", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        session.dataTask(with: request) { data, response, error in
            if let error { DispatchQueue.main.async { completion(.failed(error.localizedDescription)) }; return }
            guard let http = response as? HTTPURLResponse else {
                DispatchQueue.main.async { completion(.failed("GitHub Releases 返回了无效响应")) }
                return
            }
            if http.statusCode == 404 {
                DispatchQueue.main.async { completion(.noPublishedRelease) }
                return
            }
            if http.statusCode == 403 {
                self.checkAtomFeed(currentVersion: currentVersion, completion: completion)
                return
            }
            guard (200..<300).contains(http.statusCode), let data else {
                let message = "GitHub Releases 请求失败（HTTP \(http.statusCode)）"
                DispatchQueue.main.async { completion(.failed(message)) }
                return
            }
            self.finishGitHubCheck(data: data, currentVersion: currentVersion, completion: completion)
        }.resume()
    }

    private func checkAtomFeed(currentVersion: String, completion: @escaping (UpdateCheckResult) -> Void) {
        loadData(from: feedURL) { result in
            switch result {
            case .failure:
                DispatchQueue.main.async { completion(.failed("GitHub Releases 暂时无法访问（API 限流且备用源不可用）")) }
            case .success(let data):
                guard let release = AtomReleaseParser().parse(data) else {
                    DispatchQueue.main.async { completion(.noPublishedRelease) }
                    return
                }
                let version = release.tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV "))
                guard !version.isEmpty else {
                    DispatchQueue.main.async { completion(.failed("GitHub Release 缺少版本号")) }
                    return
                }
                let dmgURL = "https://github.com/\(Self.repository)/releases/download/\(release.tag)/\(Self.dmgAssetName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? Self.dmgAssetName)"
                let manifest = UpdateManifest(version: version, dmgURL: dmgURL, notes: release.title, publishedAt: nil)
                let result: UpdateCheckResult = compareVersions(currentVersion, version) == .orderedAscending ? .available(manifest) : .current
                DispatchQueue.main.async { completion(result) }
            }
        }
    }

    private func loadData(from url: URL, completion: @escaping (Result<Data, Error>) -> Void) {
        if url.scheme?.lowercased() == "file" {
            DispatchQueue.global(qos: .utility).async {
                completion(Result { try Data(contentsOf: url) })
            }
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Deepseek Harness Launcher", forHTTPHeaderField: "User-Agent")
        request.setValue("application/atom+xml, application/xml;q=0.9, */*;q=0.8", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        session.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                completion(.failure(UpdateError.invalidResponse)); return
            }
            completion(.success(data))
        }.resume()
    }

    func download(
        _ manifest: UpdateManifest,
        onProgress: @escaping (UpdateDownloadProgress) -> Void = { _ in },
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        guard let url = URL(string: manifest.dmgURL), ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else {
            DispatchQueue.main.async { completion(.failure(UpdateError.invalidDownloadURL)) }
            return
        }
        let destination = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent("Deepseek Harness Launcher-\(manifest.version).dmg")
        try? FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)

        if url.scheme?.lowercased() == "file" {
            do {
                let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
                onProgress(UpdateDownloadProgress(bytesWritten: 0, totalBytes: bytes > 0 ? bytes : nil))
                try copyReplacing(source: url, destination: destination)
                onProgress(UpdateDownloadProgress(bytesWritten: bytes, totalBytes: bytes > 0 ? bytes : nil))
                DispatchQueue.main.async { completion(.success(destination)) }
            } catch { DispatchQueue.main.async { completion(.failure(error)) } }
            return
        }

        let delegate = DownloadDelegate(destination: destination, onProgress: onProgress) { [weak self] result in
            self?.activeDownload = nil
            completion(result)
        }
        activeDownload = delegate
        delegate.start(url: url)
    }

    private func finishGitHubCheck(data: Data, currentVersion: String, completion: @escaping (UpdateCheckResult) -> Void) {
        do {
            let release = try JSONDecoder().decode(GitHubRelease.self, from: data)
            let version = release.tagName.trimmingCharacters(in: CharacterSet(charactersIn: "vV "))
            guard !version.isEmpty else {
                DispatchQueue.main.async { completion(.failed("GitHub Release 缺少版本号")) }
                return
            }
            guard let asset = release.assets.first(where: { $0.name.caseInsensitiveCompare(Self.dmgAssetName) == .orderedSame }) else {
                DispatchQueue.main.async { completion(.failed("GitHub Release 未包含 \(Self.dmgAssetName)")) }
                return
            }
            let manifest = UpdateManifest(
                version: version,
                dmgURL: asset.browserDownloadURL,
                notes: release.body?.isEmpty == false ? release.body : release.name,
                publishedAt: release.publishedAt
            )
            let result: UpdateCheckResult = compareVersions(currentVersion, manifest.version) == .orderedAscending ? .available(manifest) : .current
            DispatchQueue.main.async { completion(result) }
        } catch { DispatchQueue.main.async { completion(.failed("GitHub Release 数据格式无效")) } }
    }

    private func copyReplacing(source: URL, destination: URL) throws {
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.copyItem(at: source, to: destination)
    }
}

enum UpdateError: LocalizedError {
    case invalidDownloadURL
    case missingDownload
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidDownloadURL: return "更新包地址无效"
        case .missingDownload: return "未收到更新包"
        case .invalidResponse: return "GitHub Releases 返回了无效响应"
        }
    }
}
