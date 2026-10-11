# Progress

The live status of the 60% sprint. Update this whenever work lands. The design is in `ROADMAP.md`; rules for agents are in `AGENTS.md`.

**Sprint:** 7 days, starting 2026-10-11. Target: 12+ complete modules, all running from `npm run dev`.

| Day | Goal | Status |
|---|---|---|
| 0–1 | Repo restructure, one-command dev, **ALT Core identity** (M1) and the gateway (M4) | ✅ Done 2026-10-11 |
| 2 | ALTERA moves onto ALT Core: one users table, shared login, app-to-app handoff | ⏳ Next |
| 3 | Smart contracts (AITRegistry, ALTMarketplace) with tests, Amoy deploy, IPFS pinning, mint pipeline (M17, M6) | ☐ |
| 4 | Core AIs, versions, consent and datasets; persona engine; ALTER onboarding, chat and deploy wired to the server (M8, M10) | ☐ |
| 5 | Verified AIs on ALTERA: verified-only gate, persona engine for posts and DMs, moderation, notifications (M13–M16, M2) | ☐ |
| 6 | ALTAR marketplace: buy, rent, royalties, wallet (M11, M12) | ☐ |
| 7 | End-to-end demo run, fixes, seed data, demo script, report updates | ☐ |

## Done

### Day 0–1 (2026-10-11)
- **Repository restructured** into `apps/`, `services/`, `packages/`, `scripts/` and `tools/`.
  - The ALTERA backend now lives in `services/altera-api`. Its old one-off scripts are in `scripts/legacy/`.
  - The ALTERA app is in `apps/altera` and ALTER in `apps/alter`.
  - The nested ALTERA git history and the file whose name contained the old Groq key are kept locally in `_archive/` (git-ignored).
- **`npm run dev`** starts embedded PostgreSQL 18 (no Docker), runs migrations, starts every service, waits for health and prints the URLs.
  - Development secrets are generated into `.data/`.
  - Flutter `env/dev.json` files are written for both apps.
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
  - **Two-factor authentication:** TOTP with replay protection and 8 one-time recovery codes.
  - **Other sign-in methods:**
    - Google sign-in (requires a verified email; claims unverified squatter accounts safely);
    - Sign-In With Ethereum (EIP-4361), including wallet-only accounts.
  - **Wallets:** every account gets an encrypted custodial wallet (AES-256-GCM). Users can link MetaMask, choose a primary wallet and unlink.
  - **Moving between apps:** single-use, 60-second handoff codes and deep links (`alter://`, `altera://`, ALTAR web).
  - **Profile:** handle, display name, bio, avatar upload, public profile and handle availability.
  - **Roles:** creator, consumer, participant (self-chosen) and admin (admin-assigned or from `ADMIN_EMAILS`).
  - **Connected platforms**, recorded on every sign-in.
  - **Audit log:** append-only, hash-chained and database-enforced, with an admin verify endpoint (start of Module 5).
  - **Event outbox** table, ready for cross-service events.
  - **OpenAPI docs** at `/core/docs`.
- **Gateway** (`services/gateway`, Module 4):
  - routing by prefix;
  - JWT verification against Core's JWKS;
  - strips forged identity headers;
  - blocks `/internal` routes;
  - per-user and per-IP rate limits;
  - per-service 502/504 isolation;
  - aggregated `/health`;
  - WebSocket proxying for ALTERA.
- **Tests:** Core has 26 integration tests against a real PostgreSQL, and the gateway has 6. All pass. A live smoke test through the gateway also passed: register, OTP, verify, handoff to ALTERA.

## Next up (Day 2)
- Convert `services/altera-api/src/db/schema.sql` and its runtime `CREATE TABLE`s into `services/altera-api/migrations/`, under the `altera` schema with foreign keys to `core.users`.
- Data migration from the Neon database: `core.users` reuses ALTERA user UUIDs.
- Remove ALTERA's own auth. Verify Core tokens over HTTP and Socket.io.
- Shared Dart package `packages/alt_account`: API client, secure token storage, refresh, handoff, account screens.
- ALTERA and ALTER apps sign in through it.

## Known mocks / not real yet
- ALTERA: `routes/blockchain.js` is a mock, and `POST /profiles/ai` sets `is_verified = true`. Both are removed on Day 5.
- ALTERA: moderation is a keyword list (Day 5). The creator control panel is mocked (after 60%).
- ALTER: training is a timer animation (real training is after 60%). Data is stored on the phone only until Day 4.

## Environment notes
- **Development needs no keys.** Optional settings go in `.env`: `GOOGLE_CLIENT_IDS`, `SMTP_URL` with `MAIL_MODE=smtp`, and `ADMIN_EMAILS`.
- **On this machine:**
  - Node 24.
  - Flutter 3.41.7 is vendored in `ALTER/flutter`, which is git-ignored. The ALTERA app's `.dart_tool` points at `C:/flutter/src/flutter`; run `flutter pub get` with whichever SDK you use.
  - Docker is not installed and isn't needed.
- **Old folder to delete by hand:** `ALTERA/Altera/altera_backend` is a stale copy. It could not be moved because another program held it open. Close any terminal or IDE window inside it, then delete the folder.
