import Foundation

// MARK: - npm 语义的版本比较
//
// dsh 与插件的版本号是标准 npm 语义（`0.1.7-alpha.1`、`0.1.5-rc.3`）。启动器自己的
// `compareVersions`（UpdateSupport.swift）面向 `x.y.z-a.b[-SNAPSHOT]` 的发布周期号，
// 会把 `rc.1` 与 `rc.6` 判成同一个版本——用来判更新提示可以，用来判兼容性会出错。
// 这两套语义各管各的：需要 npm 语义的地方（dsh 更新判断、插件 peer 区间）都用这里。
// 本文件从 DSHUpdateSupport.swift 拆出，好让兼容性单测不必链进网络与安装代码。

func normalizedDSHVersion(_ raw: String) -> String {
    var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    for prefix in ["dsh-v", "dsh-"] where value.hasPrefix(prefix) {
        value.removeFirst(prefix.count)
        return value
    }
    if value.hasPrefix("v"), value.dropFirst().first?.isNumber == true {
        value.removeFirst()
    }
    return value
}

enum DSHPrereleaseIdentifier: Equatable {
    case number(Int)
    case text(String)
}

struct ParsedDSHVersion {
    var base: [Int]
    var prerelease: [DSHPrereleaseIdentifier]?
}

func parseDSHVersion(_ raw: String) -> ParsedDSHVersion {
    let value = normalizedDSHVersion(raw)
    // 构建元数据（`+build`）不参与比较。
    let withoutBuild = value.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? value
    let parts = withoutBuild.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
    let base = String(parts.first ?? "").split(separator: ".").map { Int($0) ?? 0 }
    let prerelease = parts.count > 1
        ? String(parts[1]).split(separator: ".").map { token -> DSHPrereleaseIdentifier in
            if let number = Int(token) { return .number(number) }
            return .text(String(token).lowercased())
        }
        : nil
    return ParsedDSHVersion(
        base: base.isEmpty ? [0] : base,
        prerelease: (prerelease?.isEmpty ?? true) ? nil : prerelease
    )
}

/// 先比基础版本，再按 semver 比较预发布标识：数字段按数值、数字段低于字母段、字母段
/// 按字典序，前缀相同则标识更多的一方更高；同 base 下预发布低于正式版。
func compareDSHVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
    let left = parseDSHVersion(lhs)
    let right = parseDSHVersion(rhs)

    for index in 0..<max(left.base.count, right.base.count) {
        let l = index < left.base.count ? left.base[index] : 0
        let r = index < right.base.count ? right.base[index] : 0
        if l < r { return .orderedAscending }
        if l > r { return .orderedDescending }
    }
    switch (left.prerelease, right.prerelease) {
    case (nil, nil):
        return .orderedSame
    case (nil, .some):
        return .orderedDescending
    case (.some, nil):
        return .orderedAscending
    case (.some(let l), .some(let r)):
        for index in 0..<max(l.count, r.count) {
            if index >= l.count { return .orderedAscending }
            if index >= r.count { return .orderedDescending }
            switch (l[index], r[index]) {
            case (.number(let a), .number(let b)):
                if a != b { return a < b ? .orderedAscending : .orderedDescending }
            case (.text(let a), .text(let b)):
                if a != b { return a < b ? .orderedAscending : .orderedDescending }
            case (.number, .text):
                return .orderedAscending
            case (.text, .number):
                return .orderedDescending
            }
        }
        return .orderedSame
    }
}

