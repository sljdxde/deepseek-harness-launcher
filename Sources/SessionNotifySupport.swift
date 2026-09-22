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
    /// 最近若干条完成事件（按会话去重，新的在后），菜单列表就显示它。
    private(set) var events: [SessionNotifyEvent] = []
    /// 还没被点过/清过的会话。角标与菜单标题按它计数——点开某一条只清那一条，
    /// 其余条目留在列表里还能再点（对齐 codex：列表是「最近完成」，未读是另一维）。
    private var unread: Set<String> = []
    private var bootId: String?
    private var lastSeq = 0
    private let capacity: Int

    init(capacity: Int = 50) {
        self.capacity = max(capacity, 1)
    }

    /// 未读会话数：角标与菜单标题都用它。单位是**会话**而不是 turn——一个长
    /// 会话每回一轮都会写一条 `turn/end`，按事件计数就会出现「1 个会话、9 条
    /// 未读」这种明显不对的角标。
    var unreadCount: Int { unread.count }

    /// 某条会话的完成提醒已读（点开它时只清这一条，不动其它条目）。
    func markRead(_ sessionId: String) {
        unread.remove(sessionId)
    }

    /// Sequence cursor for the next poll (`?after=`).
    var pollAfterSeq: Int { lastSeq }

    /// 菜单列表用的最近事件（新的在前），并标注每条是否还未读，便于加粗显示。
    func recent(limit: Int) -> [(event: SessionNotifyEvent, isUnread: Bool)] {
        Array(events.suffix(max(0, limit)).reversed()).map { ($0, unread.contains($0.sessionId)) }
    }

    /// 菜单行标签：工作区名 → 会话标题 → 短 id。插件在拿不到标题时会给出
    /// `session-`/`session-1335…` 这类没信息量的值，这里统一挡掉——否则一列
    /// `session-` 根本分不清是哪个工作区。
    static func menuLabel(workspace: String?, title: String?, sessionId: String) -> String {
        let workspaceName = workspace?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !workspaceName.isEmpty { return workspaceName }
        let sessionTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !sessionTitle.isEmpty && !isPlaceholderTitle(sessionTitle, sessionId: sessionId) { return sessionTitle }
        return shortIdentifier(sessionId)
    }

    /// `session-1335d7ff-…` → `1335d7ff`。
    static func shortIdentifier(_ sessionId: String) -> String {
        var value = sessionId
        for prefix in ["session-", "sess-", "chat-", "id-"] where value.lowercased().hasPrefix(prefix) {
            value = String(value.dropFirst(prefix.count))
            break
        }
        return String(value.prefix(8))
    }

    private static func isPlaceholderTitle(_ title: String, sessionId: String) -> Bool {
        let lowered = title.lowercased()
        if title == sessionId { return true }
        for prefix in ["session-", "sess-", "chat-"] where lowered.hasPrefix(prefix) {
            let rest = String(lowered.dropFirst(prefix.count))
            return rest.isEmpty || rest.count <= 8 || sessionId.lowercased().contains(rest)
        }
        return false
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
                unread.remove(event.sessionId)
                resumed.append(event)
            } else if event.reason == "aborted" {
                unread.remove(event.sessionId)
                // 防御旧插件/旧缓冲：被打断的回合不是完成（用户插话、排队消息、
                // 按停止都会以 aborted 收尾），会话通常在继续跑，不该亮角标。
                resumed.append(event)
            } else {
                events.append(event)
                unread.insert(event.sessionId)
                completions.append(event)
            }
        }
        if events.count > capacity { events.removeFirst(events.count - capacity) }
        // 未读只统计"列表里还看得见"的会话：列表被容量挤掉的行不该继续挂在角标上。
        unread.formIntersection(events.map(\.sessionId))
        return SessionNotifyIngest(completions: completions, resumed: resumed)
    }

    func markAllRead() {
        events.removeAll()
        unread.removeAll()
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
        menuTitle(for: event, label: event.title, timeZone: timeZone, now: now)
    }

    /// 菜单行文案：`19:08 ·「dsh-launcher」已完成`。`label` 由调用方决定
    /// （优先工作区名，见 `menuLabel`），超长截断，避免菜单被撑宽。
    static func menuTitle(for event: SessionNotifyEvent, label: String, timeZone: TimeZone = .current, now: Date = Date()) -> String {
        let title = label.count > 24 ? String(label.prefix(24)) + "…" : label
        return "\(timeLabel(event.at, timeZone: timeZone, now: now)) · 「\(title)」 \(reasonLabel(event.reason))"
    }

    /// Foxmail-style badge text: blank for none, plain digits up to 99, then "99+".
    static func badgeText(for count: Int) -> String {
        guard count > 0 else { return "" }
        return count > 99 ? "99+" : String(count)
    }
}


/// 会话 → 工作区名称的索引。dsh 的 session 事件里没有工作区字段，但
/// `~/.dsh/storages/workspace.json` 的每个工作区都记着自己的 sessionIds
/// （归档插件读的是同一个文件）。读不到就返回 nil，菜单行回退到标题/短 id。
struct SessionNotifyWorkspaceIndex {
    private let titles: [String: String]

    init(state: [String: Any]?) {
        var map: [String: String] = [:]
        let tables = state?["tables"] as? [String: Any]
        let workspaces = tables?["workspaces"] as? [String: Any]
        // 键排序保证「同一会话出现在多个工作区」时结果稳定（不依赖字典顺序）。
        for key in (workspaces?.keys.sorted() ?? []) {
            guard let row = workspaces?[key] as? [String: Any] else { continue }
            let title = (row["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !title.isEmpty else { continue }
            for value in (row["sessionIds"] as? [Any]) ?? [] {
                let sessionId = String(describing: value)
                if map[sessionId] == nil { map[sessionId] = title }
            }
        }
        titles = map
    }

    func title(for sessionId: String) -> String? { titles[sessionId] }

    var isEmpty: Bool { titles.isEmpty }

    /// 从 DSH_HOME 读取；文件缺失或 JSON 坏掉都当作空索引（不影响其它功能）。
    static func load(dshHome: String? = nil) -> SessionNotifyWorkspaceIndex {
        let home = dshHome
            ?? ProcessInfo.processInfo.environment["DSH_HOME"]
            ?? (NSHomeDirectory() + "/.dsh")
        let path = home + "/storages/workspace.json"
        guard let data = FileManager.default.contents(atPath: path),
              let state = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return SessionNotifyWorkspaceIndex(state: nil)
        }
        return SessionNotifyWorkspaceIndex(state: state)
    }
}
