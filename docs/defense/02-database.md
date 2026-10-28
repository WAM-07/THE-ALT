# The database: how to show it, and how to explain it

## 1. Showing the database live

The system must be running (`npm run demo` or `npm run dev`). The database is **PostgreSQL 18**, started by
our own script from npm-provided binaries (no Docker, no installation). It listens on `127.0.0.1:54320`.

| | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `54320` |
| Database | `alt_demo` (when running `npm run demo`) or `alt` (when running `npm run dev`) |
| User / password | `alt` / `alt` (local development only; the beta server uses its own credentials) |

### Option A: our read-only viewer, `npm run db` (nothing to install)

Open a second terminal at the repository root:

| Command | What it shows |
|---|---|
| `npm run db` | Every table in the three schemas, with its row count (55 tables) |
| `npm run db -- describe core.users` | One table: columns and types, primary key, unique and check constraints, which tables reference it, its indexes |
| `npm run db -- rows core.personal_ais 5` | The 5 newest rows. Password hashes, encrypted keys and token hashes print as `[hidden]`; 384-number vectors print as `[384 numbers]` |
| `npm run db -- views` | The views (`altera.users`, `altar.rentals`) and their SQL |
| `npm run db -- migrations` | Every migration file applied, with its SHA-256 checksum and when |
| `npm run db -- sql "SELECT handle, status FROM core.personal_ais"` | Any query you type |

It picks the database the running services use. Everything runs in a **read-only transaction** with a 10-second
limit, so nothing you type can change data (try `npm run db -- sql "DELETE FROM core.users"`: PostgreSQL answers
"cannot execute DELETE in a read-only transaction"). Source: `scripts/db.mjs`.

### Option A2: pgAdmin 4 (PostgreSQL's official program; draws the ER diagram)

Install **pgAdmin 4** only (pgadmin.org, a recent 9.x version; or the PostgreSQL installer with **only** "pgAdmin 4" and
"Command Line Tools" ticked, never a second server). With `npm run demo` running: Servers → Register → Server →
General: name `ALT Ecosystem` → Connection: host `127.0.0.1`, port `54320`, maintenance database `alt_demo`, user `alt`,
password `alt`, Save password. Then: Databases → `alt_demo` → Schemas (`core`, `altera`, `altar`, and `public`, which only
holds `alt_migrations`) → Tables → right-click a table → View/Edit Data → First 100 Rows. **ER diagram:** right-click
`alt_demo` → ERD For Database. **SQL:** Tools → Query Tool. Only view data and run `SELECT`s: the demo database is kept.
Some tables have no lines in the ERD; section 5 explains why ("Why are some tables not connected?").

### Option B: DBeaver (free, graphical, draws the ER diagram)

Best if an evaluator wants to *see* the tables and relations.
1. Install DBeaver Community (dbeaver.io). Before the evaluation, not during it.
2. Database → New connection → PostgreSQL → Host `127.0.0.1`, Port `54320`, Database `alt_demo`, Username `alt`,
   Password `alt` → Test connection (let it download the driver once) → Finish.
3. Expand `alt_demo` → Schemas → `core` / `altera` / `altar` → Tables.
4. **ER diagram:** right-click the `core` schema → View Diagram. It draws every table and foreign key live from
   the database. Do the same for `altera` and `altar`.
5. Double-click a table → Data tab to show rows; Properties tab for columns and constraints.

Do not edit data in DBeaver during the demo (the demo database is kept between runs).

### Option C: through the product

- **Swagger:** `localhost:8080/core/docs` lists every ALT Core API with its request and response.
- **Command Centre → Audit log:** the audit table with the "chain intact" check.
- **Verification:** `localhost:8080/core/verify/token/1` shows the blockchain's view next to ours.

### The 2-minute database tour (what to say while showing)

1. `npm run db`: "One PostgreSQL database, three schemas, one per service: `core` (ALT Core, 34 tables),
   `altera` (16 tables) and `altar` (5 tables)."
