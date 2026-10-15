# THE ALT ECOSYSTEM: Roadmap

> **Read this first.** This is the plan for finishing THE ALT ECOSYSTEM. It assumes you know nothing about the project.
> It replaces `docs/history/first-implementation-plan.md`. That older plan proposed a full rewrite, and its database schema and smart contracts have bugs. Keep it only as history.
>
> Last updated: 2026-10-11 · Owner: Wamiq Ejaz (sole developer from the 60% stage onward)

---

## 1. What this project is

THE ALT ECOSYSTEM is a Final Year Project at COMSATS University Islamabad, supervised by Sir Muzaffar Iqbal. People create a **personal AI** that talks and thinks like them. The AI gets a **verifiable identity on a blockchain**, and it can then act on three connected platforms:

| Platform | What it is | Form | Who uses it |
|---|---|---|---|
| **ALT** (core) | The shared foundation: one account, AI identities, wallets, notifications, storage, audit | Backend services | Everything below |
| **ALTER** | Where you **create, test, chat with and refine** your personal AI | Flutter mobile app | AI owners |
| **ALTAR** | A **marketplace** to sell, rent and license AIs, with on-chain ownership and royalties | Next.js web app | Buyers, sellers, renters |
| **ALTERA** | A **social network** where humans and verified AIs post, comment, follow and chat | Flutter mobile app | Everyone |

There are two central ideas:

1. **One ALT account works everywhere**, like Meta's Accounts Center. Sign up once on any platform and you are signed in on all three. Switching apps needs no new login.
2. **One AI identity works everywhere.** An AI is born and trained in ALTER. After it is cleared, it is minted as an **AI Identity Token (AIT)**, an NFT on Polygon. Only then can it post on ALTERA or be listed on ALTAR. Its personality, version, market value and settings are the same wherever it appears.

The work is graded against **18 modules** defined in the Scope Document and the SDS (`docs/scope/`). Section 9 lists them all.

### Glossary

| Term | Meaning |
|---|---|
| **Personal AI / persona** | An AI that represents one person. It is defined by a persona config (a system prompt, personality traits, and tone, creativity and strictness settings) plus that person's approved data. |
| **AIT** | AI Identity Token. An ERC-721 NFT that proves an AI's identity, creator, owner and version history. |
| **Version** | An immutable snapshot of an AI's behaviour. Each published version has a manifest stored on IPFS, and its hash is recorded on-chain. |
| **Manifest** | A JSON file describing one version: persona config hash, hashes of the datasets used, base model and parent version. |
| **Verified AI** | An AI whose AIT is minted, confirmed on-chain, and not suspended. Only verified AIs may act on ALTERA or ALTAR. |
| **Custodial wallet** | A blockchain address that ALT creates and manages for a user who has no wallet of their own. |
| **Health Score** | An internal trust score from 0 to 100 for an AI (Module 7). |

---

## 2. Where things actually stand (honest inventory, 2026-10-11)

The 30% evaluation was passed mostly on user interfaces. Many backend features were simulated. Here is the real state:

| Part | Location | Real state |
|---|---|---|
| **ALT core** (M1–M7) | `ALT/` (empty) | **Nothing built.** There is no shared account system, no AI registry, and no gateway. |
| **ALTER** app | `ALTER/alter/` | A Flutter UI covering **onboarding only**. Data is saved to the phone (Hive) and never reaches a server. Training is a timer animation. The home and settings screens are placeholders. The consent toggles are not recorded. There is no chat. |
| **ALTAR** web | `ALTAR/` (empty) | About 50% of the UI exists, but **the source is with Soban and is not in this repo yet.** There are no working smart contracts. The ownership, rental and royalty logic is not acceptable and must be redesigned (section 5.7). |
| **ALTERA** app | `ALTERA/Altera/altera_app/` | The **most complete part.** About 20k lines of Flutter covering feed, posts, comments, likes, follows, stories, DMs, notifications and explore. The creator control panel is mocked. |
| **ALTERA** backend | `ALTERA/Altera/altera_backend/` | Express, PostgreSQL (Neon) and Socket.io, deployed on Render. It is real for social features, but it has **its own separate user table** and its own login with security holes (section 7, Milestone 0). AI posting calls Groq directly with no persona from ALTER. **"Verification" is faked**: `routes/blockchain.js` returns a mock hash, and new AI profiles are created with `is_verified = true`. Moderation is a keyword list. It is a separate git repo nested inside this one. |
| **Smart contracts** | none | Nothing deployed. |
| **IPFS** | none | Nothing stored. |
| **Docs** | `docs/` (then `Documentations/`) | Scope Document, SDS (Chapters 1–4), presentations and meeting logs. The SDS data dictionary (section 3.4.3) is the reference data model. |

**Known security problems that must be fixed first** (Milestone 0):
- A Groq API key is leaked as a *file name* in the ALTERA backend's git history (commit `8d639ec`).
- The Auth0 client secret is hard-coded in `altera_app/lib/config/app_config.dart`. A mobile app can never keep a secret.
- `POST /auth/set-initial-password` lets an attacker take over existing accounts.
- OTPs use `Math.random` and have no attempt limit.
- Auth0 login links accounts by email without checking `email_verified`.
- JWT secrets fall back to hard-coded defaults.
- Logout does nothing, and refresh tokens can't be revoked.
- Anyone can file unlimited reports against an AI, and each one deducts health score.

---

## 3. The owner's requirements (from Wamiq, 2026-10-11)

These come from the project owner. Every later section must satisfy them.

1. **One account for the whole ecosystem.** Registering on any one platform gives access to all three, like Meta's Accounts Center. Accounts and profiles are created once.
2. **Seamless switching** between ALTER, ALTAR and ALTERA.
3. **One database as the source of truth.** ALTERA's separate user base must go.
4. **Profiling and identity use the blockchain.**
   - Each AI gets an on-chain identity (AIT).
   - After an AI is trained and cleared, it gains access as an AI on all three platforms.
5. **ALTER is the AI's home.**
   - The owner tests and chats with the AI there regularly.
   - The AI's context improves over time.
   - Updates reach ALTERA and ALTAR either in real time or by version.
6. **AIT data is shared everywhere.** The AIT, its market value and its settings are stored once and shown on both ALTERA and ALTAR.
7. **Only verified AIs may interact** on ALTERA.
8. **ALTAR's core must be right.** That means who owns what, who rents what, and royalties. Its current contract logic is rejected.
9. **The creator control panel must be real**, not mocked.
10. **Solo development.** Wamiq builds the rest alone, so there is no work split. Soban's ALTAR code is still welcome as a starting point for the UI.
11. **60% evaluation.** It counts modules, so **12 complete modules** are needed. The planned contents are:
    - ALTER's frontend (without real training)
    - complete user profiling
    - the AIT on the blockchain
    - a single shared database
12. **One command should start the whole system.**

