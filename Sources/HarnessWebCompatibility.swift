import Foundation

/// 对真实 dsh Web 服务的两处基本判定，从启动器主类抽出以便单元测试覆盖。
/// dsh 升级多次改变这两处对应的外部行为（0.1.5-rc.2 起首页要求 token 认证、
/// 401 文案固定），这里集中实现并由 `scripts/test-harness-web-compat.swift`
/// 与 `scripts/test-dsh-integration.sh`（真实 dsh 端到端）双重验证。
enum HarnessWebCompatibility {
    /// 从 dsh stdout 捕获 `dsh web: <url>` 入口行。0.1.5-rc.2 起该 URL 携带
    /// `?token=` 认证参数（浏览器首次访问用它换取会话 cookie）；旧版无 token。
    /// 中文日志前后缀不能吞进 URL；端口不匹配的行（外部实例）必须拒绝。
    static func webEntryURL(fromOutput output: String, port: Int) -> URL? {
        let pattern = #"dsh web: (https?://[^\s\x{4e00}-\x{9fff}]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(output.startIndex..., in: output)
        guard let match = regex.firstMatch(in: output, range: range),
              match.numberOfRanges >= 2,
              let captureRange = Range(match.range(at: 1), in: output) else { return nil }
        guard let url = URL(string: String(output[captureRange])) else { return nil }
        guard url.port == port else { return nil }
        return url
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
