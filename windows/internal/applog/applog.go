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

// maxLogBytes caps one log file; on overflow it rotates to dhl.log.1 (one
// backup kept). The launcher runs for days, so an unbounded log is a slow
// disk leak.
const maxLogBytes int64 = 2 << 20

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
	line := fmt.Sprintf("%s %s\n", stamp, fmt.Sprintf(format, args...))
	if info, err := f.Stat(); err == nil && info.Size()+int64(len(line)) > maxLogBytes {
		rotateLocked()
		if f == nil {
			return
		}
	}
	_, _ = f.WriteString(line)
}

// rotateLocked closes the current file, moves it to dhl.log.1 and reopens a
// fresh dhl.log. A failed rename still reopens the original so logging keeps
// working; only the oldest bytes are at risk.
func rotateLocked() {
	path := paths.LogFile()
	if f != nil {
		_ = f.Close()
		f = nil
	}
	_ = os.Remove(path + ".1")
	_ = os.Rename(path, path+".1")
	if file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		f = file
	}
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
