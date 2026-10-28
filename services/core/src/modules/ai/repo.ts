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
  is_demo: boolean;
  ai_messages: 'verified' | 'off';
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
  engine: 'base' | 'adapter';
  training_mode: 'cloud' | 'local' | 'simulated' | null;
  training_job_id: string | null;
  adapter_sha256: string | null;
  adapter_uri: string | null;
  readiness: string | null;
  owner_verdict: 'approved' | 'rejected' | null;
  owner_verdict_at: Date | null;
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
  await rm(datasetTextPath(ctx, id), { force: true });
}

// The text extracted from a document (a PDF), encrypted at rest next to the file.
const datasetTextPath = (ctx: Ctx, id: string) => path.resolve(ctx.config.storageDir, 'datasets', `${id}.txt.enc`);

export async function writeDatasetText(ctx: Ctx, id: string, text: string) {
  await mkdir(path.dirname(datasetTextPath(ctx, id)), { recursive: true });
  await writeFile(datasetTextPath(ctx, id), encrypt(ctx.config.encryptionKey, Buffer.from(text, 'utf8').toString('base64')));
}

export async function readDatasetText(ctx: Ctx, id: string) {
  return Buffer.from(decrypt(ctx.config.encryptionKey, await readFile(datasetTextPath(ctx, id), 'utf8')), 'base64').toString('utf8');
}

/**
 * The readable text of the AI's items: text files as written, and documents (PDFs) through the text
 * extracted when they were uploaded. Images, voice notes and documents without text are skipped, so
 * raw bytes never reach the AI.
 */
export async function datasetTexts(ctx: Ctx, q: Q, aiId: string, ids?: string[]) {
  const { rows } = await q.query<{ id: string; title: string; kind: string }>(
    `SELECT id, title, kind FROM core.datasets
      WHERE ai_id = $1 AND deleted_at IS NULL AND included AND text_chars > 0
        AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      ORDER BY created_at`,
    [aiId, ids ?? null],
  );
  const out: { id: string; title: string; text: string }[] = [];
  for (const r of rows) {
    try {
      const text = r.kind === 'text' ? (await readDatasetFile(ctx, r.id)).toString('utf8') : await readDatasetText(ctx, r.id);
      out.push({ id: r.id, title: r.title, text });
    } catch {
      // A missing file must not break the AI; the item is simply skipped.
    }
  }
  return out;
}

/** Text pulled out of a document at upload (PDF), or null when there is none to read. */
export async function extractDocumentText(bytes: Buffer, mimeType: string | null): Promise<string | null> {
  if (mimeType !== 'application/pdf') return null;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = (Array.isArray(text) ? text.join('\n\n') : text).replace(/[ \t]+\n/g, '\n').trim();
    return clean.length ? clean : null;
  } catch {
    // A damaged or scanned PDF is kept, just not read.
    return null;
  }
}

// ---------------------------------------------------------------- retrieval (BM25)

const STOP = new Set([
  'the', 'and', 'you', 'your', 'are', 'for', 'with', 'that', 'this', 'what', 'have', 'was', 'not', 'but', 'can', 'how', 'about',
  'from', 'they', 'their', 'there', 'them', 'will', 'would', 'should', 'could', 'into', 'than', 'then', 'also', 'just', 'like',
  'when', 'where', 'which', 'who', 'why', 'all', 'any', 'one', 'our', 'out', 'has', 'had', 'his', 'her', 'she', 'him', 'its',
]);

/** Words of a text, lower-cased and lightly stemmed ("studying", "studies" and "study" meet). */
export function terms(s: string) {
  const out: string[] = [];
  for (const raw of s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (STOP.has(raw)) continue;
    let w = raw;
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

/** Splits a document into overlapping passages of about `size` characters, on sentence ends. */
export function chunk(text: string, size = 600, overlap = 120) {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length + 1 > size) {
      chunks.push(current.trim());
      current = current.slice(-overlap);
    }
    current += (current ? ' ' : '') + s;
    while (current.length > size * 1.5) {
      chunks.push(current.slice(0, size).trim());
      current = current.slice(size - overlap);
    }
  }
  if (current.trim().length >= 20) chunks.push(current.trim());
  return chunks;
}

/** The passages of an AI's items, as retrieval sees them ("Title: passage"), item by item. */
export function passagesOf(docs: { title: string; text: string }[]) {
  return docs.map((d) => chunk(d.text).map((text) => `${d.title}: ${text}`));
}

/** Okapi BM25 score of each passage for the query (k1 1.2, b 0.75); 0 when it shares no word with it. */
export function bm25(passages: string[], query: string): number[] {
  const docs = passages.map((p) => terms(p));
  const q = [...new Set(terms(query))];
  if (!docs.length || !q.length) return docs.map(() => 0);
  const N = docs.length;
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / N || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.2;
  const b = 0.75;
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen));
    }
    return score;
  });
}

/** Takes passages in the given order until the character budget is used. */
export function withinBudget(passages: string[], maxChars: number) {
  const picked: string[] = [];
  let used = 0;
  for (const p of passages) {
    if (used + p.length > maxChars) break;
    picked.push(p);
    used += p.length;
  }
  return picked;
}

/**
 * Picks the passages of the owner's documents most related to the question, ranked with BM25 (the
 * scoring search engines use: rare words count more, long passages are not favoured). Everything
 * is sent when it fits, since a question may share no word with the answer ("What do I enjoy?" vs
 * "I love Flutter"). With ALT's ML service, `retrieveSemantic` (semantic.ts) adds meaning to the ranking.
 */
export function retrieve(docs: { title: string; text: string }[], query: string, maxChars = 2400) {
  const whole = docs.map((d) => `${d.title}: ${d.text.trim()}`);
  if (whole.reduce((n, t) => n + t.length, 0) <= maxChars) return whole;
  const passages = passagesOf(docs).flat();
  const scores = bm25(passages, query);
  const ranked = passages
    .map((text, i) => ({ text, score: scores[i]! }))
    .filter((p) => p.score > 0)
    .sort((x, y) => y.score - x.score);
  return withinBudget(ranked.map((p) => p.text), maxChars);
}

export function assertMutable(ai: AiRow) {
  if (ai.status === 'minting') throw new AppError(409, 'AI_BUSY', 'Your AI is being deployed. Try again in a moment.');
  if (ai.status === 'suspended') throw forbidden('AI_SUSPENDED', 'This AI is suspended.');
}
