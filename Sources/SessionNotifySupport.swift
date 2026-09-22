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
/// 计数单位是会话，见 `unreadCount`。
final class SessionNotifyStore {
    private(set) var events: [SessionNotifyEvent] = []
    private var bootId: String?
    private var lastSeq = 0
    private let capacity: Int

    init(capacity: Int = 50) {
        self.capacity = max(capacity, 1)
    }

    /// 未读会话数：角标与菜单标题都用它。单位是**会话**而不是 turn——一个长
    /// 会话每回一轮都会写一条 `turn/end`，按事件计数就会出现「1 个会话、9 条
    /// 未读」这种明显不对的角标。
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
        for event in fresh {
            // 同一会话的后续完成覆盖前一条：只保留最近一次的时间与原因，
            // 未读数因此始终等于「有完成提醒的会话个数」。
            events.removeAll { $0.sessionId == event.sessionId }
            events.append(event)
        }
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
