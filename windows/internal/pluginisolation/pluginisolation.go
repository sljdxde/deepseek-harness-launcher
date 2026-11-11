// Package pluginisolation ports the live path of
// Sources/PluginIsolationSupport.swift: the panel-driven "user disabled"
// overlay (plugin-manager/disabled.json → plugin-disabled.yml) and the
// sidebar deck takeover patch (sidebar-deck.yml), plus the per-boot
// staging that decides which --patch slots a launch gets.
//
// The macOS crash-isolation recovery ladder is history — the main flow no
// longer runs it (the isolation parameter stays on the renderer for
// parity with the Swift tests; the launcher always passes nil today).
//
// Patch semantics (dsh's own overlay layer, --patch may repeat and the
// last file applied wins):
//   - boot order is base (bundled plugins) → deck (takeover) → disabled
//     (user intent last, highest priority);
//   - dsh treats an empty or missing --patch file as fatal, so every
//     stage returns "" instead of a path whenever there is nothing to
//     write or the write failed — fail open, never feed dsh a half file.
package pluginisolation

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// Bundles crash isolation must never touch: dsh itself and the launcher's
// own bundled plugins — disabling them disables the project.
// (Renderer parity with the Swift source; unused by the user-disable path.)
var protectedBundles = map[string]bool{
	"@deepseek-ai/dsh-base":  true,
	"@deepseek-ai/dsh-web-app": true,
	"dsh-archive-manager":    true,
	"dsh-plugin-manager":     true,
	"dsh-session-notify":     true,
}

// Bundles the panel refuses to disable: the core layers and the plugin
// manager itself. NOT the same list as protectedBundles — the bundled
// plugins (including the deck) may be disabled by explicit user intent.
var undisableableBundles = map[string]bool{
	"@deepseek-ai/dsh-base":    true,
	"@deepseek-ai/dsh-web-app": true,
	"dsh-plugin-manager":       true,
}

// replacementRows: takeover plugins push official rows aside (their own
// patch marks them disabled). When the user disables such a plugin the
// overlay must put the official rows back, or the UI loses a chunk
// permanently. Entries are appended after every disable entry, and the
// overlay applies last, so the re-enable wins.
var replacementRows = map[string][]string{
	SidebarDeckBundle: {"ui-sidebar"},
}

const (
	// SidebarDeckBundle is the takeover sidebar plugin's bundle name.
	SidebarDeckBundle = "dsh-sidebar-deck"
	// SidebarDeckPatchFileName is the staged takeover patch file name.
	SidebarDeckPatchFileName = "sidebar-deck.yml"
	// DisabledStateFileName is the panel-written state file (JSON).
	DisabledStateFileName = "disabled.json"
	// DisabledPatchFileName is the rendered overlay (YAML).
	DisabledPatchFileName = "plugin-disabled.yml"
	// DisabledStateDirName is where both live under $DSH_HOME.
	DisabledStateDirName = "plugin-manager"
)

// DisabledPlugin is one user-disabled bundle. RowIDs are the top-level
// rows the bundle contributes (discovered by the panel server from
// dump-config); disabling writes disabled: true for each.
type DisabledPlugin struct {
	Bundle     string   `json:"bundle"`
	RowIDs     []string `json:"rowIds"`
	DisabledAt string   `json:"disabledAt"`
}

// IsolatedPlugin is a crash-isolation record. The main flow never creates
// one today; the renderer keeps the parameter for semantic parity.
type IsolatedPlugin struct {
	Bundle     string   `json:"bundle"`
	RowIDs     []string `json:"rowIds"`
	Reason     string   `json:"reason"`
	IsolatedAt string   `json:"isolatedAt"`
}

// disabledStateFile is disabled.json's envelope; reads only care about
// the disabled list (version/updatedAt exist for humans).
type disabledStateFile struct {
	Version   *int             `json:"version"`
	UpdatedAt *string          `json:"updatedAt"`
	Disabled  []DisabledPlugin `json:"disabled"`
}

