import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { claimTraining, completeTraining, exportTrainingData, failTraining, reportCheckpoint } from '../../modules/ai/training.js';
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
}
