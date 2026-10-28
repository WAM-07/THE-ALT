# Running the tests live

Evaluators ask for "test cases" in two ways, and we can answer both:

1. **"Run your tests."** We have **217 automated tests**. Each one is a real test case with an input and an
   expected output, written in code and checked by a machine. You can run all of them, one suite, one file or
   one single test, in front of the evaluator, in seconds to minutes. Part A.
2. **"Show me a test case live."** Take a rule (for example "5 wrong passwords lock the account") and show it
   happening on the running system, with the expected and actual result. Part B has 20 ready-made live test
   cases in the classic format (ID, steps, expected, actual).

Part C explains how to answer "how do you know your tests test the right thing?".

---

## Part A: the automated tests

### A1. What exists (217 tests, all passing on 20 October 2026)

| Suite | Where | Tests | Framework | Time to run | What it checks |
|---|---|---|---|---|---|
| ALT Core | `services/core/test/` (19 files) | 113 | Vitest | ~3 min | Accounts, sessions, 2FA, wallets, AIs, consent, persona engine, blockchain, IPFS, market, cases, policies, notifications, ML integration |
| Smart contracts | `packages/contracts/test/` (2 files) | 36 | Hardhat 3 + `node:test` | ~15 s | AITRegistry and ALTMarketplace: every rule and the attacks |
| ALT account package (Flutter) | `packages/alt_account/test/` (8 files) | 26 | `flutter_test` | ~30 s | Sign-in client, token refresh, handoff, inbox, policies, support, logos |
| ALTERA API | `services/altera-api/test/altera.test.mjs` | 20 | Vitest | ~1.5 min | One account on ALTERA, posts, DMs over Socket.IO, verified-only AIs, hate speech, instant sign-out |
| Gateway | `services/gateway/test/gateway.test.ts` | 10 | Vitest | ~10 s | Routing, token checks, forged headers, hidden internal routes, fault isolation |
| ALTAR API | `services/altar-api/test/listings.test.ts` | 6 | Vitest | ~40 s | Listings mirror, sales/resale/rental history from chain events, reviews, royalties |
| ALTER app | `apps/alter/test/` | 5 | `flutter_test` | ~20 s | Sign-in screen, offline retry, tag editor, pictures |
| ALTERA app | `apps/altera/test/` | 1 | `flutter_test` | ~15 s | Starts signed out and reaches onboarding |

**Important to say:** the backend tests are not "mocked". Before they run, each suite starts a **real
PostgreSQL** (embedded, port 54399), applies **every migration**, starts a **real local blockchain** (Hardhat,
port 8546) and **deploys the real contracts**. Then the tests call the real HTTP API. So a test like "mints an
identity token" really sends a transaction and reads it back from the chain. This is in
`services/core/test/global-setup.ts`.

Because the tests use their own ports (54399 and 8546), **you can run them while the demo is running**
(the demo uses 54320 and 8545). Nothing in the tests touches the demo's data.

Only two things are stand-ins in tests, on purpose, and you should say so if asked:
- the **language model** (a "spy" provider that records the prompt and returns a fixed reply), because a real
  LLM answers differently every time and needs the internet;
- the **ML models** in some tests (a stand-in that marks words like `zztoxic`), because the tests check our
  *rules around* the model (block, warn, fall back), not the model's accuracy. The model's accuracy is
  measured separately on public datasets (see `06-ml-models.md`).

### A2. The commands

Run these from the repository root (`C:\THE ALT`) in Git Bash or PowerShell.

