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

    private static func request(url: URL, timeout: TimeInterval) -> URLRequest {
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        return request
    }
}
