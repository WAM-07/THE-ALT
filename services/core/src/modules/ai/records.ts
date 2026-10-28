import type { Ctx } from '../../context.js';
import { textPdf } from '../../lib/pdf.js';
import { AppError } from '../../lib/errors.js';
import { parsePersona } from './persona.js';
import { CONSENT_SCOPES, CONSENT_TEXT, consentState, loadVersion, type AiRow } from './repo.js';

// ---------------------------------------------------------------- Module 8: the consent record

/** Every consent the owner gave or withdrew for this AI, in order, with the words they agreed to. */
export async function consentRecord(ctx: Ctx, ai: AiRow) {
  const { rows } = await ctx.db.query<{ id: string; user_id: string; scope: keyof typeof CONSENT_TEXT; granted: boolean; policy_version: string; ip: string | null; created_at: Date }>(
    'SELECT id, user_id, scope, granted, policy_version, host(ip) AS ip, created_at FROM core.consent_events WHERE ai_id = $1 ORDER BY id',
    [ai.id],
  );
  const now = await consentState(ctx.db, ai.id);
  return {
    ai: { id: ai.id, name: ai.name, handle: ai.handle },
    generatedAt: new Date().toISOString(),
    current: CONSENT_SCOPES.map((scope) => ({ scope, text: CONSENT_TEXT[scope], ...now[scope] })),
    events: rows.map((r) => ({ id: r.id, scope: r.scope, text: CONSENT_TEXT[r.scope], granted: r.granted, policyVersion: r.policy_version, ip: r.ip, at: r.created_at.toISOString() })),
  };
}

export function consentRecordPdf(record: Awaited<ReturnType<typeof consentRecord>>) {
  return textPdf([
    `Consent record: ${record.ai.name} (@${record.ai.handle})`,
    `AI ${record.ai.id} - generated ${record.generatedAt}`,
    '',
    'Now',
    ...record.current.map((c) => `  ${c.granted ? 'GIVEN    ' : 'NOT GIVEN'}  ${c.text}${c.at ? ` (since ${c.at.slice(0, 19)}Z, policy ${c.policyVersion})` : ''}`),
    '',
    'History (every change, as recorded by ALT)',
    ...record.events.map((e) => `  ${e.at.slice(0, 19)}Z  ${e.granted ? 'gave     ' : 'withdrew '} ${e.scope}  policy ${e.policyVersion}${e.ip ? `  from ${e.ip}` : ''}`),
  ]);
}

// ---------------------------------------------------------------- Module 6: what changed between two versions

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** What changed from version `from` to version `to`: persona, data (by fingerprint), memories and engine. */
export async function versionDiff(ctx: Ctx, ai: AiRow, fromId: string, toId: string) {
  const [a, b] = await Promise.all([loadVersion(ctx.db, fromId), loadVersion(ctx.db, toId)]);
  if (!a || !b || a.ai_id !== ai.id || b.ai_id !== ai.id) throw new AppError(404, 'NOT_FOUND', 'Version not found.');
  const [pa, pb] = [parsePersona(a.persona_config), parsePersona(b.persona_config)];
  const persona: { field: string; from: unknown; to: unknown; added?: string[]; removed?: string[] }[] = [];
  for (const key of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    const [x, y] = [(pa as Record<string, unknown>)[key], (pb as Record<string, unknown>)[key]];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    if (key === 'instructions') {
      persona.push({ field: key, from: x ? 'set' : null, to: y ? 'set' : null }); // private: never shown in full
    } else if (Array.isArray(x) || Array.isArray(y)) {
      persona.push({ field: key, from: x, to: y, added: list(y).filter((v) => !list(x).includes(v)), removed: list(x).filter((v) => !list(y).includes(v)) });
    } else {
      persona.push({ field: key, from: x, to: y });
    }
  }
  const files = (v: typeof a) => ((v.manifest as { data?: { datasets?: { sha256: string; kind: string; category: string }[] } }).data?.datasets ?? []);
  const [fa, fb] = [files(a), files(b)];
  const memories = (v: typeof a) => (v.manifest as { data?: { memories?: { count: number } } }).data?.memories?.count ?? v.memory_ids.length;
  return {
    from: { id: a.id, version: a.version_no, engine: a.engine, training: a.training_mode, readiness: a.readiness === null ? null : Number(a.readiness) },
    to: { id: b.id, version: b.version_no, engine: b.engine, training: b.training_mode, readiness: b.readiness === null ? null : Number(b.readiness) },
    persona,
    data: {
      added: fb.filter((d) => !fa.some((x) => x.sha256 === d.sha256)),
      removed: fa.filter((d) => !fb.some((x) => x.sha256 === d.sha256)),
      unchanged: fb.filter((d) => fa.some((x) => x.sha256 === d.sha256)).length,
    },
    memories: { from: memories(a), to: memories(b) },
    engineChanged: a.engine !== b.engine || a.training_mode !== b.training_mode || a.adapter_sha256 !== b.adapter_sha256,
  };
}
