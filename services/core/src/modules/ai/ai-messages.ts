import type pg from 'pg';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { respond } from './engine.js';
import { checkSafety } from './moderation.js';
import { loadAi, type AiRow } from './repo.js';

/**
 * AI-to-AI messages (Module 14 FE-1; owner's request 2026-10-29). A person asks their AI to tell a
 * teammate's AI something ("update Sara's AI on what we finished"); the AI writes the message in its own
 * voice from that brief, the owner checks it and sends it, and the other AI passes it on to its owner when
 * they talk (see aiInbox in persona.ts). The teammate can answer the same way through their AI.
 *
 * Safety: only verified AIs on both sides (FE-2); every message is approved by its owner before it is
 * sent, so AIs never answer each other on their own (no loops); each one is moderated; an AI's owner can
 * stop other AIs writing to it; at most MAX_PER_DAY messages per AI; the brief stays private to its writer.
 */
export const MAX_PER_DAY = 30;

interface MessageRow {
  id: string;
  thread_id: string;
  from_ai_id: string;
  to_ai_id: string;
  sender_owner_id: string;
  recipient_owner_id: string;
  brief_enc: string | null;
  content: string;
  status: 'draft' | 'sent';
  created_at: Date;
  sent_at: Date | null;
  read_at: Date | null;
}

const BLOCKED = () => new AppError(422, 'CONTENT_BLOCKED', 'That message broke ALT’s content rules and was not sent.');

async function myVerifiedAi(ctx: Ctx, userId: string, aiId: string) {
  const ai = await loadAi(ctx.db, aiId);
  if (!ai || ai.owner_id !== userId) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  if (ai.status !== 'verified') throw forbidden('AI_NOT_VERIFIED', 'Only verified AIs can message other AIs. Deploy yours first.');
  return ai;
}

/** The thread's messages this person may see: those sent or received by their AI while they owned it. */
async function visibleMessages(q: pg.Pool | pg.PoolClient, threadId: string, ai: AiRow) {
  const { rows } = await q.query<MessageRow>(
    `SELECT * FROM core.ai_messages
      WHERE thread_id = $1
        AND ((from_ai_id = $2 AND sender_owner_id = $3) OR (to_ai_id = $2 AND recipient_owner_id = $3 AND status = 'sent'))
      ORDER BY created_at`,
    [threadId, ai.id, ai.owner_id],
  );
  return rows;
}

function messageOut(ctx: Ctx, m: MessageRow, ai: AiRow) {
  const mine = m.from_ai_id === ai.id;
  return {
    id: m.id,
    threadId: m.thread_id,
    mine,
    status: m.status,
    content: m.content,
    // The brief is the sender's private instruction to their own AI.
    brief: mine && m.brief_enc ? decrypt(ctx.config.encryptionKey, m.brief_enc) : undefined,
    createdAt: m.created_at.toISOString(),
    sentAt: m.sent_at?.toISOString() ?? null,
    readAt: m.read_at?.toISOString() ?? null,
  };
}

async function aiCard(q: pg.Pool | pg.PoolClient, aiId: string) {
  const { rows } = await q.query<{ id: string; name: string; handle: string; avatar_url: string | null; owner_name: string; owner_handle: string }>(
    `SELECT a.id, a.name, a.handle, a.avatar_url, u.display_name AS owner_name, u.handle AS owner_handle
       FROM core.personal_ais a JOIN core.users u ON u.id = a.owner_id WHERE a.id = $1`,
    [aiId],
  );
  const a = rows[0]!;
  return { id: a.id, name: a.name, handle: a.handle, avatarUrl: a.avatar_url, owner: { name: a.owner_name, handle: a.owner_handle } };
}

/**
 * The AI writes a message from its owner's brief, to a new AI (by handle) or in an existing thread. It is
 * saved as a draft for the owner to check; nothing reaches the other AI until they send it.
 */
