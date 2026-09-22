import Foundation

/// One record produced by the bundled dsh-session-notify plugin: either a root
/// session's `turn/end` (`kind == "completion"`) or a `user/message` telling the
/// launcher that the session is being worked on again (`kind == "resumed"`).
struct SessionNotifyEvent: Codable, Equatable {
    let seq: Int
    let sessionId: String
    let title: String
    /// Turn end reason kind; empty for `resumed` records.
    let reason: String
    /// Epoch milliseconds (JS `Date.now()` on the plugin side).
    let at: Double
    let kind: String

    init(seq: Int, sessionId: String, title: String, reason: String, at: Double, kind: String = "completion") {
        self.seq = seq
        self.sessionId = sessionId
        self.title = title
        self.reason = reason
        self.at = at
        self.kind = kind
    }

    /// 老插件（或手工构造的 fixture）没有 `kind` 字段时按完成提醒处理。
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seq = try container.decode(Int.self, forKey: .seq)
        sessionId = try container.decode(String.self, forKey: .sessionId)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        reason = try container.decodeIfPresent(String.self, forKey: .reason) ?? "completed"
        at = try container.decodeIfPresent(Double.self, forKey: .at) ?? 0
        kind = try container.decodeIfPresent(String.self, forKey: .kind) ?? "completion"
    }

    var isResume: Bool { kind == "resumed" }
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

/// 一次轮询的结果：`completions` 是新的完成事件；`resumed` 是「用户又在这些会话里
/// 发了消息」，它们已经把对应的未读提醒撤销掉（角标不该在会话重新开跑后还亮着）。
struct SessionNotifyIngest {
    let completions: [SessionNotifyEvent]
    let resumed: [SessionNotifyEvent]

    var isEmpty: Bool { completions.isEmpty && resumed.isEmpty }

    static let none = SessionNotifyIngest(completions: [], resumed: [])
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

    /// Merge a polled feed. A new `bootId` means the harness (and its sequence
    /// counter) restarted, so the cursor resets without re-counting anything as
    /// unread. `resumed` records retract the session's unread completion: the
    /// user posted another message there, so the session is being worked on
    /// again and a "会话完成" badge for it would be wrong.
    @discardableResult
    func ingest(_ feed: SessionNotifyFeed) -> SessionNotifyIngest {
        if feed.bootId != bootId {
            bootId = feed.bootId
            lastSeq = 0
        }
        guard !feed.items.isEmpty else { return .none }
        let fresh = feed.items.filter { $0.seq > lastSeq }
        lastSeq = max(lastSeq, fresh.map(\.seq).max() ?? 0)
        guard !fresh.isEmpty else { return .none }

        var completions: [SessionNotifyEvent] = []
        var resumed: [SessionNotifyEvent] = []
        for event in fresh {
            // 同一会话只保留最近一条；随后按事件先后决定「记一条未读」还是「撤掉」。
            events.removeAll { $0.sessionId == event.sessionId }
            if event.isResume {
                resumed.append(event)
            } else if event.reason == "aborted" {
                // 防御旧插件/旧缓冲：被打断的回合不是完成（用户插话、排队消息、
                // 按停止都会以 aborted 收尾），会话通常在继续跑，不该亮角标。
                resumed.append(event)
            } else {
                events.append(event)
                completions.append(event)
            }
        }
        if events.count > capacity { events.removeFirst(events.count - capacity) }
        return SessionNotifyIngest(completions: completions, resumed: resumed)
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
