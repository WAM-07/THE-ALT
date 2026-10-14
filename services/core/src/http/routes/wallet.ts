import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { formatEther, isAddress, parseEther, type Hex } from 'viem';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { verifyTotp } from '../../lib/totp.js';
import { loadAi, requireOwnedAi } from '../../modules/ai/repo.js';
import { SPEND_ACTIONS, SpendApprovals, type SpendIntent } from '../../modules/market/approvals.js';
import { syncSubscription, syncToken } from '../../modules/market/holders.js';
import { findUserById, type UserRow } from '../../modules/accounts/users.js';
import { requireUser } from '../auth-guard.js';
import { requireChain } from './chain.js';

/** Test POL handed out on the local development chain. It has no value. */
const TEST_FUNDS = parseEther('100');

/** A POL amount typed by a person ("2.5"), as wei. */
const Pol = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,18})?$/, 'Enter an amount like 2 or 0.5.')
  .transform((v) => parseEther(v))
  .refine((v) => v > 0n, 'The amount must be more than zero.');

/**
 * Spending needs the person themselves: their password, a code from their authenticator app, or a
 * one-time approval from the ALT Account window (where they typed one of those, not on the platform).
 */
const Confirm = z.object({ password: z.string().max(128).optional(), code: z.string().max(20).optional(), approval: z.string().max(2000).optional() });

/** Details given in POL ("2.5") that an approval binds as wei; whole numbers; and 'off' / 'keep' for listings. */
const WEI_PARAMS = new Set(['price', 'pricePerDay', 'pricePerMonth', 'amount', 'salePrice', 'rentPricePerDay', 'subscriptionPricePerMonth']);
const INT_PARAMS = new Set(['days', 'months', 'rentMaxDays']);
const wei = (v: bigint | undefined) => (v === undefined ? '' : v.toString());

const pol = (wei: bigint) => ({ wei: wei.toString(), pol: formatEther(wei) });

/**
 * The ALT wallet (Module 12 with ALTAR): every account's custodial wallet, its balance and
 * marketplace earnings, and the on-chain listing of a person's AIs. Core holds the keys, so it signs
 * here, and only after the person confirms with their password or 2FA code.
 */
