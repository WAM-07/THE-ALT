import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { sha256 } from '../../lib/crypto.js';
import type { MlClient } from '../../lib/ml.js';
import { parsePersona } from './persona.js';
import { bm25, passagesOf, retrieve, withinBudget, type AiRow } from './repo.js';

/**
 * Semantic search (Modules 10 and 11) with the sentence-embedding model in ALT's ML service
 * (BAAI/bge-small-en-v1.5). Vectors are stored, never passages: an AI's text stays encrypted with its item.
 * Without the ML service everything falls back to BM25 and the ALT search it replaces.
 */
export const EMBED_MODEL = 'BAAI/bge-small-en-v1.5';
// Weight of BM25's word score (scaled to 0..1) added to the meaning score, chosen on SciFact's train claims
// (services/ml/evaluate_search.py; docs/report-log/ml-models.md).
export const HYBRID_BM25_WEIGHT = 0.1;

/** Cosine similarity; the service returns unit-length vectors, so this is their dot product. */
export function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * (b[i] ?? 0);
  return s;
}

async function embedAll(ml: MlClient, texts: string[], kind: 'passage' | 'query') {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const v = await ml.embed(texts.slice(i, i + 32), kind);
    if (!v || v.length !== Math.min(32, texts.length - i)) return null;
    out.push(...v);
  }
  return out;
}

/** Meaning score plus BM25 (scaled to 0..1), for each passage. */
export function hybridScores(passages: string[], vectors: number[][], queryVector: number[], query: string) {
  const words = bm25(passages, query);
  const top = Math.max(0, ...words);
  return passages.map((_, i) => cosine(vectors[i]!, queryVector) + (top > 0 ? (HYBRID_BM25_WEIGHT * words[i]!) / top : 0));
}

/** A vector for every passage of these items, embedding (and keeping) only passages that are new or changed. */
async function passageVectors(ctx: Ctx, ml: MlClient, docs: { id: string; title: string; text: string }[]) {
  const perDoc = passagesOf(docs);
  const { rows } = await ctx.db.query<{ dataset_id: string; chunk_no: number; text_sha256: string; embedding: number[] }>(
    'SELECT dataset_id, chunk_no, text_sha256, embedding FROM core.dataset_chunks WHERE dataset_id = ANY($1::uuid[]) AND model = $2',
    [docs.map((d) => d.id), EMBED_MODEL],
  );
  const known = new Map(rows.map((r) => [`${r.dataset_id}:${r.chunk_no}`, r]));
  const all = docs.flatMap((d, di) => perDoc[di]!.map((text, n) => ({ datasetId: d.id, n, text, sha: sha256(text) })));
  const stale = all.filter((p) => known.get(`${p.datasetId}:${p.n}`)?.text_sha256 !== p.sha);
  if (stale.length) {
    const fresh = await embedAll(ml, stale.map((p) => p.text), 'passage');
    if (!fresh) return null;
    await tx(ctx.db, async (client) => {
      for (const [i, p] of stale.entries()) {
        await client.query(
          `INSERT INTO core.dataset_chunks (dataset_id, chunk_no, text_sha256, model, embedding) VALUES ($1, $2, $3, $4, $5::real[])
           ON CONFLICT (dataset_id, chunk_no) DO UPDATE SET text_sha256 = EXCLUDED.text_sha256, model = EXCLUDED.model, embedding = EXCLUDED.embedding, created_at = now()`,
          [p.datasetId, p.n, p.sha, EMBED_MODEL, fresh[i]],
        );
        known.set(`${p.datasetId}:${p.n}`, { dataset_id: p.datasetId, chunk_no: p.n, text_sha256: p.sha, embedding: fresh[i]! });
      }
      for (const [di, d] of docs.entries()) {
        await client.query('DELETE FROM core.dataset_chunks WHERE dataset_id = $1 AND chunk_no >= $2', [d.id, perDoc[di]!.length]);
      }
    });
  }
  return all.map((p) => ({ text: p.text, vector: known.get(`${p.datasetId}:${p.n}`)!.embedding }));
}

/** Embeds new items' passages ahead of their first use (upload), so the first chat is not slower. Best effort. */
export async function indexItems(ctx: Ctx, docs: { id: string; title: string; text: string }[]) {
  if (!ctx.ml || !docs.length) return;
  try {
    await passageVectors(ctx, ctx.ml, docs);
  } catch {
    // Retrieval embeds whatever is missing later.
  }
}