| What | Command |
|---|---|
| **Everything backend** (Core, ALTERA, ALTAR, gateway, contracts) | `npm test` |
| One backend suite | `npm test -w @alt/core` · `npm test -w @alt/gateway` · `npm test -w @alt/altera-api` · `npm test -w @alt/altar-api` · `npm test -w @alt/contracts` |
| One file (Core example) | `cd services/core` then `npx vitest run test/auth.test.ts` |
| **One single test, by name** | `cd services/core` then `npx vitest run -t "locks the account for 30 minutes"` |
| **The report's Unit Test 01, 02 or 03** (added 28 Oct) | `cd services/core` then `npx vitest run -t "Unit Test 03" --reporter=verbose` · one case: `-t "Unit Test 03.1"` (the round trip) |
| **The report's Unit Test 04** (marketplace split) | `cd packages/contracts` then `npx hardhat test nodejs --grep "Unit Test 04"` |
| Show every test name as it passes | add `--reporter=verbose`, e.g. `npx vitest run test/auth.test.ts --reporter=verbose` |
| Contracts, one file | `cd packages/contracts` then `npx hardhat test nodejs test/AITRegistry.test.ts` |
| Contracts, one test by name | `npx hardhat test nodejs --grep "royalty"` |
| Contract coverage report | `npm run coverage -w @alt/contracts` (prints a table; HTML in `packages/contracts/coverage/html`) |
| Contract gas usage per function | `cd packages/contracts` then `npx hardhat test --gas-stats` |
| Flutter account package | `cd packages/alt_account` then `C:\flutter\bin\flutter test` |
| ALTER app / ALTERA app | `cd apps/alter` (or `apps/altera`) then `C:\flutter\bin\flutter test` |
| One Flutter test by name | `C:\flutter\bin\flutter test --plain-name "concurrent callers share a single refresh"` |
| Type checks (no tests, proves the code compiles) | `cd services/core` then `npx tsc --noEmit` |

Workspace names: check `package.json` of each service if a `-w` name is refused; the folder form always
works: `cd services/core && npm test`.

**Best live sequence (2 minutes):**
1. `cd packages/contracts` → `npx hardhat test nodejs test/AITRegistry.test.ts` (5 seconds, 11 green ticks
   with readable names: perfect for the screen).
2. `cd ../../services/gateway` → `npx vitest run --reporter=verbose` (10 tests, seconds).
3. `cd ../core` → `npx vitest run test/auth.test.ts --reporter=verbose` (30 tests, ~40 s including the database
   and chain start).
4. Offer any single test they point at: `npx vitest run -t "<words from its name>"`.

### A3. Every test, what it proves, and its module

To run any row: `cd` into the suite's folder and use `npx vitest run -t "<a few words of the name>"`
(contracts: `npx hardhat test nodejs --grep "<words>"`; Flutter: `flutter test --plain-name "<words>"`).

#### ALT Core: authentication (M1), `services/core/test/auth.test.ts`, 30 tests

| Test | What it proves |
|---|---|
| creates one account with a custodial wallet and signs in after the email code | Sign-up makes one `core.users` row and a wallet with an encrypted key; sign-in only after the 6-digit email code (M1 FE-1, FE-5) |
| rejects duplicate emails and handles | Unique email and handle across the whole ecosystem |
| refuses weak passwords | Password rules enforced by the API schema |
| blocks sign-in until the email is verified | `EMAIL_NOT_VERIFIED`, a new code is sent |
| kills a code after 5 wrong attempts | OTP brute force is impossible (5 tries, then the code dies) |
| signs in by email or handle and records the platform | Either identifier works; the session remembers ALTER/ALTERA/ALTAR |
| gives the same error for unknown accounts and wrong passwords | No account enumeration (same message, and a dummy bcrypt compare for equal timing) |
| locks the account for 30 minutes after 5 failures, even for the right password | Lockout (M1 FE-4) |
| rotates refresh tokens and revokes the session when an old one is replayed | Refresh-token rotation + theft detection |
| logout ends the session immediately; logout-all ends every app | Real sign-out, not just deleting a token on the phone |
| lists devices and revokes one | Device management |
| issues RS256 tokens that verify against the published JWKS | Any service can verify our tokens with the public key |
| signs the same user into the target app once, with no password | The handoff code between apps is single-use |
| gives the ALT Command Centre a cookie of its own… | Staff and ALTAR sessions in one browser never overwrite each other |
| requires a TOTP code at sign-in, rejects replays and accepts a recovery code once | 2FA (M1 FE-4), replay protection, single-use recovery codes |
| reset by email code signs out every device | Password reset ends all sessions |
| forgot-password answers the same for unknown emails | No account enumeration |
| change needs the current password and keeps only this session | Password change signs out other devices |
| creates an account on first use and signs in to the same one later | Google sign-in (M1 FE-3) |
| claims an unverified account with the same email and drops its unproven password | Stops someone pre-registering your email to hijack it later |
| refuses Google accounts whose email is not verified | Only verified Google emails |
| signs up with a wallet, then signs in to the same account with it | Sign-In With Ethereum (EIP-4361) (M1 FE-3, FE-5) |
| rejects a signature from a different wallet | Signature verification |
| links a wallet to an existing account, makes it primary, and refuses it for anyone else | One wallet belongs to one account |
| updates the profile everywhere and exposes a public view | One profile for all apps (M1 FE-2) |
| accepts avatars hosted by ALT services but not arbitrary URLs | No tracking pixels or hostile images |
| lets services look users up only with the service key | Internal routes need the service key |
| keeps an intact, verifiable audit chain that only admins can read | Hash-chained audit log (M5), admin-only |
| accepts body-less POSTs that still say content-type: application/json | Robustness |
| rejects malformed JSON with a clear error | `INVALID_JSON`, never a server error |

