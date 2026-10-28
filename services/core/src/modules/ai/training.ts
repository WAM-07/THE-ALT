import type pg from 'pg';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit, canonical } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { countEvalItems, requestEvaluation } from './evaluation.js';
import { currentSnapshot, writeVersion, type VersionSnapshot } from './lifecycle.js';
import { parsePersona } from './persona.js';
import { approvedMemories, assertMutable, consentState, datasetTexts, loadAi, requireConsent } from './repo.js';

/**
 * Training (Module 9; owner's plan "the engine and the car", 2026-10-16). Training is the only way into
 * the ecosystem: only a trained version can be verified. A training freezes the consented data when it
 * starts, then either
 *  - runs ALT's SIMULATED training (TRAINING_MODE=simulated: development, tests, the demo): a short run of
 *    labelled checkpoints that trains no weights, said so in the version's manifest and in the apps; or
 *  - waits for a real trainer, which claims it through the trainer socket below (/internal/trainer),
 *    fetches the consented data, reports checkpoints, returns the adapter and deletes the data.
 */

export interface TrainingRow {
  id: string;
  ai_id: string;
  initiated_by: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  stage: string | null;
  mode: 'base' | 'cloud' | 'local' | 'simulated';
  persona_config: Record<string, unknown> | null;
  dataset_ids: string[];
  memory_ids: string[];
  base_model: string | null;
  checkpoints: Checkpoint[];
  claimed_by: string | null;
  lease_expires_at: Date | null;
  version_id: string | null;
  error_code: string | null;
  error_message: string | null;
  adapter_sha256: string | null;
  scores: Record<string, unknown> | null;
  data_deleted_at: Date | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface Checkpoint {
  stage: string;
  progress: number;
  step?: number;
  loss?: number;
  at: string;
}

/** How long a trainer may stay silent before its claim lapses and another trainer may take the job. */
const LEASE_MINUTES = 30;

export function trainingOut(j: TrainingRow) {
  return {
    id: j.id,
    status: j.status,
    mode: j.mode,
    simulated: j.mode === 'simulated',
    stage: j.stage,
    progress: j.progress,
    checkpoints: j.checkpoints,
    versionId: j.version_id,
    error: j.error_message,
    dataDeleted: Boolean(j.data_deleted_at),
    createdAt: j.created_at.toISOString(),
    completedAt: j.completed_at?.toISOString() ?? null,
  };
}

async function loadTraining(q: pg.Pool | pg.PoolClient, id: string) {
  const { rows } = await q.query<TrainingRow>('SELECT * FROM core.training_jobs WHERE id = $1', [id]);
  return rows[0];
}

const snapshotOf = (j: TrainingRow): VersionSnapshot => ({ persona: parsePersona(j.persona_config), datasetIds: j.dataset_ids, memoryIds: j.memory_ids });

/** Starts training the AI on its consented data as it is now. One training per AI at a time. */
export async function startTraining(ctx: Ctx, aiId: string, userId: string, ip: string | null) {
  const ai = await loadAi(ctx.db, aiId);
  if (!ai || ai.owner_id !== userId) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  assertMutable(ai);
  await requireConsent(ctx.db, ai.id, 'persona_training');
  const snap = await currentSnapshot(ctx.db, ai);
  const mode = ctx.config.training.mode === 'simulated' ? 'simulated' : 'cloud';

  try {
    return await tx(ctx.db, async (client) => {
      const { rows } = await client.query<TrainingRow>(
        `INSERT INTO core.training_jobs (ai_id, initiated_by, status, stage, mode, persona_config, dataset_ids, memory_ids, base_model)
         VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7, $8) RETURNING *`,
        [ai.id, userId, mode === 'simulated' ? 'starting' : 'waiting for a trainer', mode, snap.persona, snap.datasetIds, snap.memoryIds, ctx.llm.names[0] ?? null],
      );
      const job = rows[0]!;
      if (ai.status === 'draft') await client.query(`UPDATE core.personal_ais SET status = 'training' WHERE id = $1`, [ai.id]);
      if (mode === 'simulated') {
        const { rows: q } = await client.query<{ id: string }>(`INSERT INTO core.jobs (kind, payload) VALUES ('simulate_training', $1) RETURNING id`, [{ trainingJobId: job.id }]);
        await client.query(`SELECT pg_notify('alt_jobs', $1)`, [q[0]!.id]);
      }
      await audit(client, {
        action: 'ai.training_started',
        actorUserId: userId,
        entityType: 'ai',
        entityId: ai.id,
        ip,
        data: { trainingJobId: job.id, mode, datasets: snap.datasetIds.length, memories: snap.memoryIds.length },
      });
      return job;
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new AppError(409, 'TRAINING_IN_PROGRESS', 'Your AI is already training.');
    throw err;
  }
}

/** Closes a training with a new trained version (the adapter engine). */
async function finishTraining(ctx: Ctx, job: TrainingRow, adapter: { sha256: string; uri: string | null; readiness: number | null }) {
  const ai = await loadAi(ctx.db, job.ai_id);
  if (!ai) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  const mode = job.mode === 'base' ? 'cloud' : job.mode;
  const version = await writeVersion(
    ctx,
    ai,
    snapshotOf(job),
    { type: 'adapter', mode, jobId: job.id, adapterSha256: adapter.sha256, adapterUri: adapter.uri, readiness: adapter.readiness },
    job.id,
    job.initiated_by,
  );
  if ((await countEvalItems(ctx.db, ai.id)) > 0) await requestEvaluation(ctx, ai.id, version.id, job.initiated_by);
  return version;
}

async function failTrainingJob(ctx: Ctx, job: TrainingRow, code: string, message: string, actorService: string | null) {
  await tx(ctx.db, async (client) => {
    await client.query(
      `UPDATE core.training_jobs SET status = 'failed', error_code = $2, error_message = $3, completed_at = now() WHERE id = $1`,
      [job.id, code, message.slice(0, 500)],
    );
    await client.query(`UPDATE core.personal_ais SET status = 'draft' WHERE id = $1 AND status = 'training'`, [job.ai_id]);
    await audit(client, { action: 'ai.training_failed', actorUserId: actorService ? null : job.initiated_by, actorService, entityType: 'ai', entityId: job.ai_id, data: { trainingJobId: job.id, code } });
    const { rows } = await client.query<{ owner_id: string; name: string }>('SELECT owner_id, name FROM core.personal_ais WHERE id = $1', [job.ai_id]);
    if (rows[0]) {
      await notify(client, {
        userId: rows[0].owner_id,
        category: 'ai',
        type: 'ai.training_failed',
        title: `Training ${rows[0].name} did not finish`,
        body: 'Nothing changed. You can start the training again.',
        data: { aiId: job.ai_id, trainingJobId: job.id, code },
        platform: 'alter',
        link: 'alter://training',
      });
    }
  });
}

// ---------------------------------------------------------------- the simulated training (labelled stand-in)

const SIMULATED_STAGES = ['preparing your data', 'training (simulated)', 'evaluating (simulated)', 'saving the adapter (simulated)'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SIMULATED training: walks through labelled checkpoints over TRAINING_SIMULATED_SECONDS and trains no
 * weights. Its "adapter" is only a fingerprint of what it would have trained on, and the version's
 * manifest says "Simulated training". Listed under Known mocks in PROGRESS.md.
 */
export async function runSimulatedTraining(ctx: Ctx, trainingJobId: string) {
  const job = await loadTraining(ctx.db, trainingJobId);
  if (!job || job.mode !== 'simulated' || job.status === 'completed' || job.status === 'failed') return { skipped: true };
  await ctx.db.query(`UPDATE core.training_jobs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1`, [job.id]);
  const pause = (ctx.config.training.simulatedSeconds * 1000) / SIMULATED_STAGES.length;
  for (const [i, stage] of SIMULATED_STAGES.entries()) {
    const progress = Math.round(((i + 1) / (SIMULATED_STAGES.length + 1)) * 100);
    const point: Checkpoint = { stage, progress, step: i + 1, at: new Date().toISOString() };
    await ctx.db.query(`UPDATE core.training_jobs SET stage = $2, progress = $3, checkpoints = checkpoints || $4::jsonb WHERE id = $1`, [job.id, stage, progress, JSON.stringify([point])]);
    if (pause > 0) await sleep(pause);
  }
  const fingerprint = sha256(canonical({ simulated: true, trainingJob: job.id, persona: job.persona_config, datasets: job.dataset_ids, memories: job.memory_ids }));
  const version = await finishTraining(ctx, job, { sha256: fingerprint, uri: null, readiness: null });
  return { versionId: version.id };
}

export async function simulatedTrainingFailed(ctx: Ctx, trainingJobId: string, error: Error) {
  const job = await loadTraining(ctx.db, trainingJobId);
  if (job && job.status !== 'completed' && job.status !== 'failed') await failTrainingJob(ctx, job, 'SIMULATION_FAILED', error.message, 'core');
}

// ---------------------------------------------------------------- the trainer socket (/internal/trainer)

/** A trainer asks for work: the oldest waiting training, or one whose trainer went silent. */
export async function claimTraining(ctx: Ctx, trainer: string) {
  return tx(ctx.db, async (client) => {
    const { rows } = await client.query<TrainingRow>(
      `UPDATE core.training_jobs
          SET status = 'running', claimed_by = $1, claimed_at = now(), started_at = COALESCE(started_at, now()),
              lease_expires_at = now() + make_interval(mins => $2), stage = 'claimed by a trainer'
        WHERE id = (SELECT id FROM core.training_jobs
                     WHERE mode = 'cloud' AND data_deleted_at IS NULL
                       AND (status = 'queued' OR (status = 'running' AND lease_expires_at < now()))
                     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`,
      [trainer, LEASE_MINUTES],
    );
    const job = rows[0];
    if (!job) return null;
    await audit(client, { action: 'training.claimed', actorService: trainer, entityType: 'ai', entityId: job.ai_id, data: { trainingJobId: job.id } });
    return job;
  });
}

async function requireClaim(ctx: Ctx, jobId: string, trainer: string) {
  const job = await loadTraining(ctx.db, jobId);
  if (!job || job.mode !== 'cloud') throw new AppError(404, 'NOT_FOUND', 'Training not found.');
  if (job.status !== 'running' || job.claimed_by !== trainer) throw forbidden('NOT_YOUR_TRAINING', 'This training is not claimed by this trainer.');
  return job;
}

/**
 * The consented data of a claimed training, frozen when it started: the full persona, the documents
 * (decrypted) and the approved memories. If the owner has withdrawn consent since, the training fails.
 */
export async function exportTrainingData(ctx: Ctx, jobId: string, trainer: string) {
  const job = await requireClaim(ctx, jobId, trainer);
  if (!(await consentState(ctx.db, job.ai_id)).persona_training.granted) {
    await failTrainingJob(ctx, job, 'CONSENT_WITHDRAWN', 'The owner withdrew consent to train on their data.', trainer);
    throw forbidden('CONSENT_WITHDRAWN', 'The owner withdrew consent to train on their data.');
  }
  const [documents, memories] = await Promise.all([datasetTexts(ctx, ctx.db, job.ai_id, job.dataset_ids), approvedMemories(ctx.db, job.ai_id, job.memory_ids)]);
  await tx(ctx.db, (client) =>
    audit(client, { action: 'training.data_exported', actorService: trainer, entityType: 'ai', entityId: job.ai_id, data: { trainingJobId: job.id, documents: documents.length, memories: memories.length } }),
  );
  return {
    trainingJobId: job.id,
    aiId: job.ai_id,
    baseModel: job.base_model,
    persona: parsePersona(job.persona_config),
    documents: documents.map((d) => ({ title: d.title, text: d.text })),
    memories: memories.map((m) => m.content),
  };
}

export async function reportCheckpoint(ctx: Ctx, jobId: string, trainer: string, point: Omit<Checkpoint, 'at'>) {
  const job = await requireClaim(ctx, jobId, trainer);
  const entry: Checkpoint = { ...point, at: new Date().toISOString() };
  await ctx.db.query(
    `UPDATE core.training_jobs SET stage = $2, progress = $3, checkpoints = checkpoints || $4::jsonb, lease_expires_at = now() + make_interval(mins => $5) WHERE id = $1`,
    [job.id, point.stage, point.progress, JSON.stringify([entry]), LEASE_MINUTES],
  );
  return entry;
}

/** The trainer returns the adapter (its hash and where it is kept) and states that it deleted the data. */
export async function completeTraining(ctx: Ctx, jobId: string, trainer: string, result: { adapterSha256: string; adapterUri: string; scores?: Record<string, number>; dataDeleted: true }) {
  const job = await requireClaim(ctx, jobId, trainer);
  await tx(ctx.db, async (client) => {
    await client.query(`UPDATE core.training_jobs SET adapter_sha256 = $2, adapter_uri = $3, scores = $4, data_deleted_at = now(), claimed_by = $5 WHERE id = $1`, [
      job.id, result.adapterSha256, result.adapterUri, result.scores ?? null, trainer,
    ]);
    await audit(client, { action: 'training.adapter_returned', actorService: trainer, entityType: 'ai', entityId: job.ai_id, data: { trainingJobId: job.id, adapterSha256: result.adapterSha256, dataDeleted: true } });
  });
  const readiness = typeof result.scores?.readiness === 'number' ? result.scores.readiness : null;
  return finishTraining(ctx, job, { sha256: result.adapterSha256, uri: result.adapterUri, readiness });
}

export async function failTraining(ctx: Ctx, jobId: string, trainer: string, reason: { code: string; message: string }) {
  const job = await requireClaim(ctx, jobId, trainer);
  await failTrainingJob(ctx, job, reason.code, reason.message, trainer);
}

/** The AI's trainings, newest first. */
export async function listTrainings(q: pg.Pool, aiId: string) {
  const { rows } = await q.query<TrainingRow>(`SELECT * FROM core.training_jobs WHERE ai_id = $1 AND mode <> 'base' ORDER BY created_at DESC LIMIT 20`, [aiId]);
  return rows;
}

// ---------------------------------------------------------------- bring a trained AI (Module 9; owner's plan E4)

/** LoRA adapters for a 3–4B model are tens to a few hundred MB. */
export const MAX_ADAPTER_BYTES = 512 * 1024 * 1024;

/** The file formats a LoRA adapter comes in: safetensors (an 8-byte header length, then JSON) or GGUF. */
export function adapterFormat(head: Buffer): 'safetensors' | 'gguf' | null {
  if (head.length >= 4 && head.subarray(0, 4).toString('latin1') === 'GGUF') return 'gguf';
  if (head.length >= 10) {
    const n = Number(head.readBigUInt64LE(0));
    if (n > 1 && n < 100_000_000 && head[8] === 0x7b /* { */) return 'safetensors';
  }
  return null;
}

/**
 * An adapter the owner trained on their own GPU: stored by ALT under its fingerprint, then it becomes a
 * trained version ("trained locally") that goes through the same checks as one ALT trained: readiness
 * on the owner's questions, safety, the owner's approval.
 */
export async function importLocalAdapter(
  ctx: Ctx,
  aiId: string,
  userId: string,
  adapter: { path: string; sha256: string; format: 'safetensors' | 'gguf'; sizeBytes: number; baseModel: string | null },
  ip: string | null,
) {
  const ai = await loadAi(ctx.db, aiId);
  if (!ai || ai.owner_id !== userId) throw new AppError(404, 'NOT_FOUND', 'AI not found.');
  assertMutable(ai);
  await requireConsent(ctx.db, ai.id, 'persona_training');
  const snap = await currentSnapshot(ctx.db, ai);
  const uri = `alt://adapters/${adapter.sha256}.${adapter.format}`;
  const job = await tx(ctx.db, async (client) => {
    const { rows } = await client.query<TrainingRow>(
      `INSERT INTO core.training_jobs (ai_id, initiated_by, status, stage, mode, persona_config, dataset_ids, memory_ids, base_model, started_at, adapter_sha256, adapter_uri, scores)
       VALUES ($1, $2, 'running', 'checking the adapter', 'local', $3, $4, $5, $6, now(), $7, $8, $9) RETURNING *`,
      [ai.id, userId, snap.persona, snap.datasetIds, snap.memoryIds, adapter.baseModel, adapter.sha256, uri, { format: adapter.format, sizeBytes: adapter.sizeBytes }],
    );
    await audit(client, {
      action: 'ai.adapter_imported',
      actorUserId: userId,
      entityType: 'ai',
      entityId: ai.id,
      ip,
      data: { trainingJobId: rows[0]!.id, adapterSha256: adapter.sha256, format: adapter.format, sizeBytes: adapter.sizeBytes, baseModel: adapter.baseModel },
    });
    return rows[0]!;
  });
  return { job, version: await finishTraining(ctx, job, { sha256: adapter.sha256, uri, readiness: null }) };
}