// SafeRowID gates row ids that end up inside YAML and come from external
// plugin output — only a conservative charset passes.
func SafeRowID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for _, r := range id {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) && !strings.ContainsRune("_.:@/-", r) {
			return false
		}
	}
	return true
}

// SafeBundleName gates bundle names read back from a hand-editable state
// file: npm package shape only, no path traversal.
func SafeBundleName(name string) bool {
	if name == "" || len(name) > 128 || strings.Contains(name, "..") {
		return false
	}
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) && !strings.ContainsRune("_.@/-", r) {
			return false
		}
	}
	return true
}

// DisabledStatePath is where the panel writes disabled.json for a dsh home.
func DisabledStatePath(home string) string {
	return filepath.Join(home, DisabledStateDirName, DisabledStateFileName)
}

// DisabledPatchDir is where the launcher stages its overlays — the same
// plugin-manager directory as the state file.
func DisabledPatchDir(home string) string {
	return filepath.Join(home, DisabledStateDirName)
}

// ReadDisabledState loads the panel's disable list. Missing or malformed
// files mean "nothing disabled" — the state must never become the reason
// dsh fails to boot. Unsafe bundles/row ids, undisableable bundles and
// duplicates are dropped; an entry left with no safe row ids is dropped
// entirely (a patch that disables nothing would just fail the boot).
func ReadDisabledState(path string) []DisabledPlugin {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var file disabledStateFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []DisabledPlugin
	for _, entry := range file.Disabled {
		if !SafeBundleName(entry.Bundle) || undisableableBundles[entry.Bundle] || seen[entry.Bundle] {
			continue
		}
		safe := make([]string, 0, len(entry.RowIDs))
		for _, id := range entry.RowIDs {
			if SafeRowID(id) {
				safe = append(safe, id)
			}
		}
		if len(safe) == 0 {
			continue
		}
		seen[entry.Bundle] = true
		out = append(out, DisabledPlugin{Bundle: entry.Bundle, RowIDs: safe, DisabledAt: entry.DisabledAt})
	}
	return out
}

