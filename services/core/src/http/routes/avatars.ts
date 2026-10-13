import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { notFound } from '../../lib/errors.js';
import { AVATAR_DIR, isPresetFile, presetSets } from '../../lib/avatars.js';

const Kind = z.enum(['human', 'ai']);

/** ALT's ready-made profile pictures: the list for pickers, and the image files themselves. */
export async function avatarRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/avatars/presets',
    {
      schema: {
        tags: ['account'],
        summary: 'Ready-made profile pictures, in sets: "human" for people, "ai" for AIs',
        querystring: z.object({ kind: Kind.optional() }),
      },
    },
    async (req) => ({ sets: presetSets(ctx, req.query.kind) }),
  );

  r.get(
    '/avatars/:kind/:set/:file',
    { schema: { hide: true, params: z.object({ kind: Kind, set: z.string().regex(/^[a-z0-9-]{1,40}$/), file: z.string().regex(/^\d{2}\.png$/) }) } },
    async (req, reply) => {
      const { kind, set, file } = req.params;
      // Only files listed in the manifest, so the path can never leave the avatars folder.
      if (!isPresetFile(kind, set, file)) throw notFound('Picture');
      const body = await readFile(new URL(`${kind}/${set}/${file}`, AVATAR_DIR));
      return reply.header('cache-control', 'public, max-age=86400').type('image/png').send(body);
    },
  );
}
