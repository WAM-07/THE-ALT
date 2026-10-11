# Progress

The live status of the 60% sprint. Update this whenever work lands. The design is in `ROADMAP.md`; rules for agents are in `AGENTS.md`.

**Sprint:** 7 days, starting 2026-10-11. Target: 12+ complete modules, all running from `npm run dev`.

| Day | Goal | Status |
|---|---|---|
| 0–1 | Repo restructure, one-command dev, **ALT Core identity** (M1) and the gateway (M4) | ✅ Done 2026-10-11 |
| 2 | ALTERA moves onto ALT Core: one users table, shared login, app-to-app handoff | ✅ Done 2026-10-11 |
| 3 | Smart contracts (AITRegistry, ALTMarketplace) with tests, Amoy deploy, IPFS pinning, mint pipeline (M17, M6) | ⏳ Next |
| 4 | Core AIs, versions, consent and datasets; persona engine; ALTER onboarding, chat and deploy wired to the server (M8, M10) | ☐ |
| 5 | Verified AIs on ALTERA: verified-only gate, persona engine for posts and DMs, moderation, notifications (M13–M16, M2) | ☐ |
| 6 | ALTAR marketplace: buy, rent, royalties, wallet (M11, M12) | ☐ |
| 7 | End-to-end demo run, fixes, seed data, demo script, report updates | ☐ |

## How to check everything still works

```bash
npm install
npm test                        # core 29 · gateway 7 · altera-api 12 (real PostgreSQL, no mocks of the database)
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

## Next up (Day 3: blockchain identity)
- Create `packages/contracts` (Hardhat) with `AITRegistry` (ERC-721 + ERC-2981 + ERC-4907) and `ALTMarketplace`, exactly as `ROADMAP.md` section 4.7 specifies, with tests including the attack cases.
- Deploy to the local Hardhat chain from `npm run dev`. Deploy to Polygon Amoy with a funded relayer key in `.env`.
- IPFS pinning in Core (Pinata, or a local stub in development) and the mint pipeline as a queued job in a PostgreSQL job table.

## Known mocks / not real yet
- **ALTERA AI personas cannot be verified yet.** Minting arrives on Day 3 and the "Bring your AI" link to Core on Day 5. Until then they cannot post or DM, which is deliberate.
- **ALTERA `routes/blockchain.js` is still a mock.** It is replaced on Day 5.
- **ALTERA moderation is a keyword list** (Day 5). **The creator control panel is mocked** (after 60%).
- **ALTER:**
  - training is a timer animation (real training comes after 60%);
  - the persona and consent toggles are stored on the phone only, and **consent toggles are not recorded** (Day 4);
  - the persona is per device, not per account, until Day 4.
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
