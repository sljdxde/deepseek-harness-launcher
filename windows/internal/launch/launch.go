// Package launch owns the dsh process: finding a port, reusing an
// already-running instance, starting `dsh web` with the bundled plugins
// injected through --patch, capturing the token entry URL from stdout,
// polling readiness, and stopping the tree. Ported from the launch and
// port sections of Sources/main.swift.
package launch

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/assets"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/harnessweb"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/pluginisolation"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/probe"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

// Ports are the only ports the launcher ever uses, 3080-3099, in order.
const (
	BasePort = 3080
	MaxPort  = 3099
)

// CanBind reports whether port can be taken (a BSD-bind probe, the same
// trick the macOS launcher uses — Winsock behaves the same here).
func CanBind(port int) bool {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

// Reuse asks whether an existing dsh already serves the port. A body
// that reads as dsh (asset marks, or the fixed 401 text of a token-gated
// front page) means the service is ready regardless of who started it.
func Reuse(port int) bool {
	_, body, err := probeGet(fmt.Sprintf("http://127.0.0.1:%d/", port))
	if err != nil {
		return false
	}
	return harnessweb.IsHarnessWebBody(body)
}

// FindPort picks the first usable port: one we can bind wins; failing
// that, an existing dsh serving the port is reused (the macOS launcher's
// reuse-first semantics); ports with an unknown non-dsh listener are
// skipped.
func FindPort() (port int, reuse bool, err error) {
	for port := BasePort; port <= MaxPort; port++ {
		if CanBind(port) {
			return port, false, nil
		}
		if Reuse(port) {
			return port, true, nil
		}
	}
	return 0, false, fmt.Errorf("端口 %d-%d 均被占用", BasePort, MaxPort)
}

// Launcher keeps the state of the dsh process this app started.
type Launcher struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	exePath  string
	port     int
	entryURL *url.URL // the token-bearing URL captured from stdout
	Stdout   func(string)
	// DeckWanted turns the experimental takeover sidebar (DSHSidebarDeck)
	// on for this boot. The caller reads it from settings before Start;
	// default zero value false keeps the official sidebar.
	DeckWanted bool
}

// EntryURL is the token-bearing URL dsh printed, or nil before it
// appeared (older dsh) — callers open the bare port URL then.
func (l *Launcher) EntryURL() *url.URL {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.entryURL
}

