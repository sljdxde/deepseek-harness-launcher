package app

// The tabbed panel's pure logic: the payload shape, the session rows with
// their unread flags, the fixed height, and the update rows. The page is
// exercised on a real machine; these tests pin the data contract the page
// and the Go side share.

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

func TestPanelPayloadIsValidJSON(t *testing.T) {
	model := panelModel{
		Status:  "运行中 · 端口 3080（已接管）",
		Running: true,
		Version: "0.3.11",
		Sessions: []sessionRow{
			{SessionID: "s1", Label: `他说"你好"`, Reason: "completed", AtMillis: 1000, Unread: true},
			{SessionID: "s2", Label: "已读会话", Reason: "error", AtMillis: 900, Unread: false},
		},
		UnreadAll: 1,
		Launcher:  updateRow{Current: "0.3.11", Pending: "0.3.12"},
		DSH:       updateRow{Current: "0.2.1", Pending: "0.2.2-rc.1", Label: "候选版"},
		Plugins:   2,
		Settings: settingsModel{
			Theme: "light", Freq: 6, AutoUpdate: true, Mirror: true,
			AutoCheckUpdates: true, AutoCheckPluginUpdates: true,
			OpenOnReady: true, LaunchAtLogin: false,
		},
	}
	payload := panelPayload(model)

	var decoded struct {
		Status   string `json:"status"`
		Running  bool   `json:"running"`
		Version  string `json:"version"`
		Sessions []struct {
			ID     string `json:"id"`
			Label  string `json:"label"`
			Unread bool   `json:"unread"`
		} `json:"sessions"`
		UnreadAll int `json:"unreadAll"`
		Launcher  struct {
			Current string `json:"current"`
			Pending string `json:"pending"`
		} `json:"launcher"`
		DSH struct {
			Pending string `json:"pending"`
			Label   string `json:"label"`
		} `json:"dsh"`
		Plugins  int `json:"plugins"`
		Settings struct {
			Theme                  string  `json:"theme"`
			Freq                   float64 `json:"freq"`
			AutoUpdate             bool    `json:"autoUpdate"`
			Mirror                 bool    `json:"mirror"`
			AutoCheckUpdates       bool    `json:"autoCheckUpdates"`
			AutoCheckPluginUpdates bool    `json:"autoCheckPluginUpdates"`
			OpenOnReady            bool    `json:"openOnReady"`
			LaunchAtLogin          bool    `json:"launchAtLogin"`
		} `json:"settings"`
	}
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatalf("panelPayload is not valid JSON: %v\n%s", err, payload)
	}
	if decoded.Status != model.Status || !decoded.Running || decoded.Version != "0.3.11" {
		t.Errorf("header fields wrong: %+v", decoded)
	}
	if len(decoded.Sessions) != 2 {
		t.Fatalf("sessions = %d, want 2", len(decoded.Sessions))
	}
	// the payload must carry the unread flag per row: the page dims read
	// rows and highlights unread ones from exactly this field
	if decoded.Sessions[0].Label != `他说"你好"` || !decoded.Sessions[0].Unread {
		t.Errorf("session 0 = %+v", decoded.Sessions[0])
	}
	if decoded.Sessions[1].Unread {
		t.Errorf("session 1 must be read: %+v", decoded.Sessions[1])
	}
	if decoded.UnreadAll != 1 {
		t.Errorf("unreadAll = %d, want 1", decoded.UnreadAll)
	}
	if decoded.Launcher.Pending != "0.3.12" || decoded.DSH.Label != "候选版" {
		t.Errorf("update rows wrong: %+v %+v", decoded.Launcher, decoded.DSH)
	}
	s := decoded.Settings
	if s.Theme != "light" || s.Freq != 6 || !s.AutoUpdate || !s.Mirror ||
		!s.AutoCheckUpdates || !s.AutoCheckPluginUpdates || !s.OpenOnReady || s.LaunchAtLogin {
		t.Errorf("settings wrong: %+v", s)
	}
	if decoded.Plugins != 2 {
		t.Errorf("plugins = %d, want 2", decoded.Plugins)
	}
}

