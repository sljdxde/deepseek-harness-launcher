package harnessweb

// lasturl.go persists the token-bearing entry URL dsh printed on stdout.
// An adopted ("已接管") instance was started by someone else, so this
// launcher never sees its stdout — but the dsh web page is token-gated
// (HTTP 401 "dsh web authentication required" without it). The last URL
// this launcher captured is the best available credential for that case;
// a stale one simply fails the page load and the user can restart dsh.

import (
	"os"
	"path/filepath"
)

// LastURLFile is where the launcher keeps the most recent token URL.
func LastURLFile() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "DHL", "last-url.txt")
}

// SaveLastURL records a freshly captured token entry URL.
func SaveLastURL(raw string) {
	if raw == "" {
		return
	}
	path := LastURLFile()
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte(raw), 0o600)
}

// LoadLastURL returns the last captured token URL, or "" when none was
// ever saved.
func LoadLastURL() string {
	data, err := os.ReadFile(LastURLFile())
	if err != nil {
		return ""
	}
	return string(data)
}
