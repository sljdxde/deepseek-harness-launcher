// Package nodeenv puts together the environment dsh and npm run under,
// ported from Sources/LauncherEnvironment.swift, adjusted for Windows:
// the bundled node next to the exe takes precedence, a system node from
// PATH stays the fallback (macOS searches version managers; Windows users
// rarely have one, and the launcher no longer requires any).
package nodeenv

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// npmConfig carries the install-time npm settings, byte for byte the ones
// the macOS launcher sets. Two of them carry a memory story: maxsockets
// keeps npm's concurrent tarball fetch/extract from ballooning peak
// memory (npm's default is 15; 50 once raised first-install RSS), and
// legacy_peer_deps must stay off because dsh-app-boot relies on peer
// packages at runtime — legacy mode would silently omit them and leave a
// broken npx cache.
func npmConfig(preferOffline *bool) map[string]string {
	config := map[string]string{
		"npm_config_audit":                  "false",
		"npm_config_fund":                   "false",
		"npm_config_progress":               "true",
		"npm_config_update_notifier":        "false",
		"npm_config_fetch_retries":          "3",
		"npm_config_fetch_retry_factor":     "2",
		"npm_config_fetch_retry_mintimeout": "1000",
		"npm_config_fetch_retry_maxtimeout": "10000",
		"npm_config_fetch_timeout":          "120000",
		"npm_config_maxsockets":             "16",
		"npm_config_legacy_peer_deps":       "false",
	}
	if preferOffline != nil {
		if *preferOffline {
			config["npm_config_prefer_offline"] = "true"
		} else {
			config["npm_config_prefer_offline"] = "false"
		}
	}
	return config
}

// NodeEnvironment builds the environment map for dsh/npm children: the
// current process environment, the bundled node's directory (and its
// npm) prepended to PATH, and the npm settings above.
func NodeEnvironment(nodeDir string, preferOffline *bool) map[string]string {
	env := map[string]string{}
	for _, kv := range os.Environ() {
		if i := strings.IndexByte(kv, '='); i > 0 {
			env[kv[:i]] = kv[i+1:]
		}
	}
	for k, v := range npmConfig(preferOffline) {
		env[k] = v
	}
	if nodeDir != "" {
		paths := []string{nodeDir, filepath.Join(nodeDir, "node_modules", "npm", "bin")}
		paths = append(paths, strings.Split(pathValue(env), string(os.PathListSeparator))...)
		// write back under the key that is already there: os.Environ()
		// hands us "Path", and a second "PATH" key would ride through
		// flattenEnv into the child's environment block, where Windows
		// keeps whichever line the (random) map order emitted last —
		// sometimes the old PATH without the bundled node, which is how
		// dsh.cmd lost node
		env[pathKey(env)] = strings.Join(dedupe(paths), string(os.PathListSeparator))
	}
	return env
}

// pathKey finds the existing key carrying PATH, whatever its casing.
func pathKey(env map[string]string) string {
	for k := range env {
		if strings.EqualFold(k, "PATH") {
			return k
		}
	}
	return "PATH"
}

// pathValue reads PATH honouring the casing the environment actually used.
func pathValue(env map[string]string) string {
	if v, ok := env[pathKey(env)]; ok {
		return v
	}
	return ""
}

// registryDefaults is the fallback chain: the China mirror first, npm
// official second — the macOS launcher's order, kept for the same reason
// (npmmirror serves the region the launcher is used from).
var registryDefaults = []string{
	"https://registry.npmmirror.com",
	"https://registry.npmjs.org",
}

// RegistryCandidates orders the registries an install may try: an
// explicit override first (DHL_NPM_REGISTRY / npm_config_registry /
// NPM_CONFIG_REGISTRY), then a detected one unless it is one of the
// defaults, then the defaults. Whitespace and trailing slashes go, and
// duplicates drop. Port of LauncherEnvironment.npmRegistryCandidates.
func RegistryCandidates(environment map[string]string, detected string) []string {
	explicit := firstNonEmpty(
		environment["DHL_NPM_REGISTRY"],
		environment["npm_config_registry"],
		environment["NPM_CONFIG_REGISTRY"],
	)
	var ordered []string
	switch {
	case explicit != "":
		ordered = append([]string{explicit}, registryDefaults...)
	case detected != "" &&
		!strings.Contains(detected, "registry.npmjs.org") &&
		!strings.Contains(detected, "registry.npmmirror.com"):
		ordered = append([]string{detected}, registryDefaults...)
	default:
		ordered = registryDefaults
	}
	var out []string
	seen := map[string]bool{}
	for _, candidate := range ordered {
		c := strings.Trim(strings.TrimSpace(candidate), "/")
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
}

// FindExecutable walks PATH (already joined into the environment map)
// looking for name with any Windows executable extension. PATH and
// PATHEXT are read case-insensitively: the environment hands its keys
// over with whatever casing the parent process used.
func FindExecutable(name string, env map[string]string) (string, bool) {
	dirs := strings.Split(pathValue(env), string(os.PathListSeparator))
	extensions := []string{""}
	pathext := ""
	for k, v := range env {
		if strings.EqualFold(k, "PATHEXT") {
			pathext = v
			break
		}
	}
	if pathext != "" {
		extensions = append(extensions, strings.Split(strings.ToLower(pathext), string(os.PathListSeparator))...)
	} else {
		extensions = append(extensions, ".com", ".exe", ".bat", ".cmd")
	}
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		for _, ext := range extensions {
			candidate := filepath.Join(dir, name+ext)
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				return candidate, true
			}
		}
	}
	return "", false
}

// Environment flattens an environment map into the "KEY=VALUE" slice
// exec.Cmd wants.
//
// Windows environment keys are case-insensitive, but a Go map is not:
// os.Environ() hands us "Path" while new code writes "PATH", and both
// lines riding into the child's environment block lets the (random) map
// order decide which one survives — that is exactly how dsh.cmd once
// lost node half the time. Deduplicate case-insensitively with a
// DETERMINISTIC winner: original-cased keys are visited in sorted order,
// and a later key overwrites an earlier one (so "PATH" sorts before
// "Path" and wins — the new value is the one we wrote).
func Environment(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	index := map[string]int{}
	var out []string
	for _, k := range keys {
		v := env[k]
		if i, ok := index[strings.ToLower(k)]; ok {
			out[i] = k + "=" + v
			continue
		}
		index[strings.ToLower(k)] = len(out)
		out = append(out, k+"="+v)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func dedupe(paths []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, p := range paths {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}
