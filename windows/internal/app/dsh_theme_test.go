package app

// Tests for the dsh theme sync. The launcher's 外观 setting used to change
// only the panel: the Harness page is rendered by dsh, which reads its own
// theme. These pin the mapping and the line-level edit of dsh's patch
// layer that keeps the user's rest-of-file intact.
//
// The edit targets ~/.dsh/profiles/<profile>/cordis.patch.yml, NOT
// settings.yaml: dsh treats that one as a legacy document, renames it to
// .imported on boot, migrates its sections into the patch layer and never
// reads it again. Writing the theme there worked exactly once.

import (
	"strings"
	"testing"
)

// The three panel values map onto the three dsh accepts. "" is the panel's
// "never set" and means the same as "system".
func TestDSHThemePreference(t *testing.T) {
	cases := map[string]string{
		"dark":   "dark",
		"light":  "light",
		"system": "system",
		"":       "system",
		"DARK":   "dark",
		" dark ": "dark",
	}
	for in, want := range cases {
		if got := dshThemePreference(in); got != want {
			t.Errorf("dshThemePreference(%q) = %q, want %q", in, got, want)
		}
	}
	// an unknown value must not silently become a theme dsh rejects
	if got := dshThemePreference("solarized"); got != "" {
		t.Errorf("dshThemePreference(unknown) = %q, want empty", got)
	}
}

// No ui-theme entry: a complete one is appended, and the user's existing
// entries are left exactly as they were.
func TestWithDSHThemeEntryAppendsEntry(t *testing.T) {
	doc := "- id: llm-pi-ai\n  name: \"@deepseek-ai/dsh-llm-pi-ai\"\n  config:\n    apiKeyEnv: KEY\n"
	got, changed := withDSHThemeEntry(doc, "dark")
	if !changed {
		t.Fatal("a document without ui-theme must change")
	}
	want := "- id: ui-theme\n  name: \"@deepseek-ai/dsh-client-ui-theme\"\n  config:\n    preference: dark\n"
	if !strings.HasSuffix(got, want) {
		t.Errorf("entry not appended; got:\n%s", got)
	}
	if !strings.Contains(got, "apiKeyEnv: KEY") {
		t.Error("existing content was lost")
	}
	if strings.Count(got, "id: ui-theme") != 1 {
		t.Errorf("ui-theme appears %d times", strings.Count(got, "id: ui-theme"))
	}
}

// The entry exists without the field: preference goes under its config
// block, not appended at the end of the file (where it would land inside a
// later entry).
func TestWithDSHThemeEntryInsertsField(t *testing.T) {
	doc := "- id: ui-theme\n  name: \"@deepseek-ai/dsh-client-ui-theme\"\n  config:\n    fontSize: 15\n- id: other\n  config:\n    key: value\n"
	got, changed := withDSHThemeEntry(doc, "light")
	if !changed {
		t.Fatal("an entry without preference must change")
	}
	if !strings.Contains(got, "config:\n    preference: light\n    fontSize: 15") {
		t.Errorf("field not inserted under config:\n%s", got)
	}
	if !strings.Contains(got, "- id: other") {
		t.Error("the following entry was lost")
	}
}

// The field is replaced in place, and a second call with the same value
// reports no change (so the page is not reloaded for nothing).
func TestWithDSHThemeEntryReplacesValue(t *testing.T) {
	doc := "- id: ui-theme\n  config:\n    preference: dark\n    fontSize: 15\n"
	got, changed := withDSHThemeEntry(doc, "light")
	if !changed {
		t.Fatal("a different value must change")
	}
	if !strings.Contains(got, "preference: light") {
		t.Errorf("value not replaced:\n%s", got)
	}
	if !strings.Contains(got, "fontSize: 15") {
		t.Error("a sibling field was lost")
	}

	again, changedAgain := withDSHThemeEntry(got, "light")
	if changedAgain {
		t.Error("setting the same value must report no change")
	}
	if again != got {
		t.Error("a no-op edit must not rewrite the document")
	}
}

