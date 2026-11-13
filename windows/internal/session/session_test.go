package session

import (
	"testing"
	"time"
)

// Cases come verbatim from scripts/test-session-notify.swift so the
// Windows port keeps the same unread semantics.

func ev(seq int, session string, reason string, kind string) Event {
	if reason == "" {
		reason = "completed"
	}
	if kind == "" {
		kind = KindCompletion
	}
	return Event{Seq: seq, SessionID: session, Title: "会话" + session, Reason: reason, At: 0, Kind: kind}
}

func TestRegularPoll(t *testing.T) {
	store := NewStore(50)
	first := store.Ingest(&Feed{BootID: "b1", Seq: 2, Items: []Event{ev(1, "a", "", ""), ev(2, "b", "", "")}})
	if len(first.Completions) != 2 || first.Completions[0].Seq != 1 || first.Completions[1].Seq != 2 {
		t.Errorf("completions = %+v", first.Completions)
	}
	if len(first.Resumed) != 0 {
		t.Error("no resumed records expected")
	}
	if store.UnreadCount() != 2 {
		t.Errorf("unread = %d, want 2", store.UnreadCount())
	}
	if store.PollAfterSeq() != 2 {
		t.Errorf("cursor = %d, want 2", store.PollAfterSeq())
	}

	// the same session finishing another round keeps the count
	second := store.Ingest(&Feed{BootID: "b1", Seq: 3, Items: []Event{
		ev(2, "b", "error", ""), ev(3, "a", "", ""),
	}})
	if len(second.Completions) != 1 || second.Completions[0].Seq != 3 {
		t.Errorf("second completions = %+v", second.Completions)
	}
	if store.UnreadCount() != 2 {
		t.Errorf("unread = %d, want 2 (same sessions)", store.UnreadCount())
	}
	if recent := store.Recent(1); len(recent) != 1 || recent[0].Reason != "completed" {
		t.Errorf("recent = %+v", recent)
	}

	// five rounds in one session is ONE unread session — the badge bug
	chatty := NewStore(50)
	chatty.Ingest(&Feed{BootID: "b1", Seq: 5, Items: []Event{
		ev(1, "same", "", ""), ev(2, "same", "", ""), ev(3, "same", "", ""),
		ev(4, "same", "", ""), ev(5, "same", "", ""),
	}})
	if chatty.UnreadCount() != 1 {
		t.Errorf("chatty unread = %d, want 1", chatty.UnreadCount())
	}
	chatty.Ingest(&Feed{BootID: "b1", Seq: 9, Items: []Event{
		ev(6, "same", "", ""), ev(7, "same", "", ""), ev(8, "same", "", ""), ev(9, "same", "", ""),
	}})
	if chatty.UnreadCount() != 1 {
		t.Errorf("chatty unread after more rounds = %d, want 1", chatty.UnreadCount())
	}
	if recent := chatty.Recent(5); len(recent) != 1 || recent[0].Seq != 9 {
		t.Errorf("chatty recent = %+v", recent)
	}

	// recent is newest first
	if recent := store.Recent(2); len(recent) != 2 || recent[0].SessionID != "a" || recent[1].SessionID != "b" {
		t.Errorf("recent order = %+v", recent)
	}
}

func TestHarnessRestart(t *testing.T) {
	store := NewStore(50)
	store.Ingest(&Feed{BootID: "b1", Seq: 2, Items: []Event{ev(1, "a", "", ""), ev(2, "b", "", "")}})

	restarted := store.Ingest(&Feed{BootID: "b2", Seq: 0})
	if !restarted.IsEmpty() {
		t.Error("an empty restart feed changes nothing")
	}
	if store.UnreadCount() != 2 {
		t.Errorf("restart must keep unread, got %d", store.UnreadCount())
	}
	if store.PollAfterSeq() != 0 {
		t.Errorf("cursor must reset, got %d", store.PollAfterSeq())
	}
	after := store.Ingest(&Feed{BootID: "b2", Seq: 1, Items: []Event{ev(1, "c", "", "")}})
	if len(after.Completions) != 1 || after.Completions[0].SessionID != "c" {
		t.Errorf("after restart = %+v", after.Completions)
	}
	if store.UnreadCount() != 3 {
		t.Errorf("unread = %d, want 3", store.UnreadCount())
	}
}

