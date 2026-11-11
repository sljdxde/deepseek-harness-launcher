// Package applog appends what the launcher does to dhl.log, timestamped
// the way Sources/LogSupport.swift stamps lines on macOS
// (yyyy-MM-dd HH:mm:ss ±hhmm).
package applog

import (
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
)

var (
	mu sync.Mutex
	f  *os.File
)

// Init opens the log for appending, creating its folder first. A launcher
// that cannot open its log still runs: Logf says nothing, and the caller
// sees the error once.
func Init() error {
	mu.Lock()
	defer mu.Unlock()
	if f != nil {
		return nil
	}
	dir := paths.LogDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(paths.LogFile(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	f = file
	return nil
}

// Path is the log file's path, for the menu's 打开日志.
func Path() string {
	return paths.LogFile()
}

// Logf appends one timestamped line. Writes from many goroutines keep
// whole lines apart.
func Logf(format string, args ...any) {
	mu.Lock()
	defer mu.Unlock()
	if f == nil {
		return
	}
	stamp := time.Now().Format("2006-01-02 15:04:05 -0700")
	fmt.Fprintf(f, "%s %s\n", stamp, fmt.Sprintf(format, args...))
}

// Close flushes and closes the log at exit.
func Close() {
	mu.Lock()
	defer mu.Unlock()
	if f != nil {
		_ = f.Close()
		f = nil
	}
}
