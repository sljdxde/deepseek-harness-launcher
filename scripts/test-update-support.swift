import Foundation

private final class HTTPStatusProtocol: URLProtocol {
    static var statusCode = 200
    static var body = Data()
    static var atomBody = Data()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let isAtomRequest = request.url?.path.hasSuffix(".atom") == true
        let statusCode = isAtomRequest ? 200 : Self.statusCode
        let body = isAtomRequest ? Self.atomBody : Self.body
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: nil
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !body.isEmpty { client?.urlProtocol(self, didLoad: body) }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@main
struct UpdateSupportChecks {
    static func main() {
        precondition(compareVersions("0.1.1", "0.1.2") == .orderedAscending)
        precondition(compareVersions("1.0", "1.0.0") == .orderedSame)
        precondition(compareVersions("2.0.0", "1.9.9") == .orderedDescending)

        let manifestURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("dhl-update-manifest-\(ProcessInfo.processInfo.processIdentifier).json")
        let manifest = "{\"tag_name\":\"v9.9.9\",\"name\":\"Deepseek Harness Launcher v9.9.9\",\"body\":\"test\",\"published_at\":\"2026-09-01T00:00:00Z\",\"assets\":[{\"name\":\"Deepseek Harness Launcher.dmg\",\"browser_download_url\":\"file:///tmp/Deepseek%20Harness%20Launcher.dmg\"}]}"
        try! manifest.data(using: .utf8)!.write(to: manifestURL)

        var completed = false
        UpdateService(releasesURL: manifestURL).check(currentVersion: "0.1.0") { result in
            if case .available(let update) = result {
                precondition(update.version == "9.9.9")
            } else {
                preconditionFailure("expected available update")
            }
            completed = true
        }
        let deadline = Date().addingTimeInterval(5)
        while !completed && Date() < deadline {
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        precondition(completed)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HTTPStatusProtocol.self]
        HTTPStatusProtocol.statusCode = 404
        HTTPStatusProtocol.body = Data()
        HTTPStatusProtocol.atomBody = Data()
        completed = false
        UpdateService(
            releasesURL: URL(string: "https://api.github.test/releases/latest")!,
            session: URLSession(configuration: configuration)
        ).check(currentVersion: "0.1.0") { result in
            guard case .noPublishedRelease = result else {
                preconditionFailure("expected no published release")
            }
            completed = true
        }
        let unavailableDeadline = Date().addingTimeInterval(5)
        while !completed && Date() < unavailableDeadline {
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        precondition(completed)

        HTTPStatusProtocol.statusCode = 403
        HTTPStatusProtocol.body = Data()
        HTTPStatusProtocol.atomBody = Data("<?xml version=\"1.0\"?><feed><entry><title>v9.9.9</title><link href=\"https://github.com/sljdxde/deepseek-harness-launcher/releases/tag/v9.9.9\" /></entry></feed>".utf8)
        completed = false
        UpdateService(
            releasesURL: URL(string: "https://api.github.test/releases/latest")!,
            feedURL: URL(string: "https://github.test/releases.atom")!,
            session: URLSession(configuration: configuration)
        ).check(currentVersion: "0.1.0") { result in
            guard case .available(let update) = result, update.version == "9.9.9" else {
                preconditionFailure("expected Atom fallback update")
            }
            precondition(update.dmgURL.contains("Deepseek%20Harness%20Launcher.dmg"))
            completed = true
        }
        let fallbackDeadline = Date().addingTimeInterval(5)
        while !completed && Date() < fallbackDeadline {
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        precondition(completed)
        print("update support checks passed")
    }
}
