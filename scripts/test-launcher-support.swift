import Foundation

@main
struct LauncherSupportChecks {
    static func main() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("dhl-launcher-support-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let profile = root.appendingPathComponent("profile/node_modules", isDirectory: true)
        let shared = root.appendingPathComponent("profiles/node_modules", isDirectory: true)
        let currentPlugin = root.appendingPathComponent("Deepseek Harness Launcher.app/Contents/Resources/DSHArchiveManager", isDirectory: true)
        let currentManager = root.appendingPathComponent("Deepseek Harness Launcher.app/Contents/Resources/DSHPluginManager", isDirectory: true)
        let stalePlugin = root.appendingPathComponent("DSH.app/Contents/Resources/DSHArchiveManager", isDirectory: true)
        try FileManager.default.createDirectory(at: currentPlugin, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: currentManager, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)

        let archive = BundledPlugin(linkName: "dsh-archive-manager", bundleMarker: "DSHArchiveManager", url: currentPlugin)
        let manager = BundledPlugin(linkName: "dsh-plugin-manager", bundleMarker: "DSHPluginManager", url: currentManager)

        // Stale launcher link (points at an older DSH.app bundle) is repaired.
        let link = profile.appendingPathComponent("dsh-archive-manager")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: stalePlugin)
        precondition(!FileManager.default.fileExists(atPath: link.path))

        precondition(ensureBundledPluginLink(plugin: archive, profileURL: profile))
        let repairedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: link.path)
        precondition(repairedDestination == currentPlugin.path)

        // A third-party link must never be overwritten.
        let foreign = root.appendingPathComponent("foreign-plugin", isDirectory: true)
        try FileManager.default.removeItem(at: link)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: foreign)
        precondition(!ensureBundledPluginLink(plugin: archive, profileURL: profile))
        let preservedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: link.path)
        precondition(preservedDestination == foreign.path)

        // Both bundled plugins link into every profile location.
        try FileManager.default.removeItem(at: link)
        precondition(ensureBundledPluginLinks(plugins: [archive, manager], profileURLs: [shared, profile]))
        let sharedLink = shared.appendingPathComponent("dsh-archive-manager")
        let sharedDestination = try FileManager.default.destinationOfSymbolicLink(atPath: sharedLink.path)
        precondition(sharedDestination == currentPlugin.path)
        let sharedManagerLink = shared.appendingPathComponent("dsh-plugin-manager")
        let sharedManagerDestination = try FileManager.default.destinationOfSymbolicLink(atPath: sharedManagerLink.path)
        precondition(sharedManagerDestination == currentManager.path)
        let profileManagerLink = profile.appendingPathComponent("dsh-plugin-manager")
        let profileManagerDestination = try FileManager.default.destinationOfSymbolicLink(atPath: profileManagerLink.path)
        precondition(profileManagerDestination == currentManager.path)

        let timestamp = formatLogTimestamp(Date(timeIntervalSince1970: 0), timeZone: TimeZone(secondsFromGMT: 8 * 3600)!)
        precondition(timestamp == "1970-01-01 08:00:00 +0800")
        print("launcher support checks passed")
    }
}
