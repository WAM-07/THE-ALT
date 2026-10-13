import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Ctx } from '../context.js';
import { badRequest } from './errors.js';
import { isTrustedMediaUrl } from './media.js';

/**
 * ALT's ready-made profile pictures (built by scripts/make-avatars.mjs into public/avatars). People
 * and AIs have separate sets so they are easy to tell apart, and anyone who hasn't chosen a picture
 * gets one of these instead of a blank circle.
 */
export type AvatarKind = 'human' | 'ai';

interface PresetSet {
  kind: AvatarKind;
  id: string;
  name: string;
  credit: string;
  files: string[];
}

export const AVATAR_DIR = new URL('../../public/avatars/', import.meta.url);
const SETS: PresetSet[] = (JSON.parse(readFileSync(new URL('manifest.json', AVATAR_DIR), 'utf8')) as { sets: PresetSet[] }).sets;

/** The colourful sets new accounts and AIs are given from (the line-art sets are opt-in). */
const DEFAULT_SETS: Record<AvatarKind, string[]> = { human: ['chibi', 'adventurer', 'big-smile'], ai: ['mecha', 'androids', 'cores', 'bottts'] };

export const presetPath = (kind: AvatarKind, set: string, file: string) => `/core/avatars/${kind}/${set}/${file}`;
const presetUrl = (ctx: Ctx, kind: AvatarKind, set: string, file: string) => `${ctx.config.publicUrl}${presetPath(kind, set, file)}`;

/** True if this kind/set/file is one of the ready-made pictures (used to serve files safely). */
export function isPresetFile(kind: string, set: string, file: string) {
  return SETS.some((s) => s.kind === kind && s.id === set && s.files.includes(file));
}

export function presetSets(ctx: Ctx, kind?: AvatarKind) {
  return SETS.filter((s) => !kind || s.kind === kind).map((s) => ({
    kind: s.kind,
    id: s.id,
    name: s.name,
    credit: s.credit,
    pictures: s.files.map((f) => presetUrl(ctx, s.kind, s.id, f)),
  }));
}

/** The ready-made picture someone gets until they choose one: stable for the same id. */
export function defaultAvatar(ctx: Ctx, kind: AvatarKind, id: string) {
  const pool = SETS.filter((s) => s.kind === kind && DEFAULT_SETS[kind].includes(s.id)).flatMap((s) => s.files.map((f) => [s.id, f] as const));
  const n = createHash('sha256').update(id).digest().readUInt32BE(0);
  const [set, file] = pool[n % pool.length]!;
  return presetUrl(ctx, kind, set, file);
}

/** Which ready-made picture a URL points at, or null if it isn't one. */
export function presetOf(ctx: Ctx, url: string) {
  const prefix = `${ctx.config.publicUrl}/core/avatars/`;
  if (!url.startsWith(prefix)) return null;
  const [kind, set, file, ...rest] = url.slice(prefix.length).split('/');
  if (rest.length || !kind || !set || !file || !isPresetFile(kind, set, file)) return { kind: null };
  return { kind: kind as AvatarKind };
}

/**
 * Checks a picture chosen for a person or an AI: it must be hosted by ALT (no tracking pixels), and a
 * ready-made one must come from that kind's sets, so people and AIs never look alike.
 */
export function checkAvatarUrl(ctx: Ctx, url: string, kind: AvatarKind) {
  if (!isTrustedMediaUrl(ctx, url)) throw badRequest('AVATAR_URL_NOT_ALLOWED', 'Upload the picture through an ALT app instead.');
  const preset = presetOf(ctx, url);
  if (preset && !preset.kind) throw badRequest('AVATAR_NOT_FOUND', 'That ready-made picture does not exist.');
  if (preset && preset.kind !== kind) {
    throw badRequest(
      'AVATAR_WRONG_SET',
      kind === 'human' ? 'That picture is one of the AI sets. Choose one made for people.' : 'That picture is one of the people sets. Choose one made for AIs.',
    );
  }
}
