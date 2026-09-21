import Foundation

// 启动器对真实 dsh Web 服务的两处基本判定（见 Sources/HarnessWebCompatibility.swift）。
// dsh 0.1.5-rc.2 改变过这两处对应的外部行为（token 认证入口行、401 固定文案），
// 这里用真实日志/响应形态做回归锚点；端到端验证见 scripts/test-dsh-integration.sh。

var failures: [String] = []
func check(_ condition: Bool, _ message: String) {
    if !condition { failures.append(message) }
}

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
