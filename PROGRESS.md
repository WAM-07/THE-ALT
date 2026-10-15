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
| 6 | ALTAR marketplace: buy, rent, royalties, wallet (M11, M12) | ✅ All 4 steps done (2026-10-13 to 15): `apps/altar-web` redesigned on ALT accounts; `services/altar-api`; the ALT wallet and on-chain listings; buying, reselling with royalties, renting and rental chat; subscriptions, reviews and the creator's royalties. Plan: `docs/altar-evaluation.md` §7. Next: Polygon Amoy (needs the owner's key). |
| 7 | End-to-end demo run, fixes, seed data, demo script, report updates | 🟡 Demo seed and script done 2026-10-12; report updates left |

## How to check everything still works

```bash
npm install
npm test                        # contracts 36 · core 94 · gateway 10 · altera-api 17 · altar-api 6 (real PostgreSQL and a real local chain)
cd packages/alt_account && C:\flutter\bin\flutter test    # 12 tests
cd apps/altera && C:\flutter\bin\flutter test             # app boots signed out → onboarding
cd apps/alter  && C:\flutter\bin\flutter test             # boots signed out → sign-in; tag editor, avatar, offline screen
cd apps/altar-web && npx eslint . && npx next build   # ALTAR web
npm run dev                     # everything at http://localhost:8080 (ALTAR is the front page)
```

## Done

