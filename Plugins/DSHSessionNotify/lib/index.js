/**
 * dsh-session-notify — server-side DSH host plugin (bundled with the launcher).
 *
 * Keeps a small in-memory ring buffer of root-session `turn/end` events and
 * exposes it to the launcher menu bar app:
 *
 *   GET /dsh-session-notify/events?after=<seq>
 *     → { bootId, seq, items: [{ seq, sessionId, title, reason, at, kind }] }
 *       kind: completion（回合收尾）| resumed（用户又发了消息）| viewed（用户正在看）
 *   GET /dsh-session-notify/commands?clientId=<id>&viewing=<sessionId>&visible=<0|1>
 *     → the queued open-session commands; the page also reports which session the
 *       user is looking at, which retracts that session's completion reminder
 *       (`viewed`) the moment the view changes, plus whether its tab is visible
 *       (the launcher needs that to decide between activating the browser and
 *       opening a new tab when AppleScript cannot address the right instance)
 *   POST /dsh-session-notify/open { sessionId }
 *     → queues a short-lived browser navigation command
 *   GET /dsh-session-notify/presence
 *     → { active, clients, visible }: is an injected Harness page polling right
 *       now, and is any of its tabs visible?
 *   POST /dsh-session-notify/presence/bye { clientId }
 *     → the page went away (pagehide); drops the client from presence
 *
 * The launcher polls this route while the harness is running and turns new
 * events into a Foxmail-style unread badge on its menu bar icon plus a
 * "会话完成" menu section. Detection follows the same server-side event
 * stream the community dsh-notify plugin uses (`session/event` +
 * `turn/end`, subagent sessions filtered out), but the payload stays inside
 * the loopback harness server instead of spawning OS popups.
 *
 * `bootId` is regenerated whenever the harness (re)loads the plugin so the
 * launcher can reset its sequence cursor after a dsh restart instead of
 * re-counting or missing events.
 *
 * On startup the plugin also scans recently persisted root sessions whose last
 * turn was closed by a process exit (`interrupted`, or `aborted` with a
 * `disposed` cause) and requests one continuation through the live Agent. This
 * is the background equivalent of opening the session and pressing "continue",
 * so a forced dsh restart does not leave old work waiting for a manual click.
 *
 * @module dsh-session-notify
 */

import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

/** Plugin display name. */
export const name = 'dsh-session-notify';

/** Events kept for polling; the launcher caps its own unread list as well. */
const BUFFER_LIMIT = 50;

/**
 * Background Chromium tabs can be timer-throttled. Keep a command long
 * enough for an already-open Harness page to wake up and consume it.
 */
const COMMAND_LIMIT = 20;
const COMMAND_TTL_MS = 5 * 60 * 1000;
const COMMAND_CLAIM_TTL_MS = 15 * 1000;
// The launcher selects the Harness tab before queueing an open command. Give
// that visible client a brief head start so a background duplicate tab cannot
// claim the command first and navigate out of sight.
const VISIBLE_CLIENT_GRACE_MS = 2 * 1000;
/**
 * 点「会话完成」提醒后，启动器会先把**真正连着 Harness** 的浏览器前置（或
 * 选中它的标签），那个浏览器里当前标签随即拥有焦点。多实例环境里另一个
 * 自动化浏览器的 Harness 页面也在轮询，它可能先把命令领走：会话切在看不见
 * 的窗口里，用户看到的是「浏览器已经前置，却还是旧会话」（2026-11-09 实测：
 * 命令被 chrome-devtools-mcp 那个 Chrome 的页面领走）。所以命令入队后的
 * 一小段窗口里只允许**有焦点**的页面领取；窗口过后回落到原来的「可见优先、
 * 再后台」规则，宁晚一点也不能抢错窗口。
 */
export const FOCUSED_CLIENT_GRACE_MS = 2500;
/**
 * A Harness page counts as open while its injected client polls, and stops
 * counting the moment it reports a pagehide (tab/window closed). Chrome
 * keep-alive keeps sockets ESTABLISHED long after every tab closed, so the
 * launcher must not rely on socket checks alone to decide whether a new page
 * has to be opened. The TTL only covers abnormal exits where no pagehide
 * fired; hidden tabs poll at least once a minute, so 90s is safely above it.
 */
export const PRESENCE_TTL_MS = 90 * 1000;

