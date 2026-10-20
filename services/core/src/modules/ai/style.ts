import { readFileSync } from 'node:fs';
import type { Ctx } from '../../context.js';
import { chunk, consentState, datasetTexts, type AiRow } from './repo.js';

/**
 * Style match, "sounds like you" (Modules 9 and 7): how likely it is that the person an AI represents wrote a
 * text, from a profile of their own writing. A baseline until the personal adapter: logistic regression over
 * thirteen writing-style features and the meaning similarity from ALT's embedding model, trained and evaluated by
 * services/ml/train_style.py (weights in style-model.json; results in docs/report-log/ml-models.md). Without the
 * ML service the style-only weights are used.
 */
interface Weights {
  coef: number[];
  intercept: number;
}
const MODEL = JSON.parse(readFileSync(new URL('./style-model.json', import.meta.url), 'utf8')) as {
  chars: number; // texts are cut to this many characters, as in training
  features: string[];
  scale: number[];
  withMeaning: Weights;
  styleOnly: Weights;
};

export const STYLE_CHARS = MODEL.chars;

// Fewer samples than this and the score is not shown (see the profile-size results in ml-models.md).
export const STYLE_MIN_SAMPLES = 5;

const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;
const LETTER = /\p{L}/u;
const SENTENCE_END = /[.!?…]+(?:\s+|$)|\n+/u;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself', 'im', "i'm"]);
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

/** The thirteen features, exactly as train_style.py computes them (checked by test/style.test.ts). */
export function styleFeatures(t: string): number[] {
  const words = t.match(WORD) ?? [];
  const w = Math.max(words.length, 1);
  const sentences = t.split(SENTENCE_END).filter((s) => LETTER.test(s));
  const s = Math.max(sentences.length, 1);
  const letters = count(t, /\p{L}/gu);
  const bare = words.map((x) => x.replace(/['’]/g, ''));
  return [
    bare.reduce((n, x) => n + [...x].length, 0) / w,
    words.length / s,
    count(t, /,/g) / w,
    count(t, /!/g) / w,
    count(t, /\?/g) / w,
    count(t, /\.\.\.|…/g) / w,
    count(t, EMOJI) / w,
    count(t, /\p{Lu}/gu) / Math.max(letters, 1),
    words.filter((x) => FIRST_PERSON.has(x.toLowerCase().replace(/’/g, "'"))).length / w,
    words.filter((x) => /['’]/.test(x)).length / w,
    sentences.filter((x) => /\p{Ll}/u.test(x.match(LETTER)![0])).length / s,
    bare.filter((x) => [...x].length >= 7).length / w,
    count(t, /\p{Nd}/gu) / Math.max([...t].length, 1),
  ];
}

export interface StyleProfile {
  samples: number;
  mean: number[];
  centroid: number[] | null;
}

/** A profile from samples of a person's writing: mean features, and the centroid of their meaning vectors. */
export async function buildProfile(ctx: Pick<Ctx, 'ml'>, samples: string[]): Promise<StyleProfile> {
  const feats = samples.map((x) => styleFeatures(x.slice(0, MODEL.chars)));
  const mean = MODEL.features.map((_, i) => feats.reduce((n, f) => n + f[i]!, 0) / Math.max(feats.length, 1));
  const vectors = ctx.ml && samples.length ? await ctx.ml.embed(samples.map((x) => x.slice(0, MODEL.chars)), 'passage') : null;
  let centroid: number[] | null = null;
  if (vectors?.length) {
    const sum = vectors[0]!.map((_, i) => vectors.reduce((n, v) => n + v[i]!, 0));
    const norm = Math.hypot(...sum) || 1;
    centroid = sum.map((x) => x / norm);
  }
  return { samples: samples.length, mean, centroid };
}

/** Probability (0..1) that the profile's author wrote the text. */
export function styleScore(profile: StyleProfile, text: string, textVector: number[] | null) {
  const f = styleFeatures(text.slice(0, MODEL.chars));
  const x = f.map((v, i) => Math.abs(v - profile.mean[i]!) / MODEL.scale[i]!);
  const useMeaning = Boolean(profile.centroid && textVector);
  if (useMeaning) x.push(textVector!.reduce((n, v, i) => n + v * profile.centroid![i]!, 0));
  const w = useMeaning ? MODEL.withMeaning : MODEL.styleOnly;
  const z = w.intercept + x.reduce((n, v, i) => n + v * w.coef[i]!, 0);
  return { score: 1 / (1 + Math.exp(-z)), withMeaning: useMeaning };
}

/**
 * How the person the AI represents (its creator) writes: their own messages in its test chats (with the
 * persona-training consent) and the AI's "communication style" items, newest first, at most 40.
 */
export async function writingSamples(ctx: Ctx, ai: AiRow) {
  const consent = await consentState(ctx.db, ai.id);
  if (!consent.persona_training.granted) return [];
  const { rows } = await ctx.db.query<{ content: string }>(
    `SELECT m.content FROM core.chat_messages m JOIN core.chat_sessions s ON s.id = m.session_id
      WHERE s.ai_id = $1 AND s.user_id = $2 AND m.role = 'user' AND NOT m.flagged AND length(m.content) >= 20
      ORDER BY m.id DESC LIMIT 40`,
    [ai.id, ai.creator_id],
  );
  const { rows: styleItems } = await ctx.db.query<{ id: string }>(
    `SELECT id FROM core.datasets WHERE ai_id = $1 AND training_category = 'communication_style' AND deleted_at IS NULL AND included`,
    [ai.id],
  );
  const items = styleItems.length ? await datasetTexts(ctx, ctx.db, ai.id, styleItems.map((r) => r.id)) : [];
  return [...items.flatMap((d) => chunk(d.text, 400, 0)), ...rows.map((r) => r.content)].slice(0, 40);
}

const cache = new Map<string, { key: string; profile: StyleProfile }>();

/** The AI's style profile, rebuilt only when its samples change. */
export async function profileFor(ctx: Ctx, ai: AiRow) {
  const samples = await writingSamples(ctx, ai);
  const key = `${samples.length}:${samples[samples.length - 1]?.length ?? 0}:${samples[0] ?? ''}`;
  const hit = cache.get(ai.id);
  if (hit && hit.key === key && (hit.profile.centroid || !ctx.ml)) return hit.profile;
  const profile = await buildProfile(ctx, samples);
  if (cache.size > 500) cache.clear();
  cache.set(ai.id, { key, profile });
  return profile;
}

/** "Sounds like you" for one of the AI's replies; null until there are enough samples of the person's writing. */
export async function styleMatch(ctx: Ctx, ai: AiRow, reply: string) {
  const profile = await profileFor(ctx, ai);
  if (profile.samples < STYLE_MIN_SAMPLES || !reply.trim()) return null;
  const vector = profile.centroid && ctx.ml ? ((await ctx.ml.embed([reply.slice(0, MODEL.chars)], 'passage'))?.[0] ?? null) : null;
  const { score, withMeaning } = styleScore(profile, reply, vector);
  return { score: Number(score.toFixed(3)), samples: profile.samples, basis: withMeaning ? 'style+meaning' : 'style' };
}

/** Readable comparison for the owner: how they write and how the AI writes, on the features people notice. */
export function describe(mean: number[]) {
  const per100 = (i: number) => Number((mean[i]! * 100).toFixed(1));
  return {
    wordsPerSentence: Number(mean[1]!.toFixed(1)),
    exclamationsPer100Words: per100(3),
    questionsPer100Words: per100(4),
    emojiPer100Words: per100(6),
    capitalLettersPct: per100(7),
    contractionsPer100Words: per100(9),
  };
}
