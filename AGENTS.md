# Instructions for AI coding agents

Read this whole file before changing anything. Then read `PROGRESS.md` (where things are) and the relevant section of `ROADMAP.md` (the design). If this file and your own habits disagree, this file wins. If `ROADMAP.md` and the code disagree, stop and ask the owner (Wamiq).

## What you are working on

THE ALT ECOSYSTEM has one shared backend (ALT Core) and three apps: ALTER (Flutter), ALTAR (Next.js), and ALTERA (Flutter).

- **One account works everywhere.**
- **AIs are created only in ALTER.** An AI may act on ALTERA or ALTAR only after it is *verified*, meaning it has an AI Identity Token (AIT) on Polygon.
- Design is in `ROADMAP.md`, section 4. Do not invent a different architecture.

## Hard rules

1. **Never commit secrets.**
   - Configuration comes from `.env`. Only `.env.example` is committed.
   - Never put a secret in a Flutter or web app; anything shipped to a device is public.
2. **Never weaken authentication or authorisation to make something work.** This includes skipping token checks, trusting a user ID sent by the client, or disabling rate limits outside tests. If you are blocked, stop and report.
3. **One account system.**
   - Users live only in `core.users`. Never create another users table or another login endpoint in a platform service.
   - Platform services identify the caller by verifying the ALT access token (RS256, public key at `/core/.well-known/jwks.json`) **and** checking the session is still active (see `services/altera-api/src/middleware/auth.js`). They may also read the `x-alt-user-id` header set by the gateway.
   - Flutter apps sign people in **only** through `packages/alt_account` (`AltAccountClient`). Never add login, token or password code to an app itself.
   - **Phones:** "Continue with ALT" opens the **ALT sign-in card** (`showAltSignInSheet` in `alt_account`, owner's decision 2026-10-15): accounts used on the device, the password and any 2FA or email code, checked by Core's sign-in API, or "Continue with ALTER/ALTERA" (the other app confirms, then sends a handoff code). Improve sign-in in that card, never with forms of an app's own.
   - **Web, and on phones for creating an account or resetting a password:** the **ALT Account window** (`/core/account/`, served by Core), which hands back a one-time handoff code.
4. **Each service writes only to its own Postgres schema** (`core`, `altera`, `altar`).
   - Reading other schemas through a view, or holding a foreign key to `core.users` or `core.personal_ais`, is fine.
   - Writing to another schema is not. Call that service's API instead.
5. **Migrations:**
   - New SQL files only, in `services/<service>/migrations/NNNN_name.sql`.
   - **Never edit a migration that has been committed**; the runner refuses changed checksums.
   - Never create tables at server start-up.
6. **Do not rename or delete existing API routes** that the ALTERA app calls unless the task says so. ALTERA's Flutter app depends on about 60 endpoints.
7. **Never fake verification.** No hard-coded `is_verified = true`, mock transaction hashes or pretend blockchain calls.
   - If a feature is simulated on purpose, name it `simulated`/`mock` in code and in the UI.
   - Add it to the "Known mocks" list in `PROGRESS.md`.
8. **Tests:**
   - Add or update tests for any backend behaviour you change.
   - Run `npm test` (backend) and `flutter analyze` (apps) before saying you are done.
   - Report failures honestly, with the output.
9. **Do not touch these:**
   - `services/core/src/http/routes/auth.ts`, `services/core/src/modules/accounts/*`, `services/core/migrations/*`, `packages/alt_account/lib/src/client.dart`, `services/altera-api/src/middleware/auth.js` and `packages/contracts/*`, unless your task explicitly names them;
   - anything under `_archive/`, the university documents in `docs/fyp/`, or the PDFs in `docs/scope/`.
10. **Keep changes small and focused.** Don't reformat files you didn't otherwise change. Match the style of the file you're editing.

## How to run and check things

```bash
npm install
npm run dev         # everything at http://localhost:8080 (embedded Postgres, no Docker)
npm test            # all backend tests
npx tsc --noEmit    # inside services/core or services/gateway
```

- In development, OTP emails are not sent. Read them at `http://localhost:8080/core/dev/mail`.
- **Flutter** is at `C:\flutter` (not in the repo; a path with a space breaks Flutter's native-asset builds). Use `C:\flutter\bin\flutter` if it isn't on PATH. Check each app with `flutter analyze` and `flutter test`, and `flutter build web` to prove it compiles. Android Studio (SDK 36, an Android 16 emulator) is installed; build with `flutter build apk --debug`. Both apps need Gradle 9.1+ because Android Studio bundles Java 25.
- In Flutter widget tests, mock secure storage with `FlutterSecureStorage.setMockInitialValues({})` and the `app_links` channel (see `apps/*/test/widget_test.dart`).
- Flutter apps take their API address from `--dart-define-from-file=env/dev.json`, which `npm run dev` writes. The Android emulator uses `10.0.2.2`.

## Conventions

- **Backend:** TypeScript (ESM, Node 22+), Fastify 5, zod schemas on every route, and `pg` with SQL (no ORM). Wrap multi-statement writes in `tx()`.
- **Errors:** throw `AppError` from `services/core/src/lib/errors.ts`. Clients receive `{ "error": { "code", "message", "details?", "requestId" } }`.
- **Audit:** record security-relevant actions with `audit(client, …)` inside the same transaction. Announce changes other services care about with `publish(client, topic, payload)`, the outbox.
- **Notifications:** tell a person something with `notify(client, …)` from `services/core/src/lib/notify.ts`, inside the same transaction as the event. Other services use `POST /internal/notifications` with the service key (see `core_client.notify` in ALTERA). Apps show them with `AltInbox` and `AltInboxScreen` from `alt_account`; never build a separate inbox.
- **API paths behind the gateway:** `/core/...`, `/altera/...`, `/altar/...`. Inside a service, routes have no prefix.
- **Flutter:** Riverpod and go_router (ALTER). No hard-coded URLs; use the dart-define config.
- **ALTER's look (themes):** take every colour, font and spacing from `Ds` (`apps/alter/lib/core/theme/ds.dart`) and build screens from `apps/alter/lib/shared/ui/ui.dart` (`AltPage`, `Glass`, `Btn`, `ListRow`, `Group`, `Pill`, `AiIdentityCard`…). `Ds` reads the active palette (`core/theme/palettes.dart`): **Sapphire** (default), Linen (light), Obsidian (the first design), Emerald and Porcelain, switched in Profile → Advanced → Theme (hidden on purpose, like ALTAR's). `Ds` values are getters, so never put them in `const` expressions or default parameter values, and never hard-code colours: a screen must work in light and dark palettes. Don't style Material widgets one by one, and check new screens at 320px width (narrow phones).
- **Profile pictures:** a person's picture is `core.users.avatar_url` (everywhere); `core.platform_avatars` may override it for one platform. Ready-made pictures come from `GET /core/avatars/presets`: `human` sets for people, `ai` sets for AIs, never mixed. Keep the credits visible wherever the sets are shown. To change the sets, edit and run `scripts/make-avatars.mjs`; don't add copyrighted characters.
- **Ownership follows the token:** never change `core.personal_ais.owner_id` directly; call `syncToken` (`services/core/src/modules/market/holders.ts`), which reads the chain. Dataset routes show an item only to the person who added it, so a buyer never sees the seller's files.
- **ALTAR API (`services/altar-api`):** owns the `altar` schema (listings, history, reviews, saved AIs). It reads the chain but **never signs or holds keys**; anything that spends goes through ALT Core (`/core/me/wallet/*`, `/core/ais/:id/market*`), which needs the person's password or 2FA code. On-chain prices are the truth; `altar.listings` and `altar.transactions` only mirror the contract's events. Reviews need a matching purchase, rental or subscription in `altar.transactions`.
- **ALT Portal (`apps/alt-portal`, Next.js, `/portal`):** the staff website (M3: cases, people and roles, audit log). Its look is "control room" and deliberately unlike the user apps: flat and square, 1px rules, no shadows or rounded cards, IBM Plex Sans with IBM Plex Mono for numbers, ids and labels, one ultramarine accent, red and amber only for priority. Colours come only from the tokens in `src/app/globals.css` (light and dark). It talks to ALT only through `src/lib/alt.js` and Core's `/staff/*` and `/admin/*` routes; the staff session lives in the tab's memory (never storage or a cookie). Staff identity always comes from Core (`/staff/me`); never trust a role the page holds.
- **ALTAR web (`apps/altar-web`, Next.js):** the "Studio" design. Take colours only from the theme tokens in `src/app/globals.css` (`bg-canvas`, `text-ink`, `bg-accent`…, never raw `black`/`white`/`green-500`) and pieces from `src/components/ui.js`; every token's picture is `AitArt`. Themes live under Settings → Advanced on purpose; don't surface them. It talks to ALT only through `src/lib/alt.js`, on the same origin as the gateway (`/core/...`, `/altar/...`). It has no accounts, database or API routes of its own; never keep tokens in `localStorage`. Identify people by their ALT id, never by display name. `_archive/altar-marketplace/` is Soban's original, kept locally for reference only.
- **Commits:** imperative summary line, then what and why. One logical change per commit.

## When you finish a task

1. Run the checks above.
2. Update `PROGRESS.md`: tick what you finished, add anything you mocked or left undone, and note any new environment variables.
3. Summarise for the owner: files changed, how you verified, and what is still open.