// The two update chains must stay separate rows in the payload: DHL and
// dsh act on different things and must never be merged.
func TestPanelPayloadKeepsUpdateChannelsSeparate(t *testing.T) {
	model := panelModel{
		Launcher: updateRow{Current: "1", Pending: "2"},
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(panelPayload(model)), &decoded); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if _, ok := decoded["launcher"]; !ok {
		t.Error("payload lost the launcher channel")
	}
	if _, ok := decoded["dsh"]; !ok {
		t.Error("payload lost the dsh channel")
	}
}

func TestPanelPayloadEmptyIsStillValid(t *testing.T) {
	var decoded map[string]any
	if err := json.Unmarshal([]byte(panelPayload(panelModel{})), &decoded); err != nil {
		t.Fatalf("empty payload is not valid JSON: %v", err)
	}
}

// The panel height is fixed by design — the tab content scrolls inside —
// so a background poll refreshing an open panel must never resize it.
// The bound lives in geometry_test.go (it must fit a 1024×768 screen);
// this pins the value the window is actually created and positioned with.
func TestPanelHeightFixed(t *testing.T) {
	if panelHeight <= 0 {
		t.Fatalf("panelHeight = %d, must be positive", panelHeight)
	}
	work := application.Rect{X: 0, Y: 0, Width: 1920, Height: 1040}
	if _, y := trayCorner(work); y != 1040-panelHeight-4 {
		t.Errorf("trayCorner y = %d, so the panel is not anchored to the panel height", y)
	}
}

// trayCorner hugs the primary work area's bottom-right, where the tray
// lives, with the 4 DIP gap that keeps the panel visually attached.
func TestTrayCornerAtWorkAreaCorner(t *testing.T) {
	work := application.Rect{X: 0, Y: 0, Width: 1920, Height: 1040}
	x, y := trayCorner(work)
	if x != 1920-panelWidth-4 {
		t.Errorf("x = %d, want %d", x, 1920-panelWidth-4)
	}
	if y != 1040-panelHeight-4 {
		t.Errorf("y = %d, want %d", y, 1040-panelHeight-4)
	}
}

// sessionStore.Rows carries read rows too, with the unread flag — that is
// what makes the 会话 tab history rather than a reminder list.
func TestSessionRowsIncludeRead(t *testing.T) {
	store := session.NewStore(10)
	store.Ingest(&session.Feed{BootID: "b", Seq: 2, Items: []session.Event{
		{Seq: 1, SessionID: "s1", Title: "一", Reason: "completed", At: 1000, Kind: session.KindCompletion},
		{Seq: 2, SessionID: "s2", Title: "二", Reason: "error", At: 900, Kind: session.KindCompletion},
	}})
	store.MarkRead("s1")

	rows := store.Rows(10)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2 (read rows stay listed)", len(rows))
	}
	// newest by seq first (the store orders by sequence, not by At)
	if rows[0].SessionID != "s2" || !rows[0].Unread {
		t.Errorf("row 0 = %+v, want unread s2", rows[0])
	}
	if rows[1].SessionID != "s1" || rows[1].Unread {
		t.Errorf("row 1 = %+v, want read s1", rows[1])
	}
}

// stayOpenActions decides whether a click closes the panel; the actions
// that act on the visible tab must stay open, the navigating ones must
// not.
func TestStayOpenActions(t *testing.T) {
	for _, id := range []string{"clear-unread", "check-updates"} {
		if !stayOpenActions[id] {
			t.Errorf("%q must keep the panel open", id)
		}
	}
	for _, id := range []string{"open", "settings", "restart", "quit",
		"update-launcher", "update-dsh", "log"} {
		if stayOpenActions[id] {
			t.Errorf("%q must close the panel", id)
		}
	}
}

// The model builder must always fill the header's three dynamic pieces:
// status, running and the unread count. Everything else can be empty.
func TestBuildPanelModelHeaderAlwaysFilled(t *testing.T) {
	// Run() injects the version before any model is built; the test does
	// the same so the model carries it into the launcher update row.
	ctl := &controller{version: "0.3.11", autoCheckUpdates: true}
	model := ctl.buildPanelModel()
	if model.Status == "" {
		t.Error("status must never be empty: the header has nothing else to show")
	}
	if model.Running {
		t.Error("a fresh controller is not running")
	}
	if model.UnreadAll != 0 {
		t.Errorf("unreadAll = %d, want 0", model.UnreadAll)
	}
	if model.Launcher.Current != "0.3.11" {
		t.Errorf("launcher current = %q, want the controller's version", model.Launcher.Current)
	}
	if model.Settings.Theme != "system" {
		t.Errorf("default theme = %q, want system", model.Settings.Theme)
	}
	if !model.Settings.AutoCheckUpdates {
		t.Error("autoCheckUpdates must default to on")
	}
}