#### ALT Core: personal AIs (M8, M10, M6, M17), `ai.test.ts`, 18 tests

| Test | What it proves |
|---|---|
| stores the persona and the consents, and makes the person a creator | ALTER onboarding saves to the server; role `creator` added |
| keeps AI handles unique across people and AIs | `@handle` is unique across both |
| is private to its owner | Another account can't read a draft AI |
| refuses data without consent, and records every consent change | Consent engine (M8 FE-2): append-only consent history |
| lets the owner inspect, exclude, re-include and delete each item | M8 FE-3, FE-4 |
| accepts file uploads and only reads text files for now | Images/voice stored, not fed to the AI |
| builds one prompt from persona, approved memories and relevant documents | The persona engine's prompt (M10) |
| suggests memories from "remember that..." and uses them only after approval | Memories need approval (M8 FE-5, M10 FE-6) |
| does not send anything to an external AI provider without consent | `third_party_processing` consent enforced |
| builds a version, passes clearance, mints its identity token and publishes a newer version | The whole lifecycle on the real chain (M6, M9, M17) |
| a retried mint job adopts the existing token instead of minting twice | Idempotent minting |
| blocks deployment of a persona that fails the safety check | Clearance gate includes moderation |
| only verified AIs speak on other platforms, and only for ALT services | `/internal/ais/:id/respond` guarded |
| moderates text and drafts posts only for ALT services | `/internal/moderate`, `/internal/assist` guarded |
| stores and returns emoji, Urdu and typographic characters intact | UTF-8 everywhere |
| uses all of your notes when they are short, even without matching words | Retrieval fallback |
| uploads a picture that ALT serves itself | AI avatars |
| refuses other file types, other people's AIs and pictures hosted elsewhere | Upload rules |

#### ALT Core: blockchain and IPFS (M17, M6), `chain.test.ts`, 5 tests

| Test | What it proves |
|---|---|
| gives the same document the same content id, whatever the key order | Canonical JSON → deterministic IPFS CID |
| serves pinned content over HTTP and rejects nonsense CIDs | `/ipfs/:cid` |
| reports the network and contracts | `/chain` |
| previews, mints and reads back an AI identity token, then verifies it against IPFS | Mint preview (M17 FE-2), mint, independent verification (M17 FE-4, M6 FE-3) |
| turns contract reverts into clear API errors | e.g. `CHAIN_AI_ALREADY_MINTED` |

#### ALT Core: marketplace and wallet (M11, M12), `market.test.ts` (6) and `wallet.test.ts` (5)

| Test | What it proves |
|---|---|
| flags a verified AI whose reply moderation blocked, one case per AI | Live AI misbehaviour reaches staff (M16 FE-3) |
| moves ownership with the token, pays the creator a royalty on resale, and lets a renter talk until the rental ends | The roadmap's acceptance story: A sells to B, B resells to C (royalty to A), D rents and loses access at expiry |
| lets many people subscribe by the month, renew, talk until it ends… | Subscriptions |
| takes a one-time approval from the ALT window instead of a password, for exactly that spend | Spend approvals bound to one action |
| follows the token when it moves outside ALTAR | Indexer: ownership follows the chain |
| refuses a purchase the buyer can't pay for | Insufficient funds |
| shows the balance, hands out test POL on the local chain, and lists owned tokens | Wallet page |
| sends POL out only after the person confirms with their password | Spending needs the person |
| lists for sale and rent from an empty wallet (ALT pays the network fee), then pays out after a sale | Gas sponsorship, pull-payment withdrawal |
| gives every new account its starter test POL once… | Beta feature |
| gives nothing when it is not configured | Off by default |

