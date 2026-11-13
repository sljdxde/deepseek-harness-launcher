package app

// The update dialog's page contract: what the window renders for a release,
// the three answers it offers, and the sizing that keeps it on screen.
// The window itself is exercised on a real machine; these tests pin the
// HTML the Go side hands to it.

import (
	"strings"
	"testing"
)

func TestLauncherDialogRendersMarkdownNotes(t *testing.T) {
	release := &launcherRelease{
		Version: "0.4.0",
		Notes:   "## Deepseek Harness Launcher v0.4.0\n\n- 侧栏 Deck **已下线**\n\n现在下载并安装吗?",
	}
	model := launcherUpdateDialogModel(release, "0.3.12-1.1-SNAPSHOT", "light", false)
	html := updateDialogHTML(model)

	for _, want := range []string{
		`data-theme="light"`,
		"启动器更新",
		"v0.3.12-1.1-SNAPSHOT",
		"v0.4.0",
		"<h2>Deepseek Harness Launcher v0.4.0</h2>",
		"<li>侧栏 Deck <strong>已下线</strong></li>",
		"下载并安装",
		"稍后",
		"跳过此版本",
		`data-act="update-confirm"`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("dialog page missing %q\n%s", want, html)
		}
	}
	// The whole point of the rewrite: no literal Markdown in the dialog.
	if strings.Contains(html, "## Deepseek") || strings.Contains(html, "**已下线**") {
		t.Fatalf("raw Markdown reached the dialog:\n%s", html)
	}
}

func TestDialogShowsNoNotesFallback(t *testing.T) {
	model := launcherUpdateDialogModel(&launcherRelease{Version: "0.4.0"}, "0.3.0", "", false)
	if !strings.Contains(updateDialogHTML(model), "该版本未提供更新说明。") {
		t.Fatalf("missing notes should render the fallback line")
	}
}

func TestSkippedVersionTogglesTheThirdButton(t *testing.T) {
	release := &launcherRelease{Version: "0.4.0"}
	skipped := updateDialogHTML(launcherUpdateDialogModel(release, "0.3.0", "", true))
	if !strings.Contains(skipped, `data-act="update-unskip"`) ||
		!strings.Contains(skipped, "取消跳过此版本") {
		t.Fatalf("a skipped version must offer 取消跳过此版本:\n%s", skipped)
	}
	notSkipped := updateDialogHTML(launcherUpdateDialogModel(release, "0.3.0", "", false))
	if !strings.Contains(notSkipped, `data-act="update-skip"`) ||
		!strings.Contains(notSkipped, "跳过此版本") {
		t.Fatalf("an unskipped version must offer 跳过此版本:\n%s", notSkipped)
	}
}

func TestDSHDialogCarriesChannelAndNotes(t *testing.T) {
	model := dshUpdateDialogModel("0.2.2-rc.1", "候选版", "### New\n\n- 更快启动", "0.2.1", "system", false)
	html := updateDialogHTML(model)
	for _, want := range []string{"Deepseek Harness 更新", "可更新到", "v0.2.2-rc.1", "候选版", "<h3>New</h3>", "立即更新"} {
		if !strings.Contains(html, want) {
			t.Fatalf("dsh dialog missing %q\n%s", want, html)
		}
	}
}

func TestDialogEscapesRemoteVersionStrings(t *testing.T) {
	release := &launcherRelease{Version: `<img src=x>`, Notes: ""}
	html := updateDialogHTML(launcherUpdateDialogModel(release, "0.3.0", "", false))
	if strings.Contains(html, "<img src=x>") {
		t.Fatalf("remote version string injected markup:\n%s", html)
	}
	if !strings.Contains(html, "&lt;img src=x&gt;") {
		t.Fatalf("version string was not escaped:\n%s", html)
	}
}

func TestUpdateDialogGeometryFitsSmallWorkArea(t *testing.T) {
	// The machine in the bug report: work area 1280×680 DIPs. A fixed
	// 660-high dialog plus frame lands under the taskbar.
	w, h := updateDialogGeometry(1280, 680)
	if w != 620 {
		t.Fatalf("width on a 1280-wide work area = %d, want 620", w)
	}
	if h != 632 {
		t.Fatalf("height on a 680-high work area = %d, want 632 (work area minus 48)", h)
	}

	// Absurdly small areas still get a usable, clamped dialog.
	w, h = updateDialogGeometry(300, 300)
	if w != 420 || h != 400 {
		t.Fatalf("small work area produced %dx%d, want the 420x400 floor", w, h)
	}

	// Unknown screen data must not collapse the window to nothing.
	w, h = updateDialogGeometry(0, 0)
	if w != 620 || h != 660 {
		t.Fatalf("unknown work area produced %dx%d, want the preferred size", w, h)
	}
}

func TestCenteredRectStaysInsideWorkArea(t *testing.T) {
	x, y := centeredRect(0, 0, 1280, 680, 620, 632)
	if x != 330 || y != 24 {
		t.Fatalf("centred at (%d,%d), want (330,24)", x, y)
	}
	// An offset monitor must not pull the window back to the origin.
	x, y = centeredRect(-1920, 0, 1920, 1080, 480, 200)
	if x != -1200 || y != 440 {
		t.Fatalf("secondary monitor placement = (%d,%d), want (-1200,440)", x, y)
	}
}
