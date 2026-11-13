// Package session carries the completion-reminder model ported from the
// macOS launcher (Sources/SessionNotifySupport.swift, since removed there:
// macOS now follows Harness's own sidebar status dot). The bundled
// dsh-session-notify plugin records root-session turn ends and serves them
// over loopback HTTP; this package polls that feed and keeps the unread set
// the tray badge and the menu list are drawn from.
//
// NOTE: the macOS launcher no longer maintains this model. The Windows port
// still does; aligning it with "display and counting follow Harness itself"
// is a separate change.
//
// The counting unit is a SESSION, not a turn: a long session writes one
// turn/end per round, and counting events would show "9 unread" for one
// session — obviously wrong on a badge.
package session

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Event kinds the plugin emits.
const (
	// KindCompletion is a root session's turn/end.
	KindCompletion = "completion"
	// KindResumed means the user posted another message there: the session
	// is being worked on again, so its completion reminder is stale.
	KindResumed = "resumed"
	// KindViewed means the user is looking at that session right now
	// (including a turn ending while they watch it).
	KindViewed = "viewed"
)

// Event is one record produced by the bundled plugin.
type Event struct {
	Seq       int     `json:"seq"`
	SessionID string  `json:"sessionId"`
	Title     string  `json:"title"`
	Reason    string  `json:"reason"`
	At        float64 `json:"at"` // epoch milliseconds (JS Date.now())
	Kind      string  `json:"kind"`
}

// IsResume reports a "worked on again" record.
func (e Event) IsResume() bool { return e.Kind == KindResumed }

// IsView reports a "being watched right now" record.
func (e Event) IsView() bool { return e.Kind == KindViewed }

// Feed is the snapshot from GET /dsh-session-notify/events?after=<seq>.
type Feed struct {
	BootID string  `json:"bootId"`
	Seq    int     `json:"seq"`
	Items  []Event `json:"items"`
}

// ParseFeed decodes a feed body; nil means it was not a feed.
func ParseFeed(body string) *Feed {
	var feed Feed
	if err := json.Unmarshal([]byte(body), &feed); err != nil {
		return nil
	}
	return &feed
}

// Ingest is one poll's outcome: the new completions, the resumed records,
// and the session ids the user is watching.
type Ingest struct {
	Completions []Event
	Resumed     []Event
	Viewed      []string
}

// IsEmpty reports that the poll changed nothing.
func (i Ingest) IsEmpty() bool {
	return len(i.Completions) == 0 && len(i.Resumed) == 0 && len(i.Viewed) == 0
}

// Store tracks completion events and the unread count the tray badge
// shows (Foxmail-style: the count stays until the user acknowledges it by
// opening a session or clearing the list).
type Store struct {
	events   []Event // recent completions, deduplicated by session, newest last
	unread   map[string]bool
	bootID   string
	lastSeq  int
	capacity int
	// Persist is called whenever the unread set changed, so the launcher
	// can keep it across restarts (macOS keeps it in UserDefaults; Windows
	// writes %APPDATA%\DHL\settings.json).
	Persist func([]Event)
}

// NewStore builds a store with the given capacity (at least 1).
func NewStore(capacity int) *Store {
	if capacity < 1 {
		capacity = 1
	}
	return &Store{capacity: capacity, unread: map[string]bool{}}
}

// Restore seeds the unread set from a previous run, newest last.
func (s *Store) Restore(events []Event) {
	seen := map[string]bool{}
	start := 0
	if len(events) > s.capacity {
		start = len(events) - s.capacity
	}
	for _, event := range events[start:] {
		if seen[event.SessionID] {
			continue
		}
		seen[event.SessionID] = true
		s.events = append(s.events, event)
		s.unread[event.SessionID] = true
	}
}

// UnreadCount is the badge count: the number of SESSIONS unread.
func (s *Store) UnreadCount() int { return len(s.unread) }

// PollAfterSeq is the cursor for the next `?after=`.
func (s *Store) PollAfterSeq() int { return s.lastSeq }

// MarkRead clears one session's reminder.
func (s *Store) MarkRead(sessionID string) {
	if !s.unread[sessionID] {
		return
	}
	delete(s.unread, sessionID)
	s.persist()
}

// Recent returns the unread events, newest first, capped at limit.
func (s *Store) Recent(limit int) []Event {
	var out []Event
	for i := len(s.events) - 1; i >= 0 && len(out) < limit; i-- {
		e := s.events[i]
		if s.unread[e.SessionID] {
			out = append(out, e)
		}
	}
	return out
}

// Row is one list entry: the event plus whether its session is still
// unread. The panel's 会话 tab lists history, not just reminders — a read
// row stays visible (dimmed) and clickable after its badge contribution
// is gone.
type Row struct {
	Event
	Unread bool
}

// Rows returns the recent records, newest first, read and unread alike,
// capped at limit.
func (s *Store) Rows(limit int) []Row {
	var out []Row
	for i := len(s.events) - 1; i >= 0 && len(out) < limit; i-- {
		e := s.events[i]
		out = append(out, Row{Event: e, Unread: s.unread[e.SessionID]})
	}
	return out
}