export async function walletRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);
  const spendLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  const approvals = new SpendApprovals(ctx.config.encryptionKey);

  async function confirmSpend(user: UserRow, confirm: z.infer<typeof Confirm>, intent: SpendIntent) {
    if (confirm.approval) {
      if (approvals.consume(user.id, confirm.approval, intent)) return;
      throw unauthorized('APPROVAL_INVALID', 'This approval has expired, was used already or was for something else. Confirm again.');
    }
    if (confirm.password && user.password_hash && (await bcrypt.compare(confirm.password, user.password_hash))) return;
    if (confirm.code && user.two_fa_enabled && user.two_fa_secret_enc && verifyTotp(decrypt(ctx.config.encryptionKey, user.two_fa_secret_enc), confirm.code) !== null) return;
    if (!user.password_hash && !user.two_fa_enabled) {
      throw new AppError(403, 'CONFIRMATION_UNAVAILABLE', 'Set a password or turn on two-step verification before spending from your wallet.');
    }
    throw unauthorized('CONFIRMATION_FAILED', confirm.code ? 'That code is wrong or has expired.' : 'Your password is wrong.');
  }

  /** The person, and their ALT-managed wallet ready to sign. */
  async function custodialOf(userId: string) {
    const user = await findUserById(ctx.db, userId);
    if (!user) throw unauthorized();
    const { rows } = await ctx.db.query<{ address: string; private_key_enc: string }>(
      `SELECT address, private_key_enc FROM core.wallets WHERE user_id = $1 AND kind = 'custodial' ORDER BY is_primary DESC LIMIT 1`,
      [userId],
    );
    if (!rows[0]) throw conflict('NO_ALT_WALLET', 'This account has no ALT wallet.');
    const chain = requireChain(ctx);
    return { user, address: rows[0].address, signer: () => chain.custodial(decrypt(ctx.config.encryptionKey, rows[0]!.private_key_enc) as Hex) };
  }

  const record = (userId: string, action: string, ip: string, data: Record<string, unknown>, note?: { title: string; body: string; link?: string }) =>
    tx(ctx.db, async (client) => {
      await audit(client, { action, actorUserId: userId, entityType: 'wallet', entityId: userId, ip, data });
      if (note) await notify(client, { userId, category: 'transaction', type: action, title: note.title, body: note.body, platform: 'altar', link: note.link ?? null, data });
    });

  /** The person's confirmation for one spend: details as the ALT window shows them, normalised. */
  function intentFrom(action: SpendIntent['action'], aiId: string | undefined, params: Record<string, string>): SpendIntent {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (WEI_PARAMS.has(k) && v !== 'off' && v !== 'keep') {
        const parsed = Pol.safeParse(v);
        if (!parsed.success) throw badRequest('INVALID_AMOUNT', `${k}: enter an amount like 2 or 0.5.`);
        p[k] = parsed.data.toString();
      } else if (INT_PARAMS.has(k) && v !== 'off') {
        if (!/^\d{1,4}$/.test(v)) throw badRequest('INVALID_NUMBER', `${k}: enter a whole number.`);
        p[k] = String(Number(v));
      } else if (k === 'to') {
        if (!isAddress(v)) throw badRequest('INVALID_ADDRESS', 'Enter a wallet address starting with 0x.');
        p[k] = v.toLowerCase();
      } else {
        p[k] = v;
      }
    }
    return { action, aiId: aiId ?? null, params: p };
  }

  r.post(
    '/me/spend-approvals',
    {
      preHandler: authed,
      config: spendLimit,
      schema: {
        tags: ['wallet'],
        summary: 'Confirm one spend in the ALT Account window: checks your password or 2FA code and returns a one-time approval (2 minutes) for exactly that spend',
        body: z.object({
          action: z.enum(SPEND_ACTIONS),
          aiId: z.uuid().optional(),
          params: z.record(z.string().max(40), z.string().max(200)).default({}),
          confirm: Confirm.omit({ approval: true }),
        }),
      },
    },
    async (req) => {
      const user = await findUserById(ctx.db, req.auth!.userId);
      if (!user) throw unauthorized();
      const intent = intentFrom(req.body.action, req.body.aiId, req.body.params);
      await confirmSpend(user, req.body.confirm, intent);
      await tx(ctx.db, (client) => audit(client, { action: 'wallet.spend_approved', actorUserId: user.id, entityType: 'wallet', entityId: user.id, ip: req.ip, data: { ...intent } }));
      return approvals.issue(user.id, intent);
    },
  );

  r.get('/me/wallet', { preHandler: authed, schema: { tags: ['wallet'], summary: 'Your ALT wallet: balance, marketplace earnings and the AI tokens you own' } }, async (req) => {
    const { address } = await custodialOf(req.auth!.userId);
    const chain = requireChain(ctx);
    const [balance, earnings, feeBps, tokens] = await Promise.all([
      chain.balanceOf(address),
      chain.marketplaceAddress ? chain.earningsOf(address) : Promise.resolve(0n),
      chain.marketplaceAddress ? chain.platformFeeBps() : Promise.resolve(null),
      ctx.db.query(
        `SELECT a.id, a.handle, a.name, a.avatar_url, t.token_id FROM core.personal_ais a
           JOIN core.ai_identity_tokens t ON t.ai_id = a.id
          WHERE a.owner_id = $1 AND a.deleted_at IS NULL ORDER BY t.token_id`,
        [req.auth!.userId],
      ),
    ]);
    return {
      address,
      network: chain.name,
      chainId: chain.chainId,
      symbol: 'POL',
      balance: pol(balance),
      earnings: pol(earnings),
      platformFeeBps: feeBps,
      testFunds: chain.isLocalDevChain ? pol(TEST_FUNDS) : null,
      explorer: chain.explorerAddress(address),
      tokens: tokens.rows.map((t) => ({ aiId: t.id as string, handle: t.handle as string, name: t.name as string, avatarUrl: t.avatar_url as string | null, tokenId: String(t.token_id) })),
    };
  });

  r.post(
    '/me/wallet/test-funds',
    { preHandler: authed, config: { rateLimit: { max: 3, timeWindow: '1 minute' } }, schema: { tags: ['wallet'], summary: 'Local development chain only: get 100 test POL (worth nothing)' } },
    async (req) => {
      const { address } = await custodialOf(req.auth!.userId);
      const hash = await requireChain(ctx).giveTestFunds(address, TEST_FUNDS);
      await record(req.auth!.userId, 'wallet.test_funds', req.ip, { hash, amountWei: TEST_FUNDS.toString() });
      return { hash, amount: pol(TEST_FUNDS), balance: pol(await requireChain(ctx).balanceOf(address)) };
    },
  );

  r.post(
    '/me/wallet/withdraw',
    { preHandler: authed, config: spendLimit, schema: { tags: ['wallet'], summary: 'Move your marketplace earnings into your ALT wallet', body: z.object({ confirm: Confirm }) } },
    async (req) => {
      const w = await custodialOf(req.auth!.userId);
      await confirmSpend(w.user, req.body.confirm, { action: 'withdraw', params: {} });
      const chain = requireChain(ctx);
      const earnings = await chain.earningsOf(w.address);
      if (earnings === 0n) throw badRequest('NOTHING_TO_WITHDRAW', 'You have no earnings to withdraw yet.');
      const { hash } = await w.signer().call('market', 'withdraw', [], 'withdraw your earnings');
      await record(req.auth!.userId, 'wallet.withdrawn', req.ip, { hash, amountWei: earnings.toString() }, { title: 'Earnings withdrawn', body: `${formatEther(earnings)} POL moved into your ALT wallet.`, link: '/wallet' });
      return { hash, amount: pol(earnings), balance: pol(await chain.balanceOf(w.address)) };
    },
  );

  r.post(
    '/me/wallet/send',
    {
      preHandler: authed,
      config: spendLimit,
      schema: {
        tags: ['wallet'],
        summary: 'Send POL from your ALT wallet to another address (for example your MetaMask)',
        body: z.object({ to: z.string().refine((v) => isAddress(v), 'Enter a wallet address starting with 0x.'), amount: Pol, confirm: Confirm }),
      },
    },
    async (req) => {
      const w = await custodialOf(req.auth!.userId);
      await confirmSpend(w.user, req.body.confirm, { action: 'send', params: { to: req.body.to.toLowerCase(), amount: wei(req.body.amount) } });
      if (req.body.to.toLowerCase() === w.address) throw badRequest('SAME_WALLET', 'That is your own ALT wallet.');
      const chain = requireChain(ctx);
      if ((await chain.balanceOf(w.address)) < req.body.amount) throw badRequest('INSUFFICIENT_FUNDS', 'Your ALT wallet does not have that much POL (the network fee needs a little too).');
      const hash = await w.signer().send(req.body.to, req.body.amount);
      await record(req.auth!.userId, 'wallet.sent', req.ip, { hash, to: req.body.to.toLowerCase(), amountWei: req.body.amount.toString() }, { title: 'POL sent', body: `${formatEther(req.body.amount)} POL sent to ${req.body.to.slice(0, 6)}…${req.body.to.slice(-4)}.`, link: '/wallet' });
      return { hash, amount: pol(req.body.amount), balance: pol(await chain.balanceOf(w.address)) };
    },
  );

  // ---------------------------------------------------------------- listing an AI on ALTAR

  async function tokenOfOwnedAi(userId: string, aiId: string) {
    const ai = await requireOwnedAi(ctx.db, userId, aiId);
    if (ai.status !== 'verified') throw conflict('AI_NOT_VERIFIED', 'Only verified AIs (with an identity token) can be listed.');
    const { rows } = await ctx.db.query<{ token_id: string }>('SELECT token_id FROM core.ai_identity_tokens WHERE ai_id = $1', [ai.id]);
    if (!rows[0]) throw conflict('AI_NOT_VERIFIED', 'This AI has no identity token yet.');
    return { ai, tokenId: BigInt(rows[0].token_id) };
  }

  const marketView = async (tokenId: bigint) => {
    const chain = requireChain(ctx);
    const [state, feeBps] = await Promise.all([chain.marketState(tokenId), chain.platformFeeBps()]);
    return {
      tokenId: tokenId.toString(),
      platformFeeBps: feeBps,
      sale: state.sale ? { seller: state.sale.seller, price: pol(state.sale.priceWei) } : null,
      rent: state.rent ? { owner: state.rent.owner, pricePerDay: pol(state.rent.pricePerDayWei), maxDays: state.rent.maxDays } : null,
      subscription: state.subscription ? { owner: state.subscription.owner, pricePerMonth: pol(state.subscription.pricePerMonthWei) } : null,
      rentedTo: state.rentedTo ? { address: state.rentedTo.address, until: state.rentedTo.until.toISOString() } : null,
    };
  };

  r.get(
    '/ais/:id/market',
    { preHandler: authed, schema: { tags: ['wallet'], summary: "Your AI's on-chain listing: sale price and rental terms", params: z.object({ id: z.uuid() }) } },
    async (req) => marketView((await tokenOfOwnedAi(req.auth!.userId, req.params.id)).tokenId),
  );

  r.put(
    '/ais/:id/market',
    {
      preHandler: authed,
      config: spendLimit,
      schema: {
        tags: ['wallet'],
        summary: 'List your AI on-chain for sale, rent and/or subscription (null takes that offer off); signed by your ALT wallet, network fee paid by ALT',
        params: z.object({ id: z.uuid() }),
        body: z.object({
          sale: z.object({ price: Pol }).nullable(),
          rent: z.object({ pricePerDay: Pol, maxDays: z.number().int().min(1).max(365) }).nullable(),
          // Optional, so callers written before subscriptions keep working (absent = leave as it is).
          subscription: z.object({ pricePerMonth: Pol }).nullable().optional(),
          confirm: Confirm,
        }),
      },
    },
    async (req) => {
      const { ai, tokenId } = await tokenOfOwnedAi(req.auth!.userId, req.params.id);
      const w = await custodialOf(req.auth!.userId);
      const offer = req.body;
      await confirmSpend(w.user, req.body.confirm, {
        action: 'list',
        aiId: ai.id,
        params: {
          salePrice: offer.sale ? wei(offer.sale.price) : 'off',
          rentPricePerDay: offer.rent ? wei(offer.rent.pricePerDay) : 'off',
          rentMaxDays: offer.rent ? String(offer.rent.maxDays) : 'off',
          subscriptionPricePerMonth: offer.subscription === undefined ? 'keep' : offer.subscription ? wei(offer.subscription.pricePerMonth) : 'off',
        },
      });
      const chain = requireChain(ctx);
      const before = await chain.marketState(tokenId);
      const signer = w.signer();
      const txs: { action: string; hash: string }[] = [];
      const run = async (action: string, ...call: Parameters<typeof signer.call>) => txs.push({ action, hash: (await signer.call(...call)).hash });

      const { sale, rent } = req.body;
      if (sale || rent) {
        const approval = await signer.ensureMarketApproval();
        if (approval) txs.push({ action: 'approve', hash: approval.hash });
      }
      if (sale && before.sale?.priceWei !== sale.price) await run('list_for_sale', 'market', 'listForSale', [tokenId, sale.price], 'list your AI for sale');
      if (!sale && before.sale) await run('cancel_sale', 'market', 'cancelSale', [tokenId], 'take your AI off sale');
      if (rent && (before.rent?.pricePerDayWei !== rent.pricePerDay || before.rent?.maxDays !== rent.maxDays)) {
        await run('list_for_rent', 'market', 'listForRent', [tokenId, rent.pricePerDay, rent.maxDays], 'offer your AI for rent');
      }
      if (!rent && before.rent) await run('cancel_rent', 'market', 'cancelRentalOffer', [tokenId], 'stop renting out your AI');
      const { subscription } = req.body;
      if (subscription && before.subscription?.pricePerMonthWei !== subscription.pricePerMonth) {
        await run('list_for_subscription', 'market', 'listForSubscription', [tokenId, subscription.pricePerMonth], 'offer subscriptions to your AI');
      }
      if (subscription === null && before.subscription) await run('cancel_subscription', 'market', 'cancelSubscriptionOffer', [tokenId], 'stop new subscriptions');

      if (txs.length) {
        const keepsSubscription = subscription ?? (subscription === undefined ? before.subscription && { pricePerMonth: before.subscription.pricePerMonthWei } : null);
        const offers = [
          sale && `for sale at ${formatEther(sale.price)} POL`,
          rent && `for rent at ${formatEther(rent.pricePerDay)} POL a day`,
          keepsSubscription && `by subscription at ${formatEther(keepsSubscription.pricePerMonth)} POL a month`,
        ]
          .filter(Boolean)
          .join(', ');
        await record(
          req.auth!.userId,
          'market.listing_changed',
          req.ip,
          { aiId: ai.id, tokenId: tokenId.toString(), txs, salePriceWei: sale?.price.toString() ?? null, rentPricePerDayWei: rent?.pricePerDay.toString() ?? null, subscriptionPriceWei: keepsSubscription?.pricePerMonth.toString() ?? null },
          { title: offers ? `${ai.name} is listed` : `${ai.name} is off the market`, body: offers ? `${ai.name} is now ${offers} on ALTAR.` : `${ai.name} is no longer for sale, rent or subscription.`, link: `/details/${ai.handle}` },
        );
      }
      return { ...(await marketView(tokenId)), txs };
    },
  );

  // ---------------------------------------------------------------- buying and renting on ALTAR

  /** A verified AI and its token, for someone who doesn't own it. */
  async function tokenToAcquire(userId: string, aiId: string) {
    const ai = await loadAi(ctx.db, aiId);
    if (!ai || ai.status !== 'verified') throw notFound('AI');
    if (ai.owner_id === userId) throw conflict('ALREADY_YOURS', 'You already own this AI.');
    const { rows } = await ctx.db.query<{ token_id: string }>('SELECT token_id FROM core.ai_identity_tokens WHERE ai_id = $1', [ai.id]);
    if (!rows[0]) throw notFound('AI');
    return { ai, tokenId: BigInt(rows[0].token_id) };
  }

  r.post(
    '/ais/:id/market/buy',
    {
      preHandler: authed,
      config: spendLimit,
      schema: {
        tags: ['wallet'],
        summary: 'Buy an AI listed for sale: its token moves to your ALT wallet (you pay the price; ALT pays the network fee)',
        params: z.object({ id: z.uuid() }),
        body: z.object({ confirm: Confirm, expectedPrice: Pol.optional() }),
      },
    },
    async (req) => {
      const { ai, tokenId } = await tokenToAcquire(req.auth!.userId, req.params.id);
      const w = await custodialOf(req.auth!.userId);
      await confirmSpend(w.user, req.body.confirm, { action: 'buy', aiId: ai.id, params: { price: wei(req.body.expectedPrice) } });
      const chain = requireChain(ctx);
      const { sale } = await chain.marketState(tokenId);
      if (!sale) throw conflict('NOT_FOR_SALE', `${ai.name} is not for sale right now.`);
      // The price shown to the buyer must still be the price; a seller can't raise it mid-checkout.
      if (req.body.expectedPrice !== undefined && req.body.expectedPrice !== sale.priceWei) throw conflict('PRICE_CHANGED', 'The price changed. Check it and try again.');
      const { hash } = await w.signer().call('market', 'buy', [tokenId], 'buy this AI', sale.priceWei);
      await syncToken(ctx, tokenId, hash);
      await record(req.auth!.userId, 'market.bought', req.ip, { aiId: ai.id, tokenId: tokenId.toString(), hash, priceWei: sale.priceWei.toString() });
      return { hash, aiId: ai.id, price: pol(sale.priceWei), balance: pol(await chain.balanceOf(w.address)) };
    },
  );

  r.post(
    '/ais/:id/market/rent',
    {
      preHandler: authed,
      config: spendLimit,
      schema: {
        tags: ['wallet'],
        summary: 'Rent an AI for some days: you alone may talk to it until then (the owner keeps the token)',
        params: z.object({ id: z.uuid() }),
        body: z.object({ days: z.number().int().min(1).max(365), confirm: Confirm, expectedPricePerDay: Pol.optional() }),
      },
    },
    async (req) => {
      const { ai, tokenId } = await tokenToAcquire(req.auth!.userId, req.params.id);
      const w = await custodialOf(req.auth!.userId);
      await confirmSpend(w.user, req.body.confirm, { action: 'rent', aiId: ai.id, params: { days: String(req.body.days), pricePerDay: wei(req.body.expectedPricePerDay) } });
      const chain = requireChain(ctx);
      const { rent, rentedTo } = await chain.marketState(tokenId);
      if (!rent) throw conflict('NOT_FOR_RENT', `${ai.name} is not offered for rent right now.`);
      if (rentedTo) throw conflict('ALREADY_RENTED', `${ai.name} is rented until ${rentedTo.until.toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
      if (req.body.days > rent.maxDays) throw badRequest('TOO_MANY_DAYS', `${ai.name} can be rented for at most ${rent.maxDays} days.`);
      if (req.body.expectedPricePerDay !== undefined && req.body.expectedPricePerDay !== rent.pricePerDayWei) throw conflict('PRICE_CHANGED', 'The price changed. Check it and try again.');
      const total = rent.pricePerDayWei * BigInt(req.body.days);
      const { hash } = await w.signer().call('market', 'rent', [tokenId, req.body.days], 'rent this AI', total);
      const synced = await syncToken(ctx, tokenId, hash);
      await record(req.auth!.userId, 'market.rented', req.ip, { aiId: ai.id, tokenId: tokenId.toString(), hash, days: req.body.days, paidWei: total.toString() });
      return { hash, aiId: ai.id, paid: pol(total), until: synced?.renterUntil?.toISOString() ?? null, balance: pol(await chain.balanceOf(w.address)) };
    },
  );

  r.post(
    '/ais/:id/market/subscribe',
    {
      preHandler: authed,
      config: spendLimit,
      schema: {
        tags: ['wallet'],
        summary: 'Subscribe to an AI for some months (renewing adds to the time left); many people may subscribe at once',
        params: z.object({ id: z.uuid() }),
        body: z.object({ months: z.number().int().min(1).max(12), confirm: Confirm, expectedPricePerMonth: Pol.optional() }),
      },
    },
    async (req) => {
      const { ai, tokenId } = await tokenToAcquire(req.auth!.userId, req.params.id);
      const w = await custodialOf(req.auth!.userId);
      await confirmSpend(w.user, req.body.confirm, { action: 'subscribe', aiId: ai.id, params: { months: String(req.body.months), pricePerMonth: wei(req.body.expectedPricePerMonth) } });
      const chain = requireChain(ctx);
      const { subscription } = await chain.marketState(tokenId);
      if (!subscription) throw conflict('NOT_FOR_SUBSCRIPTION', `${ai.name} does not offer subscriptions right now.`);
      if (req.body.expectedPricePerMonth !== undefined && req.body.expectedPricePerMonth !== subscription.pricePerMonthWei) {
        throw conflict('PRICE_CHANGED', 'The price changed. Check it and try again.');
      }
      const total = subscription.pricePerMonthWei * BigInt(req.body.months);
      const { hash } = await w.signer().call('market', 'subscribe', [tokenId, req.body.months], 'subscribe to this AI', total);
      const synced = await syncSubscription(ctx, tokenId, w.address, hash);
      await record(req.auth!.userId, 'market.subscribed', req.ip, { aiId: ai.id, tokenId: tokenId.toString(), hash, months: req.body.months, paidWei: total.toString() });
      return { hash, aiId: ai.id, paid: pol(total), until: synced?.until.toISOString() ?? null, balance: pol(await chain.balanceOf(w.address)) };
    },
  );
}
