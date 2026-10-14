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
import { startIndexer } from './indexer.js';

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
  subscription: l.subscription_price_wei ? { pricePerMonth: pol(l.subscription_price_wei)! } : null,
  syncedAt: l.synced_at.toISOString(),
  updatedAt: l.updated_at.toISOString(),
});

/** Listings shown on ALTAR: verified AIs whose lister still owns them. */
const LIVE = `SELECT l.* FROM altar.listings l
                JOIN core.personal_ais a ON a.id = l.ai_id
               WHERE a.status = 'verified' AND a.deleted_at IS NULL AND a.owner_id = l.seller_id`;

/** Checks text against ALT's safety rules (ALT Core's moderation). */
export type Moderate = (text: string) => Promise<{ flagged: boolean; categories?: string[] }>;

/** ALT Core's moderation (POST /internal/moderate), called as the "altar" service. */
export function coreModeration(config: Pick<Config, 'coreUrl' | 'internalServiceKey'>): Moderate {
  return async (text) => {
    if (!config.internalServiceKey) throw new AltarError(503, 'MODERATION_UNAVAILABLE', 'Reviews are unavailable right now.');
    const res = await fetch(`${config.coreUrl}/internal/moderate`, {
      method: 'POST',
      // Core wants both: the shared service key and which service is asking.
      headers: { 'content-type': 'application/json', 'x-alt-service': 'altar', 'x-alt-service-key': config.internalServiceKey },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new AltarError(503, 'MODERATION_UNAVAILABLE', 'Reviews are unavailable right now.');
    return (await res.json()) as { flagged: boolean };
  };
}

export async function buildApp(
  config: Config,
  opts: { keySet?: JWTVerifyGetKey; chain?: ChainReader | null; logger?: boolean; indexer?: boolean; moderate?: Moderate } = {},
) {
  const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const chain = opts.chain !== undefined ? opts.chain : config.chain ? createChainReader(config.chain) : null;
  // Reviews go through the same moderation as everything else people write in ALT.
  const moderate: Moderate = opts.moderate ?? coreModeration(config);
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
  // Sales and rentals arrive from the marketplace contract (tests run the indexer by hand).
  const stopIndexer = chain && opts.indexer !== false ? startIndexer(db, chain, (msg) => app.log.info(msg)) : () => {};
  app.addHook('onClose', async () => {
    stopIndexer();
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
        summary: "Save your listing's description; its sale, rent and subscription prices are read from the chain (set them through ALT Core first)",
        params: AiId,
        body: z.object({
          pitch: z.string().trim().max(280).nullable().optional(),
          terms: z.string().trim().max(2000).nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { tokenId, offer } = await onChain(req.caller!.userId, req.params.aiId);
      const b = req.body;
      const subscription = offer.subscription?.pricePerMonthWei ?? null;
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
        `UPDATE altar.listings SET sale_price_wei = $2, rent_price_per_day_wei = $3, rent_max_days = $4, subscription_price_wei = $5, synced_at = now() WHERE ai_id = $1 RETURNING *`,
        [req.params.aiId, offer.sale?.priceWei.toString() ?? null, offer.rent?.pricePerDayWei.toString() ?? null, offer.rent?.maxDays ?? null, offer.subscription?.pricePerMonthWei.toString() ?? null],
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

  // ---------------------------------------------------------------- what happened (from the contract's events)

  /** A sale or rental, with the people involved by their public ALT names. */
  const ACTIVITY = `SELECT t.*, a.handle AS ai_handle, a.name AS ai_name,
                           fu.handle AS from_handle, fu.display_name AS from_name, tu.handle AS to_handle, tu.display_name AS to_name
                      FROM altar.transactions t
                      LEFT JOIN core.personal_ais a ON a.id = t.ai_id
                      LEFT JOIN core.users fu ON fu.id = t.from_user_id
                      LEFT JOIN core.users tu ON tu.id = t.to_user_id`;
  const activityOut = (t: Record<string, unknown>, me?: string) => ({
    id: String(t.id),
    kind: t.kind as 'sale' | 'rental' | 'subscription',
    ai: t.ai_id ? { id: t.ai_id as string, handle: t.ai_handle as string, name: t.ai_name as string } : null,
    tokenId: String(t.token_id),
    from: { address: t.from_address as string, handle: (t.from_handle as string | null) ?? null, name: (t.from_name as string | null) ?? null },
    to: { address: t.to_address as string, handle: (t.to_handle as string | null) ?? null, name: (t.to_name as string | null) ?? null },
    amount: pol(t.amount_wei as string)!,
    royalty: pol(t.royalty_wei as string)!,
    fee: pol(t.fee_wei as string)!,
    days: (t.days as number | null) ?? null,
    months: (t.months as number | null) ?? null,
    expiresAt: t.expires_at ? (t.expires_at as Date).toISOString() : null,
    txHash: t.tx_hash as string,
    occurredAt: (t.occurred_at as Date).toISOString(),
    // How it involved the caller, for their own activity list.
    ...(me
      ? {
          role:
            t.to_user_id === me
              ? ({ sale: 'bought', rental: 'rented', subscription: 'subscribed' } as const)[t.kind as 'sale']
              : t.from_user_id === me
                ? ({ sale: 'sold', rental: 'rented_out', subscription: 'subscribed_out' } as const)[t.kind as 'sale']
                : 'royalty',
        }
      : {}),
  });

  r.get(
    '/activity',
    { schema: { tags: ['activity'], summary: "An AI's sales and rentals, newest first", querystring: z.object({ aiId: z.uuid() }) } },
    async (req) => (await db.query(`${ACTIVITY} WHERE t.ai_id = $1 ORDER BY t.occurred_at DESC, t.id DESC LIMIT 50`, [req.query.aiId])).rows.map((t) => activityOut(t)),
  );

  r.get('/me/activity', { preHandler: requireUser, schema: { tags: ['activity'], summary: 'Your purchases, sales, rentals and royalties' } }, async (req) => {
    const me = req.caller!.userId;
    const { rows } = await db.query(
      `${ACTIVITY} WHERE t.from_user_id = $1 OR t.to_user_id = $1 OR (t.royalty_user_id = $1 AND t.royalty_wei > 0) ORDER BY t.occurred_at DESC, t.id DESC LIMIT 100`,
      [me],
    );
    return rows.map((t) => activityOut(t, me));
  });

  r.get('/me/rentals', { preHandler: requireUser, schema: { tags: ['activity'], summary: 'AIs you are renting or subscribed to right now (the latest payment for each)' } }, async (req) => {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (t.ai_id, t.kind) x.* FROM (${ACTIVITY}) x JOIN altar.transactions t ON t.id = x.id
        WHERE t.kind IN ('rental', 'subscription') AND t.to_user_id = $1 AND t.expires_at > now()
        ORDER BY t.ai_id, t.kind, t.expires_at DESC`,
      [req.caller!.userId],
    );
    return rows.map((t) => activityOut(t, req.caller!.userId)).sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)));
  });

  r.get('/me/royalties', { preHandler: requireUser, schema: { tags: ['activity'], summary: 'Royalties you earned as a creator, per AI' } }, async (req) => {
    const { rows } = await db.query<{ ai_id: string; handle: string; name: string; total: string; payments: string; last_at: Date }>(
      `SELECT t.ai_id, a.handle, a.name, sum(t.royalty_wei)::text AS total, count(*)::text AS payments, max(t.occurred_at) AS last_at
         FROM altar.transactions t JOIN core.personal_ais a ON a.id = t.ai_id
        WHERE t.royalty_user_id = $1 AND t.royalty_wei > 0
        GROUP BY t.ai_id, a.handle, a.name ORDER BY sum(t.royalty_wei) DESC`,
      [req.caller!.userId],
    );
    const total = rows.reduce((s, r) => s + BigInt(r.total), 0n);
    return {
      total: pol(total)!,
      ais: rows.map((r) => ({ aiId: r.ai_id, handle: r.handle, name: r.name, total: pol(r.total)!, payments: Number(r.payments), lastAt: r.last_at.toISOString() })),
    };
  });

  // ---------------------------------------------------------------- reviews (only from real buyers, renters and subscribers)

  const reviewOut = (r: Record<string, unknown>) => ({
    aiId: r.ai_id as string,
    rating: Number(r.rating),
    body: (r.body as string | null) ?? null,
    basis: r.basis as string,
    reviewer: { id: r.reviewer_id as string, handle: r.handle as string, name: r.display_name as string, avatarUrl: (r.avatar_url as string | null) ?? null },
    createdAt: (r.created_at as Date).toISOString(),
    updatedAt: (r.updated_at as Date).toISOString(),
  });
  const REVIEWS = `SELECT r.*, u.handle, u.display_name, COALESCE(pa.avatar_url, u.avatar_url) AS avatar_url
                     FROM altar.reviews r JOIN core.users u ON u.id = r.reviewer_id
                     LEFT JOIN core.platform_avatars pa ON pa.user_id = u.id AND pa.platform = 'altar'`;

  /** How the caller used the AI, from the chain's record ('bought' beats 'subscribed' beats 'rented'), or null. */
  async function basisFor(userId: string, aiId: string) {
    const { rows } = await db.query<{ kind: string }>(`SELECT DISTINCT kind FROM altar.transactions WHERE ai_id = $1 AND to_user_id = $2`, [aiId, userId]);
    const kinds = new Set(rows.map((r) => r.kind));
    return kinds.has('sale') ? 'bought' : kinds.has('subscription') ? 'subscribed' : kinds.has('rental') ? 'rented' : null;
  }

  r.get(
    '/reviews',
    { schema: { tags: ['reviews'], summary: "An AI's reviews and average rating", querystring: z.object({ aiId: z.uuid() }) } },
    async (req) => {
      const { rows } = await db.query(`${REVIEWS} WHERE r.ai_id = $1 ORDER BY r.updated_at DESC LIMIT 100`, [req.query.aiId]);
      const reviews = rows.map(reviewOut);
      const average = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null;
      return { average, count: reviews.length, reviews };
    },
  );

  r.get('/ratings', { schema: { tags: ['reviews'], summary: 'Average rating and number of reviews for every reviewed AI' } }, async () => {
    const { rows } = await db.query<{ ai_id: string; average: string; count: string }>(
      'SELECT ai_id, round(avg(rating)::numeric, 1)::text AS average, count(*)::text AS count FROM altar.reviews GROUP BY ai_id',
    );
    return rows.map((r) => ({ aiId: r.ai_id, average: Number(r.average), count: Number(r.count) }));
  });

  r.get(
    '/me/reviews/:aiId',
    { preHandler: requireUser, schema: { tags: ['reviews'], summary: 'May I review this AI, and my review if I wrote one', params: AiId } },
    async (req) => {
      const basis = await basisFor(req.caller!.userId, req.params.aiId);
      const { rows } = await db.query(`${REVIEWS} WHERE r.ai_id = $1 AND r.reviewer_id = $2`, [req.params.aiId, req.caller!.userId]);
      return { canReview: Boolean(basis), basis, review: rows[0] ? reviewOut(rows[0]) : null };
    },
  );

  r.put(
    '/reviews/:aiId',
    {
      preHandler: requireUser,
      schema: {
        tags: ['reviews'],
        summary: 'Write or change your review (you must have bought, rented or subscribed to the AI)',
        params: AiId,
        body: z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().max(1000).nullable().optional() }),
      },
    },
    async (req) => {
      const me = req.caller!.userId;
      const { rows: ai } = await db.query<{ owner_id: string; creator_id: string }>('SELECT owner_id, creator_id FROM core.personal_ais WHERE id = $1 AND deleted_at IS NULL', [req.params.aiId]);
      if (!ai[0]) throw notFound('AI');
      if (ai[0].owner_id === me || ai[0].creator_id === me) throw conflict('OWN_AI', "You can't review your own AI.");
      const basis = await basisFor(me, req.params.aiId);
      if (!basis) throw new AltarError(403, 'NOT_A_CUSTOMER', 'Only people who bought, rented or subscribed to this AI can review it.');
      const text = req.body.body || null;
      if (text && (await moderate(text)).flagged) throw new AltarError(422, 'REVIEW_REJECTED', "That review breaks ALT's content rules. Please rephrase it.");
      await db.query(
        `INSERT INTO altar.reviews (ai_id, reviewer_id, rating, body, basis) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ai_id, reviewer_id) DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, basis = EXCLUDED.basis, updated_at = now()`,
        [req.params.aiId, me, req.body.rating, text, basis],
      );
      const { rows } = await db.query(`${REVIEWS} WHERE r.ai_id = $1 AND r.reviewer_id = $2`, [req.params.aiId, me]);
      return reviewOut(rows[0]!);
    },
  );

  r.delete('/reviews/:aiId', { preHandler: requireUser, schema: { tags: ['reviews'], summary: 'Remove your review', params: AiId } }, async (req, reply) => {
    await db.query('DELETE FROM altar.reviews WHERE ai_id = $1 AND reviewer_id = $2', [req.params.aiId, req.caller!.userId]);
    return reply.status(204).send();
  });

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