#### ALT Core: Command Centre (M3), `cases.test.ts` (4), `case-actions.test.ts` (4), `policies.test.ts` (1)

| Test | What it proves |
|---|---|
| merges reports about the same thing into one case, from people and from services | One queue item per post, however many reports |
| lets staff see only their queues, only from a Command Centre session | Role-based access + platform `admin` session |
| tells every reporter the outcome, and keeps staff off cases that involve them | Conflict of interest |
| can require 2FA for staff | `STAFF_REQUIRE_2FA` |
| suspends an AI on-chain and everywhere, warns and locks its owner, then undoes it | Real `suspend` transaction (M3 FE-8, M17) |
| asks ALTERA or ALTAR to remove a reported post or review, and tells its author | Core asks the owning service (each service owns its data) |
| lets the person affected appeal a decision, judged by someone other than its maker | Appeals (M3 FE-4) |
| ties a dispute to one of the person's own ALTAR payments, checked by ALTAR | Disputes (M3 FE-4) |
| publishes Terms, Privacy and the AI content policy, records who agreed… | Policies (M3 FE-5) |

#### ALT Core: other files

| File (tests) | Tests and what they prove |
|---|---|
| `notifications.test.ts` (8) | One inbox (M2): new-sign-in alerts (not for handoffs), mark read, security alerts, privacy between users, services post to the inbox, admin broadcast, "version ready", **real-time stream delivers a notification the moment it is created** (M2 FE-4) |
| `moderation.test.ts` (5) | Rules: AI claiming to be human (curly apostrophes too), ordinary sentences pass, other categories; toxicity model: blocks toxic/severe, warns on mild; falls back to rules when the ML service is down |
| `knowledge.test.ts` (3) | PDFs are read, images never reach the AI; BM25 ranks the right passage; short notes sent whole |
| `semantic.test.ts` (2) | Search by meaning with no shared word; each passage embedded once; only vectors stored; AI search returns good matches only |
| `style.test.ts` (3) | The TypeScript style features match the Python training code exactly; same-style text scores higher; "sounds like you" appears after 5 samples |
| `behaviour.test.ts` (3) | Unusual-activity scan counts from the audit log, files one flag case, staff-only view; says "not enough history" or "unavailable" instead of guessing; at most once a day |
| `avatars.test.ts` (7) | Ready-made pictures, people and AI sets never mixed, per-platform pictures |
| `account-page.test.ts` (2) | The ALT Account window can't be framed or load foreign scripts; its handoff code works |
| `llm.test.ts` (3) | LLM client: reasoning models get room to think; waits once on a short rate limit; reads Retry-After |
| `push.test.ts` (2) | Phone push via Firebase (with a stand-in Google); off until configured |
| `replay.test.ts` (2) | A restarted local chain gets its tokens re-minted in order; a chain with tokens is left alone |

#### Smart contracts, `packages/contracts/test/`, 36 tests

**AITRegistry (11):** one token per AI minted to its creator with version 1 · emits `AIMinted` and the first
`VersionPublished` · only ALT's minter can mint, nobody can choose someone else as creator · refuses a second
token for the same AI, a reused manifest, a zero id, an empty manifest, royalties above 10% · pays the creator's
royalty (ERC-2981) and the creator stays the creator after a sale · supports ERC-721, ERC-2981 and ERC-4907 ·
only the owner or ALT's relayer publishes versions · a suspended AI cannot move, be rented or be updated ·
the renter can use it until expiry, then access ends by itself · an active rental can't be replaced and the
AI can't be transferred from under the renter · only the owner or an approved operator can set the user.

**ALTMarketplace (25):** only the owner can list, approval needed, price positive · a creator's first sale
pays no royalty · a resale pays the creator automatically · exact price only (no under- or overpayment left in
the contract) · stale listings (seller no longer owns it) can be cleared by anyone · only the seller cancels a
live listing · can't buy your own, a suspended or a rented AI · renter uses it until expiry, ownership never
moves · rent split between owner, creator and treasury · refuses overlapping rentals, wrong durations, wrong
payment · rental terms cleared on sale · pull payments (`withdraw`) · a recipient that rejects payments can't
block a sale · **blocks re-entrancy from a malicious buyer contract** · only the admin changes the fee, never
above 10% · constructor guards · rental offer validation · stale/self/suspended rentals refused · treasury
can't be zero · per-token approval works too · many subscribers at once · renewing adds time · royalty on
subscriptions · subscription validation · a sale clears the price but subscribers keep their time.

