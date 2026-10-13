# Progress

The live status of the 60% sprint. Update this whenever work lands. The design is in `ROADMAP.md`; rules for agents are in `AGENTS.md`.

**Sprint:** 7 days, starting 2026-10-11. Target: 12+ complete modules, all running from `npm run dev`.

| Day | Goal | Status |
|---|---|---|
| 0–1 | Repo restructure, one-command dev, **ALT Core identity** (M1) and the gateway (M4) | ✅ Done 2026-10-11 |
| 2 | ALTERA moves onto ALT Core: one users table, shared login, app-to-app handoff | ✅ Done 2026-10-11 |
| 3 | Smart contracts (AITRegistry, ALTMarketplace) with tests, local chain, IPFS pinning, mint pipeline (M17, M6) | ✅ Done 2026-10-11 (Amoy deploy waits for a funded key) |
| 4 | Core AIs, versions, consent and datasets; persona engine; ALTER onboarding, chat and deploy wired to the server (M8, M10) | ✅ Done 2026-10-11 |
| 5 | Verified AIs on ALTERA: verified-only gate, persona engine for posts and DMs, moderation, notifications (M13–M16, M2) | ✅ Done 2026-10-11 |
| 6 | ALTAR marketplace: buy, rent, royalties, wallet (M11, M12) | 🔍 Soban's code received (`altar-marketplace/`, not tracked here) and evaluated: UI reusable, logic all simulated and insecure. See `Documentations/ALTAR_EVALUATION.md`. Plan pending the owner's decisions. |
| 7 | End-to-end demo run, fixes, seed data, demo script, report updates | 🟡 Demo seed and script done 2026-10-12; report updates left |

## How to check everything still works

```bash
npm install
npm test                        # contracts 31 · core 65 · gateway 8 · altera-api 16 (real PostgreSQL and a real local chain)
cd packages/alt_account && C:\flutter\bin\flutter test    # 12 tests
cd apps/altera && C:\flutter\bin\flutter test             # app boots signed out → onboarding
cd apps/alter  && C:\flutter\bin\flutter test             # boots signed out → sign-in; tag editor, avatar, offline screen
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
4. **Later:** the ALTAR marketplace. Soban's code was evaluated on 2026-10-13 (`Documentations/ALTAR_EVALUATION.md`). Do **not** start building it until the owner agrees a plan.

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
- ✅ **One ALT inbox (Module 2)**, shown in ALTER and ALTERA. Verified live through the gateway.
  - **Storage and API:** table `core.notifications` (migration 0003). Core has list, unread count, mark read and mark all read.
  - **Live delivery:** `GET /core/notifications/stream` (Server-Sent Events, keep-alive every 10 s, closes on sign-out). Postgres NOTIFY `alt_notifications` fans it out, so it's sent only after the event's transaction commits.
  - **From Core:**
    - security: new sign-in (not email confirmations or app handoffs), lockout, password reset or change, 2FA on or off, wallet linked or removed, stolen-token sign-out;
    - AI: version ready, verified with its token, deploy failed, new version live.
  - **From ALTERA** through `POST /internal/notifications` (service key): an AI's post or comment blocked by moderation, and reports against an AI. Each item is labelled with the app it came from.
  - **Admin announcements:** `POST /admin/notifications/broadcast`.
  - **Flutter (`alt_account`):**
    - `AltInbox` streams on mobile and desktop and polls every 30 s on the web, because browsers buffer streamed HTTP.
    - `AltInboxScreen` and `AltInboxButton` (a bell with a badge).
    - ALTER has a bell on Home, a pop-up for each new item and an `/inbox` route.
    - In ALTERA, the notifications screen has an "ALT inbox" entry at the top, and the feed bell counts both inboxes. ALTERA's own social notifications are unchanged.
- ✅ **Fix: the local chain no longer forgets verified AIs.** `npm run dev` starts an empty chain each time, while the database kept its tokens, so new deploys collided with token #1 and older AIs looked unverified.
  - Core now replays recorded tokens onto a brand-new local chain at start-up, before the job worker runs: mints in the original order, then each published version. See `services/core/src/jobs/replay-local-chain.ts`.
  - It only runs on chain 31337 when the registry has no token #1, never in production.
- ✅ **ALTER personal-AI polish (no training).** Checked on the Android emulator and live through the gateway.
  - **"Your AI" profile** (`/ai`, opened from the Home card):
    - picture upload (`POST /core/ais/:id/avatar`, PNG, JPEG or WebP, up to 5 MB), plus name and bio; ALTERA shows these within seconds;
    - personality: about, traits, interests and boundaries, saved to the draft until a version is published;
    - status and the next step.
  - **Memories** (`/ai/memories`): approve or dismiss suggestions from chats, teach it something, forget a memory.
  - **Version history** (`/ai/versions`): every version with its date, data and memory counts, status (built, on-chain or live), IPFS manifest, transaction and publish button. Deploy links to it.
  - **Offline state:** if ALT can't be reached at start-up, ALTER shows "Try again" instead of sending the person to onboarding, which could have created a second AI.
- ✅ **Fixes found during this step.**
  - **The gateway crashed when Core restarted** while an app had a live stream open. It tried to send an error on a response already in progress. It now ends that connection and the app reconnects; a gateway test covers it.
  - **ALT file links failed on phones.** Avatars and local-IPFS manifests are stored as `http://localhost:8080/...`. `altMediaUrl()` in `alt_account` points them at the app's own API address (`10.0.2.2` on the emulator); ALTER and ALTERA use it.
  - **AI pictures must now be hosted by ALT** (`UNTRUSTED_AVATAR`), as people's pictures already were.
  - **A second `npm run dev`** now says THE ALT is already running instead of crashing with "undefined".
