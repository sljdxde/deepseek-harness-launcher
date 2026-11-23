import Foundation

struct DSHUpdateReadiness {
    var archiveReady = false
    var session: DSHDefaultSessionReadiness = .unverified

    var canDiscardRollback: Bool {
        archiveReady && session == .ready
    }
}

enum DSHDefaultSessionReadiness: Equatable {
    case ready
    case broken
    case unverified

    private struct Response: Decodable {
        struct Preset: Decodable {
            let id: String
            let isDefault: Bool
            let broken: String?
        }

        struct Value: Decodable {
            let presets: [Preset]
        }

        struct Result: Decodable {
            let ok: Bool
            let value: Value?
        }

        let type: String
        let rpcId: String
        let result: Result
    }

    static func decode(_ data: Data, rpcID: String) -> Self {
        guard let response = try? JSONDecoder().decode(Response.self, from: data),
              response.type == "server-response",
              response.rpcId == rpcID,
              response.result.ok,
              let presets = response.result.value?.presets else { return .unverified }
        let defaults = presets.filter(\.isDefault)
        guard defaults.count == 1, let preset = defaults.first, !preset.id.isEmpty else { return .unverified }
        guard let reason = preset.broken else { return .ready }
        return reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .unverified : .broken
    }

    /// 查询 DSH 的默认会话预设，不创建会话，也不要求用户已配置模型凭据。
    static func inspect(
        entryURL: URL,
        configuration suppliedConfiguration: URLSessionConfiguration? = nil,
        completion: @escaping (Self) -> Void
    ) {
        guard var origin = URLComponents(url: entryURL, resolvingAgainstBaseURL: false),
              let host = origin.host?.lowercased(), ["127.0.0.1", "localhost", "[::1]", "::1"].contains(host),
              origin.scheme == "http" || origin.scheme == "https",
              origin.port != nil, origin.user == nil, origin.password == nil,
              origin.path.isEmpty || origin.path == "/" else {
            completion(.unverified)
            return
        }
        let needsCookie = origin.queryItems?.contains { $0.name == "token" } == true
        origin.query = nil
        origin.fragment = nil
        origin.path = ""
        guard let originURL = origin.url else {
            completion(.unverified)
            return
        }

        // 启动 token 只交给本机 DSH。Cookie 随本次探测释放，不进浏览器或共享存储。
        let config = suppliedConfiguration ?? URLSessionConfiguration.ephemeral
        if suppliedConfiguration == nil {
            config.connectionProxyDictionary = [:]
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            config.timeoutIntervalForRequest = 3
            config.timeoutIntervalForResource = 5
        }
        let session = URLSession(configuration: config, delegate: NoProbeRedirects(), delegateQueue: nil)
        let finish: (Self) -> Void = { verdict in
            session.finishTasksAndInvalidate()
            completion(verdict)
        }
        let readPreset: ([HTTPCookie]) -> Void = { cookies in
            let rpcID = UUID().uuidString
            var request = URLRequest(url: originURL.appendingPathComponent("api/agentPresets/list"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(originURL.absoluteString, forHTTPHeaderField: "Origin")
            if !cookies.isEmpty {
                let cookieHeader = cookies
                    .sorted { $0.name < $1.name }
                    .map { "\($0.name)=\($0.value)" }
                    .joined(separator: "; ")
                request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
            }
            request.httpBody = Data("""
            {"type":"client-request","rpcId":"\(rpcID)","method":"agentPresets/list","payload":{"args":{}}}
            """.utf8)
            session.dataTask(with: request) { data, response, error in
                guard error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data else {
                    finish(.unverified)
                    return
                }
                finish(decode(data, rpcID: rpcID))
            }.resume()
        }
        if needsCookie {
            session.dataTask(with: entryURL) { _, response, error in
                // DSH 通过 3xx + Set-Cookie 换取认证。只需要 cookie，无需再载入首页。
                guard error == nil, let http = response as? HTTPURLResponse, (200..<400).contains(http.statusCode) else {
                    finish(.unverified)
                    return
                }
                let cookies = authenticationCookies(from: http, url: entryURL)
                guard !cookies.isEmpty else {
                    finish(.unverified)
                    return
                }
                readPreset(cookies)
            }.resume()
        } else {
            readPreset([])
        }
    }

    private static func authenticationCookies(from response: HTTPURLResponse, url: URL) -> [HTTPCookie] {
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
            guard let name = pair.key as? String, let value = pair.value as? String else { return }
            result[name] = value
        }
        return HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
    }
}

private final class NoProbeRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
