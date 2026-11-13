package app

// dsh_theme.go keeps the Harness page's colour scheme in step with the
// launcher's 外观 setting.
//
// The two surfaces are separate WebViews with separate themes: the panel
// paints itself from the launcher's own settings, while the Harness page
// is rendered by dsh, which reads its theme from its own configuration.
// Setting one used to leave the other alone — the user set 夜晚 and the
// Harness window stayed light.
//
// Where that configuration lives is the part that is easy to get wrong.
// dsh's settings loader treats ~/.dsh/settings.yaml as a LEGACY document:
// on boot it renames the file to settings.yaml.imported, migrates each
// section into the profile's own patch layer, and never reads it again.
// Writing the theme there works exactly once — the next boot finds no
// settings.yaml, so the value is gone. The live document is
//
//	~/.dsh/profiles/<profile>/cordis.patch.yml
//
// a top-level YAML array of loader patch entries. The theme plugin's entry
// is `id: ui-theme`, and its `config.preference` field accepts exactly
// "light", "dark" and "system" — the same three values the panel's
// segmented control offers. dsh reads the value at boot and injects the
// palette through its `webserver/index-inject` hook, so a change becomes
// visible on the next page load.

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
)

// dsh theme plugin identity inside the patch layer.
const (
	dshThemeEntryID   = "ui-theme"
	dshThemeEntryName = "@deepseek-ai/dsh-client-ui-theme"
	dshThemeField     = "preference"
	// dshThemeIndent is the patch entry's child indent (two spaces, the
	// style the file already uses).
	dshThemeIndent = "  "
)

// dshProfileNames are the profile directories to consider, in the order the
// launcher prefers them: the one it launches (`web`), then the others a
// user may have used. dsh only reads the profile it boots, so writing all
// of them keeps the setting correct whichever one is in use.
func dshProfileNames() []string {
	return []string{"web", "desktop", "headless"}
}

// dshPatchPath is the live configuration document for a profile.
func dshPatchPath(profile string) string {
	return filepath.Join(paths.DSHHome(), "profiles", profile, "cordis.patch.yml")
}

// applyDSHTheme writes the launcher's theme into every profile's patch
// layer, returning how many documents changed.
//
// The edit is line-based on purpose: the file holds the user's whole dsh
// configuration (models, providers, plugin settings), so one block is
// inserted or replaced rather than round-tripping the file through a YAML
// encoder, which would reorder and requote everything.
func applyDSHTheme(mode string) int {
	pref := dshThemePreference(mode)
	if pref == "" {
		return 0
	}
	changed := 0
	for _, profile := range dshProfileNames() {
		path := dshPatchPath(profile)
		data, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				applog.Logf("dsh theme: read %s: %v", path, err)
			}
			// No patch layer for this profile means the profile is not in
			// use; creating one would invent a configuration dsh never had.
			continue
		}
		updated, ok := withDSHThemeEntry(string(data), pref)
		if !ok {
			continue
		}
		tmp := path + ".tmp"
		if err := os.WriteFile(tmp, []byte(updated), 0o644); err != nil {
			applog.Logf("dsh theme: write %s: %v", path, err)
			continue
		}
		if err := os.Rename(tmp, path); err != nil {
			applog.Logf("dsh theme: rename %s: %v", path, err)
			continue
		}
		applog.Logf("dsh theme: %s %s=%s", profile, dshThemeField, pref)
		changed++
	}
	return changed
}

// dshThemePreference maps the launcher's theme value onto the one dsh
// accepts. "" and "system" both mean "follow the OS", which is dsh's own
// default.
func dshThemePreference(mode string) string {
	switch strings.TrimSpace(strings.ToLower(mode)) {
	case "dark":
		return "dark"
	case "light":
		return "light"
	case "", "system":
		return "system"
	}
	return ""
}

// withDSHThemeEntry returns document with the ui-theme entry's
// `config.preference` set to pref, plus whether anything changed.
//
// The document is a top-level YAML array of loader patch entries, so the
// shapes to handle are:
//   - no `- id: ui-theme` entry → append a complete one
//   - the entry exists but has no config.preference → insert the field
//   - the field exists → replace its value
func withDSHThemeEntry(document, pref string) (string, bool) {
	lines := strings.Split(document, "\n")

	entryStart := -1
	for i, line := range lines {
		if isPatchEntryFor(line, dshThemeEntryID) {
			entryStart = i
			break
		}
	}

	if entryStart == -1 {
		out := strings.TrimRight(document, "\n")
		if out != "" {
			out += "\n"
		}
		out += "- id: " + dshThemeEntryID + "\n" +
			dshThemeIndent + "name: \"" + dshThemeEntryName + "\"\n" +
			dshThemeIndent + "config:\n" +
			dshThemeIndent + dshThemeIndent + dshThemeField + ": " + pref + "\n"
		return out, true
	}

	// The entry ends at the next top-level list item (or EOF).
	entryEnd := len(lines)
	for i := entryStart + 1; i < len(lines); i++ {
		if strings.HasPrefix(lines[i], "- ") {
			entryEnd = i
			break
		}
	}

	// Replace the field where it already is.
	for i := entryStart + 1; i < entryEnd; i++ {
		trimmed := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(trimmed, dshThemeField+":") {
			continue
		}
		want := dshThemeIndent + dshThemeIndent + dshThemeField + ": " + pref
		if strings.TrimRight(lines[i], " \t") == want {
			return document, false
		}
		lines[i] = want
		return strings.Join(lines, "\n"), true
	}

	// No field yet. It belongs under `config:`; create that key when the
	// entry has none, otherwise insert directly beneath it.
	for i := entryStart + 1; i < entryEnd; i++ {
		if strings.TrimSpace(lines[i]) != "config:" {
			continue
		}
		insert := append([]string{}, lines[:i+1]...)
		insert = append(insert, dshThemeIndent+dshThemeIndent+dshThemeField+": "+pref)
		insert = append(insert, lines[i+1:]...)
		return strings.Join(insert, "\n"), true
	}
	insert := append([]string{}, lines[:entryStart+1]...)
	insert = append(insert,
		dshThemeIndent+"config:",
		dshThemeIndent+dshThemeIndent+dshThemeField+": "+pref)
	insert = append(insert, lines[entryStart+1:]...)
	return strings.Join(insert, "\n"), true
}

// isPatchEntryFor reports whether line opens a patch entry with the given
// id, e.g. `- id: ui-theme` or `- id: ui-theme # note`.
func isPatchEntryFor(line, id string) bool {
	if !strings.HasPrefix(line, "- ") {
		return false
	}
	rest := strings.TrimSpace(strings.TrimPrefix(line, "- "))
	if !strings.HasPrefix(rest, "id:") {
		return false
	}
	value := strings.TrimSpace(strings.TrimPrefix(rest, "id:"))
	if idx := strings.Index(value, "#"); idx >= 0 {
		value = strings.TrimSpace(value[:idx])
	}
	return strings.Trim(value, `"'`) == id
}