/**
 * Wait for the host services (persistence, session query, agent controller) to
 * finish mounting before touching session files. The scan is best-effort and
 * never blocks startup or the HTTP routes.
 */
const AUTO_RESUME_DELAY_MS = 8 * 1000;
/** Only sessions touched within this window are considered; old logs are left alone. */
const AUTO_RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap the expensive zstd/replay reads, newest activity first. */
const AUTO_RESUME_SCAN_LIMIT = 30;
/** Cap concurrent model turns started by one restart. */
const AUTO_RESUME_LIMIT = 10;

export function createPresenceTracker(ttlMs = PRESENCE_TTL_MS) {
  const lastSeen = new Map();
  /** clientId → 用户此刻正在看的会话（没有则不存在这条记录）。 */
  const viewing = new Map();
  /** 当前标签页可见（`document.visibilityState` 不是 hidden）的页面。 */
  const visible = new Set();
  function prune(now) {
    for (const [clientId, seen] of [...lastSeen]) {
      if (now - seen > ttlMs) {
        lastSeen.delete(clientId);
        // 页面没了就不再算「正在看」：不然一个关掉/超时的标签页会把它当年看过的
        // 会话永久钉成已读。可见性同理，过期心跳不能继续冒充「标签页在看」。
        viewing.delete(clientId);
        visible.delete(clientId);
      }
    }
  }
  return {
    touch(clientId, now = Date.now(), pageVisible = false) {
      if (!clientId) return;
      lastSeen.set(clientId, now);
      // 每次轮询都刷新可见性：页面切走时会立刻补一次心跳（visibilitychange），
      // 所以这里的值足够新，启动器据此决定「前置浏览器就够」还是「必须新开标签」。
      if (pageVisible) visible.add(clientId);
      else visible.delete(clientId);
    },
    bye(clientId) {
      if (!clientId) return;
      lastSeen.delete(clientId);
      viewing.delete(clientId);
      visible.delete(clientId);
    },
    /**
     * 记录这个页面当前正在看的会话；空值表示「没有在看任何会话」（页面转后台、
     * 或主视图为空）。
     */
    watch(clientId, sessionId) {
      if (!clientId) return;
      if (sessionId) viewing.set(clientId, sessionId);
      else viewing.delete(clientId);
    },
    /** 某页面最后上报的观看目标，'' 表示没在看。 */
    watches(clientId) {
      return viewing.get(clientId) ?? '';
    },
    /** 用户此刻正在看的会话集合（只算还活着的页面）。 */
    viewingNow(now = Date.now()) {
      prune(now);
      return new Set(viewing.values());
    },
    /** 是否有任意存活页面的标签页可见（决定不可达时要不要新开标签）。 */
    anyVisible(now = Date.now()) {
      prune(now);
      return visible.size > 0;
    },
    active(now = Date.now()) {
      prune(now);
      return lastSeen.size > 0;
    },
    clients(now = Date.now()) {
      this.active(now);
      return lastSeen.size;
    },
  };
}

/**
 * The session's event log. Host sessions expose `snapshotEvents()`; the plain
 * `events` array is only a fallback for other compositions.
 */
function sessionEvents(session) {
  if (typeof session?.snapshotEvents === 'function') {
    try {
      const events = session.snapshotEvents();
      if (Array.isArray(events)) return events;
    } catch {
      // A session without a readable log still needs the id fallback below.
    }
  }
  return Array.isArray(session?.events) ? session.events : [];
}

/** Fold the last `session/title` from a session's event log for display. */
function sessionTitle(session) {
  const events = sessionEvents(session);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title) {
      return event.data.title;
    }
  }
  return sessionLabelFromId(session?.header?.id ?? session?.id);
}

/**
 * Fallback label when a session has no title yet (the runtime generates one
 * asynchronously, so an early turn can beat it): dsh ids look like
 * `session-<uuid>`, and slicing those raw would label every row "session-".
 */
export function sessionLabelFromId(id) {
  if (typeof id !== 'string' || id.length === 0) return '(未命名会话)';
  const stripped = id.replace(/^(session|sess|chat)[-_]/i, '');
  return (stripped.length > 0 ? stripped : id).slice(0, 8);
}

/**
 * Pure classifier for one `session/event` pair: returns the record to buffer
 * (root session turn end) or null when the event is not a completion.
 * @returns {{sessionId:string,title:string,reason:string,at:number}|null}
 */