export async function draftAiMessage(ctx: Ctx, userId: string, aiId: string, input: { toHandle?: string; threadId?: string; subject?: string; brief: string }) {
  const ai = await myVerifiedAi(ctx, userId, aiId);
  const { rows: today } = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM core.ai_messages WHERE from_ai_id = $1 AND created_at > now() - interval '1 day'`, [ai.id]);
  if (today[0]!.n >= MAX_PER_DAY) throw new AppError(429, 'AI_MESSAGE_LIMIT', `An AI can write at most ${MAX_PER_DAY} messages to other AIs a day.`);

  let threadId = input.threadId ?? null;
  let otherId: string;
  if (threadId) {
    const { rows } = await ctx.db.query<{ ai_a: string; ai_b: string }>('SELECT ai_a, ai_b FROM core.ai_threads WHERE id = $1', [threadId]);
    const t = rows[0];
    if (!t || (t.ai_a !== ai.id && t.ai_b !== ai.id)) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
    otherId = t.ai_a === ai.id ? t.ai_b : t.ai_a;
  } else {
    const { rows } = await ctx.db.query<{ id: string }>(`SELECT id FROM core.personal_ais WHERE lower(handle) = lower($1) AND deleted_at IS NULL`, [input.toHandle?.replace(/^@/, '') ?? '']);
    if (!rows[0]) throw new AppError(404, 'AI_NOT_FOUND', 'No AI has that handle.');
    otherId = rows[0].id;
  }
  const other = await loadAi(ctx.db, otherId);
  if (!other || other.id === ai.id) throw new AppError(400, 'BAD_RECIPIENT', 'Choose another person’s AI.');
  if (other.status !== 'verified') throw forbidden('RECIPIENT_NOT_VERIFIED', 'That AI is not verified, so it cannot receive messages from AIs.');
  if (other.ai_messages === 'off') throw forbidden('RECIPIENT_CLOSED', 'That AI’s owner does not accept messages from other AIs.');

  // The conversation so far, as the AI sees it: its own messages, and what the other AI wrote.
  const history = threadId ? (await visibleMessages(ctx.db, threadId, ai)).filter((m) => m.status === 'sent').slice(-10) : [];
  const messages = [
    ...history.map((m) =>
      m.from_ai_id === ai.id
        ? { role: 'assistant' as const, content: m.content }
        : { role: 'user' as const, content: `@${other.handle} (${other.name}, the AI of another person) wrote: """${m.content}"""` },
    ),
    { role: 'user' as const, content: `Brief from your owner for a message to @${other.handle}: ${input.brief}` },
  ];
  const reply = await respond(ctx, { ai, version: 'current', channel: 'ai_message', messages, callerUserId: userId });
  if (reply.flagged) throw BLOCKED();

  return tx(ctx.db, async (client) => {
    if (!threadId) {
      const subject = (input.subject?.trim() || input.brief.trim()).slice(0, 120);
      const { rows } = await client.query<{ id: string }>('INSERT INTO core.ai_threads (ai_a, ai_b, subject) VALUES ($1, $2, $3) RETURNING id', [ai.id, other.id, subject]);
      threadId = rows[0]!.id;
    }
    const { rows } = await client.query<MessageRow>(
      `INSERT INTO core.ai_messages (thread_id, from_ai_id, to_ai_id, sender_owner_id, recipient_owner_id, brief_enc, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [threadId, ai.id, other.id, ai.owner_id, other.owner_id, encrypt(ctx.config.encryptionKey, input.brief), reply.text.trim().slice(0, 4000)],
    );
    return { message: messageOut(ctx, rows[0]!, ai), to: await aiCard(client, other.id) };
  });
}

/** The owner sends the draft (as written, or with their edits, which are checked again). */
export async function sendAiMessage(ctx: Ctx, userId: string, aiId: string, messageId: string, content: string | undefined, ip: string | null) {
  const ai = await myVerifiedAi(ctx, userId, aiId);
  if (content !== undefined && (await checkSafety(ctx.ml, content)).flagged) throw BLOCKED();
  return tx(ctx.db, async (client) => {
    const { rows } = await client.query<MessageRow>('SELECT * FROM core.ai_messages WHERE id = $1 AND from_ai_id = $2 AND sender_owner_id = $3 FOR UPDATE', [messageId, ai.id, userId]);
    const m = rows[0];
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Message not found.');
    if (m.status === 'sent') throw new AppError(409, 'ALREADY_SENT', 'That message was already sent.');
    const other = await loadAi(client, m.to_ai_id);
    if (!other || other.status !== 'verified' || other.ai_messages === 'off' || other.owner_id !== m.recipient_owner_id) {
      throw forbidden('RECIPIENT_CLOSED', 'That AI no longer accepts messages from other AIs.');
    }
    const { rows: sent } = await client.query<MessageRow>(
      `UPDATE core.ai_messages SET status = 'sent', sent_at = now(), content = COALESCE($2, content) WHERE id = $1 RETURNING *`,
      [m.id, content?.trim() || null],
    );
    await client.query('UPDATE core.ai_threads SET last_message_at = now() WHERE id = $1', [m.thread_id]);
    // Who, to whom and when; never the words (they stay between the two owners).
    await audit(client, { action: 'ai.message_sent', actorUserId: userId, entityType: 'ai', entityId: ai.id, ip, data: { threadId: m.thread_id, messageId: m.id, toAi: other.id } });
    await notify(client, {
      userId: other.owner_id,
      category: 'ai',
      type: 'ai.message',
      title: `${ai.name} (@${ai.handle}) sent ${other.name} a message`,
      body: sent[0]!.content.slice(0, 140),
      data: { aiId: other.id, threadId: m.thread_id, fromAi: ai.id },
      platform: 'alter',
      link: 'alter://ai-messages',
    });
    return messageOut(ctx, sent[0]!, ai);
  });
}

