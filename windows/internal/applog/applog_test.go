package applog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogRotationKeepsOneBackup(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCALAPPDATA", dir)
	// 本包在测试进程里是全局单例；先关掉可能已打开的句柄。
	Close()
	if err := Init(); err != nil {
		t.Fatalf("Init: %v", err)
	}
	line := strings.Repeat("x", 256)
	for i := 0; i < int(maxLogBytes/256)+16; i++ {
		Logf("%s", line)
	}
	Close()

	logPath := filepath.Join(dir, "DHL", "logs", "dhl.log")
	info, err := os.Stat(logPath)
	if err != nil {
		t.Fatalf("log missing: %v", err)
	}
	if info.Size() > maxLogBytes {
		t.Errorf("log size = %d, want <= %d", info.Size(), maxLogBytes)
	}
	if _, err := os.Stat(logPath + ".1"); err != nil {
		t.Errorf("rotated backup missing: %v", err)
	}
}