export function summarizeTurnEnd(session, event, now = Date.now()) {
  if (!event || event.type !== 'turn/end') return null;
  // Subagent turns finish constantly; only root sessions matter to the badge.
  if (session?.header?.origin === 'subagent') return null;
  const sessionId = String(session?.header?.id ?? session?.id ?? '');
  if (!sessionId) return null;
  const reason = typeof event.data?.reason?.kind === 'string' && event.data.reason.kind ? event.data.reason.kind : 'completed';
  // 被打断不是「完成」：用户插话 / 排队消息 / 按停止都会让回合以 `aborted`
  // （`reason.kind === 'user'`）收尾，而会话往往紧接着带着排队消息继续跑。
  // 这种事件要是当成完成提醒，角标就会显示一个其实还在干活的会话（而且写着「已中止」）。
  // 宿主关闭（disposed）同理，都不值得打扰用户。
  if (reason === 'aborted') return null;
  return { sessionId, title: sessionTitle(session), reason, at: now, kind: 'completion' };
}

/**
 * Pure classifier for one `session/event` pair: a new turn started, so the
 * session is being worked on again and any completion reminder still held for
 * it is stale. This is what makes "排队消息" behave: the turn before the queued
 * message may end `completed` (or `aborted`), but the session immediately runs
 * again, and a badge claiming it finished would be wrong.
 * @returns {{sessionId:string,title:string,at:number,kind:'resumed'}|null}
 */
export function summarizeTurnStart(session, event, now = Date.now()) {
  if (!event || event.type !== 'turn/start') return null;
  if (session?.header?.origin === 'subagent') return null;
  const sessionId = String(session?.header?.id ?? session?.id ?? '');
  if (!sessionId) return null;
  return { sessionId, title: sessionTitle(session), at: now, kind: 'resumed' };
}

/**
 * Whether the last turn boundary says dsh's process exited while work was
 * still running.
 *
 * `readSession` balances an open tail with synthetic `interrupted` closers, so
 * a crash normally shows up as a trailing `turn/end` with that reason. The
 * `aborted` + `disposed` pair is what a graceful launcher-initiated shutdown
 * writes when dsh is stopped during a turn. A user stop (`aborted` + `user`)
 * is deliberately not resumable: the user asked it to stop.
 */
export function isInterruptedSession(header, events) {
  if (!header || header.origin === 'subagent') return false;
  if (!Array.isArray(events) || events.length === 0) return false;
  let lastTurnBoundary;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'turn/end' || event?.type === 'turn/start') {
      lastTurnBoundary = event;
      break;
    }
  }
  if (lastTurnBoundary === undefined) return false;
  // A raw log can end in an open turn; session-query normally closes it first.
  if (lastTurnBoundary.type === 'turn/start') return true;
  const reason = lastTurnBoundary.data?.reason;
  if (reason?.kind === 'interrupted') return true;
  return reason?.kind === 'aborted' && reason.reason?.kind === 'disposed';
}

/**
 * Best-effort scan for root sessions whose last turn was cut off by a dsh
 * exit, then request one empty retry message from each live Agent.
 *
 * The empty `retry` message is exactly what the composer's "continue" action
 * records: it wakes the next turn, renders as "requested to continue", and the
 * provider serializers skip its empty content. Resolving through the normal
 * session controller also persists dsh's synthetic interrupted closers, so
 * unfinished tool calls still carry their "outcome unknown" warning.
 *
 * @param {object} services - sessionQuery/sessionController/sessionPersistence/
 *   workspaceRegistry/logger as resolved from the host context.
 * @param {object} [options] - test seams and limits.
 * @returns {Promise<{scanned:number,resumed:number}>} scan statistics.
 */