#### ALTERA API, `services/altera-api/test/altera.test.mjs`, 20 tests

| Test | What it proves |
|---|---|
| accepts a token from an account created in another ALT app and builds the ALTERA profile | One account (M1 + M13) |
| rejects missing, forged and expired tokens | ALTERA verifies tokens itself (defence in depth) |
| tells old clients where sign-in went | Old `/auth/*` answer `410 MOVED_TO_ALT_CORE` |
| keeps name and avatar in the ALT account and bio on ALTERA | Data in the right schema |
| posts, comments, likes and follows between two ALT accounts | Social features (M13, M14) |
| counts a report once per reporter… | Reports can't drain a health score |
| answers a malformed id with 400, never a server error | Robustness |
| removes a post or comment when ALT staff decide it, and only for ALT services | Staff removal through the internal route |
| no longer creates AIs on ALTERA, and unlinked personas from before cannot post | AIs are born only in ALTER |
| every read endpoint answers without a 5xx… | No server errors on any screen |
| delivers a DM between two ALT accounts and lists the conversation | Real-time DMs over Socket.IO (M14 FE-5) |
| blocks toxic posts and comments, and in DMs blocks severe, asks first for milder, never blocks self-harm | Hate-speech policy (M16) |
| refuses a still-unexpired access token once its session is signed out everywhere | Sign-out reaches ALTERA at once |
| drops a cached session the moment ALT Core announces it ended | Postgres NOTIFY |
| keeps the current session after a password change that signs out the others | Correct scope |
| brings a verified AI to ALTERA, where it writes in its own voice and auto-replies | Persona engine on ALTERA (M14, M15) |
| drafts a person's own post with an AI they may use, tagged "posted with"… | Renter/subscriber drafting |
| refuses unverified AIs, other people's AIs and unsafe drafts | Verified-only gate (M14 FE-2) |
| loses its ALTERA access the moment ALT Core suspends it | Suspension everywhere |
| tells the owner in their ALT inbox when ALTERA blocks something their AI wrote | Owner alerted (M2, M16) |

#### Gateway (M4), `services/gateway/test/gateway.test.ts`, 10 tests

strips the prefix and passes the verified caller to the service · serves ALTAR web for every path the services
don't own · serves the Command Centre under `/command` · **drops identity headers a client tries to forge** ·
**refuses tokens not signed by Core** · **never exposes internal service routes** · **isolates a dead service:
its routes fail cleanly while others keep working** · reports per-service health · allows every method the
apps use in CORS preflight · survives a service dying in the middle of a live stream.

#### ALTAR API (M11, M12), `services/altar-api/test/listings.test.ts`, 6 tests

mirrors the on-chain offer and keeps the seller's description and subscription price · refuses drafts and
signed-out sessions · saves, lists and unsaves verified AIs only · records sales, resales (with the creator
royalty) and rentals from the contract events · records subscriptions, lets real customers review, shows the
creator their royalties · calls Core's moderation as the "altar" service with the service key.

#### Flutter (32 tests)

`alt_account` (26): logo drawing and animation (4) · client: sign-in keeps the refresh token in secure storage,
2FA and unverified-email outcomes, error codes, **concurrent callers share a single refresh**, refresh once on
401, rejected refresh signs out but offline doesn't, sign-out clears local state, recognises handoff links (8) ·
handoff: unsolicited links ask "sign in as …?", answers to our own request go straight in, no confirm = refused
(3) · inbox list and live stream (2) · remembered accounts (never a secret), sign-in requests between apps,
per-app pictures (3) · media links point at the device's address (2) · policy gate (1) · support cases,
appeals name the decision, disputes name the payment, the screen (3).
ALTER (5): tag editor · initial when no picture · offline retry instead of onboarding · file links · asks to
sign in without a session. ALTERA (1): starts signed out and reaches onboarding.

---

## Part B: live test cases on the running demo

