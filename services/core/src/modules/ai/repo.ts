import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { Ctx } from '../../context.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';

type Q = pg.Pool | pg.PoolClient;

export interface AiRow {
  id: string;
  owner_id: string;
  creator_id: string;
  handle: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  category: string;
  status: 'draft' | 'training' | 'ready' | 'minting' | 'verified' | 'suspended' | 'retired';
  draft_config: Record<string, unknown>;
  current_version_id: string | null;
  royalty_bps: number;
  health_score: string;
  owner_confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VersionRow {
  id: string;
  ai_id: string;
  version_no: number;
  persona_config: Record<string, unknown>;
  base_model: string;
  dataset_ids: string[];
  memory_ids: string[];
  manifest: Record<string, unknown>;
  manifest_cid: string;
  manifest_sha256: string;
  onchain_tx_hash: string | null;
  created_at: Date;
  published_at: Date | null;
}

export const CONSENT_SCOPES = ['persona_training', 'third_party_processing', 'public_deployment', 'interaction_learning'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];
export const CONSENT_POLICY_VERSION = '2026-10-v1';

/** What each consent means, in the words shown to people (Module 8 FE-2). */
export const CONSENT_TEXT: Record<ConsentScope, string> = {
  persona_training: 'Use the information and files I add to build my personal AI.',
  third_party_processing: 'Send my messages and the relevant parts of my data to an external AI provider (Groq) to generate my AI’s replies.',
  public_deployment: 'When I choose to deploy my AI, it may appear on ALTERA and ALTAR under its own identity token.',
  interaction_learning: 'My AI may suggest things to remember from our chats; nothing is kept unless I approve it.',
};

export async function loadAi(q: Q, id: string, forUpdate = false) {
  const { rows } = await q.query<AiRow>(
    `SELECT * FROM core.personal_ais WHERE id = $1 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0];
}

/** The AI, if the caller owns it. 404 for strangers (no existence leak), 403 never needed. */
export async function requireOwnedAi(q: Q, userId: string, aiId: string, forUpdate = false) {
  const ai = await loadAi(q, aiId, forUpdate);
  if (!ai || ai.owner_id !== userId) throw notFound('AI');
  return ai;
}

export async function loadVersion(q: Q, id: string) {
  const { rows } = await q.query<VersionRow>('SELECT * FROM core.ai_versions WHERE id = $1', [id]);
  return rows[0];
}

export async function latestVersion(q: Q, aiId: string) {
  const { rows } = await q.query<VersionRow>('SELECT * FROM core.ai_versions WHERE ai_id = $1 ORDER BY version_no DESC LIMIT 1', [aiId]);
  return rows[0];
}

export async function consentState(q: Q, aiId: string) {
  const { rows } = await q.query<{ scope: ConsentScope; granted: boolean; created_at: Date; policy_version: string }>(
    `SELECT DISTINCT ON (scope) scope, granted, created_at, policy_version
       FROM core.consent_events WHERE ai_id = $1 ORDER BY scope, id DESC`,
    [aiId],
  );
  const state = Object.fromEntries(CONSENT_SCOPES.map((s) => [s, { granted: false, at: null as string | null, policyVersion: null as string | null }]));
  for (const r of rows) state[r.scope] = { granted: r.granted, at: r.created_at.toISOString(), policyVersion: r.policy_version };
  return state as Record<ConsentScope, { granted: boolean; at: string | null; policyVersion: string | null }>;
}

export async function requireConsent(q: Q, aiId: string, scope: ConsentScope) {
  const state = await consentState(q, aiId);
  if (!state[scope].granted) {
    throw new AppError(403, 'CONSENT_REQUIRED', `This needs your consent: "${CONSENT_TEXT[scope]}"`, { scope });
  }
}

export async function approvedMemories(q: Q, aiId: string, ids?: string[]) {
  const { rows } = await q.query<{ id: string; content: string }>(
    `SELECT id, content FROM core.ai_memories
      WHERE ai_id = $1 AND status = 'approved' AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY created_at`,
    [aiId, ids ?? null],
  );
  return rows;
}

// ---------------------------------------------------------------- dataset files (encrypted at rest)

const datasetPath = (ctx: Ctx, id: string) => path.resolve(ctx.config.storageDir, 'datasets', `${id}.enc`);

export async function writeDatasetFile(ctx: Ctx, id: string, bytes: Buffer) {
  await mkdir(path.dirname(datasetPath(ctx, id)), { recursive: true });
  await writeFile(datasetPath(ctx, id), encrypt(ctx.config.encryptionKey, bytes.toString('base64')));
  return `datasets/${id}.enc`;
}

export async function readDatasetFile(ctx: Ctx, id: string) {
  return Buffer.from(decrypt(ctx.config.encryptionKey, await readFile(datasetPath(ctx, id), 'utf8')), 'base64');
}

export async function removeDatasetFile(ctx: Ctx, id: string) {
  await rm(datasetPath(ctx, id), { force: true });
}

/** Text of processed dataset items (only text-like kinds are readable by the persona engine today). */
export async function datasetTexts(ctx: Ctx, q: Q, aiId: string, ids?: string[]) {
  const { rows } = await q.query<{ id: string; title: string }>(
    `SELECT id, title FROM core.datasets
      WHERE ai_id = $1 AND deleted_at IS NULL AND included AND is_processed
        AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY created_at`,
    [aiId, ids ?? null],
  );
  const out: { id: string; title: string; text: string }[] = [];
  for (const r of rows) {
    try {
      out.push({ id: r.id, title: r.title, text: (await readDatasetFile(ctx, r.id)).toString('utf8') });
    } catch {
      // A missing file must not break the AI; the item is simply skipped.
    }
  }
  return out;
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const words = (s: string) => new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)));
const STOP = new Set(['the', 'and', 'you', 'your', 'are', 'for', 'with', 'that', 'this', 'what', 'have', 'was', 'not', 'but', 'can', 'how', 'about']);

/**
 * Picks the passages of the owner's documents most related to the question (simple keyword overlap;
 * Module 9's RAG pipeline replaces this with embeddings after the 60% evaluation).
 */
export function retrieve(docs: { title: string; text: string }[], query: string, maxChars = 2400) {
  const q = words(query);
  const chunks: { text: string; score: number }[] = [];
  for (const d of docs) {
    for (const para of d.text.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/)) {
      const t = para.trim();
      if (t.length < 20) continue;
      const w = words(t);
      let score = 0;
      for (const x of q) if (w.has(x)) score++;
      if (score > 0) chunks.push({ text: `${d.title}: ${t.slice(0, 600)}`, score });
    }
  }
  chunks.sort((a, b) => b.score - a.score);
  const picked: string[] = [];
  let used = 0;
  for (const c of chunks) {
    if (used + c.text.length > maxChars) break;
    picked.push(c.text);
    used += c.text.length;
  }
  return picked;
}

export function assertMutable(ai: AiRow) {
  if (ai.status === 'minting') throw new AppError(409, 'AI_BUSY', 'Your AI is being deployed. Try again in a moment.');
  if (ai.status === 'suspended') throw forbidden('AI_SUSPENDED', 'This AI is suspended.');
}
