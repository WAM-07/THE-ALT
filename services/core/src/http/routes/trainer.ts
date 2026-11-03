import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { AppError } from '../../lib/errors.js';
import {
  adapterFormat,
  adapterUri,
  claimTraining,
  completeTraining,
  exportTrainingData,
  failTraining,
  MAX_ADAPTER_BYTES,
  reportCheckpoint,
  requireTrainerClaim,
} from '../../modules/ai/training.js';
import { requireService } from '../auth-guard.js';

const JobId = z.object({ id: z.uuid() });

/**
 * The trainer socket (Module 9): how ALT's trainer (services/ml, QLoRA on a GPU) takes work from Core.
 * Only ALT services with the service key; the trainer is named by the x-alt-service header and may act
 * only on trainings it claimed. Claim → fetch the consented data → checkpoints → adapter back, data deleted.
 */
export async function trainerRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const guard = requireService(ctx);
  // Adapters arrive as raw bytes (application/octet-stream), streamed to disk; only in this plugin.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  r.post('/internal/trainer/claim', { preHandler: guard, schema: { tags: ['internal'], summary: 'Take the oldest waiting training (204 when there is none)' } }, async (req, reply) => {
    const job = await claimTraining(ctx, req.service!);
    if (!job) return reply.status(204).send();
    return { id: job.id, aiId: job.ai_id, baseModel: job.base_model, dataUrl: `/internal/trainer/jobs/${job.id}/data`, leaseExpiresAt: job.lease_expires_at!.toISOString() };
  });

  r.get('/internal/trainer/jobs/:id/data', { preHandler: guard, schema: { tags: ['internal'], summary: 'The consented training data of a claimed training', params: JobId } }, async (req) =>
    exportTrainingData(ctx, req.params.id, req.service!),
  );

  r.post(
    '/internal/trainer/jobs/:id/checkpoints',
    {
      preHandler: guard,
      schema: {
        tags: ['internal'],
        summary: 'Report progress (also renews the claim)',
        params: JobId,
        body: z.object({ stage: z.string().min(1).max(80), progress: z.number().int().min(0).max(99), step: z.number().int().min(0).optional(), loss: z.number().finite().optional() }),
      },
    },
    async (req) => reportCheckpoint(ctx, req.params.id, req.service!, req.body),
  );

  r.post(
    '/internal/trainer/jobs/:id/adapter',
    {
      preHandler: guard,
      schema: { tags: ['internal'], summary: 'Upload the trained adapter (raw .safetensors or .gguf bytes); returns its fingerprint and alt:// address', params: JobId },
    },
    async (req, reply) => {
      await requireTrainerClaim(ctx, req.params.id, req.service!);
      const dir = join(ctx.config.storageDir, 'adapters');
      await mkdir(dir, { recursive: true });
      const tmp = join(dir, `trainer-${randomUUID()}`);
      const hash = createHash('sha256');
      let head = Buffer.alloc(0);
      let size = 0;
      const count = new Transform({
        transform(chunk: Buffer, _enc, next) {
          size += chunk.length;
          if (size > MAX_ADAPTER_BYTES) return next(new AppError(413, 'FILE_TOO_LARGE', 'Adapters can be up to 512 MB.'));
          hash.update(chunk);
          if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
          next(null, chunk);
        },
      });
      try {
        await pipeline(req.body as NodeJS.ReadableStream, count, createWriteStream(tmp));
        const format = adapterFormat(head);
        if (!format) throw new AppError(400, 'ADAPTER_FORMAT', 'That is not a .safetensors or .gguf adapter.');
        const sha = hash.digest('hex');
        await rename(tmp, join(dir, `${sha}.${format}`));
        return reply.status(201).send({ adapterSha256: sha, adapterUri: adapterUri(sha, format), sizeBytes: size });
      } finally {
        await rm(tmp, { force: true });
      }
    },
  );

  r.post(
    '/internal/trainer/jobs/:id/complete',
    {
      preHandler: guard,
      schema: {
        tags: ['internal'],
        summary: 'Return the trained adapter; the trainer states it deleted the training data',
        params: JobId,
        body: z.object({
          adapterSha256: z.string().regex(/^[0-9a-f]{64}$/),
          adapterUri: z.string().min(1).max(500),
          // The open model the adapter was trained on, e.g. Qwen/Qwen2.5-3B-Instruct.
          baseModel: z.string().min(1).max(100).optional(),
          scores: z.record(z.string(), z.number().finite()).optional(),
          dataDeleted: z.literal(true),
        }),
      },
    },
    async (req) => {
      const version = await completeTraining(ctx, req.params.id, req.service!, req.body);
      return { versionId: version.id, version: version.version_no, manifestCid: version.manifest_cid };
    },
  );

  r.post(
    '/internal/trainer/jobs/:id/fail',
    { preHandler: guard, schema: { tags: ['internal'], summary: 'Give up a training', params: JobId, body: z.object({ code: z.string().min(1).max(60), message: z.string().max(500) }) } },
    async (req) => {
      await failTraining(ctx, req.params.id, req.service!, req.body);
      return { failed: true };
    },
  );

  // The inference socket fetches adapters owners brought themselves (alt://adapters/<sha256>.<format>).
  r.get(
    '/internal/trainer/adapters/:file',
    { preHandler: guard, schema: { tags: ['internal'], summary: 'Download an adapter an owner uploaded', params: z.object({ file: z.string().regex(/^[0-9a-f]{64}\.(safetensors|gguf)$/) }) } },
    async (req, reply) => {
      const path = join(ctx.config.storageDir, 'adapters', req.params.file);
      const info = await stat(path).catch(() => null);
      if (!info) throw new AppError(404, 'NOT_FOUND', 'Adapter not found.');
      return reply.header('content-type', 'application/octet-stream').header('content-length', info.size).send(createReadStream(path));
    },
  );
}
