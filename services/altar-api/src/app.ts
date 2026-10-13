import Fastify, { type FastifyError } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { JWTVerifyGetKey } from 'jose';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { formatEther, parseEther } from 'viem';
import { z } from 'zod';
import { createAuth } from './auth.js';
import { createChainReader, type ChainReader } from './chain.js';
import type { Config } from './config.js';
import { AltarError, conflict, notFound } from './errors.js';

/** A POL amount typed by a person ("2.5"), as wei. */
const Pol = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,18})?$/, 'Enter an amount like 2 or 0.5.')
  .transform((v) => parseEther(v))
  .refine((v) => v > 0n, 'The amount must be more than zero.');
const AiId = z.object({ aiId: z.uuid() });
const pol = (wei: string | bigint | null) => (wei === null ? null : { wei: String(wei), pol: formatEther(BigInt(wei)) });

interface ListingRow {
  ai_id: string;
  token_id: string;
  seller_id: string;
  pitch: string | null;
  terms: string | null;
  sale_price_wei: string | null;
  rent_price_per_day_wei: string | null;
  rent_max_days: number | null;
  subscription_price_wei: string | null;
  synced_at: Date;
  updated_at: Date;
}

const view = (l: ListingRow) => ({
  aiId: l.ai_id,
  tokenId: String(l.token_id),
  sellerId: l.seller_id,
  pitch: l.pitch,
  terms: l.terms,
  sale: l.sale_price_wei ? { price: pol(l.sale_price_wei)! } : null,
  rent: l.rent_price_per_day_wei ? { pricePerDay: pol(l.rent_price_per_day_wei)!, maxDays: l.rent_max_days! } : null,
  // Shown with its price now; subscribing opens when the marketplace contract supports it (ALTAR step 4).
  subscription: l.subscription_price_wei ? { pricePerMonth: pol(l.subscription_price_wei)!, open: false } : null,
  syncedAt: l.synced_at.toISOString(),
  updatedAt: l.updated_at.toISOString(),
});

/** Listings shown on ALTAR: verified AIs whose lister still owns them. */
const LIVE = `SELECT l.* FROM altar.listings l
                JOIN core.personal_ais a ON a.id = l.ai_id
               WHERE a.status = 'verified' AND a.deleted_at IS NULL AND a.owner_id = l.seller_id`;