// An entry id that merely starts with the same text must not match.
func TestIsPatchEntryForExactID(t *testing.T) {
	cases := []struct {
		line string
		want bool
	}{
		{"- id: ui-theme", true},
		{"- id: ui-theme # note", true},
		{"- id: \"ui-theme\"", true},
		{"- id: ui-theme-extra", false},
		{"- id: other", false},
		{"  - id: ui-theme", false}, // nested, not a top-level entry
		{"- name: ui-theme", false},
	}
	for _, c := range cases {
		if got := isPatchEntryFor(c.line, "ui-theme"); got != c.want {
			t.Errorf("isPatchEntryFor(%q) = %v, want %v", c.line, got, c.want)
		}
	}
}

// An entry with no config block at all gets one created for the field.
func TestWithDSHThemeEntryCreatesConfig(t *testing.T) {
	doc := "- id: ui-theme\n  name: \"@deepseek-ai/dsh-client-ui-theme\"\n"
	got, changed := withDSHThemeEntry(doc, "system")
	if !changed {
		t.Fatal("a fieldless entry must change")
	}
	if !strings.Contains(got, "  config:\n    preference: system") {
		t.Errorf("config block not created:\n%s", got)
	}
}

// A malformed patch document must not be corrupted further. The editor is
// line-based, so a file whose ui-theme entry is unterminated (EOF right
// after the entry) must still get the field.
func TestWithDSHThemeEntryHandlesEOFEntry(t *testing.T) {
	doc := "- id: ui-theme\n  name: \"@deepseek-ai/dsh-client-ui-theme\"\n  config:\n"
	got, changed := withDSHThemeEntry(doc, "dark")
	if !changed {
		t.Fatal("an entry at EOF without the field must change")
	}
	if !strings.Contains(got, "    preference: dark") {
		t.Errorf("field not added to an EOF entry:\n%s", got)
	}
}

// An empty document gets a complete entry rather than a bare fragment.
func TestWithDSHThemeEntryOnEmptyDocument(t *testing.T) {
	got, changed := withDSHThemeEntry("", "system")
	if !changed {
		t.Fatal("an empty document must change")
	}
	for _, want := range []string{
		"- id: ui-theme",
		`name: "@deepseek-ai/dsh-client-ui-theme"`,
		"  config:",
		"    preference: system",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("empty document is missing %q:\n%s", want, got)
		}
	}
}

// CRLF line endings (a file edited on Windows) must not break the field
// match: the editor compares trimmed lines, so \r must not leak into the
// value.
func TestWithDSHThemeEntryHandlesCRLF(t *testing.T) {
	doc := "- id: ui-theme\r\n  config:\r\n    preference: dark\r\n"
	got, changed := withDSHThemeEntry(doc, "light")
	if !changed {
		t.Fatal("a CRLF document must still be recognised and edited")
	}
	if strings.Contains(got, "preference: dark") {
		t.Errorf("the old value survived:\n%q", got)
	}
	if !strings.Contains(got, "preference: light") {
		t.Errorf("the new value was not written:\n%q", got)
	}
}

// The theme value written must be one dsh accepts. Anything else would make
// dsh reject the section at boot.
func TestDSHThemePreferenceNeverInventsAValue(t *testing.T) {
	for _, in := range []string{"", "system", "light", "dark", "DARK", " Light "} {
		got := dshThemePreference(in)
		switch got {
		case "system", "light", "dark":
		default:
			t.Errorf("dshThemePreference(%q) = %q, which dsh would reject", in, got)
		}
	}
	// unknown input maps to "" so applyDSHTheme skips the write entirely
	if got := dshThemePreference("blue"); got != "" {
		t.Errorf("dshThemePreference(blue) = %q, want empty (skip the write)", got)
	}
}
