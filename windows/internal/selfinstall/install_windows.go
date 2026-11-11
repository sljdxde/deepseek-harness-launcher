//go:build windows

package selfinstall

// install_windows.go carries the file work behind Settle: reading a PE's
// version resource, deciding whether a path is a download folder, the
// staging-then-rename install, the Node zip extraction, and the upgrade's
// swap-while-running script. Pure OS work, no app imports.

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"golang.org/x/sys/windows"
)

const createNoWindow = 0x08000000

// --- version resource ---------------------------------------------------------

var versionDLL = syscall.NewLazyDLL("version.dll")

var (
	procGetFileVersionInfoSizeW = versionDLL.NewProc("GetFileVersionInfoSizeW")
	procGetFileVersionInfoW     = versionDLL.NewProc("GetFileVersionInfoW")
	procVerQueryValueW          = versionDLL.NewProc("VerQueryValueW")
)

// exeVersion reads ProductVersion out of a PE's version resource — the
// string build.ps1 writes from Resources/Info.plist, so what is compared
// is exactly what a release names itself. "" when the file has no
// version resource (a `go run` test binary, a deleted file).
func exeVersion(path string) string {
	pathPtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return ""
	}
	size, _, _ := procGetFileVersionInfoSizeW.Call(uintptr(unsafe.Pointer(pathPtr)), 0)
	if size == 0 {
		return ""
	}
	buf := make([]byte, size)
	if ok, _, _ := procGetFileVersionInfoW.Call(uintptr(unsafe.Pointer(pathPtr)), 0, size,
		uintptr(unsafe.Pointer(&buf[0]))); ok == 0 {
		return ""
	}
	// The language-specific block lives under \StringFileInfo\<lang>\
	// <key>; the translation table says which lang id the resource uses.
	// The out-parameter is declared as unsafe.Pointer directly: holding
	// the result in that type (not a uintptr) is what keeps vet's
	// unsafeptr check and the GC honest about it.
	var blockPtr unsafe.Pointer
	var blockLen uint32
	subPtr, _ := syscall.UTF16PtrFromString(`\VarFileInfo\Translation`)
	if ok, _, _ := procVerQueryValueW.Call(uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(subPtr)), uintptr(unsafe.Pointer(&blockPtr)),
		uintptr(unsafe.Pointer(&blockLen))); ok == 0 || blockLen < 4 || blockPtr == nil {
		return ""
	}
	lang := *(*uint32)(blockPtr)
	// the table stores (langID, codepage) as two uint16, little-endian, so
	// langID is the LOW half; the subkey spells langID first
	subKey := fmt.Sprintf(`\StringFileInfo\%04x%04x\ProductVersion`,
		uint16(lang&0xffff), uint16(lang>>16))
	subPtr, _ = syscall.UTF16PtrFromString(subKey)
	var valuePtr unsafe.Pointer
	var valueLen uint32
	if ok, _, _ := procVerQueryValueW.Call(uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(subPtr)), uintptr(unsafe.Pointer(&valuePtr)),
		uintptr(unsafe.Pointer(&valueLen))); ok == 0 || valueLen == 0 || valuePtr == nil {
		return ""
	}
	value := unsafe.Slice((*uint16)(valuePtr), valueLen)
	return strings.TrimRight(syscall.UTF16ToString(value), "\x00")
}

// --- download-folder detection -------------------------------------------------

// isDownloadLike reports whether the exe sits where browsers drop files:
// Downloads (the real one, OneDrive redirection included — the shell's
// known-folder API answers that) or the desktop, or the temp dir. A build
// directory or the install directory is not download-like, so dev runs
// and installed runs never self-install.
func isDownloadLike(path string) bool {
	dir := filepath.Dir(path)
	for _, known := range downloadLikeDirs() {
		if strings.EqualFold(dir, known) {
			return true
		}
	}
	return false
}

func downloadLikeDirs() []string {
	var out []string
	for _, folder := range []*windows.KNOWNFOLDERID{
		windows.FOLDERID_Downloads,
		windows.FOLDERID_Desktop,
	} {
		if p, err := windows.KnownFolderPath(folder, windows.KF_FLAG_DEFAULT); err == nil && p != "" {
			out = append(out, p)
		}
	}
	if tmp := os.TempDir(); tmp != "" {
		out = append(out, tmp)
	}
	return out
}

