import pg from 'pg';
import { parseEther } from 'viem';
import type { Ctx } from '../context.js';
import { tx } from '../db.js';
import { audit, publish } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { loadAi, loadVersion } from '../modules/ai/repo.js';
import { runSimulatedTraining, simulatedTrainingFailed } from '../modules/ai/training.js';
import { evaluationFailed, runEvaluation } from '../modules/ai/evaluation.js';

interface JobRow {
  id: string;
  kind: string;
  payload: Record<string, string>;
  attempts: number;
  max_attempts: number;
  result: Record<string, unknown> | null;
}

type Handler = (ctx: Ctx, job: JobRow, save: (result: Record<string, unknown>) => Promise<void>) => Promise<Record<string, unknown>>;
type FailureHandler = (ctx: Ctx, job: JobRow, error: Error) => Promise<void>;

/** Tells every ALT service an AI changed (ALTERA reacts instantly; see services/altera-api). */
async function announceAi(client: pg.PoolClient, aiId: string, event: string) {
  await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId, event })]);
}

// ---------------------------------------------------------------- mint_ait

/**
 * Mints the AI's identity token. Safe to retry at any point: if a previous attempt already minted
 * (or sent the transaction), the token is adopted instead of minting twice.
 */
const mintAit: Handler = async (ctx, job, save) => {
  const chain = ctx.chain;
  if (!chain) throw new AppError(503, 'CHAIN_DISABLED', 'The blockchain is not configured.');
  const ai = await loadAi(ctx.db, job.payload.aiId!);
  const version = await loadVersion(ctx.db, job.payload.versionId!);
  if (!ai || !version) throw new AppError(404, 'NOT_FOUND', 'AI or version vanished.');
  const { rows: wallets } = await ctx.db.query<{ address: string }>('SELECT address FROM core.wallets WHERE user_id = $1 AND is_primary', [ai.owner_id]);
  const owner = wallets[0]?.address;
  if (!owner) throw new AppError(409, 'NO_WALLET', 'The owner has no primary wallet.');

  let txHash = (job.result?.txHash as `0x${string}` | undefined) ?? null;
  let tokenId = await chain.tokenOfAi(ai.id);
  let blockNumber: bigint | null = null;
  if (tokenId === 0n) {
    if (!txHash) {
      txHash = await chain.sendMint(owner, ai.id, version.manifest_cid, ai.royalty_bps);
      await save({ txHash }); // remember it before waiting, so a crash cannot cause a second mint
    }
    const confirmed = await chain.confirmMint(txHash);
    tokenId = confirmed.tokenId;
    blockNumber = confirmed.blockNumber;
  }
  const identity = await chain.readIdentity(tokenId);

  await tx(ctx.db, async (client) => {
    await client.query(
      `INSERT INTO core.ai_identity_tokens (ai_id, token_id, chain_id, contract_address, creator_address, owner_address, mint_tx_hash, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (ai_id) DO UPDATE SET token_id = EXCLUDED.token_id, owner_address = EXCLUDED.owner_address, synced_at = now()`,
      [ai.id, tokenId.toString(), chain.chainId, chain.registryAddress.toLowerCase(), identity.creator.toLowerCase(), identity.owner.toLowerCase(), txHash ?? `adopted:${tokenId}`, Number(identity.version)],
    );
    await client.query('UPDATE core.ai_versions SET published_at = COALESCE(published_at, now()), onchain_tx_hash = COALESCE(onchain_tx_hash, $2) WHERE id = $1', [version.id, txHash]);
    await client.query(`UPDATE core.personal_ais SET status = 'verified', current_version_id = $2 WHERE id = $1`, [ai.id, version.id]);
    await audit(client, {
      action: 'ai.minted',
      actorService: 'core.jobs',
      entityType: 'ai',
      entityId: ai.id,
      data: { tokenId: tokenId.toString(), txHash, chainId: chain.chainId, manifestCid: version.manifest_cid },
    });
    await publish(client, 'ai.verified', { aiId: ai.id, tokenId: tokenId.toString(), ownerId: ai.owner_id });
    await notify(client, {
      userId: ai.owner_id,
      category: 'transaction',
      type: 'ai.verified',
      title: `${ai.name} is verified`,
      body: `Its AI identity token #${tokenId} is on-chain. You can now bring it to ALTERA.`,
      data: { aiId: ai.id, tokenId: tokenId.toString(), txHash },
      link: 'alter://training',
    });
    await announceAi(client, ai.id, 'verified');
  });
  return { txHash, tokenId: tokenId.toString(), blockNumber: blockNumber?.toString() ?? null };
};

