import Foundation

@main
struct LauncherSupportChecks {
    static func main() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("dhl-launcher-support-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let profile = root.appendingPathComponent("profile/node_modules", isDirectory: true)
        let currentPlugin = root.appendingPathComponent("Deepseek Harness Launcher.app/Contents/Resources/DSHArchiveManager", isDirectory: true)
        let stalePlugin = root.appendingPathComponent("DSH.app/Contents/Resources/DSHArchiveManager", isDirectory: true)
        try FileManager.default.createDirectory(at: currentPlugin, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)

        let link = profile.appendingPathComponent("dsh-archive-manager")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: stalePlugin)
        precondition(!FileManager.default.fileExists(atPath: link.path))

        precondition(ensureArchivePluginLink(pluginURL: currentPlugin, profileURL: profile))
        let repairedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: link.path)
        precondition(repairedDestination == currentPlugin.path)

        let foreign = root.appendingPathComponent("foreign-plugin", isDirectory: true)
        try FileManager.default.removeItem(at: link)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: foreign)
        precondition(!ensureArchivePluginLink(pluginURL: currentPlugin, profileURL: profile))
        let preservedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: link.path)
        precondition(preservedDestination == foreign.path)

        let timestamp = formatLogTimestamp(Date(timeIntervalSince1970: 0), timeZone: TimeZone(secondsFromGMT: 8 * 3600)!)
        precondition(timestamp == "1970-01-01 08:00:00 +0800")
        print("launcher support checks passed")
    }
}