// isPortable reports the explicit "do not install me" signals: a
// .portable marker or a data directory beside the exe (the magpie
// portable rule), or the escape-hatch environment variable.
func isPortable(exe string) bool {
	if os.Getenv("DHL_NO_INSTALL") == "1" {
		return true
	}
	dir := filepath.Dir(exe)
	for _, name := range []string{".portable", "data"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

// --- install ----------------------------------------------------------------

// install lays down the exe + the embedded Node into the install
// directory, staging everything first: a failed copy or a truncated zip
// extraction must never leave a half-written install behind (the same
// rule the dsh runtime installer follows).
func install(selfExe, version string) error {
	target := InstallDir()
	staging := target + ".installing"
	if err := os.RemoveAll(staging); err != nil {
		return err
	}
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return err
	}
	if err := copyFile(selfExe, filepath.Join(staging, ExeName)); err != nil {
		return err
	}
	if err := extractNode(filepath.Join(staging, "node")); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(staging, "version.txt"), []byte(version), 0o644); err != nil {
		return err
	}
	// promote: rename within the same parent directory is atomic. An
	// older target (possible when a previous install was interrupted
	// after the rename-aside but before the rename-in) moves aside first.
	if _, err := os.Stat(target); err == nil {
		_ = os.Rename(target, target+".old")
		_ = os.RemoveAll(target + ".old")
	}
	if err := os.Rename(staging, target); err != nil {
		return err
	}
	if err := RegisterARP(filepath.Join(target, ExeName), version); err != nil {
		// the install itself is complete; a registry hiccup must not
		// undo it, and the next start refreshes the entry anyway
		applog.Logf("selfinstall: ARP registration failed: %v", err)
	}
	return nil
}