### Day 0–1 (2026-10-11)
- **Monorepo:** `apps/`, `services/`, `packages/`, `scripts/` and `docs/` (tidied 2026-10-15; `tools/` was folded into `scripts/`). ALTERA's old nested git history and the file whose name contained the old Groq key are kept locally in `_archive/` (git-ignored).
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
4. **Now:** the ALTAR marketplace, in the four steps of `docs/altar-evaluation.md` §7 (owner's go-ahead 2026-10-13).

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
  - `docs/demo-script.md`: a 10-minute, scene-by-scene walkthrough with what to click and what to say, a plan B and honest answers to likely questions.
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

- ✅ **ALTAR step 1: foundation** (2026-10-13). Checked live through the gateway with `npm run demo`, at 1440px, 390px and 320px.
  - **`apps/altar-web`**: Soban's design, moved onto Next.js 16.4.0 (15.1.0 had remote-code-execution advisories), as an npm workspace. `npm run dev` starts it, and the gateway serves it at `/`.
  - **Removed:** the public key-value database API, plaintext passwords, the shared global session, the free wallet, fake card checkout, escrow, the "smart contract" animation, model-file uploads, canned AI chat, messages (DMs live on ALTERA), and Google sign-in (until configured in Core).
  - **ALT accounts** (`src/lib/alt.js`): sign-in with 2FA and email codes, sign-up, and `/handoff` from ALTER and ALTERA. The access token stays in memory; the refresh token is Core's httpOnly cookie.
  - **Browse and details** use Core's verified AIs. Each detail page re-reads the AIT from the chain (owner, creator, version, manifest hash) and links to independent verification. **My AIs** lists the person's AIs with their status.
  - **Core:** `/public/ais` now includes owner and creator, and AI summaries include `royaltyBps`; tests extended.
  - **Gateway fixes found live:**
    - the front-page route never started: it clashed with CORS's `OPTIONS *`;
    - a browser dropping a WebSocket (Next's live reload) crashed the whole gateway. Upgrades now get an error handler, and ALTAR's route proxies WebSockets.

    A gateway test covers the routing.
  - **Phones:** Soban's header had no menu below 1024px. It now has a compact row, and the search bar and toggle fit at 320px.

- ✅ **ALTAR themes to compare** (2026-10-13, owner's request; replaced by the redesign below). My AIs → Appearance, or the region button in the header, switched between:
  - **Original:** Soban's pure black with one green;
  - **Forest:** layered green-blacks, softer text, a deeper green scale;
  - **Daylight:** a light marketplace with a dark hero.

  Each theme redefines Tailwind's colour names in `globals.css` (`black` = card, `white` = text, `green-*` = brand scale, plus `canvas`/`raised`/`popup`), so Soban's markup is unchanged. The choice is saved per browser and applied before first paint. Checked on home, grid and detail pages at 1440px.
  - **The sign-up code "never arrived"** because development doesn't send email. The code screens now link to the dev mailbox (`/core/dev/mail`) when it exists. Real email needs `MAIL_MODE=smtp` and `SMTP_URL` in `.env`.
- **Owner's answers (2026-10-13):** the subscription function may be added to `ALTMarketplace` (step 4); the seller's private documents stay sealed from buyers; Soban's app was never online, so his Supabase needs no rotation.

- ✅ **"Continue with ALT": one sign-in window for every platform** (2026-10-13, owner's request; touches sign-in, so it was named in the task).
  - **The ALT Account window** is static pages served by Core at `/core/account/` (`services/core/public/account/`). It shows ALT's own look (green, orange and ink bars) with the platform named: "to continue to ALTAR". It covers sign-in, 2FA, sign-up with the email code, and forgot password, with plain-language errors.
  - **How it hands back:**
    1. It signs in with a short "app" session (no cookie) for the target platform.
    2. It asks Core for a handoff code, then ends its own session with `DELETE /me/sessions/:id`. It deliberately avoids `/auth/logout`, which would clear the web cookie of an ALT site on the same origin.
    3. It returns the code: `postMessage` to the opener (same origin, with `state` checked) on the web; the app's `alter://` / `altera://handoff` link on phones; or ALTAR's `/handoff` page when popups are blocked.
  - **Security headers:** `frame-ancestors 'none'`, `script-src 'self'`, `form-action 'none'`, and `Cross-Origin-Opener-Policy: unsafe-none` so the popup keeps its opener. Covered by `test/account-page.test.ts`.
  - **ALTAR:** the sign-in and sign-up pages and the header buttons open it as a popup (`continueWithAlt` in `src/lib/alt.js`). ALTAR has no password form at all.
  - **ALTER and ALTERA:** "Continue with ALT" and "Create an ALT account" open it in an in-app browser tab (`AltAccountWindow` and `ContinueWithAltButton` in `alt_account`). The old form stays behind "Use email and password in …" as a fallback, and is the only option on web and desktop builds. Android activities are now `singleTask`, so the return link reuses the running app and closes the tab.
  - **Verified live:**
    - ALTAR in headless Chrome: popup, sign-in, back on My AIs.
    - Android emulator: ALTER (data wiped first) came back signed in as Wamiq; ALTERA came back signed in as Hamza on the feed.
  - **Not yet:** Google sign-in inside the window; the app's handoff link doesn't yet check a `state` value (a crafted link could sign the app into another account; this predates the window).

- ✅ **ALTAR redesign** (2026-10-13, owner's request: "it's not attracting just yet"; references: labs.google and magiceden.io).
  - **Look:** "Studio", a warm paper canvas with ink type (Bricolage Grotesque headings, Figtree text), bright friendly shapes and green as the accent. Colours are design tokens in `globals.css` (`canvas`, `surface`, `ink`, `accent`, `b1`–`b4`…); building blocks are in `src/components/ui.js` (`Button`, `Chip`, `Avatar`, `VerifiedTick`, `Shape`…).
  - **AIT art:** every token gets its own generated artwork from its contract and token id (`AitArt.js`), like the art on an NFT. The AI's own picture sits on top.
  - **Home:** a hero with the newest tokens fanned like cards, real counts, a "Newly minted" table, "Three ways to hold an AI" (own, rent, subscribe, royalties), the explore grid (categories, filter, sort), creators, and a "List your AI" band.
  - **AI page:** large token art that stays in view, an Own / Rent / Subscribe panel (prices say "Not listed"; buttons are disabled until step 3), about, traits, on-chain proof checked live, and activity (the mint).
  - **Profile:** a generated banner, wallet chip, "My AIs" and "Saved" tabs (the wishlist modal is gone), and a Settings button. **Settings** has account, region and currency, sign out, and a closed **Advanced** section.
  - **Themes are hidden** as the owner asked: Profile → Settings → Advanced → Appearance lab (`/settings/appearance`). Studio is the default; Night, Forest and Original (Soban's colours) remain to compare. Older saved choices ("daylight") fall back to Studio.
  - **Demo catalogue:** `npm run demo` now also creates three creators (Bilal, Zainab, Omar) and seven more verified AIs across categories (`seedMarket` in `scripts/seed-demo.mjs`), each built, tested and minted through the real APIs, with generated "orb" pictures. Nine verified AIs in total.
  - **Checked:** in headless Chrome at 1440px and 375px, signed out and signed in (Wamiq), in all four themes; `eslint` (no errors) and `next build` pass. The catalogue seed ran against a live demo stack (33 s); a full fresh `npm run demo` with it was not rerun.
- ✅ **ALTAR motion** (2026-10-13, owner's request: "moving objects or animations").
  - **Hero:** the headline rises in line by line, the "owned" highlight swipes across, the shapes morph, spin and float, and the newest token cards are dealt onto the table, then float and follow the mouse (parallax). The counts tick up from zero.
  - **Ticker:** a tilted ribbon of the latest mints slides past under the hero (real tokens; pauses under the mouse).
  - **Token art moves:** always in the hero, on the AI page and on the profile banner; in grids only while a card is hovered. Grain is a static overlay, so the motion stays smooth.
  - **Cards** tilt towards the cursor with a soft light (`useTilt`); sections and grid cards fade up as they scroll in (`Reveal`); pages fade in (`app/template.js`); the Own / Rent / Subscribe tab slides.
  - **Account picture** (top right) opens the profile page directly (owner's choice); Saved, Wallet, Settings and Sign out are on the profile page. The header gains a shadow once the page scrolls.
  - Helpers in `src/components/motion.js`, keyframes in `globals.css`. Everything stops for people whose system asks for reduced motion.
  - Checked in headless Chrome mid-animation (1440px and 375px), hover tilt, the menu and the tabs; `eslint` (no errors) and `next build` pass.
- ✅ **Profile pictures: ready-made sets, global with per-platform choice** (2026-10-13, owner's decisions).
  - **72 ready-made pictures** in separate sets so people and AIs never look alike (`services/core/public/avatars`, built by `scripts/make-avatars.mjs`):
    - **People:** Chibi crew (ALT original), Lorelei and Notionists (CC0), Adventurer and Big Smile (CC BY 4.0; the picker shows the credit).
    - **AIs:** Mecha minis, Androids and AI cores (ALT originals), Bottts (free for commercial use).
    - Famous anime characters were not used: they are copyrighted by their studios.
  - **Global by default:** the picture lives in the ALT account (`core.users.avatar_url`), so ALTER, ALTERA and ALTAR show the same face. **Per platform, optionally:** `core.platform_avatars` (migration `core/0004`) holds a picture for one platform only; ALTAR asks for people with `?platform=altar`, and ALTERA's `altera.users` view prefers the ALTERA one (migration `altera/0003`).
  - **Never blank:** new accounts and AIs get a ready-made picture; removing a picture brings one back; Core fills in older accounts and AIs at start-up (`jobs/default-avatars.ts`).
  - **Core API:** `GET /avatars/presets?kind=human|ai`, the images at `/avatars/<kind>/<set>/<nn>.png`, `PUT /me/avatar/:platform`, `POST /me/avatar?platform=`, and `platformAvatars` in `/me`. People can't use AI pictures and AIs can't use people pictures (`AVATAR_WRONG_SET`). Touches `modules/accounts/users.ts` (sign-up default, `/me`), as the owner's request required. Tests: `test/avatars.test.ts` plus a check in `ai.test.ts`.
  - **ALTAR:** tap your picture on the profile to open the picker (sets, upload, "Everywhere" or "Only on ALTAR", "Use my ALT picture on ALTAR"); an AI's owner gets "Change picture" on its page. Profile buttons are now Open ALTER, Open ALTERA, Wallet, Settings (last); Sign out is in Settings.
  - **Demo:** the seed gives each person and AI a particular ready-made picture (Wamiq's ALT and Muse keep their uploaded orbs).
  - **Checked:** Core 74 tests, ALTERA 16, gateway 9; ALTAR `eslint` and `next build`; in a browser, choosing an ALTAR-only picture changed ALTAR and left the ALT picture alone.
- ✅ **ALTAR step 2: listings and the wallet** (2026-10-14).
  - **ALT Core signs for the custodial wallet** (`http/routes/wallet.ts`, `ChainService.custodial` in `lib/chain.ts`):
    - `GET /me/wallet`: balance, marketplace earnings, platform fee, owned AI tokens;
    - `POST /me/wallet/test-funds`: 100 test POL, local chain only;
    - `POST /me/wallet/withdraw`: earnings into the wallet;
    - `POST /me/wallet/send`: POL out, e.g. to MetaMask;
    - `GET`/`PUT /ais/:id/market`: list for sale and/or rent on `ALTMarketplace` (approval once per wallet, then `listForSale`/`listForRent`/cancel, only what changed).
    - **Spending needs the person:** their password or a 2FA code (`CONFIRMATION_FAILED`); accounts with neither get `CONFIRMATION_UNAVAILABLE`. Rate-limited, audited, and a notification goes to the inbox.
    - **ALT pays the network fee** for listing and withdrawing: the relayer tops the wallet up with just enough gas first. Sending POL out is paid by the person.
  - **`services/altar-api`** (TypeScript, Fastify, zod; port 4200, `/altar` behind the gateway; schema `altar`, migration `0001`):
    - listings: pitch, terms, the monthly subscription price, and a mirror of the on-chain sale and rent prices (re-read from the chain on every save; a listing counts only while its lister still holds the token);
    - saved AIs (the wishlist moved off the browser; old browser lists are carried over once);
    - it checks ALT tokens like ALTERA (JWKS plus an active session), hears sign-outs at once (`alt_sessions_revoked`), reads the chain and **never signs**.
  - **ALTAR web:**
    - a real **Wallet** page: balance, earnings and withdraw, send, test funds, your AI tokens, how to add funds;
    - a real **List AI** page: sale, rent (up to N days) and subscription, pitch and terms, fee and royalty preview; it asks for the password only when an on-chain price changes;
    - prices on cards and AI pages;
    - **Edit listing** for owners.
  - **Demo seed:** six AIs listed (sale, rent and/or subscription), and Hamza (the buyer) gets test POL.
  - **Checked:**
    - tests: Core 77 (new `test/wallet.test.ts`: list from an empty wallet, wrong password refused, a real on-chain purchase, earnings withdrawn, POL sent), `altar-api` 3, contracts 31, ALTERA 16, gateway 9;
    - ALTAR web `eslint` and `next build`;
    - in a browser against the running demo: Bilal got test funds and listed Code Sensei (3 transactions), and a visitor saw the prices.
    - A full fresh `npm run demo` with the new seed was not rerun.
- ✅ **ALTAR step 3: buying and renting** (2026-10-14). The roadmap's Milestone 7 "done when" story passes end to end in `services/core/test/market.test.ts`:
  1. A sells to B.
  2. B resells to C, and A receives the royalty automatically.
  3. D rents for a day and chats.
  4. The rental ends and D loses access.
  5. Every step is in the transaction history.
  - **ALT Core:**
    - `POST /ais/:id/market/buy` and `/market/rent` (password or 2FA; the buyer pays the price, ALT pays the network fee; `expectedPrice` guards against a price change at checkout).
    - **Rights follow the token** (`modules/market/holders.ts`): `syncToken` reads `ownerOf`/`userOf` and moves `core.personal_ais.owner_id` to the new holder's ALT account (a "consumer" role is added), mirrors the renter and the end of the rental (`core.ai_identity_tokens.user_address`/`user_expires`, migration `0005`), audits it, notifies both sides and tells ALTERA (`alt_ai_events`).
    - A background indexer (`indexRegistry`, every 4 s) catches transfers made outside ALTAR too.
    - **Talking on ALTAR** (`http/routes/conversations.ts`): `GET /ais/:id/access`, plus conversations for the owner (any time) or the renter (until the rental ends). Each person sees only their own conversations, and always the published version (channel `altar_rental`). After a rental, old conversations stay readable and sending is refused.
    - **The seller's private files stay sealed:** the AI file routes only show, change or delete items the caller added.
    - **Dev-chain replay** now mints to the creator and hands the token back to its current owner, so royalties survive a restart.
  - **`altar-api`:** an indexer turns `Sold` and `Rented` events into `altar.transactions` (amount, royalty, fee, days, tx hash; `altar.rentals` is a view; migration `0002`). It keeps listings in step with the contract and drops a sold AI's old listing. New routes: `GET /activity?aiId=`, `/me/activity` (bought, sold, rented, rented out, royalty) and `/me/rentals`.
  - **ALTERA follows the owner:** a sold AI's persona moves to the buyer with auto-replies switched off (`services/ai_sync.js`).
  - **ALTAR web:**
    - real Buy and Rent (a days picker with the total) on AI pages;
    - a "You're renting" banner and a chat page (`/chat/[handle]`) with time left;
    - a Rented tab on the profile;
    - wallet and AI-page activity from the chain.
  - **Demo seed:** Hamza rents Urdu Ustad for a day.
  - **Checked:**
    - tests: Core 80 (new `market.test.ts`), `altar-api` 4 (sale, royalty resale and rental indexed, re-reading is harmless), contracts 31, ALTERA 16, gateway 9;
    - ALTAR web `eslint` and `next build`;
    - in a browser on the live demo: Hamza rented Muse for 2 days and chatted, and bought Wamiq's ALT (it moved to him in ALTAR and ALTERA). The wallet showed both.
    - **Not re-proven:** the full fresh `npm run demo`. Its seed was interrupted while Core reloaded during this work.
- ✅ **Fixes after step 3** (2026-10-14, owner's report):
  - **`npm run demo` stopped part-way:** the seed now signs up 8 people, and Core allows 5 sign-ups a minute, so the 6th was refused. The limit stays; the seed waits as long as Core asks ("Try again in N seconds") and retries. A full demo now takes a few minutes.
  - **Password field:** the ALT Account window showed the browser's eye (Edge) and our "Show" text. Now there is one eye icon, crossed out while the password shows, and the browser's own eye is hidden (also on ALTAR).

- ✅ **ALTAR step 4: subscriptions, reviews and royalties** (2026-10-15).
  - **Contract** (`ALTMarketplace`, owner-approved change):
    - `listForSubscription`, `cancelSubscriptionOffer`, `subscribe(tokenId, months)` (1–12 months of 30 days; renewing adds to the time left), `subscriptionExpires` and `isSubscribed`.
    - Payments split like sales: platform fee, the creator's royalty, then the owner.
    - Any number of people may subscribe; ownership never moves. A sale clears the old owner's subscription price; subscribers keep the time they paid for.
    - 5 new tests (36 in all). The ABI is re-exported.
  - **ALT Core:**
    - `PUT /ais/:id/market` takes `subscription` (absent = leave it as it is);
    - `POST /ais/:id/market/subscribe` (password or 2FA, price guard);
    - `core.ai_subscriptions` mirrors who may use the AI until when (migration `0006`); `syncSubscription` fills it, also from the indexer for subscriptions paid elsewhere;
    - subscribers may talk to the AI on ALTAR like renters (role `subscriber`).
  - **`altar-api`** (migration `0003`):
    - subscriptions join the history (`kind = 'subscription'`, `months`);
    - listings now follow the contract alone: the indexer creates, updates or removes them however the AI was listed, and a new owner starts with a blank description;
    - **reviews**: one per person per AI, only from people the chain shows bought, rented or subscribed (never the owner or creator), moderated by ALT Core (`/internal/moderate`, `INTERNAL_SERVICE_KEY`); `GET /reviews`, `/ratings`, `/me/reviews/:aiId`, `PUT`/`DELETE /reviews/:aiId`;
    - `GET /me/royalties`: a creator's royalties per AI.
  - **ALTAR web:**
    - Subscribe on AI pages (a months picker with the total) and a "You're subscribed" banner;
    - a reviews section with stars, and ratings on cards;
    - subscriptions on List AI (on-chain now);
    - a **Rented & subscribed** profile tab;
    - a **Royalties as a creator** card and subscription activity in the wallet.
  - **Demo:** Sara subscribes to Calm Coach and Hamza rents Urdu Ustad; both leave reviews. `docs/demo-script.md` gains **Scene 9: ALTAR** and the new accounts.
  - **Fixed along the way:** test runs could leave a PostgreSQL 18 I/O worker holding the test port, so the next run found "no test files". The embedded database now runs with `io_method=sync` (`packages/devkit`).
  - **Checked:**
    - tests: contracts 36, Core 81, `altar-api` 5, ALTERA 16, gateway 9, and nothing left running afterwards;
    - ALTAR web `eslint` and `next build`;
    - a full fresh `npm run demo` ends cleanly (93 s): 9 AIs, 6 listings, a rental, a subscription and two reviews;
    - in a browser: Hamza subscribed to Calm Coach for 2 months and chatted ("60 days left"), reviews and ratings show, and the wallet lists his payments.
  - **Found by the demo run:** reviews failed with "moderation unavailable" because `altar-api` sent Core its service key but not its name (`x-alt-service`). Fixed, with a test against a stand-in Core that checks both headers (`altar-api` 6 tests).
- **After step 4: owner's test round (2026-10-15)** ✅
  - **Creator pages:** `/creator/<handle>` shows a person's public ALT profile and the verified AIs they made or own. Clicking a creator used to open one of their AIs.
  - **Subscribers stay private:** an AI's public history (`GET /activity?aiId=`) lists sales and rentals only, and `GET /listings/:aiId` gives `activeSubscribers` (how many, never who). A subscriber still sees their own payments in the wallet. This also fixes "Rented by … for null days", which was a subscription shown as a rental.
  - **ALTAR chat:**
    - a "Your AIs" column with picture bubbles (owned, rented, subscribed, and the time left; a strip on phones) to switch between AIs;
    - fixed "two children with the same key": a new conversation's messages were fetched and also added from the reply;
    - **bold** in replies.
  - **Timeouts:** the gateway allowed 15 s but Core waited up to 45 s for one LLM provider, so a slow Groq answer became a 504 instead of falling back to Gemini (it broke a demo seed). Now each provider gets 20 s and the gateway 60 s (`UPSTREAM_TIMEOUT_MS`).
  - **Demo posts have pictures again**, from ALTERA's original images (`services/altera-api/seed-assets`); 3 more posts. With Cloudinary keys in `.env`, each `npm run demo` uploads about 11 pictures to that Cloudinary account.
  - **Checked on a real phone** (Redmi Note 11, Android 13, over USB with `adb reverse tcp:8080 tcp:8080` and apps built with `ALT_API_URL=http://127.0.0.1:8080`): ALTERA signed in by handoff link shows the feed, profile pictures and post pictures; ALTER shows the verified AI, its training and the inbox; the ALT window opens in the phone's browser. Tests: Core 81, gateway 9, `altar-api` 6.

- **AIs follow the ALT account, step 1 of 3: Core and ALTER (2026-10-15)** ✅
  - **The owner's decisions (2026-10-15):**
    - owned, rented and subscribed AIs belong to the ALT account and appear in all three apps;
    - a rented or subscribed AI "works for you": chat in ALTER, ALTAR and ALTERA DMs, and on ALTERA it drafts posts for the renter's own profile. The renter approves each one, and it is shown "posted with <AI>". When the time ends, posts and chats stay but are read-only; renting or subscribing again carries on;
    - apps sign in with a designed in-app ALT card (step 3).
  - **Core:** `GET /me/ais` lists every AI on the account: owned (`created` says whether the person made it), rented and subscribed, with `access: { role, until, active }`. Ended rentals and subscriptions stay listed (inactive) so their conversations can be read. The conversation routes (`/ais/:id/conversations…`) were already account-wide, so a chat started on ALTAR carries on in ALTER. Market test extended.
  - **ALTER:**
    - a "Your AIs" strip on Home (picture bubbles) and a **Your AIs** screen (`/yours`): owned, rented and subscribed, and ended;
    - tapping an owned AI makes it the one ALTER works on (teaching, memories, versions), remembered per account;
    - tapping a rented or subscribed AI opens **`/talk/:id`**, the same conversations as ALTAR, read-only once the time ends, with a way back to ALTAR;
    - someone without an AI of their own but with rented or subscribed ones lands on Your AIs, not onboarding;
    - **fixed:** another account signing in over the current one (a handoff link) kept the previous person's AI on screen; ALTER now starts afresh when the account changes.
  - **ALTAR:** the chat page's "Your AIs" column uses Core's `/me/ais`, so it shows the same list, including ended ones.
  - **Checked:** Core market tests; `flutter analyze` (nothing new) and `flutter test` (ALTER 5); on the phone, Wamiq's Home strip and Hamza landing on Your AIs after switching accounts; on the emulator, a Chess Buddy chat started on ALTAR continued in ALTER.
  - **Next:** step 2, ALTERA (the account's AIs there, DMs with rented ones, drafted posts with "posted with", a bought AI's ALTERA profile moving to the buyer); step 3, the in-app sign-in card.

- **Fixes from the owner's test of step 1 (2026-10-15)** ✅
  - [x] ALTER: the Settings tab in the bottom bar becomes **Profile** (same screen, person icon).
  - [x] ALTER: the Chat tab follows the AI chosen in "Your AIs" (it kept the first AI’s chat). Studio and Identity had the same problem; all three use `FollowsCurrentAi`.
  - [x] ALTAR: an owner sees **Chat** on their own AI's page (it showed only "Manage in ALTER" and "List AI").
  - [x] ALTER: tapping a rented or subscribed AI opens its profile card first (`/held/:id`) (identity card, details, time left), with **Chat** and **Open in ALTAR**.
  - [x] **In-app ALT sign-in card** (step 3, brought forward; no browser). Built in `packages/alt_account` (`sign_in_sheet.dart`, `known_accounts.dart`, `AltHandoff.requestFrom` / `listenForSignInRequests`); both apps open it from "Continue with ALT" and answer each other's requests (`answerAltSignInRequests`); both manifests accept `<app>://signin-request`. Tests: `alt_account` 14, ALTER 5 (opens the card), ALTERA 1. **Tried on the owner's phone:** remembered account → password → Home; ALTERA "Continue with ALTER" → ALTER's confirm card → ALTERA signed in, no browser. Fixed on the way: the card closing itself after the app had already navigated left ALTER on a blank screen. A bottom-sheet card from `alt_account`:
    - accounts used on this device before (remembered: name, handle, picture; never a token or password), one tap to pick, then the password, and the 2FA or email code in the card, through Core's existing `/auth/login`, `/auth/login/2fa`, `/auth/email/verify`;
    - **"Continue with ALTER"** in ALTERA: opens `alter://signin-request?for=altera`; ALTER shows a small confirm card ("Sign in to ALTERA as Wamiq?") and sends back the usual handoff code (`altera://handoff?code=`). Like Google's account chooser, without a browser;
    - sign-up, forgot password and Google still open the ALT window;
    - update AGENTS.md rule 3 (owner's decision 2026-10-15).
- **AIs follow the ALT account, step 2: ALTERA (2026-10-15)** ✅
  - **Core:** `GET /internal/ais/:id/access?userId=` (service key) says whether a person may use an AI now (owner, renter, subscriber), so ALTERA doesn't repeat Core's rules; a new `altera_draft` channel writes a post for the person who hired the AI, in their voice. Market test extended.
  - **ALTERA API** (migration `0004`): `POST /ai/draft-with` (an AI the person may use drafts their post); `POST /posts` takes `assisted_by_ai_id`, checks the same access and keeps the AI's name and handle on the post (`assisted_by_*`), so every feed shows "posted with" even after the rental ends. Test with an owner and a stranger (ALTERA 17).
  - **ALTERA app:**
    - a **Your AIs** strip at the top of Messages, and a **Your AIs** screen (Profile → settings → Your AIs);
    - each AI opens a chat (`/ai-chat/:id`) with the **same conversations as ALTER and ALTAR**, read-only once the time ends;
    - the composer's **Write with your AI** (robot icon): pick an AI, say what the post is about, edit the draft, post. A removable "Posted with <AI>" chip; the feed shows "✦ Posted with <AI>" under the name.
  - **Already true:** a bought AI's ALTERA persona moves to the buyer (`syncLinkedAi` follows Core's owner).
  - **Demo:** Hamza posts a Ghalib couplet "posted with" Urdu Ustad, which he rents.
  - **Fixed on the way:** Groq's gpt-oss counted its reasoning against the reply limit, so about one reply in six came back empty (the chat then fell back to the `[mock]` reply) and most were cut off. Such models now get `reasoning_effort: low` and 300 extra tokens, and a short 429 is waited out once (`services/core/test/llm.test.ts`).
  - **Checked on the owner's phone:** Messages strip; the Chess Buddy chat started on ALTAR, continued in ALTER, continued in ALTERA (real replies after the fix); Write with your AI → post → "Posted with Chess Buddy" in the feed. Once, ALTERA stayed on its splash screen on the first launch after an install; a restart fixed it and it did not happen again.

- **ALTER redesign: premium themes (2026-10-15)** ✅
  - The owner's palettes: **Sapphire** (Royal Blue #112250, Sapphire #3c507d, Quicksand #e0c58f, Swan Wing #f5fde9, Shellstone #d9cbc2), now the default; **Linen** (Linen #f5f1ea, Khaki #d7c9b8, Camel #b2967d, Cocoa #7d5a44, Espresso #4a342a), a light theme. Also **Obsidian** (the first design, unchanged), **Emerald** and **Porcelain** to compare.
  - `Ds` reads the active palette (`core/theme/palettes.dart`), so the app re-themes at once (`main.dart` rebuilds every element). Hidden switch: Profile → Advanced → Theme, remembered per phone.
  - Elements, not just colours: the identity card's material per theme (navy with gold light; cocoa leather; emerald and brass; graphite), the main button (gold on navy, espresso on linen…), tinted glass on dark themes and paper with a soft shadow on light ones, the backdrop light, the dock and the logo. Headings use **Fraunces** (OFL, bundled in `assets/fonts`) in Sapphire, Linen and Emerald.
  - Checked on the owner's phone: every theme on Home; Linen on Chat, Studio and Identity. ALTER tests 5.

## Where to pick up (2026-10-15)
- **Group A, minor fixes (2026-10-15)** ✅
  - [x] A1. ALTERA profile switch: fix the crash, and replace the app-wide personal/AI switch with "Post as" in the composer and a Manage page per owned AI. Profile is always yours; tapping one of your AIs opens `/manage-ai/:id` (identity, Post as it, public profile, "Acts on its own", approvals, its posts); the composer has a "Posting as" chip (`/compose?as=<id>`). Checked on the phone.
  - [x] A2. ALTERA: a rented or subscribed AI also drafts comments and replies for the person. The robot button in a post's comment box ("Reply with your AI", brief optional) drafts in your voice; the comment shows "✦ Replied with <AI>" (Core channel `altera_draft_comment`, ALTERA migration `0005`, shared `write_with_ai_sheet.dart`). Fixed on the way: a comment could appear twice (the live update raced the reply) and commenting dropped the post's "posted with" tag. Checked on the phone.
  - [x] A3. ALTER themes: onboarding and sign-in follow the active theme. The old colour, gradient and heading names (`colors.dart`, `gradients.dart`, `typography.dart`) now read `Ds`, so onboarding, memories, versions and the status badge follow every theme (headings in the theme's face, Fraunces in Sapphire). Checked on the phone in Sapphire: sign-in and onboarding.
- **Group B (2026-10-15)** ✅
  - [x] B1. Picture picker in ALTER and ALTERA (`showAltPicturePicker` in `alt_account`): ready-made sets with their credits, "Upload a photo" (the app's own gallery picker), **Everywhere** or **Only in this app**, and "Use my main picture here". Opened from the Account Center picture, ALTER's Profile picture and ALTERA's Edit Profile. `AltUser.platformAvatars` / `avatarFor(app)`. Checked on the phone: an ALTERA-only picture leaves the main one unchanged.
  - [x] B2. Spending confirmed in the ALT Account window (password or 2FA there, not on ALTAR's page). ALTAR's confirm dialog says "… in ALT" and opens `/core/account/?mode=confirm` (what is paid, the AI looked up by the window itself); Core's `POST /me/spend-approvals` returns a one-time approval (2 minutes) bound to the person, action, AI and amounts, which ALTAR sends as `confirm.approval`. ALTAR lends the window its session by a same-origin message; typing the password on ALTAR's page is only the fallback when pop-ups are blocked. Market test; checked in Chrome: Hamza subscribed to Calm Coach through the window.
  - [x] B3. A seller keeps their old chats with a sold AI, read-only. Without access, `GET /ais/:id/conversations` lists the person's own paid chats and, for a seller, their ALTER chats from when they owned it; `/me/ais` keeps a sold AI as `former_owner` (inactive), shown as "Sold · read only" in ALTER, ALTERA and ALTAR. Market test. (The demo seed has no sale, so it doesn't show there.)
- **Steps 1 and 2 of "AIs follow the ALT account" and the in-app sign-in card are done.** Next, waiting on the owner's review of step 2.
- **Fixed in A1 (found by the owner, 2026-10-15):** on ALTERA's Profile, switching personal → AI persona → personal shows a red error screen: "_ProfileScreenState is a SingleTickerProviderStateMixin but multiple tickers were created" (`screens/profile/profile_screen.dart`: a new `TabController` per switch; use `TickerProviderStateMixin` and dispose the old one). Also `MessagingNotifier.loadConversations` updates a disposed widget during the switch. The owner also asked for a recommendation on the switch itself; see the answer of 2026-10-15 (proposed: replace the app-wide switch with "Post as" in the composer and a Manage page per owned AI).
- **To demo on a phone:** `npm run demo`, connect the phone by USB, `adb reverse tcp:8080 tcp:8080`, install the debug APKs built with `--dart-define=ALT_API_URL=http://127.0.0.1:8080`.
- **Group C (2026-10-15)**: C2 and C4 done; C1 skipped for now (see Later).
  - [x] C2. "Connect MetaMask" on ALTAR: link an outside wallet to the ALT account by signing a message (no password, no key leaves MetaMask). Wallet page → **Your wallets**: Connect MetaMask (or Install MetaMask), linked wallets with Remove. Uses Core's existing SIWE linking (`/me/wallets/nonce`, `/me/wallets/link`); the message is built in `lib/metamask.js`. Linked wallets are not offered as primary on purpose (ALT signs listings and purchases with the ALT wallet). Checked in Chrome with a stand-in wallet that signs like MetaMask.
  - [x] C4. Smarter training: the AI reads uploaded PDFs and notes when it answers. PDF text is extracted at upload (`unpdf`, MIT), kept encrypted beside the file (`<id>.txt.enc`) and readable in ALTER's Studio (`/content?as=text`); retrieval is BM25 over overlapping passages with light stemming (`retrieve` in `modules/ai/repo.ts`). **Fixed on the way:** building a version marked images and documents as processed, so their raw bytes could reach the AI's prompt; now only items with real text (`text_chars > 0`) are read. Tests: `knowledge.test.ts` (Core 88).
- **Group D part and C3 (2026-10-15)** ✅
  - [x] D1. Biometric unlock in ALTER and ALTERA (fingerprint or face, on this phone; switch in the Account Center). `AltAppLock` / `AltAppLockGate` in `alt_account` (`local_auth`): asks when the app opens and after 30 s away, with the phone PIN as fallback; turning it on needs one successful check. Both apps' `MainActivity` is now a `FlutterFragmentActivity` (needed by `local_auth`). Checked on the phone: the switch shows and opens Android's biometric prompt; the unlock itself needs the owner's finger.
  - [x] C3. Notifications module: push to closed apps through Firebase Cloud Messaging. Everything is built and switched off until the owner adds a Firebase project.
    - **Core:** `core.push_devices` (migration `0007`); `PUT /me/push-devices` registers a phone, `POST /push-devices/forget` (the phone's own token) stops it after sign-out; every committed inbox item goes to the person's phones through FCM HTTP v1 (`lib/push.ts`, signed with `FCM_SERVICE_ACCOUNT`); phones Firebase reports gone are forgotten. Tests: `push.test.ts` with a stand-in Google.
    - **Apps:** `AltPush` (`alt_account`) starts Firebase only when the build has `google-services.json`, asks for permission (Android 13+), registers the phone for whoever is signed in and forgets it on sign-out; tapping a push opens the inbox (ALTER) or Notifications (ALTERA). The Google Services Gradle plugin is applied only when that file exists, so builds without it are unchanged.
    - **To switch it on:** (1) Firebase console → new project → add two Android apps, `com.altecosystem.alter` and `com.alteraapp.altera_app`; put each `google-services.json` in `apps/alter/android/app/` and `apps/altera/android/app/` (git-ignored). (2) Project settings → Service accounts → Generate new private key; save the JSON outside the repo and set `FCM_SERVICE_ACCOUNT=<path to it>` in `.env`. (3) Restart `npm run dev` and rebuild the apps.
- **The ALT Command Centre (M3, with M5 and M16 review screens; owner's go 2026-10-15).** A staff website at `/command`; see ROADMAP's decision log. One step at a time, each reviewed:
  - [x] P1. Core: staff roles and the case queue (migration `0008`, `modules/cases/cases.ts`, `http/routes/cases.ts`).
    - **Roles:** `moderator` (reports, flags, appeals), `support` (requests, disputes), `auditor` (reads everything, changes nothing), beside `admin` (everything). Only admins give or take them (`PUT /admin/users/:id/roles`); `PUT /me/roles` keeps them.
    - **Staff routes** (`/staff/me`, `/staff/summary`, `/staff/cases`, `/staff/cases/:id`, `…/assign`, `…/notes`, `…/reply`, `PATCH …`, `…/resolve`) need a staff role **and a session signed in to the Command Centre** (platform `admin`), and 2FA when `STAFF_REQUIRE_2FA` is on (default: production only). Staff can't handle a case they opened, reported or that is about them (`CONFLICT_OF_INTEREST`). Every change is in the case history and the audit log.
    - **Filing:** people use `POST /me/cases` (support, report, dispute, appeal; 10 an hour), services `POST /internal/cases` (service key; reports for a person and automatic flags, with an evidence snapshot). Reports about the same post merge into one case (three or more make it high priority; the same person counts once); reports about a person or an AI merge across apps.
    - **People** see their cases at `/me/cases` with their own messages and ALT's replies (signed "ALT", never a staff name, never another reporter's words), answer with `…/messages`, and get the reply and the outcome in their inbox.
    - Tests: `cases.test.ts` (Core 94). Checked on the live demo: Hamza's help request from ALTERA reached the admin's queue.
  - [x] P2. The Command Centre website (`apps/command-centre`, Next.js 16, at `localhost:8080/command`; `npm run dev` starts it on port 4400, `COMMAND_PORT`).
    - **Design "control room"**, unlike the user apps (owner's request): flat and square, graphite and cool grey, a black side rail, IBM Plex Sans and Mono, one ultramarine accent, red and amber only for priority; light and dark; the rail becomes a top strip on phones (checked at 390px and 320px, no sideways scroll).
    - **Sign-in:** "Continue with ALT" opens the ALT Account window ("to continue to ALT Command Centre"; `platform=admin`), which hands back a one-time code; the session lives in the tab's memory only. People without a staff role see "This account isn't staff".
    - **Pages:** Overview (open, unassigned, yours, high priority, oldest open; by kind and status; next up; audit chain check), Queue (status tabs, kind, platform, assignee and search filters; `j`/`k`/`Enter`/`/` keys), Case (full history with who-can-see-it labels and evidence; reply or internal note; take, status, priority, close as resolved or dismissed, reopen), People (admins: search accounts, give or take roles, clear lockouts), Audit log (admins and auditors: filter, page back, entry details, chain status), plus a jump-to-case box.
    - **Core:** the audit log is readable by auditors too, filters by entity and pages back (`/admin/audit`); the ALT window knows the Command Centre; handoffs for `admin` return to `/command/handoff`. **Gateway:** `/command` goes to the Command Centre with its prefix kept (`COMMAND_URL`; test).
    - **Demo:** the seed files four cases (two reports of Muse merged into one, a billing question, an appeal); `docs/demo-script.md` has **Scene 10**.
    - **Checked** in headless Chrome against the live demo: popup sign-in as `admin@demo.alt`, every page, taking a case, a reply and a note, light and dark, 390px and 320px. Tests: Core 94, gateway 10; `eslint` and `next build` pass.
    - **Not yet:** the session ends on reload (a Command-Centre-only httpOnly cookie needs Core's sign-in routes, `auth.ts`, which are on the don't-touch list; ask before changing); actions such as suspending an AI come in P4.
  - [ ] P3. Platforms report in: ALTERA's reports and AI anomaly flags, Core's moderation blocks, ALTAR review reports, and **Help & support** in the apps (shared screen in `alt_account`) and on ALTAR.
  - [ ] P4. Actions from a case: suspend or unsuspend an AI on the chain, remove a post, comment or review (through its service), warn a person, lock an account; the reporter hears the outcome in their inbox.
  - [ ] P5. Policies (versioned Terms, Privacy, AI content policy, with acceptance records), marketplace disputes and appeals.
- **Later (owner, 2026-10-15), not now:**
  - **Deployment** (Vercel for ALTAR web, Railway/Render for the services; Core's spend approvals would need a shared store with several instances; fix the leaked Groq key in `_archive/`).
  - **Google sign-in buttons**: Core supports it; needs `GOOGLE_CLIENT_IDS` (Core), `GOOGLE_SERVER_CLIENT_ID` (apps) and the `google_sign_in` plugin.
  - **C1 Polygon Amoy**: needs an RPC URL (e.g. Alchemy) and a faucet-funded key in `.env`; `CHAIN_MODE=amoy` is already supported.
- **ALTAR is complete** (all 4 steps). Run `npm run demo` and walk Scene 9 of `docs/demo-script.md`.
- **Waiting on the owner:**
  - **Push notifications:** a Firebase project (the steps are under C3 above).
  - **Biometric unlock:** try it with a real fingerprint (Account Center → Security).
  - **ALTER themes:** which one stays the default after trying them (Sapphire for now).
  - Amoy, deployment and Google sign-in are under **Later** above.
- **Next, after the 60% evaluation** (`ROADMAP.md` §9, in this order): M9 Training Manager (embeddings, style guide, evaluation set and readiness score; text and PDF reading with BM25 is done), M7 Health Score, M18 Creator Control Panel (replaces the mocked one), M3 Admin & Governance, M12 completion (auctions and licence terms), M5 completion (audit explorer, audit hash anchored on-chain).

## Known mocks / not real yet
- **ALTAR:**
  - Renters and subscribers talk to the AI in all three apps; on ALTERA it drafts posts, comments and replies (DM replies stay the person's own).
  - Subscriptions are not replayed when the local dev chain restarts (like rentals).
  - An AI held by a wallet outside ALT has no owner in ALT until it comes back, unless that wallet is linked (Your wallets on ALTAR).
  - Rentals are not replayed when the local dev chain restarts.
  - Spend approvals are remembered as used in Core's memory (fine for one Core instance; several instances would need a shared store). When the browser blocks pop-ups, ALTAR falls back to asking for the password on its own page (sent straight to Core, never stored).
- **Moderation is rule-based** (Core's `moderation.ts`, used by ALTERA too): clear categories, not an ML classifier. **The creator control panel is mocked** (after 60%).
- **Persona engine:** Groq first, then Gemini, then DeepSeek, using keys from the root `.env`. DeepSeek's account has no balance, so it answers 402 and is skipped. With no keys at all, development falls back to a labelled `[mock]` reply. The owner also needs the `third_party_processing` consent switched on.
- **The ALT sign-in card:** "Continue with ALTER/ALTERA" can't show the other app's account name before you tap it (apps can't read each other's data); it says which app, and that app shows the account when it asks you to confirm. Remembered accounts are per app (name, handle, email, picture in encrypted storage). The apps target Android only (owner, 2026-10-15); iOS is out of scope.
- **Push notifications need the owner's Firebase project** (see C3: `google-services.json` for each app and `FCM_SERVICE_ACCOUNT`). Until then the ALT inbox is live only while an app is open. One Core instance sends the pushes (each instance listens, so several would send duplicates).
- **The ALT Command Centre's session ends when its tab is reloaded or closed** (memory only, on purpose for now; see P2).
- **"Training" means building a version:** persona, consented data and approved memories, frozen and hashed. Text files and PDFs are read, with BM25 retrieval over passages; embeddings and evaluation come later. Images, voice notes and scanned PDFs (no text layer) are stored but not read yet. PDFs uploaded before 2026-10-15 need uploading again to be read.
- **The local chain resets on every `npm run dev`.** Core re-mints the tokens recorded in the database onto it, so verified AIs stay verified. Token transfers and rentals on the old chain are not replayed. Use `npm run dev -- --reset-db` for a clean slate, or `CHAIN_MODE=amoy` for a persistent chain.
- **Google sign-in** works in Core but the apps hide the button until `GOOGLE_CLIENT_IDS` (Core) and `GOOGLE_SERVER_CLIENT_ID` (app) are configured and the `google_sign_in` plugin is added.

## Environment notes
- **ALTAR API** runs on port 4200 (`ALTAR_PORT`); `npm run dev` passes it the chain settings and sets the gateway's `ALTAR_URL`. Its tests use their own database (`.data/test-postgres-altar`, port 54398) and the test chain on 8546 after Core's tests.
- **ALTAR web** runs on port 4300 (`ALTAR_WEB_PORT`) behind the gateway. Soban's original repo stays in `_archive/altar-marketplace/` (git-ignored; it holds his live Supabase settings, never copy them).
- **Development needs no keys.** Optional settings go in `.env`: `GOOGLE_CLIENT_IDS`, `SMTP_URL` with `MAIL_MODE=smtp`, and `ADMIN_EMAILS`.
- **Flutter SDK is at `C:\flutter`.** It was moved out of `ALTER/flutter` because Flutter's native-asset build fails when the SDK path contains a space ("C:\THE ALT"). Add `C:\flutter\bin` to PATH.
- **Android Studio is installed** (SDK 36, Android 16 emulator, licences accepted). Both apps build and run on the emulator. Checked 2026-10-12: sign-in, the ALTER → ALTERA handoff, the verified AI and the shared inbox.
  - **The emulator's GPU sometimes draws garbage or drops text.** The app content is correct (checked with `adb shell uiautomator dump`). Fix: Device Manager → edit the device → Graphics: Software (or Hardware GLES 2.0), then Cold Boot Now.
  - **Gradle 9.1 is required.** Android Studio bundles Java 25, which Gradle 8.x cannot run on (the build fails with just "25.0.3").
  - Emulator: start `npm run dev`, then `flutter run --dart-define-from-file=env/dev.json` in `apps/alter` or `apps/altera`. The emulator reaches the PC at `10.0.2.2`.
  - Physical phone: `--dart-define=ALT_API_URL=http://<PC LAN IP>:8080` (`npm run dev` prints it), or over the USB cable: build with `ALT_API_URL=http://127.0.0.1:8080` and run `adb reverse tcp:8080 tcp:8080` (again after every reconnect). No Wi-Fi or firewall rule needed.
  - **Xiaomi/Redmi (MIUI):** turn on Developer options → "Install via USB" (or installs fail with `INSTALL_FAILED_USER_RESTRICTED`); taps from `adb shell input` also need "USB debugging (Security settings)".
  - Web browser: `flutter run -d chrome --dart-define=ALT_API_URL=http://localhost:8080`.
  - With Git Bash, run `export MSYS_NO_PATHCONV=1` before `adb push` or `adb shell`; otherwise device paths like `/data/local/tmp` become Windows paths.
- **Docker is not installed and isn't needed.**
