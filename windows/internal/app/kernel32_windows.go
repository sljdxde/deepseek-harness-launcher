package app

// kernel32_windows.go holds the kernel32 DLL handle shared by the
// process helpers.

import "syscall"

var kernel32 = syscall.NewLazyDLL("kernel32.dll")
