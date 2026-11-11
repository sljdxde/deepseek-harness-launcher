import Foundation

// 启动器对真实 dsh Web 服务的两处基本判定（见 Sources/HarnessWebCompatibility.swift）。
// dsh 0.1.5-rc.2 改变过这两处对应的外部行为（token 认证入口行、401 固定文案），
// 这里用真实日志/响应形态做回归锚点；端到端验证见 scripts/test-dsh-integration.sh。

@main
struct HarnessWebCompatChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
    if !condition { failures.append(message) }
}

    static func main() {
// MARK: - webEntryURL（stdout 认证入口捕获）

// 0.1.5-rc.2 真实形态：带 token
let tokenLine = "dsh web: http://127.0.0.1:3099/?token=_p5iw14CmWMLKJSHjU8EDpaJZZUJ6AW5I4JrOOojViI\n"
let tokenURL = HarnessWebCompatibility.webEntryURL(fromOutput: tokenLine, port: 3099)
check(tokenURL?.absoluteString == "http://127.0.0.1:3099/?token=_p5iw14CmWMLKJSHjU8EDpaJZZUJ6AW5I4JrOOojViI",
      "带 token 的入口行未完整捕获：\(tokenURL?.absoluteString ?? "nil")")
check(tokenURL?.port == 3099, "token 入口行端口解析错误")

// 旧版形态：无 token
let plainURL = HarnessWebCompatibility.webEntryURL(fromOutput: "dsh web: http://127.0.0.1:3080\n", port: 3080)
check(plainURL?.absoluteString == "http://127.0.0.1:3080/", "无 token 入口行未捕获：\(plainURL?.absoluteString ?? "nil")")

// 逐段输出的 stdout：URL 被拆在多个 chunk 里（非完整行）
let fragment = HarnessWebCompatibility.webEntryURL(fromOutput: "dsh web: http://127.0.0.", port: 3080)
check(fragment == nil, "不完整 URL 不应被捕获")

// 端口不匹配（外部实例占用同端口段）必须拒绝
let wrongPort = HarnessWebCompatibility.webEntryURL(fromOutput: tokenLine, port: 3081)
check(wrongPort == nil, "端口不匹配的入口行不应被捕获")

// 真实配置了 --public-url（Tailscale 域名）时，dsh 打印的是公开地址：
// 启动器必须 rebase 回本机 loopback，否则内置窗口拿公开域名换 cookie，
// 网络/Tailscale 一波动就落到 401 页（2026-11-11 实测）。
let publicLine = "dsh web: http://yuzhoumac-mini.tail1b9935.ts.net/?token=abc123\n"
let publicURL = HarnessWebCompatibility.webEntryURL(fromOutput: publicLine, port: 3080)
check(publicURL?.absoluteString == "http://127.0.0.1:3080/?token=abc123",
      "公开地址入口未 rebase 到 loopback：\(publicURL?.absoluteString ?? "nil")")
check(publicURL?.port == 3080, "rebase 后端口必须等于启动器监听端口")

// 带路径前缀的公开地址（反向代理）同样以本机根挂载为准，token 保留
let publicPrefixed = "dsh web: https://example.com/dsh/?token=abc"
let prefixedURL = HarnessWebCompatibility.webEntryURL(fromOutput: publicPrefixed, port: 3082)
check(prefixedURL?.absoluteString == "http://127.0.0.1:3082/?token=abc",
      "公开前缀地址 rebase 错误：\(prefixedURL?.absoluteString ?? "nil")")

// URL 后紧跟中文日志内容时不得把中文吞进 URL
let cjkLine = "dsh web: http://127.0.0.1:3080/?token=abc 后续日志"
let cjkURL = HarnessWebCompatibility.webEntryURL(fromOutput: cjkLine, port: 3080)
check(cjkURL?.absoluteString == "http://127.0.0.1:3080/?token=abc", "中文后缀未正确截断：\(cjkURL?.absoluteString ?? "nil")")

// 无关输出不产生误报
check(HarnessWebCompatibility.webEntryURL(fromOutput: "npm warn deprecated x\n", port: 3080) == nil, "无关输出不应捕获 URL")
check(HarnessWebCompatibility.webEntryURL(fromOutput: "", port: 3080) == nil, "空输出不应捕获 URL")

// MARK: - isHarnessWebBody（就绪/复用探测判定）

// 0.1.5-rc.2+ 未认证 401 固定文案：服务已就绪，必须判定为真
check(HarnessWebCompatibility.isHarnessWebBody("dsh web authentication required; reopen the URL printed by dsh web.\n"),
      "401 认证文案未被识别为在跑的 dsh")

// 旧版/已认证页面：deepseek + dsh 资产标记
let htmlBody = #"<!doctype html><html><head><base href="/"></head><body class="deepseek-harness" data-app="dsh"></body></html>"#
check(HarnessWebCompatibility.isHarnessWebBody(htmlBody), "Harness 页面未被识别")

// 大小写不敏感
check(HarnessWebCompatibility.isHarnessWebBody("DeepSeek DSH"), "大小写变体未被识别")

// 非 Harness 页面（同端口的其他服务）必须为假
check(!HarnessWebCompatibility.isHarnessWebBody("<html><body>hello world</body></html>"), "无关页面被误判为 Harness")
check(!HarnessWebCompatibility.isHarnessWebBody(""), "空响应被误判为 Harness")
// 只含其中一个标记不算
check(!HarnessWebCompatibility.isHarnessWebBody("dsh only marker"), "单一标记不应判定成功")

if !failures.isEmpty {
    for failure in failures { print("FAIL: \(failure)") }
    exit(1)
}
print("harness web compatibility checks passed")
    }
}