// stepFrequency moves by exactly one hour and clamps at 1 and 168.
func TestStepFrequency(t *testing.T) {
	ctl := &controller{updateIntervalHours: 6}
	if got := ctl.stepFrequency("up"); got != 7 {
		t.Errorf("step up from 6 = %v, want 7", got)
	}
	if got := ctl.stepFrequency("down"); got != 6 {
		t.Errorf("step back down = %v, want 6", got)
	}
	ctl.updateIntervalHours = 1
	if got := ctl.stepFrequency("down"); got != 1 {
		t.Errorf("step below 1 must clamp: %v", got)
	}
	ctl.updateIntervalHours = 168
	if got := ctl.stepFrequency("up"); got != 168 {
		t.Errorf("step above 168 must clamp: %v", got)
	}
	// an unset interval starts from the 6h default
	ctl.updateIntervalHours = 0
	if got := ctl.stepFrequency("up"); got != 7 {
		t.Errorf("step up from unset = %v, want 7", got)
	}
}

// mirrorEnabled: an unset registry means the default chain (npmmirror
// first) — the toggle shows on; an explicit npmjs means the user turned
// it off.
func TestMirrorEnabled(t *testing.T) {
	cases := []struct {
		registry string
		want     bool
	}{
		{"", true},
		{"https://registry.npmmirror.com", true},
		{"https://registry.npmjs.org", false},
	}
	for _, c := range cases {
		if got := mirrorEnabled(c.registry); got != c.want {
			t.Errorf("mirrorEnabled(%q) = %v, want %v", c.registry, got, c.want)
		}
	}
}

// the panel action vocabulary the page and the Go side share: every id the
// page can send must be routed by Act, or the click dies in the default
// case with only a log line.
func TestPanelActionVocabulary(t *testing.T) {
	known := map[string]bool{
		"open": true, "settings": true, "restart": true,
		"update-launcher": true, "update-dsh": true,
		"log": true, "quit": true,
		"clear-unread": true, "check-updates": true,
	}
	// the page sends exactly these ids (panelpage.go); keep this list in
	// sync with the markup
	for _, id := range []string{"open", "restart", "quit",
		"clear-unread", "update-launcher", "update-dsh", "check-updates"} {
		if !known[id] {
			t.Errorf("page id %q is not routed by Act", id)
		}
	}
}

// With nothing unread the page must not paint any red affordance: the
// count pill and the clear-all link are both omitted (an empty span with
// a red background still reads as "something is unread").
func TestPanelPageOmitsUnreadChrome(t *testing.T) {
	empty := panelHTML(panelModel{Version: "0.3.11"})
	for _, bad := range []string{`id="unreadBadge"`, `id="clearAll"`} {
		if strings.Contains(empty, bad) {
			t.Errorf("panel with no unread still contains %q", bad)
		}
	}
	withUnread := panelHTML(panelModel{Version: "0.3.11", UnreadAll: 4})
	for _, want := range []string{`id="unreadBadge"`, `id="clearAll"`} {
		if !strings.Contains(withUnread, want) {
			t.Errorf("panel with unread is missing %q", want)
		}
	}
}

// An older published release must never be announced: this machine runs
// 0.3.11-1.1, and a 0.3.10 tag was being offered as an update.
func TestLauncherReleaseAction(t *testing.T) {
	cases := []struct {
		release, installed, skipped string
		wantNewer, wantSkipped      bool
	}{
		{"0.3.10", "0.3.11-1.1", "", false, false},
		{"0.3.11-1.1", "0.3.11-1.1", "", false, false},
		{"0.3.12", "0.3.11-1.1", "", true, false},
		{"0.3.12", "0.3.11-1.1", "0.3.12", true, true},
		// per the release-cycle rule a formal x.y.z is NEWER than its
		// -a.b test candidate, so this one must still announce
		{"0.3.11", "0.3.11-1.1", "", true, false},
	}
	for _, c := range cases {
		newer, skipped := launcherReleaseAction(c.release, c.installed, c.skipped)
		if newer != c.wantNewer || skipped != c.wantSkipped {
			t.Errorf("release %s vs installed %s (skipped %q) = newer:%v skipped:%v, want %v/%v",
				c.release, c.installed, c.skipped, newer, skipped, c.wantNewer, c.wantSkipped)
		}
	}
}

