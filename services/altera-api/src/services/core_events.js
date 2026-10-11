const { Client } = require('pg');

/**
 * One Postgres connection that LISTENs to what ALT Core announces:
 *   alt_sessions_revoked  {sessionId?, userId?}   someone signed out (drop cached sessions, close sockets)
 *   alt_ai_events         {aiId, event}            an AI was verified, updated, suspended or got a new version
 * NOTIFY is delivered only after Core's transaction commits, so ALTERA never sees half-done changes.
 */
const CHANNELS = ['alt_sessions_revoked', 'alt_ai_events'];
const handlers = Object.fromEntries(CHANNELS.map((c) => [c, []]));
let client = null;
let stopped = false;

function on(channel, handler) {
  if (!handlers[channel]) throw new Error(`Unknown Core channel ${channel}`);
  handlers[channel].push(handler);
}

function dispatch(channel, payload) {
  for (const handler of handlers[channel] || []) {
    Promise.resolve()
      .then(() => handler(payload))
      .catch((err) => console.error(`[core-events] ${channel} handler failed:`, err.message));
  }
}

async function start() {
  if (client) return;
  stopped = false;
  const needsSsl = /sslmode=require|neon\.tech/.test(process.env.DATABASE_URL || '');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
  client = c;
  c.on('notification', (msg) => {
    try {
      dispatch(msg.channel, JSON.parse(msg.payload));
    } catch {
      // ignore malformed payloads
    }
  });
  c.on('error', (err) => {
    console.error('[core-events] connection lost:', err.message);
    client = null;
    if (!stopped) setTimeout(() => start().catch(() => {}), 5000);
  });
  await c.connect();
  for (const channel of CHANNELS) await c.query(`LISTEN ${channel}`);
}

async function stop() {
  stopped = true;
  const c = client;
  client = null;
  if (c) await c.end().catch(() => {});
}

module.exports = { on, start, stop };
