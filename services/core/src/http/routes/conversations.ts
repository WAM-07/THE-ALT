import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { AppError, notFound } from '../../lib/errors.js';
import { respond } from '../../modules/ai/engine.js';
import { moderate } from '../../modules/ai/moderation.js';
import { loadAi } from '../../modules/ai/repo.js';
import { requireService, requireUser } from '../auth-guard.js';

const AiId = z.object({ id: z.uuid() });
const SessionParams = z.object({ id: z.uuid(), sessionId: z.uuid() });

/**
 * Talking to a verified AI from any ALT app (Module 11 with ALTAR steps 3 and 4). Its owner may
 * always talk to it; a renter may until the rental ends (the token's ERC-4907 user) and a subscriber
 * until their subscription ends (both mirrored by Core from the chain). The conversations belong to
 * the ALT account, so ALTER, ALTERA and ALTAR show the same ones. Each person sees only their own,
 * and always the published version of the AI. (The channel is still called 'altar_rental', where
 * paid access began.)
 */
export async function conversationRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);

  async function accessOf(userId: string, aiId: string) {
    const ai = await loadAi(ctx.db, aiId);
    if (!ai || ai.status !== 'verified') throw notFound('AI');
    if (ai.owner_id === userId) return { ai, role: 'owner' as const, until: null, channel: 'alter_chat' as const };
    const { rows } = await ctx.db.query<{ user_expires: Date }>(
      `SELECT t.user_expires FROM core.ai_identity_tokens t JOIN core.wallets w ON w.address = t.user_address
        WHERE t.ai_id = $1 AND w.user_id = $2 AND t.user_expires > now()`,
      [ai.id, userId],
    );
    if (rows[0]) return { ai, role: 'renter' as const, until: rows[0].user_expires, channel: 'altar_rental' as const };
    const sub = await ctx.db.query<{ expires_at: Date }>(
      `SELECT max(s.expires_at) AS expires_at FROM core.ai_subscriptions s JOIN core.wallets w ON w.address = s.subscriber_address
        WHERE s.ai_id = $1 AND w.user_id = $2 AND s.expires_at > now()`,
      [ai.id, userId],
    );
    // Paid ALTAR access either way, so subscribers share the renters' channel and conversation list.
    if (sub.rows[0]?.expires_at) return { ai, role: 'subscriber' as const, until: sub.rows[0].expires_at, channel: 'altar_rental' as const };
    return { ai, role: null, until: null, channel: 'altar_rental' as const };
  }

  const requireAccess = (access: Awaited<ReturnType<typeof accessOf>>) => {
    if (!access.role) throw new AppError(403, 'NO_ACCESS', 'Rent or subscribe to this AI to talk to it. If you did, that time has ended.');
  };

  // For other ALT services (ALTERA drafting a post with a rented AI): may this person use the AI now?
  r.get(
    '/internal/ais/:id/access',
    { preHandler: requireService(ctx), schema: { tags: ['internal'], summary: 'May this person use this AI right now? (owner, renter, subscriber or no)', params: AiId, querystring: z.object({ userId: z.uuid() }) } },
    async (req) => {
      const a = await accessOf(req.query.userId, req.params.id);
      return { role: a.role, until: a.until?.toISOString() ?? null, ai: { id: a.ai.id, name: a.ai.name, handle: a.ai.handle } };
    },
  );

  r.get('/ais/:id/access', { preHandler: authed, schema: { tags: ['chat'], summary: 'May I talk to this AI? (owner, renter until when, or no)', params: AiId } }, async (req) => {
    const a = await accessOf(req.auth!.userId, req.params.id);
    return { role: a.role, until: a.until?.toISOString() ?? null };
  });

  r.get(
    '/ais/:id/conversations',
    { preHandler: authed, schema: { tags: ['chat'], summary: 'Your conversations with this AI on ALTAR (kept after a rental ends, read-only)', params: AiId } },
    async (req) => {
      const a = await accessOf(req.auth!.userId, req.params.id);
      const { rows } = await ctx.db.query(
        `SELECT s.id, s.title, s.channel, s.created_at, s.updated_at FROM core.chat_sessions s
          WHERE s.ai_id = $1 AND s.user_id = $2 AND s.channel = $3 ORDER BY s.updated_at DESC LIMIT 50`,
        [a.ai.id, req.auth!.userId, a.channel],
      );
      return {
        access: { role: a.role, until: a.until?.toISOString() ?? null },
        conversations: rows.map((s) => ({ id: s.id, title: s.title, createdAt: (s.created_at as Date).toISOString(), updatedAt: (s.updated_at as Date).toISOString() })),
      };
    },
  );

  r.post('/ais/:id/conversations', { preHandler: authed, schema: { tags: ['chat'], summary: 'Start a conversation (owner or current renter)', params: AiId } }, async (req, reply) => {
    const a = await accessOf(req.auth!.userId, req.params.id);
    requireAccess(a);
    const { rows } = await ctx.db.query('INSERT INTO core.chat_sessions (ai_id, user_id, channel) VALUES ($1, $2, $3) RETURNING id, created_at', [a.ai.id, req.auth!.userId, a.channel]);
    return reply.status(201).send({ id: rows[0].id, createdAt: (rows[0].created_at as Date).toISOString() });
  });

  async function mySession(aiId: string, sessionId: string, userId: string) {
    const { rows } = await ctx.db.query<{ channel: string }>('SELECT channel FROM core.chat_sessions WHERE id = $1 AND ai_id = $2 AND user_id = $3', [sessionId, aiId, userId]);
    if (!rows[0]) throw notFound('Conversation');
    return rows[0];
  }
  const messageOut = (m: Record<string, unknown>) => ({ id: String(m.id), role: m.role, content: m.content, flagged: m.flagged, createdAt: (m.created_at as Date).toISOString() });

  r.get(
    '/ais/:id/conversations/:sessionId/messages',
    { preHandler: authed, schema: { tags: ['chat'], summary: 'Messages in one of your conversations', params: SessionParams } },
    async (req) => {
      await mySession(req.params.id, req.params.sessionId, req.auth!.userId);
      const { rows } = await ctx.db.query('SELECT * FROM core.chat_messages WHERE session_id = $1 ORDER BY id', [req.params.sessionId]);
      return rows.map(messageOut);
    },
  );

  r.post(
    '/ais/:id/conversations/:sessionId/messages',
    {
      preHandler: authed,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['chat'], summary: 'Say something and get the AI’s reply', params: SessionParams, body: z.object({ content: z.string().trim().min(1).max(4000) }) },
    },
    async (req) => {
      const a = await accessOf(req.auth!.userId, req.params.id);
      requireAccess(a);
      const session = await mySession(a.ai.id, req.params.sessionId, req.auth!.userId);
      // A conversation from a rental stays closed if the person later talks as owner, and vice versa.
      if (session.channel !== a.channel) throw new AppError(403, 'NO_ACCESS', 'Start a new conversation.');
      const { rows: history } = await ctx.db.query<{ role: 'user' | 'assistant'; content: string }>(
        `SELECT role, content FROM (SELECT id, role, content FROM core.chat_messages WHERE session_id = $1 ORDER BY id DESC LIMIT 12) h ORDER BY id`,
        [req.params.sessionId],
      );
      const { rows: saved } = await ctx.db.query(`INSERT INTO core.chat_messages (session_id, role, content, flagged) VALUES ($1, 'user', $2, $3) RETURNING *`, [
        req.params.sessionId,
        req.body.content,
        moderate(req.body.content).flagged,
      ]);
      const result = await respond(ctx, {
        ai: a.ai,
        version: 'current',
        channel: a.channel,
        messages: [...history, { role: 'user', content: req.body.content }],
        callerUserId: req.auth!.userId,
      });
      const { rows: reply } = await ctx.db.query(
        `INSERT INTO core.chat_messages (session_id, role, content, version_id, model, latency_ms, flagged) VALUES ($1, 'assistant', $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.sessionId, result.text, result.versionId, `${result.provider}:${result.model}`, result.latencyMs, result.flagged],
      );
      await ctx.db.query('UPDATE core.chat_sessions SET updated_at = now(), title = COALESCE(title, $2) WHERE id = $1', [req.params.sessionId, req.body.content.slice(0, 60)]);
      return { message: messageOut(saved[0]), reply: messageOut(reply[0]), access: { role: a.role, until: a.until?.toISOString() ?? null } };
    },
  );
}
