import type pg from 'pg';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit, canonical } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { countEvalItems, latestEvaluation } from './evaluation.js';
import { checkSafety } from './moderation.js';
import { parsePersona } from './persona.js';
import { approvedMemories, consentState, latestVersion, loadAi, requireConsent, type AiRow, type VersionRow } from './repo.js';

export const MANIFEST_SCHEMA = 'alt.ai-manifest/1';

/** What a version is built from: frozen when a build or a training starts. */
export interface VersionSnapshot {
  persona: ReturnType<typeof parsePersona>;
  datasetIds: string[];
  memoryIds: string[];
}

/** The engine that speaks for a version: the base model, or an adapter trained on the owner's data. */
export type VersionEngine =
  | { type: 'base' }
  | { type: 'adapter'; mode: 'cloud' | 'local' | 'simulated'; jobId: string; adapterSha256: string; adapterUri: string | null; readiness?: number | null };

/** The AI's consented data right now: the persona draft, included items and approved memories. */
export async function currentSnapshot(q: pg.Pool | pg.PoolClient, ai: AiRow): Promise<VersionSnapshot> {
  const { rows } = await q.query<{ id: string }>(
    `SELECT id FROM core.datasets WHERE ai_id = $1 AND deleted_at IS NULL AND included ORDER BY created_at`,
    [ai.id],
  );
  const memories = await approvedMemories(q, ai.id);
  return { persona: parsePersona(ai.draft_config), datasetIds: rows.map((r) => r.id), memoryIds: memories.map((m) => m.id) };
}

/**
 * Writes the next immutable version of an AI (Modules 6 and 9) from a snapshot: a public manifest that
 * contains only hashes (and which engine speaks for it) is pinned to IPFS, then the version is saved
 * and the job that produced it is closed, in one transaction.
 */