export async function discardDraft(ctx: Ctx, userId: string, aiId: string, messageId: string) {
  const { rowCount } = await ctx.db.query(`DELETE FROM core.ai_messages WHERE id = $1 AND from_ai_id = $2 AND sender_owner_id = $3 AND status = 'draft'`, [messageId, aiId, userId]);
  if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Draft not found.');
}

/** The AI's conversations with other AIs, newest first, with how many messages are unread. */
export async function aiThreads(ctx: Ctx, userId: string, aiId: string) {
  const ai = await loadAi(ctx.db, aiId);
  if (!ai || ai.owner_id !== userId) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  const { rows } = await ctx.db.query<{ id: string; subject: string; other: string; last_message_at: Date; unread: number; last: string | null }>(
    `SELECT t.id, t.subject, CASE WHEN t.ai_a = $1 THEN t.ai_b ELSE t.ai_a END AS other, t.last_message_at,
            (SELECT count(*)::int FROM core.ai_messages m WHERE m.thread_id = t.id AND m.to_ai_id = $1 AND m.recipient_owner_id = $2 AND m.status = 'sent' AND m.read_at IS NULL) AS unread,
            (SELECT m.content FROM core.ai_messages m WHERE m.thread_id = t.id AND m.status = 'sent'
               AND ((m.from_ai_id = $1 AND m.sender_owner_id = $2) OR (m.to_ai_id = $1 AND m.recipient_owner_id = $2)) ORDER BY m.sent_at DESC LIMIT 1) AS last
       FROM core.ai_threads t
      WHERE (t.ai_a = $1 OR t.ai_b = $1)
        AND EXISTS (SELECT 1 FROM core.ai_messages m WHERE m.thread_id = t.id
                     AND ((m.from_ai_id = $1 AND m.sender_owner_id = $2) OR (m.to_ai_id = $1 AND m.recipient_owner_id = $2 AND m.status = 'sent')))
      ORDER BY t.last_message_at DESC LIMIT 100`,
    [ai.id, userId],
  );
  return Promise.all(rows.map(async (t) => ({ id: t.id, subject: t.subject, with: await aiCard(ctx.db, t.other), unread: t.unread, last: t.last, lastMessageAt: t.last_message_at.toISOString() })));
}

/** One conversation; opening it marks what the other AI sent as read. */
export async function aiThread(ctx: Ctx, userId: string, aiId: string, threadId: string) {
  const ai = await loadAi(ctx.db, aiId);
  if (!ai || ai.owner_id !== userId) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  const { rows } = await ctx.db.query<{ id: string; subject: string; ai_a: string; ai_b: string }>('SELECT * FROM core.ai_threads WHERE id = $1 AND (ai_a = $2 OR ai_b = $2)', [threadId, ai.id]);
  const t = rows[0];
  const messages = t ? await visibleMessages(ctx.db, t.id, ai) : [];
  if (!t || !messages.length) throw new AppError(404, 'NOT_FOUND', 'Conversation not found.');
  await ctx.db.query(`UPDATE core.ai_messages SET read_at = now() WHERE thread_id = $1 AND to_ai_id = $2 AND recipient_owner_id = $3 AND status = 'sent' AND read_at IS NULL`, [t.id, ai.id, userId]);
  return { id: t.id, subject: t.subject, with: await aiCard(ctx.db, t.ai_a === ai.id ? t.ai_b : t.ai_a), messages: messages.map((m) => messageOut(ctx, m, ai)) };
}

export async function setAiMessagesOpen(ctx: Ctx, userId: string, aiId: string, accept: 'verified' | 'off') {
  const { rowCount } = await ctx.db.query('UPDATE core.personal_ais SET ai_messages = $3 WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL', [aiId, userId, accept]);
  if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  return { accept };
}

/** What other AIs told this AI recently, for its owner's chats (the 10 newest of the last 14 days). */
export async function aiInboxFor(q: pg.Pool | pg.PoolClient, aiId: string, ownerId: string) {
  const { rows } = await q.query<{ content: string; sent_at: Date; name: string; handle: string; owner_name: string }>(
    `SELECT m.content, m.sent_at, a.name, a.handle, u.display_name AS owner_name
       FROM core.ai_messages m JOIN core.personal_ais a ON a.id = m.from_ai_id JOIN core.users u ON u.id = m.sender_owner_id
      WHERE m.to_ai_id = $1 AND m.recipient_owner_id = $2 AND m.status = 'sent' AND m.sent_at > now() - interval '14 days'
      ORDER BY m.sent_at DESC LIMIT 10`,
    [aiId, ownerId],
  );
  return rows.reverse().map((r) => ({ from: `${r.name} (@${r.handle}), ${r.owner_name}'s AI`, content: r.content, at: r.sent_at.toISOString() }));
}
