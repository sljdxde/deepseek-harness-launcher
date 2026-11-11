package app

// settings_http.go is the loopback control server the settings plugin
// talks to.
//
// The plugin lives inside dsh's web server and has no way to touch the
// launcher's own state, so the launcher publishes a small JSON API on a
// port of its own and tells the plugin where to find it through
// DHL_CONTROL_URL. Only two routes exist:
//
//	GET  /settings → { settings, versions }
//	POST /settings → merge the posted fields, save, apply
//
// It binds to 127.0.0.1 only, and it refuses requests without the token it
// generated at start (passed in the same environment variable), so another
// local process cannot rewrite the user's settings.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/ver"
)

// controlServer is the loopback API for the settings plugin.
type controlServer struct {
	mu     sync.Mutex
	port   int
	token  string
	server *http.Server
	ctl    *controller
}

var control = &controlServer{}

// startControlServer binds the API and exports its address to dsh's
// environment so the plugin can find it.
func (c *controller) startControlServer() {
	control.mu.Lock()
	if control.server != nil {
		control.mu.Unlock()
		return
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		control.mu.Unlock()
		applog.Logf("control server: listen failed: %v", err)
		return
	}
	port := listener.Addr().(*net.TCPAddr).Port
	token := randomToken()
	control.port = port
	control.token = token
	control.ctl = c

	mux := http.NewServeMux()
	mux.HandleFunc("/settings", control.handleSettings)
	mux.HandleFunc("/js-error", control.handleJSError)
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	control.server = srv
	control.mu.Unlock()

	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			applog.Logf("control server stopped: %v", err)
		}
	}()

	// the plugin reads this from its own process environment
	os.Setenv("DHL_CONTROL_URL", fmt.Sprintf("http://127.0.0.1:%d", port))
	os.Setenv("DHL_CONTROL_TOKEN", token)
	applog.Logf("control server listening on 127.0.0.1:%d", port)
}

// stopControlServer tears the API down at exit.
func stopControlServer() {
	control.mu.Lock()
	srv := control.server
	control.server = nil
	control.mu.Unlock()
	if srv != nil {
		_ = srv.Close()
	}
}

// controlSettingsPayload is what GET returns.
type controlSettingsPayload struct {
	Settings settingsFile    `json:"settings"`
	Versions controlVersions `json:"versions"`
}

type controlVersions struct {
	Launcher string `json:"launcher"`
	DSH      string `json:"dsh"`
	Node     string `json:"node"`
}

