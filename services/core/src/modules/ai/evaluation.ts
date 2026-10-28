import type pg from 'pg';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { respond } from './engine.js';
import { loadAi, loadVersion, type AiRow } from './repo.js';
import { profileFor, styleScore, STYLE_CHARS, STYLE_MIN_SAMPLES } from './style.js';

/**
 * Readiness (Module 9 FE-2/FE-4; owner's plan E2). The owner writes questions with their own answers;
 * a trained version answers each one and is scored on how close it comes to what the owner would say
 * (meaning) and how much it sounds like them (ALT's style-match model). Readiness = the mean, 0–100.
 * The owner then approves the version or trains again, and ALT's system check needs readiness and safety.
 */

export interface EvalItemScore {
  itemId: string;
  question: string;
  reply: string;
  meaning: number;
  style: number | null;
  score: number;
  flagged: boolean;
}

interface EvaluationRow {
  id: string;
  ai_id: string;
  version_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  readiness: string | null;
  safe: boolean | null;
  items: EvalItemScore[];
  error: string | null;
  requested_by: string;
  created_at: Date;
  completed_at: Date | null;
}

export const evaluationOut = (e: EvaluationRow) => ({
  id: e.id,
  versionId: e.version_id,
  status: e.status,
  readiness: e.readiness === null ? null : Number(e.readiness),
  safe: e.safe,
  items: e.items,
  error: e.error,
  createdAt: e.created_at.toISOString(),
  completedAt: e.completed_at?.toISOString() ?? null,
});

// ---------------------------------------------------------------- the evaluation set

export async function evalItems(ctx: Ctx, aiId: string) {
  const { rows } = await ctx.db.query<{ id: string; question: string; answer_enc: string; created_at: Date }>(
    'SELECT id, question, answer_enc, created_at FROM core.ai_eval_items WHERE ai_id = $1 AND deleted_at IS NULL ORDER BY created_at',
    [aiId],
  );
  return rows.map((r) => ({ id: r.id, question: r.question, answer: decrypt(ctx.config.encryptionKey, r.answer_enc), createdAt: r.created_at.toISOString() }));
}

export async function countEvalItems(q: pg.Pool | pg.PoolClient, aiId: string) {
  const { rows } = await q.query<{ n: string }>('SELECT count(*) AS n FROM core.ai_eval_items WHERE ai_id = $1 AND deleted_at IS NULL', [aiId]);
  return Number(rows[0]!.n);
}

export async function addEvalItem(ctx: Ctx, ai: AiRow, userId: string, question: string, answer: string) {
  if ((await countEvalItems(ctx.db, ai.id)) >= 50) throw new AppError(409, 'EVAL_SET_FULL', 'An evaluation set holds at most 50 questions.');
  const { rows } = await ctx.db.query<{ id: string; created_at: Date }>(
    'INSERT INTO core.ai_eval_items (ai_id, question, answer_enc, created_by) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
    [ai.id, question.trim(), encrypt(ctx.config.encryptionKey, answer.trim()), userId],
  );
  return { id: rows[0]!.id, question: question.trim(), answer: answer.trim(), createdAt: rows[0]!.created_at.toISOString() };
}

export async function deleteEvalItem(ctx: Ctx, ai: AiRow, itemId: string) {
  const { rowCount } = await ctx.db.query('UPDATE core.ai_eval_items SET deleted_at = now() WHERE id = $1 AND ai_id = $2 AND deleted_at IS NULL', [itemId, ai.id]);
  if (!rowCount) throw new AppError(404, 'NOT_FOUND', 'Question not found.');
}

// ---------------------------------------------------------------- scoring

const STOP = new Set('a an and are as at be but by do does for from had has have i if in is it its me my of on or our so that the their them they this to was we what when where which who why will with you your'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((w) => !STOP.has(w)) ?? []);

/** How much two answers say the same thing, 0–1: embeddings when ALT's ML service runs, else shared words (F1). */
export async function meaningSimilarity(ctx: Pick<Ctx, 'ml'>, a: string, b: string) {
  const vectors = ctx.ml ? await ctx.ml.embed([a.slice(0, 2000), b.slice(0, 2000)], 'passage') : null;
  if (vectors?.[0] && vectors[1]) {
    const [x, y] = vectors as [number[], number[]];
    const dot = x.reduce((n, v, i) => n + v * y[i]!, 0);
    const norm = Math.sqrt(x.reduce((n, v) => n + v * v, 0) * y.reduce((n, v) => n + v * v, 0)) || 1;
    // bge-small puts unrelated sentences near 0.3 and paraphrases above 0.85; stretch that range to 0–1.
    return Math.min(1, Math.max(0, (dot / norm - 0.3) / 0.55));
  }
  const [wa, wb] = [words(a), words(b)];
  if (!wa.size || !wb.size) return 0;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared === 0 ? 0 : (2 * shared) / (wa.size + wb.size);
}

/** Weight of meaning against style in an item's score (style needs enough of the owner's writing). */
const MEANING_WEIGHT = 0.7;

export async function requestEvaluation(ctx: Ctx, aiId: string, versionId: string, userId: string, q: pg.Pool | pg.PoolClient = ctx.db) {
  const version = await loadVersion(q, versionId);
  if (!version || version.ai_id !== aiId) throw new AppError(404, 'NOT_FOUND', 'Version not found.');
  if ((await countEvalItems(q, aiId)) === 0) throw new AppError(409, 'NO_EVALUATION_SET', 'Add questions with your own answers first.');
  const { rows } = await q.query<EvaluationRow>(`INSERT INTO core.ai_evaluations (ai_id, version_id, requested_by) VALUES ($1, $2, $3) RETURNING *`, [aiId, versionId, userId]);
  const job = await q.query<{ id: string }>(`INSERT INTO core.jobs (kind, payload) VALUES ('evaluate_version', $1) RETURNING id`, [{ evaluationId: rows[0]!.id }]);
  await q.query(`SELECT pg_notify('alt_jobs', $1)`, [job.rows[0]!.id]);
  return rows[0]!;
}