// RenderCombinedDisabledPatch merges the user-disabled list (and any
// crash-isolation entries) into one overlay, deduplicated by row id.
// User-disabled rows are collected first (user intent wins conflicts),
// then re-enable rows for disabled takeover plugins are appended last so
// they have the final say. No entries → empty string → the caller must
// NOT hand an empty patch file to dsh.
func RenderCombinedDisabledPatch(isolation []IsolatedPlugin, disabled []DisabledPlugin) string {
	seen := map[string]bool{}
	var ids []string
	collect := func(rowIDs []string) {
		for _, id := range rowIDs {
			if SafeRowID(id) && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	for _, entry := range disabled {
		if !undisableableBundles[entry.Bundle] {
			collect(entry.RowIDs)
		}
	}
	for _, entry := range isolation {
		if !protectedBundles[entry.Bundle] {
			collect(entry.RowIDs)
		}
	}
	var reenable []string
	for _, entry := range disabled {
		for _, rowID := range replacementRows[entry.Bundle] {
			if SafeRowID(rowID) && !containsStr(reenable, rowID) {
				reenable = append(reenable, rowID)
			}
		}
	}
	var b strings.Builder
	for _, id := range ids {
		b.WriteString("- id: ")
		b.WriteString(id)
		b.WriteString("\n  disabled: true\n")
	}
	for _, id := range reenable {
		b.WriteString("- id: ")
		b.WriteString(id)
		b.WriteString("\n  disabled: false\n")
	}
	return b.String()
}

// StagedDisabledPatchFile writes the merged overlay and returns its path.
// Nothing to disable → ("", nil) and no file. Write failure → ("", err):
// booting without any disables beats feeding dsh a broken file.
func StagedDisabledPatchFile(isolation []IsolatedPlugin, disabled []DisabledPlugin, dir string) (string, error) {
	text := RenderCombinedDisabledPatch(isolation, disabled)
	if text == "" {
		return "", nil
	}
	return writePatch(dir, DisabledPatchFileName, text)
}

// RenderSidebarDeckPatch is the deck takeover patch: disable the official
// sidebar shell, insert the deck row.
func RenderSidebarDeckPatch() string {
	return "- id: ui-sidebar\n" +
		"  disabled: true\n" +
		"- insert:\n" +
		"    - id: dsh-sidebar-deck\n" +
		"      name: 'dsh-sidebar-deck'\n"
}

// IsSidebarDeckDisabled reports whether the user disabled the deck.
func IsSidebarDeckDisabled(disabled []DisabledPlugin) bool {
	for _, entry := range disabled {
		if entry.Bundle == SidebarDeckBundle {
			return true
		}
	}
	return false
}

// StagedSidebarDeckPatchFile writes the takeover patch; failure returns an
// error and the caller boots with the official sidebar.
func StagedSidebarDeckPatchFile(dir string) (string, error) {
	return writePatch(dir, SidebarDeckPatchFileName, RenderSidebarDeckPatch())
}

// StageBootPatches computes the three --patch slots for one boot.
//
//   - base: the bundled plugins' cordis.patch.yml, only when readable;
//   - deck: the staged takeover patch, only when the deck resources
//     shipped, the user has not disabled it, and the write succeeded —
//     any missing link falls back to the official sidebar (the deck is
//     an enhancement and must never blank out the sidebar);
//   - disabled: the staged user-disable overlay ("" when nothing is
//     disabled or the write failed).
//
// notes carries the human-readable log lines the macOS launcher appends
// for every degradation and success.
func StageBootPatches(pluginsRoot, home string) (base, deck, disabled string, notes []string) {
	basePath := filepath.Join(pluginsRoot, "DSHArchiveManager", "cordis.patch.yml")
	if readable(basePath) {
		base = basePath
	}

	statePath := DisabledStatePath(home)
	dir := DisabledPatchDir(home)

	deckSource := filepath.Join(pluginsRoot, "DSHSidebarDeck", "cordis.patch.yml")
	switch {
	case !readable(deckSource):
		notes = append(notes, "未找到侧栏 Deck 资源，本次使用官方侧栏")
	case IsSidebarDeckDisabled(ReadDisabledState(statePath)):
		notes = append(notes, "侧栏 Deck 已被用户停用，本次使用官方侧栏")
	default:
		path, err := StagedSidebarDeckPatchFile(dir)
		if err != nil {
			notes = append(notes, "侧栏 Deck 接管补丁写入失败，本次使用官方侧栏")
		} else {
			deck = path
			notes = append(notes, "侧栏 Deck 接管补丁："+path)
		}
	}

	entries := ReadDisabledState(statePath)
	if len(entries) == 0 {
		return base, deck, disabled, notes
	}
	path, err := StagedDisabledPatchFile(nil, entries, dir)
	if err != nil {
		notes = append(notes, fmt.Sprintf("读取到 %d 个已停用插件，但停用覆盖层写入失败；本次启动不会停用任何插件（可重试）", len(entries)))
		return base, deck, disabled, notes
	}
	disabled = path
	names := make([]string, len(entries))
	for i, entry := range entries {
		names[i] = entry.Bundle
	}
	notes = append(notes, "插件停用覆盖层："+path+"（"+strings.Join(names, "、")+"）")
	return base, deck, disabled, notes
}

// writePatch creates dir and writes name atomically (temp file + rename),
// mirroring the Swift staging helpers.
func writePatch(dir, name, text string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(dir, name)
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return target, nil
}

// readable reports whether path exists as a readable file (the stand-in
// for FileManager.isReadableFile).
func readable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func containsStr(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