export async function resumeInterruptedSessions(services, options = {}) {
  const {
    now = Date.now(),
    maxAgeMs = AUTO_RESUME_MAX_AGE_MS,
    scanLimit = AUTO_RESUME_SCAN_LIMIT,
    resumeLimit = AUTO_RESUME_LIMIT,
    statFile = stat,
    logger = services.logger,
  } = options;
  const query = services.sessionQuery;
  const controller = services.sessionController;
  if (typeof query?.listSessions !== 'function'
    || typeof query?.readSession !== 'function'
    || typeof controller?.resolveAgent !== 'function') {
    return { scanned: 0, resumed: 0 };
  }

  const snapshotsPromise = (async () => {
    if (typeof services.sessionPersistence?.list !== 'function') return [];
    try {
      return await services.sessionPersistence.list();
    } catch {
      // Recency falls back to header.createdAt; the scan must not depend on a
      // metadata listing that a backend may refuse.
      return [];
    }
  })();
  const [records, snapshots] = await Promise.all([query.listSessions(), snapshotsPromise]);

  const snapshotsById = new Map();
  for (const snapshot of snapshots ?? []) {
    const id = String(snapshot?.header?.id ?? '');
    if (id) snapshotsById.set(id, snapshot);
  }
  const archived = new Set();
  try {
    for (const sessionId of services.workspaceRegistry?.archivedSessionIds ?? []) {
      archived.add(String(sessionId));
    }
  } catch {
    // An unavailable registry must not block continuation of legitimate work.
  }

  const candidates = [];
  await Promise.all((records ?? []).map(async record => {
    const header = record?.header;
    const sessionId = String(header?.id ?? '');
    // Live is not a skip condition: the built-in Harness window may restore the
    // last session before this scan runs. The post-resolve status and tail
    // checks still keep active work and already-continued turns untouched.
    if (!sessionId || header?.origin === 'subagent' || archived.has(sessionId)) return;
    // Session resume requires a stored cwd; without one there is nothing the
    // controller can reattach.
    if (typeof header?.cwd !== 'string' || header.cwd.length === 0) return;
    // A format migration is a user-visible operation; do not trigger it in the
    // background just because the process happened to stop mid-turn.
    if (record?.formatStatus === 'migration-required') return;

    let at = typeof header.createdAt === 'number' && Number.isFinite(header.createdAt)
      ? header.createdAt
      : 0;
    const path = snapshotsById.get(sessionId)?.location?.path;
    if (typeof path === 'string' && path.length > 0) {
      try {
        const info = await statFile(path);
        const mtimeMs = Number(info?.mtimeMs);
        // The artifact mtime is the authoritative "last activity" time: a
        // session created months ago can have been running yesterday, and a
        // freshly created session can be an untouched stub. Only fall back to
        // createdAt when the file cannot be inspected.
        if (Number.isFinite(mtimeMs)) at = mtimeMs;
      } catch {
        // Missing/unreadable artifacts fall back to the stored creation time.
      }
    }
    if (now - at > maxAgeMs) return;
    candidates.push({ sessionId, at });
  }));
  candidates.sort((left, right) => right.at - left.at || left.sessionId.localeCompare(right.sessionId));

  let scanned = 0;
  let resumed = 0;
  for (const candidate of candidates.slice(0, scanLimit)) {
    if (resumed >= resumeLimit) break;
    scanned += 1;
    const { sessionId } = candidate;

    let snapshot;
    try {
      snapshot = await query.readSession(sessionId);
    } catch (error) {
      logger?.warn?.(`[dsh-session-notify] auto-resume: cannot read session ${sessionId}: ${String(error)}`);
      continue;
    }
    if (!isInterruptedSession(snapshot?.session, snapshot?.events)) continue;

    try {
      const found = await controller.resolveAgent(sessionId);
      if (found?.error !== undefined) {
        logger?.warn?.(`[dsh-session-notify] auto-resume: cannot resolve session ${sessionId}: ${found.error?.message ?? String(found.error)}`);
        continue;
      }
      const agent = found?.agent;
      // A user (or another startup path) may already be running this session.
      if (!agent || typeof agent.followup !== 'function' || agent.status !== 'idle') continue;

      // Re-check after resolve: opening the session can append closers, and a
      // user may have continued it between our cold read and this point.
      let liveEvents;
      try {
        if (typeof agent.session?.snapshotEvents === 'function') liveEvents = agent.session.snapshotEvents();
      } catch {
        // Keep the cold-read decision if the live snapshot is unavailable.
      }
      if (Array.isArray(liveEvents)
        && !isInterruptedSession(agent.session?.header ?? snapshot?.session, liveEvents)) {
        continue;
      }

      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [],
        source: { kind: 'retry', rpcId: randomUUID() },
      });
      resumed += 1;
      logger?.info?.(`[dsh-session-notify] auto-resumed interrupted session ${sessionId}`);
    } catch (error) {
      logger?.warn?.(`[dsh-session-notify] auto-resume: session ${sessionId} failed: ${String(error)}`);
    }
  }
  return { scanned, resumed };
}

