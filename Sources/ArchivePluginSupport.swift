import Foundation

/// A bundled plugin that the launcher ships inside the app bundle and links
/// into each web profile's node_modules at launch.
struct BundledPlugin {
    let linkName: String      // package name used for the node_modules symlink, e.g. "dsh-archive-manager"
    let bundleMarker: String  // app-resource directory name, e.g. "DSHArchiveManager" (also detects stale links)
    let url: URL
}

@discardableResult
func ensureBundledPluginLink(
    plugin: BundledPlugin,
    profileURL: URL,
    fileManager: FileManager = .default
) -> Bool {
    let link = profileURL.appendingPathComponent(plugin.linkName)
    do {
        try fileManager.createDirectory(at: profileURL, withIntermediateDirectories: true)

        // fileExists(atPath:) follows symlinks and returns false for a dangling
        // link left by an older DSH installation. Read the link itself first so
        // upgrades can replace stale links without touching third-party plugins.
        if let destination = try? fileManager.destinationOfSymbolicLink(atPath: link.path) {
            guard destination.contains(plugin.bundleMarker) else { return false }
            try fileManager.removeItem(at: link)
        } else if fileManager.fileExists(atPath: link.path) {
            return false
        }

        try fileManager.createSymbolicLink(at: link, withDestinationURL: plugin.url)
        return true
    } catch {
        return false
    }
}

@discardableResult
func ensureBundledPluginLinks(
    plugins: [BundledPlugin],
    profileURLs: [URL],
    fileManager: FileManager = .default
) -> Bool {
    var available = false
    for profileURL in profileURLs {
        for plugin in plugins {
            if ensureBundledPluginLink(plugin: plugin, profileURL: profileURL, fileManager: fileManager) {
                available = true
            } else if fileManager.fileExists(atPath: profileURL.appendingPathComponent(plugin.linkName).path) {
                available = true
            }
        }
    }
    return available
}