const mintFailed: FailureHandler = async (ctx, job, error) => {
  await tx(ctx.db, async (client) => {
    await client.query(`UPDATE core.personal_ais SET status = 'ready' WHERE id = $1 AND status = 'minting'`, [job.payload.aiId]);
    await audit(client, { action: 'ai.mint_failed', actorService: 'core.jobs', entityType: 'ai', entityId: job.payload.aiId!, data: { error: error.message.slice(0, 300) } });
    const { rows } = await client.query<{ owner_id: string; name: string }>('SELECT owner_id, name FROM core.personal_ais WHERE id = $1', [job.payload.aiId]);
    if (rows[0]) {
      await notify(client, {
        userId: rows[0].owner_id,
        category: 'transaction',
        type: 'ai.deploy_failed',
        title: `Deploying ${rows[0].name} did not work`,
        body: 'Nothing was charged. You can try again from Train & deploy.',
        data: { aiId: job.payload.aiId, error: error.message.slice(0, 200) },
        link: 'alter://training',
      });
    }
  });
};

// ---------------------------------------------------------------- publish_version

const publishVersion: Handler = async (ctx, job, save) => {
  const chain = ctx.chain;
  if (!chain) throw new AppError(503, 'CHAIN_DISABLED', 'The blockchain is not configured.');
  const version = await loadVersion(ctx.db, job.payload.versionId!);
  const { rows } = await ctx.db.query<{ token_id: string }>('SELECT token_id FROM core.ai_identity_tokens WHERE ai_id = $1', [job.payload.aiId]);
  if (!version || !rows[0]) throw new AppError(404, 'NOT_FOUND', 'Version or token not found.');
  const tokenId = BigInt(rows[0].token_id);

  // Already recorded on-chain by an earlier attempt? Then only the database needs catching up.
  const before = await chain.readIdentity(tokenId);
  let txHash = (job.result?.txHash as string | undefined) ?? null;
  if (before.manifestCid !== version.manifest_cid) {
    const published = await chain.publishVersion(tokenId, version.manifest_cid);
    txHash = published.hash;
    await save({ txHash });
  }
  const after = await chain.readIdentity(tokenId);
  await tx(ctx.db, async (client) => {
    await client.query('UPDATE core.ai_versions SET published_at = COALESCE(published_at, now()), onchain_tx_hash = COALESCE(onchain_tx_hash, $2) WHERE id = $1', [version.id, txHash]);
    await client.query('UPDATE core.personal_ais SET current_version_id = $2 WHERE id = $1', [version.ai_id, version.id]);
    await client.query('UPDATE core.ai_identity_tokens SET version = $2, synced_at = now() WHERE ai_id = $1', [version.ai_id, Number(after.version)]);
    await audit(client, {
      action: 'ai.version_published',
      actorService: 'core.jobs',
      entityType: 'ai',
      entityId: version.ai_id,
      data: { version: version.version_no, onchainVersion: Number(after.version), txHash, manifestCid: version.manifest_cid },
    });
    await publish(client, 'ai.version_published', { aiId: version.ai_id, version: version.version_no });
    const { rows: owners } = await client.query<{ owner_id: string; name: string }>('SELECT owner_id, name FROM core.personal_ais WHERE id = $1', [version.ai_id]);
    if (owners[0]) {
      await notify(client, {
        userId: owners[0].owner_id,
        category: 'transaction',
        type: 'ai.version_live',
        title: `${owners[0].name} v${version.version_no} is live everywhere`,
        body: 'ALTERA and ALTAR now use this version.',
        data: { aiId: version.ai_id, version: version.version_no, txHash },
      });
    }
    await announceAi(client, version.ai_id, 'version_published');
  });
  return { txHash, onchainVersion: Number(after.version) };
};

// ---------------------------------------------------------------- starter_funds