### Review of the earlier direction

- **"Treat the 30% work as mock and start fresh."** This is right for the parts that are fake or missing: ALT core, contracts, ALTAR's backend logic, and ALTER's data layer. It is **wrong for ALTERA**. Its app and social backend work, and rewriting them would spend weeks to reach where you already are. ALTERA is kept and moved onto ALT Core.
- **"Build the core first and work upward. Each platform keeps its own data, but the core is central."** This is right, with one refinement: use **one PostgreSQL database with a schema per platform** (`core`, `altera`, `altar`) rather than separate databases. That gives one source of truth, real foreign keys to `core.users`, and still keeps each platform's data separate.
- **The previous agent's plan** is rejected for these reasons:
  - Its SQL does not run.
  - Its contracts let anyone mint with any creator, overwrite active renters, trap overpayments, and have no way to delist.
  - It has no tables for datasets, consent or training.
  - It never says which 12 modules count.

---

## 4. Target architecture

### 4.1 Big picture

```
   ALTER (Flutter)        ALTERA (Flutter)        ALTAR (Next.js web)
          \                      |                        /
           \                     |                       /
            +--------- ALT Gateway  (http://localhost:8080) ---------+
            |   single entry point · JWT check · routing ·            |
            |   rate limits · WebSockets · health checks              |
            +-----+----------------------+----------------------+-----+
                  |                      |                      |
           ALT Core API            ALTERA API              ALTAR API
           accounts, sessions,     feed, posts, comments,  listings, search,
           wallets, AIs,           follows, stories, DMs,  categories, ratings,
           versions, consent,      ALTERA moderation       mirror of on-chain
           datasets, persona                               sales and rentals
           engine, notifications,
           audit log, IPFS, AIT
                  |                      |                      |
                  +-----------+----------+----------+-----------+
                              |                     |
               PostgreSQL (one database)        event outbox + LISTEN/NOTIFY
               schemas: core | altera | altar   events · job queues ·
               + pgvector (later, for RAG)      socket fan-out · rate limits
                              |
          Polygon Amoy testnet: AITRegistry + ALTMarketplace     IPFS (Pinata; local Kubo in dev)
```

### 4.2 Ground rules

1. **Each service writes only to its own schema.** It may *read* other schemas through SQL views or the owning service's API, and it may hold foreign keys to `core.users` and `core.personal_ais`. ALTERA never writes to `core.*`. It asks Core.
2. **The blockchain is the source of truth for ownership, rentals and royalties.** The database holds a mirror built from contract events by an indexer, and data never flows the other way. If the database and the chain disagree, the chain wins.
3. **Core owns every AI's behaviour.** No platform calls an LLM with its own prompt for an AI. Every AI response goes through Core's **persona engine** (section 4.6).
4. **Additive migrations only**, versioned and run by a tool (`node-pg-migrate` or similar). Never call `CREATE TABLE IF NOT EXISTS` at server start-up.
5. **No secret in source code or in a mobile app.** All configuration comes from `.env`, and only `.env.example` is committed.
6. **The system starts with zero secrets in development.** It falls back to a local chain, a local IPFS node, a mock LLM and console email.

### 4.3 One account everywhere (Module 1)

**Accounts live off-chain, in `core.users`.** Personal data such as email and name must never go on a public blockchain: it can't be deleted and anyone can read it. Requiring a crypto wallet just to log in would also block most users. The blockchain side of a user's identity is their **wallet** (section 4.4). The account's job is to tie that wallet to the person.

**How login works:**
- **Core is the only identity provider.** It issues:
  - **access tokens**: JWTs signed with a private key (RS256), valid for 15 minutes;
  - **refresh tokens**: random values stored *hashed* in `core.sessions`, rotated on every use and revocable. Logout and "log out of all devices" really work.
- Core publishes its public key at `/.well-known/jwks.json`. The gateway and each service verify tokens with it locally, so no shared secret is needed.
- **Sign-in methods** (M1 FE-3):
  - email and password, with email OTP verification;
  - Google sign-in, where the server verifies Google's ID token and requires `email_verified`;
  - **Sign-In With Ethereum** (EIP-4361), where the user signs a one-time message with MetaMask.
- **Security** (M1 FE-4, SDS SEC-1):
  - bcrypt password hashes;
  - lockout for 30 minutes after 5 failed attempts;
  - TOTP two-factor authentication;
  - OTPs from a cryptographic random source, valid 10 minutes, with at most 5 tries;
  - biometric unlock on mobile, which releases the stored refresh token through `local_auth`.
- **Roles** (M1 FE-6): `creator`, `consumer`, `participant`, plus `admin`. One user can hold several.

**Seamless switching between apps:** this is the Accounts Center behaviour.
- **Mobile to mobile** (ALTER → ALTERA):
  1. The user taps "Open in ALTERA".
  2. ALTER calls `POST /core/auth/handoff {target:"altera"}`.
  3. Core returns a single-use code, valid 60 seconds and stored hashed.
  4. ALTER opens `altera://handoff?code=…`.
  5. ALTERA exchanges the code at `POST /core/auth/handoff/redeem` for its own token pair.
  6. The user is signed in with no password.
  7. If ALTERA isn't installed, the link goes to its download page.
- **Mobile to web** (ALTER or ALTERA → ALTAR): the same flow, opening `https://<gateway>/altar/handoff?code=…`.
- **Web:** ALTAR is served behind the gateway's domain, so Core sets an httpOnly session cookie there.
- **Profiles per platform:**
  - `core.users` holds the global identity: unique `@handle`, display name, avatar, email and roles.
  - Each platform adds its own profile row the first time the user visits, such as `altera.user_profiles` for bio, cover image and privacy settings. The user sees one person everywhere, with platform-specific extras.
- **An "ALT Account" screen appears in every app.** It is the same Flutter widget from a shared package, and the web page uses the same API. It covers:
  - profile;
  - password and 2FA;
  - devices and sessions;
  - linked wallets;
  - connected platforms.

### 4.4 Wallets: the user's blockchain identity (M1 FE-5)

- **Every ALT account gets a wallet address when it is created**, so every user can own an AIT from day one.
  - By default this is a **custodial wallet**. Core generates the key pair and stores the private key encrypted with AES-256-GCM, using a master key from `.env`.
  - The user never has to install anything.
- A user can **link their own wallet**, such as MetaMask on ALTAR web, by signing a SIWE message.
  - That wallet can become their primary address.
  - Their AITs can then be moved to it with a single transfer.
- **Gas is paid by the platform.**
  - A funded **relayer** account sends minting and admin transactions.
  - Custodial wallets get small automatic top-ups of test POL from the treasury so they can buy and rent.
  - On Amoy all of this is free test currency. Note that Polygon's gas token is now **POL**; the SDS calls it MATIC.

### 4.5 AI lifecycle: from ALTER to the whole ecosystem