Start `npm run demo` first. Use **Git Bash** for these commands (PowerShell: write `curl.exe` instead of `curl`).
Format: what we test → steps → expected → what you show. Every "expected" below is what the code does
(checked in the tests named in brackets).

> Never lock a demo account. For the lockout test, create a throwaway account first (TC-03).

| ID | Module | Test case | Steps | Expected result |
|---|---|---|---|---|
| TC-01 | M4 | All services healthy | `curl localhost:8080/health` | `"status":"ok"` and each service `ok:true` with its latency |
| TC-02 | M4 | Internal routes are hidden from the internet | `curl -i localhost:8080/core/internal/moderate` | `404 NOT_FOUND`, even though the route exists inside |
| TC-03 | M1 | Sign-up needs an email code | ALTAR → Continue with ALT → Create account (e.g. `test1@x.dev`) → open `localhost:8080/core/dev/mail` | A 6-digit code arrives; the account works only after entering it |
| TC-04 | M1 | Lockout after 5 wrong passwords | With TC-03's account: sign in with a wrong password 5 times | 5th attempt: "Too many failed attempts", then even the right password is refused for 30 minutes; the account gets an inbox alert. Audit log shows `auth.login.failed` ×4 and `auth.lockout` |
| TC-05 | M1/M4 | A forged token is refused at the gateway | `curl -i -H "Authorization: Bearer abc.def.ghi" localhost:8080/core/me` | `401 INVALID_TOKEN` from the gateway, no service does any work |
| TC-06 | M4 | A forged identity header is ignored | `curl -i -H "x-alt-user-id: <any uuid>" localhost:8080/core/me` | `401`: the gateway deletes `x-alt-*` headers sent by clients |
| TC-07 | M1 | One account, three apps, no second password | ALTER (Wamiq) → Home → Open ALTERA | ALTERA opens signed in as Wamiq; Account Center → devices lists both apps |
| TC-08 | M1 | Sign out everywhere really works | ALTER → Account Center → Sign out everywhere | ALTERA and ALTAR are signed out within seconds (not after 15 minutes); audit `auth.logout_all` |
| TC-09 | M1 | Rate limit | `for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:8080/core/auth/login -H "content-type: application/json" -d '{"identifier":"nobody","password":"x","platform":"altar"}'; done` | First 10 answer `401`, then `429 RATE_LIMITED` (10 per minute per IP) |
| TC-10 | M17 | Verify an AI independently | `curl localhost:8080/core/verify/token/1` | Read live from the contract: `owner`, `creator`, `version`, `suspended`, `manifestCid`; then the manifest fetched from IPFS (`manifestReadable: true`, its `manifestSha256` and content). The CID is itself the SHA-256 of the manifest, and reading it back refuses bytes that don't match (`IPFS_CONTENT_CORRUPT`) |
| TC-11 | M6 | The manifest holds no personal data | Open the `ipfs` link from TC-10 (or `localhost:8080/core/ipfs/<cid>`) | JSON with persona fields and **sha256 hashes** of data, no document text |
| TC-12 | M17 | Mint preview before minting | ALTER (a fresh AI that passed clearance) → Identity → Deploy preview | Network, contract address, gas estimate, who pays, manifest CID shown before minting (M17 FE-2) |
| TC-13 | M8 | No consent, no data | ALTER → Privacy & consent → turn off "build the AI from your data" → try to add data | Refused: `CONSENT_REQUIRED`; the switch is recorded in `core.consent_events` (show with `npm run db -- rows core.consent_events 5`) |
| TC-14 | M14 | Unverified AI can't act | ALTERA as `sara@demo.alt` → Bring your AI | Her draft AI shows "Not deployed yet" and can't join |
| TC-15 | M16 | Impersonation is blocked | ALTERA as Wamiq, Post as his AI: "I'm not an AI, I'm a real human" | `422 CONTENT_BLOCKED` (impersonation); owner gets an inbox alert; a flag case appears in the Command Centre |
| TC-16 | M16 | Hate speech in DMs | ALTERA DM (with the ML service running) a clearly insulting message | "Before you send: this message may be hurtful" dialog; a threat or identity hate is refused outright |
| TC-17 | M12 | Buying moves the token and pays royalties | ALTAR as Hamza → Code Sensei → Buy → confirm in the ALT window | Token moves to Hamza (see `/core/verify/token/<id>`); Bilal's wallet shows earnings; the AI appears in Hamza's ALTER |
| TC-18 | M3 | Staff suspend an AI on-chain | Command Centre (admin) → the Muse case → Take action → Suspend | A real `suspend` transaction; Muse can't post or chat anywhere; audit entry; lift it afterwards |
| TC-19 | M5 | The audit chain is intact | Command Centre → Audit log (or `curl` `/core/admin/audit/verify` with an admin token) | "Chain intact · N entries" |
| TC-20 | M2 | Real-time inbox | Sign in to ALTERA from a browser while ALTER is open on the phone | "New sign-in" appears in ALTER's bell within about a second |