// Ingest merges a polled feed. A new bootId means the harness (and its
// sequence counter) restarted, so the cursor resets without re-counting
// anything. Resumed and viewed records retract the session's unread
// completion; an aborted turn is not a completion either (the user
// interrupted, sent a queued message, or pressed stop — the session is
// usually still running).
func (s *Store) Ingest(feed *Feed) Ingest {
	if feed == nil {
		return Ingest{}
	}
	if feed.BootID != s.bootID {
		s.bootID = feed.BootID
		s.lastSeq = 0
	}
	if len(feed.Items) == 0 {
		return Ingest{}
	}
	var fresh []Event
	for _, item := range feed.Items {
		if item.Seq > s.lastSeq {
			fresh = append(fresh, item)
		}
	}
	if len(fresh) == 0 {
		return Ingest{}
	}
	maxSeq := s.lastSeq
	for _, item := range fresh {
		if item.Seq > maxSeq {
			maxSeq = item.Seq
		}
	}
	s.lastSeq = maxSeq

	out := Ingest{}
	unreadBefore := len(s.unread)
	for _, event := range fresh {
		// one record per session: drop the older one, then decide
		kept := s.events[:0]
		for _, existing := range s.events {
			if existing.SessionID != event.SessionID {
				kept = append(kept, existing)
			}
		}
		s.events = kept

		switch {
		case event.IsResume():
			delete(s.unread, event.SessionID)
			out.Resumed = append(out.Resumed, event)
		case event.IsView():
			// the user is watching the result (or it ended in front of
			// them): retract rather than record. The poll carries viewing
			// state every few seconds, so only report what actually
			// retracted — otherwise the log fills up.
			if s.unread[event.SessionID] {
				delete(s.unread, event.SessionID)
				out.Viewed = append(out.Viewed, event.SessionID)
			}
		case event.Reason == "aborted":
			delete(s.unread, event.SessionID)
			out.Resumed = append(out.Resumed, event)
		default:
			s.events = append(s.events, event)
			s.unread[event.SessionID] = true
			out.Completions = append(out.Completions, event)
		}
	}
	if len(s.events) > s.capacity {
		s.events = s.events[len(s.events)-s.capacity:]
	}
	// unread only counts sessions still visible in the list: rows pushed
	// out by capacity must not keep hanging on the badge
	live := map[string]bool{}
	for _, e := range s.events {
		live[e.SessionID] = true
	}
	for id := range s.unread {
		if !live[id] {
			delete(s.unread, id)
		}
	}
	if len(s.unread) != unreadBefore {
		s.persist()
	}
	return out
}

// MarkAllRead clears the list and the unread set.
func (s *Store) MarkAllRead() {
	s.events = nil
	s.unread = map[string]bool{}
	s.persist()
}

// UnreadEvents returns the unread events for persistence.
func (s *Store) UnreadEvents() []Event {
	var out []Event
	for _, e := range s.events {
		if s.unread[e.SessionID] {
			out = append(out, e)
		}
	}
	return out
}

func (s *Store) persist() {
	if s.Persist == nil {
		return
	}
	s.Persist(s.UnreadEvents())
}

// --- presentation -----------------------------------------------------------

// ReasonLabel is the human wording for a turn end reason.
func ReasonLabel(reason string) string {
	switch reason {
	case "completed":
		return "已完成"
	case "error":
		return "出错"
	case "aborted":
		return "已中止"
	case "max-tokens":
		return "达到 token 上限"
	case "blocked":
		return "被阻塞"
	default:
		return "已结束"
	}
}

// TimeLabel renders the event time: HH:mm today, MM-dd HH:mm otherwise.
func TimeLabel(epochMs float64, now time.Time) string {
	at := time.Unix(0, int64(epochMs*1e6)).In(now.Location())
	if at.Year() == now.Year() && at.YearDay() == now.YearDay() {
		return at.Format("15:04")
	}
	return at.Format("01-02 15:04")
}

// MenuTitle is the menu row: `19:08 ·「dsh-launcher」已完成`, capped so a
// long name cannot widen the menu.
func MenuTitle(event Event, label string, now time.Time) string {
	runes := []rune(label)
	if len(runes) > 24 {
		label = string(runes[:24]) + "…"
	}
	return fmt.Sprintf("%s ·「%s」 %s", TimeLabel(event.At, now), label, ReasonLabel(event.Reason))
}

// BadgeText is the Foxmail-style badge: blank for none, digits to 99, then
// "99+".
func BadgeText(count int) string {
	if count <= 0 {
		return ""
	}
	if count > 99 {
		return "99+"
	}
	return fmt.Sprint(count)
}

// MenuLabel picks a row's name: workspace → title → short id. The plugin
// falls back to values like `session-`/`session-1335…` when it has no
// title, and a column of `session-` rows tells nobody anything.
func MenuLabel(workspace, title, sessionID string) string {
	if ws := strings.TrimSpace(workspace); ws != "" {
		return ws
	}
	if t := strings.TrimSpace(title); t != "" && !isPlaceholderTitle(t, sessionID) {
		return t
	}
	return ShortIdentifier(sessionID)
}

// ShortIdentifier turns `session-1335d7ff-…` into `1335d7ff`.
func ShortIdentifier(sessionID string) string {
	value := sessionID
	lowered := strings.ToLower(value)
	for _, prefix := range []string{"session-", "sess-", "chat-", "id-"} {
		if strings.HasPrefix(lowered, prefix) {
			value = value[len(prefix):]
			break
		}
	}
	runes := []rune(value)
	if len(runes) > 8 {
		return string(runes[:8])
	}
	return value
}

func isPlaceholderTitle(title, sessionID string) bool {
	if title == sessionID {
		return true
	}
	lowered := strings.ToLower(title)
	for _, prefix := range []string{"session-", "sess-", "chat-"} {
		if strings.HasPrefix(lowered, prefix) {
			rest := strings.ToLower(title[len(prefix):])
			return rest == "" || len(rest) <= 8 || strings.Contains(strings.ToLower(sessionID), rest)
		}
	}
	return false
}