func TestCapacityCap(t *testing.T) {
	capped := NewStore(3)
	capped.Ingest(&Feed{BootID: "b1", Seq: 5, Items: []Event{
		ev(1, "s1", "", ""), ev(2, "s2", "", ""), ev(3, "s3", "", ""),
		ev(4, "s4", "", ""), ev(5, "s5", "", ""),
	}})
	if capped.UnreadCount() != 3 {
		t.Errorf("capped unread = %d, want 3", capped.UnreadCount())
	}
	recent := capped.Recent(10)
	if len(recent) != 3 || recent[0].Seq != 5 || recent[1].Seq != 4 || recent[2].Seq != 3 {
		t.Errorf("capped recent = %+v", recent)
	}
}

func TestQueuedMessage(t *testing.T) {
	// the user sent another message while work was running: a completed
	// turn followed by resumed in the same batch must net to zero
	queued := NewStore(50)
	queued.Ingest(&Feed{BootID: "q", Seq: 2, Items: []Event{
		ev(1, "chat", "completed", ""), ev(2, "chat", "", KindResumed),
	}})
	if queued.UnreadCount() != 0 {
		t.Errorf("queued unread = %d, want 0", queued.UnreadCount())
	}
	queued.Ingest(&Feed{BootID: "q", Seq: 3, Items: []Event{ev(3, "chat", "completed", "")}})
	if queued.UnreadCount() != 1 {
		t.Errorf("queued unread = %d, want 1", queued.UnreadCount())
	}
	resumed := queued.Ingest(&Feed{BootID: "q", Seq: 4, Items: []Event{ev(4, "chat", "", KindResumed)}})
	if len(resumed.Resumed) != 1 {
		t.Errorf("resumed = %+v", resumed.Resumed)
	}
	if queued.UnreadCount() != 0 {
		t.Errorf("after resume unread = %d, want 0", queued.UnreadCount())
	}
}

func TestAbortedRetracts(t *testing.T) {
	stale := NewStore(50)
	stale.Ingest(&Feed{BootID: "s", Seq: 1, Items: []Event{ev(1, "old", "aborted", "")}})
	if stale.UnreadCount() != 0 {
		t.Errorf("aborted must not be unread, got %d", stale.UnreadCount())
	}
	stale.Ingest(&Feed{BootID: "s", Seq: 2, Items: []Event{ev(2, "old", "completed", "")}})
	if stale.UnreadCount() != 1 {
		t.Errorf("unread = %d, want 1", stale.UnreadCount())
	}
	stale.Ingest(&Feed{BootID: "s", Seq: 3, Items: []Event{ev(3, "old", "aborted", "")}})
	if stale.UnreadCount() != 0 {
		t.Errorf("aborted must retract, got %d", stale.UnreadCount())
	}
}

func TestMarkReadOneAtATime(t *testing.T) {
	clicks := NewStore(50)
	clicks.Ingest(&Feed{BootID: "c", Seq: 2, Items: []Event{
		ev(1, "chat-a", "completed", ""), ev(2, "chat-b", "completed", ""),
	}})
	if clicks.UnreadCount() != 2 || len(clicks.Recent(6)) != 2 {
		t.Fatalf("setup: unread=%d recent=%d", clicks.UnreadCount(), len(clicks.Recent(6)))
	}
	clicks.MarkRead("chat-a")
	if clicks.UnreadCount() != 1 {
		t.Errorf("unread = %d, want 1", clicks.UnreadCount())
	}
	if recent := clicks.Recent(6); len(recent) != 1 || recent[0].SessionID != "chat-b" {
		t.Errorf("recent = %+v", recent)
	}
	clicks.MarkRead("chat-b")
	if clicks.UnreadCount() != 0 || len(clicks.Recent(6)) != 0 {
		t.Error("after clearing all, both list and count must be empty")
	}
}

