import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit, publish } from '../../lib/audit.js';
import { notify } from '../../lib/notify.js';

/**
 * Rights follow the token (ALTAR evaluation, section 7). Whoever's wallet holds an AI's identity
 * token owns the AI in ALT; whoever the token names as its user (ERC-4907) may talk to it until the
 * rental ends. This reads the chain and brings Core in line: owner in core.personal_ais, renter in
 * core.ai_identity_tokens. ALTER, ALTERA and ALTAR all follow from there.
 */
export async function syncToken(ctx: Ctx, tokenId: bigint, txHash: string | null = null) {
  const chain = ctx.chain;
  if (!chain) return null;
  const { rows } = await ctx.db.query<{ ai_id: string; owner_address: string; user_address: string | null; owner_id: string; name: string; handle: string }>(
    `SELECT t.ai_id, t.owner_address, t.user_address, a.owner_id, a.name, a.handle
       FROM core.ai_identity_tokens t JOIN core.personal_ais a ON a.id = t.ai_id
      WHERE t.token_id = $1 AND t.chain_id = $2 AND lower(t.contract_address) = lower($3)`,
    [tokenId.toString(), chain.chainId, chain.registryAddress],
  );
  const token = rows[0];
  if (!token) return null; // not an ALT token (or minted on a chain this database doesn't know)

  const now = await chain.holders(tokenId);
  const userOf = async (address: string | null) =>
    address ? ((await ctx.db.query<{ user_id: string }>('SELECT user_id FROM core.wallets WHERE address = $1', [address])).rows[0]?.user_id ?? null) : null;
  const [newOwner, renter] = await Promise.all([userOf(now.owner), userOf(now.user)]);

  return tx(ctx.db, async (client) => {
    await client.query('UPDATE core.ai_identity_tokens SET owner_address = $2, user_address = $3, user_expires = $4, synced_at = now() WHERE ai_id = $1', [
      token.ai_id,
      now.owner,
      now.user,
      now.userExpires,
    ]);

    let ownerChanged = false;
    if (now.owner !== token.owner_address) {
      if (newOwner && newOwner !== token.owner_id) {
        ownerChanged = true;
        await client.query('UPDATE core.personal_ais SET owner_id = $2 WHERE id = $1', [token.ai_id, newOwner]);
        // Holding an AI someone else made makes the person a consumer.
        await client.query(`UPDATE core.users SET roles = array_append(roles, 'consumer') WHERE id = $1 AND NOT ('consumer' = ANY(roles))`, [newOwner]);
        await audit(client, { action: 'ai.ownership_changed', actorService: 'chain', entityType: 'ai', entityId: token.ai_id, data: { from: token.owner_id, to: newOwner, tokenId: tokenId.toString(), txHash } });
        await notify(client, { userId: newOwner, category: 'transaction', type: 'ai.received', title: `${token.name} is yours`, body: `You now hold ${token.name}'s identity token. Manage it in ALTER.`, platform: 'alter', link: `/details/${token.handle}`, data: { aiId: token.ai_id, txHash } });
        await notify(client, { userId: token.owner_id, category: 'transaction', type: 'ai.transferred', title: `${token.name} has a new owner`, body: `${token.name}'s identity token left your wallet, and with it your access.`, platform: 'altar', link: '/wallet', data: { aiId: token.ai_id, txHash } });
        await publish(client, 'ai.owner_changed', { aiId: token.ai_id, from: token.owner_id, to: newOwner });
      } else if (!newOwner) {
        // A wallet outside ALT (e.g. MetaMask) holds it now. Nobody in ALT owns it until it comes back.
        await audit(client, { action: 'ai.held_outside_alt', actorService: 'chain', entityType: 'ai', entityId: token.ai_id, data: { address: now.owner, tokenId: tokenId.toString(), txHash } });
      }
    }

    if (now.user && now.user !== token.user_address && renter) {
      const until = now.userExpires!.toISOString();
      await client.query(`UPDATE core.users SET roles = array_append(roles, 'consumer') WHERE id = $1 AND NOT ('consumer' = ANY(roles))`, [renter]);
      await audit(client, { action: 'ai.rented', actorService: 'chain', entityType: 'ai', entityId: token.ai_id, data: { renter, until, tokenId: tokenId.toString(), txHash } });
      await notify(client, { userId: renter, category: 'transaction', type: 'ai.rental_started', title: `You're renting ${token.name}`, body: `Chat with ${token.name} on ALTAR until ${until.slice(0, 16).replace('T', ' ')} UTC.`, platform: 'altar', link: `/chat/${token.handle}`, data: { aiId: token.ai_id, until, txHash } });
      await notify(client, { userId: newOwner ?? token.owner_id, category: 'transaction', type: 'ai.rented_out', title: `${token.name} was rented`, body: `Someone is renting ${token.name} until ${until.slice(0, 16).replace('T', ' ')} UTC. Your earnings are in your wallet's marketplace balance.`, platform: 'altar', link: '/wallet', data: { aiId: token.ai_id, until, txHash } });
    }

    if (ownerChanged || now.user !== token.user_address) {
      // ALTERA follows the new owner straight away (its AI persona moves with the AI).
      await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: token.ai_id, event: ownerChanged ? 'owner_changed' : 'rental_changed' })]);
    }
    return { aiId: token.ai_id, owner: now.owner, ownerId: newOwner ?? token.owner_id, ownerChanged, renter: now.user, renterId: renter, renterUntil: now.userExpires };
  });
}

const CURSOR = 'ait_registry';
const MAX_RANGE = 2_000n;

/**
 * Reads the registry's new events once and syncs every token they touch. Catches transfers made
 * outside ALTAR too (e.g. from MetaMask). Safe to run repeatedly.
 */
export async function indexRegistry(ctx: Ctx, log: (msg: string) => void = () => {}) {
  const chain = ctx.chain;
  if (!chain) return 0;
  const head = await chain.blockNumber();
  const { rows } = await ctx.db.query<{ block: string; chain_id: number }>('SELECT block, chain_id FROM core.chain_cursors WHERE name = $1', [CURSOR]);
  let from = rows[0] && rows[0].chain_id === chain.chainId ? BigInt(rows[0].block) + 1n : 0n;
  // The local development chain starts empty on every restart: read it again from the beginning.
  if (from > head + 1n) from = 0n;
  let synced = 0;
  while (from <= head) {
    const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head;
    for (const change of await chain.registryChanges(from, to)) {
      const r = await syncToken(ctx, change.tokenId, change.txHash);
      if (r) synced++;
    }
    await ctx.db.query(
      `INSERT INTO core.chain_cursors (name, chain_id, block) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET chain_id = EXCLUDED.chain_id, block = EXCLUDED.block, updated_at = now()`,
      [CURSOR, chain.chainId, to.toString()],
    );
    from = to + 1n;
  }
  if (synced) log(`chain indexer: ${synced} identity token change(s) applied`);
  return synced;
}

/** Runs the indexer every few seconds until stopped. */
export function startRegistryIndexer(ctx: Ctx, log: (msg: string) => void, everyMs = 4_000) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    try {
      await indexRegistry(ctx, log);
    } catch (err) {
      log(`chain indexer: ${(err as Error).message}`);
    }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
