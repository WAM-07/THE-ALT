import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { tx } from '../../db.js';
import { audit, publish } from '../../lib/audit.js';
import { sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { respond } from '../../modules/ai/engine.js';
import { buildVersion, clearance, requestDeploy, requestPublish } from '../../modules/ai/lifecycle.js';
import { moderate } from '../../modules/ai/moderation.js';
import { CHANNELS, PersonaConfig, parsePersona, personaFromOnboarding } from '../../modules/ai/persona.js';
import {
  assertMutable,
  CONSENT_POLICY_VERSION,
  CONSENT_SCOPES,
  CONSENT_TEXT,
  consentState,
  latestVersion,
  loadAi,
  readDatasetFile,
  removeDatasetFile,
  requireConsent,
  requireOwnedAi,
  writeDatasetFile,
  type AiRow,
} from '../../modules/ai/repo.js';
import { requireService, requireUser } from '../auth-guard.js';
import { Handle } from '../schemas.js';

const AiId = z.object({ id: z.uuid() });
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
          [ai.id, b.name ?? null, b.description !== undefined, b.description ?? null, b.category ?? null, b.avatarUrl !== undefined, b.avatarUrl ?? null, b.persona ?? null, personaChanged],
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
    const { rows } = await ctx.db.query('SELECT * FROM core.datasets WHERE ai_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [ai.id]);
    return rows.map(datasetOut);
  });

  async function addDataset(
    userId: string,
    ai: AiRow,
    item: { kind: string; title: string; fileName: string | null; mimeType: string | null; bytes: Buffer; category: string; isText: boolean },
  ) {
    const id = crypto.randomUUID();
    const storageKey = await writeDatasetFile(ctx, id, item.bytes);
    const textChars = item.isText ? item.bytes.toString('utf8').length : 0;
    const { rows } = await tx(ctx.db, async (client) => {
      const res = await client.query(
        `INSERT INTO core.datasets (id, ai_id, owner_id, kind, title, file_name, mime_type, size_bytes, storage_key, sha256, training_category, is_processed, text_chars)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [id, ai.id, userId, item.kind, item.title, item.fileName, item.mimeType, item.bytes.length, storageKey, sha256(item.bytes), item.category, item.isText, textChars],
      );
      await audit(client, { action: 'dataset.added', actorUserId: userId, entityType: 'ai', entityId: ai.id, data: { datasetId: id, kind: item.kind, bytes: item.bytes.length } });
      return res;
    });
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
    { preHandler: authed, schema: { tags: ['datasets'], summary: 'Upload a file (text files are used now; documents, images and voice are stored for later training)', params: AiId, consumes: ['multipart/form-data'] } },
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
    { preHandler: authed, schema: { tags: ['datasets'], summary: 'Read back what you added (owner only)', params: z.object({ id: z.uuid(), datasetId: z.uuid() }) } },
    async (req, reply) => {
      const ai = await requireOwnedAi(ctx.db, req.auth!.userId, req.params.id);
      const { rows } = await ctx.db.query('SELECT mime_type, file_name FROM core.datasets WHERE id = $1 AND ai_id = $2 AND deleted_at IS NULL', [req.params.datasetId, ai.id]);
      if (!rows[0]) throw notFound('Item');
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
            WHERE id = $1 AND ai_id = $2 AND deleted_at IS NULL RETURNING *`,
          [req.params.datasetId, ai.id, req.body.included ?? null, req.body.title ?? null, req.body.category ?? null],
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
        const { rowCount } = await client.query('UPDATE core.datasets SET deleted_at = now(), included = false WHERE id = $1 AND ai_id = $2 AND deleted_at IS NULL', [
          req.params.datasetId,
          ai.id,
        ]);
        if (!rowCount) throw notFound('Item');
        await audit(client, { action: 'dataset.deleted', actorUserId: req.auth!.userId, entityType: 'ai', entityId: ai.id, data: { datasetId: req.params.datasetId } });
      });
      await removeDatasetFile(ctx, req.params.datasetId);
      return { deleted: true };
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
      const userCheck = moderate(req.body.content);
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
      return { message: messageOut(saved[0]), reply: messageOut(replyRows[0]), provider: result.provider, proposedMemory };
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
      `SELECT id, version_no, manifest_cid, manifest_sha256, onchain_tx_hash, created_at, published_at, array_length(dataset_ids, 1) AS datasets, array_length(memory_ids, 1) AS memories
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
      createdAt: (v.created_at as Date).toISOString(),
    }));
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
      await ctx.db.query('UPDATE core.personal_ais SET owner_confirmed_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1', [ai.id, req.body.confirmed]);
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
    { schema: { tags: ['directory'], summary: 'Public profile of a verified AI', params: z.object({ handle: z.string().min(3).max(30) }) } },
    async (req) => {
      const { rows } = await ctx.db.query<AiRow>(`SELECT * FROM core.personal_ais WHERE handle = $1 AND deleted_at IS NULL AND status = 'verified'`, [req.params.handle]);
      const ai = rows[0];
      if (!ai) throw notFound('AI');
      const { rows: people } = await ctx.db.query('SELECT id, handle, display_name FROM core.users WHERE id = ANY($1::uuid[])', [[ai.owner_id, ai.creator_id]]);
      const person = (id: string) => {
        const p = people.find((x) => x.id === id);
        return p ? { id: p.id, handle: p.handle, displayName: p.display_name } : null;
      };
      const persona = parsePersona(ai.draft_config);
      const version = ai.current_version_id ? await ctx.db.query('SELECT persona_config FROM core.ai_versions WHERE id = $1', [ai.current_version_id]) : null;
      const published = parsePersona(version?.rows[0]?.persona_config ?? persona);
      return { ...(await summary(ai)), owner: person(ai.owner_id), creator: person(ai.creator_id), traits: published.traits, about: published.about, interests: published.interests };
    },
  );

  r.get(
    '/public/ais',
    { schema: { tags: ['directory'], summary: 'Verified AIs', querystring: z.object({ q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) } },
    async (req) => {
      const q = req.query.q ? `%${req.query.q}%` : null;
      const { rows } = await ctx.db.query<AiRow>(
        `SELECT * FROM core.personal_ais WHERE status = 'verified' AND deleted_at IS NULL
           AND ($1::text IS NULL OR name ILIKE $1 OR handle ILIKE $1 OR description ILIKE $1)
         ORDER BY created_at DESC LIMIT $2`,
        [q, req.query.limit],
      );
      return Promise.all(rows.map(summary));
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
      schema: { tags: ['internal'], summary: 'Module 16: check text against ALT’s safety rules', body: z.object({ text: z.string().max(20_000) }) },
    },
    async (req) => moderate(req.body.text),
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
      const check = moderate(result.text);
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
