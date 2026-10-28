import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit, publish } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { AVATAR_MAX_BYTES, isTrustedMediaUrl, saveAvatar } from '../../lib/media.js';
import { checkAvatarUrl, defaultAvatar } from '../../lib/avatars.js';
import { respond } from '../../modules/ai/engine.js';
import { buildVersion, clearance, requestDeploy, requestPublish } from '../../modules/ai/lifecycle.js';
import { listTrainings, startTraining, trainingOut } from '../../modules/ai/training.js';
import { addEvalItem, deleteEvalItem, evalItems, evaluationOut, latestEvaluation, requestEvaluation, setVerdict } from '../../modules/ai/evaluation.js';
import { checkSafety } from '../../modules/ai/moderation.js';
import { indexItems, searchAis } from '../../modules/ai/semantic.js';
import { describe as describeStyle, profileFor, STYLE_CHARS, STYLE_MIN_SAMPLES, styleFeatures, styleMatch, styleScore } from '../../modules/ai/style.js';
import { CHANNELS, PersonaConfig, parsePersona, personaFromOnboarding } from '../../modules/ai/persona.js';
import {
  assertMutable,
  CONSENT_POLICY_VERSION,
  CONSENT_SCOPES,
  CONSENT_TEXT,
  consentState,
  latestVersion,
  extractDocumentText,
  loadAi,
  readDatasetFile,
  readDatasetText,
  removeDatasetFile,
  requireConsent,
  requireOwnedAi,
  writeDatasetFile,
  writeDatasetText,
  type AiRow,
} from '../../modules/ai/repo.js';
import { requireService, requireUser } from '../auth-guard.js';
import { Handle } from '../schemas.js';

const AiId = z.object({ id: z.uuid() });
/** The platform asking, so a person's per-platform picture can be used. */
const PictureOn = z.enum(['alter', 'altera', 'altar']);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);
const MAX_DATASET_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