// WaitEntryURL waits up to timeout for the token-bearing entry line to be
// captured. Readiness and the entry line are two different signals: the
// port answers as soon as the server binds, while `dsh web: <url>` is
// read off stdout by the pump goroutine a moment later. A caller that
// builds the window URL straight after Start would otherwise miss it and
// fall back to a stale token from a previous process.
func (l *Launcher) WaitEntryURL(timeout time.Duration) *url.URL {
	deadline := time.Now().Add(timeout)
	for {
		if u := l.EntryURL(); u != nil {
			return u
		}
		if time.Now().After(deadline) {
			return nil
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// Port is the port this launcher started (0 when not started).
func (l *Launcher) Port() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.port
}

// Running reports whether the dsh process is still alive.
func (l *Launcher) Running() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.cmd != nil && l.cmd.Process != nil
}

// Wait blocks until the dsh process exits (nil for exit code 0).
func (l *Launcher) Wait() error {
	l.mu.Lock()
	cmd := l.cmd
	l.mu.Unlock()
	if cmd == nil {
		return errors.New("dsh 未在运行")
	}
	err := cmd.Wait()
	if err == nil {
		return nil
	}
	return err
}

// Prepare extracts the bundled plugins to %LOCALAPPDATA%\DHL\plugins and
// links them into both profile node_modules directories, so `--patch`
// finds the packages the patch inserts. Idempotent; a repeated start
// freshens the extraction (an app update ships new plugin code).
func Prepare() (pluginsRoot string, err error) {
	pluginsRoot = filepath.Join(dataDir(), "plugins")
	if err := assets.ExtractAll(pluginsRoot); err != nil {
		return "", err
	}
	profiles := filepath.Join(paths.DSHHome(), "profiles")
	err = assets.EnsurePluginLinks(pluginsRoot, []string{
		filepath.Join(profiles, "node_modules"),
		filepath.Join(profiles, "web", "node_modules"),
	})
	return pluginsRoot, err
}

// Start runs `dsh web` with the bundled plugins injected through the
// staged --patch overlays (base / sidebar-deck takeover / user-disabled),
// captures the stdout entry line, and waits until the web service
// answers. The context cancels the whole launch.
func (l *Launcher) Start(ctx context.Context, exePath string, port int, env []string) error {
	l.mu.Lock()
	if l.cmd != nil {
		l.mu.Unlock()
		return errors.New("dsh 已在运行")
	}
	l.exePath = exePath
	l.port = port
	l.entryURL = nil
	l.mu.Unlock()

	patchBase, patchDeck, patchDisabled, notes := pluginisolation.StageBootPatches(filepath.Join(dataDir(), "plugins"), paths.DSHHome(), l.DeckWanted)
	for _, note := range notes {
		l.emit(note + "\n")
	}
	args := BootArgs(port, patchBase, patchDeck, patchDisabled)
	cmd := proc.CommandContext(ctx, exePath, args...)
	cmd.Dir = paths.DSHHome()
	cmd.Env = env

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	l.mu.Lock()
	l.cmd = cmd
	l.mu.Unlock()

	// stdout carries the `dsh web: <url>` entry line; stderr only logs
	go l.pump(stdout, nil)
	go l.pump(stderr, nil)

	// readiness: poll the front page every 350ms; a cold runtime
	// bootstrap can take minutes, so wait up to 10 minutes before
	// declaring the start failed (killing the tree then)
	readyCh := make(chan error, 1)
	go func() { readyCh <- pollReady(ctx, port, 10*time.Minute) }()

	select {
	case <-ctx.Done():
		l.Stop()
		return ctx.Err()
	case err := <-readyCh:
		if err != nil {
			l.Stop()
			return err
		}
		return nil
	}
}

// emit forwards one launcher-generated log line to the stdout hook (the
// same channel the process pump uses, so staging notes land in the
// launcher log exactly like the macOS launcher's boot log lines).
func (l *Launcher) emit(line string) {
	l.mu.Lock()
	hook := l.Stdout
	l.mu.Unlock()
	if hook != nil {
		hook(line)
	}
}

// pump forwards process output to the log hook and captures the
// `dsh web: <url>` entry line whenever it appears.
func (l *Launcher) pump(r io.Reader, done chan<- struct{}) {
	defer func() {
		if done != nil {
			close(done)
		}
	}()
	reader := bufio.NewReaderSize(r, 64*1024)
	for {
		line, err := reader.ReadString('\n')
		if line != "" {
			if port := l.Port(); port != 0 {
				if u := harnessweb.WebEntryURL(line, port); u != nil {
					l.mu.Lock()
					l.entryURL = u
					l.mu.Unlock()
					harnessweb.SaveLastURL(u.String())
				}
			}
			l.mu.Lock()
			hook := l.Stdout
			l.mu.Unlock()
			if hook != nil {
				hook(line)
			}
		}
		if err != nil {
			return
		}
	}
}

// pollReady polls the web front page until it reads as dsh. A 401 with
// the fixed body counts: the service is up and merely token-gated.
func pollReady(ctx context.Context, port int, deadline time.Duration) error {
	limit := time.Now().Add(deadline)
	target := fmt.Sprintf("http://127.0.0.1:%d/", port)
	for {
		_, body, err := probeGet(target)
		if err == nil && harnessweb.IsHarnessWebBody(body) {
			return nil
		}
		if time.Now().After(limit) {
			return fmt.Errorf("dsh 启动超时（%s 未就绪）", target)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(350 * time.Millisecond):
		}
	}
}

// OpenURLForEntry picks the URL to open in the browser: the token entry
// when dsh printed one, the bare loopback URL otherwise.
func OpenURLForEntry(l *Launcher, port int) string {
	if l != nil {
		if u := l.EntryURL(); u != nil {
			return u.String()
		}
	}
	return fmt.Sprintf("http://127.0.0.1:%d/", port)
}

// Release forgets the process without ending it. The launcher uses this on
// quit: dsh is a server the user's browser talks to, and closing the tray
// icon must not take it down. The process keeps running as an orphan and
// the next launcher start adopts it through the port probe.
func (l *Launcher) Release() {
	l.mu.Lock()
	l.cmd = nil
	l.mu.Unlock()
}

// Stop ends the dsh tree: descendants first (they would be orphaned
// node children otherwise), then dsh itself.
func (l *Launcher) Stop() {
	l.mu.Lock()
	cmd := l.cmd
	l.cmd = nil
	l.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = proc.EndTree(cmd.Process.Pid)
}

// SessionOpenURL is the session-notify open endpoint for a port.
func SessionOpenURL(port int) string {
	return fmt.Sprintf("http://127.0.0.1:%d/dsh-session-notify/open", port)
}

// BootArgs mirrors PluginIsolationSupport.bootArguments: `web`, then each
// non-empty patch slot in priority order — base (bundled plugins), deck
// (sidebar takeover), disabled (user intent, applied last so it wins) —
// then --no-open/--port. dsh treats a missing --patch file as fatal, so
// an empty slot is skipped instead of passed as a blank path.
func BootArgs(port int, basePatch, deckPatch, disabledPatch string) []string {
	args := []string{"web"}
	for _, patch := range []string{basePatch, deckPatch, disabledPatch} {
		if patch != "" {
			args = append(args, "--patch", patch)
		}
	}
	return append(args, "--no-open", "--port", strconv.Itoa(port))
}

// OpenSessionPayload builds the JSON body for POST
// /dsh-session-notify/open. embeddedOnly sets requireEmbedded so the
// plugin defers the command until the launcher's own page claims it: a
// background browser tab's document.hasFocus() can lie, and a stolen
// command switches sessions in a window the user cannot see — the
// 「点了没反应」 bug.
func OpenSessionPayload(sessionID string, embeddedOnly bool) (string, bool) {
	trimmed := strings.TrimSpace(sessionID)
	if trimmed == "" {
		return "", false
	}
	// Marshal of a string cannot fail; the error exists only for the
	// general interface signature.
	id, _ := json.Marshal(trimmed)
	if embeddedOnly {
		return `{"sessionId":` + string(id) + `,"requireEmbedded":true}`, true
	}
	return `{"sessionId":` + string(id) + `}`, true
}

// SessionEventsURL is the session-notify events endpoint for a port.
func SessionEventsURL(port int) string {
	return fmt.Sprintf("http://127.0.0.1:%d/dsh-session-notify/events", port)
}

// dataDir is %LOCALAPPDATA%\DHL, where the plugins extract.
func dataDir() string { return filepath.Dir(paths.LogDir()) }

// probeGet is a tiny GET with a short timeout, enough for loopback.
func probeGet(url string) (int, string, error) {
	return probe.Response(url, 1500*time.Millisecond)
}