export async function writeVersion(ctx: Ctx, ai: AiRow, snap: VersionSnapshot, engine: VersionEngine, jobId: string, userId: string) {
  const { rows: datasets } = await ctx.db.query<{ id: string; sha256: string; kind: string; training_category: string; size_bytes: string }>(
    `SELECT id, sha256, kind, training_category, size_bytes FROM core.datasets WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
    [snap.datasetIds],
  );
  const memories = await approvedMemories(ctx.db, ai.id, snap.memoryIds);
  const previous = await latestVersion(ctx.db, ai.id);
  const versionNo = (previous?.version_no ?? 0) + 1;
  const { rows: wallets } = await ctx.db.query<{ address: string }>('SELECT address FROM core.wallets WHERE user_id = $1 AND is_primary', [ai.creator_id]);
  const { instructions, ...publicPersona } = snap.persona;
  const adapter = engine.type === 'adapter' ? engine : null;

  // Public and verifiable: no personal data, only hashes of it.
  const manifest = {
    schema: MANIFEST_SCHEMA,
    ai: { id: ai.id, handle: ai.handle, name: ai.name, category: ai.category },
    version: versionNo,
    parent: previous ? { version: previous.version_no, cid: previous.manifest_cid } : null,
    creator: { altUserId: ai.creator_id, wallet: wallets[0]?.address ?? null },
    baseModel: ctx.llm.names[0],
    engine: adapter
      ? {
          type: 'adapter',
          training: adapter.mode,
          adapterSha256: adapter.adapterSha256,
          // Said in the certificate itself, so nobody mistakes the stand-in for a trained model.
          ...(adapter.mode === 'simulated' ? { note: 'Simulated training: no model weights were trained.' } : {}),
        }
      : { type: 'base' },
    persona: publicPersona,
    personaSha256: sha256(canonical(snap.persona)),
    instructionsSha256: instructions ? sha256(instructions) : null,
    data: {
      datasets: datasets.map((d) => ({ sha256: d.sha256, kind: d.kind, category: d.training_category, sizeBytes: Number(d.size_bytes) })),
      memories: { count: memories.length, sha256: sha256(canonical(memories.map((m) => m.content))) },
    },
    createdAt: new Date().toISOString(),
  };
  const pinned = await ctx.ipfs.pinJson(`${ai.handle}-v${versionNo}`, manifest);

  return tx(ctx.db, async (client) => {
    const { rows } = await client.query<VersionRow>(
      `INSERT INTO core.ai_versions (ai_id, version_no, persona_config, base_model, dataset_ids, memory_ids, manifest, manifest_cid, manifest_sha256, created_by,
                                     engine, training_mode, training_job_id, adapter_sha256, adapter_uri, readiness)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [
        ai.id, versionNo, snap.persona, manifest.baseModel, datasets.map((d) => d.id), memories.map((m) => m.id), manifest, pinned.cid, pinned.sha256, userId,
        engine.type, adapter?.mode ?? null, adapter?.jobId ?? null, adapter?.adapterSha256 ?? null, adapter?.adapterUri ?? null, adapter?.readiness ?? null,
      ],
    );
    await client.query(`UPDATE core.datasets SET is_processed = true WHERE id = ANY($1::uuid[])`, [datasets.map((d) => d.id)]);
    await client.query(`UPDATE core.personal_ais SET status = 'ready' WHERE id = $1 AND status IN ('draft', 'training')`, [ai.id]);
    await client.query(
      `UPDATE core.training_jobs SET status = 'completed', stage = 'done', progress = 100, version_id = $2, completed_at = now() WHERE id = $1`,
      [jobId, rows[0]!.id],
    );
    await audit(client, {
      action: adapter ? 'ai.training_completed' : 'ai.version_built',
      actorUserId: userId,
      entityType: 'ai',
      entityId: ai.id,
      data: { version: versionNo, manifestCid: pinned.cid, engine: engine.type, training: adapter?.mode ?? null, datasets: datasets.length, memories: memories.length },
    });
    const title = adapter
      ? `${ai.name} finished ${adapter.mode === 'simulated' ? 'simulated ' : ''}training: version ${versionNo}`
      : `Version ${versionNo} of ${ai.name} is ready`;
    await notify(client, {
      userId: ai.owner_id,
      category: 'ai',
      type: adapter ? 'ai.training_completed' : 'ai.version_built',
      title,
      body: ai.status === 'verified' ? 'Publish it to update ALTERA and ALTAR.' : 'Finish the checks in ALTER to deploy it.',
      data: { aiId: ai.id, version: versionNo, manifestCid: pinned.cid, engine: engine.type },
      platform: 'alter',
      link: 'alter://training',
    });
    return rows[0]!;
  });
}

/**
 * Builds the next version from the current draft with the base engine (the persona and retrieval on the
 * base model, no training). It can be tested, but only a trained version can be verified (see training.ts).
 */