func (s *controlServer) handleSettings(w http.ResponseWriter, r *http.Request) {
	// the token travels in a header; the plugin has it from the env
	if r.Header.Get("X-DHL-Token") != s.token && r.URL.Query().Get("token") != s.token {
		http.Error(w, `{"ok":false,"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.writeState(w)
	case http.MethodPost:
		s.applyUpdate(w, r)
	default:
		http.Error(w, `{"ok":false,"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// handleJSError records a JavaScript failure reported by the in-window
// Harness page. The page is served by dsh, so it has no other way to reach
// the launcher; this is the channel that makes plugin breakage visible.
func (s *controlServer) handleJSError(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("token") != s.token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	msg := r.URL.Query().Get("msg")
	where := r.URL.Query().Get("where")
	applog.Logf("harness page: %s: %s", where, msg)
	w.WriteHeader(http.StatusNoContent)
}

func (s *controlServer) writeState(w http.ResponseWriter) {
	settings := loadSettings()
	payload := controlSettingsPayload{
		Settings: settings,
		Versions: controlVersions{
			Launcher: s.ctl.version,
			DSH:      dshVersionOf(nodeEnvironment()),
			Node:     nodeVersion(),
		},
	}
	w.Header().Set("content-type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(payload)
}

// applyUpdate merges the posted fields into the saved settings, then makes
// the live launcher follow them.
func (s *controlServer) applyUpdate(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, `{"ok":false,"error":"read failed"}`, http.StatusBadRequest)
		return
	}
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(body, &patch); err != nil {
		http.Error(w, `{"ok":false,"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	settings := loadSettings()
	if raw, ok := patch["updateIntervalHours"]; ok {
		var hours float64
		if err := json.Unmarshal(raw, &hours); err == nil {
			if hours < 1 {
				hours = 1
			}
			if hours > 720 {
				hours = 720
			}
			settings.UpdateIntervalHours = hours
		}
	}
	boolField := func(key string, target *bool) {
		if raw, ok := patch[key]; ok {
			var value bool
			if err := json.Unmarshal(raw, &value); err == nil {
				*target = value
			}
		}
	}
	boolField("autoCheckPluginUpdates", &settings.AutoCheckPluginUpdates)
	boolField("openBrowserOnReady", &settings.OpenBrowserOnReady)
	boolField("launchAtLogin", &settings.LaunchAtLogin)
	boolField("globalHotKeyEnabled", &settings.GlobalHotKeyEnabled)
	boolField("desktopShortcut", &settings.DesktopShortcut)

	if raw, ok := patch["globalHotKey"]; ok {
		var chord string
		if err := json.Unmarshal(raw, &chord); err == nil {
			chord = strings.TrimSpace(chord)
			if chord != "" {
				if _, _, valid := parseHotkey(chord); !valid {
					http.Error(w, `{"ok":false,"error":"快捷键格式无效"}`, http.StatusBadRequest)
					return
				}
			}
			settings.GlobalHotKey = chord
		}
	}
	if raw, ok := patch["npmRegistry"]; ok {
		var registry string
		if err := json.Unmarshal(raw, &registry); err == nil {
			registry = strings.TrimSpace(registry)
			if registry != "" && !strings.HasPrefix(registry, "http") {
				http.Error(w, `{"ok":false,"error":"镜像源必须是 http(s) 地址"}`, http.StatusBadRequest)
				return
			}
			settings.NpmRegistry = registry
		}
	}

	writeSettings(settings)
	// make the live launcher follow the new values
	s.ctl.applySettingsToLive(settings)

	w.Header().Set("content-type", "application/json; charset=utf-8")
	_, _ = io.WriteString(w, `{"ok":true}`)
	applog.Logf("control: settings saved from the Harness panel")
}

// applySettingsToLive pushes the saved settings into the running parts:
// the auto-start entry, the hotkey, and the registry choice.
func (c *controller) applySettingsToLive(settings settingsFile) {
	if err := setLaunchAtLogin(settings.LaunchAtLogin); err != nil {
		applog.Logf("launch at login: %v", err)
	}
	applyGlobalHotKey(settings.GlobalHotKeyEnabled, settings.GlobalHotKey)
	if settings.DesktopShortcut {
		ensureShortcuts(true)
	}
	c.mu.Lock()
	c.updateIntervalHours = settings.UpdateIntervalHours
	c.autoCheckPluginUpdates = settings.AutoCheckPluginUpdates
	c.openBrowserOnReady = settings.OpenBrowserOnReady
	c.globalHotKeyEnabled = settings.GlobalHotKeyEnabled
	c.globalHotKey = settings.GlobalHotKey
	c.desktopShortcut = settings.DesktopShortcut
	c.mu.Unlock()
	refreshOpenPanel()
}

// nodeVersion reads the bundled (or system) node's version.
func nodeVersion() string {
	dir := nodeDir()
	if dir == "" {
		return ""
	}
	exe := dir + string(os.PathSeparator) + "node.exe"
	out, err := runVersion(exe)
	if err != nil {
		return ""
	}
	return ver.NormalizeRelease(strings.TrimSpace(strings.TrimPrefix(out, "v")))
}

func randomToken() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprint(time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

// runVersion runs `node --version` and returns its trimmed output.
func runVersion(exe string) (string, error) {
	cmd := proc.Command(exe, "--version")
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}
