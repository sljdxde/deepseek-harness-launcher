package app

// platform_windows.go holds the Windows-native pieces the settings page
// drives: the login auto-start registry value (the counterpart of the
// macOS LaunchAgent) and the global hotkey (the counterpart of Carbon's
// RegisterEventHotKey).

import (
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

const (
	runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValue   = "DeepseekHarnessLauncher"
	// where Task Manager's Startup apps keeps a value switched off
	approvedPath = `Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`
)

var (
	advapi32             = syscall.NewLazyDLL("advapi32.dll")
	procRegOpenKeyExW    = advapi32.NewProc("RegOpenKeyExW")
	procRegCreateKeyExW  = advapi32.NewProc("RegCreateKeyExW")
	procRegSetValueExW   = advapi32.NewProc("RegSetValueExW")
	procRegQueryValueExW = advapi32.NewProc("RegQueryValueExW")
	procRegDeleteValueW  = advapi32.NewProc("RegDeleteValueW")
	procRegCloseKey      = advapi32.NewProc("RegCloseKey")
)

const (
	hkeyCurrentUser = 0x80000001
	keySetValue     = 0x0002
	keyQueryValue   = 0x0001
	regSZ           = 1
	regBinary       = 3
)

// executablePath is this program's own path.
func executablePath() (string, error) { return os.Executable() }

// runtimeLockOSThread pins the hotkey pump to one OS thread, which is
// where RegisterHotKey's messages arrive.
func runtimeLockOSThread() { runtime.LockOSThread() }

// setLaunchAtLogin writes or removes the per-user Run value. No admin
// rights are needed, which is the whole reason Windows keeps this key
// per user.
func setLaunchAtLogin(enabled bool) error {
	if !enabled {
		return deleteRunValue()
	}
	exe, err := executablePath()
	if err != nil {
		return err
	}
	value := `"` + exe + `"`
	if err := writeRunValue(value); err != nil {
		return err
	}
	// Task Manager can switch a Run value off while leaving it in place;
	// turning the setting on again must clear that marker, or Windows
	// starts nothing and the checkbox lies.
	clearApprovedMarker()
	return nil
}

// launchAtLoginEnabled reports the current state.
func launchAtLoginEnabled() bool {
	key, err := openKey(runKeyPath, keyQueryValue)
	if err != nil {
		return false
	}
	defer procRegCloseKey.Call(uintptr(key))
	if _, ok := queryValue(key, runValue); !ok {
		return false
	}
	return !approvedSwitchedOff()
}

func writeRunValue(value string) error {
	key, _, err := createKey(runKeyPath, keySetValue)
	if err != nil {
		return err
	}
	defer procRegCloseKey.Call(uintptr(key))
	data := utf16Bytes(value)
	ret, _, _ := procRegSetValueExW.Call(uintptr(key), uintptr(unsafe.Pointer(utf16Ptr(runValue))),
		0, regSZ, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)))
	if ret != 0 {
		return fmt.Errorf("RegSetValueExW failed: %d", ret)
	}
	return nil
}

func deleteRunValue() error {
	key, err := openKey(runKeyPath, keySetValue)
	if err != nil {
		return nil // no key means nothing to remove
	}
	defer procRegCloseKey.Call(uintptr(key))
	procRegDeleteValueW.Call(uintptr(key), uintptr(unsafe.Pointer(utf16Ptr(runValue))))
	return nil
}

// approvedSwitchedOff reports Task Manager's "disabled" marker: an odd
// first byte means off.
func approvedSwitchedOff() bool {
	key, err := openKey(approvedPath, keyQueryValue)
	if err != nil {
		return false // no marker at all means every Run value is on
	}
	defer procRegCloseKey.Call(uintptr(key))
	data, ok := queryValue(key, runValue)
	return ok && len(data) > 0 && data[0]&1 == 1
}

func clearApprovedMarker() {
	key, err := openKey(approvedPath, keySetValue)
	if err != nil {
		return
	}
	defer procRegCloseKey.Call(uintptr(key))
	procRegDeleteValueW.Call(uintptr(key), uintptr(unsafe.Pointer(utf16Ptr(runValue))))
}

func openKey(path string, access uint32) (syscall.Handle, error) {
	var key syscall.Handle
	ret, _, _ := procRegOpenKeyExW.Call(uintptr(hkeyCurrentUser), uintptr(unsafe.Pointer(utf16Ptr(path))),
		0, uintptr(access), uintptr(unsafe.Pointer(&key)))
	if ret != 0 {
		return 0, fmt.Errorf("RegOpenKeyExW failed: %d", ret)
	}
	return key, nil
}

func createKey(path string, access uint32) (syscall.Handle, bool, error) {
	var key syscall.Handle
	var disposition uint32
	ret, _, _ := procRegCreateKeyExW.Call(uintptr(hkeyCurrentUser), uintptr(unsafe.Pointer(utf16Ptr(path))),
		0, 0, 0, uintptr(access), 0, uintptr(unsafe.Pointer(&key)), uintptr(unsafe.Pointer(&disposition)))
	if ret != 0 {
		return 0, false, fmt.Errorf("RegCreateKeyExW failed: %d", ret)
	}
	return key, disposition == 2, nil // 2 = REG_OPENED_EXISTING_KEY
}

func queryValue(key syscall.Handle, name string) ([]byte, bool) {
	var size uint32
	var kind uint32
	ret, _, _ := procRegQueryValueExW.Call(uintptr(key), uintptr(unsafe.Pointer(utf16Ptr(name))),
		0, uintptr(unsafe.Pointer(&kind)), 0, uintptr(unsafe.Pointer(&size)))
	if ret != 0 || size == 0 {
		return nil, false
	}
	buf := make([]byte, size)
	ret, _, _ = procRegQueryValueExW.Call(uintptr(key), uintptr(unsafe.Pointer(utf16Ptr(name))),
		0, uintptr(unsafe.Pointer(&kind)), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if ret != 0 {
		return nil, false
	}
	return buf, true
}

func utf16Ptr(s string) *uint16 {
	ptr, err := syscall.UTF16PtrFromString(s)
	if err != nil {
		empty, _ := syscall.UTF16PtrFromString("")
		return empty
	}
	return ptr
}

func utf16Bytes(s string) []byte {
	runes := utf16Ptr(s)
	// length in bytes including the terminating NUL
	n := 0
	for p := unsafe.Pointer(runes); *(*uint16)(p) != 0; p = unsafe.Pointer(uintptr(p) + 2) {
		n += 2
	}
	n += 2
	buf := make([]byte, n)
	copy(buf, unsafe.Slice((*byte)(unsafe.Pointer(runes)), n))
	return buf
}

// --- global hotkey -----------------------------------------------------------
