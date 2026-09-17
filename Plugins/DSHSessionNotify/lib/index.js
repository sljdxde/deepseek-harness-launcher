/**
 * dsh-session-notify — server-side DSH host plugin (bundled with the launcher).
 *
 * Keeps a small in-memory ring buffer of root-session `turn/end` events and
 * exposes it to the launcher menu bar app:
 *
 *   GET /dsh-session-notify/events?after=<seq>
 *     → { bootId, seq, items: [{ seq, sessionId, title, reason, at }] }
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
 * @module dsh-session-notify
 */

import { randomUUID } from 'node:crypto';

/** Plugin display name. */
export const name = 'dsh-session-notify';

/** Events kept for polling; the launcher caps its own unread list as well. */
const BUFFER_LIMIT = 50;

/** Fold the last `session/title` from a session's event log for display. */
function sessionTitle(session) {
  const events = session?.events;
  if (Array.isArray(events)) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title) {
        return event.data.title;
      }
    }
  }
  const id = session?.header?.id ?? session?.id;
  return typeof id === 'string' && id.length > 0 ? id.slice(0, 8) : '(未命名会话)';
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
  return {
    sessionId,
    title: sessionTitle(session),
    reason: typeof event.data?.reason?.kind === 'string' && event.data.reason.kind ? event.data.reason.kind : 'completed',
    at: now,
  };
}

function json(response, value) {
  response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

/**
 * Plugin entry: buffer root-session turn ends and serve them to the launcher.
 * @param {import("@deepseek-ai/cordis").Context} ctx - host plugin context.
 */
export function apply(ctx) {
  const bootId = randomUUID();
  let seq = 0;
  const items = [];

  ctx.on('session/event', (session, event) => {
    try {
      const summary = summarizeTurnEnd(session, event);
      if (!summary) return;
      seq += 1;
      items.push({ seq, ...summary });
      if (items.length > BUFFER_LIMIT) items.splice(0, items.length - BUFFER_LIMIT);
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-session-notify] buffer error: ${String(error)}`);
    }
  });

  ctx.inject(['webServer'], host => {
    host.effect(() => {
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
      return () => dispose();
    }, 'dsh-session-notify: routes');
  });
}
