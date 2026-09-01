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