export async function buildApp(config: Config, opts: { keySet?: JWTVerifyGetKey; chain?: ChainReader | null; logger?: boolean } = {}) {
  const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const chain = opts.chain !== undefined ? opts.chain : config.chain ? createChainReader(config.chain) : null;
  const { requireUser, forget } = createAuth({ db, issuer: config.issuer, jwksUrl: config.jwksUrl, ...(opts.keySet ? { keySet: opts.keySet } : {}) });

  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Sign-outs anywhere in ALT take effect here at once.
  const events = new pg.Client({ connectionString: config.databaseUrl });
  events.on('notification', (msg) => {
    try {
      forget(JSON.parse(msg.payload ?? '{}'));
    } catch {
      // ignore malformed payloads
    }
  });
  events.on('error', (err) => app.log.error({ err }, 'lost the sign-out listener'));
  await events.connect();
  await events.query('LISTEN alt_sessions_revoked');
  app.addHook('onClose', async () => {
    await events.end().catch(() => {});
    await db.end();
  });

  app.setErrorHandler((err: FastifyError | AltarError, req, reply) => {
    const requestId = req.id;
    if (err instanceof AltarError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    const fe = err as FastifyError;
    if (fe.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are missing or invalid.',
          details: { issues: fe.validation.map((v) => ({ path: v.instancePath || v.params?.missingProperty, message: v.message })) },
          requestId,
        },
      });
    }
    if (fe.statusCode && fe.statusCode < 500) return reply.status(fe.statusCode).send({ error: { code: fe.code ?? 'BAD_REQUEST', message: fe.message, requestId } });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.', requestId } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.url}`, requestId: req.id } }));

  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, service: 'altar', chain: Boolean(chain) };
  });

  /** The caller's own verified AI with its token, plus their wallet addresses. */
  async function ownAi(userId: string, aiId: string) {
    const { rows } = await db.query<{ id: string; owner_id: string; status: string; token_id: string | null }>(
      `SELECT a.id, a.owner_id, a.status, t.token_id FROM core.personal_ais a
         LEFT JOIN core.ai_identity_tokens t ON t.ai_id = a.id
        WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [aiId],
    );
    const ai = rows[0];
    if (!ai || ai.owner_id !== userId) throw notFound('AI');
    if (ai.status !== 'verified' || !ai.token_id) throw conflict('AI_NOT_VERIFIED', 'Only verified AIs (with an identity token) can be listed.');
    const wallets = await db.query<{ address: string }>('SELECT lower(address) AS address FROM core.wallets WHERE user_id = $1', [userId]);
    return { tokenId: BigInt(ai.token_id), wallets: new Set(wallets.rows.map((w) => w.address)) };
  }

  /** Reads the token's offers from the chain; the caller must hold the token in one of their wallets. */
  async function onChain(userId: string, aiId: string) {
    if (!chain) throw new AltarError(503, 'CHAIN_DISABLED', 'The blockchain is not configured on this server.');
    const { tokenId, wallets } = await ownAi(userId, aiId);
    const offer = await chain.offer(tokenId);
    if (!wallets.has(offer.owner)) throw conflict('OWNERSHIP_OUT_OF_SYNC', 'Your wallet does not hold this AI on the blockchain right now.');
    return { tokenId, offer };
  }

  // ---------------------------------------------------------------- listings

  r.get(
    '/listings',
    { schema: { tags: ['listings'], summary: 'Everything listed on ALTAR (sale, rent and subscription prices)' } },
    async () => (await db.query<ListingRow>(`${LIVE} ORDER BY l.updated_at DESC`)).rows.map(view),
  );

  r.get('/listings/:aiId', { schema: { tags: ['listings'], summary: "One AI's listing", params: AiId } }, async (req) => {
    const { rows } = await db.query<ListingRow>(`${LIVE} AND l.ai_id = $1`, [req.params.aiId]);
    if (!rows[0]) throw notFound('Listing');
    return view(rows[0]);
  });

  r.put(
    '/listings/:aiId',
    {
      preHandler: requireUser,
      schema: {
        tags: ['listings'],
        summary: "Save your listing's description and subscription price; sale and rent prices are read from the chain (set them through ALT Core first)",
        params: AiId,
        body: z.object({
          pitch: z.string().trim().max(280).nullable().optional(),
          terms: z.string().trim().max(2000).nullable().optional(),
          subscriptionPrice: Pol.nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { tokenId, offer } = await onChain(req.caller!.userId, req.params.aiId);
      const b = req.body;
      const current = (await db.query<ListingRow>('SELECT * FROM altar.listings WHERE ai_id = $1', [req.params.aiId])).rows[0];
      const subscription = b.subscriptionPrice !== undefined ? b.subscriptionPrice : current?.subscription_price_wei ? BigInt(current.subscription_price_wei) : null;
      if (!offer.sale && !offer.rent && !subscription) {
        // Nothing left on offer: the listing goes away.
        await db.query('DELETE FROM altar.listings WHERE ai_id = $1', [req.params.aiId]);
        return reply.send({ listing: null });
      }
      const { rows } = await db.query<ListingRow>(
        `INSERT INTO altar.listings (ai_id, token_id, seller_id, pitch, terms, sale_price_wei, rent_price_per_day_wei, rent_max_days, subscription_price_wei, synced_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
         ON CONFLICT (ai_id) DO UPDATE SET
           token_id = EXCLUDED.token_id, seller_id = EXCLUDED.seller_id,
           pitch = CASE WHEN $10 THEN EXCLUDED.pitch ELSE altar.listings.pitch END,
           terms = CASE WHEN $11 THEN EXCLUDED.terms ELSE altar.listings.terms END,
           sale_price_wei = EXCLUDED.sale_price_wei, rent_price_per_day_wei = EXCLUDED.rent_price_per_day_wei,
           rent_max_days = EXCLUDED.rent_max_days, subscription_price_wei = EXCLUDED.subscription_price_wei,
           synced_at = now(), updated_at = now()
         RETURNING *`,
        [
          req.params.aiId,
          tokenId.toString(),
          req.caller!.userId,
          b.pitch || null,
          b.terms || null,
          offer.sale?.priceWei.toString() ?? null,
          offer.rent?.pricePerDayWei.toString() ?? null,
          offer.rent?.maxDays ?? null,
          subscription?.toString() ?? null,
          b.pitch !== undefined,
          b.terms !== undefined,
        ],
      );
      return { listing: view(rows[0]!) };
    },
  );

  r.post(
    '/listings/:aiId/sync',
    { preHandler: requireUser, schema: { tags: ['listings'], summary: 'Re-read your listing from the chain', params: AiId } },
    async (req) => {
      const { offer } = await onChain(req.caller!.userId, req.params.aiId);
      const { rows } = await db.query<ListingRow>(
        `UPDATE altar.listings SET sale_price_wei = $2, rent_price_per_day_wei = $3, rent_max_days = $4, synced_at = now() WHERE ai_id = $1 RETURNING *`,
        [req.params.aiId, offer.sale?.priceWei.toString() ?? null, offer.rent?.pricePerDayWei.toString() ?? null, offer.rent?.maxDays ?? null],
      );
      return { listing: rows[0] ? view(rows[0]) : null };
    },
  );

  r.delete(
    '/listings/:aiId',
    { preHandler: requireUser, schema: { tags: ['listings'], summary: 'Remove your listing (take it off sale and rent through ALT Core first)', params: AiId } },
    async (req, reply) => {
      const { offer } = await onChain(req.caller!.userId, req.params.aiId);
      if (offer.sale || offer.rent) throw conflict('STILL_ON_CHAIN', 'Take the AI off sale and rent first; the blockchain still offers it.');
      await db.query('DELETE FROM altar.listings WHERE ai_id = $1 AND seller_id = $2', [req.params.aiId, req.caller!.userId]);
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------- saved AIs

  r.get('/wishlist', { preHandler: requireUser, schema: { tags: ['wishlist'], summary: 'AIs you saved' } }, async (req) => {
    const { rows } = await db.query<{ ai_id: string; created_at: Date }>(
      'SELECT ai_id, created_at FROM altar.wishlist WHERE user_id = $1 ORDER BY created_at DESC',
      [req.caller!.userId],
    );
    return rows.map((w) => ({ aiId: w.ai_id, savedAt: w.created_at.toISOString() }));
  });

  r.put('/wishlist/:aiId', { preHandler: requireUser, schema: { tags: ['wishlist'], summary: 'Save an AI', params: AiId } }, async (req, reply) => {
    const { rowCount } = await db.query(`SELECT 1 FROM core.personal_ais WHERE id = $1 AND status = 'verified' AND deleted_at IS NULL`, [req.params.aiId]);
    if (!rowCount) throw notFound('AI');
    await db.query('INSERT INTO altar.wishlist (user_id, ai_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.caller!.userId, req.params.aiId]);
    return reply.status(204).send();
  });

  r.delete('/wishlist/:aiId', { preHandler: requireUser, schema: { tags: ['wishlist'], summary: 'Unsave an AI', params: AiId } }, async (req, reply) => {
    await db.query('DELETE FROM altar.wishlist WHERE user_id = $1 AND ai_id = $2', [req.caller!.userId, req.params.aiId]);
    return reply.status(204).send();
  });

  return app;
}