func TestViewedRetracts(t *testing.T) {
	viewed := NewStore(50)
	watched := viewed.Ingest(&Feed{BootID: "v", Seq: 2, Items: []Event{
		ev(1, "chat", "completed", ""), ev(2, "chat", "", KindViewed),
	}})
	if len(watched.Completions) != 1 {
		t.Errorf("completions = %+v", watched.Completions)
	}
	if len(watched.Viewed) != 1 || watched.Viewed[0] != "chat" {
		t.Errorf("viewed = %+v", watched.Viewed)
	}
	if watched.IsEmpty() {
		t.Error("the batch reported changes, so it is not empty")
	}
	if viewed.UnreadCount() != 0 {
		t.Errorf("watching it finish must not light the badge, got %d", viewed.UnreadCount())
	}
	if len(viewed.Recent(6)) != 0 {
		t.Error("no rows for a watched completion")
	}

	// viewing an already-read session is idempotent: no report, no log noise
	repeat := viewed.Ingest(&Feed{BootID: "v", Seq: 3, Items: []Event{ev(3, "chat", "", KindViewed)}})
	if len(repeat.Viewed) != 0 || !repeat.IsEmpty() {
		t.Errorf("repeat view = %+v", repeat)
	}

	// a background session finishing lights the badge; opening it retracts
	viewed.Ingest(&Feed{BootID: "v", Seq: 4, Items: []Event{ev(4, "other", "completed", "")}})
	if viewed.UnreadCount() != 1 {
		t.Errorf("unread = %d, want 1", viewed.UnreadCount())
	}
	retracted := viewed.Ingest(&Feed{BootID: "v", Seq: 5, Items: []Event{ev(5, "other", "", KindViewed)}})
	if len(retracted.Viewed) != 1 || retracted.Viewed[0] != "other" {
		t.Errorf("retracted = %+v", retracted)
	}
	if viewed.UnreadCount() != 0 || len(viewed.Recent(6)) != 0 {
		t.Error("after viewing, nothing is unread")
	}
}

// Cross-language contract: the JSON the plugin really sends (all three
// kinds in one batch, viewed with an empty reason, maybe an empty title)
// must decode into the right semantics. This is where "the interface
// silently disagrees" used to happen.
func TestPluginFeedContract(t *testing.T) {
	body := `{"bootId":"b1","seq":3,"items":[
		{"seq":1,"sessionId":"s1","title":"看着它收尾","reason":"completed","at":10,"kind":"completion"},
		{"seq":2,"sessionId":"s1","title":"看着它收尾","reason":"","at":11,"kind":"viewed"},
		{"seq":3,"sessionId":"s2","title":"","reason":"","at":12,"kind":"viewed"}]}`
	feed := ParseFeed(body)
	if feed == nil {
		t.Fatal("the plugin's JSON must parse")
	}
	contract := NewStore(50)
	ingest := contract.Ingest(feed)
	if len(ingest.Completions) != 1 || ingest.Completions[0].SessionID != "s1" {
		t.Errorf("completions = %+v", ingest.Completions)
	}
	// only real retractions are reported (s2 had nothing unread: idempotent)
	if len(ingest.Viewed) != 1 || ingest.Viewed[0] != "s1" {
		t.Errorf("viewed = %+v", ingest.Viewed)
	}
	if len(ingest.Resumed) != 0 {
		t.Errorf("resumed = %+v", ingest.Resumed)
	}
	if contract.UnreadCount() != 0 {
		t.Errorf("unread = %d, want 0 (watched and never-recorded)", contract.UnreadCount())
	}
	if feed.Items[0].IsView() || !feed.Items[1].IsView() || !feed.Items[2].IsView() {
		t.Error("isView flags must match the kinds")
	}
}

func TestPersistence(t *testing.T) {
	var saved []Event
	store := NewStore(50)
	store.Persist = func(events []Event) { saved = events }
	store.Ingest(&Feed{BootID: "b", Seq: 1, Items: []Event{ev(1, "s1", "completed", "")}})
	if len(saved) != 1 || saved[0].SessionID != "s1" {
		t.Fatalf("persist got %+v", saved)
	}
	// a restarted launcher restores the unread rows, not just the count
	restored := NewStore(50)
	restored.Restore(saved)
	if restored.UnreadCount() != 1 || len(restored.Recent(6)) != 1 {
		t.Errorf("restore: unread=%d recent=%d", restored.UnreadCount(), len(restored.Recent(6)))
	}
	var afterMarkRead []Event
	restored.Persist = func(events []Event) { afterMarkRead = events }
	restored.MarkRead("s1")
	if len(afterMarkRead) != 0 {
		t.Errorf("marking read must persist the empty set, got %+v", afterMarkRead)
	}
}

