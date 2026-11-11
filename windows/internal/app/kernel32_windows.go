package app

// kernel32_windows.go holds the kernel32 DLL handle shared by the
// process helpers. It used to live in hostwindow_windows.go, which was
// deleted with the invisible-host-window click-detection hack.

import "syscall"

var kernel32 = syscall.NewLazyDLL("kernel32.dll")
