package app

// panelservice.go routes the panel's row clicks to the launcher's actions.
// One entry point (Act) keeps the page's contract tiny: every row sends an
// id. The ids are also what the HTTP router (panelaction.go) forwards, so
// the page has exactly one action vocabulary.

import (
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

func nowMillis() int64 { return time.Now().UnixNano() / 1e6 }

// stayOpenActions lists the ids that keep the panel on screen: they act on
// what the user is looking at, and closing the window would throw the tab
// away mid-gesture. Everything else still closes the panel first — it is a
// launcher, not an app that squats on the screen.
var stayOpenActions = map[string]bool{
	"clear-unread":  true,
	"check-updates": true,
}

// PanelService is what the panel page calls back into.
type PanelService struct {
	ctl *controller
}

// Act runs one panel row.
func (s *PanelService) Act(id string) {
	if s.ctl == nil {
		return
	}
	applog.Logf("panel action: %s", id)
	if !stayOpenActions[id] {
		panel.Hide()
	}

	switch id {
	case "open":
		go s.ctl.Open()
	case "settings":
		go s.ctl.openSettings()
	case "restart":
		go s.ctl.Restart()
	case "refresh-page":
		// 刷新 Harness 页面：只重载页面，不动 dsh（macOS ⌘R 的对应项）。
		go s.ctl.RefreshPage()
	case "update-launcher":
		go s.ctl.openLauncherUpdate()
	case "update-dsh":
		go s.ctl.openDSHUpdate()
	case "log":
		if h != nil {
			go h.openLog()
		}
	case "quit":
		s.ctl.Quit()
	case "clear-unread":
		sessionStore.MarkAllRead()
		persistSessionUnread()
		s.ctl.refreshBadgeAndMenu()
		applog.Logf("panel: cleared all reminders")
	case "check-updates":
		go func() {
			s.ctl.checkUpdates(true)
			refreshOpenPanel()
		}()
	default:
		applog.Logf("panel action: unknown id %q", id)
	}
}

// InjectTestEvents seeds fake completions. Dev-only: it exists so the
// 会话 tab and the badges can be exercised without waiting for a real dsh
// turn, reachable through the --seed startup argument.
func (s *PanelService) InjectTestEvents(n int) {
	if n <= 0 {
		n = 8
	}
	items := make([]session.Event, 0, n)
	names := []string{"dsh-launcher", "my-app", "api-server", "web-frontend",
		"ml-training", "data-pipeline", "infra-deploy", "docs-site",
		"api-gateway", "auth-service"}
	for i := 0; i < n; i++ {
		name := names[i%len(names)]
		reason := "completed"
		if i%4 == 1 {
			reason = "error"
		}
		items = append(items, session.Event{
			Seq:       i + 1,
			SessionID: "test-" + name,
			Title:     name,
			Reason:    reason,
			At:        float64(nowMillis() - int64(i)*11*60*1000),
			Kind:      session.KindCompletion,
		})
	}
	sessionStore.Ingest(&session.Feed{BootID: "test-boot", Seq: n, Items: items})
	if s.ctl != nil {
		s.ctl.refreshBadgeAndMenu()
	}
	applog.Logf("panel: injected %d test events", n)
}