// upgrade replaces an installed copy with this newer exe. The running
// installed exe cannot be overwritten, so the new file lands beside it
// and a small cmd script moves it once the old process exits — the same
// dance selfupdate uses. The embedded Node only re-extracts when its
// version marker differs, which keeps the usual upgrade a single-file
// move.
func upgrade(selfExe, version, installedExe string) error {
	target := InstallDir()
	staged := filepath.Join(target, "DHL.new.exe")
	if err := copyFile(selfExe, staged); err != nil {
		return err
	}
	stagedNode := filepath.Join(target, "node.new")
	needNode, err := nodeNeedsRefresh(filepath.Join(target, "node"))
	if err != nil {
		needNode = true // when in doubt, lay the bundled Node down again
	}
	if needNode {
		if err := extractNode(stagedNode); err != nil {
			return err
		}
	}
	script := filepath.Join(os.TempDir(), fmt.Sprintf("dhl-upgrade-%d.cmd", os.Getpid()))
	var lines []string
	lines = append(lines,
		"@echo off",
		"rem waits for the running launcher to exit, then swaps the install",
		":wait",
		"timeout /t 1 /nobreak >nul",
		`tasklist /fi "PID eq `+itoa(os.Getpid())+`" | find "`+itoa(os.Getpid())+`" >nul && goto wait`,
	)
	if needNode {
		lines = append(lines,
			`rd /s /q "`+filepath.Join(target, "node.old")+`" >nul 2>&1`,
			`move /y "`+filepath.Join(target, "node")+`" "`+filepath.Join(target, "node.old")+`" >nul 2>&1`,
			`move /y "`+stagedNode+`" "`+filepath.Join(target, "node")+`" >nul 2>&1`,
			`rd /s /q "`+filepath.Join(target, "node.old")+`" >nul 2>&1`,
		)
	}
	lines = append(lines,
		`move /y "`+installedExe+`" "`+installedExe+`.old" >nul 2>&1`,
		`move /y "`+staged+`" "`+installedExe+`" >nul 2>&1`,
		`del /f /q "`+installedExe+`.old" >nul 2>&1`,
		`start "" "`+installedExe+`"`,
		"del /q \"%~f0\"",
	)
	if err := os.WriteFile(script, []byte(strings.Join(lines, "\r\n")), 0o644); err != nil {
		return err
	}
	cmd := exec.Command("cmd.exe", "/c", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	// the script runs detached; the .cmd deletes itself
	go func() { _ = cmd.Wait() }()
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// startInstalled launches the installed copy detached and reports
// whether the start succeeded (the caller exits right after, so a failed
// start must be reported, not assumed).
func startInstalled(installedExe string) bool {
	cmd := exec.Command(installedExe, os.Args[1:]...)
	cmd.Dir = filepath.Dir(installedExe)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	if err := cmd.Start(); err != nil {
		applog.Logf("selfinstall: starting installed copy failed: %v", err)
		return false
	}
	go func() { _ = cmd.Wait() }()
	return true
}

// copyFile copies with a temp-then-rename so a truncated copy never
// masquerades as a complete file.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// --- embedded Node ------------------------------------------------------------

// extractNode unpacks the embedded Node zip into dest, stripping the
// archive's top-level directory (node-vX-win-x64/…) so dest holds
// node.exe directly. It writes the .dhl-node-version marker that tells a
// later upgrade whether its bundled Node differs.
func extractNode(dest string) error {
	data, err := nodeZipBytes()
	if err != nil {
		return err
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("embedded node.zip: %w", err)
	}
	prefix := commonTopDir(reader)
	if err := extractZipTo(reader, dest, prefix); err != nil {
		return err
	}
	version := nodeVersionFromZip(reader, prefix)
	if version != "" {
		_ = os.WriteFile(filepath.Join(dest, ".dhl-node-version"), []byte(version), 0o644)
	}
	return nil
}

// extractZipTo unpacks reader into dest with prefix stripped from every
// name. Entries that would land outside dest (zip slip) are skipped —
// the archive ships inside our own exe, but the guard costs one line.
func extractZipTo(r *zip.Reader, dest string, prefix string) error {
	cleanDest := filepath.Clean(dest)
	for _, f := range r.File {
		name := strings.TrimPrefix(f.Name, prefix)
		if name == "" {
			continue
		}
		if strings.HasSuffix(name, "/") {
			if err := os.MkdirAll(filepath.Join(dest, filepath.FromSlash(name)), 0o755); err != nil {
				return err
			}
			continue
		}
		clean := filepath.Clean(filepath.Join(dest, filepath.FromSlash(name)))
		if !strings.HasPrefix(strings.ToLower(clean), strings.ToLower(cleanDest+string(os.PathSeparator))) {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(clean), 0o755); err != nil {
			return err
		}
		if err := extractZipEntry(f, clean); err != nil {
			return err
		}
	}
	return nil
}

func extractZipEntry(f *zip.File, dst string) error {
	src, err := f.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	tmp := dst + ".part"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, f.Mode())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// commonTopDir returns "node-vX-win-x64/" when every entry shares one
// first segment, so extraction lands the files directly in the target
// directory; "" when the zip has no wrapper directory.
func commonTopDir(r *zip.Reader) string {
	var top string
	for _, f := range r.File {
		name := filepath.ToSlash(f.Name)
		i := strings.Index(name, "/")
		if i < 0 {
			return "" // a file at the root: no wrapper directory
		}
		seg := name[:i+1]
		if top == "" {
			top = seg
		} else if top != seg {
			return ""
		}
	}
	return top
}

// nodeVersionFromZip pulls the version out of the wrapper directory name
// (node-v24.22.2-win-x64 → v24.22.2), "" when it cannot be read.
func nodeVersionFromZip(r *zip.Reader, prefix string) string {
	prefix = strings.TrimSuffix(prefix, "/")
	if prefix == "" {
		return ""
	}
	name := prefix
	name = strings.TrimPrefix(name, "node-")
	for _, tag := range []string{"-win-x64", "-win-x86"} {
		name = strings.TrimSuffix(name, tag)
	}
	if name == prefix || strings.ContainsAny(name, "/\\") {
		return ""
	}
	return name
}

// nodeNeedsRefresh reports whether the installed copy's bundled Node is
// missing or older than the one this exe carries. A same-version Node
// (the common upgrade) is left alone: re-extracting ~100MB per update
// for nothing is how updates feel slow.
func nodeNeedsRefresh(installedNodeDir string) (bool, error) {
	want := nodeVersionOfZip()
	if _, err := os.Stat(filepath.Join(installedNodeDir, "node.exe")); err != nil {
		return true, nil
	}
	marker, err := os.ReadFile(filepath.Join(installedNodeDir, ".dhl-node-version"))
	if err != nil || strings.TrimSpace(string(marker)) == "" {
		return true, nil // unknown vintage: refresh
	}
	return strings.TrimSpace(string(marker)) != want, nil
}
