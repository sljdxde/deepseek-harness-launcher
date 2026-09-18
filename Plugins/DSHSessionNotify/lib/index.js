/**
 * dsh-session-notify — server-side DSH host plugin (bundled with the launcher).
 *
 * Keeps a small in-memory ring buffer of root-session `turn/end` events and
 * exposes it to the launcher menu bar app:
 *
 *   GET /dsh-session-notify/events?after=<seq>
 *     → { bootId, seq, items: [{ seq, sessionId, title, reason, at }] }
 *   POST /dsh-session-notify/open { sessionId }
 *     → queues a short-lived browser navigation command
 *   GET /dsh-session-notify/presence
 *     → { active, clients }: does an injected Harness page poll right now?
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
 * @module dsh-session-notify
 */

import { randomUUID } from 'node:crypto';

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
 * A Harness page counts as open while its injected client polls, and stops
 * counting the moment it reports a pagehide (tab/window closed). Chrome
 * keep-alive keeps sockets ESTABLISHED long after every tab closed, so the
 * launcher must not rely on socket checks alone to decide whether a new page
 * has to be opened. The TTL only covers abnormal exits where no pagehide
 * fired; hidden tabs poll at least once a minute, so 90s is safely above it.
 */
export const PRESENCE_TTL_MS = 90 * 1000;

export function createPresenceTracker(ttlMs = PRESENCE_TTL_MS) {
  const lastSeen = new Map();
  return {
    touch(clientId, now = Date.now()) {
      if (clientId) lastSeen.set(clientId, now);
    },
    bye(clientId) {
      if (clientId) lastSeen.delete(clientId);
    },
    active(now = Date.now()) {
      for (const [clientId, seen] of lastSeen) {
        if (now - seen > ttlMs) lastSeen.delete(clientId);
      }
      return lastSeen.size > 0;
    },
    clients(now = Date.now()) {
      this.active(now);
      return lastSeen.size;
    },
  };
}

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

function createCommandQueue() {
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
    enqueue(sessionId, now = Date.now()) {
      prune(now);
      const existing = commands.find(command => command.sessionId === sessionId);
      if (existing) return existing;
      const command = {
        commandId: randomUUID(),
        sessionId,
        createdAt: now,
        expiresAt: now + COMMAND_TTL_MS,
        visibleUntil: now + VISIBLE_CLIENT_GRACE_MS,
        claimedBy: null,
        claimedUntil: 0,
      };
      commands.push(command);
      if (commands.length > COMMAND_LIMIT) commands.splice(0, commands.length - COMMAND_LIMIT);
      return command;
    },
    list(now = Date.now()) {
      prune(now);
      return commands.filter(command => !command.claimedBy).map(commandView);
    },
    claim(commandId, clientId, visible, now = Date.now()) {
      prune(now);
      const command = commands.find(item => item.commandId === commandId);
      if (!command) return { kind: 'missing' };
      if (command.claimedBy && command.claimedBy !== clientId) return { kind: 'busy' };
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
      const openDispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-session-notify/open',
        handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const sessionId = typeof value.sessionId === 'string' ? value.sessionId.trim() : '';
            if (!sessionId) { jsonStatus(res, 400, { error: 'sessionId is required' }); return; }
            json(res, { command: commandView(commands.enqueue(sessionId)) });
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
          try {
            const clientId = new URL(req.url, 'http://127.0.0.1').searchParams.get('clientId');
            if (clientId) presence.touch(clientId);
          } catch { /* a poll without clientId still gets the queue */ }
          json(res, { items: commands.list() });
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
            const result = commands.claim(commandId, clientId, value.visible === true);
            if (result.kind === 'missing') { jsonStatus(res, 404, { error: 'command not found' }); return; }
            if (result.kind === 'busy') { jsonStatus(res, 409, { error: 'command already claimed' }); return; }
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
          json(res, { active: presence.active(), clients: presence.clients() });
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
      return () => [dispose, openDispose, listDispose, claimDispose, ackDispose, presenceDispose, byeDispose].forEach(disposeRoute => disposeRoute());
    }, 'dsh-session-notify: routes');
  });
}
