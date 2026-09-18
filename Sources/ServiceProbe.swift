import Foundation

enum ServiceProbe {
    static func body(at url: URL, timeout: TimeInterval = 1.5) -> String? {
        let semaphore = DispatchSemaphore(value: 0)
        var result: String?
        let task = URLSession.shared.dataTask(with: request(url: url, timeout: timeout)) { data, _, _ in
            result = data.flatMap { String(data: $0, encoding: .utf8) }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 0.5)
        task.cancel()
        return result
    }

    static func body(at url: URL, timeout: TimeInterval = 1.5, completion: @escaping (String?) -> Void) {
        URLSession.shared.dataTask(with: request(url: url, timeout: timeout)) { data, _, _ in
            let body = data.flatMap { String(data: $0, encoding: .utf8) }
            DispatchQueue.main.async { completion(body) }
        }.resume()
    }

    /// Fire a small loopback JSON command without making callers handle the
    /// response body. HTTP failures are intentionally returned as nil so
    /// optional launcher enhancements can fall back to their base behavior.
    static func postJSON(at url: URL, body: Data, timeout: TimeInterval = 1.5, completion: ((Int?) -> Void)? = nil) {
        var request = request(url: url, timeout: timeout)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode
            guard let completion else { return }
            DispatchQueue.main.async { completion(status) }
        }.resume()
    }

    private static func request(url: URL, timeout: TimeInterval) -> URLRequest {
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        return request
    }
}
