import Foundation

/// One session-completion record produced by the bundled dsh-session-notify
/// plugin: a root session's `turn/end` with its reason kind and timestamp.
struct SessionNotifyEvent: Codable, Equatable {
    let seq: Int
    let sessionId: String
    let title: String
    let reason: String
    /// Epoch milliseconds (JS `Date.now()` on the plugin side).
    let at: Double
}

/// Snapshot returned by `GET /dsh-session-notify/events?after=<seq>`.
struct SessionNotifyFeed: Codable {
    let bootId: String
    let seq: Int
    let items: [SessionNotifyEvent]

    static func parse(_ body: String) -> SessionNotifyFeed? {
        body.data(using: .utf8).flatMap { try? JSONDecoder().decode(SessionNotifyFeed.self, from: $0) }
    }
}

/// Tracks completion events polled from the harness and the unread badge
/// count shown on the menu bar icon (Foxmail-style: the count stays until
/// the user acknowledges it by opening a session or clearing the list).
final class SessionNotifyStore {
    private(set) var events: [SessionNotifyEvent] = []
    private var bootId: String?
    private var lastSeq = 0
    private let capacity: Int

    init(capacity: Int = 50) {
        self.capacity = max(capacity, 1)
    }

    var unreadCount: Int { events.count }

    /// Sequence cursor for the next poll (`?after=`).
    var pollAfterSeq: Int { lastSeq }

    /// Most recent events, newest first, for the menu section.
    func recent(limit: Int) -> [SessionNotifyEvent] {
        Array(events.suffix(limit).reversed())
    }

    /// Merge a polled feed; returns only the events not seen before. A new
    /// `bootId` means the harness (and its sequence counter) restarted, so the
    /// cursor resets without re-counting anything as unread.
    @discardableResult
    func ingest(_ feed: SessionNotifyFeed) -> [SessionNotifyEvent] {
        if feed.bootId != bootId {
            bootId = feed.bootId
            lastSeq = 0
        }
        guard !feed.items.isEmpty else { return [] }
        let fresh = feed.items.filter { $0.seq > lastSeq }
        lastSeq = max(lastSeq, fresh.map(\.seq).max() ?? 0)
        guard !fresh.isEmpty else { return [] }
        events.append(contentsOf: fresh)
        if events.count > capacity { events.removeFirst(events.count - capacity) }
        return fresh
    }

    func markAllRead() {
        events.removeAll()
    }

    // MARK: - Presentation

    static func reasonLabel(_ kind: String) -> String {
        switch kind {
        case "completed": return "已完成"
        case "error": return "出错"
        case "aborted": return "已中止"
        case "max-tokens": return "达到 token 上限"
        case "blocked": return "被阻塞"
        default: return "已结束"
        }
    }

    static func timeLabel(_ epochMs: Double, timeZone: TimeZone = .current, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: epochMs / 1000)
        let formatter = DateFormatter()
        formatter.timeZone = timeZone
        if Calendar.current.isDate(date, inSameDayAs: now) {
            formatter.dateFormat = "HH:mm"
        } else {
            formatter.dateFormat = "MM-dd HH:mm"
        }
        return formatter.string(from: date)
    }

    static func menuTitle(for event: SessionNotifyEvent, timeZone: TimeZone = .current, now: Date = Date()) -> String {
        let title = event.title.count > 24 ? String(event.title.prefix(24)) + "…" : event.title
        return "\(timeLabel(event.at, timeZone: timeZone, now: now)) · 「\(title)」 \(reasonLabel(event.reason))"
    }

    /// Foxmail-style badge text: blank for none, plain digits up to 99, then "99+".
    static func badgeText(for count: Int) -> String {
        guard count > 0 else { return "" }
        return count > 99 ? "99+" : String(count)
    }
}
