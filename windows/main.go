// DHL for Windows — the tray shell where the launcher starts. The
// behaviours live in internal/*; this is only where the binary starts.
package main

import (
	"os"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/app"
)

// version is set at build time by build.ps1 (-ldflags -X main.version=…)
// from Resources/Info.plist, the way the macOS build names its bundle.
var version = "dev"

func main() {
	// The uninstall runner (--uninstall-run <pid>) must never reach the
	// app: it is a UI-less cleanup phase the quitting launcher staged in
	// %TEMP%, and it works while nothing else of DHL is alive.
	if app.HandleUninstallRunner(os.Args[1:]) {
		return
	}
	// A second launch with --panel is how the tray and the taskbar button
	// reach the running instance: the single-instance hand-off forwards
	// the arguments instead of starting a second app.
	app.SetStartupAction(os.Args[1:])
	_ = app.Run(version)
}
