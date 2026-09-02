import Foundation

@discardableResult
func ensureArchivePluginLink(
    pluginURL: URL,
    profileURL: URL,
    fileManager: FileManager = .default
) -> Bool {
    let link = profileURL.appendingPathComponent("dsh-archive-manager")
    do {
        try fileManager.createDirectory(at: profileURL, withIntermediateDirectories: true)

        // fileExists(atPath:) follows symlinks and returns false for a dangling
        // link left by an older DSH installation. Read the link itself first so
        // upgrades can replace stale links without touching third-party plugins.
        if let destination = try? fileManager.destinationOfSymbolicLink(atPath: link.path) {
            guard destination.contains("DSHArchiveManager") else { return false }
            try fileManager.removeItem(at: link)
        } else if fileManager.fileExists(atPath: link.path) {
            return false
        }

        try fileManager.createSymbolicLink(at: link, withDestinationURL: pluginURL)
        return true
    } catch {
        return false
    }
}

@discardableResult
func ensureArchivePluginLinks(
    pluginURL: URL,
    profileURLs: [URL],
    fileManager: FileManager = .default
) -> Bool {
    var available = false
    for profileURL in profileURLs {
        if ensureArchivePluginLink(pluginURL: pluginURL, profileURL: profileURL, fileManager: fileManager) {
            available = true
        } else if fileManager.fileExists(atPath: profileURL.appendingPathComponent("dsh-archive-manager").path) {
            available = true
        }
    }
    return available
}