/** Sends a new account its starter test POL on ALT's own test chain (STARTER_TEST_POL; never a public network). */
const starterFunds: Handler = async (ctx, job) => {
  const chain = ctx.chain;
  if (!chain?.isLocalDevChain) throw new AppError(409, 'NOT_A_TEST_CHAIN', 'Starter funds are only given on the ALT test chain.');
  const amount = parseEther(String(ctx.config.starterTestPol));
  const hash = await chain.giveTestFunds(job.payload.address!, amount);
  await tx(ctx.db, async (client) => {
    await audit(client, {
      action: 'wallet.starter_funds',
      actorService: 'core.jobs',
      entityType: 'wallet',
      entityId: job.payload.userId!,
      data: { hash, address: job.payload.address, amountWei: amount.toString() },
    });
    await notify(client, {
      userId: job.payload.userId!,
      category: 'transaction',
      type: 'wallet.starter_funds',
      title: `${ctx.config.starterTestPol} test POL added to your ALT wallet`,
      body: 'Test POL on the ALT test chain, so you can try buying, renting and subscribing. It has no real value.',
      data: { hash },
      link: '/wallet',
    });
  });
  return { hash };
};

const HANDLERS: Record<string, { run: Handler; failed?: FailureHandler }> = {
  mint_ait: { run: mintAit, failed: mintFailed },
  publish_version: { run: publishVersion },
  starter_funds: { run: starterFunds },
  // Labelled stand-in for the real trainer (TRAINING_MODE=simulated); see modules/ai/training.ts.
  simulate_training: {
    run: (ctx, job) => runSimulatedTraining(ctx, job.payload.trainingJobId!),
    failed: (ctx, job, error) => simulatedTrainingFailed(ctx, job.payload.trainingJobId!, error),
  },
  evaluate_version: {
    run: (ctx, job) => runEvaluation(ctx, job.payload.evaluationId!),
    failed: (ctx, job, error) => evaluationFailed(ctx, job.payload.evaluationId!, error),
  },
};

/**
 * Durable background work. Jobs live in core.jobs; any number of Core instances can run this loop
 * safely because a job is claimed with FOR UPDATE SKIP LOCKED. New jobs wake the loop via NOTIFY.
 */
export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private listener: pg.Client | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly ctx: Ctx) {}

  async start(pollMs = 2000) {
    // Jobs left "running" by a crashed process go back in the queue.
    await this.ctx.db.query(`UPDATE core.jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '10 minutes'`);
    this.timer = setInterval(() => void this.drain(), pollMs);
    try {
      this.listener = new pg.Client({ connectionString: this.ctx.config.databaseUrl });
      await this.listener.connect();
      await this.listener.query('LISTEN alt_jobs');
      this.listener.on('notification', () => void this.drain());
      this.listener.on('error', () => {
        this.listener = null;
      });
    } catch {
      this.listener = null; // polling still works
    }
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.end().catch(() => {});
  }

  /** Runs jobs until none are ready. Returns how many ran. */
  async drain() {
    if (this.running || this.stopped) return 0;
    this.running = true;
    let n = 0;
    try {
      while (!this.stopped && (await this.runOnce())) n++;
    } finally {
      this.running = false;
    }
    return n;
  }

  async runOnce(): Promise<boolean> {
    const { rows } = await this.ctx.db.query<JobRow>(
      `UPDATE core.jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM core.jobs WHERE status = 'queued' AND run_after <= now()
                     ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, kind, payload, attempts, max_attempts, result`,
    );
    const job = rows[0];
    if (!job) return false;
    const handler = HANDLERS[job.kind];
    const save = async (result: Record<string, unknown>) => {
      job.result = { ...(job.result ?? {}), ...result };
      await this.ctx.db.query('UPDATE core.jobs SET result = $2 WHERE id = $1', [job.id, job.result]);
    };
    try {
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      const result = await handler.run(this.ctx, job, save);
      await this.ctx.db.query(`UPDATE core.jobs SET status = 'done', locked_at = NULL, result = $2, last_error = NULL WHERE id = $1`, [job.id, { ...(job.result ?? {}), ...result }]);
    } catch (err) {
      const error = err as Error;
      // Refusals by the contract (e.g. AIAlreadyMinted with a different id) will not fix themselves.
      const permanent = err instanceof AppError && err.status < 500 && err.code !== 'CHAIN_UNAVAILABLE';
      if (!permanent && job.attempts < job.max_attempts) {
        const delaySeconds = 5 * job.attempts * job.attempts;
        await this.ctx.db.query(
          `UPDATE core.jobs SET status = 'queued', locked_at = NULL, last_error = $2, run_after = now() + make_interval(secs => $3) WHERE id = $1`,
          [job.id, error.message.slice(0, 500), delaySeconds],
        );
      } else {
        await this.ctx.db.query(`UPDATE core.jobs SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1`, [job.id, error.message.slice(0, 500)]);
        await handler?.failed?.(this.ctx, job, error).catch(() => {});
      }
    }
    return true;
  }
}
