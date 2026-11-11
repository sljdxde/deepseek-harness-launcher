// Package assets carries the bundled dsh plugins and their cordis
// patch. The plugins are pure JS injected through `--patch`, so any
// platform's dsh loads them unchanged — the Windows launcher embeds the
// same directories the macOS bundle ships (build.ps1 syncs them from
// ../Plugins) and extracts them to %LOCALAPPDATA%\DHL\plugins at start,
// where the profile node_modules junctions point.
package assets

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed plugins
var embedded embed.FS

// Plugin is one bundled dsh plugin.
type Plugin struct {
	// LinkName is the package name used for the node_modules junction,
	// e.g. "dsh-archive-manager".
	LinkName string
	// DirName is the directory the plugin extracts to, e.g.
	// "DSHArchiveManager" (also how a stale junction is recognized).
	DirName string
}

// Plugins lists the bundled plugins in patch order. DSHSidebarDeck is
// bundled like the others (extracted + junctioned into node_modules) but
// is NOT part of the base patch file — the launcher stages its takeover
// patch separately (internal/pluginisolation), so it can fail open to the
// official sidebar and honour the panel's disable switch.
var Plugins = []Plugin{
	{"dsh-archive-manager", "DSHArchiveManager"},
	{"dsh-plugin-manager", "DSHPluginManager"},
	{"dsh-session-notify", "DSHSessionNotify"},
	{"dsh-sidebar-deck", "DSHSidebarDeck"},
}

// ExtractAll writes the embedded plugins under root (freshening files in
// place, so an app update refreshes the plugins the junctions point at).
// Returns an error only when nothing could be written.
func ExtractAll(root string) error {
	return fs.WalkDir(embedded, "plugins", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(path, "plugins/")
		if rel == "" || rel == "plugins" {
			return nil
		}
		target := filepath.Join(root, filepath.FromSlash(rel))
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := embedded.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}
