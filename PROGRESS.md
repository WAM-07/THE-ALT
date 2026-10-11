# Progress

The live status of the 60% sprint. Update this whenever work lands. The design is in `ROADMAP.md`; rules for agents are in `AGENTS.md`.

**Sprint:** 7 days, starting 2026-10-11. Target: 12+ complete modules, all running from `npm run dev`.

| Day | Goal | Status |
|---|---|---|
| 0–1 | Repo restructure, one-command dev, **ALT Core identity** (M1) and the gateway (M4) | ✅ Done 2026-10-11 |
| 2 | ALTERA moves onto ALT Core: one users table, shared login, app-to-app handoff | ✅ Done 2026-10-11 |
| 3 | Smart contracts (AITRegistry, ALTMarketplace) with tests, local chain, IPFS pinning, mint pipeline (M17, M6) | ✅ Done 2026-10-11 (Amoy deploy waits for a funded key) |
| 4 | Core AIs, versions, consent and datasets; persona engine; ALTER onboarding, chat and deploy wired to the server (M8, M10) | ✅ Done 2026-10-11 |
| 5 | Verified AIs on ALTERA: verified-only gate, persona engine for posts and DMs, moderation, notifications (M13–M16, M2) | ⏳ Next |
| 6 | ALTAR marketplace: buy, rent, royalties, wallet (M11, M12) | ⏸ Paused: waiting for Soban's 30% ALTAR code to decide whether to merge it or build new |
| 7 | End-to-end demo run, fixes, seed data, demo script, report updates | ☐ |

## How to check everything still works

```bash
npm install
npm test                        # contracts 31 · core 50 · gateway 7 · altera-api 15 (real PostgreSQL and a real local chain)
cd packages/alt_account && C:\flutter\bin\flutter test    # 8 tests
cd apps/altera && C:\flutter\bin\flutter test             # app boots signed out → onboarding
cd apps/alter  && C:\flutter\bin\flutter test             # app boots signed out → sign-in
npm run dev                     # everything at http://localhost:8080
```

## Done

### Day 0–1 (2026-10-11)
- **Monorepo:** `apps/`, `services/`, `packages/`, `scripts/` and `tools/`. ALTERA's old nested git history and the file whose name contained the old Groq key are kept locally in `_archive/` (git-ignored).
- **`npm run dev`** starts embedded PostgreSQL 18 (no Docker), runs migrations, starts every service, waits for health and prints the URLs. Development secrets are generated into `.data/`. It also writes `apps/<app>/env/dev.json` for Flutter.
- **ALT Core** (`services/core`) covers Module 1 in full:
  - **Sign-up and sign-in:**
    - register with email OTP verification;
    - sign in by email or handle;
    - lockout for 30 minutes after 5 failures;
    - forgot, reset and change password.
  - **Sessions:**
    - RS256 access tokens (15 minutes) with a public JWKS;
    - rotating refresh tokens with theft (reuse) detection;
    - log out, log out everywhere, device list with per-device revoke.
  - **Two-factor authentication:** TOTP with replay protection and 8 recovery codes.
  - **Other sign-in methods:** Google sign-in (requires a verified email), and Sign-In With Ethereum (EIP-4361) including wallet-only accounts.
  - **Wallets:** an encrypted custodial wallet for every account. Users can link MetaMask, set a primary wallet and unlink.
  - **Handoff:** single-use, 60-second codes and deep links.
  - **Profile and roles:** profile, avatar, public profile and roles.
  - **Audit log:** hash-chained (start of M5).
  - **Event outbox** and **OpenAPI docs** at `/core/docs`.
- **Gateway** (`services/gateway`, Module 4):
  - routing by prefix;
  - JWT verification against Core's JWKS;
  - strips forged identity headers;
  - hides `/internal` routes;
  - rate limits;
  - per-service 502/504 isolation;
  - aggregated `/health`;
  - WebSocket proxy;
  - CORS that allows every REST method.