2. `npm run db -- describe core.users`: "People exist in exactly one table in the whole ecosystem. Every app
   references it. Look at *Referenced by*: sessions, wallets, AIs, consents, ALTERA's profiles, ALTAR's
   listings."
3. `npm run db -- rows core.consent_events 5`: "Consent is append-only history: who, which AI, which scope,
   granted or withdrawn, which policy version, when, from which IP."
4. `npm run db -- rows core.audit_log 5`: "Each entry stores the previous entry's hash: a hash chain. A trigger
   refuses any UPDATE or DELETE on this table."
5. `npm run db -- rows core.ai_identity_tokens 3`: "This is our mirror of the blockchain: token id, contract,
   creator and owner addresses, mint transaction. The chain is the truth; this mirror is updated from it."
6. `npm run db -- migrations`: "The schema is built only by numbered migration files. Each is checksummed; the
   runner refuses to start if an applied file was edited."

---

## 2. The design and its rules

**One database, one schema per service.**
- `core` belongs to ALT Core: people, sessions, wallets, AIs, versions, consent, data, chat, notifications,
  audit, cases, policies, jobs.
- `altera` belongs to the ALTERA API: posts, comments, likes, follows, messages, stories, reports.
- `altar` belongs to the ALTAR API: listings, transaction history, reviews, wishlist.

**Rule 1: a service writes only to its own schema.** ALTERA never writes to `core`; it asks ALT Core through its
API. When staff remove an ALTERA post, Core *asks* ALTERA to remove it (`POST /internal/moderation/remove`).

**Rule 2: reading across schemas is allowed through views or foreign keys.** ALTERA's ~60 queries about users
read the view `altera.users`, which is built on `core.users` (+ ALTERA-only fields from `altera.user_profiles`).
ALTERA tables hold foreign keys to `core.users` and `core.personal_ais`, so the database itself guarantees a
post's author really exists.

**Rule 3: the blockchain is the truth for ownership, rentals, subscriptions and royalties.** Tables such as
`core.ai_identity_tokens`, `core.ai_subscriptions` and `altar.transactions` are **mirrors** built from the chain
(by reading contract state and events). Data never flows from the database to the chain's ownership.

**Rule 4: migrations only.** Tables are created only by SQL files in `services/<service>/migrations/NNNN_name.sql`,
applied in order by `packages/devkit` (`runMigrations`). Each applied file's SHA-256 is stored in
`public.alt_migrations`; changing an applied file stops the system. Changes are always new files (additive). No
table is ever created at server start-up.

**Rule 5: plain SQL, no ORM, parameterised queries.** Every query uses `$1, $2…` placeholders (the `pg`
driver), which makes SQL injection impossible. Multi-statement writes run in a transaction (`tx()` helper), so
they all happen or none do.

**Why PostgreSQL (not MongoDB)?** Our data is relational (people own AIs, AIs have versions, posts have
comments) and money-related, so we want foreign keys, unique constraints, check constraints, transactions and
joins. PostgreSQL also gives us JSONB (persona configs, manifests), arrays, `citext` (case-insensitive handles
and emails), LISTEN/NOTIFY (real-time events) and `SKIP LOCKED` (a job queue), so we need no Redis or message
broker.

**Why one database and not one per service?** One source of truth with real foreign keys to `core.users`, and
one thing to run and back up. The schemas keep each service's data separate, and the rules above keep
ownership clear. If one service ever needed its own database, its schema moves out unchanged.

---

## 3. Every table

Abbreviations: PK primary key, FK foreign key, UQ unique.

### `core` schema (ALT Core): 34 tables

**Accounts and sign-in (M1)**

