import Foundation

@main
struct UpdateSupportChecks {
    static func main() {
        precondition(compareVersions("0.1.1", "0.1.2") == .orderedAscending)
        precondition(compareVersions("1.0", "1.0.0") == .orderedSame)
        precondition(compareVersions("2.0.0", "1.9.9") == .orderedDescending)

        let manifestURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("dsh-update-manifest-\(ProcessInfo.processInfo.processIdentifier).json")
        let manifest = "{\"version\":\"9.9.9\",\"dmgURL\":\"file:///tmp/DSH.dmg\",\"notes\":\"test\"}"
        try! manifest.data(using: .utf8)!.write(to: manifestURL)

        var completed = false
        UpdateService().check(currentVersion: "0.1.0", feedURL: manifestURL.absoluteString) { result in
            if case .available(let update) = result {
                precondition(update.version == "9.9.9")
            } else {
                preconditionFailure("expected available update")
            }
            completed = true
        }
        let deadline = Date().addingTimeInterval(5)
        while !completed && Date() < deadline {
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        precondition(completed)
        print("update support checks passed")
    }
}