### Day 2 (2026-10-11)
- **The database:**
  - **ALTERA is in the shared database.** `services/altera-api/migrations/0001_altera_schema.sql` consolidates ALTERA's scattered schema (from `schema.sql`, five patch files and about 40 scripts) into one migration in the `altera` schema.
  - **People live only in `core.users`.** A read-only `altera.users` view keeps ALTERA's ~60 existing user queries working unchanged.
  - **ALTERA-only fields** (bio, cover, human health score) moved to `altera.user_profiles`.
- **ALTERA backend:**
  - **Accepts ALT Core tokens** over HTTP and Socket.IO, verified with JWKS.
  - **No longer handles credentials.** It issues no tokens and stores no passwords or OTPs. Its old `/auth/*` credential routes answer `410 MOVED_TO_ALT_CORE` with the replacement path.
  - **Profile edits go to the right place.** `GET /auth/me` and `PUT /auth/profile` remain: name and avatar changes are forwarded to the ALT account, while bio and cover stay on ALTERA.
- **Signing out reaches every app at once.**
  - Core sends a Postgres `NOTIFY` on every revocation: log out, log out everywhere, password reset or change, theft detection.
  - ALTERA listens and immediately refuses the session and closes its sockets.
  - A 15-second cache with a database check is the fallback.
- **Verification is no longer faked:**
  - New ALTERA AI personas start **unverified**.
  - Unverified AIs cannot post, send DMs, or be used by the AI post worker.
- **Reports** count once per reporter per target, so they can't drain a health score.
- **Smaller fixes:**
  - Core accepts body-less JSON POSTs and returns `INVALID_JSON` for malformed bodies.
  - Avatars can be set from URLs hosted by ALT services.
