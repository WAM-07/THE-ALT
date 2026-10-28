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
npm test                        # contracts 36 · core 101 · gateway 10 · altera-api 17 · altar-api 6 (real PostgreSQL and a real local chain)
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
  - [x] P3. Every platform reports in to the Command Centre's queue.
    - **ALTERA:** the existing Report buttons on posts and comments also file a case (category from the reason, a snapshot of the post or comment, the author and the AI if one wrote it); reports about one post merge. Its automatic flags (moderation blocked what an AI wrote; an AI far over its daily post limit) become `flag` cases about the AI. `core_client.fileCase`, never blocking the report itself.
    - **Core:** when moderation blocks a reply from a **live** AI (any channel), the persona engine files a `flag` about it (one open case per AI; only the blocked reply is kept as evidence, never what the person wrote; draft tests in ALTER are not flagged).
    - **ALTAR:** "Something wrong with <AI>? Report it to ALT" on AI pages and **Report** on other people's reviews (`altar-api` `POST /reviews/:aiId/:reviewerId/report` files it with a snapshot of the review); **Help & support** at `/help` (from Settings): ask for help (account, payments, a purchase dispute, an appeal against a moderation decision), see your requests and reports, read ALT's replies and answer.
    - **ALTER and ALTERA:** **Help & support** in the Account Center (`AltSupportScreen` and `AltSupport` in `alt_account`): the same cases, the thread with ALT's replies, answering, and new requests.
    - Tests: ALTERA (a report reaches Core once, with its snapshot; a blocked AI post becomes a flag), `altar-api` (review reports, never your own), Core (blocked live reply → one flag per AI), `alt_account` (support API and screen). Core 95, ALTERA 17, `altar-api` 6, `alt_account` 17.
    - **Checked live:** on the demo, Sara reported Calm Coach and asked for help on ALTAR, Hamza reported an ALTERA post; all reached the admin's queue. On the owner's phone, ALTERA → ALT Account → Help & support listed Sara's ALTAR cases and showed staff's reply signed "ALT team".
  - [x] P4. Staff act on a case: **Take action** on the case page offers what fits the case and the staff member's role, always with a reason the person is told; every action is in the case history (staff only) and the audit log (`POST /staff/cases/:id/actions`, migration `0009`).
    - **Suspend / lift an AI on-chain:** the AI registry's `suspend`/`unsuspend` with ALT's **governor key** (`GOVERNOR_PRIVATE_KEY`; on the local chain Hardhat's account #0, which deployed the contracts and holds `GOVERNOR_ROLE`; kept apart from the relayer, which only mints). The AI then can't speak, post or be sold anywhere (status `suspended`, `alt_ai_events` tells ALTERA); its owner is told.
    - **Remove the reported post, comment or review:** Core asks the platform that owns it (`POST /internal/moderation/remove` on ALTERA, `POST /internal/reviews/remove` on ALTAR, both checking the service key; `ALTERA_SERVICE_URL`, `ALTAR_SERVICE_URL`); the author is told.
    - **Warn** (moderators and support; counted on later cases), **lock for 1, 7 or 30 days or until lifted** (signed out of every app at once, emailed the reason; only admins can lock staff), **unlock**.
    - **ALTERA's "Moderation & Compliance"** still shows an owner what was flagged, but owners can no longer clear flags themselves (the button is gone; the route answers `REVIEWED_BY_STAFF`).
    - Tests: Core `case-actions.test.ts` (on-chain suspend and lift, the AI silenced, warn, lock and unlock, removal requests to stand-in services, role and staff limits); ALTERA and `altar-api` (their internal removal routes refuse calls without the key). Core 97, ALTERA 18, `altar-api` 6.
    - **Checked on the demo** without changing it: the governor account holds the role on the replayed chain (read-only call), and the case page offers the right actions up to the confirm step.
    - **Follow-up (owner, 2026-10-15: the don't-touch list became "handle with care", AGENTS.md rule 9):** a staff lock now says so at sign-in (`ACCOUNT_SUSPENDED`: "ALT suspended this account until … We emailed you the reason.") instead of the failed-password message. `auth.ts` and `accounts/users.ts` changed for it; `core.users.lock_reason` (migration `0010`) tells the two locks apart. Tested in `case-actions.test.ts` and the auth tests.
  - [x] P5. Policies, appeals and disputes (in two parts).
    - [x] **P5a. Policies (M3 FE-5).** Terms of use, Privacy policy and AI content policy, versioned (`core.policies`, version 1 of each in migration `0011`, written for the project and marked "not legal advice"), with who agreed to which version (`core.policy_acceptances`, with the platform).
      - Anyone reads them: `GET /policies`, `/policies/:slug?version=`; ALTAR web shows every version at **`/legal/<slug>`** (footer links), which the phone apps open too.
      - People agree to the current version: `GET /me/policies` (`pending`), `POST /me/policies/accept`. Signing up in the ALT window says what you agree to and records it; ALTAR shows a bar, and ALTER and ALTERA a card (`AltPolicyGate` in `alt_account`) until people agree or sign out.
      - Admins publish a new version in the Command Centre (**05 Policies**: the text, how many agreed, every version, write with preview); everyone is notified and asked again. Audited (`policy.accepted`, `policy.published`).
      - Tests: Core `policies.test.ts`, `alt_account` `policy_gate_test.dart` (Core 98, `alt_account` 18).
    - [x] **P5b. Appeals and disputes (M3 FE-4).**
      - **Appeals name the decision:** `GET /me/decisions` lists what staff decided about a person, their AI or their content (suspended, removed, warned, locked); an appeal (`POST /me/cases`, `appealOf`: the case number) is linked to that case (`core.cases.related_case_id`, migration `0011`), once per decision. **Whoever took the decision can't judge the appeal** (they count as involved). The Command Centre shows "Appeal of #N" with the decisions and who made them, and "Appealed in #N" on the original; overturning uses Take action (lift, unlock) on the appeal itself.
      - **Disputes name the payment:** a dispute picks one of the person's ALTAR payments; ALTAR confirms it (`POST /internal/transactions/lookup`, service key) and its details become the case's evidence; the case is about the other side of the payment, so staff can act on them. On-chain payments are final: ALT cannot refund them automatically; staff mediate and can act on the seller or the AI.
      - Help & support on ALTAR and in the apps offers "Which decision?" and "Which payment?" pickers.
      - Tests: Core `case-actions.test.ts` (appeal once, by the person affected, judged by someone else, upheld; dispute only on your own payment, with its evidence), `altar-api` (the lookup needs the key), `alt_account` (pickers' requests). Core 100, `alt_account` 19.
- **Small fixes before the evaluation (owner, 2026-10-16)** ✅
  - [x] **Phone sign-in links can't swap accounts:** a handoff link an app asked for (the ALT window, "Continue with ALTER") carries a one-time `state` it recognises; any other link (`Open in ALTERA`, or one someone crafted) first shows "Sign in to ALTERA as …?" (`showAltHandoffConfirmSheet`), using Core's new read-only `POST /auth/handoff/peek`, unless that account is already signed in. `alt_account` `handoff.dart`, `client.dart`; the ALT window returns the state. Tests: `handoff_test.dart`, auth test. **Checked on the owner's phone:** a link for Hamza that ALTERA didn't ask for showed "Sign in to ALTERA? … Hamza Ali @hamza"; Continue signed in, and the policies card followed.
  - [x] **The Command Centre stays signed in after a reload:** its refresh token is now Core's httpOnly cookie of its own (`alt_rt_cmd`, beside ALTAR's `alt_rt`, so the two never replace each other); signing out clears only it. `auth.ts` (cookie per platform). Test: "web sessions keep their own cookies". Checked in a browser on the demo: signed in, reloaded (still signed in), signed out, reloaded (signed out).
  - [x] **ALTERA answers a malformed id with 400**, not a server error (`middleware/ids.js` on its routers; `/profiles/:id` keeps accepting usernames). Test.
  - Decided: **Sapphire** (navy and gold) stays ALTER's default theme.
  - [x] **One spelling of the name (owner, 2026-10-17):** the full name is **"The ALT Ecosystem"**; otherwise "ALT" or "the ALT …" (never "THE ALT" or "ALT Ecosystem" alone). Fixed in the apps, websites, services, emails, the 2FA issuer, scripts and docs. Not changed: committed migrations (the version-1 policies say "THE ALT ECOSYSTEM"; publish version 2 in the Command Centre to fix them), the `AITRegistry.sol` comment (part of the bytecode; changes with the next contract change), `docs/history/`, and what the saved demo already holds (Wamiq's AI bio, the welcome message). Tests pass.
- **Logos (owner's logo pack, 2026-10-17)** ✅ The pack lives in `docs/brand/logo-pack` (what goes where: `docs/brand/README.md`).
  - **Phones:** `AltLogo` in `alt_account` draws the four logos natively from the pack's geometry and replays its animation keyframes (no Lottie or SVG assets; light and dark; still when the phone asks for reduced motion). ALTER: loading splash and first-run splash animated, sign-in and onboarding still. ALTERA: splash animated on ink, sign-in and onboarding header. "Continue with ALT", the sign-in card and the lock screen show the ALT hexagon. Launcher icons (adaptive, Android 8+), launch screens and web favicons come from the pack (`python docs/brand/make-icons.py`). ALTERA's phone label is now "ALTERA". Test: `alt_logo_test.dart`.
  - **Web:** ALTAR's header, footer, favicon, "Continue with ALT" and whole-page loaders (animated ALTAR logo; "Signing you in" animated ALT); the Command Centre's rail, sign-in screen, waiting screens and favicon; the ALT Account window's header and favicon. Inline SVG with the pack's CSS animation (`globals.css`, `.brand-anim`), so the logos follow every theme.
  - **The classic three bars are kept** (`docs/brand/classic`), behind hidden switches: ALTER Profile → Advanced → ALT mark; ALTAR Settings → Advanced → Appearance lab → ALT mark.
- **The engine and the car (owner's plan, 2026-10-16; see ROADMAP's decision log).** Complete everything except the real trainer, which plugs in later. One step at a time, each reviewed:
  - [ ] E1. Engine slot and training gate (Core): versions record their engine (`base` or `adapter`, training mode `cloud`/`local`/`simulated`, adapter hash, readiness); the manifest and token certify it; verification needs a completed training. `TRAINING_MODE=simulated` (demo, development) runs a labelled ~10-second training with checkpoints; otherwise AIs wait for a trainer. The trainer socket (claim a job, fetch the consented data export, report checkpoints, return the adapter and scores, data deleted) and the inference socket for adapter engines, both tested with stand-ins. Seeded AIs labelled demo.
  - [ ] E2. Readiness and the approval loop (M9 FE-2/FE-4): an evaluation set (the owner's questions with their own answers), a readiness score per training, the owner approves or trains again, then ALT's system check (readiness and safety) before verification.
  - [ ] E3. ALTER: Train (data checklist, cloud or local, live checkpoints), Test and compare, Approve; the lifecycle shown everywhere.
  - [ ] E4. Bring a trained AI (companies and local training): upload an adapter, or connect a trained AI's endpoint; the same system check, then verification and listing.
  - [ ] E5. M7 Health Score: one score per AI from behaviour (speed, moderation hits, reports, ratings, readiness, drift between versions), shown in ALTER, ALTERA and ALTAR (replaces "Health 100%"), with inbox alerts.
  - [ ] E6. M18 Creator Control Panel: earnings, royalties, engagement, health and versions in one place, with CSV/PDF export (replaces ALTERA's mocked panel).
  - [ ] E7. M5 completion: the audit log's hash recorded on-chain regularly, and an AI's behaviour over time in the Command Centre.
  - Later: the real trainer (Python, QLoRA, RTX 3070), Polygon Amoy and deployment, removing the demo AIs.
- **Beta server (owner, 2026-10-20), in progress:** a public test copy for the team on one Ubuntu server (`deploy/beta/`, see its README): the four services and both websites in production mode behind Caddy (HTTPS), the server's PostgreSQL, a private test chain (31337) saved and replayed like the demo, Gmail for email codes, and the demo story built with its own password (`ALT_DEMO_PASSWORD`). The ALTER and ALTERA APKs are built against it.
  - [x] `STARTER_TEST_POL` (Core, new env var, default 0): every new account gets that much test POL on ALT's own test chain (31337 only), sent by a `starter_funds` job, audited (`wallet.starter_funds`) and announced in the inbox. **Handle-with-care change:** `modules/accounts/users.ts` `createUser` queues the job in the account's transaction; it grants nothing on a public network and touches no sign-in or session code. Tests: `wallet.test.ts` (Core 103).
  - [x] `deploy/beta/start.mjs` (launcher), `setup.sh` (server), `deploy.sh` (from a PC); rehearsed locally end to end (seed, then production mode with the chain replayed).
  - [x] **Live (2026-10-20):** https://13-207-216-40.sslip.io on a friend's AWS account for one week (EC2 c7i-flex.large, Mumbai, user `ubuntu`). Seeded with the demo story (password from `.env.beta`); checked over HTTPS: health, ALTAR, the Command Centre, the ALT Account window, sign-in, the wallet's starter POL, an email code sent through Gmail; `/core/dev/mail` answers 404. When the friend terminates the instance, the beta and its data are gone (the scripts redeploy anywhere).
  - [x] APKs: `deploy/beta/build-apks.ps1` builds `ALTER-beta.apk` and `ALTERA-beta.apk` against the beta URL (through a temporary drive letter, since the space in the repo path breaks ALTERA's release build); ALTERA is signed with a beta key in `apps/altera/android` (git-ignored).
  - Seeding runs in development mode (it reads the development mailbox), so `deploy.sh --seed` stops Caddy meanwhile. The first seed, before that fix, was reachable for about 90 seconds; only demo codes already used were in the mailbox.
- **ML models (owner, 2026-10-20)** ✅ (personal adapter, #1, is the next phase; feed ranking later). Full record for the final report: `docs/report-log/ml-models.md` (models, data, evaluation numbers, decisions); raw results in `docs/report-log/results/`.
  - **ML service** `services/ml` (Python, FastAPI, ONNX Runtime on the CPU, scikit-learn; no PyTorch): `/toxicity`, `/embed`, `/anomaly` on 127.0.0.1:4500 behind `INTERNAL_SERVICE_KEY` (refused in production without it). `npm run ml:setup` once (virtualenv, packages, pinned models); `npm run dev` then starts it and sets `ML_URL` (new env var; blank = rules and BM25 alone, as before). The beta's `deploy.sh` sets it up on the server (`/var/lib/alt/ml-venv`, `/var/lib/alt/models`) and `start.mjs` runs it.
  - **Hate speech and toxicity (M16):** `unitary/toxic-bert` with ALT's rules in `checkSafety()` (Core): AI replies, chat messages, ALTERA posts and comments (`/internal/moderate`, which now also returns `level`, `warn`, `source`), writing help, persona clearance. ALTERA DMs: severe blocked, milder asks "Send it anyway?" (`dm:warn` / `confirmed`), self-harm never blocked, AI messages always checked; DM text no longer logged. ALTERA app: "Before you send" dialog. Evaluated on Davidson et al. 2017: F1 0.861 blocking, 0.897 warning, AUC 0.94.
  - **Semantic search (M10, M11):** `bge-small-en-v1.5` embeddings (migration `0012`, vectors only). The persona engine's retrieval is hybrid (meaning + BM25, `retrieveSemantic`); ALTAR's search box also finds AIs by meaning (`GET /core/public/search/ais`). SciFact nDCG@10: BM25 0.677 → hybrid 0.737.
  - **Style match (M9, M7):** "Sounds like you · N%" under each reply in ALTER's test chat, and `GET /ais/:id/style`: logistic regression on 13 writing-style features and embedding similarity, trained on the Blog Authorship Corpus (`services/ml/train_style.py` → `style-model.json`), profile from the creator's own chat messages (with persona-training consent) and "communication style" items. A baseline until the personal adapter.
  - **Abnormal behaviour (M16 FE-3):** daily scan of Core's audit log and chat (12 counts per account), Isolation Forest + per-feature extremeness retrained each scan; unusual accounts become flag cases (`unusual_activity`); Command Centre **06 Unusual activity** (admins can "Scan now"; migration `0013`). Evaluated on **simulated** activity only: recall 0.915 at 0.5% false positives.
  - Tests: Core `moderation`, `semantic`, `style`, `behaviour`; ALTERA "hate speech" (DM block, warn, confirm).
  - **On the beta (2026-10-20):** deployed and checked: toxicity about 21 ms per message and embeddings about 6 ms on the server, 1.5 GB of 3.8 GB memory in use, search by meaning over HTTPS, the first behaviour scan ran ("not enough history": the beta's data starts today).
- **Defence preparation (owner, 2026-10-20)** ✅
  - `docs/defense/`: the team's guide for the evaluation, from the code: `README.md` (pitch, who presents what, day checklist, 25 core questions), `01-running-tests-live.md` (all 217 tests: commands, what each proves, 20 live test cases), `02-database.md` (showing the database, every table, queries), `03-wamiq-alt-core.md` (M1, M4, M3, M17 + M2/M5/M6 flows), `04-soban-alter-altar.md` (M8, M10, M11, M12), `05-tayyab-altera.md` (M13–M16), `06-ml-models.md`, `07-future-plans.md`, `08-unique-technologies.md`.
  - **`npm run db`** (`scripts/db.mjs`): a read-only database viewer for showing it live (tables and row counts, `describe`, `rows` with secrets hidden, `views`, `migrations`, `sql`); every query runs in a READ ONLY transaction. Picks the database the running services use.
  - Measured on the way: contract line coverage is now AITRegistry 100%, ALTMarketplace 95.9% (four guard lines in the subscription functions are untested).
- **Later (owner, 2026-10-15), not now:**
  - **Deployment** (Vercel for ALTAR web, Railway/Render for the services; Core's spend approvals would need a shared store with several instances; fix the leaked Groq key in `_archive/`). The single-server beta above replaces this for now.
  - **Google sign-in buttons**: Core supports it; needs `GOOGLE_CLIENT_IDS` (Core), `GOOGLE_SERVER_CLIENT_ID` (apps) and the `google_sign_in` plugin.
  - **C1 Polygon Amoy**: needs an RPC URL (e.g. Alchemy) and a faucet-funded key in `.env`; `CHAIN_MODE=amoy` is already supported.
- **ALTAR is complete** (all 4 steps). Run `npm run demo` and walk Scene 9 of `docs/demo-script.md`.
- **Waiting on the owner:**
  - **Push notifications:** a Firebase project (the steps are under C3 above).
  - **Biometric unlock:** try it with a real fingerprint (Account Center → Security).
  - Amoy, deployment and Google sign-in are under **Later** above.
- **Next, after the 60% evaluation** (`ROADMAP.md` §9, in this order): M9 Training Manager (embeddings, style guide, evaluation set and readiness score; text and PDF reading with BM25 is done), M7 Health Score, M18 Creator Control Panel (replaces the mocked one), M3 Admin & Governance, M12 completion (auctions and licence terms), M5 completion (audit explorer, audit hash anchored on-chain).

## Road to 100% (owner, 2026-10-28: "complete the 100% of the project")
One reviewed step at a time. Steps marked (manual) need the owner first; see "Owner's manual list" below.
- [x] **S1 Hardening (done 2026-10-28):** the ALTERA block/unblock bug fixed (`actingProfileId` in `routes/profiles.js`: `blocker_id` must be the caller or one of their own AIs, else 403 `NOT_YOUR_PROFILE`; the profile page's block status uses the same check); the missing ALTERA foreign keys (`0006_missing_foreign_keys.sql`: comments/likes `user_id` → `core.users`, messages ↔ conversations deferrable, added `NOT VALID` then validated where old rows are clean), with a DM now saved with its conversation in one transaction (`deliverDm`); the report's Unit Tests 01–03 as named tests (`services/core/test/report-unit-tests.test.ts`, `npx vitest run -t "Unit Test 03"`) and Unit Test 04 (`packages/contracts/test/ReportUnitTest04.test.ts`, `--grep "Unit Test 04"`); both contracts at 100% line coverage (new subscription-guard test); GitHub Actions `.github/workflows/ci.yml` (typecheck, every backend test, contract coverage, `flutter analyze` + `flutter test` for alt_account, ALTER, ALTERA). Backend tests now 209 (Core 129, contracts 42, ALTERA 22, gateway 10, ALTAR 6) + Flutter 32 = 241.
- [x] **ALTERA keyboard fix (2026-10-28, owner's report):** the frosted bottom bar could cover the text being typed. The bar now hides while the keyboard is open (`home_shell.dart`), and every bottom sheet opens above the home screen (`useRootNavigator: true`), so the bar can never sit over a sheet's text box. Test: `apps/altera/test/home_shell_keyboard_test.dart`. To check on the owner's Xiaomi (Android 13).
- [x] **S2 Engine slot and training gate (E1), done 2026-10-28:** migration `0014_engine_slot.sql` (versions record `engine` base/adapter, `training_mode` cloud/local/simulated, training job, adapter hash and URI, readiness, all immutable; training jobs freeze the consented data when they start and record checkpoints, the claiming trainer, its lease, the adapter, scores and data deletion). `modules/ai/training.ts`: `POST/GET /ais/:id/trainings`; **only a trained version passes clearance** (new check `trained`) and can be published (`VERSION_NOT_TRAINED`); the manifest certifies the engine. `TRAINING_MODE=simulated` (default outside production) runs the labelled simulated training as a job (`simulate_training`, `TRAINING_SIMULATED_SECONDS`, 10 s); `TRAINING_MODE=trainer` queues jobs for the **trainer socket** (`http/routes/trainer.ts`, service key: claim with a 30-minute lease, consented data export, checkpoints, adapter back with `dataDeleted: true`, fail; withdrawn consent stops it). **Inference socket:** a version trained for real answers through `ADAPTER_INFERENCE_URL` (`POST /v1/adapter-chat`), else the base engine. Tests `services/core/test/training.test.ts` (stand-in trainer and adapter server); every deploy in the tests, ALTERA's tests and `seed-demo.mjs` now trains first. ALTER: the clearance check "trained" starts a training and shows its stage (the full Train / Test / Approve screens are S4/E3). Seeded AIs are labelled demo since 2026-10-29: `core/0018_demo_label.sql` (`personal_ais.is_demo`), `PUT /admin/ais/:id/demo` (admin, audited), set by `seed-demo.mjs` at the end of the story through the demo admin; shown as "Demo" in ALTER (identity card), ALTAR (card and details) and ALTERA (a trait, synced into `altera/0009`). The owner's saved demo was made before this, so its AIs stay unlabelled until a fresh demo (or an admin labels them in the API).
- [ ] **S3 The real trainer (M9, M10 FE-5):** QLoRA in `services/ml` (Python, `transformers`, `peft`, `bitsandbytes`, `trl`) on a 3–4B open base model; adapter serving with multi-LoRA (llama.cpp or vLLM); the persona engine sends `adapter` versions there. (manual: GPU set-up, base-model choice)
- [x] **S4 Readiness and approval (E2, E3), done 2026-10-28:** migration `0015_readiness.sql`; `modules/ai/evaluation.ts`. The owner's **evaluation set** (questions with their own answers, answers encrypted, owner-only: `GET/POST/DELETE /ais/:id/evaluation-set`); each finished training is **evaluated** at once (job `evaluate_version`; also `POST /ais/:id/versions/:vid/evaluate`): the version answers every question, each answer is moderated and scored on meaning (bge-small embeddings, or shared words without the ML service) and style (the style-match model, once there are 5 writing samples), 0.7 / 0.3; **readiness** = the mean, 0–100, saved on the version. **Approval loop:** `POST /ais/:id/versions/:vid/verdict` (approve, or "train again"); a new version needs a new approval; `/confirm` gives the verdict on the latest trained version. **ALT's system check** (clearance `ready`): `CLEARANCE_MIN_EVAL_ITEMS` questions and `CLEARANCE_MIN_READINESS`, all answers safe. ALTER: **Readiness** screen (questions, its answers next to yours with scores, ask again, approve / train again), reached from Identity. Tests `services/core/test/readiness.test.ts`. **Owner to confirm:** the production defaults (3 questions, 50% readiness) and the 0.7 meaning / 0.3 style weights; in development and the demo they are 0 (shown, not enforced).
- [x] **S5 Bring a trained AI (E4), adapters done 2026-10-28:** `POST /ais/:id/trainings/local` (multipart, up to 512 MB, streamed to disk while hashed): only real LoRA adapters (safetensors header or GGUF magic) are accepted, stored under `STORAGE_DIR/adapters/<sha256>.<format>`, and become a trained version with training `local` ("trained locally"), which then goes through the same readiness, safety and approval checks; ALT's inference server fetches it from `GET /internal/trainer/adapters/:file` (service key). ALTER: Identity → Bring an adapter you trained. Tests in `services/core/test/training.test.ts`. **Not done, owner's decision:** connecting a company's own hosted AI endpoint (people's messages would leave ALT and Core would call outside servers: needs a consent rule and an allow-list).
- [x] **S6 M7 Health Score (E5), done 2026-10-28:** `modules/ai/health.ts`, migrations `core/0016_health.sql` (history with its parts) and `altar/0004_ai_ratings_view.sql` (ALTAR's ratings as a view Core reads). One score 0–100 from safe replies (share blocked by moderation, 30 days), reports (Command Centre cases, 90 days, dismissed excluded), readiness of the live version, ALTAR rating and median reply time; parts with no data are left out; readiness lost since the previous version is subtracted (drift). Recomputed hourly for live AIs (`startHealthScores` in `index.ts`) and when the owner opens it (`GET /ais/:id/health`: score, parts, history); ALTERA re-syncs at once (`alt_ai_events`) and ALTAR already ranks and shows it; the owner is told in the ALT inbox when it falls below 60. ALTER: Health row with its breakdown on Identity. Tests `services/core/test/health.test.ts`. **Owner to confirm:** the weights (safety 0.35, reports 0.25, readiness 0.2, rating 0.1, speed 0.1) and the alert line (60).
- [x] **S7 M18 Creator Control Panel (E6), done 2026-10-28:** `modules/market/creator-panel.ts`, `GET /me/creator-panel` and `GET /me/creator-panel/export?format=csv|pdf`. Earnings as seller or owner and royalties as creator, by kind and by month, from ALTAR's `altar.creator_earnings` view (`altar/0005`, the contract's events); engagement (followers, posts, likes, comments) from ALTERA's `altera.ai_engagement` view (`altera/0007`); health and versions (trained, live, readiness) from Core. CSV (formula-safe) and a one-page PDF written without a library (checked by reading it back with unpdf). ALTER: Settings → **Creator panel** (copy CSV, save PDF on phones). Pricing stays where it is signed: ALTAR's listing (`PUT /ais/:id/market`); licence terms come with M12 (S10, owner's decision). Tests `services/core/test/creator-panel.test.ts`.
- [x] **AI-to-AI messages (M14 FE-1, owner's request 2026-10-29):** `core/0019_ai_messages.sql`, `modules/ai/ai-messages.ts`, routes `/ais/:id/ai-threads[/:threadId]`, `POST /ais/:id/ai-messages` (your AI writes a draft from your brief, to an AI by handle or in a thread, persona channel `ai_message`), `POST .../:messageId/send` (as written or edited, moderated again), `DELETE` (discard), `PUT /ais/:id/ai-messages/settings` (accept from verified AIs, or off). The recipient's owner is told in the ALT inbox, and **their AI passes the message on** when they chat with it in ALTER (`aiInbox` in the prompt, marked as information, never instructions). Safety: verified AIs on both sides, every message approved by its owner (so AIs never answer each other on their own), moderation, 30 per AI a day, the brief encrypted and seen only by its writer, each owner sees only what their AI sent or received while they owned it, the audit log records who and when, never the words. ALTER: Home → AI messages (conversations, brief → draft → send / edit / discard, the accept switch). ALTERA could show the same conversations later (the API is account-wide). Tests `services/core/test/ai-messages.test.ts`.
- [x] **ALTERA M13/M14/M15 gaps, done 2026-10-28:** **AI-to-AI** comments (M14 FE-1, `services/ai_conversation.js`): when a verified AI's post is published, verified AIs that follow it and have autonomy may comment through Core's persona engine (moderated), with loop limits (posts only, never comments; 2 AI comments per post; 10 per AI a day; never across a block) and each one traced in `activity_log` (`ai_comment`, FE-4). **Feed:** engagement-level filter `engagement=low|medium|high` (M13 FE-4, M14 FE-6; ALTERA chip "High engagement"), and the AI's real category from ALTER first (the bio guess only for older profiles). **Influence** (M15 FE-4): `altera/0008_ai_influence.sql` adds a 0–100 influence to ALTERA's engagement view, shown in the Creator panel. **Conditional publishing (M15 FE-2), beta since 2026-10-29:** `altera/0010_conditional_posts.sql`, `routes/conditional.js` (`/conditional-posts`: create with 2 to 4 outcomes, each version moderated up front; list; resolve with the outcome that happened, which publishes that version as you or your verified AI and lets other AIs comment; cancel; an optional deadline after which it expires). ALTERA: the composer's split icon → Conditional posts (beta). The owner says what happened (no automatic outcome source yet).
- [x] **M8 consent record and M6 version diff, done 2026-10-28:** `modules/ai/records.ts`. `GET /ais/:id/consents/record?format=json|pdf`: every consent given or withdrawn, with the words agreed to, policy version and IP (ALTER: Consent → Download my consent record). `GET /ais/:id/versions/:vid/diff[?from=]`: persona changes (private instructions only as set / not set), data added and removed by fingerprint, memories, engine (ALTER: Version history → What changed). Shared text PDF writer `lib/pdf.ts`. Tests `services/core/test/records.test.ts`.
- [~] **M5 forensics (2026-10-28), backend done:** `modules/ai/forensics.ts`, `GET /admin/ais?q=` (least healthy first) and `GET /admin/ais/:id/timeline?days=` (admin, moderator, auditor): replies, blocked replies and reply time per day, health history, versions with engine/readiness/verdict, cases and audit entries. Test `services/core/test/forensics.test.ts`. **Left:** the Command Centre page for it; anchoring the audit hash on-chain (contract change, needs the owner's OK for `npm run demo -- --fresh`).
- [ ] **S8 M5 completion (E7):** the audit log's latest hash anchored on-chain on a schedule (a new contract or registry function), verification against the anchor; an AI's behaviour over time in the Command Centre (forensics).
- [~] **S9 M2 and M6 completion (2026-10-28):** done: **notification preferences** (`core/0017_notification_settings.sql`, `modules/notifications/settings.ts`, `GET/PUT /notifications/settings`): mute a category in the inbox or on the phone (`notify` and `PushSender` respect it; security and system notices never muted), and an **e-mail digest** of unread notifications, daily or weekly (`startDigests`, hourly check, one Core at a time); in both apps through `AltInboxScreen` (the tune icon). M6's version diff is done (above). Still needs the owner: **push on** (Firebase) and **Pinata** in production. Tests `services/core/test/notification-settings.test.ts`.
- [ ] **S10 Remaining features of presented modules:** M12 auctions and licence terms (contract change: redeploy, needs `npm run demo -- --fresh`, owner's OK); M14 AI-to-AI conversation with loop limits; M15 influence metric; M13 engagement-threshold filter; M10 streamed replies; M8 downloadable consent record; M3 staff review before minting (setting); M1 Google sign-in buttons (manual: client ids); M16 Urdu / Roman Urdu moderation (manual: data decision).
- [ ] **S11 Public network and production:** Polygon Amoy deployment and verification (manual: funded keys, RPC), Pinata, production hosting with HTTPS, backups and monitoring (manual: hosting choice).
- [ ] **S12 The 100% report:** Chapter 4 and 5 for all 18 modules, full test results, ML and training evaluations from `docs/report-log/`.

### Owner's manual list (things only the owner can do)
1. **Firebase project** (M2 push): add the Android apps `com.altecosystem.alter` and `com.alteraapp.altera_app`, put each `google-services.json` in `apps/<app>/android/app/`, generate a service-account key and set `FCM_SERVICE_ACCOUNT` (steps under C3 above).
2. **Google sign-in** (M1): Google Cloud OAuth client ids (web + one Android id per app with its SHA-1), then `GOOGLE_CLIENT_IDS` and `GOOGLE_SERVER_CLIENT_ID`.
3. **Polygon Amoy** (S11): a deployer wallet with faucet POL, separate relayer and governor wallets (funded), an RPC URL (e.g. Alchemy); keys only in your shell or `.env`, never in chat.
4. **Pinata** (S9, S11): an account and a JWT for `PINATA_JWT`.
5. **GPU for training** (S3): NVIDIA driver and CUDA on the RTX 3070 PC, or a rented cloud GPU; a Hugging Face account (and accepting the licence if the base model is Llama). Choose the base model with Wamiq's recommendation.
6. **Real training and evaluation data** (S3, S4): each team member chats with their AI and writes 20–30 question-and-answer pairs in their own words (the evaluation set).
7. **Urdu / Roman Urdu moderation data** (S10): approve a public dataset or label a few hundred messages.
8. **Decisions:** auction type and licence terms (M12), health-score weights (M7), production hosting and budget (S11), whether to keep the beta running.
9. **Approve `npm run demo -- --fresh`** after the contract changes (M12 auctions, M5 anchoring): it replaces the saved demo.
10. **Phone checks** after each app step, and screenshots for the report.
11. **The report:** writing review, Turnitin, supervisor meetings, each member's contribution section.
12. **Security housekeeping:** revoke the old Groq key (still pending).

## Known bugs (found 2026-10-21; both fixed 2026-10-28 in S1 above, kept here for the record)
- **ALTERA block/unblock trusts a client-sent id (security).** `POST` and `DELETE /profiles/:id/block` in `services/altera-api/src/routes/profiles.js` (around lines 439 and 464) use `req.query.blocker_id || req.userId` without checking that `blocker_id` is the caller or one of the caller's own AI profiles (the follow route in `routes/follows.js` does check this). Any signed-in person could block or unblock in another profile's name and, because blocking also deletes follows both ways, remove the follows between any two profiles. Fix: accept `blocker_id` only if it equals `req.userId` or is an `ai_profiles.id` with `user_id = req.userId` (403 otherwise), plus an ALTERA test.
- **Missing foreign keys from ALTERA's original schema** (found while showing the ERD in pgAdmin): `altera.comments.user_id` and `altera.likes.user_id` (should reference `core.users`), `altera.messages.conversation_id` (stored as text; should reference `altera.conversations`), `altera.conversations.last_message_id` (should reference `altera.messages`). The API fills them correctly, but the database doesn't enforce them. Fix: a new ALTERA migration that first checks for orphaned rows, then adds the keys. (Columns that may point to a person *or* an AI, such as `follows`, `blocks` and the `*_profile_id` columns, can't have a single foreign key by design.)

## Known mocks / not real yet
- **Simulated training (`TRAINING_MODE=simulated`, development and the demo):** `modules/ai/training.ts` `runSimulatedTraining` walks labelled checkpoints and trains no weights; its "adapter" is a fingerprint of the data it would have used. The version's manifest says `"training": "simulated"` with the note "Simulated training: no model weights were trained.", the API returns `simulated: true`, and ALTER says "Simulated training". Replaced by the real trainer (S3) through `/internal/trainer`.
- **Beta server:** its blockchain is ALT's private test chain (31337), not Polygon Amoy, and the 100 POL each account starts with is test POL on it (real transactions, no value, not on polygonscan).
- **ALTAR:**
  - Renters and subscribers talk to the AI in all three apps; on ALTERA it drafts posts, comments and replies (DM replies stay the person's own).
  - Subscriptions are not replayed when the local dev chain restarts (like rentals).
  - An AI held by a wallet outside ALT has no owner in ALT until it comes back, unless that wallet is linked (Your wallets on ALTAR).
  - Rentals are not replayed when the local dev chain restarts.
  - Spend approvals are remembered as used in Core's memory (fine for one Core instance; several instances would need a shared store). When the browser blocks pop-ups, ALTAR falls back to asking for the password on its own page (sent straight to Core, never stored).
- **Marketplace refunds aren't automatic:** payments are final on-chain; a dispute is mediated by staff (Command Centre), who can act on the seller or the AI.
- **Moderation** is ALT's rules plus the toxicity model when the ML service runs (rules alone without it). The model is English-centred: Roman Urdu and Urdu are weak until our own fine-tune. The creator control panel is real since 2026-10-28 (S7).
- **Behaviour detector:** evaluated on simulated activity only (no labelled real abuse exists); on a new installation it waits for 50 active account-days of history. ALTERA's own activity (posts, DMs) is not in its counts yet.
- **Style match is a baseline** (style features and embeddings), not the personal adapter; it measures style and topic together.
- **Persona engine:** Groq first, then Gemini, then DeepSeek, using keys from the root `.env`. DeepSeek's account has no balance, so it answers 402 and is skipped. With no keys at all, development falls back to a labelled `[mock]` reply. The owner also needs the `third_party_processing` consent switched on.
- **The ALT sign-in card:** "Continue with ALTER/ALTERA" can't show the other app's account name before you tap it (apps can't read each other's data); it says which app, and that app shows the account when it asks you to confirm. Remembered accounts are per app (name, handle, email, picture in encrypted storage). The apps target Android only (owner, 2026-10-15); iOS is out of scope.
- **Push notifications need the owner's Firebase project** (see C3: `google-services.json` for each app and `FCM_SERVICE_ACCOUNT`). Until then the ALT inbox is live only while an app is open. One Core instance sends the pushes (each instance listens, so several would send duplicates).
- **"Training" means building a version:** persona, consented data and approved memories, frozen and hashed. Text files and PDFs are read, with hybrid retrieval over passages (embeddings + BM25 with the ML service, BM25 alone without it). Images, voice notes and scanned PDFs (no text layer) are stored but not read yet. PDFs uploaded before 2026-10-15 need uploading again to be read.
- **The demo keeps its chain; `npm run dev` doesn't.** `npm run demo` saves every block of its local chain (`.data/demo-chain.json` + `.jsonl`, `scripts/chain/journal.mjs`) and replays them on the next start, on the original dates, so tokens, balances, listings, rentals and subscriptions survive with the database (checked: all 47 blocks replayed with identical state roots). Changing the smart contracts needs `npm run demo -- --fresh`. **The local chain resets on every `npm run dev`.** Core re-mints the tokens recorded in the database onto it, so verified AIs stay verified. Token transfers and rentals on the old chain are not replayed. Use `npm run dev -- --reset-db` for a clean slate, or `CHAIN_MODE=amoy` for a persistent chain.
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