export async function buildVersion(ctx: Ctx, aiId: string, userId: string) {
  const ai = await loadAi(ctx.db, aiId);
  if (!ai) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  await requireConsent(ctx.db, ai.id, 'persona_training');

  const { rows: jobRows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO core.training_jobs (ai_id, initiated_by, status, stage, started_at, mode) VALUES ($1, $2, 'running', 'collecting', now(), 'base') RETURNING id`,
    [ai.id, userId],
  );
  const jobId = jobRows[0]!.id;
  try {
    const snap = await currentSnapshot(ctx.db, ai);
    await ctx.db.query(`UPDATE core.training_jobs SET stage = 'pinning manifest to IPFS', progress = 70 WHERE id = $1`, [jobId]);
    const version = await writeVersion(ctx, ai, snap, { type: 'base' }, jobId, userId);
    return { version, jobId };
  } catch (err) {
    await ctx.db.query(
      `UPDATE core.training_jobs SET status = 'failed', error_code = $2, error_message = $3, completed_at = now() WHERE id = $1`,
      [jobId, err instanceof AppError ? err.code : 'BUILD_FAILED', (err as Error).message.slice(0, 500)],
    );
    throw err;
  }
}

export interface ClearanceCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

/** The gate an AI must pass before it can get its identity token and appear on ALTERA and ALTAR. */
export async function clearance(ctx: Ctx, ai: AiRow) {
  const consents = await consentState(ctx.db, ai.id);
  const latest = await latestVersion(ctx.db, ai.id);
  const { rows: chats } = await ctx.db.query<{ n: string }>(
    `SELECT count(*) AS n FROM core.chat_messages m JOIN core.chat_sessions s ON s.id = m.session_id
      WHERE s.ai_id = $1 AND s.user_id = $2 AND m.role = 'user'`,
    [ai.id, ai.owner_id],
  );
  const { rows: wallet } = await ctx.db.query('SELECT 1 FROM core.wallets WHERE user_id = $1 AND is_primary', [ai.owner_id]);
  const persona = parsePersona(latest?.persona_config ?? ai.draft_config);
  const personaText = [persona.about, ...persona.traits, ...persona.interests, ...persona.boundaries, persona.instructions ?? '', ai.name, ai.description ?? ''].join('\n');
  const mod = await checkSafety(ctx.ml, personaText);
  const minChats = ctx.config.clearance.minTestMessages;
  const { minEvalItems, minReadiness } = ctx.config.clearance;
  const questions = await countEvalItems(ctx.db, ai.id);
  const evaluation = latest ? await latestEvaluation(ctx.db, latest.id) : undefined;
  const readiness = evaluation?.status === 'completed' ? Number(evaluation.readiness) : null;
  // ALT's system check: with questions written (or required), the latest version must have been evaluated
  // on them, reach the readiness threshold and give only safe answers.
  const systemCheck =
    questions === 0 && minEvalItems === 0
      ? { passed: true, detail: 'no questions required' }
      : questions < minEvalItems
        ? { passed: false, detail: `${questions} of ${minEvalItems} questions written` }
        : readiness === null
          ? { passed: false, detail: evaluation ? `evaluation ${evaluation.status}` : 'not evaluated yet' }
          : !evaluation!.safe
            ? { passed: false, detail: 'some answers broke the safety rules' }
            : { passed: readiness >= minReadiness, detail: `readiness ${Math.round(readiness)}%${minReadiness ? ` (needs ${minReadiness}%)` : ''}` };

  const checks: ClearanceCheck[] = [
    { id: 'consent_training', label: 'Consent to build the AI from your data', passed: consents.persona_training.granted },
    { id: 'consent_provider', label: 'Consent to use the external AI provider', passed: consents.third_party_processing.granted },
    { id: 'consent_deployment', label: 'Consent to appear on ALTERA and ALTAR', passed: consents.public_deployment.granted },
    { id: 'version_built', label: 'A version has been built', passed: Boolean(latest), detail: latest ? `v${latest.version_no}` : undefined },
    // Training is the only way in (owner, 2026-10-16): the version to verify must be a trained one.
    {
      id: 'trained',
      label: 'Its latest version was trained on your data',
      passed: latest?.engine === 'adapter',
      detail: latest?.engine === 'adapter' ? `${latest.training_mode} training` : latest ? 'not trained yet' : undefined,
    },
    { id: 'tested', label: `You tested it in at least ${minChats} chat messages`, passed: Number(chats[0]?.n ?? 0) >= minChats, detail: `${chats[0]?.n ?? 0} so far` },
    {
      id: 'ready',
      label: minEvalItems ? `ALT’s check: it answers your ${minEvalItems}+ questions well and safely` : 'ALT’s check: it answers your questions well and safely',
      passed: systemCheck.passed,
      detail: systemCheck.detail,
    },
    // The approval loop: the owner approves the latest version itself (training again needs a new approval).
    {
      id: 'owner_confirmed',
      label: 'You approved its latest version (it behaves like you)',
      passed: latest?.owner_verdict === 'approved',
      detail: latest?.owner_verdict === 'rejected' ? 'you asked to train again' : undefined,
    },
    { id: 'persona_safe', label: 'Its persona passes the safety check', passed: !mod.flagged, detail: mod.flagged ? mod.categories.join(', ') : undefined },
    { id: 'wallet', label: 'You have a wallet to hold its identity token', passed: wallet.length > 0 },
  ];
  return { passed: checks.every((c) => c.passed), checks, latestVersion: latest ? { id: latest.id, version: latest.version_no } : null };
}

/** Starts minting the AI's identity token (done by the job worker so the request returns at once). */
export async function requestDeploy(ctx: Ctx, aiId: string, userId: string, ip: string | null) {
  if (!ctx.chain) throw new AppError(503, 'CHAIN_DISABLED', 'The blockchain is not configured on this server.');
  const ai = await loadAi(ctx.db, aiId);
  if (!ai || ai.owner_id !== userId) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  if (ai.status === 'verified') throw new AppError(409, 'AI_ALREADY_VERIFIED', 'This AI already has its identity token. Publish a new version instead.');
  if (ai.status === 'minting') throw new AppError(409, 'AI_BUSY', 'Your AI is already being deployed.');
  const gate = await clearance(ctx, ai);
  if (!gate.passed) throw new AppError(409, 'CLEARANCE_FAILED', 'Your AI is not ready to deploy yet.', { checks: gate.checks.filter((c) => !c.passed) });

  return tx(ctx.db, async (client) => {
    const locked = await loadAi(client, aiId, true);
    if (locked?.status === 'minting' || locked?.status === 'verified') throw new AppError(409, 'AI_BUSY', 'Your AI is already being deployed.');
    await client.query(`UPDATE core.personal_ais SET status = 'minting' WHERE id = $1`, [aiId]);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO core.jobs (kind, payload) VALUES ('mint_ait', $1) RETURNING id`,
      [{ aiId, versionId: gate.latestVersion!.id }],
    );
    await audit(client, { action: 'ai.deploy_requested', actorUserId: userId, entityType: 'ai', entityId: aiId, ip, data: { version: gate.latestVersion!.version } });
    await client.query(`SELECT pg_notify('alt_jobs', $1)`, [rows[0]!.id]);
    return { jobId: rows[0]!.id, version: gate.latestVersion! };
  });
}

