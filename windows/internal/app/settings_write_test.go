package app

import (
	"os"
	"testing"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
)

func TestWriteSettingsDataSkipsIdenticalPayload(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	settingsWriteMu.Lock()
	lastSettingsData = nil
	settingsWriteMu.Unlock()
	t.Cleanup(func() {
		settingsWriteMu.Lock()
		lastSettingsData = nil
		settingsWriteMu.Unlock()
	})

	payload := []byte(`{"theme":"light"}`)
	writeSettingsData(payload)
	path := paths.SettingsFile()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("first write missing: %v", err)
	}
	// 内容相同：删掉文件后再写一次，必须完全不落盘。
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	writeSettingsData(payload)
	if _, err := os.Stat(path); err == nil {
		t.Fatal("identical payload must not be written again")
	}
	// 内容变化：必须写。
	writeSettingsData([]byte(`{"theme":"dark"}`))
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("changed payload was not written: %v", err)
	}
}
