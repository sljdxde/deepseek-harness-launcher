import Foundation

/// 对真实 dsh Web 服务的两处基本判定，从启动器主类抽出以便单元测试覆盖。
/// dsh 升级多次改变这两处对应的外部行为（0.1.5-rc.2 起首页要求 token 认证、
/// 401 文案固定），这里集中实现并由 `scripts/test-harness-web-compat.swift`
/// 与 `scripts/test-dsh-integration.sh`（真实 dsh 端到端）双重验证。
enum HarnessWebCompatibility {
    /// 从 dsh stdout 捕获 `dsh web: <url>` 入口行。0.1.5-rc.2 起该 URL 携带
    /// `?token=` 认证参数（浏览器首次访问用它换取会话 cookie）；旧版无 token。
    /// 中文日志前后缀不能吞进 URL；端口不匹配的行（外部实例）必须拒绝。
    ///
    /// dsh 打印的是**配置里的公开地址**（本机 profile 配了 Tailscale
    /// `--public-url` 时就是 `http://<机器>.ts.net/?token=…`）。启动器在本机，
    /// 入口必须 rebase 回 `http://127.0.0.1:<port>/`：
    /// - token 换 cookie 的域是「实际请求的 authority」。拿公开域名去加载，会把
    ///   内置窗口的 cookie 绑到那个域名上；网络/Tailscale 任何波动都会让窗口
    ///   显示 401（2026-11-11 实测：捕获被旧「端口不匹配即拒绝」规则丢弃，
    ///   窗口直接落到裸地址的 401 页）；
    /// - 本机 loopback 才是启动器与 dsh 之间稳定的那条路。
    ///
    /// 对 loopback 地址仍保留端口校验：那是「同一端口段里另一个实例的日志混进来」
    /// 的防线；非 loopback 的公开地址只可能来自本进程自己的 `dsh web:` 行。
    static func webEntryURL(fromOutput output: String, port: Int) -> URL? {
        let pattern = #"dsh web: (https?://[^\s\x{4e00}-\x{9fff}]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(output.startIndex..., in: output)
        guard let match = regex.firstMatch(in: output, range: range),
              match.numberOfRanges >= 2,
              let captureRange = Range(match.range(at: 1), in: output) else { return nil }
        guard let url = URL(string: String(output[captureRange])) else { return nil }
        return localEntryURL(from: url, port: port)
    }

    /// 把 dsh 打印的入口地址换算成启动器该加载的 loopback 地址。
    /// - loopback 地址：端口必须等于启动器监听的端口，否则返回 nil；
    /// - 非 loopback 公开地址：换成本机 `http://127.0.0.1:<port>/`，保留 query
    ///   （token 就在这里）与 path 的根挂载（dsh 本机监听永远挂在 `/`）。
    static func localEntryURL(from printed: URL, port: Int) -> URL? {
        guard port > 0, port < 65536 else { return nil }
        let host = printed.host?.lowercased() ?? ""
        let loopbackHosts: Set<String> = ["127.0.0.1", "localhost", "::1", "[::1]"]
        if loopbackHosts.contains(host) {
            guard printed.port == port else { return nil }
            if printed.path.isEmpty,
               var components = URLComponents(url: printed, resolvingAgainstBaseURL: false) {
                components.path = "/"
                return components.url
            }
            return printed
        }
        // 非 loopback 只会出现在 dsh 打印的公开地址里；像 `127.0.0.` 这种被截断的
        // 半截 IPv4 不是合法主机名，不能当公开地址 rebase。
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard let scheme = printed.scheme?.lowercased(), scheme == "http" || scheme == "https",
              !host.isEmpty, labels.allSatisfy({ !$0.isEmpty }),
              var components = URLComponents(url: printed, resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = port
        components.path = "/"
        components.fragment = nil
        return components.url
    }

    /// 判定响应体是否来自「在跑的 dsh」。两种形态都算：
    /// - 旧版/已认证：页面含 deepseek 与 dsh 资产标记；
    /// - 0.1.5-rc.2+ 未认证：根路径返回 401 固定文案——服务其实已就绪，
    ///   不识别它会导致启动器永远等不到就绪（10 分钟超时误杀）。
    static func isHarnessWebBody(_ body: String) -> Bool {
        if body.localizedCaseInsensitiveContains("dsh web authentication required") { return true }
        return body.localizedCaseInsensitiveContains("deepseek") &&
            body.localizedCaseInsensitiveContains("dsh")
    }
}
