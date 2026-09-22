import Foundation

@main
struct SessionNotifyChecks {
    static func main() {
        func event(_ seq: Int, session: String = "s1", reason: String = "completed", at: Double = 0, kind: String = "completion") -> SessionNotifyEvent {
            SessionNotifyEvent(seq: seq, sessionId: session, title: "会话\(session)", reason: reason, at: at, kind: kind)
        }

        // 1. 常规轮询：只返回未见过的 seq，游标前进；未读数按**会话**去重。
        let store = SessionNotifyStore()
        let first = store.ingest(SessionNotifyFeed(bootId: "b1", seq: 2, items: [event(1, session: "a"), event(2, session: "b")]))
        precondition(first.completions.map(\.seq) == [1, 2])
        precondition(first.resumed.isEmpty)
        precondition(store.unreadCount == 2)
        precondition(store.pollAfterSeq == 2)
        // 同一个会话再结束一轮：计数保持不变，只刷新时间与原因。
        let second = store.ingest(SessionNotifyFeed(bootId: "b1", seq: 3, items: [event(2, session: "b", reason: "error"), event(3, session: "a")]))
        precondition(second.completions.map(\.seq) == [3])
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
        precondition(restarted.completions.isEmpty)
        precondition(store.unreadCount == 2)
        precondition(store.pollAfterSeq == 0)
        let afterRestart = store.ingest(SessionNotifyFeed(bootId: "b2", seq: 1, items: [event(1, session: "c")]))
        precondition(afterRestart.completions.map(\.seq) == [1])
        precondition(store.unreadCount == 3)

        // 3. 容量封顶后只保留最新 N 条。
        let capped = SessionNotifyStore(capacity: 3)
        _ = capped.ingest(SessionNotifyFeed(bootId: "b1", seq: 5, items: (1...5).map { event($0, session: "s\($0)") }))
        precondition(capped.unreadCount == 3)
        precondition(capped.recent(limit: 10).map(\.seq) == [5, 4, 3])

        // 3.5 排队消息：用户在我干活时又发了一条 —— 回合可能先 completed 再被打断，
        // 但会话马上开跑新一轮，角标不能还亮着「已完成」。
        let queued = SessionNotifyStore()
        _ = queued.ingest(SessionNotifyFeed(bootId: "q", seq: 2, items: [
            event(1, session: "chat", reason: "completed"),
            event(2, session: "chat", reason: "", kind: "resumed")
        ]))
        precondition(queued.unreadCount == 0)            // 同一批里先记后撤 → 净零
        _ = queued.ingest(SessionNotifyFeed(bootId: "q", seq: 3, items: [event(3, session: "chat", reason: "completed")]))
        precondition(queued.unreadCount == 1)            // 真的收尾了才算未读
        let resumed = queued.ingest(SessionNotifyFeed(bootId: "q", seq: 4, items: [event(4, session: "chat", reason: "", kind: "resumed")]))
        precondition(resumed.resumed.count == 1)
        precondition(queued.unreadCount == 0)            // 用户又发消息 → 撤销

        // 3.6 旧插件/旧缓冲里的 aborted 事件同样撤销，而不是记成完成。
        let stale = SessionNotifyStore()
        _ = stale.ingest(SessionNotifyFeed(bootId: "s", seq: 1, items: [event(1, session: "old", reason: "aborted")]))
        precondition(stale.unreadCount == 0)
        _ = stale.ingest(SessionNotifyFeed(bootId: "s", seq: 2, items: [event(2, session: "old", reason: "completed")]))
        precondition(stale.unreadCount == 1)
        _ = stale.ingest(SessionNotifyFeed(bootId: "s", seq: 3, items: [event(3, session: "old", reason: "aborted")]))
        precondition(stale.unreadCount == 0)

        // 3.7 点一条只清那一条：菜单里其它条目还在，还能再点（对齐 codex 的列表行为）。
        let clicks = SessionNotifyStore()
        _ = clicks.ingest(SessionNotifyFeed(bootId: "c", seq: 2, items: [
            event(1, session: "chat-a", reason: "completed"),
            event(2, session: "chat-b", reason: "completed")
        ]))
        precondition(clicks.unreadCount == 2)
        precondition(clicks.recent(limit: 6).count == 2)
        clicks.markRead("chat-a")
        precondition(clicks.unreadCount == 1)
        // 点过的那条从菜单消失，没点的那条还在（还能点它跳到那个工作区）。
        precondition(clicks.recent(limit: 6).map(\.sessionId) == ["chat-b"])
        clicks.markRead("chat-b")
        precondition(clicks.unreadCount == 0)
        precondition(clicks.recent(limit: 6).isEmpty)                           // 都看过了，段落整体消失

        // 3.8 工作区名称解析：会话归属优先，文件缺失/未收录都要安全回退。
        let workspaceState: [String: Any] = [
            "tables": ["workspaces": [
                "w1": ["id": "w1", "title": "dsh-launcher", "path": "/Users/me/dsh-launcher",
                       "sessionIds": ["session-aaaa-1111", "session-bbbb-2222"]],
                "w2": ["id": "w2", "title": "浙江移动-家宽", "path": "/Users/me/telecom",
                       "sessionIds": ["session-cccc-3333"]]
            ]]
        ]
        let index = SessionNotifyWorkspaceIndex(state: workspaceState)
        precondition(index.title(for: "session-aaaa-1111") == "dsh-launcher")
        precondition(index.title(for: "session-cccc-3333") == "浙江移动-家宽")
        precondition(index.title(for: "session-unknown") == nil)
        precondition(SessionNotifyWorkspaceIndex(state: nil).title(for: "session-aaaa-1111") == nil)
        precondition(SessionNotifyWorkspaceIndex(state: [:]).title(for: "session-aaaa-1111") == nil)
        // 同一个会话出现在两行时取先命中的，不崩。
        let duplicate = SessionNotifyWorkspaceIndex(state: ["tables": ["workspaces": [
            "w1": ["title": "A", "sessionIds": ["s1"]],
            "w2": ["title": "B", "sessionIds": ["s1"]]
        ]]])
        precondition(duplicate.title(for: "s1") == "A" || duplicate.title(for: "s1") == "B")

        // 3.9 菜单行标签：工作区名 → 会话标题 → 短 id，永远不出现光秃秃的 `session-`。
        precondition(SessionNotifyStore.menuLabel(workspace: "dsh-launcher", title: "随便", sessionId: "session-1335d7ff") == "dsh-launcher")
        precondition(SessionNotifyStore.menuLabel(workspace: nil, title: "修复侧边栏", sessionId: "session-1335d7ff") == "修复侧边栏")
        precondition(SessionNotifyStore.menuLabel(workspace: nil, title: "session-", sessionId: "session-1335d7ff") == "1335d7ff")
        precondition(SessionNotifyStore.menuLabel(workspace: nil, title: "", sessionId: "session-1335d7ff") == "1335d7ff")
        precondition(SessionNotifyStore.menuLabel(workspace: "  ", title: "session-1335d7ff", sessionId: "session-1335d7ff") == "1335d7ff")

        // 3.10 从磁盘读取：真实布局是 {tables:{workspaces:{<id>:{title,sessionIds:[…]}}}}。
        let tempHome = NSTemporaryDirectory() + "dsh-notify-ws-\(ProcessInfo.processInfo.processIdentifier)"
        let storages = tempHome + "/storages"
        try? FileManager.default.createDirectory(atPath: storages, withIntermediateDirectories: true)
        let fixture = #"{"tables":{"workspaces":{"w1":{"title":"dsh-launcher","sessionIds":["session-1335d7ff-a397-40a5-83e7-499452987a58"]}}}}"#
        try? fixture.data(using: .utf8)?.write(to: URL(fileURLWithPath: storages + "/workspace.json"))
        let loaded = SessionNotifyWorkspaceIndex.load(dshHome: tempHome)
        precondition(loaded.title(for: "session-1335d7ff-a397-40a5-83e7-499452987a58") == "dsh-launcher")
        precondition(loaded.title(for: "session-其他") == nil)
        // 文件不存在时退化为空索引，不影响菜单其它行。
        precondition(SessionNotifyWorkspaceIndex.load(dshHome: tempHome + "-missing").isEmpty)
        try? FileManager.default.removeItem(atPath: tempHome)

        // 3.11 菜单行文案：工作区名进到「」里，超长截断，未读/已读共用同一份文案。
        let labelEvent = event(1, session: "session-1335d7ff-a397-40a5-83e7-499452987a58", reason: "completed")
        let label = SessionNotifyStore.menuLabel(workspace: "dsh-launcher", title: "session-", sessionId: labelEvent.sessionId)
        let menuTitle = SessionNotifyStore.menuTitle(for: labelEvent, label: label)
        precondition(menuTitle.contains("「dsh-launcher」"))
        precondition(menuTitle.hasSuffix("已完成"))
        let longLabel = SessionNotifyStore.menuLabel(workspace: String(repeating: "很长的名字", count: 8), title: nil, sessionId: "session-x")
        precondition(SessionNotifyStore.menuTitle(for: labelEvent, label: longLabel).contains("…"))

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