func TestPresentation(t *testing.T) {
	now := time.Date(2026, 11, 6, 19, 8, 0, 0, time.Local)
	// same day → HH:mm
	at := float64(now.UnixNano()/1e6) - 0 // 19:08 today
	if got := TimeLabel(at, now); got != "19:08" {
		t.Errorf("TimeLabel today = %q, want 19:08", got)
	}
	// another day → MM-dd HH:mm
	yesterday := now.AddDate(0, 0, -1)
	if got := TimeLabel(float64(yesterday.UnixNano()/1e6), now); got != yesterday.Format("01-02 15:04") {
		t.Errorf("TimeLabel other day = %q", got)
	}
	if got := MenuTitle(Event{At: at, Reason: "completed"}, "dsh-launcher", now); got != "19:08 ·「dsh-launcher」 已完成" {
		t.Errorf("MenuTitle = %q", got)
	}
	// long names are capped at 24 runes
	long := "一个非常非常非常非常非常长的会话名字"
	if got := MenuTitle(Event{At: at, Reason: "error"}, long, now); len([]rune(got)) > len([]rune("19:08 ·「"))+25+len([]rune("」 出错"))+3 {
		t.Errorf("MenuTitle must cap the name, got %q", got)
	}
	if BadgeText(0) != "" || BadgeText(1) != "1" || BadgeText(99) != "99" || BadgeText(100) != "99+" {
		t.Errorf("BadgeText: %q %q %q %q", BadgeText(0), BadgeText(1), BadgeText(99), BadgeText(100))
	}
	// label preference: title → workspace → short id.
	// The title must win: a workspace is the folder, so every session in
	// one project rendered as the same row and the user could not tell
	// which conversation had finished.
	if MenuLabel("my-workspace", "some title", "session-1335d7ff-x") != "some title" {
		t.Error("session title must win over the workspace name")
	}
	if MenuLabel("my-workspace", "", "session-1335d7ff-x") != "my-workspace" {
		t.Error("an untitled session falls back to its workspace")
	}
	if MenuLabel("my-workspace", "session-", "session-1335d7ff-x") != "my-workspace" {
		t.Errorf("a placeholder title must not shadow the workspace, got %q",
			MenuLabel("my-workspace", "session-", "session-1335d7ff-x"))
	}
	if MenuLabel("", "real title", "session-1335d7ff-x") != "real title" {
		t.Error("title without a workspace")
	}
	if MenuLabel("", "session-", "session-1335d7ff-x") != "1335d7ff" {
		t.Errorf("placeholder title must fall back to short id, got %q", MenuLabel("", "session-", "session-1335d7ff-x"))
	}
	if ShortIdentifier("session-1335d7ff-aaaa") != "1335d7ff" {
		t.Errorf("ShortIdentifier = %q", ShortIdentifier("session-1335d7ff-aaaa"))
	}
	for reason, want := range map[string]string{
		"completed": "已完成", "error": "出错", "aborted": "已中止",
		"max-tokens": "达到 token 上限", "blocked": "被阻塞", "weird": "已结束",
	} {
		if got := ReasonLabel(reason); got != want {
			t.Errorf("ReasonLabel(%q) = %q, want %q", reason, got, want)
		}
	}
}

// Capacity 200 is what makes the "99+" badge reachable: with the old
// 50-entry ring the count could never pass 50, so the cap was dead code.
func TestCapacityAllows99Plus(t *testing.T) {
	store := NewStore(200)
	var items []Event
	for i := 1; i <= 150; i++ {
		items = append(items, ev(i, "s"+itoa(i), "completed", ""))
	}
	store.Ingest(&Feed{BootID: "b", Seq: 150, Items: items})
	if got := store.UnreadCount(); got != 150 {
		t.Fatalf("unread = %d, want 150 (capacity must allow past 99)", got)
	}
	// the badge label for that count is the capped form
	if got := BadgeText(store.UnreadCount()); got != "99+" {
		t.Errorf("BadgeText(150) = %q, want 99+", got)
	}
}

