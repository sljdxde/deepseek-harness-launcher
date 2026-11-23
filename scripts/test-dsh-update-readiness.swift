import Foundation

private final class ReadinessURLProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recordedRequests: [URLRequest] = []
    private static var recordedProblem: String?

    static func reset() {
        lock.lock()
        recordedRequests = []
        recordedProblem = nil
        lock.unlock()
    }

    static func result() -> (requests: [URLRequest], problem: String?) {
        lock.lock()
        defer { lock.unlock() }
        return (recordedRequests, recordedProblem)
    }

    private static func record(_ request: URLRequest) {
        lock.lock()
        recordedRequests.append(request)
        lock.unlock()
    }

    private static func record(problem: String) {
        lock.lock()
        if recordedProblem == nil { recordedProblem = problem }
        lock.unlock()
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.record(request)
        guard let url = request.url else {
            finishWithProblem("请求缺少 URL")
            return
        }
        if url.path == "/" {
            guard request.httpMethod == "GET",
                  URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.contains(where: { $0.name == "token" && $0.value == "fixture" }) == true else {
                finishWithProblem("启动 token 未按 GET 请求发送")
                return
            }
            let response = HTTPURLResponse(
                url: url,
                statusCode: 302,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Location": "/",
                    "Set-Cookie": "fixture-session=1; Path=/; HttpOnly"
                ]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data())
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        guard url.path == "/api/agentPresets/list", request.httpMethod == "POST" else {
            finishWithProblem("未请求默认预设 RPC")
            return
        }
        guard request.value(forHTTPHeaderField: "Origin") == "http://127.0.0.1:34567" else {
            finishWithProblem("RPC 缺少本机 Origin")
            return
        }
        guard request.value(forHTTPHeaderField: "Cookie")?.contains("fixture-session=1") == true else {
            finishWithProblem("启动 token 未换成本次探测使用的 Cookie")
            return
        }
        guard let bodyData = requestBody(request),
              let body = String(data: bodyData, encoding: .utf8),
              body.contains(#""method":"agentPresets/list""#),
              let requestJSON = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any],
              let rpcID = requestJSON["rpcId"] as? String else {
            finishWithProblem("RPC 请求体不正确")
            return
        }
        let responseObject: [String: Any] = [
            "type": "server-response",
            "rpcId": rpcID,
            "result": [
                "ok": true,
                "value": [
                    "presets": [
                        ["id": "default", "isDefault": true]
                    ]
                ]
            ]
        ]
        guard let responseData = try? JSONSerialization.data(withJSONObject: responseObject) else {
            finishWithProblem("无法编码 RPC 测试响应")
            return
        }
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: responseData)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private func finishWithProblem(_ problem: String) {
        Self.record(problem: problem)
        client?.urlProtocol(self, didFailWithError: NSError(
            domain: "DSHUpdateReadinessChecks",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: problem]
        ))
    }

    private func requestBody(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data.isEmpty ? nil : data
    }
}

@main
struct DSHUpdateReadinessChecks {
    private static let rpcID = "dsh-update-readiness-test"

    private static func response(_ presets: String, id: String = rpcID) -> Data {
        Data("""
        {"type":"server-response","rpcId":"\(id)","result":{"ok":true,"value":{"presets":\(presets)}}}
        """.utf8)
    }

    private static func check(_ condition: Bool, _ message: String) {
        guard condition else {
            print("FAIL: \(message)")
            exit(1)
        }
    }

    private static func testInspectRequestChain() {
        ReadinessURLProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ReadinessURLProtocol.self]
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        let finished = DispatchSemaphore(value: 0)
        var verdict: DSHDefaultSessionReadiness?
        guard let entry = URL(string: "http://127.0.0.1:34567/?token=fixture") else {
            check(false, "无法构造测试入口 URL")
            return
        }
        DSHDefaultSessionReadiness.inspect(entryURL: entry, configuration: config) { result in
            verdict = result
            finished.signal()
        }
        guard finished.wait(timeout: .now() + 5) == .success else {
            check(false, "默认预设探测超时")
            return
        }
        let observed = ReadinessURLProtocol.result()
        check(observed.problem == nil, observed.problem ?? "")
        check(observed.requests.count == 2, "启动 token 和默认预设 RPC 应各请求一次")
        check(verdict == .ready, "成功完成 token 换 Cookie 后应判定默认预设可用")
    }

    static func main() {
        testInspectRequestChain()

        // rc.5 实测：归档接口已就绪，默认预设因缺少 workflowEngine 无法创建会话。
        let brokenDefault = response("""
        [{"id":"default","isDefault":true,"broken":"tool-workflow (@deepseek-ai/dsh-tool-workflow): waiting for workflowEngine"},
         {"id":"alternate","isDefault":false}]
        """)
        var checkup = DSHUpdateReadiness(archiveReady: true)
        checkup.session = DSHDefaultSessionReadiness.decode(brokenDefault, rpcID: rpcID)
        check(checkup.session == .broken, "默认预设的明确故障应被识别")
        check(!checkup.canDiscardRollback, "归档虽然就绪，会话不可用时必须保留回退快照")

        let healthyDefault = response("""
        [{"id":"default","isDefault":true},{"id":"alternate","isDefault":false,"broken":"unused preset"}]
        """)
        checkup.session = DSHDefaultSessionReadiness.decode(healthyDefault, rpcID: rpcID)
        check(checkup.session == .ready, "仅备用预设故障时，默认会话仍可用")
        check(checkup.canDiscardRollback, "归档和默认会话都可用后可以清理快照")
        checkup.archiveReady = false
        check(!checkup.canDiscardRollback, "归档尚未就绪时仍保留快照")

        let unverified = [
            response("[]"),
            response(#"[{"id":"alternate","isDefault":false}]"#),
            response(#"[{"id":"first","isDefault":true},{"id":"second","isDefault":true}]"#),
            response(#"[{"id":"default","isDefault":true,"broken":" "}]"#),
            response(#"[{"id":"default","isDefault":true}]"#, id: "another-request"),
            Data(#"{"type":"server-response","rpcId":"dsh-update-readiness-test","result":{"ok":false,"error":{"code":"remote/not-found"}}}"#.utf8),
            Data("<html>登录页</html>".utf8),
        ]
        checkup.archiveReady = true
        for data in unverified {
            checkup.session = DSHDefaultSessionReadiness.decode(data, rpcID: rpcID)
            check(checkup.session == .unverified, "接口缺失或响应无法确认时，应保留未验证状态")
            check(!checkup.canDiscardRollback, "未验证的会话状态不得清理回退快照")
        }
        print("dsh update readiness checks passed")
    }
}