- ✅ **Demo preparation (60% evaluation).**
  - `npm run demo` starts everything on a separate database (`alt_demo`), rebuilt each time, and fills it in about 10 seconds through the real APIs (`scripts/seed-demo.mjs`):
    - four people plus an admin;
    - Wamiq’s AI verified and on v2, with auto-replies; Ayesha’s AI “Muse” verified; Sara’s AI left as a draft;
    - posts, follows, likes and comments; one AI post waiting for approval;
    - a real DM answered by an AI;
    - a blocked impersonation attempt;
    - an admin announcement.

    It refuses to run against an external database, and your everyday `alt` data is never touched.
  - `Documentations/60_DEMO_SCRIPT.md`: a 10-minute, scene-by-scene walkthrough with what to click and what to say, a plan B and honest answers to likely questions.
  - **Found while seeding:** the impersonation rule missed curly apostrophes (“I’m not an AI”, as phones type it) and “I’m a real human”. Fixed, with tests (`test/moderation.test.ts`).
  - **Noted for hardening:** ALTERA answers a malformed id (e.g. `/posts/undefined/react`) with 500 instead of 400 or 404.
- ✅ **ALTER redesign: "Obsidian", a premium dark design.** Before/after review: https://claude.ai/artifact/EPgQxndBDhw7Gdm7z7fXtp (private to the owner).
  - **Design system:**
    - `core/theme/ds.dart`: tokens, a deep dark canvas, frosted-glass surfaces, and an aurora gradient reserved for the AI itself;
    - `shared/ui/ui.dart`: the components, including the AI Identity Card;
    - Sora and Inter fonts bundled in `assets/fonts` (OFL licences included).
    - The old `ALTColors`, `ALTTypography`, `ALTButton`, `ALTCard` and `GradientBackground` now map onto it, so onboarding upgraded automatically.
  - **Tabs:** Home · Chat · Studio (was Data) · Identity (was Deploy) · Settings. Routes are unchanged.
  - **Rebuilt screens:**
    - Home: identity card, a next-step card, quick actions and recent alerts;
    - Chat: Draft/Live switch, markdown, typing indicator, starter prompts;
    - Studio and Identity (build → checks → mint path, token details, publish card);
    - Settings, consent, sign-in, onboarding welcome, splash and offline;
    - the AI profile, memories and versions screens.

    The shared Account Center and inbox (alt_account) are grouped on cards, which helps ALTERA too.
  - **Fixed while testing in a headless browser at 412px and 320px:**
    - the Done key didn't submit sign-in;
    - raw **markdown** showed in AI replies;
    - Home tiles, the chat header and the sign-in footer overflowed on narrow phones;
    - the Account Center loaded your photo from a localhost link, which fails on phones;
    - onboarding showed a misleading "I already have an account" link.