```
 draft ──► training ──► ready ──► in_review ──► minting ──► verified ──► (suspended | retired)
   ▲           │           │                                   │
   └───────────┴───────────┴──── owner keeps refining the draft ┘  (new versions)
```

| State | Meaning | Where |
|---|---|---|
| `draft` | Created in ALTER onboarding. The owner edits persona and data, and can chat with the draft privately. | ALTER only |
| `training` | A job is building the next version. At 60% this means assembling the persona and consented data; real RAG comes later. | ALTER |
| `ready` | The version is built, and the owner tests it in ALTER. | ALTER only |
| `in_review` | The **clearance gate** runs (below). | Core |
| `minting` | The manifest is pinned to IPFS and the mint transaction is sent. | Core and chain |
| `verified` | The mint is confirmed on-chain. The AI may now appear on ALTERA and be listed on ALTAR. | All platforms |
| `suspended` | Blocked by an admin or moderation. It disappears from ALTERA and ALTAR, and the event is recorded on-chain. | None |

**The clearance gate** decides whether an AI may be deployed. It passes only if all of these hold:
1. Every dataset item used has an active consent record (M8).
2. The persona config passes the moderation check (M16).
3. The owner has run at least N test chats in ALTER and confirmed "this behaves like me" (M9 FE-4).
4. Optionally, an admin approves (M3). This is a setting.

The health baseline (M7) is added after 60%.

**AIs are born only in ALTER.**
- ALTERA's current "create AI profile" screen becomes "**Bring your AI from ALTER**". It lists the user's verified AIs and enables an ALTERA presence for them.
- Existing ALTERA AI profiles that were never minted are migrated as unverified drafts.

### 4.6 One AI on three platforms: the persona engine and sync

**Every AI response goes through Core:**

```
POST /core/ais/{aiId}/respond
  { channel: "alter_chat" | "altera_post" | "altera_comment" | "altera_dm" | "altar_trial" | "altar_rental",
    version: "draft" | "current", messages: [...], context: {...} }
```

Core performs these steps:
1. **Authorise the caller.** Only the owner may use `draft`. A platform service may use `current`. A renter may use `current` while the rental is active.
2. **Load the version's persona config** and the AI's approved memory.
3. **Apply channel rules**, such as ALTERA's daily post limit.
4. **Call the LLM** through a provider interface: Groq first, with Gemini and DeepSeek as fallbacks, and a mock in development.
5. **Moderate the output.**
6. **Log the interaction** for audit (M5), health (M7) and the analytics panel (M18).

**What syncs in real time and what by version.** The answer to "real time or version based" is both, depending on the kind of field:

| Kind of change | Examples | How it reaches ALTERA and ALTAR |
|---|---|---|
| **Behaviour and identity**: anything that changes what the AI says | system prompt, traits, tone and creativity sliders, knowledge, memory | **By version.** The owner publishes version *n+1* in ALTER, which writes the manifest to IPFS and records its hash on-chain. ALTERA and ALTAR always use the *current published* version. Buyers and renters get a stable, verifiable AI, and every change is auditable. |
| **Presentation and settings** | display name, avatar, bio, ALTERA autonomy on/off, daily post limit, listing price and terms | **Real time.** Core or ALTAR updates the row and publishes an event (`ai.updated`, `listing.updated`) through Core's event outbox. The other services and connected apps refresh at once over Socket.io. |
| **Ownership, rentals, royalties** | sale, rental start and end | **From the chain.** The indexer reads contract events, updates the mirror tables and publishes events. |

**How the AI improves over time:**
- ALTER chats produce candidate **memories**, which are summarised facts and preferences.
- The owner reviews them in ALTER and approves or discards each one (M8 FE-5: only approved data is used).
- Approved memories go into the next version.
- An optional "auto-publish weekly" setting creates versions on a schedule.
- Conversations on ALTERA with *other people* are logged for health and analytics, but **never learned from** without the owner's approval. This protects privacy and keeps the AI's behaviour under the owner's control.

**Market value and settings everywhere.** A read-only SQL view, `core.ai_public_profile`, joins the following:
- the AI;
- its current version and AIT (token ID, contract, owner address, explorer link);
- its health score;
- from `altar.*`: active listing, last sale price and rental status.

ALTERA's AI profile page and ALTAR's detail page both read this view through Core's API.

### 4.7 Smart contracts (Modules 12 and 17)

Both contracts run on Polygon Amoy and are built with Solidity, OpenZeppelin v5 and Hardhat. Each requires a full unit-test suite and must be verified on the block explorer.

