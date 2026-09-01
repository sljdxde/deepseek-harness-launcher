import Foundation
import Darwin

struct UpdateManifest: Codable {
    let version: String
    let dmgURL: String
    let notes: String?
    let publishedAt: String?
}

enum UpdateCheckResult {
    case noPublishedRelease
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
    static let dmgAssetName = "Deepseek Harness Launcher.dmg"
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

    func download(_ manifest: UpdateManifest, completion: @escaping (Result<URL, Error>) -> Void) {
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