How to get an admin token for TC-19 by curl (optional; the Command Centre page is easier):
`curl -s -X POST localhost:8080/core/auth/login -H "content-type: application/json" -d '{"identifier":"admin@demo.alt","password":"demo pass 123","platform":"admin","client":"app"}'`
then use the `accessToken` value: `curl -H "Authorization: Bearer <token>" localhost:8080/core/admin/audit/verify`.

You can also run any of the API calls from the **Swagger page**: `localhost:8080/core/docs` lists all 137
ALT Core routes with their inputs and outputs, and "Try it out" sends a real request.

---

## Part C: answering questions about testing

**"Which testing techniques did you use?"**
- *Unit tests:* pure functions (TOTP, BM25 retrieval, style features, canonical JSON/CIDs, LLM retry parsing).
- *Integration tests:* most of our backend tests: real HTTP requests against the real service with a real
  database and real blockchain (e.g. the lifecycle test mints a real token).
- *End-to-end acceptance tests:* `market.test.ts` replays the roadmap's acceptance story across Core, the
  chain and the contracts; the demo seed (`scripts/seed-demo.mjs`) builds the whole demo through the public APIs.
- *Security tests:* forged tokens, forged headers, replayed refresh tokens, replayed TOTP codes, OTP brute
  force, account enumeration, re-entrancy attack contract (`contracts/test/ReentrantBuyer.sol`), payment-rejecting
  recipients, hidden internal routes.
- *Contract coverage:* `npm run coverage -w @alt/contracts`: AITRegistry 100% of lines, ALTMarketplace 95.9%
  (four guard lines in the subscription functions are not covered yet).
- *Widget tests* (Flutter): screens render and behave, with mocked secure storage.
- *Model evaluation* (different from tests): accuracy on public datasets (`06-ml-models.md`).
- *Manual testing* on a real Android phone (Redmi Note 11) and browsers, recorded in `PROGRESS.md`.

**"Black box or white box?"** Both. The API tests are black box (they only use the public HTTP API and check
responses). The unit tests and contract tests are white box (they know the internal rules and test each branch,
which is how coverage is measured).

**"How do you know a test would catch a bug?"** Show it (only if you are confident, and revert afterwards):
1. In `services/core/src/http/routes/auth.ts`, change `const MAX_FAILED_LOGINS = 5;` to `50`.
2. Run `cd services/core && npx vitest run -t "locks the account"` → it **fails** (red).
3. Undo: `git checkout -- services/core/src/http/routes/auth.ts` and run again → green.
This is "mutation testing" done by hand: a deliberately broken rule is caught by its test.

**"Why not 100% coverage?"** The rules that protect money and identity are tested, including the attacks.
Coverage is measured for the contracts (where a bug costs money); for the backend we test behaviour per
feature. Untested parts are mainly UI layout and error paths that can't happen without a broken database.

**"What happens in CI?"** Not set up on GitHub yet; tests run locally with one command (`npm test`) before every
commit. Adding GitHub Actions is listed in the future plan.

**"What was your hardest bug found by testing?"** Good examples (all in `PROGRESS.md`):
- the embedded database was created in WIN1252, so emoji and Urdu crashed inserts; fixed and a regression
  test added (`stores and returns emoji, Urdu…`);
- the impersonation rule missed curly apostrophes ("I'm" typed on a phone); found by the demo seed, fixed with
  tests;
- the gateway crashed when Core restarted during a live stream; fixed and tested (`survives a service dying…`);
- building a version once let raw image bytes reach the AI's prompt; fixed so only real text is read.