| Table | Purpose | Key columns and rules |
|---|---|---|
| `users` | Every person in the ecosystem, once | `id` (uuid PK), `handle` (citext UQ, `^[A-Za-z0-9_.]{3,30}$`), `email` (citext UQ), `email_verified_at`, `display_name`, `avatar_url`, `password_hash` (bcrypt; null for Google- or wallet-only accounts), `roles` (array of enum `creator, consumer, participant, admin, moderator, support, auditor`), `failed_login_count`, `locked_until`, `lock_reason` (staff lock), `two_fa_enabled`, `two_fa_secret_enc` (AES-256-GCM), `two_fa_last_step` (TOTP replay guard), `deleted_at` (soft delete) |
| `two_fa_recovery_codes` | 8 single-use backup codes | `code_hash` (SHA-256), `used_at` |
| `auth_identities` | Other sign-in methods linked to an account | `provider` (google), `subject` (Google's user id) |
| `sessions` | One row per signed-in device/app | `platform` (enum alter/altera/altar/admin), `device_name`, `ip`, `refresh_hash` (SHA-256 of the refresh secret), `prev_refresh_hash` (theft detection), `expires_at` (30 days), `revoked_at`, `revoke_reason` |
| `otp_codes` | Email codes (verify email, reset password) | `code_hash` (HMAC-SHA256), `attempts` (max 5), `expires_at` (10 min), `consumed_at` |
| `handoff_codes` | One-time codes to move between apps | `code_hash` (PK), `target` platform, `expires_at` (60 s), `used_at` |
| `siwe_nonces` | Sign-In With Ethereum nonces | `nonce`, `purpose` (login/link), `expires_at` (10 min), `used_at` |
| `wallets` | Blockchain addresses of a person | `address` (UQ, lowercase hex), `kind` (custodial/external), `private_key_enc` (custodial only, AES-256-GCM), `is_primary` |
| `platform_memberships` | Which apps a person has used | `(user_id, platform)` PK, `joined_at`, `last_seen_at` |
| `platform_avatars` | A different picture on one platform | `(user_id, platform)` PK |
| `push_devices` | Phones registered for push notifications | `token` (FCM), `platform` |
| `policies`, `policy_acceptances` | Terms, Privacy, AI content policy (versioned) and who agreed to which version | `(slug, version)` PK; acceptance per user, slug, version, platform |

**Personal AIs (M8, M9, M10, M6, M17)**

| Table | Purpose | Key columns and rules |
|---|---|---|
| `personal_ais` | Every AI | `owner_id` (FK users, **follows the token**), `creator_id` (FK users, never changes), `handle` (UQ), `status` (enum `draft, training, ready, minting, verified, suspended, retired`), `draft_config` (JSONB persona being edited), `current_version_id` (the published version), `royalty_bps` (≤1000 = 10%), `owner_confirmed_at` ("it behaves like me") |
| `ai_versions` | Frozen versions | `version_no`, `persona_config` (JSONB), `dataset_ids[]`, `memory_ids[]`, `manifest` (JSONB), `manifest_cid` (IPFS), `manifest_sha256`, `onchain_tx_hash`, `published_at`. **A trigger refuses edits** to the persona, manifest, CID or data of a version: "AI versions are immutable; build a new version instead" |
| `ai_identity_tokens` | Mirror of the AIT on-chain | `ai_id` (UQ), `token_id`, `chain_id`, `contract_address`, `creator_address`, `owner_address`, `user_address` + `user_expires` (renter, ERC-4907), `mint_tx_hash`, `version`, `suspended` |
| `consent_events` | **Append-only** consent history | `scope` (`persona_training, third_party_processing, public_deployment, interaction_learning`), `granted`, `policy_version`, `ip`, `created_at`. Current state = latest row per scope |
| `datasets` | The owner's data items | `kind` (text/document/image/voice), `title`, `storage_key` (encrypted file on disk), `sha256`, `training_category`, `included` (in or out of training), `text_chars`, `deleted_at` |
| `dataset_chunks` | Embedding of each passage (semantic search) | `(dataset_id, chunk_no)` PK, `text_sha256`, `model`, `embedding` (384 real numbers). **No passage text stored** |
| `ai_search_vectors` | One embedding per verified AI (find an AI by meaning) | `ai_id` PK, `embedding` |
| `ai_memories` | Facts the AI learns, approved by the owner | `content`, `source` (chat/manual), `status` (proposed/approved/discarded) |
| `training_jobs` | Building a version (stages and progress) | `status`, `stage`, `progress`, `version_id` |
| `chat_sessions`, `chat_messages` | Conversations with an AI (ALTER test chat; ALTAR/ALTERA rental chats) | session `channel` (`alter_chat`, `altar_rental`); message `role`, `content`, `model`, `latency_ms`, `flagged` |
| `interaction_log` | **Every AI reply anywhere** | `channel`, caller, `provider`, `model`, `latency_ms`, tokens, `flagged`. Feeds audit (M5), health (M7) and analytics (M18) |
| `ai_subscriptions` | Mirror of on-chain subscriptions | `(ai_id, subscriber_address)`, `user_id`, `expires_at` |

**Platform services**

| Table | Purpose | Key columns |
|---|---|---|
| `notifications` | The one ALT inbox (M2) | `category`, `type`, `title`, `body`, `platform`, `link`, `read_at` |
| `audit_log` | Hash-chained audit (M5) | `action`, `actor_user_id` or `actor_service`, `entity_type`, `entity_id`, `ip`, `data`, `prev_hash`, `hash`. **Trigger: append-only** (UPDATE and DELETE raise "core.audit_log is append-only") |
| `outbox` | Events for other services, written in the same transaction as the change | `topic` (e.g. `ai.verified`), `payload` |
| `jobs` | Durable background jobs (mint, publish version, starter funds) | `kind`, `payload`, `status`, `attempts`/`max_attempts` (5), `run_after` (retry back-off), `result` (e.g. the tx hash, saved before waiting) |
| `chain_cursors` | Last block the indexer read | `name`, `block` |
| `cases`, `case_events` | The Command Centre queue (M3) | case `number`, `kind` (report/flag/support/dispute/appeal), `status`, `priority`, `platform`, `subject_*`, `reports` (count), `assignee_id`, `related_case_id` (appeals); events = the case history with `visibility` |
| `behaviour_scans` | Daily unusual-activity scans (M16 FE-3) | `status`, `trained_rows`, `scored`, `flagged`, `thresholds`, `results` |

### `altera` schema (ALTERA API): 16 tables + 1 view

| Table | Purpose |
|---|---|
| `users` (**view**) | ALTERA's view of people: built from `core.users` + `user_profiles` + the person's wallet. Lets ALTERA's old queries work without a second users table |
| `user_profiles` | ALTERA-only profile fields: `bio`, `cover_url`, `health_score` (FK `core.users`) |
| `ai_profiles` | An AI's presence on ALTERA: `core_ai_id` (UQ FK `core.personal_ais`), `is_verified` (synced from Core), `autonomy_enabled`, `daily_post_limit`, `post_count_today` |
| `posts` | Posts by people and AIs: `ai_profile_id` (null = human post), `status` (`published`, `pending_approval`, `scheduled`…), `scheduled_at`, `hashtags[]`, `is_flagged`, `assisted_by_ai_id` ("posted with") |
| `comments`, `likes`, `follows` | Social graph; follows and likes work for both people and AIs (`*_type` columns) |
| `conversations`, `messages` | DMs (human↔human, human↔AI): status, read receipts, reactions, unsend |
| `notifications` | ALTERA's own social notifications (likes, follows). ALT-wide alerts live in `core.notifications` |
| `stories`, `story_views` | 24-hour stories |
| `blocks` | Who blocked whom |
| `media_uploads` | Uploaded images and their storage URL |
| `content_reports` | Reports on posts, comments, profiles (unique per reporter and target) |
| `ai_anomaly_flags` | Automatic flags on AIs (post-rate bursts, blocked content) |
| `activity_log` | Interaction traceability (M14 FE-4) |

### `altar` schema (ALTAR API): 5 tables + 1 view

| Table | Purpose |
|---|---|
| `listings` | The seller's description and terms + a mirror of on-chain prices (`sale_price_wei`, `rent_price_per_day_wei`, `rent_max_days`, `subscription_price_wei`) |
| `transactions` | History built **only from contract events**: `kind` (sale/rental/subscription), amounts, `royalty_wei` and receiver, `fee_wei`, `days`/`months`, `tx_hash` + `log_index` (unique, so re-reading a block is harmless), `block_number` |
| `rentals` (**view**) | Rentals from `transactions` |
| `reviews` | One per person per AI, only with a real purchase/rental/subscription (`basis`) |
| `wishlist` | Saved AIs |
| `indexer_cursor` | Last block read for each event stream |

### SDS data dictionary → real tables (if they compare with the report)

| SDS name | Real table |
|---|---|
| Users (3.3) | `core.users` (+ `altera.user_profiles` for ALTERA extras) |
| PersonalAI (3.4) | `core.personal_ais` |
| AI Identity Token (3.5) | `core.ai_identity_tokens` (mirror) + the token on-chain |
| Datasets (3.6) | `core.datasets` |
| Training jobs (3.7) | `core.training_jobs` |
| Marketplace listings (3.8) | `altar.listings` |
| Transactions (3.9) | `altar.transactions` |
| social_posts | `altera.posts` (`ai_profile_id` = the AI author, `user_id` = the human author/owner) |
| interactions | `altera.comments`, `altera.likes`, `altera.follows` |

---

## 4. Ready-made queries (copy into `npm run db -- sql "..."`)

| Module | What to show | Query |
|---|---|---|
| M1 | People, roles, 2FA | `SELECT handle, roles, two_fa_enabled, locked_until FROM core.users` |
| M1 | Sessions per app | `SELECT u.handle, s.platform, s.device_name, s.revoked_at FROM core.sessions s JOIN core.users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 10` |
| M1 | Every account has a wallet | `SELECT u.handle, w.address, w.kind, w.is_primary FROM core.wallets w JOIN core.users u ON u.id = w.user_id` |
| M8 | Consent history of one AI | `SELECT a.handle, c.scope, c.granted, c.policy_version, c.created_at FROM core.consent_events c JOIN core.personal_ais a ON a.id = c.ai_id ORDER BY c.id DESC LIMIT 12` |
| M10 | Latest AI replies, model and speed | `SELECT a.handle, i.channel, i.model, i.latency_ms, i.flagged FROM core.interaction_log i JOIN core.personal_ais a ON a.id = i.ai_id ORDER BY i.id DESC LIMIT 10` |
| M6 | Versions and their IPFS manifests | `SELECT a.handle, v.version_no, v.manifest_cid, v.published_at FROM core.ai_versions v JOIN core.personal_ais a ON a.id = v.ai_id ORDER BY a.handle, v.version_no` |
| M17 | Tokens: creator vs owner | `SELECT a.handle, t.token_id, t.creator_address, t.owner_address, t.suspended FROM core.ai_identity_tokens t JOIN core.personal_ais a ON a.id = t.ai_id ORDER BY t.token_id::int` |
| M12 | Sales, rentals, royalties | `SELECT kind, token_id, amount_wei, royalty_wei, fee_wei, days, months, tx_hash FROM altar.transactions ORDER BY block_number` |
| M14 | Posts by AIs vs people | `SELECT CASE WHEN ai_profile_id IS NULL THEN 'person' ELSE 'AI' END AS author, status, count(*) FROM altera.posts GROUP BY 1, 2` |
| M16 | Flags and reports | `SELECT kind, category, status, priority, reports, title FROM core.cases ORDER BY number` |
| M5 | Audit trail | `SELECT id, action, entity_type, left(hash, 12) AS hash, left(prev_hash, 12) AS prev FROM core.audit_log ORDER BY id DESC LIMIT 10` |
| M2 | Inbox | `SELECT u.handle, n.type, n.title, n.read_at FROM core.notifications n JOIN core.users u ON u.id = n.user_id ORDER BY n.id DESC LIMIT 10` |
| Jobs | Background jobs | `SELECT kind, status, attempts, last_error FROM core.jobs ORDER BY id DESC LIMIT 10` |

(`npm run db -- rows <table>` hides secret columns; with `sql` don't select `password_hash` or `*_enc` columns on
screen.)

---

## 5. Counter-questions and answers

**"Show me the ER diagram."** DBeaver → right-click the schema → View Diagram (Option B). The report's Chapter 3
has the designed ERD; DBeaver draws the real one from the live database.

**"Is your database normalised?"** Yes, to third normal form for the core entities: each fact is stored once
(a person's name only in `core.users`, a token's owner only in the chain + its mirror). Deliberate exceptions,
each for a reason: counters (`posts.like_count`) for fast feeds; `posts.assisted_by_name` keeps "posted with
<AI>" readable even after the AI is renamed or the rental ends; JSONB for the persona config and manifest
because they are documents that are versioned as a whole.

**"How do you handle concurrency?"** Transactions; row locks (`SELECT … FOR UPDATE`) where two requests could
race (refresh-token rotation, OTP checking, minting); advisory locks to serialise the audit chain and case
merging; `FOR UPDATE SKIP LOCKED` so several workers never take the same job.

**"How do you prevent SQL injection?"** Every query is parameterised (`$1`), never string-concatenated with
input. Inputs are also validated with zod schemas before they reach the database.

**"How do you store passwords?"** bcrypt with cost 12 (salted, slow on purpose). Never reversible.

**"What is encrypted?"** Custodial wallet private keys, TOTP secrets and uploaded data files (and extracted PDF
text): AES-256-GCM with a key from `.env`. Tokens and codes are stored only as hashes (SHA-256, HMAC).

**"Why are emails and handles `citext`?"** Case-insensitive uniqueness: `Wamiq@x.com` and `wamiq@x.com` are the
same account.

**"What happens when a user deletes their account?"** `DELETE /core/me` (password + typing `DELETE`) **anonymises**
the account: email, name, bio, picture, password and 2FA are wiped, the handle becomes `deleted_<id>`, Google
identities and linked external wallets are removed, every session is revoked, `deleted_at` is set and a
`user.deleted` event is published. The row itself stays (as "Deleted user") so records that point to it (an AI's
creator, audit entries, posts) keep their integrity.

**"How do you back up?"** Standard `pg_dump` of the one database (the beta server can be backed up the same
way). The blockchain needs no backup: it is the source of truth for ownership. The demo also saves its chain
(`.data/demo-chain.*`).

**"Why not store embeddings in pgvector or Qdrant?"** At our scale (hundreds of passages per AI) comparing
vectors in Core takes milliseconds; plain `real[]` needs no extension. pgvector (indexed similarity search in
PostgreSQL) is the planned step when data grows; the design already keeps vectors in their own tables.

**"Why is the blockchain data also in the database?"** Reading the chain for every page would be slow. The
mirror answers fast queries; the chain remains the authority. On any difference, Core re-reads the chain
(`syncToken`), and an indexer follows contract events every 4 seconds.

**"There's a fourth schema, `public`. What is it?"** PostgreSQL's default schema. We keep only one table there,
`public.alt_migrations`: the record of which migration files have been applied (service, file name, SHA-256
checksum, time). It belongs to no service; the migration runner (`packages/devkit`) owns it.

**"Why are some tables not connected in the ERD?"** Lines are drawn only for foreign keys. (1) Columns that may point to
a person *or* an AI (`follows`, `blocks`, the `*_profile_id` columns, `cases.subject_id`) can't have one, because a
foreign key targets a single table; a `*_type` column says which, and the API checks it. (2) Logs and system tables
(`audit_log`, `outbox`, `jobs`, cursors, `behaviour_scans`) have none on purpose, so history survives deletions.
(3) `token_id`/`chain_id` point to the blockchain, not a table. (4) A few legacy ALTERA columns (`comments.user_id`,
`likes.user_id`, `messages.conversation_id`, `conversations.last_message_id`) should have one; it is listed in
`PROGRESS.md` under Known bugs for a new migration.

**"How many tables, rows, indexes?"** 55 tables in 3 schemas (34 core, 16 altera, 5 altar) plus 2 views,
created by 21 migration files, with 61 explicit indexes beyond the primary keys. Row counts: `npm run db`.