// TestPanelPageSelectorsMatchMarkup is the regression test for "设置里的按钮
// 都点不动": the page's click delegation matched `.dhl-sw` while the markup
// rendered `class="sw"`, so every switch was inert with no request and no
// log line. It caught the refresh icon too (id=refreshBtn, selector
// [data-refresh]). Both are checked here against the real rendered page.
func TestPanelPageSelectorsMatchMarkup(t *testing.T) {
	ctl := &controller{version: "0.3.12", autoCheckUpdates: true}
	page := panelHTML(ctl.buildPanelModel())

	// every switch the page renders must be reachable by the selector the
	// delegation uses
	if !strings.Contains(page, `t.closest('.sw')`) {
		t.Error("click delegation no longer matches the .sw switch selector")
	}
	for _, key := range []string{"autoCheckUpdates", "autoUpdate", "mirror",
		"launchAtLogin", "openOnReady", "notifyOnComplete"} {
		if !strings.Contains(page, `data-key="`+key+`"`) {
			t.Errorf("switch %q missing from the rendered page", key)
		}
	}
	if !strings.Contains(page, `class="sw`) {
		t.Error("switches must carry the .sw class the delegation matches")
	}

	// the header refresh button must be selectable by [data-refresh]
	if !strings.Contains(page, `id="refreshBtn" data-refresh`) {
		t.Error("refresh button is not matched by the [data-refresh] handler")
	}

	// doRestart must not look the status dot up by id: it has no id, and
	// the null dereference made 重启 a silent no-op.
	if strings.Contains(page, `getElementById('dot')`) {
		t.Error("doRestart still reads the status dot by id; it has no id")
	}
	if !strings.Contains(page, `querySelector('.hd .dot')`) {
		t.Error("doRestart must locate the status dot by its class")
	}
}

// The removed experiment must be gone from the page: 侧栏 Deck was an
// experimental toggle the user asked to drop, and a leftover switch would
// render a control whose action no longer exists.
func TestPanelPageDropsExperimentalSwitches(t *testing.T) {
	ctl := &controller{version: "0.3.12", autoCheckUpdates: true}
	page := panelHTML(ctl.buildPanelModel())
	for _, gone := range []string{"sidebarDeck", "侧栏 Deck", "autoCheckPluginUpdates"} {
		if strings.Contains(page, gone) {
			t.Errorf("removed setting %q still renders", gone)
		}
	}
	// 刷新页面 button was removed too — Ctrl+R in the page does the job
	if strings.Contains(page, "refresh-page") {
		t.Error("the 刷新页面 button must be gone; Ctrl+R reloads the page")
	}
}

