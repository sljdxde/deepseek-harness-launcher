package assets

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

// EnsurePluginLinks links every bundled plugin into each profile's
// node_modules, the Windows counterpart of ensureBundledPluginLinks.
//
// macOS uses symlinks; Windows needs none of the privilege a symlink
// asks for when a directory junction carries the link (junctions are
// creatable by any user). os.Symlink is tried first (Developer Mode
// users get a real symlink); a junction is the fallback; when both fail
// the plugin directory is copied, which always works but freezes until
// the next ExtractAll.
//
// A junction left by an older installation is replaced when it points
// into this app's plugins root; an entry that is not ours (the user's
// own plugin of the same name) is left untouched, as on macOS.
func EnsurePluginLinks(pluginsRoot string, profileModules []string) error {
	for _, modules := range profileModules {
		if err := os.MkdirAll(modules, 0o755); err != nil {
			continue
		}
		for _, plugin := range Plugins {
			if err := ensurePluginLink(plugin, pluginsRoot, modules); err != nil {
				// one plugin failing must not stop the others; the
				// readiness probe logs what actually loaded
				continue
			}
		}
	}
	return nil
}

func ensurePluginLink(plugin Plugin, pluginsRoot, modules string) error {
	target := filepath.Join(pluginsRoot, plugin.DirName)
	if _, err := os.Stat(target); err != nil {
		return err
	}
	link := filepath.Join(modules, plugin.LinkName)

	// read what sits at the link path first: Lstat sees through neither
	// symlinks nor junctions for IsDir, but a dangling old link must be
	// replaceable while the user's own plugin must not be touched
	if info, err := os.Lstat(link); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || isJunction(link) {
			existing, rerr := os.Readlink(link)
			if rerr != nil {
				existing = ""
			}
			if !strings.Contains(existing, plugin.DirName) {
				// someone else's link: leave it alone
				return fmt.Errorf("%s is not ours (%q), left untouched", link, existing)
			}
			_ = os.Remove(link)
		} else {
			// a real directory (a user-installed copy): leave it alone
			return fmt.Errorf("%s is a real directory, left untouched", link)
		}
	}

	if err := os.Symlink(target, link); err == nil {
		return nil
	}
	if err := makeJunction(link, target); err == nil {
		return nil
	}
	return copyDir(target, link)
}

// isJunction reports whether path is an NTFS junction (a reparse point).
// Go's Lstat mode bit has drifted across releases; ask the file system.
func isJunction(path string) bool {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return false
	}
	attrs, err := windows.GetFileAttributes(ptr)
	return err == nil && attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
}

// makeJunction creates an NTFS directory junction, which needs no
// privilege.
func makeJunction(link, target string) error {
	cmd := proc.Command("cmd.exe", "/d", "/c", "mklink", "/J", link, target)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("mklink /J: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// copyDir copies a plugin directory as the last-resort link.
func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}
