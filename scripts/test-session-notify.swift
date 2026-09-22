import Foundation

@main
struct SessionNotifyChecks {
    static func main() {
        func event(_ seq: Int, session: String = "s1", reason: String = "completed", at: Double = 0) -> SessionNotifyEvent {
            SessionNotifyEvent(seq: seq, sessionId: session, title: "会话\(session)", reason: reason, at: at)
        }

        // 1. 常规轮询：只返回未见过的 seq，游标前进；未读数按**会话**去重。
        let store = SessionNotifyStore()
        let first = store.ingest(SessionNotifyFeed(bootId: "b1", seq: 2, items: [event(1, session: "a"), event(2, session: "b")]))
        precondition(first.map(\.seq) == [1, 2])
        precondition(store.unreadCount == 2)
        precondition(store.pollAfterSeq == 2)
        // 同一个会话再结束一轮：计数保持不变，只刷新时间与原因。
        let second = store.ingest(SessionNotifyFeed(bootId: "b1", seq: 3, items: [event(2, session: "b", reason: "error"), event(3, session: "a")]))
        precondition(second.map(\.seq) == [3])
        precondition(store.unreadCount == 2)
        precondition(store.recent(limit: 1).first?.reason == "completed")

        // 一个会话连跑 5 轮也只是一个未读会话（这正是角标曾经虚高的原因）。
        let chatty = SessionNotifyStore()
        _ = chatty.ingest(SessionNotifyFeed(bootId: "b1", seq: 5, items: (1...5).map { event($0, session: "same") }))
        precondition(chatty.unreadCount == 1)
        _ = chatty.ingest(SessionNotifyFeed(bootId: "b1", seq: 9, items: (6...9).map { event($0, session: "same") }))
        precondition(chatty.unreadCount == 1)
        precondition(chatty.recent(limit: 5).map(\.seq) == [9])

        // recent 最新在前。
        precondition(store.recent(limit: 2).map(\.sessionId) == ["a", "b"])

        // 2. Harness 重启（bootId 变化）：游标归零，不把旧事件重复计数。
        let restarted = store.ingest(SessionNotifyFeed(bootId: "b2", seq: 0, items: []))
        precondition(restarted.isEmpty)
        precondition(store.unreadCount == 2)
        precondition(store.pollAfterSeq == 0)
        let afterRestart = store.ingest(SessionNotifyFeed(bootId: "b2", seq: 1, items: [event(1, session: "c")]))
        precondition(afterRestart.map(\.seq) == [1])
        precondition(store.unreadCount == 3)

        // 3. 容量封顶后只保留最新 N 条。
        let capped = SessionNotifyStore(capacity: 3)
        _ = capped.ingest(SessionNotifyFeed(bootId: "b1", seq: 5, items: (1...5).map { event($0, session: "s\($0)") }))
        precondition(capped.unreadCount == 3)
        precondition(capped.recent(limit: 10).map(\.seq) == [5, 4, 3])

        // 4. 已读清空。
        capped.markAllRead()
        precondition(capped.unreadCount == 0)
        precondition(capped.recent(limit: 5).isEmpty)

        // 5. Feed 解析：合法 JSON 通过，损坏输入返回 nil。
        let json = #"{"bootId":"b9","seq":1,"items":[{"seq":1,"sessionId":"abc","title":"写周报","reason":"error","at":1694900000000}]}"#
        let feed = SessionNotifyFeed.parse(json)
        precondition(feed?.bootId == "b9")
        precondition(feed?.items.first?.reason == "error")
        precondition(SessionNotifyFeed.parse("{oops") == nil)
        precondition(SessionNotifyFeed.parse("") == nil)

        // 6. 展示辅助：原因文案、时间、菜单标题、角标数字。
        precondition(SessionNotifyStore.reasonLabel("completed") == "已完成")
        precondition(SessionNotifyStore.reasonLabel("max-tokens") == "达到 token 上限")
        precondition(SessionNotifyStore.reasonLabel("unknown") == "已结束")

        let timeZone = TimeZone(secondsFromGMT: 8 * 3600)!
        let now = Date(timeIntervalSince1970: 1694918400) // 2023-09-17 10:40 +0800
        precondition(SessionNotifyStore.timeLabel(1694822400000, timeZone: timeZone, now: now) == "09-16 08:00")
        precondition(SessionNotifyStore.timeLabel(1694908800000, timeZone: timeZone, now: now) == "08:00")

        let title = SessionNotifyStore.menuTitle(
            for: SessionNotifyEvent(seq: 1, sessionId: "s1", title: String(repeating: "长", count: 30), reason: "completed", at: 1694908800000),
            timeZone: timeZone,
            now: now
        )
        precondition(title == "08:00 · 「\(String(repeating: "长", count: 24))…」 已完成")

        precondition(SessionNotifyStore.badgeText(for: 0) == "")
        precondition(SessionNotifyStore.badgeText(for: 7) == "7")
        precondition(SessionNotifyStore.badgeText(for: 100) == "99+")

        print("session notify checks passed")
    }
}