/** Publishes an already-built version of a verified AI on-chain. */
export async function requestPublish(ctx: Ctx, aiId: string, versionId: string, userId: string, ip: string | null) {
  if (!ctx.chain) throw new AppError(503, 'CHAIN_DISABLED', 'The blockchain is not configured on this server.');
  return tx(ctx.db, async (client: pg.PoolClient) => {
    const ai = await loadAi(client, aiId, true);
    if (!ai || ai.owner_id !== userId) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
    if (ai.status !== 'verified') throw new AppError(409, 'AI_NOT_VERIFIED', 'Deploy the AI first; then you can publish new versions.');
    const { rows } = await client.query<VersionRow>('SELECT * FROM core.ai_versions WHERE id = $1 AND ai_id = $2', [versionId, aiId]);
    const version = rows[0];
    if (!version) throw new AppError(404, 'NOT_FOUND', 'Version not found.');
    if (version.published_at) throw new AppError(409, 'VERSION_ALREADY_PUBLISHED', 'That version is already published.');
    if (version.engine !== 'adapter') throw new AppError(409, 'VERSION_NOT_TRAINED', 'Only a trained version can be published. Train your AI first.');
    const { rows: pending } = await client.query(`SELECT 1 FROM core.jobs WHERE kind = 'publish_version' AND status IN ('queued', 'running') AND payload->>'aiId' = $1`, [aiId]);
    if (pending.length) throw new AppError(409, 'AI_BUSY', 'A version is already being published.');
    const job = await client.query<{ id: string }>(`INSERT INTO core.jobs (kind, payload) VALUES ('publish_version', $1) RETURNING id`, [{ aiId, versionId }]);
    await audit(client, { action: 'ai.publish_requested', actorUserId: userId, entityType: 'ai', entityId: aiId, ip, data: { version: version.version_no } });
    await client.query(`SELECT pg_notify('alt_jobs', $1)`, [job.rows[0]!.id]);
    return { jobId: job.rows[0]!.id, version: { id: version.id, version: version.version_no } };
  });
}