/**
 * The passages of the owner's items most related to the question, by meaning and words together, so "What do
 * I enjoy?" finds "I love Flutter". Same contract as `retrieve` (everything when it fits), which it falls back to.
 */
export async function retrieveSemantic(ctx: Ctx, docs: { id: string; title: string; text: string }[], query: string, maxChars = 2400) {
  const whole = docs.map((d) => `${d.title}: ${d.text.trim()}`);
  if (whole.reduce((n, t) => n + t.length, 0) <= maxChars || !ctx.ml || !query.trim()) return retrieve(docs, query, maxChars);
  const [passages, q] = await Promise.all([passageVectors(ctx, ctx.ml, docs), ctx.ml.embed([query], 'query')]);
  if (!passages?.length || !q?.[0]) return retrieve(docs, query, maxChars);
  const texts = passages.map((p) => p.text);
  const scores = hybridScores(texts, passages.map((p) => p.vector), q[0], query);
  const ranked = texts.map((text, i) => ({ text, score: scores[i]! })).sort((x, y) => y.score - x.score);
  return withinBudget(ranked.map((p) => p.text), maxChars);
}

/** What "find an AI like..." compares against: the AI's public description and published persona. */
export function searchTextOf(ai: Pick<AiRow, 'name' | 'category' | 'description'>, personaConfig: unknown) {
  const p = parsePersona(personaConfig);
  return [
    `${ai.name}, ${ai.category}.`,
    ai.description ?? '',
    p.about,
    p.traits.length ? `Personality: ${p.traits.join(', ')}.` : '',
    p.interests.length ? `Interests: ${p.interests.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// A verified AI is a match when its meaning score is at least AI_MATCH_MIN and within AI_MATCH_WITHIN of the
// best one: bge scores unrelated texts around 0.4-0.55, so a fixed cut alone is unreliable (ml-models.md).
export const AI_MATCH_MIN = 0.55;
export const AI_MATCH_WITHIN = 0.06;

/**
 * Verified AIs ranked by how well they match a description ("someone who helps with Flutter"), with their
 * scores; null when the ML service is unavailable (callers then use the text search).
 */
export async function searchAis(ctx: Ctx, query: string, limit: number) {
  if (!ctx.ml) return null;
  const { rows } = await ctx.db.query<AiRow & { persona_config: unknown; text_sha256: string | null; embedding: number[] | null }>(
    `SELECT a.*, v.persona_config, s.text_sha256, s.embedding
       FROM core.personal_ais a
       LEFT JOIN core.ai_versions v ON v.id = a.current_version_id
       LEFT JOIN core.ai_search_vectors s ON s.ai_id = a.id AND s.model = $1
      WHERE a.status = 'verified' AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC LIMIT 1000`,
    [EMBED_MODEL],
  );
  const texts = rows.map((ai) => searchTextOf(ai, ai.persona_config ?? ai.draft_config));
  const stale = rows.map((ai, i) => ({ ai, text: texts[i]!, sha: sha256(texts[i]!) })).filter((s) => s.ai.text_sha256 !== s.sha || !s.ai.embedding);
  if (stale.length) {
    const fresh = await embedAll(ctx.ml, stale.map((s) => s.text), 'passage');
    if (!fresh) return null;
    await tx(ctx.db, async (client) => {
      for (const [i, s] of stale.entries()) {
        await client.query(
          `INSERT INTO core.ai_search_vectors (ai_id, text_sha256, model, embedding) VALUES ($1, $2, $3, $4::real[])
           ON CONFLICT (ai_id) DO UPDATE SET text_sha256 = EXCLUDED.text_sha256, model = EXCLUDED.model, embedding = EXCLUDED.embedding, updated_at = now()`,
          [s.ai.id, s.sha, EMBED_MODEL, fresh[i]],
        );
        s.ai.embedding = fresh[i]!;
      }
    });
  }
  const q = (await ctx.ml.embed([query], 'query'))?.[0];
  if (!q) return null;
  const scored = rows.map((ai) => ({ ai, score: cosine(ai.embedding!, q) })).sort((x, y) => y.score - x.score);
  const best = scored[0]?.score ?? 0;
  return scored.filter((m) => m.score >= AI_MATCH_MIN && m.score >= best - AI_MATCH_WITHIN).slice(0, limit);
}