// The cap still applies: 250 distinct sessions leave 200 rows.
func TestCapacityStillCaps(t *testing.T) {
	store := NewStore(200)
	var items []Event
	for i := 1; i <= 250; i++ {
		items = append(items, ev(i, "s"+itoa(i), "completed", ""))
	}
	store.Ingest(&Feed{BootID: "b", Seq: 250, Items: items})
	if got := store.UnreadCount(); got != 200 {
		t.Errorf("unread = %d, want 200 (the cap)", got)
	}
	// the newest rows survive, the oldest are pushed out
	recent := store.Recent(1)
	if len(recent) != 1 || recent[0].Seq != 250 {
		t.Errorf("newest row = %+v, want seq 250", recent)
	}
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

// Ingest must survive the shapes a real feed can take, without dropping
// the unread set or double-counting.
func TestIngestBoundaries(t *testing.T) {
	t.Run("nil feed is a no-op", func(t *testing.T) {
		s := NewStore(10)
		if got := s.Ingest(nil); !got.IsEmpty() {
			t.Error("a nil feed must not report events")
		}
		if s.UnreadCount() != 0 {
			t.Error("a nil feed must not add unread")
		}
	})

	t.Run("empty items is a no-op", func(t *testing.T) {
		s := NewStore(10)
		if got := s.Ingest(&Feed{BootID: "b", Items: nil}); !got.IsEmpty() {
			t.Error("an empty feed must not report events")
		}
	})

	t.Run("a new bootId resets the sequence", func(t *testing.T) {
		s := NewStore(10)
		s.Ingest(&Feed{BootID: "b1", Items: []Event{
			{Seq: 5, SessionID: "s1", Reason: "completed", Kind: KindCompletion},
		}})
		if s.PollAfterSeq() != 5 {
			t.Fatalf("PollAfterSeq = %d, want 5", s.PollAfterSeq())
		}
		// dsh restarted: seq restarts at 1 and must still be ingested
		s.Ingest(&Feed{BootID: "b2", Items: []Event{
			{Seq: 1, SessionID: "s2", Reason: "completed", Kind: KindCompletion},
		}})
		if s.PollAfterSeq() != 1 {
			t.Errorf("PollAfterSeq = %d, want 1 after the bootId reset", s.PollAfterSeq())
		}
		if s.UnreadCount() != 2 {
			t.Errorf("unread = %d, want 2 (both sessions)", s.UnreadCount())
		}
	})

	t.Run("a replayed seq is ignored", func(t *testing.T) {
		s := NewStore(10)
		ev := Event{Seq: 3, SessionID: "s1", Reason: "completed", Kind: KindCompletion}
		s.Ingest(&Feed{BootID: "b", Items: []Event{ev}})
		got := s.Ingest(&Feed{BootID: "b", Items: []Event{ev}})
		if !got.IsEmpty() {
			t.Error("a replayed event must not be reported again")
		}
		if s.UnreadCount() != 1 {
			t.Errorf("unread = %d, want 1 (no double count)", s.UnreadCount())
		}
	})

	t.Run("one row per session", func(t *testing.T) {
		s := NewStore(10)
		s.Ingest(&Feed{BootID: "b", Items: []Event{
			{Seq: 1, SessionID: "s1", Reason: "completed", Kind: KindCompletion, Title: "first"},
		}})
		s.Ingest(&Feed{BootID: "b", Items: []Event{
			{Seq: 2, SessionID: "s1", Reason: "completed", Kind: KindCompletion, Title: "second"},
		}})
		rows := s.Rows(10)
		if len(rows) != 1 {
			t.Fatalf("rows = %d, want 1 (one per session)", len(rows))
		}
		if rows[0].Title != "second" {
			t.Errorf("row title = %q, want the newer event", rows[0].Title)
		}
	})
}

// A session pushed out by capacity must stop counting toward the badge:
// the badge shows what is visible, and a row nobody can see cannot be
// clicked to clear.
func TestCapacityEvictionClearsUnread(t *testing.T) {
	s := NewStore(2)
	s.Ingest(&Feed{BootID: "b", Items: []Event{
		{Seq: 1, SessionID: "s1", Reason: "completed", Kind: KindCompletion},
		{Seq: 2, SessionID: "s2", Reason: "completed", Kind: KindCompletion},
		{Seq: 3, SessionID: "s3", Reason: "completed", Kind: KindCompletion},
	}})
	if got := s.UnreadCount(); got != 2 {
		t.Errorf("unread = %d, want 2 (capacity)", got)
	}
	for _, row := range s.Rows(10) {
		if row.SessionID == "s1" {
			t.Error("s1 should have been evicted")
		}
	}
}

// MarkRead and MarkAllRead must not invent unread state for unknown
// sessions.
func TestMarkReadUnknownSession(t *testing.T) {
	s := NewStore(10)
	s.MarkRead("never-seen")
	if s.UnreadCount() != 0 {
		t.Error("marking an unknown session read must not create state")
	}
	s.MarkAllRead()
	if s.UnreadCount() != 0 {
		t.Error("MarkAllRead on an empty store must stay empty")
	}
}