- **`packages/alt_account`** (Flutter), shared by ALTER and ALTERA (and later ALTAR web's logic):
  - API client with secure refresh-token storage and single-flight refresh;
  - sign-in outcomes: signed in, 2FA needed, or email not verified;
  - handoff open and receive through `app_links`;
  - code-entry dialog;
  - **ALT Account Center** screen: profile, password, 2FA with recovery codes, devices, wallets, "Open ALTER / ALTERA / ALTAR", sign out everywhere.
- **ALTERA app:**
  - sign-up and sign-in now go through ALT Core, keeping ALTERA's own screens;
  - Auth0 and its client secret are removed;
  - Google sign-in is hidden until configured;
  - 2FA and email-code prompts added;
  - `altera://handoff` deep link added;
  - the Socket.IO path goes through the gateway (`/altera/socket.io`);
  - **fake "Security" and "Wallet" settings removed** (a hard-coded 2FA switch and an invented "450.25 AIT" balance) and replaced by the Account Center.
- **ALTER app:**
  - sign-in and create-account screen;
  - the router restores the session and routes to sign-in, onboarding or home;
  - real home and settings screens: open ALTERA or ALTAR signed in, and the Account Center;
  - `alter://handoff` deep link;
  - **an Android project was added** (ALTER only had web before).
- **Live check through the gateway (`npm run dev`):**
  1. Sign up in ALTER.
  2. Hand off to ALTERA with no password.
  3. The ALTERA profile loads.
  4. A post appears in a follower's feed.
  5. A real-time DM arrives over the gateway WebSocket.
  6. Sign out everywhere.
  7. ALTERA refuses the old token.

### Day 3 (2026-10-11): blockchain identity
- **`packages/contracts`** (Hardhat 3, Solidity 0.8.28, OpenZeppelin 5.6):
  - **`AITRegistry`:**
    - ERC-721 identity token per AI, minted only by ALT Core's relayer (`MINTER_ROLE`);
    - the creator is immutable; one token per AI and one per manifest;
    - on-chain version history (`publishVersion`; `tokenURI` = latest IPFS manifest);
    - ERC-2981 royalty capped at 10%;
    - ERC-4907 rentals: `userOf` with automatic expiry, and no transfer while rented;
    - governor suspension.
  - **`ALTMarketplace`:**
    - sales and day-based rentals;
    - exact payment only;
    - platform fee plus creator royalty (none when the creator is the one being paid);
    - pull payments;
    - stale-listing protection;
    - re-entrancy guards.
  - **Tests:** 31, including attack cases (re-entrant buyer, payment-rejecting seller). **Coverage: 100% lines** of both contracts (`npm run coverage -w @alt/contracts`).
  - **Deploying:** `scripts/deploy.ts` writes `deployments/<network>.json`, and ABIs are exported to `abi/` for services.
- **`npm run dev`** starts a local Hardhat chain (`CHAIN_MODE=local`) and deploys the contracts. `CHAIN_MODE=amoy` uses Polygon Amoy (`npm run deploy:amoy -w @alt/contracts` once, with a funded key).
- **ALT Core:**
  - **Chain service:** mint preview with gas, mint, publish version, reads, and readable revert codes such as `CHAIN_AI_ALREADY_MINTED`.
  - **IPFS store:** real CIDv1 locally, or Pinata with `IPFS_MODE=pinata`.
  - **Routes:** `GET /chain`, `/ipfs/:cid` and `/verify/token/:id` (on-chain record plus IPFS manifest).

### Day 4 (2026-10-11): personal AIs from draft to verified
- **ALT Core** (migration `core/0002_ai_identity.sql`):
  - **Data model:** personal AIs, immutable versions, identity-token mirror, an append-only consent history (4 scopes, versioned policy), encrypted datasets, memories, chat, training jobs, an interaction log, and a durable job queue.
  - **Persona engine** (`src/modules/ai/engine.ts`):
    - one prompt built from the persona, approved memories and relevant document passages;
    - output moderation and an interaction log;
    - refuses to use an external LLM without the `third_party_processing` consent;
    - providers: Groq, any OpenAI-compatible API, and a clearly labelled mock.
  - **Lifecycle:**
    1. Build a version: a public manifest with hashes only, pinned to IPFS.
    2. Clearance gate: consents, at least 3 test messages, owner confirmation, safety check, wallet.
    3. Deploy: a `mint_ait` job that is idempotent and adopts an existing token on retry.
    4. Publish newer versions with a `publish_version` job.
  - **Announcements to other services:** `NOTIFY alt_ai_events` when an AI is verified, updated or publishes a version.
  - **Public and internal routes:** `/public/ais/:handle` and `/public/ais`, plus `POST /internal/ais/:id/respond` (service key; verified AIs only; needs the `public_deployment` consent) for ALTERA and ALTAR.
- **ALTER app:**
  - onboarding creates the AI with real consents (the old texts claimed "stored locally" and "a mock simulation");
  - Chat screen with memory suggestions and personality sliders;
  - Data screen: consent banner, text and file upload, inspect, include or exclude, delete;
  - Train & deploy screen: versions, clearance checklist with fixes, mint preview (network, contract, gas, who pays), deploy progress, token, verify and explorer links, and publishing new versions;
  - Home shows the real AI status, and Settings adds Privacy & consent.
- **Live check** (`npm run dev`, no keys):
  1. Sign up.
  2. Create the AI.
  3. Add data.
  4. Chat, including a memory suggestion.
  5. Build v1 on IPFS.
  6. Pass clearance.
  7. Preview the mint.
  8. Deploy: token #1 minted on the local chain in seconds.
  9. Independent verification matches the manifest.
  10. The public profile is served.

## How work proceeds now (owner's instruction, 2026-10-11)
Work one step at a time, then stop for the owner's review before starting the next. Priority order:
1. **ALT Core and the central system**: keep hardening it.
2. **ALTERA fully on the central system**: fix issues along the way.
3. **ALTER personal-AI module**, without the training part.
4. **Later:** the ALTAR marketplace, after Soban's code is evaluated. Do **not** work on it until then.

### Step status
- ✅ **Persona engine providers.** Groq (`openai/gpt-oss-120b`) is the primary, Gemini (`gemini-flash-latest`) the fallback, and DeepSeek last; its account currently has no balance (HTTP 402). Keys live in the root `.env`, copied from the old ALTERA config.
- ✅ **ALTERA on Core, backend.**
  - Migration `altera/0002` links `ai_profiles` to `core.personal_ais`.
  - `GET /profiles/ai/available` and `POST /profiles/ai/link` add a verified AI to ALTERA; `POST /profiles/ai` now answers 410.
  - Verification syncs from Core via `alt_ai_events`, so suspension applies instantly.
  - AI posts, AI-voice drafts and DM auto-replies use Core's persona engine.
  - Core moderation covers posts and comments.
  - `routes/blockchain.js` does real verification.
- ✅ **ALTERA on Core, app.** Verified live through the gateway with real Groq replies.
  - A "Bring your AI" screen replaces the old create-AI form; unverified AIs point the person to ALTER.
  - The composer drafts in the active AI's own voice through Core.
  - Tapping an AI's "AIT #" tag shows its live on-chain identity: token, contract, creator, owner, version, and IPFS manifest.
  - The old ALTERA `createAIPersona` code was removed.
- ✅ **Fixes found during the live check.**
  - The embedded Postgres was created as WIN1252, so emoji, Urdu or curly quotes crashed inserts. Databases are now always UTF-8; a regression test covers this. **Run `npm run dev -- --reset-db` once** to recreate an old local database.
  - The persona engine now sees all of a person's notes when they are short; keyword matching had missed "enjoy" vs "love".
- ☐ **Cross-platform notifications inbox in Core (M2)**, shown in ALTER and ALTERA.
- ☐ **ALTER personal-AI polish:** profile and avatar, memories screen, version history; no training.

## Known mocks / not real yet
- **ALTERA AI personas are not yet linked to Core AIs** (Day 5). Until then they cannot post or DM, which is deliberate. Verified AIs already exist in Core and on-chain.
- **ALTERA `routes/blockchain.js` is still a mock.** It is replaced on Day 5.
- **ALTERA moderation is a keyword list** (Day 5). **The creator control panel is mocked** (after 60%).
- **Persona engine replies** say `[mock]` until an LLM key is set. Put `GROQ_API_KEY=...` in the root `.env`; the owner also needs the `third_party_processing` consent switched on.
- **"Training" means building a version:** persona, consented data and approved memories, frozen and hashed. RAG with embeddings and evaluation come after 60%. PDFs, images and voice notes are stored but not read yet.
- **The local chain resets on every `npm run dev`**, but the database keeps tokens minted in earlier runs. Use `npm run dev -- --reset-db` for a clean demo, or `CHAIN_MODE=amoy`.
- **Google sign-in** works in Core but the apps hide the button until `GOOGLE_CLIENT_IDS` (Core) and `GOOGLE_SERVER_CLIENT_ID` (app) are configured and the `google_sign_in` plugin is added.
- **Biometric unlock** (planned under M1 FE-4) is not built yet.

## Environment notes
- **Development needs no keys.** Optional settings go in `.env`: `GOOGLE_CLIENT_IDS`, `SMTP_URL` with `MAIL_MODE=smtp`, and `ADMIN_EMAILS`.
- **Flutter SDK is at `C:\flutter`.** It was moved out of `ALTER/flutter` because Flutter's native-asset build fails when the SDK path contains a space ("C:\THE ALT"). Add `C:\flutter\bin` to PATH.
- **No Android SDK is installed on this machine.** To run the apps on a phone or emulator, install Android Studio. On this machine the apps can be checked with `flutter test`, `flutter analyze` and `flutter build web`.
  - Run on a web browser: `flutter run -d chrome --dart-define=ALT_API_URL=http://localhost:8080`.
  - Run on an emulator: `flutter run --dart-define-from-file=env/dev.json`.
  - Run on a physical phone: `--dart-define=ALT_API_URL=http://<PC LAN IP>:8080`. `npm run dev` prints the LAN address.
- **Docker is not installed and isn't needed.**