/**
 * Schedule one deferred auto-resume scan and return its disposer. Tests use a
 * context without `get`, so nothing is scheduled there.
 */
function scheduleInterruptedResume(ctx) {
  if (typeof ctx.get !== 'function') return () => {};
  let disposed = false;
  let timer = setTimeout(() => {
    timer = undefined;
    if (disposed) return;
    try {
      const services = {
        sessionQuery: ctx.get('sessionQuery'),
        sessionController: ctx.get('sessionController'),
        sessionPersistence: ctx.get('sessionPersistence'),
        workspaceRegistry: ctx.get('workspaceRegistry'),
        logger: ctx.logger,
      };
      void resumeInterruptedSessions(services)
        .then(result => {
          if (!disposed && result.resumed > 0) {
            ctx.logger?.info?.(`[dsh-session-notify] auto-resume: resumed ${result.resumed} session(s)`);
          }
        })
        .catch(error => {
          if (!disposed) {
            ctx.logger?.warn?.(`[dsh-session-notify] auto-resume scan failed: ${String(error)}`);
          }
        });
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-session-notify] auto-resume setup failed: ${String(error)}`);
    }
  }, AUTO_RESUME_DELAY_MS);
  timer.unref?.();
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}

function json(response, value) {
  response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function jsonStatus(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function commandView(command) {
  return {
    commandId: command.commandId,
    sessionId: command.sessionId,
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
  };
}

export function createCommandQueue() {
  const commands = [];

  function prune(now = Date.now()) {
    for (let index = commands.length - 1; index >= 0; index -= 1) {
      const command = commands[index];
      if (command.expiresAt <= now) commands.splice(index, 1);
      else if (command.claimedUntil && command.claimedUntil <= now) {
        command.claimedBy = null;
        command.claimedUntil = 0;
      }
    }
  }

  return {
    enqueue(sessionId, now = Date.now(), options = {}) {
      prune(now);
      const existing = commands.find(command => command.sessionId === sessionId);
      if (existing) return existing;
      const command = {
        commandId: randomUUID(),
        sessionId,
        createdAt: now,
        expiresAt: now + COMMAND_TTL_MS,
        visibleUntil: now + VISIBLE_CLIENT_GRACE_MS,
        focusedUntil: now + FOCUSED_CLIENT_GRACE_MS,
        // 内置窗口模式：命令只允许 WKWebView 页面领取，外部 Chrome 标签页
        // 即使 document.hasFocus() 谎报 true 也不能抢（否则会话切在看不见的窗口里）。
        requireEmbedded: options.requireEmbedded === true,
        claimedBy: null,
        claimedUntil: 0,
      };
      commands.push(command);
      if (commands.length > COMMAND_LIMIT) commands.splice(0, commands.length - COMMAND_LIMIT);
      return command;
    },
    /**
     * 待领取命令列表。
     * @param {number} now
     * @param {{embedded?: boolean}} options - `embedded === false` 时过滤掉
     *   `requireEmbedded` 的命令（外部 Chrome 页面连看都不用看到）。
     */
    list(now = Date.now(), options = {}) {
      prune(now);
      return commands
        .filter(command => !command.claimedBy)
        .filter(command => !(command.requireEmbedded && options.embedded === false))
        .map(commandView);
    },
    /**
     * 领取一条打开会话命令。
     * @param focused - 该页面此刻是否拥有焦点（`document.hasFocus()`）。
     *   入队后的 `FOCUSED_CLIENT_GRACE_MS` 内只有焦点页面能领：另一个浏览器
     *   实例里的 Harness 页面虽然「可见」（窗口在后面）但没有焦点，不许抢。
     */
    claim(commandId, clientId, visible, focused = false, now = Date.now(), embedded = true) {
      prune(now);
      const command = commands.find(item => item.commandId === commandId);
      if (!command) return { kind: 'missing' };
      if (command.claimedBy && command.claimedBy !== clientId) return { kind: 'busy' };
      if (command.requireEmbedded && !embedded) return { kind: 'deferred-embedded' };
      if (!focused && command.focusedUntil > now) return { kind: 'deferred-focused' };
      if (!visible && command.visibleUntil > now) return { kind: 'deferred' };
      command.claimedBy = clientId;
      command.claimedUntil = now + COMMAND_CLAIM_TTL_MS;
      return { kind: 'claimed', command: commandView(command) };
    },
    ack(commandId, clientId, now = Date.now()) {
      prune(now);
      const index = commands.findIndex(item => item.commandId === commandId);
      if (index < 0) return 'missing';
      const command = commands[index];
      if (command.claimedBy !== clientId) return 'forbidden';
      commands.splice(index, 1);
      return 'acknowledged';
    },
  };
}

/**
 * Plugin entry: buffer root-session turn ends and serve them to the launcher.
 * @param {import("@deepseek-ai/cordis").Context} ctx - host plugin context.
 */
export function apply(ctx) {
  const bootId = randomUUID();
  let seq = 0;
  const items = [];
  const commands = createCommandQueue();
  const presence = createPresenceTracker();
  /** sessionId → 这个会话最后一条记录的种类（启动器据此判断「有没有未读」）。 */
  const lastKindBySession = new Map();

  function push(record) {
    seq += 1;
    items.push({ seq, ...record });
    lastKindBySession.set(record.sessionId, record.kind);
    if (items.length > BUFFER_LIMIT) items.splice(0, items.length - BUFFER_LIMIT);
  }

  /** 这个会话当前是否挂着一条未读完成提醒（＝最后一条记录是 completion）。 */
  function pendingCompletion(sessionId) {
    return lastKindBySession.get(sessionId) === 'completion';
  }

  /** 缓冲区里这个会话最近一条带标题的记录：viewed 记录因此也能带上可读的名字。 */
  function titleFor(sessionId) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].sessionId === sessionId && items[index].title) return items[index].title;
    }
    return '';
  }

  /**
   * 「用户正在看这个会话」：与 `resumed`（他又发了消息）同为**撤销**信号——
   * 提醒是给「没看到结果」的人亮的，人已经在会话里看着结果了就不该再亮角标。
   */
  function pushViewed(sessionId, title, now = Date.now()) {
    push({ sessionId, title, reason: '', at: now, kind: 'viewed' });
  }

  ctx.on('session/event', (session, event) => {
    try {
      const record = summarizeTurnStart(session, event) ?? summarizeTurnEnd(session, event);
      if (!record) return;
      push(record);
      // 这个会话正开在用户眼前（页面可见且有焦点）：刚记下的完成提醒立刻撤销，
      // 免得他盯着结果看的时候角标还亮着。
      if (record.kind === 'completion' && presence.viewingNow().has(record.sessionId)) {
        pushViewed(record.sessionId, record.title);
      }
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-session-notify] buffer error: ${String(error)}`);
    }
  });

  ctx.inject(['webServer'], host => {
    host.effect(() => scheduleInterruptedResume(ctx), 'dsh-session-notify: resume interrupted sessions');
    host.effect(() => {
      // 零成本的存活探针（启动器据此判「插件是否随 dsh 加载」，不再拿 /events
      // 当就绪探针；两者注册在同一个 effect 里，能探到 health 就说明路由已挂上）。
      const healthDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/health',
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          json(res, { ok: true, bootId });
        },
      });
      const dispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/events',
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          let after = 0;
          try {
            const parsed = Number(new URL(req.url, 'http://127.0.0.1').searchParams.get('after'));
            if (Number.isFinite(parsed) && parsed > 0) after = Math.floor(parsed);
          } catch { /* missing/invalid ?after= degrades to the full buffer */ }
          json(res, { bootId, seq, items: after > 0 ? items.filter(item => item.seq > after) : [...items] });
        },
      });
      const openDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/open',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : '';
            if (!sessionId) { jsonStatus(res, 400, { error: 'sessionId is required' }); return; }
            // 内置窗口模式由启动器置 true：只有 WKWebView 页面能领，外部 Chrome
            // 标签页即使抢到命令也不执行（从根上消除多页面抢跳转）。
            json(res, { command: commandView(commands.enqueue(sessionId, Date.now(), { requireEmbedded: value.requireEmbedded === true })) });
          } catch (error) {
            jsonStatus(res, 400, { error: String(error?.message || error) });
          }
        },
      });
      const listDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/commands',
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          let embedded = true;
          try {
            const params = new URL(req.url, 'http://127.0.0.1').searchParams;
            const clientId = params.get('clientId');
            // `visible=1`：该标签页此刻可见（启动器在 AppleScript 跨实例选不中
            // 标签时，据此决定「前置浏览器就够」还是「必须新开一个标签」）。
            if (clientId) presence.touch(clientId, Date.now(), params.get('visible') === '1');
            // 顺手回报「用户正在看哪个会话」（页面可见且有焦点时才报，空值＝没在看）。
            // 只在**观看目标变化**时记一条 viewed：轮询是 750ms 一次，每次都记会把
            // 缓冲区冲爆，真正完成提醒就被挤出去了。
            // 页面类型由客户端心跳上报：明确 `embedded=0` 的 Chrome 页面看不到
            // 只给内置窗口的命令。缺省按内置处理（旧客户端兼容）。
            embedded = params.get('embedded') !== '0';
            const viewing = (params.get('viewing') ?? '').trim();
            if (clientId && viewing !== presence.watches(clientId)) {
              presence.watch(clientId, viewing);
              // 只在**这个会话确实挂着未读完成**时才记一条 viewed：轮询 750ms 一次，
              // 用户来回切会话时每次都记会把 50 条缓冲区占满（实测 2.5 分钟 26 条），
              // 真正的完成提醒反而被挤出去。已经读过的会话再看不产生新信息。
              if (viewing && pendingCompletion(viewing)) pushViewed(viewing, titleFor(viewing));
            }
          } catch { /* a poll without clientId still gets the queue */ }
          const payload = { items: commands.list(Date.now(), { embedded }) };
          json(res, payload);
        },
      });
      const claimDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/commands/claim',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const commandId = typeof value.commandId === 'string' ? value.commandId.trim() : '';
            const clientId = typeof value.clientId === 'string' ? value.clientId.trim() : '';
            if (!commandId || !clientId) { jsonStatus(res, 400, { error: 'commandId and clientId are required' }); return; }
            // 缺省按内置页面处理（旧客户端不传 embedded），显式 false 的 Chrome
            // 页面不能领取 requireEmbedded 命令。
            const result = commands.claim(
              commandId,
              clientId,
              value.visible === true,
              value.focused === true,
              Date.now(),
              value.embedded !== false,
            );
            if (result.kind === 'missing') { jsonStatus(res, 404, { error: 'command not found' }); return; }
            if (result.kind === 'busy') { jsonStatus(res, 409, { error: 'command already claimed' }); return; }
            if (result.kind === 'deferred-embedded') {
              jsonStatus(res, 409, { error: 'waiting for embedded Harness window' });
              return;
            }
            if (result.kind === 'deferred-focused') {
              jsonStatus(res, 409, { error: 'waiting for focused Harness tab' });
              return;
            }
            if (result.kind === 'deferred') { jsonStatus(res, 409, { error: 'waiting for visible Harness tab' }); return; }
            json(res, { command: result.command });
          } catch (error) {
            jsonStatus(res, 400, { error: String(error?.message || error) });
          }
        },
      });
      const ackDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/commands/ack',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const commandId = typeof value.commandId === 'string' ? value.commandId.trim() : '';
            const clientId = typeof value.clientId === 'string' ? value.clientId.trim() : '';
            if (!commandId || !clientId) { jsonStatus(res, 400, { error: 'commandId and clientId are required' }); return; }
            const result = commands.ack(commandId, clientId);
            if (result === 'missing') { jsonStatus(res, 404, { error: 'command not found' }); return; }
            if (result === 'forbidden') { jsonStatus(res, 409, { error: 'command claim mismatch' }); return; }
            json(res, { ok: true });
          } catch (error) {
            jsonStatus(res, 400, { error: String(error?.message || error) });
          }
        },
      });
      const presenceDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/presence',
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          json(res, { active: presence.active(), clients: presence.clients(), visible: presence.anyVisible() });
        },
      });
      const byeDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/presence/bye',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            presence.bye(typeof value.clientId === 'string' ? value.clientId.trim() : '');
            json(res, { ok: true });
          } catch (error) {
            jsonStatus(res, 400, { error: String(error?.message || error) });
          }
        },
      });
      return () => [healthDispose, dispose, openDispose, listDispose, claimDispose, ackDispose, presenceDispose, byeDispose].forEach(disposeRoute => disposeRoute());
    }, 'dsh-session-notify: routes');
  });
}