/** Personal AIs: created and trained in ALTER, verified on-chain, then available everywhere. */
export async function aiRoutes(app: FastifyInstance, ctx: Ctx) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = requireUser(ctx);

  async function tokenOf(aiId: string) {
    const { rows } = await ctx.db.query(
      'SELECT token_id, chain_id, contract_address, owner_address, creator_address, mint_tx_hash, version, suspended, minted_at FROM core.ai_identity_tokens WHERE ai_id = $1',
      [aiId],
    );
    const t = rows[0];
    if (!t) return null;
    return {
      tokenId: String(t.token_id),
      chainId: t.chain_id as number,
      contract: t.contract_address as string,
      owner: t.owner_address as string,
      creator: t.creator_address as string,
      mintTx: t.mint_tx_hash as string,
      onchainVersion: t.version as number,
      suspended: t.suspended as boolean,
      mintedAt: (t.minted_at as Date).toISOString(),
      explorer: ctx.chain?.explorerToken(String(t.token_id)) ?? null,
      mintTxExplorer: ctx.chain?.explorerTx(t.mint_tx_hash) ?? null,
      verifyUrl: `${ctx.config.publicUrl}/core/verify/token/${t.token_id}`,
    };
  }

  /**
   * Public names for a set of people (owners and creators shown next to an AI). With `platform`, a
   * picture the person chose for that platform wins over their global one.
   */
  async function peopleById(ids: string[], platform?: string) {
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.handle, u.display_name, COALESCE(pa.avatar_url, u.avatar_url) AS avatar_url
         FROM core.users u LEFT JOIN core.platform_avatars pa ON pa.user_id = u.id AND pa.platform::text = $2
        WHERE u.id = ANY($1::uuid[])`,
      [[...new Set(ids)], platform ?? null],
    );
    return (id: string) => {
      const p = rows.find((x) => x.id === id);
      return p ? { id: p.id as string, handle: p.handle as string, displayName: p.display_name as string, avatarUrl: (p.avatar_url as string | null) ?? null } : null;
    };
  }

  async function summary(ai: AiRow) {
    const [token, current] = await Promise.all([
      tokenOf(ai.id),
      ai.current_version_id ? ctx.db.query('SELECT version_no, manifest_cid FROM core.ai_versions WHERE id = $1', [ai.current_version_id]) : null,
    ]);
    return {
      id: ai.id,
      handle: ai.handle,
      name: ai.name,
      description: ai.description,
      avatarUrl: ai.avatar_url,
      category: ai.category,
      status: ai.status,
      verified: ai.status === 'verified',
      healthScore: Number(ai.health_score),
      royaltyBps: ai.royalty_bps,
      currentVersion: current?.rows[0] ? { version: current.rows[0].version_no as number, manifestCid: current.rows[0].manifest_cid as string } : null,
      token,
      createdAt: ai.created_at.toISOString(),
    };
  }

  async function detail(ai: AiRow) {
    const [base, consents, latest, counts] = await Promise.all([
      summary(ai),
      consentState(ctx.db, ai.id),
      latestVersion(ctx.db, ai.id),
      ctx.db.query(
        `SELECT (SELECT count(*) FROM core.datasets WHERE ai_id = $1 AND deleted_at IS NULL) AS datasets,
                (SELECT count(*) FROM core.ai_memories WHERE ai_id = $1 AND status = 'approved') AS memories,
                (SELECT count(*) FROM core.ai_memories WHERE ai_id = $1 AND status = 'proposed') AS proposed_memories`,
        [ai.id],
      ),
    ]);
    return {
      ...base,
      persona: parsePersona(ai.draft_config),
      royaltyBps: ai.royalty_bps,
      ownerConfirmed: Boolean(ai.owner_confirmed_at),
      consents,
      latestVersion: latest ? { id: latest.id, version: latest.version_no, manifestCid: latest.manifest_cid, published: Boolean(latest.published_at) } : null,
      counts: {
        datasets: Number(counts.rows[0].datasets),
        memories: Number(counts.rows[0].memories),
        proposedMemories: Number(counts.rows[0].proposed_memories),
      },
    };
  }

  // ---------------------------------------------------------------- create & manage

  r.post(
    '/ais',
    {
      preHandler: authed,
      schema: {
        tags: ['ai'],
        summary: 'Create a personal AI (from ALTER onboarding)',
        body: z.object({
          name: z.string().trim().min(1).max(80),
          handle: Handle,
          description: z.string().max(500).optional(),
          category: z.string().max(40).default('personal'),
          royaltyBps: z.number().int().min(0).max(1000).default(500),
          persona: PersonaConfig.optional(),
          onboarding: z
            .object({
              about: z.string().max(1000).optional(),
              pronouns: z.string().max(30).optional(),
              age: z.number().int().min(13).max(120).optional(),
              roles: z.array(z.string().max(40)).max(10).optional(),
              primaryTrait: z.string().max(40).optional(),
            })
            .optional(),
          consents: z.partialRecord(z.enum(CONSENT_SCOPES), z.boolean()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const persona = b.persona ?? personaFromOnboarding(b.onboarding ?? {});
      const ai = await tx(ctx.db, async (client) => {
        const taken = await client.query('SELECT 1 FROM core.personal_ais WHERE handle = $1 UNION SELECT 1 FROM core.users WHERE handle = $1', [b.handle]);
        if (taken.rowCount) throw conflict('HANDLE_TAKEN', 'That handle is already taken.');
        const { rows } = await client.query<AiRow>(
          `INSERT INTO core.personal_ais (owner_id, creator_id, handle, name, description, category, royalty_bps, draft_config)
           VALUES ($1, $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [req.auth!.userId, b.handle, b.name, b.description ?? null, b.category, b.royaltyBps, persona],
        );
        const ai = rows[0]!;
        // A ready-made robot or sci-fi picture until the owner chooses one.
        ai.avatar_url = defaultAvatar(ctx, 'ai', ai.id);
        await client.query('UPDATE core.personal_ais SET avatar_url = $2 WHERE id = $1', [ai.id, ai.avatar_url]);
        for (const [scope, granted] of Object.entries(b.consents ?? {})) {
          await client.query(
            'INSERT INTO core.consent_events (user_id, ai_id, scope, granted, policy_version, ip) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.auth!.userId, ai.id, scope, granted, CONSENT_POLICY_VERSION, req.ip],
          );
        }
        // Creating an AI makes the person a creator.
        await client.query(
          `UPDATE core.users SET roles = array_append(roles, 'creator') WHERE id = $1 AND NOT ('creator' = ANY(roles))`,
          [req.auth!.userId],
        );
        await audit(client, { action: 'ai.created', actorUserId: req.auth!.userId, entityType: 'ai', entityId: ai.id, ip: req.ip, data: { handle: b.handle, consents: b.consents ?? {} } });
        return ai;
      });
      return reply.status(201).send(await detail(ai));
    },
  );

  r.get('/ais', { preHandler: authed, schema: { tags: ['ai'], summary: 'My personal AIs' } }, async (req) => {
    const { rows } = await ctx.db.query<AiRow>('SELECT * FROM core.personal_ais WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at', [req.auth!.userId]);
    return Promise.all(rows.map(summary));
  });

  // Every AI on this ALT account, the same in ALTER, ALTERA and ALTAR: the ones the person owns
  // (until they sell them) and the ones they rent or subscribe to (until that time ends). An ended
  // rental or subscription stays listed, inactive, so its conversations can still be read; renting
  // or subscribing again makes it active and the same conversations carry on. An AI the person sold
  // stays too ("former_owner", inactive) while they have chats with it, read-only.
  r.get(
    '/me/ais',
    { preHandler: authed, schema: { tags: ['ai'], summary: 'Every AI on my account: owned, rented and subscribed, active or ended' } },
    async (req) => {
      const me = req.auth!.userId;
      const [owned, rented, subscribed, talked] = await Promise.all([
        ctx.db.query<{ id: string }>('SELECT id FROM core.personal_ais WHERE owner_id = $1 AND deleted_at IS NULL', [me]),
        ctx.db.query<{ id: string; until: Date }>(
          `SELECT t.ai_id AS id, t.user_expires AS until FROM core.ai_identity_tokens t JOIN core.wallets w ON w.address = t.user_address
            WHERE w.user_id = $1 AND t.user_expires > now()`,
          [me],
        ),
        ctx.db.query<{ id: string; until: Date }>(
          `SELECT s.ai_id AS id, max(s.expires_at) AS until FROM core.ai_subscriptions s JOIN core.wallets w ON w.address = s.subscriber_address
            WHERE w.user_id = $1 GROUP BY s.ai_id`,
          [me],
        ),
        // Paid conversations (rentals and subscriptions share this channel) from an access that has ended.
        ctx.db.query<{ id: string }>(`SELECT DISTINCT ai_id AS id FROM core.chat_sessions WHERE user_id = $1 AND channel = 'altar_rental'`, [me]),
      ]);
      // ALTER chats from when the person owned an AI they have since sold.
      const ownedChats = await ctx.db.query<{ id: string }>(`SELECT DISTINCT ai_id AS id FROM core.chat_sessions WHERE user_id = $1 AND channel = 'alter_chat'`, [me]);
      type Access = { role: 'owner' | 'renter' | 'subscriber' | 'former_owner'; until: Date | null; active: boolean };
      const access = new Map<string, Access>();
      const add = (id: string, a: Access) => {
        const had = access.get(id);
        if (!had || (!had.active && a.active)) access.set(id, a);
      };
      for (const r of owned.rows) add(r.id, { role: 'owner', until: null, active: true });
      for (const r of rented.rows) add(r.id, { role: 'renter', until: r.until, active: true });
      for (const r of subscribed.rows) add(r.id, { role: 'subscriber', until: r.until, active: r.until.getTime() > Date.now() });
      for (const r of talked.rows) add(r.id, { role: 'renter', until: null, active: false });
      for (const r of ownedChats.rows) add(r.id, { role: 'former_owner', until: null, active: false });

      const { rows } = await ctx.db.query<AiRow>('SELECT * FROM core.personal_ais WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY created_at', [[...access.keys()]]);
      const rank = (a: Access) => (a.role === 'owner' ? 0 : a.active ? 1 : 2);
      const items = await Promise.all(
        rows.map(async (ai) => {
          const a = access.get(ai.id)!;
          return { ...(await summary(ai)), created: ai.creator_id === me, access: { role: a.role, until: a.until?.toISOString() ?? null, active: a.active } };
        }),
      );
      return items.sort((x, y) => rank(x.access as Access) - rank(y.access as Access));
    },
  );

  r.get('/ais/:id', { preHandler: authed, schema: { tags: ['ai'], summary: 'One of my AIs, in full', params: AiId } }, async (req) =>
    detail(await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id)),
  );

  r.patch(
    '/ais/:id',
    {
      preHandler: authed,
      schema: {
        tags: ['ai'],
        summary: 'Edit the AI (persona changes go into the draft; publish a version to apply them everywhere)',
        params: AiId,
        body: z.object({
          name: z.string().trim().min(1).max(80).optional(),
          description: z.string().max(500).nullable().optional(),
          category: z.string().max(40).optional(),
          avatarUrl: z.url().max(500).nullable().optional(),
          persona: PersonaConfig.optional(),
        }),
      },
    },
    async (req) => {
      if (req.body.avatarUrl && !isTrustedMediaUrl(ctx, req.body.avatarUrl)) {
        throw badRequest('UNTRUSTED_AVATAR', 'Upload the picture to ALT first (POST /ais/:id/avatar).');
      }
      // AIs use the robot and sci-fi sets, never the people ones.
      if (req.body.avatarUrl) checkAvatarUrl(ctx, req.body.avatarUrl, 'ai');
      const ai = await tx(ctx.db, async (client) => {
        const ai = await requireOwnedAi(client, req.auth!.userId, req.params.id, true);
        assertMutable(ai);
        const b = req.body;
        const personaChanged = b.persona !== undefined;
        await client.query(
          `UPDATE core.personal_ais SET
             name = COALESCE($2, name),
             description = CASE WHEN $3 THEN $4 ELSE description END,
             category = COALESCE($5, category),
             avatar_url = CASE WHEN $6 THEN $7 ELSE avatar_url END,
             draft_config = COALESCE($8, draft_config),
             owner_confirmed_at = CASE WHEN $9 THEN NULL ELSE owner_confirmed_at END
           WHERE id = $1`,
          [ai.id, b.name ?? null, b.description !== undefined, b.description ?? null, b.category ?? null, b.avatarUrl !== undefined, b.avatarUrl === null ? defaultAvatar(ctx, 'ai', ai.id) : (b.avatarUrl ?? null), b.persona ?? null, personaChanged],
        );
        if (!personaChanged && ai.status === 'verified') {
          // Presentation (name, avatar...) syncs to other platforms in real time; behaviour waits for a version.
          await publish(client, 'ai.updated', { aiId: ai.id, fields: Object.keys(b) });
          await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: ai.id, event: 'updated' })]);
        }
        return loadAi(client, ai.id);
      });
      return detail(ai!);
    },
  );

  r.delete('/ais/:id', { preHandler: authed, schema: { tags: ['ai'], summary: 'Delete a draft AI and its data', params: AiId } }, async (req) => {
    await tx(ctx.db, async (client) => {
      const ai = await requireOwnedAi(client, req.auth!.userId, req.params.id, true);
      if (ai.status === 'verified' || ai.status === 'minting') {
        throw conflict('AI_HAS_IDENTITY', 'An AI with an identity token cannot be deleted; it can be retired.');
      }
      const { rows } = await client.query<{ id: string }>('UPDATE core.datasets SET deleted_at = now() WHERE ai_id = $1 AND deleted_at IS NULL RETURNING id', [ai.id]);
      for (const d of rows) await removeDatasetFile(ctx, d.id);
      await client.query(`UPDATE core.personal_ais SET deleted_at = now(), status = 'retired' WHERE id = $1`, [ai.id]);
      await audit(client, { action: 'ai.deleted', actorUserId: req.auth!.userId, entityType: 'ai', entityId: ai.id, ip: req.ip });
    });
    return { deleted: true };
  });

  // ---------------------------------------------------------------- consent (Module 8)

  r.get('/ais/:id/consents', { preHandler: authed, schema: { tags: ['consent'], summary: 'Current consent for each purpose', params: AiId } }, async (req) => {
    const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
    const state = await consentState(ctx.db, ai.id);
    return CONSENT_SCOPES.map((scope) => ({ scope, text: CONSENT_TEXT[scope], ...state[scope] }));
  });

  r.put(
    '/ais/:id/consents/:scope',
    {
      preHandler: authed,
      schema: {
        tags: ['consent'],
        summary: 'Give or withdraw consent (recorded permanently, with the policy version)',
        params: z.object({ id: z.uuid(), scope: z.enum(CONSENT_SCOPES) }),
        body: z.object({ granted: z.boolean() }),
      },
    },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      await tx(ctx.db, async (client) => {
        await client.query('INSERT INTO core.consent_events (user_id, ai_id, scope, granted, policy_version, ip) VALUES ($1, $2, $3, $4, $5, $6)', [
          req.auth!.userId,
          ai.id,
          req.params.scope,
          req.body.granted,
          CONSENT_POLICY_VERSION,
          req.ip,
        ]);
        await audit(client, {
          action: req.body.granted ? 'consent.granted' : 'consent.withdrawn',
          actorUserId: req.auth!.userId,
          entityType: 'ai',
          entityId: ai.id,
          ip: req.ip,
          data: { scope: req.params.scope, policyVersion: CONSENT_POLICY_VERSION },
        });
      });
      const state = await consentState(ctx.db, ai.id);
      return { scope: req.params.scope, text: CONSENT_TEXT[req.params.scope], ...state[req.params.scope] };
    },
  );

  // ---------------------------------------------------------------- datasets (Module 8)

  const datasetOut = (d: Record<string, unknown>) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    fileName: d.file_name,
    mimeType: d.mime_type,
    sizeBytes: Number(d.size_bytes),
    sha256: d.sha256,
    category: d.training_category,
    included: d.included,
    processed: d.is_processed,
    usableAsText: Boolean(d.text_chars),
    createdAt: (d.created_at as Date).toISOString(),
  });

  r.get('/ais/:id/datasets', { preHandler: authed, schema: { tags: ['datasets'], summary: 'Data added to this AI', params: AiId } }, async (req) => {
    const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
    // Only what this person added: after a sale, the previous owner's files stay sealed from the buyer.
    const { rows } = await ctx.db.query('SELECT * FROM core.datasets WHERE ai_id = $1 AND owner_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC', [ai.id, req.auth!.userId]);
    return rows.map(datasetOut);
  });

  async function addDataset(
    userId: string,
    ai: AiRow,
    item: { kind: string; title: string; fileName: string | null; mimeType: string | null; bytes: Buffer; category: string; isText: boolean },
  ) {
    const id = crypto.randomUUID();
    const storageKey = await writeDatasetFile(ctx, id, item.bytes);
    // Documents (PDFs) are read now: their text is extracted once and kept, encrypted, beside them.
    const extracted = item.isText ? null : await extractDocumentText(item.bytes, item.mimeType);
    if (extracted) await writeDatasetText(ctx, id, extracted);
    const textChars = item.isText ? item.bytes.toString('utf8').length : (extracted?.length ?? 0);
    const { rows } = await tx(ctx.db, async (client) => {
      const res = await client.query(
        `INSERT INTO core.datasets (id, ai_id, owner_id, kind, title, file_name, mime_type, size_bytes, storage_key, sha256, training_category, is_processed, text_chars)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [id, ai.id, userId, item.kind, item.title, item.fileName, item.mimeType, item.bytes.length, storageKey, sha256(item.bytes), item.category, item.isText || Boolean(extracted), textChars],
      );
      await audit(client, { action: 'dataset.added', actorUserId: userId, entityType: 'ai', entityId: ai.id, data: { datasetId: id, kind: item.kind, bytes: item.bytes.length } });
      return res;
    });
    const text = item.isText ? item.bytes.toString('utf8') : extracted;
    if (text) void indexItems(ctx, [{ id, title: item.title, text }]);
    return datasetOut(rows[0]);
  }

  r.post(
    '/ais/:id/datasets',
    {
      preHandler: authed,
      schema: {
        tags: ['datasets'],
        summary: 'Add written information (notes, bio, writing samples)',
        params: AiId,
        body: z.object({
          title: z.string().trim().min(1).max(120),
          text: z.string().min(1).max(MAX_TEXT_CHARS),
          category: z.enum(['personality', 'knowledge', 'communication_style', 'preferences']).default('knowledge'),
        }),
      },
    },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      assertMutable(ai);
      await requireConsent(ctx.db, ai.id, 'persona_training');
      const item = await addDataset(req.auth!.userId, ai, {
        kind: 'text',
        title: req.body.title,
        fileName: null,
        mimeType: 'text/plain',
        bytes: Buffer.from(req.body.text, 'utf8'),
        category: req.body.category,
        isText: true,
      });
      return reply.status(201).send(item);
    },
  );

  r.post(
    '/ais/:id/datasets/upload',
    { preHandler: authed, schema: { tags: ['datasets'], summary: 'Upload a file (text files and PDFs are read; images and voice notes are stored for later training)', params: AiId, consumes: ['multipart/form-data'] } },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      assertMutable(ai);
      await requireConsent(ctx.db, ai.id, 'persona_training');
      const file = await req.file({ limits: { fileSize: MAX_DATASET_BYTES, files: 1 } });
      if (!file) throw badRequest('FILE_REQUIRED', 'Attach a file.');
      const bytes = await file.toBuffer();
      if (file.file.truncated) throw badRequest('FILE_TOO_LARGE', 'Files can be up to 10 MB.');
      const mime = file.mimetype;
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'voice' : TEXT_TYPES.has(mime) ? 'text' : 'document';
      const fields = file.fields as Record<string, { value?: string } | undefined>;
      const category = fields.category?.value ?? 'knowledge';
      const item = await addDataset(req.auth!.userId, ai, {
        kind,
        title: (fields.title?.value ?? file.filename).slice(0, 120),
        fileName: file.filename.slice(0, 255),
        mimeType: mime,
        bytes,
        category: ['personality', 'knowledge', 'communication_style', 'preferences'].includes(category) ? category : 'knowledge',
        isText: kind === 'text',
      });
      return reply.status(201).send(item);
    },
  );

  r.get(
    '/ais/:id/datasets/:datasetId/content',
    {
      preHandler: authed,
      schema: {
        tags: ['datasets'],
        summary: 'Read back what you added (owner only); ?as=text gives the text the AI reads (for a PDF, the text extracted from it)',
        params: z.object({ id: z.uuid(), datasetId: z.uuid() }),
        querystring: z.object({ as: z.enum(['file', 'text']).default('file') }),
      },
    },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const { rows } = await ctx.db.query('SELECT mime_type, file_name, kind, text_chars FROM core.datasets WHERE id = $1 AND ai_id = $2 AND owner_id = $3 AND deleted_at IS NULL', [req.params.datasetId, ai.id, req.auth!.userId]);
      if (!rows[0]) throw notFound('Item');
      if (req.query.as === 'text' && rows[0].kind !== 'text') {
        if (!rows[0].text_chars) throw notFound('Text');
        reply.header('cache-control', 'private, no-store').type('text/plain; charset=utf-8');
        return reply.send(await readDatasetText(ctx, req.params.datasetId));
      }
      reply.header('cache-control', 'private, no-store').type(rows[0].mime_type ?? 'application/octet-stream');
      return reply.send(await readDatasetFile(ctx, req.params.datasetId));
    },
  );

  r.patch(
    '/ais/:id/datasets/:datasetId',
    {
      preHandler: authed,
      schema: {
        tags: ['datasets'],
        summary: 'Include or exclude an item from training, or recategorise it',
        params: z.object({ id: z.uuid(), datasetId: z.uuid() }),
        body: z.object({
          included: z.boolean().optional(),
          title: z.string().trim().min(1).max(120).optional(),
          category: z.enum(['personality', 'knowledge', 'communication_style', 'preferences']).optional(),
        }),
      },
    },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const { rows } = await tx(ctx.db, async (client) => {
        const res = await client.query(
          `UPDATE core.datasets SET included = COALESCE($3, included), title = COALESCE($4, title), training_category = COALESCE($5, training_category)
            WHERE id = $1 AND ai_id = $2 AND owner_id = $6 AND deleted_at IS NULL RETURNING *`,
          [req.params.datasetId, ai.id, req.body.included ?? null, req.body.title ?? null, req.body.category ?? null, req.auth!.userId],
        );
        if (!res.rows[0]) throw notFound('Item');
        if (req.body.included !== undefined) {
          await audit(client, {
            action: req.body.included ? 'dataset.included' : 'dataset.excluded',
            actorUserId: req.auth!.userId,
            entityType: 'ai',
            entityId: ai.id,
            data: { datasetId: req.params.datasetId },
          });
        }
        return res;
      });
      return datasetOut(rows[0]);
    },
  );

  r.delete(
    '/ais/:id/datasets/:datasetId',
    { preHandler: authed, schema: { tags: ['datasets'], summary: 'Delete an item and its file for good', params: z.object({ id: z.uuid(), datasetId: z.uuid() }) } },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      await tx(ctx.db, async (client) => {
        const { rowCount } = await client.query(
          'UPDATE core.datasets SET deleted_at = now(), included = false WHERE id = $1 AND ai_id = $2 AND owner_id = $3 AND deleted_at IS NULL',
          [req.params.datasetId, ai.id, req.auth!.userId],
        );
        if (!rowCount) throw notFound('Item');
        await audit(client, { action: 'dataset.deleted', actorUserId: req.auth!.userId, entityType: 'ai', entityId: ai.id, data: { datasetId: req.params.datasetId } });
      });
      await removeDatasetFile(ctx, req.params.datasetId);
      return { deleted: true };
    },
  );

  r.post(
    '/ais/:id/avatar',
    { preHandler: authed, schema: { tags: ['ai'], summary: 'Upload the AI’s picture (PNG, JPEG or WebP, up to 5 MB)', params: AiId, consumes: ['multipart/form-data'] } },
    async (req) => {
      const owned = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      assertMutable(owned);
      const url = await saveAvatar(ctx, await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }), owned.id);
      const ai = await tx(ctx.db, async (client) => {
        await client.query('UPDATE core.personal_ais SET avatar_url = $2 WHERE id = $1', [owned.id, url]);
        if (owned.status === 'verified') {
          // ALTERA picks the new picture up straight away (presentation does not need a new version).
          await publish(client, 'ai.updated', { aiId: owned.id, fields: ['avatarUrl'] });
          await client.query(`SELECT pg_notify('alt_ai_events', $1)`, [JSON.stringify({ aiId: owned.id, event: 'updated' })]);
        }
        return loadAi(client, owned.id);
      });
      return detail(ai!);
    },
  );

  // ---------------------------------------------------------------- memories (Module 10 FE-6)

  r.get(
    '/ais/:id/memories',
    {
      preHandler: authed,
      schema: { tags: ['memories'], summary: 'What the AI remembers (and suggestions waiting for approval)', params: AiId, querystring: z.object({ status: z.enum(['proposed', 'approved', 'discarded']).optional() }) },
    },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const { rows } = await ctx.db.query(
        `SELECT id, content, source, status, created_at FROM core.ai_memories WHERE ai_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC`,
        [ai.id, req.query.status ?? null],
      );
      return rows.map((m) => ({ id: m.id, content: m.content, source: m.source, status: m.status, createdAt: (m.created_at as Date).toISOString() }));
    },
  );

  r.post(
    '/ais/:id/memories',
    { preHandler: authed, schema: { tags: ['memories'], summary: 'Teach the AI something to remember', params: AiId, body: z.object({ content: z.string().trim().min(3).max(500) }) } },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const { rows } = await ctx.db.query(
        `INSERT INTO core.ai_memories (ai_id, content, source, status, decided_at) VALUES ($1, $2, 'owner', 'approved', now()) RETURNING id, content, source, status, created_at`,
        [ai.id, req.body.content],
      );
      const m = rows[0];
      return reply.status(201).send({ id: m.id, content: m.content, source: m.source, status: m.status, createdAt: (m.created_at as Date).toISOString() });
    },
  );

  r.patch(
    '/ais/:id/memories/:memoryId',
    {
      preHandler: authed,
      schema: { tags: ['memories'], summary: 'Approve or discard a suggested memory', params: z.object({ id: z.uuid(), memoryId: z.uuid() }), body: z.object({ status: z.enum(['approved', 'discarded']) }) },
    },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const { rows } = await ctx.db.query(
        `UPDATE core.ai_memories SET status = $3, decided_at = now() WHERE id = $1 AND ai_id = $2 RETURNING id, content, source, status`,
        [req.params.memoryId, ai.id, req.body.status],
      );
      if (!rows[0]) throw notFound('Memory');
      return rows[0];
    },
  );

  // ---------------------------------------------------------------- chat (Module 10)

  r.post(
    '/ais/:id/chat/sessions',
    { preHandler: authed, schema: { tags: ['chat'], summary: 'Start a conversation with your AI', params: AiId, body: z.object({ title: z.string().max(120).optional() }).optional() } },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const { rows } = await ctx.db.query('INSERT INTO core.chat_sessions (ai_id, user_id, title) VALUES ($1, $2, $3) RETURNING id, title, created_at', [
        ai.id,
        req.auth!.userId,
        req.body?.title ?? null,
      ]);
      return reply.status(201).send({ id: rows[0].id, title: rows[0].title, createdAt: (rows[0].created_at as Date).toISOString() });
    },
  );

  r.get('/ais/:id/chat/sessions', { preHandler: authed, schema: { tags: ['chat'], summary: 'Your conversations with this AI', params: AiId } }, async (req) => {
    const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
    const { rows } = await ctx.db.query(
      `SELECT s.id, s.title, s.created_at, s.updated_at,
              (SELECT content FROM core.chat_messages m WHERE m.session_id = s.id ORDER BY id DESC LIMIT 1) AS last_message
         FROM core.chat_sessions s WHERE s.ai_id = $1 AND s.user_id = $2 ORDER BY s.updated_at DESC`,
      [ai.id, req.auth!.userId],
    );
    return rows.map((s) => ({ id: s.id, title: s.title, lastMessage: s.last_message, createdAt: (s.created_at as Date).toISOString(), updatedAt: (s.updated_at as Date).toISOString() }));
  });

  const SessionParams = z.object({ id: z.uuid(), sessionId: z.uuid() });

  async function requireSession(aiId: string, sessionId: string, userId: string) {
    const { rows } = await ctx.db.query('SELECT id FROM core.chat_sessions WHERE id = $1 AND ai_id = $2 AND user_id = $3', [sessionId, aiId, userId]);
    if (!rows[0]) throw notFound('Conversation');
  }

  const messageOut = (m: Record<string, unknown>) => ({
    id: String(m.id),
    role: m.role,
    content: m.content,
    flagged: m.flagged,
    model: m.model,
    createdAt: (m.created_at as Date).toISOString(),
  });

  r.get(
    '/ais/:id/style',
    { preHandler: authed, schema: { tags: ['ai'], summary: 'Sounds like you: how the AI writes compared with the person it represents (style-match model)', params: AiId } },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const profile = await profileFor(ctx, ai);
      const { rows } = await ctx.db.query<{ content: string }>(
        `SELECT m.content FROM core.chat_messages m JOIN core.chat_sessions s ON s.id = m.session_id
          WHERE s.ai_id = $1 AND m.role = 'assistant' AND NOT m.flagged ORDER BY m.id DESC LIMIT 10`,
        [ai.id],
      );
      const ready = profile.samples >= STYLE_MIN_SAMPLES;
      let score: number | null = null;
      let basis: string | null = null;
      if (ready && rows.length) {
        const vectors = profile.centroid && ctx.ml ? await ctx.ml.embed(rows.map((r) => r.content.slice(0, STYLE_CHARS)), 'passage') : null;
        const scored = rows.map((r, i) => styleScore(profile, r.content, vectors?.[i] ?? null));
        score = Number((scored.reduce((n, s) => n + s.score, 0) / scored.length).toFixed(3));
        basis = scored[0]!.withMeaning ? 'style+meaning' : 'style';
      }
      const aiFeatures = rows.map((r) => styleFeatures(r.content));
      const aiMean = aiFeatures[0]?.map((_, i) => aiFeatures.reduce((n, f) => n + f[i]!, 0) / aiFeatures.length);
      return {
        ready,
        samples: profile.samples,
        needed: STYLE_MIN_SAMPLES,
        score,
        basis,
        repliesScored: ready ? rows.length : 0,
        you: profile.samples ? describeStyle(profile.mean) : null,
        ai: aiMean ? describeStyle(aiMean) : null,
        model: 'ALT style-match baseline: logistic regression on writing-style features and embedding similarity',
      };
    },
  );

  r.get(
    '/ais/:id/chat/sessions/:sessionId/messages',
    { preHandler: authed, schema: { tags: ['chat'], summary: 'Messages in a conversation', params: SessionParams } },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      await requireSession(ai.id, req.params.sessionId, req.auth!.userId);
      const { rows } = await ctx.db.query('SELECT * FROM core.chat_messages WHERE session_id = $1 ORDER BY id', [req.params.sessionId]);
      return rows.map(messageOut);
    },
  );

  r.post(
    '/ais/:id/chat/sessions/:sessionId/messages',
    {
      preHandler: authed,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['chat'],
        summary: 'Send a message and get your AI’s reply',
        params: SessionParams,
        body: z.object({ content: z.string().trim().min(1).max(4000), version: z.enum(['draft', 'current']).default('draft') }),
      },
    },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      await requireSession(ai.id, req.params.sessionId, req.auth!.userId);
      const { rows: history } = await ctx.db.query<{ role: 'user' | 'assistant'; content: string }>(
        `SELECT role, content FROM (SELECT id, role, content FROM core.chat_messages WHERE session_id = $1 ORDER BY id DESC LIMIT 12) h ORDER BY id`,
        [req.params.sessionId],
      );
      const userCheck = await checkSafety(ctx.ml, req.body.content);
      const { rows: saved } = await ctx.db.query(
        `INSERT INTO core.chat_messages (session_id, role, content, flagged) VALUES ($1, 'user', $2, $3) RETURNING *`,
        [req.params.sessionId, req.body.content, userCheck.flagged],
      );
      const result = await respond(ctx, {
        ai,
        version: req.body.version,
        channel: 'alter_chat',
        messages: [...history, { role: 'user', content: req.body.content }],
        callerUserId: req.auth!.userId,
      });
      const { rows: replyRows } = await ctx.db.query(
        `INSERT INTO core.chat_messages (session_id, role, content, version_id, model, latency_ms, flagged) VALUES ($1, 'assistant', $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.sessionId, result.text, result.versionId, `${result.provider}:${result.model}`, result.latencyMs, result.flagged],
      );
      await ctx.db.query(
        'UPDATE core.chat_sessions SET updated_at = now(), title = COALESCE(title, $2) WHERE id = $1',
        [req.params.sessionId, req.body.content.slice(0, 60)],
      );

      // "Remember that ..." → a memory suggestion the owner approves (only with consent, Module 8).
      let proposedMemory = null;
      const remember = req.body.content.match(/\bremember(?: that)?[:,]?\s+(.{3,300})/i);
      if (remember && (await consentState(ctx.db, ai.id)).interaction_learning.granted) {
        const { rows } = await ctx.db.query(
          `INSERT INTO core.ai_memories (ai_id, content, source) VALUES ($1, $2, 'chat') RETURNING id, content, status`,
          [ai.id, remember[1]!.replace(/[.!\s]+$/, '')],
        );
        proposedMemory = rows[0];
      }
      // "Sounds like you": the style-match model's score for this reply (null until enough of the person's writing).
      const style = result.flagged ? null : await styleMatch(ctx, ai, result.text).catch(() => null);
      return { message: messageOut(saved[0]), reply: messageOut(replyRows[0]), provider: result.provider, proposedMemory, style };
    },
  );

  // ---------------------------------------------------------------- versions, clearance and deployment (Modules 6, 9, 17)

  r.post(
    '/ais/:id/versions',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Build the next version from the current draft, data and memories', params: AiId } },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      assertMutable(ai);
      const { version, jobId } = await buildVersion(ctx, ai.id, req.auth!.userId);
      return reply.status(201).send({
        id: version.id,
        version: version.version_no,
        manifestCid: version.manifest_cid,
        manifestSha256: version.manifest_sha256,
        manifestUrl: ctx.ipfs.gatewayUrl(version.manifest_cid),
        trainingJobId: jobId,
      });
    },
  );

  r.get('/ais/:id/versions', { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Version history', params: AiId } }, async (req) => {
    const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
    const { rows } = await ctx.db.query(
      `SELECT id, version_no, manifest_cid, manifest_sha256, onchain_tx_hash, created_at, published_at, array_length(dataset_ids, 1) AS datasets, array_length(memory_ids, 1) AS memories,
              engine, training_mode, readiness, owner_verdict
         FROM core.ai_versions WHERE ai_id = $1 ORDER BY version_no DESC`,
      [ai.id],
    );
    return rows.map((v) => ({
      id: v.id,
      version: v.version_no,
      manifestCid: v.manifest_cid,
      manifestUrl: ctx.ipfs.gatewayUrl(v.manifest_cid),
      manifestSha256: v.manifest_sha256,
      published: Boolean(v.published_at),
      current: v.id === ai.current_version_id,
      onchainTx: v.onchain_tx_hash,
      datasets: v.datasets ?? 0,
      memories: v.memories ?? 0,
      // The engine slot: `base` (persona on the base model) or `adapter` (trained); `simulated` is the stand-in.
      engine: v.engine,
      training: v.training_mode,
      simulated: v.training_mode === 'simulated',
      readiness: v.readiness === null ? null : Number(v.readiness),
      verdict: v.owner_verdict,
      createdAt: (v.created_at as Date).toISOString(),
    }));
  });

  r.post(
    '/ais/:id/trainings',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Train the AI on its consented data (simulated until ALT’s trainer runs; then queued for it)', params: AiId } },
    async (req, reply) => {
      const job = await startTraining(ctx, req.params.id, req.auth!.userId, req.ip);
      return reply.status(202).send(trainingOut(job));
    },
  );

  // ---------------------------------------------------------------- readiness and approval (Module 9 FE-2/FE-4)

  r.get('/ais/:id/evaluation-set', { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Your questions with your own answers (only you see them)', params: AiId } }, async (req) =>
    evalItems(ctx, (await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id)).id),
  );

  r.post(
    '/ais/:id/evaluation-set',
    {
      preHandler: authed,
      schema: { tags: ['lifecycle'], summary: 'Add a question with your own answer', params: AiId, body: z.object({ question: z.string().trim().min(3).max(500), answer: z.string().trim().min(1).max(4000) }) },
    },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      return reply.status(201).send(await addEvalItem(ctx, ai, req.auth!.userId, req.body.question, req.body.answer));
    },
  );

  r.delete(
    '/ais/:id/evaluation-set/:itemId',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Remove a question', params: z.object({ id: z.uuid(), itemId: z.uuid() }) } },
    async (req, reply) => {
      await deleteEvalItem(ctx, await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id), req.params.itemId);
      return reply.status(204).send();
    },
  );

  const VersionParams = z.object({ id: z.uuid(), versionId: z.uuid() });

  r.post(
    '/ais/:id/versions/:versionId/evaluate',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Ask this version your questions and score its answers (readiness)', params: VersionParams } },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      return reply.status(202).send(evaluationOut(await requestEvaluation(ctx, ai.id, req.params.versionId, req.auth!.userId)));
    },
  );

  r.get(
    '/ais/:id/versions/:versionId/evaluation',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'The latest evaluation of this version: readiness and each answer next to yours', params: VersionParams } },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const e = await latestEvaluation(ctx.db, req.params.versionId);
      if (!e || e.ai_id !== ai.id) throw new AppError(404, 'NOT_FOUND', 'This version has not been evaluated.');
      return evaluationOut(e);
    },
  );

  r.post(
    '/ais/:id/versions/:versionId/verdict',
    {
      preHandler: authed,
      schema: {
        tags: ['lifecycle'],
        summary: 'Approve the version (it behaves like you) or ask to train again',
        params: VersionParams,
        body: z.object({ approved: z.boolean(), note: z.string().trim().max(500).optional() }),
      },
    },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      assertMutable(ai);
      return setVerdict(ctx, ai, req.params.versionId, req.auth!.userId, req.body.approved, req.body.note ?? null, req.ip);
    },
  );

  r.get('/ais/:id/trainings', { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Trainings of this AI, newest first, with their checkpoints', params: AiId } }, async (req) => {
    const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
    return (await listTrainings(ctx.db, ai.id)).map(trainingOut);
  });

  r.get('/ais/:id/training-jobs', { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Recent build jobs and their progress', params: AiId } }, async (req) => {
    const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
    const { rows } = await ctx.db.query('SELECT * FROM core.training_jobs WHERE ai_id = $1 ORDER BY created_at DESC LIMIT 20', [ai.id]);
    return rows.map((j) => ({ id: j.id, status: j.status, stage: j.stage, progress: j.progress, versionId: j.version_id, error: j.error_message, createdAt: (j.created_at as Date).toISOString() }));
  });

  r.post(
    '/ais/:id/confirm',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Confirm the AI behaves like you (part of clearance)', params: AiId, body: z.object({ confirmed: z.boolean() }) } },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const latest = await latestVersion(ctx.db, ai.id);
      if (latest?.engine === 'adapter') {
        await setVerdict(ctx, ai, latest.id, req.auth!.userId, req.body.confirmed, null, req.ip);
      } else {
        await ctx.db.query('UPDATE core.personal_ais SET owner_confirmed_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1', [ai.id, req.body.confirmed]);
      }
      return { confirmed: req.body.confirmed };
    },
  );

  r.get('/ais/:id/clearance', { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'What still has to happen before the AI can be deployed', params: AiId } }, async (req) =>
    clearance(ctx, await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id)),
  );

  r.get(
    '/ais/:id/deploy/preview',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'The blockchain transaction that deploying will send (shown before confirming)', params: AiId } },
    async (req) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      if (!ctx.chain) throw new AppError(503, 'CHAIN_DISABLED', 'The blockchain is not configured on this server.');
      const latest = await latestVersion(ctx.db, ai.id);
      if (!latest) throw new AppError(409, 'NO_VERSION', 'Build a version first.');
      const { rows } = await ctx.db.query<{ address: string }>('SELECT address FROM core.wallets WHERE user_id = $1 AND is_primary', [ai.owner_id]);
      const owner = rows[0]?.address;
      if (!owner) throw new AppError(409, 'NO_WALLET', 'You need a wallet to hold the identity token.');
      const tx = await ctx.chain.previewMint(owner, ai.id, latest.manifest_cid, ai.royalty_bps);
      return {
        ...tx,
        to: owner,
        royaltyBps: ai.royalty_bps,
        version: latest.version_no,
        manifestCid: latest.manifest_cid,
        manifestUrl: ctx.ipfs.gatewayUrl(latest.manifest_cid),
      };
    },
  );

  r.post('/ais/:id/deploy', { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Mint the AI’s identity token (verifies it everywhere)', params: AiId } }, async (req, reply) => {
    const result = await requestDeploy(ctx, req.params.id, req.auth!.userId, req.ip);
    return reply.status(202).send({ status: 'minting', ...result });
  });

  r.post(
    '/ais/:id/versions/:versionId/publish',
    { preHandler: authed, schema: { tags: ['lifecycle'], summary: 'Publish a newer version of a verified AI (ALTERA and ALTAR switch to it)', params: z.object({ id: z.uuid(), versionId: z.uuid() }) } },
    async (req, reply) => {
      const result = await requestPublish(ctx, req.params.id, req.params.versionId, req.auth!.userId, req.ip);
      return reply.status(202).send({ status: 'publishing', ...result });
    },
  );

  // ---------------------------------------------------------------- public directory

  r.get(
    '/public/ais/:handle',
    {
      schema: {
        tags: ['directory'],
        summary: 'Public profile of a verified AI (with ?platform=, people pictures as that platform shows them)',
        params: z.object({ handle: z.string().min(3).max(30) }),
        querystring: z.object({ platform: PictureOn.optional() }),
      },
    },
    async (req) => {
      const { rows } = await ctx.db.query<AiRow>(`SELECT * FROM core.personal_ais WHERE handle = $1 AND deleted_at IS NULL AND status = 'verified'`, [req.params.handle]);
      const ai = rows[0];
      if (!ai) throw notFound('AI');
      const person = await peopleById([ai.owner_id, ai.creator_id], req.query.platform);
      const persona = parsePersona(ai.draft_config);
      const version = ai.current_version_id ? await ctx.db.query('SELECT persona_config FROM core.ai_versions WHERE id = $1', [ai.current_version_id]) : null;
      const published = parsePersona(version?.rows[0]?.persona_config ?? persona);
      return { ...(await summary(ai)), owner: person(ai.owner_id), creator: person(ai.creator_id), traits: published.traits, about: published.about, interests: published.interests };
    },
  );

  r.get(
    '/public/ais',
    { schema: { tags: ['directory'], summary: 'Verified AIs', querystring: z.object({ q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(30), platform: PictureOn.optional() }) } },
    async (req) => {
      const q = req.query.q ? `%${req.query.q}%` : null;
      const { rows } = await ctx.db.query<AiRow>(
        `SELECT * FROM core.personal_ais WHERE status = 'verified' AND deleted_at IS NULL
           AND ($1::text IS NULL OR name ILIKE $1 OR handle ILIKE $1 OR description ILIKE $1)
         ORDER BY created_at DESC LIMIT $2`,
        [q, req.query.limit],
      );
      const person = await peopleById(rows.flatMap((ai) => [ai.owner_id, ai.creator_id]), req.query.platform);
      return Promise.all(rows.map(async (ai) => ({ ...(await summary(ai)), owner: person(ai.owner_id), creator: person(ai.creator_id) })));
    },
  );

  r.get(
    '/public/search/ais',
    {
      schema: {
        tags: ['directory'],
        summary: 'Verified AIs that match a description, by meaning (the ALT embedding model); falls back to text search',
        querystring: z.object({ q: z.string().trim().min(2).max(200), limit: z.coerce.number().int().min(1).max(50).default(20), platform: PictureOn.optional() }),
      },
    },
    async (req) => {
      const matches = await searchAis(ctx, req.query.q, req.query.limit);
      const found = matches ?? (await ctx.db.query<AiRow>(
        `SELECT * FROM core.personal_ais WHERE status = 'verified' AND deleted_at IS NULL
           AND (name ILIKE $1 OR handle ILIKE $1 OR description ILIKE $1) ORDER BY created_at DESC LIMIT $2`,
        [`%${req.query.q}%`, req.query.limit],
      )).rows.map((ai) => ({ ai, score: null as number | null }));
      const person = await peopleById(found.flatMap((m) => [m.ai.owner_id, m.ai.creator_id]), req.query.platform);
      return {
        by: matches ? 'meaning' : 'text',
        results: await Promise.all(found.map(async (m) => ({ ...(await summary(m.ai)), owner: person(m.ai.owner_id), creator: person(m.ai.creator_id), score: m.score === null ? null : Number(m.score.toFixed(3)) }))),
      };
    },
  );

  // ---------------------------------------------------------------- for other ALT services

  r.get(
    '/internal/ais/:id',
    { preHandler: requireService(ctx), schema: { tags: ['internal'], summary: 'AI identity for other ALT services', params: AiId } },
    async (req) => {
      const ai = await loadAi(ctx.db, req.params.id);
      if (!ai) throw notFound('AI');
      return { ...(await summary(ai)), ownerId: ai.owner_id, creatorId: ai.creator_id };
    },
  );

  r.post(
    '/internal/moderate',
    {
      preHandler: requireService(ctx),
      schema: {
        tags: ['internal'],
        summary: 'Module 16: check text against ALT’s safety rules and the toxicity model (flagged = block; warn = ask a private sender to confirm)',
        body: z.object({ text: z.string().max(20_000) }),
      },
    },
    async (req) => {
      const { scores: _scores, ...check } = await checkSafety(ctx.ml, req.body.text);
      return check;
    },
  );

  r.post(
    '/internal/assist',
    {
      preHandler: requireService(ctx),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['internal'],
        summary: 'Writing help for a person (not a persona): drafts a post from an instruction',
        body: z.object({ instruction: z.string().trim().min(3).max(1000), callerUserId: z.uuid().optional() }),
      },
    },
    async (req) => {
      const started = Date.now();
      const result = await ctx.llm.complete(
        [
          {
            role: 'system',
            content:
              'You help people write posts for ALTERA, a social network. Write one post in the first person from the instruction. ' +
              'No preamble or quotation marks; at most 600 characters; up to 3 hashtags. Refuse hateful, violent, sexual or illegal content.',
          },
          { role: 'user', content: req.body.instruction },
        ],
        { temperature: 0.8, maxTokens: 300 },
      );
      const check = await checkSafety(ctx.ml, result.text);
      if (check.flagged) throw new AppError(422, 'CONTENT_BLOCKED', 'That request produced content that breaks ALT’s rules.', { categories: check.categories });
      return { text: result.text, provider: result.provider, latencyMs: Date.now() - started };
    },
  );

  r.post(
    '/internal/ais/:id/respond',
    {
      preHandler: requireService(ctx),
      schema: {
        tags: ['internal'],
        summary: 'Make a verified AI speak on another platform (the persona engine)',
        params: AiId,
        body: z.object({
          channel: z.enum(CHANNELS),
          messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).min(1).max(20),
          callerUserId: z.uuid().optional(),
        }),
      },
    },
    async (req) => {
      const ai = await loadAi(ctx.db, req.params.id);
      if (!ai) throw notFound('AI');
      if (ai.status !== 'verified') throw new AppError(403, 'AI_NOT_VERIFIED', 'Only verified AIs can act on ALT platforms.');
      await requireConsent(ctx.db, ai.id, 'public_deployment');
      return respond(ctx, {
        ai,
        version: 'current',
        channel: req.body.channel,
        messages: req.body.messages,
        callerUserId: req.body.callerUserId ?? null,
        callerService: req.service ?? null,
      });
    },
  );
}