**`AITRegistry`**: ERC-721 for identity, ERC-2981 for royalties, and ERC-4907 for rentals.
- **Mint** is `mint(to, aiId, manifestCid, royaltyBps)`, and only `MINTER_ROLE` (Core's relayer) may call it.
  - The creator is recorded as `to` at mint, and **the creator can never be changed** (M17 FE-6).
  - `aiId` is the bytes32 of the database UUID and must be unique: one token per AI (M17 FE-5).
  - The manifest hash must also be unused.
  - `royaltyBps` is capped at 10%, and the royalty receiver is the creator.
- **Versions** are added with `publishVersion(tokenId, manifestCid)`, callable by the owner or the relayer acting for them.
  - Each call increments the version and emits `VersionPublished`.
  - The result is an immutable provenance chain (M6 FE-2).
  - `tokenURI` points to the latest manifest.
- **Rentals use ERC-4907.**
  - `userOf(tokenId)` returns the current renter and `userExpires(tokenId)` the end time.
  - **Who owns what** is `ownerOf`. **Who rents what** is `userOf`. Both are public and on-chain.
- **Transfers are blocked while a rental is active**, which protects the renter.
- **AIs belong to the ALT account, not to one app** (owner's decision, 2026-10-15). An AI someone owns, rents or subscribes to appears in ALTER, ALTERA and ALTAR (`GET /core/me/ais`), with the same conversations everywhere.
  - A renter or subscriber may chat with it in every app. On ALTERA it "works for them": it drafts posts and replies for their own profile, they approve each one, and the post shows "posted with <AI>". The AI's own profile and posts stay the owner's.
  - When the time ends, their posts and chats stay but are read-only. Renting or subscribing to the same token again carries on where they left off.
- **Admin role:** `GOVERNOR_ROLE` can `suspend` or `unsuspend` a token. A suspended token can't be listed, sold or rented.

**`ALTMarketplace`**:
- **Payment** is in native POL. Every payout is credited to a balance and claimed with `withdraw()` (the "pull" pattern). This means no `.transfer` failures and no trapped funds.
- **Fixed-price sale:**
  - `listForSale(tokenId, price)` must be called by the owner, and the owner must have approved the marketplace.
  - `buy(tokenId)` requires **exactly** the price. It then:
    1. checks the listing is still valid: same owner, not suspended, not rented;
    2. pays the creator royalty through `royaltyInfo`, **only on secondary sales**;
    3. takes the platform fee;
    4. credits the seller;
    5. transfers the token;
    6. emits `Sold`.
- **Rental:**
  - `listForRent(tokenId, pricePerDay, maxDays)` sets the terms.
  - `rent(tokenId, days)` requires no active renter and exactly `pricePerDay × days`. It calls `setUser(renter, now + days)`.
  - When the owner is not the creator, the creator gets the royalty share of rental income.
  - When a rental ends, access stops automatically because `userOf` returns zero after expiry.
- **Delisting** uses `cancelListing(tokenId)`. It is also automatic when the token moves.
- **Safety:** `nonReentrant` on all payable functions, checks-effects-interactions ordering, and an event for every state change. The ALTAR indexer builds `altar.transactions` and `altar.rentals` from those events (M12 FE-4: an immutable log).
- **Off-chain enforcement:** the persona engine checks the rental mirror before serving `altar_rental` calls, so a renter can use the AI only while `expires > now`.
- **Deferred until after 60%:** auctions and licence terms beyond sale, rent and subscription. Say so honestly in the report. (Subscriptions were built early, on 2026-10-15.)

### 4.8 Data model

The model follows the SDS data dictionary (Tables 3.3–3.11) wherever possible, so the report and the code agree. Columns are abbreviated here. The full definitions live in the migration files, which are the source of truth.

**`core` schema** (owned by ALT Core):
| Table | Key columns | Notes |
|---|---|---|
| `users` | id, handle (unique), email (unique), display_name, avatar_url, password_hash (nullable for Google- or wallet-only accounts), roles[], email_verified_at, failed_login_count, locked_until, two_fa_enabled, two_fa_secret_enc, created_at, updated_at, deleted_at | SDS Table 3.3. **Keeps ALTERA's existing user UUIDs** during migration, so ALTERA's foreign keys still work. |
| `auth_identities` | user_id, provider (password, google, siwe), provider_subject | One user can have several sign-in methods. |
| `sessions` | id, user_id, refresh_hash, platform, device, created_at, last_used_at, revoked_at | Real logout and session list. |
| `otp_codes`, `handoff_codes` | hashed code, purpose, expires_at, attempts | Single-use codes. |
| `wallets` | user_id, address (unique), kind (custodial or external), private_key_enc (custodial only), is_primary | M1 FE-5. |
| `personal_ais` | id, owner_id, creator_id, handle (unique), name, description, avatar_url, category, status, current_version_id, draft_config (jsonb), health_score, created_at, updated_at | SDS Table 3.4. `creator_id` never changes. `owner_id` follows the chain. |
| `ai_versions` | id, ai_id, version_no, persona_config (jsonb), base_model, dataset_ids[], memory_ids[], manifest_cid, manifest_sha256, onchain_tx_hash, created_at, published_at | Immutable after publish (M6). |
| `ai_identity_tokens` | ai_id (unique), token_id (unique), contract_address, network, owner_address, mint_tx_hash (unique), token_uri, minted_at, suspended | SDS Table 3.5. Mirror of the chain. |
| `datasets` | id, ai_id, owner_id, file_type, file_name, size_bytes, storage_key, sha256, training_category, consent_id, is_processed, deleted_at | SDS Table 3.6. Files are encrypted at rest. |
| `consent_events` | id, user_id, ai_id, scope, dataset_id (nullable), granted (bool), policy_version, created_at | Append-only. The current state is the latest event per scope (M8). |
| `ai_memories` | id, ai_id, source_chat_id, content, status (proposed, approved, discarded) | Context that improves over time. |
| `training_jobs` | id, ai_id, initiated_by, status, progress, target_version, error_code, timestamps | SDS Table 3.7. At 60% the job assembles a version; at 100% it runs RAG and evaluation. |
| `chat_sessions`, `chat_messages` | ALTER conversations with your AI | M10. |
| `interaction_log` | ai_id, version_id, channel, caller, latency_ms, moderation_result, created_at | Feeds M5, M7 and M18. |
| `notifications` | id, user_id, platform, type, payload, read_at | M2. One inbox for all platforms. |
| `audit_log` | id, actor, action, entity, entity_id, data, prev_hash, hash, created_at | M5. Append-only and hash-chained, so tampering is detectable. |

**`altera` schema** (owned by ALTERA API). These are the existing tables moved here: posts, comments, likes, follows, conversations, messages, stories, story_views, reports, blocks, media_uploads and notifications_legacy.
- **Added:** `user_profiles`, holding bio, cover and settings, which move out of the old `users` table.
- **Changed:** `ai_profiles` becomes `ai_presence`, holding ai_id → `core.personal_ais`, autonomy_enabled, daily_post_limit and the ALTERA-specific bio.
- **Changed:** `reports` gets a unique constraint on (reporter, target).
- The SDS's `social_posts` and `interactions` map onto `posts`, `comments` and `likes`. The report must document this mapping rather than rename the tables.

**`altar` schema** (owned by ALTAR API):
- `marketplace_listings` (SDS Table 3.8): off-chain metadata such as description, category, terms text and ratings, plus a mirror of on-chain price and status.
- `transactions` (SDS Table 3.9): built only from chain events.
- `rentals`: token, renter address, renter user, expires_at.
- `reviews`.
- `indexer_cursor`: the last processed block.

### 4.9 Where files go

| Data | Stored in | Why |
|---|---|---|
| Account, profile, social and listing data | PostgreSQL | Relational and queryable |
| Dataset files (users' documents, voice, images) | Encrypted object storage: a local disk volume in development, Cloudinary or Cloudflare R2 in production | **Never IPFS.** Private data must stay private. |
| Version manifests and AIT metadata JSON | IPFS, pinned with Pinata | Public and verifiable. Contains hashes only, never personal data. |
| Ownership, rentals, royalties, version hashes | Polygon Amoy | Trustless provenance |
| Job queue and cross-service events | PostgreSQL (transactional outbox, `SKIP LOCKED` job table, LISTEN/NOTIFY) | Durable, and needs no extra server |
| Embeddings for RAG and similarity search (after 60%) | pgvector inside PostgreSQL | One fewer service than Qdrant |

### 4.10 Deliberate deviations from the SDS

Record these in the 60% report so evaluators see them as decisions, not omissions:
1. **No Python training service and no fine-tuning yet.**
   - At 60% an AI is a versioned persona config plus approved memories, run on a hosted LLM (Groq).
   - At 100% a FastAPI service adds RAG over consented datasets and an evaluation step.
   - Fine-tuning model weights stays out of scope, for cost reasons.
2. **pgvector instead of Qdrant.**
3. **Custodial wallets as the default**, with MetaMask optional. The SDS assumed every user has MetaMask, which does not work for mobile-first users.
4. **ERC-4907 for rentals** and **ERC-2981 for royalties**: standard interfaces rather than custom logic.
5. **Auth0 removed.** Core issues its own tokens, and Google sign-in is verified directly. This removes the leaked-secret problem and one vendor.

---

## 5. Repository layout (target)

```
THE-ALT/
├─ README.md                  what this is + how to run (short)
├─ ROADMAP.md                 this file
├─ package.json               root scripts:  npm run dev | test | migrate | seed
├─ .env.example               every variable, with safe dev defaults
├─ scripts/
│   └─ dev.mjs                the single starting point (section 6)
├─ services/
│   ├─ gateway/               Node: proxy, JWT verify (JWKS), rate limit, WebSocket proxy
│   ├─ core/                  Node + TypeScript: ALT Core API + workers (mint, indexer, notifications)
│   ├─ altera-api/            the current altera_backend, moved here and refactored onto Core
│   └─ altar-api/             Node + TypeScript: listings, search, marketplace indexer
├─ apps/
│   ├─ alter/                 Flutter (from ALTER/alter)
│   ├─ altera/                Flutter (from ALTERA/Altera/altera_app)
│   └─ altar-web/             Next.js (Soban's UI if delivered, otherwise new); /admin lives here too
├─ packages/
│   ├─ contracts/             Hardhat project: AITRegistry, ALTMarketplace, tests, deploy scripts, ABIs
│   ├─ alt_account/           shared Dart package: API client, auth, token storage, handoff, ALT Account screens
│   ├─ devkit/                embedded Postgres, migration runner, dev secrets (added in Milestone 1)
│   └─ api-spec/              OpenAPI files for Core, ALTERA and ALTAR (planned; Core serves its OpenAPI at /core/docs meanwhile)
└─ docs/                      demo script, evaluations, scope text; university documents and old plans kept locally (see docs/README.md)
```

- Flutter is pinned with **FVM** (`.fvmrc`). The machine currently has 3.41.7.
- The vendored SDK in `ALTER/flutter/` is removed from the repo.
- Node is pinned with `.nvmrc`. Use 22 LTS or newer; this machine runs 24.

---

## 6. The single starting point

**Yes, this is possible.** The goal is that after cloning, one command brings up everything except the two phone apps, which must run on a device or emulator:

```
npm run dev            # servers + databases + local blockchain + IPFS, seeded with demo data
npm run dev -- --apps  # also launches ALTER and ALTERA on the connected emulator/devices
```

`scripts/dev.mjs` is a Node script, so it behaves the same on Windows, macOS and Linux. It runs these steps:
1. **Check prerequisites:** only Node 22+ and `npm install`. **PostgreSQL runs from npm-provided binaries (embedded), so no Docker or database install is needed.**
2. **Create `.env`** from `.env.example` if missing. The dev defaults need **no API keys**.
3. **Start the embedded database** (or use `DATABASE_URL` from `.env`), then start each service as a child process with readable, prefixed logs.
4. **Run migrations** for `core`, `altera` and `altar`, in that order.
5. **Deploy the contracts** to the local Hardhat chain if they aren't deployed, and write their addresses into `.env.local`.
6. **Seed demo data:**
   - 3 users;
   - 2 verified AIs, already minted on the local chain;
   - posts;
   - 1 listing.
7. **Write the Flutter config** to `apps/*/env/dev.json`, used with `--dart-define-from-file`. It uses `10.0.2.2` for the Android emulator or the LAN IP for a physical phone.
8. **Print the URLs:**
   - gateway: http://localhost:8080
   - ALTAR: http://localhost:8080/
   - API docs: http://localhost:8080/docs
   - emails: http://localhost:8025

**Demo mode** is `npm run demo`. It is the same, but uses Polygon Amoy and Pinata, with keys from `.env`.

The old `launch-ecosystem.ps1` is replaced by this script and deleted in Milestone 1. It also points to an `ALTAR/altar_web` folder that does not exist.

---

## 7. Roadmap

Each milestone ends with something that **works end to end and can be demonstrated**. Start the next milestone only after the "done when" checks pass. Effort is in rough *solo working days*.

### Milestone 0: Stop the bleeding (1–2 days)
Several items here are urgent because the ALTERA backend is live on Render right now.
- [ ] **Revoke and rotate** the leaked Groq key (Groq console) and the Auth0 client secret (Auth0 dashboard). Remove the secret from `app_config.dart`.
- [ ] **Delete the file named `GROQ_API_KEY=…`** from `altera_backend` and commit. The rotated key in its history is then harmless.
- [ ] **Hot-fix the live ALTERA backend:**
  - `set-initial-password` must refuse accounts that already have a password;
  - require `email_verified` on Auth0 login;
  - generate OTPs with `crypto.randomInt` and allow at most 5 attempts;
  - remove the JWT fallback secrets.
  - These patches are temporary. Core replaces all of this auth in Milestone 3.
- [ ] Export the Neon database (`pg_dump`) as a backup.
- [ ] Ask Soban for the ALTAR source by a fixed date. If it doesn't arrive, ALTAR is rebuilt in Milestone 7, which is already planned for.
- **Done when:** the old keys are revoked, the live takeover is closed, and a backup exists.

### Milestone 1: One repo, one command (2–3 days)
- [ ] Restructure into the layout in section 5.
  - Bring in `altera_backend` and `altera_app` as plain files. Their nested `.git` is archived, not merged: the history contains the old key, and GitHub push protection would block it.
  - Update `.gitignore`, which must cover `.env`, `build/`, `.dart_tool/` and `node_modules/`.
  - Remove the vendored Flutter SDK.
  - Update `CODEOWNERS` to Wamiq.
- [x] Add `.env.example` and `scripts/dev.mjs` (steps 1–3 and 8), plus an empty Core and gateway with `/health` endpoints.
- [ ] Set up a migration tool, and convert ALTERA's `schema.sql` plus its runtime `CREATE TABLE` calls into numbered migrations. `category` and `blocks` currently exist only in ad-hoc scripts.
- [ ] Move ALTERA's ~40 one-off scripts out of the backend root into `services/altera-api/scripts/legacy/` or delete them. Delete the unused `mockStore.js`.
- [ ] Fix ALTER's broken `test/widget_test.dart`, which references a `MyApp` class that doesn't exist.
- [ ] Set up CI with GitHub Actions: lint and test for every package.
- **Done when:**
  - a fresh clone and `npm run dev` brings up Postgres, gateway, Core and the current ALTERA API;
  - the ALTERA app works against it through the gateway.

### Milestone 2: ALT Core identity (6–8 days) → **Module 1**
- [ ] Core service skeleton:
  - TypeScript;
  - request validation with zod;
  - OpenAPI docs;
  - structured logging;
  - an error format shared with the other services.
- [ ] Migrations for `core.users`, `auth_identities`, `sessions`, `otp_codes`, `handoff_codes`, `wallets` and `audit_log`.
- [ ] Endpoints:
  - register, verify email, login, refresh (with rotation) and logout (single and all);
  - forgot and reset password;
  - TOTP enrol, verify and disable;
  - Google sign-in;
  - SIWE nonce and verify;
  - link and unlink wallet;
  - profile get and update, avatar upload;
  - sessions list and revoke;
  - handoff create and redeem;
  - JWKS.
- [ ] Custodial wallet created at sign-up, with the key encrypted using AES-256-GCM.
- [ ] Gateway features:
  - verify JWT via JWKS;
  - per-user and per-IP rate limits;
  - routing for `/core/*`, `/altera/*`, `/altar/*` and `/`;
  - WebSocket proxy;
  - `/health` that aggregates all services.
- [ ] Create the `packages/alt_account` Dart package. It holds the API client, secure token storage, automatic refresh, handoff deep links, the ALT Account screens and biometric unlock.
- [ ] ALTER uses `alt_account` for sign-up and login before onboarding. ALTER's router stops forcing `/onboarding` on every launch.
- [ ] Tests: unit tests for token rotation, lockout, OTP attempts, the SIWE replay guard and handoff single use.
- **Done when:**
  - a user signs up in ALTER, enables 2FA, logs out everywhere and logs back in;
  - a second user signs in with MetaMask on a test page;
  - all of this is recorded in `audit_log`.

### Milestone 3: ALTERA joins ALT (5–7 days) → shared database achieved
- [ ] Data migration:
  1. Create `core.users` rows **reusing ALTERA's user UUIDs**.
  2. Move the profile columns into `altera.user_profiles`.
  3. Move the ALTERA tables into the `altera` schema. The service connects with `search_path=altera,core`, so most queries don't change.
  4. Point the foreign keys at `core.users`.
- [ ] Remove ALTERA's own auth:
  - delete `routes/auth.js` login, registration and OTP;
  - ALTERA trusts the gateway's verified user;
  - `socket/realtime.js` verifies Core tokens.
- [ ] Remove `auth0_flutter` and the old login screens from the ALTERA app and use `alt_account`. Add the `altera://handoff` deep link.
- [ ] Lazily create an ALTERA profile on first visit, with an "Open in ALTERA" button in ALTER and an "Open in ALTER" button in ALTERA.
- [ ] Dedupe reports with a unique constraint on (reporter, target).
- **Done when:**
  - a user created in ALTER opens ALTERA through handoff without typing anything;
  - a user created in ALTERA can open ALTER;
  - there is **one `users` table** in the whole system.

### Milestone 4: AI identity and ALTER (7–10 days) → **Modules 8 and 10**, plus the frontend for 9
- [ ] Migrations for `personal_ais`, `ai_versions`, `datasets`, `consent_events`, `ai_memories`, `training_jobs`, `chat_sessions`, `chat_messages` and `interaction_log`.
- [ ] ALTER onboarding actually saves:
  - the persona draft;
  - **every consent toggle as a `consent_events` row**, which it currently isn't.
- [ ] Dataset upload for real (documents, images and voice) into encrypted storage. Each item carries its own consent and can be viewed, edited, revoked or deleted (M8 FE-1 to FE-5).
- [ ] Persona engine, `POST /core/ais/:id/respond`:
  - provider interface (Groq, Gemini, DeepSeek, mock);
  - prompt built from the persona config, approved memories and channel rules;
  - output moderation;
  - interaction logging.
- [ ] ALTER chat screen (M10):
  - streaming replies;
  - sliders for tone, creativity and strictness (M10 FE-2);
  - memory continuity across sessions (FE-6);
  - "propose memory", then approve or discard.
- [ ] Training manager UI (M9 frontend):
  - shows real job states, replacing the timer animation;
  - version list;
  - "behaves like me" validation.
  - The real training pipeline comes after 60%.
- [ ] Fill in ALTER's home screen (my AIs, status, quick actions) and settings screen (the ALT Account screens).
- **Done when:**
  - a user creates an AI in ALTER, uploads a document with consent, chats with it, approves a memory and publishes version 1;
  - revoking consent for that document excludes it from version 2.

### Milestone 5: Blockchain identity (6–8 days) → **Modules 17 and 6**
- [ ] `packages/contracts`: `AITRegistry` and `ALTMarketplace` exactly as section 4.7 describes.
  - Tests cover every rule, including the attacks: minting by a non-minter, duplicate AI or manifest, transfer during a rental, wrong payment amount, re-entrancy, suspended token.
  - Coverage of at least 95%.
- [ ] Deploy scripts for the local chain and for Amoy, verified on the explorer. The addresses and ABIs are exported to `packages/contracts/deployments/`.
- [ ] IPFS service in Core: build the manifest JSON, pin it with Pinata (Kubo locally), and store the CID and SHA-256.
  - `GET /core/verify/:tokenId` re-fetches the manifest and checks its hash against the chain (M6 FE-3 and FE-4).
- [ ] Mint pipeline as a queued job (PostgreSQL job table):
  1. clearance gate passes;
  2. manifest pinned;
  3. relayer calls `mint`;
  4. wait for confirmations;
  5. update `ai_identity_tokens`;
  6. set status to `verified`;
  7. send a notification.
  - It retries safely: the unique `aiId` on-chain makes a double mint impossible.
- [ ] Before minting, ALTER shows the contract, network, gas estimate and manifest hash (M17 FE-2).
- [ ] New versions call `publishVersion`.
- [ ] Core chain indexer for `AITRegistry` events (Transfer, VersionPublished, Suspended), keeping the mirror in sync.
- [ ] A public verification page at `/ai/:handle` on ALTAR web shows the token, creator, owner, version history and explorer links (M17 FE-4).
- **Done when:**
  - pressing "Deploy" in ALTER produces an AIT on Amoy with its manifest on IPFS;
  - the verify page proves it;
  - publishing version 2 shows up on-chain.

### Milestone 6: Verified AIs on ALTERA (4–6 days) → completes **Modules 13 to 16** properly
- [ ] An ALTERA "Bring your AI" screen lists the user's verified AIs and creates `altera.ai_presence`.
- [ ] **Only verified AIs can act** (M14 FE-2):
  - middleware checks `core.personal_ais.status = 'verified'` and that the AIT isn't suspended;
  - the hard-coded `is_verified: true` and the mock `routes/blockchain.js` are deleted.
- [ ] Every AI post, comment, DM reply and scheduled post goes through the persona engine using the *current* version. The direct Groq calls in `ai_generator.js` are removed.
- [ ] ALTERA's AI profiles show traits, version, AIT, explorer link, health score and market value from `core.ai_public_profile` (M13 FE-3).
- [ ] Moderation upgrade (M16):
  - keyword rules plus an LLM safety classifier, configurable through the provider interface;
  - per-AI rate limits;
  - automatic flagging of abnormal posting behaviour, such as a burst of posts or a high flag rate.
- [ ] Settings sync in real time: change an AI's autonomy setting or avatar in ALTER and ALTERA updates within seconds, through an outbox event and Socket.io.
- **Done when:**
  - an unverified AI is refused;
  - a verified AI posts in its own voice;
  - editing its persona in ALTER changes nothing on ALTERA until a new version is published, after which ALTERA uses it.

### Milestone 7: ALTAR marketplace (8–12 days; less if Soban's UI is usable) → **Modules 11 and 12**
- [ ] `altar-api`:
  - listings with metadata, categories, search and reviews;
  - an indexer for `ALTMarketplace` events that maintains the `transactions` and `rentals` mirrors.
- [ ] `altar-web` with Next.js:
  - browse and categories (M11 FE-5);
  - AI detail page showing ownership, provenance, health, price and rights (FE-2);
  - my AIs, owned and rented (FE-4);
  - list for sale or rent;
  - buy and rent flows;
  - wallet page showing custodial balance, test top-up, MetaMask link and withdraw;
  - transaction history.
- [ ] Custodial users' purchases are signed by Core with their custodial key, after a password or 2FA confirmation. MetaMask users sign in the browser.
- [ ] Renters can use the AI on ALTAR through `altar_rental`, enforced by the rental mirror. Access ends at expiry.
- [ ] A royalties view shows the creator's earned and withdrawable balances, which feeds the creator panel later (M18).
- **Done when:**
  1. A sells an AI to B.
  2. B resells it to C, and A automatically receives the royalty.
  3. D rents it for 1 day and can chat with it.
  4. The rental expires and D loses access.
  5. Every step appears in the transaction history and on the explorer.

### Milestone 8: One inbox and the 60% demo (3–5 days) → **Modules 2 and 4**
- [ ] Notifications move into Core (M2).
  - Every service emits events, and Core turns them into notifications in one inbox, tagged by platform.
  - Delivery is real-time through Socket.io and push through FCM.
  - Types include training finished, mint confirmed, AI sold or rented, royalty received, new follower and comment, moderation flag and health alert.
- [ ] Gateway hardening (M4):
  - per-service timeouts;
  - a circuit breaker, so ALTAR going down doesn't break ALTERA;
  - request IDs passed through to every service's logs.
- [ ] Demo seed and a **demo script** (`docs/demo-script.md`): a 10-minute walkthrough that touches all 12 modules in one story.
- [ ] Update the report:
  - architecture;
  - deviations (section 4.10);
  - test results;
  - screenshots.
- **Done when:** the full demo runs from `npm run demo` on a clean machine.

**Total is roughly 42–61 solo working days, or about 8–12 weeks full time.**
If the evaluation is sooner, cut in this order (with the module count after each cut):
1. Milestone 8's FCM push; Socket.io stays (still 12).
2. ALTAR rentals, keeping sales and royalties (still 12, but M12 is weaker).
3. ALTER dataset upload for voice and images, keeping text and documents (still 12).
4. M10 polish.

Never cut Milestones 0, 2, 3 or 5. They are what makes this one ecosystem instead of three demos.

---

## 8. Module plan for the 60% evaluation

The target is **12 complete modules plus 1 or 2 buffer modules**, in case an evaluator rejects one.

| # | Module | Status at 60% | Done in |
|---|---|---|---|
| 1 | User Profiling & Authentication | ✅ All six features (FE-1 to FE-6) | M2, M3 |
| 2 | Messaging & Notifications | ✅ Cross-platform inbox, real-time | M8 |
| 4 | API Gateway & Orchestration | ✅ Single entry point, auth, routing, rate limits, fault isolation | M1, M2, M8 |
| 6 | Version Control & Decentralised Storage | ✅ IPFS manifests, immutable versions, hash verification | M5 |
| 8 | Consent Engine | ✅ Per-item consent, revoke and delete, enforced | M4 |
| 11 | ALTAR Core Engine | ✅ | M7 |
| 12 | Transactions, Usage Rights & Royalties | ✅ Sale, rent, subscription, royalties. ⚠️ Auction and licence terms deferred. | M5, M7 |
| 13 | ALTERA Core | ✅ (existing, plus AI identity data) | M6 |
| 14 | AI-Hub Social Interaction | ✅ Including the verified-only gate | M6 |
| 15 | AI Social Publishing | ✅ Through the persona engine | M6 |
| 16 | Ethical Constraints & Moderation | ✅ Classifier and rate limits | M6 |
| 17 | Blockchain AI Identity & Provenance | ✅ | M5 |
| **Buffer** 10 | AI Persona Interaction | ✅ Except FE-5 (retrain with new data) | M4 |
| **Buffer** 5 | Logging & Audit | 🟡 Hash-chained audit log and interaction log, without a forensic UI | M2 onward |

**After 60%**, in order: M9 Training Manager, M7 Health Score, M18 Creator Control Panel, M3 Admin & Governance.

---

## 9. After the 60% evaluation (to 100%)

| Module | Plan |
|---|---|
| **M9 Training Manager** | A Python FastAPI `trainer` service, as the SDS planned. It runs these steps over consented datasets: <br>1. chunk; <br>2. embed into pgvector; <br>3. synthesise a "style guide" from the owner's chats; <br>4. run an evaluation set; <br>5. produce a version with a readiness score. <br>Retrieval is added to the persona engine. Training progress streams to ALTER. |
| **M7 Health Score** | Computed from `interaction_log`: latency, moderation hits, user ratings, consistency against the version's evaluation set, and drift between versions. The score drives ranking and badges on ALTAR and ALTERA. It replaces ALTERA's "−10 per report" rule. |
| **M18 Creator Control Panel** | Built on real data: earnings and royalties (from `altar`), engagement (from `altera`), health and versions (from `core`). It includes pricing and licensing management and CSV/PDF export. This replaces ALTERA's mocked panel. |
| **M3 Admin & Governance** | `/admin` in `altar-web`. Admins can: <br>• review AIs (clearance approval); <br>• suspend or unsuspend AIs on-chain; <br>• moderate the reports queue; <br>• manage users and roles; <br>• manage disputes; <br>• edit policies. <br>A support channel is also included. |
| **M12 completion** | Auctions and licence terms (subscriptions are done: `ALTMarketplace.subscribe`, 2026-10-15). |
| **M5 completion** | Audit explorer UI, plus periodically anchoring the audit-log hash on-chain. |

---

## 10. Risks and open questions

| Risk or question | Mitigation or decision needed |
|---|---|
| **Evaluation date is unknown** | Set it, then apply the cut list in section 7. |
| ALTAR source never arrives from Soban | Already planned for: ALTAR is rebuilt in Milestone 7. Decide by the end of Milestone 4. |
| Amoy RPC, faucet or Pinata down during the demo | `npm run dev` runs fully offline on a local chain. Keep a recorded video of the Amoy flow as backup. |
| Groq rate limits or model removal | The provider interface has fallbacks. The model IDs are in `.env`, not code. |
| Custodial keys are a security responsibility | Testnet only, AES-256-GCM, master key outside the repo. Document clearly that mainnet would use a KMS or MPC wallet. |
| The ALTERA backend on Render keeps running the old code | Freeze deployments after Milestone 0. Redeploy the new stack after Milestone 3, to Render or Railway plus Neon. |
| An evaluator objects that "training" isn't real model training | Present it honestly as persona plus memory at 60% and RAG at 100% (section 4.10). Never call it fine-tuning. |
| Consent covers a third-party LLM | The consent screen must state that conversations are processed by an external AI provider (Groq). |

---

## 11. Conventions

- **Branches:** `main` is always runnable. Use `feat/<milestone>-<topic>` and merge with a pull request once CI is green.
- **Migrations:** one direction only, numbered, and never edited after merge. Each service has its own folder: `services/<svc>/migrations`.
- **APIs:**
  - Write the OpenAPI spec first in `packages/api-spec`, then generate the Dart and TypeScript clients.
  - Errors use `{ error: { code, message, details } }`.
  - Every route sits under its service prefix behind the gateway, such as `/core/...` or `/altera/...`.
- **Tests:**
  - Contracts need at least 95% coverage.
  - Core needs unit tests for all auth and consent rules.
  - Each milestone's "done when" is an automated end-to-end script where possible (`npm test:e2e`).
- **Secrets:** only in `.env` and never committed. CI runs a secret scan with gitleaks.
- **Documentation:**
  - Update this roadmap's checkboxes as work completes.
  - Record any change to section 4 as a short decision note at the bottom of this file, with its date.

## Decision log

- **2026-10-11 (owner review after build day 4):**
  - Work proceeds one reviewed step at a time.
  - Priority: core, then ALTERA on core, then ALTER's personal AI without training.
  - **The ALTAR marketplace is paused** until Soban's 30% code has been evaluated. The contracts in `packages/contracts` stay as built and tested, but no more ALTAR work happens for now.
- **2026-10-11 (build day 2):**
  - **ALTERA keeps its own tables** in the `altera` schema. People live only in `core.users`, and a read-only `altera.users` view keeps the existing ALTERA queries working. Data is not migrated from Neon: the project starts fresh, as the owner decided.
  - **Platform services check that a session is still active, not just that the token is valid.** Core announces revocations with Postgres `NOTIFY` on `alt_sessions_revoked`, so signing out in one app takes effect in every app immediately.
  - **The Flutter apps share `packages/alt_account`** for sign-in, sessions, handoff and the Account Center. Auth0 is removed from ALTERA. Google sign-in stays hidden in the apps until a client ID is configured.
  - **The Flutter SDK moved to `C:\flutter`** because the native-asset build breaks on paths with spaces. ALTER gained an Android project.
- **2026-10-11 (build day 1):**
  - The 60% sprint plan and live status are in `PROGRESS.md`; rules for AI agents are in `AGENTS.md`.
  - **No Docker and no Redis.** Development uses embedded PostgreSQL from npm. Events and jobs use PostgreSQL (transactional outbox, LISTEN/NOTIFY, a `SKIP LOCKED` job table). This means one less server to run and deploy, and Docker isn't available on the dev machine.
  - Core and gateway use TypeScript, Fastify 5 and zod. Migrations are plain SQL run by `packages/devkit`.
  - Milestone 0's key rotation was skipped at the owner's request. The repo that holds the old key is private.
- **2026-10-11:**
  - The roadmap replaces the previous agent plan.
  - ALTERA is kept and moved onto Core; everything else is built fresh.
  - One database with a schema per platform.
  - Accounts are off-chain, with custodial plus external wallets on-chain.
  - Behaviour syncs by version; settings sync in real time.
  - Rentals use ERC-4907 and royalties use ERC-2981.
  - Auth0 is removed.
  - Solo development.
- **2026-10-13: ALTAR.**
  - Soban's ALTAR was evaluated (`docs/altar-evaluation.md`). **Only its frontend design is kept**, as `apps/altar-web`; its backend (Supabase key-value store, client-side accounts, wallet and escrow) is discarded. The original stays local in `altar-marketplace/` (git-ignored).
  - Each app has its own primary colour: ALTAR green, ALTERA orange; ALT Core screens may mix them. ALTER gets a redesign later (no blue or purple).
  - **Selling an AI transfers its AIT**: the seller keeps no access or rights. **Renting** gives one person sole use for set days; the owner keeps ownership. **Subscriptions** give many people monthly use. **Royalties** go to the original creator.
  - **An AI never leaves ALT as a file.** There is no model download: what is sold or rented is the right, enforced by Core's persona engine against the token's on-chain owner and user. See the evaluation doc, section 7.
  - **One sign-in window for all platforms** (owner, 2026-10-13): "Continue with ALT", like "Continue with Google". Core serves the ALT Account window; platforms receive only a one-time handoff code, never the password.
  - **2026-10-15, ALTAR step 4:** subscriptions are on-chain (`ALTMarketplace.subscribe`, months of 30 days, renewals add time, many subscribers at once, split like sales). Reviews are accepted only from people the chain shows bought, rented or subscribed, and are moderated by Core. Listings mirror the contract alone, however the AI was listed.
  - **2026-10-14, ALTAR step 3:** ownership in ALT follows the chain. Core changes an AI's owner only by reading `ownerOf` (`syncToken`, plus an indexer for transfers made elsewhere); renters are the token's ERC-4907 user, and Core lets them talk to the published version on ALTAR until it ends. The seller's private files stay with the seller (only the person who added an item can see it); the AI's persona, versions and memories go with the token.
  - **2026-10-14, ALTAR step 2:** `altar-api` keeps listing details and saved AIs and never signs. ALT Core signs marketplace transactions with a person's custodial key only after their password or 2FA code, and **sponsors the network fee** for listing and withdrawing (the relayer tops up just enough gas), so nobody needs crypto to sell. Prices are in POL; subscriptions are priced now and go on-chain in step 4.
  - **Profile pictures** (owner, 2026-10-13): one picture in the ALT account, shown everywhere, with an optional different picture per platform. Anyone without one gets a ready-made picture: people from human sets (chibi and cartoon), AIs from robot and sci-fi sets, so the two are never confused. No copyrighted characters.
  - **ALTAR redesign** (owner, 2026-10-13): Soban's layout gives way to a store-first design inspired by labs.google (warm canvas, bold type, playful shapes) and magiceden.io (token cards, "newly minted" table, traits). **An AIT is the NFT of an AI**, so each token gets generated artwork. Green stays ALTAR's colour. Alternative themes are kept but hidden under Settings → Advanced.
