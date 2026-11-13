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

    /// 同步探针，返回状态码与响应体；连接失败/超时返回 nil。
    ///
    /// 内置插件的兼容性判定必须区分「接口确定不存在（404）」与「这次没等到响应」：
    /// 后者只是证据缺失（dsh 正忙、接口慢），拿它判「插件没加载」就是误报。
    static func response(at url: URL, timeout: TimeInterval = 1.5) -> (status: Int?, body: String?)? {
        let semaphore = DispatchSemaphore(value: 0)
        var result: (status: Int?, body: String?)?
        let task = URLSession.shared.dataTask(with: request(url: url, timeout: timeout)) { data, response, error in
            // 只有真正收到 HTTP 响应才算数；超时/连接失败（error != nil）留 nil。
            if error == nil, let http = response as? HTTPURLResponse {
                result = (http.statusCode, data.flatMap { String(data: $0, encoding: .utf8) })
            }
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