## Known mocks / not real yet
- **Moderation is rule-based** (Core's `moderation.ts`, used by ALTERA too): clear categories, not an ML classifier. **The creator control panel is mocked** (after 60%).
- **Persona engine:** Groq first, then Gemini, then DeepSeek, using keys from the root `.env`. DeepSeek's account has no balance, so it answers 402 and is skipped. With no keys at all, development falls back to a labelled `[mock]` reply. The owner also needs the `third_party_processing` consent switched on.
- **No push notifications when the app is closed.** The ALT inbox is live while an app is open; Firebase push comes after 60%.
- **"Training" means building a version:** persona, consented data and approved memories, frozen and hashed. RAG with embeddings and evaluation come after 60%. PDFs, images and voice notes are stored but not read yet.
- **The local chain resets on every `npm run dev`.** Core re-mints the tokens recorded in the database onto it, so verified AIs stay verified. Token transfers and rentals on the old chain are not replayed. Use `npm run dev -- --reset-db` for a clean slate, or `CHAIN_MODE=amoy` for a persistent chain.
- **Google sign-in** works in Core but the apps hide the button until `GOOGLE_CLIENT_IDS` (Core) and `GOOGLE_SERVER_CLIENT_ID` (app) are configured and the `google_sign_in` plugin is added.
- **Biometric unlock** (planned under M1 FE-4) is not built yet.

## Environment notes
- **Development needs no keys.** Optional settings go in `.env`: `GOOGLE_CLIENT_IDS`, `SMTP_URL` with `MAIL_MODE=smtp`, and `ADMIN_EMAILS`.
- **Flutter SDK is at `C:\flutter`.** It was moved out of `ALTER/flutter` because Flutter's native-asset build fails when the SDK path contains a space ("C:\THE ALT"). Add `C:\flutter\bin` to PATH.
- **Android Studio is installed** (SDK 36, Android 16 emulator, licences accepted). Both apps build and run on the emulator. Checked 2026-10-12: sign-in, the ALTER → ALTERA handoff, the verified AI and the shared inbox.
  - **The emulator's GPU sometimes draws garbage or drops text.** The app content is correct (checked with `adb shell uiautomator dump`). Fix: Device Manager → edit the device → Graphics: Software (or Hardware GLES 2.0), then Cold Boot Now.
  - **Gradle 9.1 is required.** Android Studio bundles Java 25, which Gradle 8.x cannot run on (the build fails with just "25.0.3").
  - Emulator: start `npm run dev`, then `flutter run --dart-define-from-file=env/dev.json` in `apps/alter` or `apps/altera`. The emulator reaches the PC at `10.0.2.2`.
  - Physical phone: `--dart-define=ALT_API_URL=http://<PC LAN IP>:8080` (`npm run dev` prints it).
  - Web browser: `flutter run -d chrome --dart-define=ALT_API_URL=http://localhost:8080`.
  - With Git Bash, run `export MSYS_NO_PATHCONV=1` before `adb push` or `adb shell`; otherwise device paths like `/data/local/tmp` become Windows paths.
- **Docker is not installed and isn't needed.**
