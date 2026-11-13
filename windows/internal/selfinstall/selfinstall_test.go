package selfinstall

// The self-install decision and the zip plumbing, pinned as pure tests:
// a wrong decision here either installs twice, upgrades nothing, or runs
// a dev build into the install directory. Extraction is exercised with
// in-memory archives through the same code path the embedded Node uses.

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDecide(t *testing.T) {
	base := Input{
		SelfPath:      `C:\Users\u\Downloads\DHL.exe`,
		SelfVersion:   "0.4.0",
		DownloadsLike: true,
	}
	cases := []struct {
		name string
		mut  func(*Input)
		want Action
	}{
		{"no installed copy installs", func(i *Input) { i.InstalledExe = "" }, ActionInstall},
		{"same version forwards", func(i *Input) {
			i.InstalledExe = `C:\Users\u\AppData\Local\Programs\DHL\DHL.exe`
			i.InstalledVersion = "0.4.0"
		}, ActionForward},
		{"older installed upgrades", func(i *Input) {
			i.InstalledExe = `C:\Users\u\AppData\Local\Programs\DHL\DHL.exe`
			i.InstalledVersion = "0.3.11"
		}, ActionUpgrade},
		{"cycle number upgrades", func(i *Input) {
			i.InstalledExe = `C:\Users\u\AppData\Local\Programs\DHL\DHL.exe`
			i.InstalledVersion = "0.4.0-1.1"
		}, ActionUpgrade},
		{"newer installed forwards", func(i *Input) {
			i.InstalledExe = `C:\Users\u\AppData\Local\Programs\DHL\DHL.exe`
			i.InstalledVersion = "0.4.1"
		}, ActionForward},
		{"unreadable installed version forwards", func(i *Input) {
			i.InstalledExe = `C:\Users\u\AppData\Local\Programs\DHL\DHL.exe`
			i.InstalledVersion = ""
		}, ActionForward},
		{"dev build never upgrades", func(i *Input) {
			i.SelfVersion = "dev"
			i.InstalledExe = `C:\Users\u\AppData\Local\Programs\DHL\DHL.exe`
			i.InstalledVersion = "0.3.11"
		}, ActionForward},
		{"portable marker disables everything", func(i *Input) {
			i.Portable = true
			i.InstalledExe = ""
		}, ActionNone},
		{"a build directory never installs", func(i *Input) {
			i.SelfPath = `D:\repo\windows\build\DHL.exe`
			i.DownloadsLike = false
			i.InstalledExe = ""
		}, ActionNone},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := base
			c.mut(&in)
			if got := Decide(in); got != c.want {
				t.Errorf("Decide = %v, want %v", got, c.want)
			}
		})
	}
}

// Running from inside the install directory itself (the normal installed
// case) must be None even though the path could look download-ish to a
// redirected folder.
func TestDecideSelfIsInstalled(t *testing.T) {
	const exe = `C:\Users\u\AppData\Local\Programs\DHL\DHL.exe`
	got := Decide(Input{
		SelfPath:         exe,
		SelfVersion:      "0.4.0",
		InstalledExe:     exe,
		InstalledVersion: "0.4.0",
		DownloadsLike:    true,
	})
	if got != ActionNone {
		t.Errorf("Decide = %v, want None (the installed copy must not reinstall itself)", got)
	}
}

// Path comparison must ignore case: Explorer hands out the same path in
// either casing.
func TestSamePathCaseInsensitive(t *testing.T) {
	if !samePath(`C:\Users\u\Programs\DHL\DHL.exe`, `c:\users\u\programs\dhl\dhl.exe`) {
		t.Error("samePath must ignore case")
	}
	if samePath(`C:\a\DHL.exe`, "") || samePath("", `C:\a\DHL.exe`) {
		t.Error("samePath with an empty side must be false")
	}
}

func zipBytes(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatalf("zip entry %s: %v", name, err)
		}
		if _, err := f.Write([]byte(content)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func reader(t *testing.T, data []byte) *zip.Reader {
	t.Helper()
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip reader: %v", err)
	}
	return r
}

// The wrapper directory must be stripped, so the install directory gets
// node\node.exe — not node\node-v24.22.2-win-x64\node.exe.
func TestExtractStripsTopDir(t *testing.T) {
	data := zipBytes(t, map[string]string{
		"node-v24.22.2-win-x64/node.exe":     "exe-bytes",
		"node-v24.22.2-win-x64/npm.cmd":      "npm",
		"node-v24.22.2-win-x64/node_modules": "",
	})
	r := reader(t, data)
	prefix := commonTopDir(r)
	if prefix != "node-v24.22.2-win-x64/" {
		t.Fatalf("commonTopDir = %q, want the wrapper dir", prefix)
	}
	if got := nodeVersionFromZip(prefix); got != "v24.22.2" {
		t.Errorf("nodeVersionFromZip = %q, want v24.22.2", got)
	}

	dest := t.TempDir()
	if err := extractZipTo(r, dest, prefix); err != nil {
		t.Fatalf("extractZipTo: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "node.exe")); err != nil {
		t.Errorf("node.exe did not land in the target root: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "npm.cmd")); err != nil {
		t.Errorf("npm.cmd missing: %v", err)
	}
}

// An archive without a wrapper directory extracts as-is; the version
// reader must refuse to invent one.
func TestExtractWithoutTopDir(t *testing.T) {
	data := zipBytes(t, map[string]string{"node.exe": "exe-bytes"})
	r := reader(t, data)
	if prefix := commonTopDir(r); prefix != "" {
		t.Fatalf("commonTopDir = %q, want empty", prefix)
	}
	if got := nodeVersionFromZip(""); got != "" {
		t.Errorf("nodeVersionFromZip = %q, want empty", got)
	}
	dest := t.TempDir()
	if err := extractZipTo(r, dest, ""); err != nil {
		t.Fatalf("extractZipTo: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "node.exe")); err != nil {
		t.Errorf("root-level node.exe missing: %v", err)
	}
}

// Zip slip: an entry whose path escapes the destination must be skipped,
// not written.
func TestExtractRefusesZipSlip(t *testing.T) {
	data := zipBytes(t, map[string]string{
		"node-v24-win-x64/node.exe":       "fine",
		"node-v24-win-x64/../../evil.exe": "nope",
	})
	r := reader(t, data)
	dest := t.TempDir()
	_ = extractZipTo(r, dest, commonTopDir(r))
	if _, err := os.Stat(filepath.Join(filepath.Dir(dest), "evil.exe")); err == nil {
		t.Error("zip-slip entry was written outside the destination")
	}
	if _, err := os.Stat(filepath.Join(dest, "node.exe")); err != nil {
		t.Errorf("the legitimate entry went missing: %v", err)
	}
}
