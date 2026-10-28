# Wamiq: ALT Core, the gateway, the Command Centre and the identity token

Your modules: **M1** User Profiling and Authentication, **M4** API Gateway, **M3** Admin and Governance
(the ALT Command Centre), **M17** Blockchain AI Identity. You also answer for the shared foundation the others
stand on: the notification inbox (M2), the audit log (M5) and IPFS versions (M6). Read `08-unique-technologies.md`
too: most "unique" questions land on you.

How to use this file: for each flow, know the **story** (one sentence), the **steps** (what happens, in order),
**where it lives** (file, endpoint, table) and the **why**. When asked "show me", open the file and the table.

---

## 0. ALT Core in one page

- **What:** the shared backend. TypeScript on Node.js 22, **Fastify 5** web framework, **zod** validation on every
  route, `pg` with plain SQL, PostgreSQL schema `core`. Folder `services/core`. Runs on port 4000 behind the
  gateway at `/core`.
- **Size:** 137 HTTP routes (Swagger at `localhost:8080/core/docs`), 13 migrations, 113 tests.
- **Structure:** `src/http/routes/*.ts` (the API: `auth`, `me`, `ais`, `wallet`, `conversations`, `cases`,
  `policies`, `notifications`, `chain`, `directory`, `avatars`), `src/modules/*` (logic: `accounts`, `ai`,
  `market`, `cases`), `src/lib/*` (shared tools: `tokens`, `crypto`, `totp`, `audit`, `notify`, `chain`, `ipfs`,
  `ml`, `mailer`, `push`), `src/jobs/*` (background work).
- **Error format everywhere:** `{ "error": { "code", "message", "details?", "requestId" } }`, e.g.
  `ACCOUNT_LOCKED`, `CONSENT_REQUIRED`, `CHAIN_AI_ALREADY_MINTED`. The app shows the message; the code is for logic.
- **Every request** gets a request id (also sent back as `x-request-id`); logs never contain the
  `Authorization` header or cookies (they are redacted).
- **Security middleware:** helmet (security headers), CORS (closed unless configured), rate limits per route,
  multipart uploads with size limits.

### Who may call what (`src/http/auth-guard.ts`)

| Guard | Used for | What it checks |
|---|---|---|
| `requireUser` | Any signed-in route | A valid RS256 access token **and** that its session is still active in `core.sessions` (so sign-out works instantly) |
| `requireRole('admin')` / `requireAnyRole([...])` | Admin routes, audit log (admin + auditor) | The role is in the token |
| `requireStaff` | Command Centre `/staff/*` routes | A staff role **and** a session signed in *to the Command Centre itself* (platform `admin`; a phone app's token can't be used) **and** 2FA on the account when `STAFF_REQUIRE_2FA` is on (default in production) |
| `requireService` | `/internal/*` routes (service to service) | The `x-alt-service-key` header equals `INTERNAL_SERVICE_KEY` (compared in constant time) and `x-alt-service` names the caller. The gateway hides `/internal` from the internet entirely |

---

## M1: User Profiling and Authentication

### Feature status (be honest)

| Feature (Scope Document) | Status | Where |
|---|---|---|
| FE-1 Register, authenticate, one identity across ALTER, ALTAR, ALTERA | ✅ | `core.users` only; RS256 tokens; handoff between apps |
| FE-2 Profile, picture, preferences, security settings | ✅ | `GET/PATCH /me`, pictures (global + per platform), the ALT Account Center screen in both apps |
| FE-3 Email, social login, wallet login | ✅ email + wallet (SIWE); Google works in Core (tested) but its button is hidden in the apps until a Google client id is configured | `auth.ts` |
| FE-4 2FA and biometric | ✅ TOTP + recovery codes; biometric unlock on the phones (`local_auth`) | `auth.ts`, `alt_account` `AltAppLock` |
| FE-5 Linked wallet identity for minting | ✅ custodial wallet for everyone, MetaMask linking by signature | `users.ts` `createUser`, `me.ts` wallets |
| FE-6 Roles (creator, consumer, participant + staff) | ✅ | `core.users.roles`, guards above |

### Flow 1.1: Sign up and verify the email

Story: you create one ALT account; it works in every app, and it already has a blockchain wallet.

1. App (or the ALT Account window) → `POST /core/auth/register` with email, password, handle, display name.
   Rate limit 5/minute per IP. zod checks formats (handle `^[A-Za-z0-9_.]{3,30}$`, password strength).
2. Core hashes the password with **bcrypt, cost 12**.
3. In **one transaction** (`createUser` in `modules/accounts/users.ts`):
   - checks handle and email are free (`HANDLE_TAKEN`, `EMAIL_TAKEN`);
   - inserts `core.users` with role `participant` (+ `admin` if the email is in `ADMIN_EMAILS`);
   - gives a ready-made profile picture;
   - **generates a wallet**: a new Ethereum private key (viem `generatePrivateKey`), derives the address,
     encrypts the key with **AES-256-GCM** using `CORE_ENCRYPTION_KEY`, stores it in `core.wallets` as
     `custodial`, primary;
   - (beta only) queues a job that sends 100 test POL;
   - writes `account.registered` to the audit log;
   - issues an email code (`issueOtp`).
