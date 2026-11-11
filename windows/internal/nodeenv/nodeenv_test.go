package nodeenv

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Registry-candidate cases come verbatim from
// scripts/test-dsh-version-support.swift.
func TestRegistryCandidates(t *testing.T) {
	if got := RegistryCandidates(map[string]string{}, ""); len(got) != 2 ||
		got[0] != "https://registry.npmmirror.com" || got[1] != "https://registry.npmjs.org" {
		t.Errorf("defaults = %v", got)
	}
	got := RegistryCandidates(map[string]string{"DHL_NPM_REGISTRY": "https://npm.example.test/"}, "")
	if len(got) != 3 || got[0] != "https://npm.example.test" ||
		got[1] != "https://registry.npmmirror.com" || got[2] != "https://registry.npmjs.org" {
		t.Errorf("explicit override = %v", got)
	}
	// npm_config_registry without a scheme still works as an override
	got = RegistryCandidates(map[string]string{"npm_config_registry": "https://mirror.cn"}, "")
	if len(got) != 3 || got[0] != "https://mirror.cn" {
		t.Errorf("npm_config override = %v", got)
	}
	// NPM_CONFIG_REGISTRY (upper) is read too
	got = RegistryCandidates(map[string]string{"NPM_CONFIG_REGISTRY": "https://mirror2.cn"}, "")
	if len(got) != 3 || got[0] != "https://mirror2.cn" {
		t.Errorf("NPM_CONFIG override = %v", got)
	}
	// a detected registry that is not one of the defaults goes first
	got = RegistryCandidates(map[string]string{}, "https://detected.example")
	if len(got) != 3 || got[0] != "https://detected.example" {
		t.Errorf("detected registry = %v", got)
	}
	// a detected default does not duplicate itself
	got = RegistryCandidates(map[string]string{}, "https://registry.npmmirror.com/index.json")
	if len(got) != 2 {
		t.Errorf("detected default = %v", got)
	}
}

// First-install memory budget: fetch concurrency must stay modest.
func TestNodeEnvironmentNpmConfig(t *testing.T) {
	env := NodeEnvironment("", nil)
	if env["npm_config_maxsockets"] != "16" {
		t.Errorf("maxsockets = %q, want 16 (memory gate)", env["npm_config_maxsockets"])
	}
	if env["npm_config_legacy_peer_deps"] != "false" {
		t.Error("legacy peer deps must stay off: dsh-app-boot needs peer packages")
	}
	if _, ok := env["npm_config_prefer_offline"]; ok {
		t.Error("prefer_offline must be unset when the caller gives no preference")
	}
	offline := true
	if env = NodeEnvironment("", &offline); env["npm_config_prefer_offline"] != "true" {
		t.Errorf("prefer_offline = %q, want true", env["npm_config_prefer_offline"])
	}
}

func TestNodeEnvironmentPrependsNodeDir(t *testing.T) {
	dir := filepath.Join(os.TempDir(), "dhl-node-test")
	env := NodeEnvironment(dir, nil)
	paths := strings.Split(env["PATH"], string(os.PathListSeparator))
	if len(paths) < 2 || paths[0] != dir || paths[1] != filepath.Join(dir, "node_modules", "npm", "bin") {
		t.Errorf("node dirs must come first, got %v", paths[:min(2, len(paths))])
	}
	// the original PATH survives after the prepended entries
	if len(paths) < 3 {
		t.Fatal("existing PATH entries must survive")
	}
}

func TestFindExecutable(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "node.exe")
	if err := os.WriteFile(exe, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{"PATH": dir, "PATHEXT": ".COM;.EXE;.BAT;.CMD"}
	if got, ok := FindExecutable("node", env); !ok || got != exe {
		t.Errorf("FindExecutable = %q %v, want %q", got, ok, exe)
	}
	if _, ok := FindExecutable("npm", env); ok {
		t.Error("FindExecutable must miss what is not there")
	}
	// .cmd resolution via PATHEXT
	cmd := filepath.Join(dir, "dsh.cmd")
	if err := os.WriteFile(cmd, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, ok := FindExecutable("dsh", env); !ok || got != cmd {
		t.Errorf("FindExecutable(.cmd) = %q %v, want %q", got, ok, cmd)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// The default chain must put the China mirror first: that is the shipped
// default, and a reordering would silently send every install to npm's
// official registry first.
func TestDefaultRegistryIsChinaMirror(t *testing.T) {
	got := RegistryCandidates(map[string]string{}, "")
	if len(got) < 2 {
		t.Fatalf("chain = %v, want at least two entries", got)
	}
	if got[0] != "https://registry.npmmirror.com" {
		t.Errorf("first registry = %q, want the China mirror", got[0])
	}
	if got[1] != "https://registry.npmjs.org" {
		t.Errorf("fallback = %q, want the official registry", got[1])
	}
}

// A user override still wins over the default, and the default stays as
// the fallback behind it.
func TestOverrideBeatsDefaultMirror(t *testing.T) {
	got := RegistryCandidates(map[string]string{"DHL_NPM_REGISTRY": "https://internal.example"}, "")
	if len(got) != 3 || got[0] != "https://internal.example" {
		t.Fatalf("chain = %v, want the override first", got)
	}
	if got[1] != "https://registry.npmmirror.com" {
		t.Errorf("fallback after override = %q, want the China mirror", got[1])
	}
}

// The bundled node's directory must land on the ONE PATH key the
// environment already uses. os.Environ() hands us "Path"; writing a
// second "PATH" let both ride into the child's environment block, where
// Windows kept whichever line the random map order emitted last — and
// dsh.cmd then lost node half the time.
func TestNodeEnvironmentWritesSinglePathKey(t *testing.T) {
	// NodeEnvironment reads this process's environ, which on Windows
	// carries "Path" — exactly the casing that used to collide with a
	// new "PATH" key.
	out := NodeEnvironment(`C:\Users\u\Programs\DHL\node`, nil)

	count := 0
	value := ""
	for k, v := range out {
		if strings.EqualFold(k, "PATH") {
			count++
			value = v
		}
	}
	if count != 1 {
		t.Fatalf("PATH keys = %d, want exactly one", count)
	}
	parts := strings.Split(value, string(os.PathListSeparator))
	if len(parts) < 2 || parts[0] != `C:\Users\u\Programs\DHL\node` {
		t.Errorf("bundled node not first on PATH: %q", value)
	}
	if !containsSegment(parts, `C:\Windows\System32`) {
		t.Errorf("system PATH lost: %q", value)
	}
}

// FindExecutable resolves through the map whichever casing carries PATH.
func TestFindExecutableHonoursPathCasing(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "node.exe"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{"Path": dir, "PATHEXT": ".EXE"}
	if got, ok := FindExecutable("node", env); !ok || got == "" {
		t.Errorf("FindExecutable = %q %v, want the bundled node", got, ok)
	}
}

func containsSegment(parts []string, want string) bool {
	for _, p := range parts {
		if strings.EqualFold(p, want) {
			return true
		}
	}
	return false
}
