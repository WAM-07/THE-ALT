import type pg from 'pg';
import type { ChainReader } from './chain.js';

const CURSOR = 'alt_marketplace';
const MAX_RANGE = 2_000n;

/**
 * Turns ALTMarketplace events into ALTAR's records: every sale and rental becomes a row in
 * altar.transactions (with the royalty and fee the contract paid), and listings follow what the
 * contract now offers. Safe to run again over the same blocks.
 */
export async function indexMarketplace(db: pg.Pool, chain: ChainReader, log: (msg: string) => void = () => {}) {
  const [chainId, head] = await Promise.all([chain.chainId(), chain.head()]);
  const { rows } = await db.query<{ block: string; chain_id: number }>('SELECT block, chain_id FROM altar.indexer_cursor WHERE name = $1', [CURSOR]);
  let from = rows[0] && rows[0].chain_id === chainId ? BigInt(rows[0].block) + 1n : 0n;
  // The local development chain starts empty on every restart: read it again from the beginning.
  if (from > head + 1n) from = 0n;

  const userOf = async (address: string | null | undefined) =>
    address ? ((await db.query<{ user_id: string }>('SELECT user_id FROM core.wallets WHERE address = $1', [address.toLowerCase()])).rows[0]?.user_id ?? null) : null;
  const tokenInfo = async (tokenId: bigint) =>
    (
      await db.query<{ ai_id: string; creator_address: string }>(
        'SELECT ai_id, creator_address FROM core.ai_identity_tokens WHERE token_id = $1 AND chain_id = $2',
        [tokenId.toString(), chainId],
      )
    ).rows[0] ?? null;

  let recorded = 0;
  while (from <= head) {
    const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head;
    const touched = new Set<bigint>();
    for (const e of await chain.events(from, to)) {
      const tokenId = e.args.tokenId;
      touched.add(tokenId);
      if (e.eventName !== 'Sold' && e.eventName !== 'Rented') continue;
      const info = await tokenInfo(tokenId);
      const base = { tokenId: tokenId.toString(), aiId: info?.ai_id ?? null, txHash: e.transactionHash, logIndex: e.logIndex, block: e.blockNumber.toString(), at: e.at };
      const row =
        e.eventName === 'Sold'
          ? { kind: 'sale', from: e.args.seller, to: e.args.buyer, amount: e.args.price, royalty: e.args.royalty, royaltyTo: e.args.royalty > 0n ? e.args.royaltyReceiver : null, fee: e.args.fee, days: null, expires: null }
          : {
              kind: 'rental',
              from: e.args.owner,
              to: e.args.renter,
              amount: e.args.paid,
              royalty: e.args.royalty,
              royaltyTo: e.args.royalty > 0n ? (info?.creator_address ?? null) : null,
              fee: e.args.fee,
              days: Number(e.args.numDays),
              expires: new Date(Number(e.args.expires) * 1000),
            };
      const { rowCount } = await db.query(
        `INSERT INTO altar.transactions (kind, ai_id, token_id, from_address, to_address, from_user_id, to_user_id, amount_wei, royalty_wei, royalty_address,
                                         royalty_user_id, fee_wei, days, expires_at, chain_id, tx_hash, log_index, block_number, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          row.kind,
          base.aiId,
          base.tokenId,
          row.from.toLowerCase(),
          row.to.toLowerCase(),
          await userOf(row.from),
          await userOf(row.to),
          row.amount.toString(),
          row.royalty.toString(),
          row.royaltyTo?.toLowerCase() ?? null,
          await userOf(row.royaltyTo),
          row.fee.toString(),
          row.days,
          row.expires,
          chainId,
          base.txHash,
          base.logIndex,
          base.block,
          base.at,
        ],
      );
      recorded += rowCount ?? 0;
      // A sold AI's old listing (and its subscription price) belonged to the seller; the new owner lists afresh.
      if (e.eventName === 'Sold' && base.aiId) await db.query('DELETE FROM altar.listings WHERE ai_id = $1 AND seller_id IS DISTINCT FROM (SELECT owner_id FROM core.personal_ais WHERE id = $1)', [base.aiId]);
    }
    // Listings follow what the contract offers now.
    for (const tokenId of touched) {
      const offer = await chain.offer(tokenId);
      await db.query(
        `UPDATE altar.listings SET sale_price_wei = $2, rent_price_per_day_wei = $3, rent_max_days = $4, synced_at = now() WHERE token_id = $1`,
        [tokenId.toString(), offer.sale?.priceWei.toString() ?? null, offer.rent?.pricePerDayWei.toString() ?? null, offer.rent?.maxDays ?? null],
      );
    }
    await db.query(
      `INSERT INTO altar.indexer_cursor (name, chain_id, block) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET chain_id = EXCLUDED.chain_id, block = EXCLUDED.block, updated_at = now()`,
      [CURSOR, chainId, to.toString()],
    );
    from = to + 1n;
  }
  if (recorded) log(`marketplace indexer: ${recorded} new sale(s) or rental(s)`);
  return recorded;
}

/** Runs the indexer every few seconds until stopped. */
export function startIndexer(db: pg.Pool, chain: ChainReader, log: (msg: string) => void, everyMs = 4_000) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    try {
      await indexMarketplace(db, chain, log);
    } catch (err) {
      log(`marketplace indexer: ${(err as Error).message}`);
    }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