/** The evaluation job: the version answers every question; each answer is scored and moderated. */
export async function runEvaluation(ctx: Ctx, evaluationId: string) {
  const { rows } = await ctx.db.query<EvaluationRow>('SELECT * FROM core.ai_evaluations WHERE id = $1', [evaluationId]);
  const evaluation = rows[0];
  if (!evaluation || evaluation.status === 'completed' || evaluation.status === 'failed') return { skipped: true };
  const ai = await loadAi(ctx.db, evaluation.ai_id);
  if (!ai) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  await ctx.db.query(`UPDATE core.ai_evaluations SET status = 'running' WHERE id = $1`, [evaluation.id]);

  const profile = await profileFor(ctx, ai);
  const items: EvalItemScore[] = [];
  for (const item of await evalItems(ctx, ai.id)) {
    const reply = await respond(ctx, { ai, version: { id: evaluation.version_id }, channel: 'alter_chat', messages: [{ role: 'user', content: item.question }], callerUserId: evaluation.requested_by });
    const meaning = reply.flagged ? 0 : await meaningSimilarity(ctx, reply.text, item.answer);
    let style: number | null = null;
    if (!reply.flagged && profile.samples >= STYLE_MIN_SAMPLES) {
      const vector = profile.centroid && ctx.ml ? ((await ctx.ml.embed([reply.text.slice(0, STYLE_CHARS)], 'passage'))?.[0] ?? null) : null;
      style = styleScore(profile, reply.text, vector).score;
    }
    const score = style === null ? meaning : MEANING_WEIGHT * meaning + (1 - MEANING_WEIGHT) * style;
    const r3 = (n: number) => Number(n.toFixed(3));
    items.push({ itemId: item.id, question: item.question, reply: reply.text, meaning: r3(meaning), style: style === null ? null : r3(style), score: r3(score), flagged: reply.flagged });
  }
  const readiness = items.length ? Number(((items.reduce((n, i) => n + i.score, 0) / items.length) * 100).toFixed(2)) : 0;
  const safe = items.every((i) => !i.flagged);

  await tx(ctx.db, async (client) => {
    await client.query(`UPDATE core.ai_evaluations SET status = 'completed', readiness = $2, safe = $3, items = $4, completed_at = now() WHERE id = $1`, [evaluation.id, readiness, safe, JSON.stringify(items)]);
    await client.query('UPDATE core.ai_versions SET readiness = $2 WHERE id = $1', [evaluation.version_id, readiness]);
    await audit(client, { action: 'ai.version_evaluated', actorService: 'core', entityType: 'ai', entityId: ai.id, data: { versionId: evaluation.version_id, readiness, safe, questions: items.length } });
    await notify(client, {
      userId: ai.owner_id,
      category: 'ai',
      type: 'ai.version_evaluated',
      title: `${ai.name} scored ${Math.round(readiness)}% on your questions`,
      body: safe ? 'Compare its answers with yours, then approve it or train again.' : 'Some answers broke ALT’s safety rules. Train again before approving.',
      data: { aiId: ai.id, versionId: evaluation.version_id, readiness, safe },
      platform: 'alter',
      link: 'alter://readiness',
    });
  });
  return { readiness, safe };
}

export async function evaluationFailed(ctx: Ctx, evaluationId: string, error: Error) {
  await ctx.db.query(`UPDATE core.ai_evaluations SET status = 'failed', error = $2, completed_at = now() WHERE id = $1 AND status <> 'completed'`, [evaluationId, error.message.slice(0, 500)]);
}

export async function latestEvaluation(q: pg.Pool | pg.PoolClient, versionId: string) {
  const { rows } = await q.query<EvaluationRow>('SELECT * FROM core.ai_evaluations WHERE version_id = $1 ORDER BY created_at DESC LIMIT 1', [versionId]);
  return rows[0];
}

// ---------------------------------------------------------------- the owner's verdict

/** "It behaves like me" (approved) or "not yet" (rejected: train again). Only for trained versions. */
export async function setVerdict(ctx: Ctx, ai: AiRow, versionId: string, userId: string, approved: boolean, note: string | null, ip: string | null) {
  return tx(ctx.db, async (client) => {
    const version = await loadVersion(client, versionId);
    if (!version || version.ai_id !== ai.id) throw new AppError(404, 'NOT_FOUND', 'Version not found.');
    if (version.engine !== 'adapter') throw new AppError(409, 'VERSION_NOT_TRAINED', 'Only a trained version can be approved. Train your AI first.');
    const verdict = approved ? 'approved' : 'rejected';
    await client.query('UPDATE core.ai_versions SET owner_verdict = $2, owner_verdict_at = now(), owner_note = $3 WHERE id = $1', [version.id, verdict, note]);
    await client.query('UPDATE core.personal_ais SET owner_confirmed_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1', [ai.id, approved]);
    await audit(client, { action: approved ? 'ai.version_approved' : 'ai.version_rejected', actorUserId: userId, entityType: 'ai', entityId: ai.id, ip, data: { versionId: version.id, version: version.version_no } });
    return { versionId: version.id, version: version.version_no, verdict };
  });
}