4. The **email code**: 6 digits from `crypto.randomInt` (cryptographically random), stored as
   **HMAC-SHA256** (keyed, so a database leak can't brute-force it), valid **10 minutes**, max **5 attempts**,
   a new one at most every 60 seconds; older codes are cancelled. In development emails go to
   `/core/dev/mail`; on the beta server Gmail SMTP sends them.
5. `POST /core/auth/email/verify` with the code → `verifyOtp` checks it in its own transaction (so a wrong
   attempt is counted even though the request fails) → sets `email_verified_at` → signs the person in.

Why: one account and one wallet from the first second, so anyone can own an AI token without knowing crypto.

### Flow 1.2: Password sign-in, lockout and "no enumeration"

1. `POST /core/auth/login` with `identifier` (email **or** handle) + password + platform (`alter`, `altera`,
   `altar`, `admin`). Rate limit 10/minute per IP.
2. Unknown account → Core still runs a bcrypt compare against a dummy hash, then says "Wrong email/handle or
   password". **Same message and same timing** for unknown accounts and wrong passwords, so nobody can find out
   who has an account.
3. Locked account → `423 ACCOUNT_LOCKED` (failed passwords) or `ACCOUNT_SUSPENDED` (locked by staff, with the
   end date and "we emailed you the reason").
4. Wrong password → `recordFailure` in its own transaction: `failed_login_count + 1`, audit
   `auth.login.failed`. At **5** failures: `locked_until = now + 30 minutes`, counter reset, audit
   `auth.lockout`, **inbox alert** to the person.
5. Email not verified → `403 EMAIL_NOT_VERIFIED` and a fresh code is sent.
6. 2FA on → returns `mfaRequired: true` and an **MFA token** (a separate RS256 token, audience `alt-mfa`,
   valid 5 minutes) instead of a session. See Flow 1.4.
7. Otherwise `startSession` (Flow 1.3).

### Flow 1.3: Sessions and tokens (the heart of M1)

`modules/accounts/sessions.ts` + `lib/tokens.ts`.

- **Start:** a random 32-byte secret is created; only **SHA-256(secret)** is stored in `core.sessions` with
  the platform, device name, user agent, IP, expiry (30 days). Audit `auth.session.started`; inbox alert "New
  sign-in to ALTERA…" (not for handoffs or email confirmations).
- **Access token:** a JWT signed with Core's **RSA private key (RS256)**. Claims: `sub` (user id), `sid`
  (session id), `plat` (platform), `roles`, `iss` (`<public url>/core`), `aud` (`alt`), `exp` (**15 minutes**),
  header `kid` (key id = thumbprint of the public key).
- **Refresh token:** `"<sessionId>.<secret>"`, 30 days. Apps keep it in secure storage (Android Keystore via
  `flutter_secure_storage`); web gets it as an **httpOnly cookie** (`alt_rt`, or `alt_rt_cmd` for the Command
  Centre) that JavaScript can't read, path `/core/auth`, SameSite Lax, Secure in production.
- **Public key:** `GET /core/.well-known/jwks.json`. The gateway, ALTERA and ALTAR download it once and verify
  every token locally. **No shared secret exists between services.**
- **Refresh** (`POST /core/auth/refresh`, `rotateSession`): locks the session row, checks the secret, then
  **rotates**: the current hash moves to `prev_refresh_hash`, a new secret is issued, the old refresh token stops
  working.
- **Theft detection:** if someone presents the *previous* refresh token (meaning it was copied and the real app
  already used it), Core **revokes the whole session**, audits `auth.session.reuse_detected` and alerts the
  person ("We signed out a device to protect you"). This is the OAuth 2.0 "refresh token rotation with reuse
  detection" practice.
- **Every request** (`requireUser`) checks the token **and** that the session row is still active, so
  sign-out is immediate in Core.

Why short access tokens + long refresh tokens: a stolen access token is useless after 15 minutes; the refresh
token can be revoked at any time.

### Flow 1.4: Two-factor authentication (TOTP)

1. `POST /core/auth/2fa/setup` → Core makes a random secret, stores it **encrypted** as "pending", returns the
   secret and an `otpauth://` link (the app shows a QR code for Google Authenticator / Microsoft Authenticator).
2. `POST /core/auth/2fa/enable` with the first 6-digit code → checked (TOTP: HMAC-SHA1, 30-second steps, 6 digits,
   accepts the previous/current/next step for clock drift) → 2FA on, **8 recovery codes** returned once (stored
   as SHA-256 hashes), audit, inbox alert.
3. Sign-in with 2FA: password → MFA token → `POST /core/auth/login/2fa` with the code **or** a recovery code.
   **Replay protection:** the accepted time step is saved (`two_fa_last_step`); the same code can't be used twice.
   A recovery code works once. Wrong codes count towards the lockout.
4. Disabling 2FA or regenerating recovery codes needs a current code.

The TOTP algorithm is our own implementation of RFC 6238 (`lib/totp.ts`, ~70 lines) so we can explain every line.

### Flow 1.5: Signing out, everywhere, at once

1. `POST /core/auth/logout` → revokes this session; `POST /core/auth/logout-all` → revokes all; device list
   `GET /me/sessions` and `DELETE /me/sessions/:id` revoke one. Password reset revokes all; password change revokes
   all **except** the current one.
2. Every revocation runs `SELECT pg_notify('alt_sessions_revoked', …)` **inside the same transaction**.
   PostgreSQL delivers NOTIFY only when the transaction commits.
3. ALTERA and ALTAR keep a `LISTEN alt_sessions_revoked` connection: they drop the cached session immediately and
   ALTERA closes that person's sockets. Fallback: they re-check `core.sessions` every 15 seconds.
Result: sign out on the phone, and ALTAR in the browser is signed out within a second, even though its access token
had 15 minutes left. Tests: ALTERA "refuses a still-unexpired access token once its session is signed out everywhere".

### Flow 1.6: Moving between apps (handoff)

Story: tap "Open ALTERA" in ALTER and ALTERA opens already signed in.

1. ALTER → `POST /core/auth/handoff {target: 'altera'}` (signed in).
2. Core creates a random 32-byte code, stores its SHA-256 in `core.handoff_codes` (target platform, **expires in
   60 seconds**), audits `auth.handoff.created`, returns `altera://handoff?code=…`.
3. Android opens ALTERA with that link (deep link, `app_links`).
4. ALTERA → `POST /core/auth/handoff/redeem {code, platform: 'altera'}`. Core atomically marks the code used
   (`UPDATE … WHERE used_at IS NULL AND expires_at > now() AND target = $2 RETURNING`), so it works **once**, only
   for that app, only within 60 seconds. A new session for ALTERA is started.
5. **Protection against a crafted link:** an app only redeems silently a link *it asked for* (it carries a
   one-time `state` the app remembers). Any other link first shows "Sign in to ALTERA as Wamiq?" using
   `POST /auth/handoff/peek` (reads whose code it is without using it). Test: `handoff_test.dart`.
6. **"Continue with ALTER" on the sign-in card:** ALTERA opens `alter://signin-request?for=altera`; ALTER (already
   signed in) shows "Sign in to ALTERA as Wamiq?"; on yes it creates a handoff code for ALTERA and opens
   `altera://handoff?code=…&state=…`. Like Google's account chooser, without a browser.
7. **Web (ALTAR, Command Centre):** "Continue with ALT" opens the **ALT Account window** served by Core
   (`/core/account/`, static pages in `services/core/public/account/`). You sign in there (2FA too); it gets a
   handoff code for the target and gives it back to the opener page by `postMessage` (same origin, `state`
   checked), then ends its own temporary session. **The platform never sees your password.** The window can't be
   put in an iframe (`frame-ancestors 'none'`) and runs only its own scripts (CSP). Test: `account-page.test.ts`.

### Flow 1.7: Google sign-in and wallet sign-in

- **Google** (`POST /auth/google` with Google's ID token): Core verifies it with Google's keys. Already linked →
  sign in. New → requires `email_verified` from Google, creates the account (or **claims** an unverified account
  with the same email: drops that unproven password and its sessions, because Google just proved who owns the
  email). Recorded in `core.auth_identities`.
- **Sign-In With Ethereum (EIP-4361)**: `GET /auth/siwe/nonce` (single-use nonce, 10 minutes) → the wallet signs
  a standard message ("example.com wants you to sign in with your Ethereum account… Nonce…") → `POST
  /auth/siwe/login`. Core parses the message, checks the domain and URI are ours, burns the nonce, verifies the
  signature (viem `verifyMessage`, ECDSA recovery). Known address → sign in; new → creates a wallet-only account.
  An address that is an ALT custodial wallet can't be used this way.
- **Linking MetaMask** to an existing account (ALTAR → Wallet → Connect MetaMask): `POST /me/wallets/nonce` →
  sign → `POST /me/wallets/link`. One wallet belongs to one account.

### Flow 1.8: Roles and profiles

- Roles in `core.users.roles`: `participant` (default), `creator` (added when you create an AI), `consumer`
  (added when you hold/rent/subscribe an AI someone else made), `admin`, and staff roles `moderator`, `support`,
  `auditor`. People can set their own non-staff roles (`PUT /me/roles`); only admins give staff roles
  (`PUT /admin/users/:id/roles`). Roles travel inside the access token; a change applies on the next token refresh.
- Profile: `GET/PATCH /me`, pictures `POST /me/avatar` (upload) or ready-made sets (`GET /avatars/presets`, people
  and AI sets never mixed), optional different picture per platform (`PUT /me/avatar/:platform`). Public profile:
  `GET /users/:handle`. Pictures must be hosted by ALT (`UNTRUSTED_AVATAR` otherwise), so no tracking images.

### M1 counter-questions

| Question | Answer |
|---|---|
| Why not Firebase Auth / Auth0? | We need one identity across three apps *and* a wallet per account *and* staff sessions, with the session list, theft detection and instant sign-out. We started with Auth0 in ALTERA and removed it: a client secret was in the app, and accounts were linked by email without checking verification. Our own provider is small, tested (30 tests) and fully explainable. |
| Why RS256 and not HS256? | HS256 needs the same secret in every service; any compromised service could mint tokens. RS256: only Core holds the private key; services verify with the public key. |
| What if the private key leaks? | Generate a new key: the `kid` changes, the JWKS publishes the new key, all old tokens fail, people sign in again. The key is in `.env` / the server's config, never in the repo or an app. |
| Where is the token stored on the phone? | The refresh token in `flutter_secure_storage` (Android Keystore-backed); the access token only in memory. On the web the refresh token is an httpOnly cookie; the access token stays in the tab's memory, never `localStorage`. |
| Why not keep users logged in with just a long JWT? | Long JWTs can't be revoked. Short access + rotating refresh + session table gives revocation and theft detection. |
| How does biometric login work? | It doesn't replace the password: it **unlocks the app** on that phone (`local_auth`, fingerprint/face with PIN fallback) after the app is opened or left for 30 seconds. The session itself is still the ALT session. |
| What does "single identity" mean in the database? | One row in `core.users`. ALTERA reads people through the view `altera.users`; ALTAR through Core's API. No second users table exists. |
| Can someone brute-force the email code? | 6 digits, 5 attempts then the code dies, 5 requests/minute per IP, 10-minute expiry: about 5 guesses in a million per code. |
| Can staff see passwords or 2FA secrets? | No. Passwords are bcrypt hashes; 2FA secrets and wallet keys are AES-256-GCM encrypted; codes and tokens are only hashes. |
| What about GDPR-style deletion? | `DELETE /me` (password + typing DELETE) anonymises the account: email, name, picture, password and 2FA wiped, handle replaced, linked identities and external wallets removed, all sessions revoked. Data items can be deleted for good (Soban's M8). Audit entries stay (accountability). |

---

## M4: The API gateway

`services/gateway/src/app.ts` (240 lines), Fastify + `@fastify/http-proxy`. Port 8080. **The only public door.**

### Flow 4.1: Life of a request

`GET http://localhost:8080/altera/feed` with `Authorization: Bearer <token>`:

1. **Request id**: taken from `x-request-id` or a new UUID; sent back in the response header and passed to the
   service, so one request can be followed through every log.
2. **Internal routes hidden**: any path like `/<service>/internal/...` → `404` immediately. Service-to-service
   routes are unreachable from outside.
3. **Token check at the edge**: if there is a Bearer token, verify it with Core's public key (JWKS, cached,
   refreshed at most every 30 s): signature, issuer, audience `alt`, algorithm RS256, expiry. Invalid or expired →
   `401 INVALID_TOKEN` (the client refreshes). If Core's keys can't be loaded → `503 AUTH_UNAVAILABLE`. No token →
   the request continues; the service decides whether the route is public.
4. **Rate limit**: 600 requests per minute, keyed by user id when signed in, otherwise by IP → `429 RATE_LIMITED`.
5. **Routing by prefix** (`rewritePrefix: ''`): `/core/*` → Core :4000, `/altera/*` → ALTERA API :4100 (with
   WebSockets for Socket.IO), `/altar/*` → ALTAR API :4200, `/command/*` → Command Centre :4400 (prefix kept),
   everything else → ALTAR web :4300 (the public front page).
6. **Header hygiene**: the gateway **deletes** any `x-alt-user-id`, `x-alt-session-id`, `x-alt-roles`,
   `x-alt-platform`, `x-alt-service`, `x-alt-service-key` the client sent, then **sets** the verified caller's
   `x-alt-user-id`, session, roles and platform, plus `x-forwarded-for/proto/host` and `x-request-id`.
7. **Fault isolation**: each upstream has its own error handler and a timeout (60 s, long enough for an AI reply
   that falls back from one LLM provider to another). A dead or slow service → `502 UPSTREAM_UNAVAILABLE` /
   `504 UPSTREAM_TIMEOUT` **for that prefix only**; the others keep working. If a service dies in the middle of a
   streamed response, the gateway closes that connection instead of crashing (a bug we found and fixed; tested).
8. `GET /health` asks every service's `/health` (2-second timeout each) and reports `ok` or `degraded` with
   latencies. `GET /docs` redirects to Core's Swagger.

### Why services *also* verify tokens

Defence in depth: ALTERA and ALTAR verify the JWT themselves too (with JWKS) and check the session is active. If
someone reached a service directly (bypassing the gateway), forged headers alone would not work.

### Feature status

| Feature | How |
|---|---|
| FE-1 Unified access point | One port, one domain for everything (on the beta: `https://13-207-216-40.sslip.io`, Caddy in front for HTTPS) |
| FE-2 Authentication, routing, rate limiting | Steps 3–5 |
| FE-3 Independent scaling of services | Each service is its own process with its own port and config; the gateway only needs its URL. Several instances behind a load balancer are possible; two pieces of in-memory state (spend approvals, push fan-out) would move to a shared store first (honest note) |
| FE-4 Expandability | A new service = one environment variable (its URL) and one prefix. The ML service was added on 20 October without touching the gateway's code (it is internal, called by Core) |
| FE-5 Fault isolation | Step 7; test "isolates a dead service: its routes fail cleanly while others keep working" |

### M4 counter-questions

| Question | Answer |
|---|---|
| Why not Kong / NGINX / AWS API Gateway? | We need JWT verification with our JWKS, header stripping, per-user rate limits and per-service isolation, in code we can test (10 tests) and run on a laptop with one command. 240 lines of Fastify do exactly that. In production a load balancer/Caddy sits in front for HTTPS. |
| Why prefixes and not subdomains? | One origin means ALTAR web and the API share cookies safely (httpOnly refresh cookie, no CORS for the web app). |
| What if the gateway goes down? | Everything public stops; services keep running. It is stateless, so it can be restarted or run as several copies behind a load balancer. |
| How do services talk to each other? | Directly on the private network (never through the public gateway): ALTERA → Core `/internal/*` with the service key; Core → ALTERA `/internal/moderation/remove`; plus PostgreSQL NOTIFY events (`alt_sessions_revoked`, `alt_ai_events`, `alt_notifications`, `alt_jobs`). |
| Is it a microservice architecture if they share a database? | Each service owns its own schema and writes only there; that is the "database per service" principle implemented as schema per service. They don't share tables. |
| What is the timeout and why 60 s? | An AI reply may wait for Groq (20 s limit) and then fall back to Gemini; 15 s used to turn slow replies into 504s. |

---

## M3: Admin and Governance: the ALT Command Centre

A staff website (`apps/command-centre`, Next.js 16, served at `/command`), deliberately **not** inside the user
apps: staff tools never ship to the public. Core side: `http/routes/cases.ts`, `modules/cases/cases.ts`,
`http/routes/directory.ts` (admin), `http/routes/policies.ts`.

### Who is staff

Ordinary ALT accounts with a staff role: `admin` (everything), `moderator` (reports, flags, appeals), `support`
(help requests, disputes), `auditor` (reads everything, changes nothing). Only admins give or remove staff roles.
`/staff/*` routes need a **Command Centre session** (platform `admin`) and, in production, **2FA**. Staff **can't
handle a case they opened, reported, or that is about them** (`CONFLICT_OF_INTEREST`), and whoever made a decision
can't judge its appeal.

### Flow 3.1: Staff sign-in
`localhost:8080/command` → Continue with ALT → the ALT Account window says "to continue to ALT Command Centre" →
sign in (2FA) → handoff code → Command Centre session. Refresh token in the httpOnly cookie `alt_rt_cmd`, access
token in the tab's memory. The page asks `GET /staff/me` who you are; it never trusts a role stored in the page.

### Flow 3.2: Cases from every platform → one queue
1. **People** file cases: `POST /me/cases` (report, support request, dispute, appeal; 10 per hour), from ALTAR
   (Report it to ALT, Help & support) and from ALTER/ALTERA (Account Center → Help & support).
2. **Services** file cases: `POST /internal/cases` with the service key: ALTERA's Report buttons, ALTERA's automatic
   flags (an AI's post blocked; an AI far over its post limit), Core's persona engine (a live AI's reply blocked),
   the daily behaviour scan (unusual account). Each comes with an **evidence snapshot** (the post text at the time).
3. **Merging** (`fileCase`): reports about the same thing merge into one open case (one per post; per person or
   AI across all apps). The same person counts once. **Three or more reports → high priority.** An advisory lock
   stops two simultaneous reports creating two cases.
4. Staff work it: `GET /staff/summary` (overview numbers), `GET /staff/cases` (queue with filters), take it
   (`assign`), reply (the person sees it signed "ALT", never a staff name), internal note (staff only), change
   status/priority, resolve or dismiss (every reporter is told the outcome in their inbox).
5. Everything is in the case history (`core.case_events`, each line labelled who can see it) and the audit log.

### Flow 3.3: Taking action (`POST /staff/cases/:id/actions`)
- **Suspend an AI on-chain**: Core sends `AITRegistry.suspend(tokenId, reason)` signed with the **governor key**
  (`GOVERNOR_PRIVATE_KEY`, holds `GOVERNOR_ROLE`; on the local chain it is Hardhat account #0, separate from the
  minting relayer). Once confirmed: the AI's status becomes `suspended`, `alt_ai_events` tells ALTERA at once, the
  persona engine refuses it, the marketplace contract refuses to sell or rent it, the owner is told. **Lift** =
  `unsuspend`.
- **Remove content**: Core asks the owning service: ALTERA `POST /internal/moderation/remove`, ALTAR
  `POST /internal/reviews/remove` (each checks the service key). The author is told.
- **Warn** a person; **lock** them for 1, 7, 30 days or until lifted (signed out of every app at once; sign-in then
  says "ALT suspended this account until … We emailed you the reason"); **unlock**. Only admins can lock staff.
Every action needs a **reason that the person is told**.

### Flow 3.4: Appeals and disputes (M3 FE-4)
- **Appeal**: `GET /me/decisions` lists decisions about you, your AI or your content; the appeal names one
  (`appealOf`) and is linked to the original case; the decision-maker can't judge it; overturning uses Take action
  (lift, unlock) on the appeal.
- **Dispute**: picks one of your ALTAR payments; ALTAR confirms it (`POST /internal/transactions/lookup`) and its
  details become evidence; the case is about the other side. On-chain payments are final, so staff mediate and can
  act on the seller or the AI.

### Flow 3.5: Policies (FE-5), people (FE-2), audit (FE-3)
- Terms, Privacy, AI content policy: versioned in `core.policies`; who agreed to which version in
  `core.policy_acceptances`; publishing a new version (Command Centre → 05 Policies) asks everyone again (a card in
  the apps, a bar on ALTAR).
- People: search accounts, give/remove roles, clear lockouts (admins).
- Audit log page: filter, page back, entry details, and **chain check** (`GET /admin/audit/verify`).
- Unusual activity page (06): the daily behaviour scan (see `06-ml-models.md`).

### Feature status

| FE | Status |
|---|---|
| FE-1 Manage AIs and listings | ✅ suspend/lift an AI on-chain (which also blocks its listings and sales); removing a listing directly is through suspension |
| FE-2 Accounts, permissions, access | ✅ People page, roles, locks |
| FE-3 Audit transactions and identity integrity | ✅ audit log + chain check; on-chain verification of every token |
| FE-4 Disputes and compliance | ✅ disputes tied to payments, appeals tied to decisions |
| FE-5 Governance policies | ✅ versioned policies with acceptance |
| FE-6 Support channel | ✅ Help & support in all apps |
| FE-7 Review AIs for quality, compliance, authenticity | 🟡 automatic clearance checks before minting + flags and reports reviewed by staff; a manual "approve before minting" step is designed (ROADMAP §4.5, optional admin approval) but not switched on |
| FE-8 Flag or remove violating AIs | ✅ flags from moderation, behaviour scan; suspension on-chain |

### M3 counter-questions

| Question | Answer |
|---|---|
| Why a separate website and not an admin tab in the app? | Staff tools must never ship in public apps (anyone can decompile an APK); staff work at desks with long tables; it updates without an app store. |
| How do you stop a rogue moderator? | Least privilege (roles), Command Centre session + 2FA, conflict-of-interest rule, decisions appealable to someone else, every action in the tamper-evident audit log. Auditors can read it all without changing anything. |
| Why is suspension on the blockchain? | Because the token is the AI's identity everywhere: the marketplace contract itself refuses to sell or rent a suspended AI, even if someone bypassed our apps. |
| Can staff refund a payment? | No: on-chain payments are final (no one, not even ALT, can reverse them). Staff mediate disputes and act on the seller or the AI. Honest and by design. |
| Who reviews automatic flags? | Staff, in the same queue as human reports (kind `flag`). Automatic systems never punish by themselves. |

---

## M17: Blockchain AI identity (the AI Identity Token)

Contracts: `packages/contracts/contracts/AITRegistry.sol` (193 lines), `ALTMarketplace.sol` (283 lines).
Core side: `lib/chain.ts` (viem), `modules/ai/lifecycle.ts`, `jobs/worker.ts`, `modules/market/holders.ts`,
`http/routes/chain.ts`. Full background in `08-unique-technologies.md`.

### What the token is

One **ERC-721** NFT per AI ("ALT AI Identity Token", symbol `AIT`) storing an `Identity`:
`aiId` (the AI's database UUID as bytes32), `creator` (**fixed forever**), `version` (1 at mint, +1 per published
version), `suspended`, `manifestCid` (IPFS id of the latest version's manifest). Plus **ERC-2981** royalty (creator,
≤10%) and **ERC-4907** user (renter) with an expiry. `tokenURI` = `ipfs://<manifestCid>`.

Rules enforced *by the contract* (so no app can cheat):
- Only `MINTER_ROLE` (ALT's relayer) can mint, and the creator is the address it mints to.
- **One token per AI ever** (`tokenOfAi[aiId]`) → **no duplication** (FE-5).
- **One manifest can identify one version ever** (`manifestUsed`) → no copying another AI's identity.
- Royalty ≤ 10%.
- Versions published only by the owner or ALT's relayer; not while suspended.
- Suspended or rented tokens can't be transferred; rentals can't be replaced while active.
- `GOVERNOR_ROLE` suspends and lifts.

### Flow 17.1: From draft to verified (the whole lifecycle)

1. **Build a version** (ALTER Identity → Build; `POST /ais/:id/versions` → `buildVersion`):
   - needs the `persona_training` consent;
   - a `training_jobs` row tracks stages (collecting → building persona → pinning manifest);
   - freezes the persona, the **included** data items and the **approved** memories;
   - writes a **manifest** (`schema: alt.ai-manifest/1`): AI id and handle, version, parent version's CID,
     creator (ALT user id + wallet), base model, the public persona, `personaSha256`, a hash of the private
     instructions, and for data only **hashes, kinds, categories and sizes** (never content), memory count + hash;
   - **pins it to IPFS** (canonical JSON → content id); stores the version with `manifest_cid` and `manifest_sha256`;
     status `ready`; inbox "version ready".
2. **Test and confirm**: the owner chats in ALTER (at least 3 messages; configurable) and taps "It behaves like me"
   (`POST /ais/:id/confirm`).
3. **Clearance** (`GET /ais/:id/clearance`, `clearance()`): eight checks, all must pass: consent to build from data;
   consent for the external AI provider; consent to appear on ALTERA/ALTAR; a version built; tested in ≥3 messages;
   owner confirmed; **the persona passes the safety check** (moderation); a wallet exists.
4. **Mint preview** (FE-2) (`GET /ais/:id/deploy/preview`): network, contract address, the manifest CID, royalty,
   **gas estimate and price**, and who pays (ALT). Shown in ALTER before the owner confirms.
5. **Deploy** (`POST /ais/:id/deploy` → `requestDeploy`): re-checks clearance, locks the AI row, status `minting`,
   queues a `mint_ait` job, audit `ai.deploy_requested`, `NOTIFY alt_jobs` wakes the worker.
6. **The mint job** (`jobs/worker.ts` `mintAit`):
   - asks the chain if this AI already has a token (`tokenOfAi`);
   - if not and no transaction was sent: the **relayer** sends `mint(ownerWallet, aiId, manifestCid, royaltyBps)`;
     the **tx hash is saved to the job before waiting** (so a crash can never cause a second mint);
   - waits for confirmations, reads the token id from the `AIMinted` event;
   - reads the identity back from the chain;
   - in one transaction: mirror row in `core.ai_identity_tokens`, version marked published, AI `verified` with
     `current_version_id`, audit `ai.minted`, outbox event `ai.verified`, inbox "<AI> is verified, token #N",
     `NOTIFY alt_ai_events` (ALTERA reacts immediately).
   - **Idempotent**: a retried job finds the token already exists and *adopts* it (test: "a retried mint job adopts
     the existing token instead of minting twice"). Failures retry with back-off (5 s × attempt²) up to 5 times;
     a contract refusal is permanent → status back to `ready`, owner told "Nothing was charged".
7. **Publish a newer version** (`POST /ais/:id/versions/:versionId/publish` → `publish_version` job): calls
   `publishVersion(tokenId, newCid)`; version +1 on-chain; ALTERA and ALTAR switch to it.

### Flow 17.2: Public verification (FE-4)
`GET /core/verify/token/:tokenId` (no sign-in needed): reads the token **live from the contract** (owner,
creator, version, suspended, manifest CID, tokenURI) and fetches the manifest from IPFS; the content id is the
SHA-256 of the manifest bytes, so a manifest that doesn't match its CID is refused. ALTAR's AI pages and ALTERA's
"AIT #" sheet show this, with explorer links on a public network.

### Flow 17.3: Ownership follows the token
- After a purchase (or any transfer, even outside ALTAR), `syncToken` reads `ownerOf`/`userOf` from the chain and
  moves `core.personal_ais.owner_id` to the ALT account that owns the new address (roles, audit
  `ai.ownership_changed`, both sides notified, ALTERA told). An indexer reads registry events every 4 seconds.
- **Core never changes an owner directly**; only by reading the chain. If MetaMask (outside ALT) holds it, nobody in
  ALT owns it until it comes back (`ai.held_outside_alt`).

### Flow 17.4: The local chain and the demo
- `npm run dev` starts a Hardhat node on :8545 (chain id 31337), deploys both contracts, grants `MINTER_ROLE` to the
  relayer (account #1); the treasury is account #2; the deployer #0 is admin and governor. Platform fee 2.5%.
- Each `npm run dev` starts an empty chain; **`replayLocalChain`** re-mints recorded tokens in their original order
  and re-publishes versions so verified AIs stay verified (dev only, chain 31337, only if the chain has no tokens).
- `npm run demo` **keeps** its chain: every block is journaled (`.data/demo-chain.jsonl`) and replayed on the next
  start with the same block numbers and transaction hashes (`scripts/chain/journal.mjs`).

### Feature status

| FE | Status |
|---|---|
| FE-1 Request to mint AI identity tokens | ✅ Deploy in ALTER after clearance |
| FE-2 Show transaction details before minting | ✅ mint preview with gas |
| FE-3 Immutable link of model hash, metadata, ownership | ✅ manifest CID (hashes) on-chain, version history, owner on-chain |
| FE-4 Public verification link | ✅ `/core/verify/token/:id`, ALTAR AI page |
| FE-5 Prevent impersonation and duplication | ✅ one token per AI, one manifest per version, moderation blocks AIs claiming to be human |
| FE-6 Verify the original creator | ✅ `creatorOf(tokenId)` is fixed at mint and can never change |

### M17 counter-questions

| Question | Answer |
|---|---|
| Why does the AI need a blockchain at all? A database could store the owner. | A database row can be changed by whoever runs the server, including us. The token is public, append-only and checkable by anyone without trusting ALT: who created it, who owns it, which version is live, and the royalty. And the marketplace contract enforces sales, rentals and royalties without anyone being able to stop or redirect a payment. |
| Is the model stored on-chain? | No. On-chain: the identity, owner, version number and the IPFS id of the manifest. The manifest holds hashes. Data stays encrypted on our server. Storing data on-chain is expensive and public forever. |
| Who pays gas? | ALT's relayer for minting and versions; ALT tops up a person's wallet with just enough gas to list. The buyer pays the price. |
| Why ERC-721 and not ERC-1155? | Each AI is unique (one token, one creator, one history): the definition of a non-fungible token. ERC-1155 is for many copies of the same item. |
| What if the relayer key is stolen? | The thief could mint tokens, but only through our rules (one per AI id). We revoke `MINTER_ROLE` from that address with the admin key and grant it to a new relayer: no redeploy. In production keys go into a KMS. |
| What stops someone minting an AI directly on the contract? | Only `MINTER_ROLE` can mint. |
| Can the creator be changed after a sale? | No. `creator` is set once in `mint`; there is no function that changes it. Royalties keep going to the creator. |
| How is rental enforced off-chain? | Core checks `userOf`/the subscription before letting a renter talk to the AI; when the time ends `userOf` returns zero automatically and access stops. |
| Which network in production? | Polygon (PoS, EVM-compatible, low fees). Testnet: Polygon Amoy. The same contract code; `CHAIN_MODE=amoy` + a funded deployer key; `npm run deploy:amoy -w @alt/contracts`. |
| What does verification prove exactly? | That the token exists on the contract, who created and owns it, which manifest is current, and that the manifest content matches its id. It proves *provenance*, not that the AI's answers are good (that's M7 Health Score, final evaluation). |

---

## Shared foundation you also answer for

### M2 (supporting): one inbox, real time
- `notify(client, …)` writes to `core.notifications` **inside the same transaction** as the event, then
  `pg_notify('alt_notifications', id)`. Other services post with `POST /internal/notifications` (service key).
- Live delivery: `GET /core/notifications/stream` (**Server-Sent Events**: one long HTTP response that pushes events;
  keep-alive every 10 s; closes when you sign out). Phones show a pop-up; the web polls every 30 s (browsers buffer).
- Push to closed apps: Firebase Cloud Messaging is built and tested with a stand-in; switched on once a Firebase
  project is added (`FCM_SERVICE_ACCOUNT`).
- Types: security (new sign-in, lockout, password, 2FA, wallets, stolen token), AI (version ready, verified, deploy
  failed, new version live), transactions (sold, rented, royalties), moderation (blocked content, case replies),
  admin announcements.

### M5 (supporting): the hash-chained audit log (`lib/audit.ts`)
- Every security-relevant action calls `audit(client, …)` in the same transaction: actor (person or service),
  action, entity, IP, data.
- `hash = SHA-256(canonical JSON of {prev hash, time, action, actor, entity, data})`; `prev_hash` = the previous
  entry's hash. An advisory lock makes writers take turns so two entries never share a predecessor.
- A database trigger refuses UPDATE and DELETE on the table.
- `verifyAuditChain` recomputes every hash; if any row was edited (or deleted, or inserted in the middle), the chain
  breaks at that row: `GET /admin/audit/verify` → `{ ok: false, brokenAt: <id> }`.
- Next step (final evaluation): anchor the latest hash on-chain periodically, so even a database administrator
  can't rewrite the whole chain.

### M6 (supporting): versions and IPFS (`lib/ipfs.ts`)
- Development: a **real CIDv1** (raw codec, SHA-256) computed locally; bytes under `.data/uploads/ipfs/`; served at
  `/core/ipfs/<cid>`; reading checks the bytes still match the CID.
- Demo/production: Pinata (`IPFS_MODE=pinata`, `PINATA_JWT`) pins the exact same canonical bytes (`pinFileToIPFS`
  with CID v1), so any IPFS gateway serves them.
- Canonical JSON (sorted keys) means the same manifest always gets the same CID. Versions are immutable (database
  trigger) and each links its parent's CID: a provenance chain.

---

## Code map (open these when asked "show me the code")

| Topic | File |
|---|---|
| Sign-in, register, 2FA, Google, SIWE, handoff | `services/core/src/http/routes/auth.ts` |
| Sessions, rotation, theft detection, revocation NOTIFY | `services/core/src/modules/accounts/sessions.ts` |
| JWT signing/verifying, MFA token | `services/core/src/lib/tokens.ts` |
| AES-GCM, hashing, random codes | `services/core/src/lib/crypto.ts` |
| TOTP (RFC 6238) | `services/core/src/lib/totp.ts` |
| Email codes | `services/core/src/modules/accounts/otp.ts` |
| Account + wallet creation | `services/core/src/modules/accounts/users.ts` (`createUser`) |
| Guards (user, role, staff, service) | `services/core/src/http/auth-guard.ts` |
| Gateway | `services/gateway/src/app.ts` |
| Audit chain | `services/core/src/lib/audit.ts` |
| Cases, merging, actions | `services/core/src/modules/cases/cases.ts`, `src/http/routes/cases.ts` |
| Contracts | `packages/contracts/contracts/AITRegistry.sol`, `ALTMarketplace.sol` |
| Chain client (viem), gas sponsoring | `services/core/src/lib/chain.ts` |
| Build version, clearance, deploy | `services/core/src/modules/ai/lifecycle.ts` |
| Mint job, retries | `services/core/src/jobs/worker.ts` |
| Ownership follows the token, indexer | `services/core/src/modules/market/holders.ts` |
| Dev-chain replay | `services/core/src/jobs/replay-local-chain.ts`, `scripts/chain/journal.mjs` |
| Command Centre pages | `apps/command-centre/src/app/*` |
| Account window (web sign-in) | `services/core/public/account/` |
| Flutter account package (both apps) | `packages/alt_account/lib/src/*` |