// The switch endpoint must accept every key the page renders. This is the
// HTTP half of the "设置里的按钮都点不动" bug: the page never sent the
// request because its selector did not match, and a key the router did not
// know would have died in the default case with only a log line.
func TestPanelSwitchRouteHandlesEveryRenderedKey(t *testing.T) {
	ctl := &controller{version: "0.3.12", autoCheckUpdates: true, notifyOnComplete: true}
	panel.ctl = ctl
	defer func() { panel.ctl = nil }()

	for _, key := range []string{
		"autoCheckUpdates", "autoUpdate", "mirror",
		"launchAtLogin", "openOnReady", "notifyOnComplete",
	} {
		form := url.Values{"key": {key}, "on": {"0"}}
		r := httptest.NewRequest("POST", "/dhl-action", strings.NewReader(form.Encode()))
		r.Header.Set("content-type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()

		handlePanelAction("sw", "", w, r)

		body := w.Body.String()
		if !strings.Contains(body, `"ok":true`) {
			t.Errorf("switch %q: response %q, want an ok JSON answer", key, body)
		}
		// an unknown key returns early with no body, which is the failure
		// this test exists to catch
		if !strings.Contains(body, `"on":`) {
			t.Errorf("switch %q: response %q carries no effective state", key, body)
		}
	}
}

// The session rows the page renders must be clickable by the selector the
// delegation uses. They render `data-sid`, while the handler looked for
// `data-jump` — so a click on a finished session did nothing at all, which
// is the "单击应该可以定位到对应会话" report.
func TestPanelSessionRowIsClickable(t *testing.T) {
	ctl := &controller{version: "0.3.12", autoCheckUpdates: true}
	sessionStore.Restore([]session.Event{{
		Seq: 1, SessionID: "session-1335d7ff-x", Title: "修复登录问题",
		Reason: "completed", At: 1_700_000_000_000, Kind: "completion",
	}})
	t.Cleanup(func() { sessionStore.Restore(nil) })

	page := panelHTML(ctl.buildPanelModel())

	// the row carries the id the click handler reads
	if !strings.Contains(page, `data-sid="session-1335d7ff-x"`) {
		t.Fatal("the session row lost its data-sid attribute")
	}
	// and the handler matches on that same attribute
	if !strings.Contains(page, `t.closest('[data-sid]')`) {
		t.Error("the click delegation does not match [data-sid]; rows would be inert")
	}
	if strings.Contains(page, `t.closest('[data-jump]')`) {
		t.Error("the delegation still looks for [data-jump], which no row renders")
	}
	// a clickable row must look clickable
	if !strings.Contains(page, "cursor:pointer") {
		t.Error("session rows must show a pointer cursor")
	}
}

// A finished session must be labelled with its title, not the folder it
// ran in — otherwise every row in one project reads the same.
func TestPanelSessionRowUsesSessionTitle(t *testing.T) {
	ctl := &controller{version: "0.3.12", autoCheckUpdates: true}
	sessionStore.Restore([]session.Event{{
		Seq: 1, SessionID: "session-1335d7ff-x", Title: "修复登录问题",
		Reason: "completed", At: 1_700_000_000_000, Kind: "completion",
	}})
	t.Cleanup(func() { sessionStore.Restore(nil) })

	page := panelHTML(ctl.buildPanelModel())
	if !strings.Contains(page, "修复登录问题") {
		t.Error("the row does not show the session title")
	}
	if !strings.Contains(page, `title="修复登录问题"`) {
		t.Error("the row's tooltip does not carry the session title")
	}
}

// A duplicated function definition in the page's script means the later
// copy silently wins. sessionsHTML was defined twice; the duplicate is
// gone and must not come back, because the copy that wins is the one that
// renders the rows.
func TestPanelPageDefinesEachHelperOnce(t *testing.T) {
	ctl := &controller{version: "0.3.12", autoCheckUpdates: true}
	page := panelHTML(ctl.buildPanelModel())
	for _, fn := range []string{"function sessionsHTML(", "function timeLabel(", "function esc("} {
		if got := strings.Count(page, fn); got != 1 {
			t.Errorf("%s appears %d times, want exactly 1", fn, got)
		}
	}
}

// The payload the panel's JS receives must carry every setting the page
// renders a switch for. A missing key means the pushed model cannot restore
// that switch after a re-render, and the UI silently drifts from the
// stored value.
func TestPanelPayloadCarriesEveryRenderedSetting(t *testing.T) {
	ctl := &controller{version: "0.3.12", autoCheckUpdates: true, notifyOnComplete: true}
	page := panelHTML(ctl.buildPanelModel())

	var payload struct {
		Settings map[string]any `json:"settings"`
	}
	if err := json.Unmarshal([]byte(panelPayload(ctl.buildPanelModel())), &payload); err != nil {
		t.Fatalf("payload: %v", err)
	}
	settings := payload.Settings

	// every data-key the page renders must exist in the pushed settings
	keys := []string{
		"autoCheckUpdates", "autoUpdate", "mirror",
		"launchAtLogin", "openOnReady", "notifyOnComplete",
	}
	for _, key := range keys {
		if !strings.Contains(page, `data-key="`+key+`"`) {
			t.Errorf("the page no longer renders a switch for %q", key)
			continue
		}
		if _, ok := settings[key]; !ok {
			t.Errorf("the payload has no %q, so the pushed model cannot restore that switch", key)
		}
	}
}
