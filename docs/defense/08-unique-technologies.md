# The unusual parts, explained so you can answer anything

Most FYPs are an app plus a database. Ours has a blockchain, smart contracts, NFTs with royalties and rentals,
IPFS, wallets, our own identity provider with RS256 tokens, a hash-chained audit log, an API gateway, PostgreSQL
event channels and four ML models. Evaluators **will** probe these. For each topic: **in plain words** (say this
first), **how it works here** (the technical answer), **why not the alternative**, and the **hard questions**.

---

## 1. Blockchain (and why ours runs locally)

**In plain words:** a blockchain is a shared record book that many computers keep identical copies of. Entries are
grouped into blocks; each block contains the fingerprint (hash) of the previous one, so old entries can't be changed
without everyone noticing. Programs called **smart contracts** live on it and run exactly as written; nobody,
including us, can change their rules or take money they hold.

**How it works here:**
- We use an **Ethereum-compatible** chain (the EVM: Ethereum Virtual Machine). In development and the demo it is a
  **Hardhat** node: a real EVM blockchain running on the laptop (chain id **31337**, port 8545). On the beta server it
  is a private chain of the same kind. In production it will be **Polygon** (Amoy testnet first).
- `npm run dev` starts it and **deploys our two contracts** (`AITRegistry`, `ALTMarketplace`) from
  `packages/contracts`. Hardhat gives 20 test accounts with test currency: #0 deployer (contract admin + governor),
  #1 ALT's **relayer** (allowed to mint), #2 the **treasury** (receives the 2.5% platform fee).
- **Transactions** (mint, list, buy, rent, subscribe, suspend) are signed with private keys and sent through
  JSON-RPC by **viem** (a TypeScript Ethereum library) from ALT Core. Each costs **gas** (computation fee), paid in the
  chain's currency (POL on Polygon; test POL here).
- **Reading** (who owns token 5? is it rented?) is free and instant.
- **Events** (`AIMinted`, `Sold`, `Rented`, `Subscribed`, `Transfer`…) are logs that services read to keep their
  database mirrors up to date (indexers every 4 seconds).
- **The demo keeps its chain:** Hardhat keeps its chain in memory, so we journal every block
  (`.data/demo-chain.jsonl`) and replay them on the next start: same tokens, balances, block numbers and transaction
  hashes (`scripts/chain/journal.mjs`). In `npm run dev`, Core instead re-mints the recorded tokens on a fresh chain
  (`replay-local-chain.ts`).

**Why local and not a public network for the demo?** A public testnet needs a funded key, a faucet, a third-party
RPC provider and internet in the exam room, and each block takes seconds. A local EVM runs **the same contracts and
the same transactions**, instantly, free, offline. Moving to Amoy is configuration (`CHAIN_MODE=amoy` + addresses +
keys) and one deploy command: no code change.

**Why a blockchain at all, and not just a database column "owner"?** A database belongs to whoever runs the server:
we could change any owner, any royalty, any history. The contract is public and enforces its rules itself: the
creator is fixed forever, royalties are paid automatically on every resale, rentals end by themselves, a suspended AI
can't be sold *even by someone bypassing our apps*, and anyone can verify an AI's identity without trusting us. The
marketplace holds and splits money without a middleman.

**Hard questions**
| Question | Answer |
|---|---|
| A one-node local chain is centralised. So it's just a database? | Locally, yes, it's centralised: it demonstrates the *mechanism*. The decentralisation comes from deploying the same contracts to a public network, where thousands of nodes validate. Our code is network-agnostic; the contracts don't know where they run. |
| Is the data on the blockchain? | No personal data ever: only the token's identity (AI id as bytes32, creator, version, manifest CID), ownership, rentals, subscriptions and payment balances. |
| What is gas and who pays it? | The fee for computation on the chain. ALT's relayer pays for minting and versions; ALT tops up a person's wallet with just enough gas (estimate × 1.3) before listing. Buyers pay the price itself. |
| What's a block confirmation? | How many blocks were added after yours; more = harder to reverse. Configurable (`CHAIN_CONFIRMATIONS`); 1 locally. |
| Proof of work / stake? | Hardhat locally needs neither (it mines instantly). Polygon PoS uses proof of stake: validators stake POL and are penalised for misbehaving. |
| Can a smart contract be updated? | Ours are not upgradeable on purpose (rules can't change under people's feet). Fixing a bug = deploying a new version and migrating; this is why they have 36 tests including attacks. |
| What if the chain is down? | Reads and writes that need it fail with `CHAIN_UNAVAILABLE`; jobs retry with back-off; the rest of ALT keeps working (chat, posts). |

---

## 2. The smart contracts and the token standards

**In plain words:** an NFT (non-fungible token) is a unique digital certificate of ownership on a blockchain. Each of
our AIs gets exactly one: its **AI Identity Token (AIT)**.

**The standards we implement (OpenZeppelin 5, Solidity 0.8.28):**

| Standard | What it gives | In our contract |
|---|---|---|
| **ERC-721** | Unique tokens with an owner, transfers, approvals; supported by every NFT wallet and marketplace | One token per AI; `ownerOf(tokenId)` |
| **ERC-2981** | A standard way to ask "who gets a royalty, how much?" for a sale price | The creator, set at mint, max 10% |
| **ERC-4907** | A "user" role with an expiry, separate from the owner: rentals | `userOf` returns the renter until expiry, then zero automatically |
| **AccessControl** (OpenZeppelin) | Roles | `MINTER_ROLE` (ALT's relayer), `GOVERNOR_ROLE` (suspend), `DEFAULT_ADMIN_ROLE` |
| **ReentrancyGuard** | Blocks a contract calling back into a payment function mid-way | `nonReentrant` on buy, rent, subscribe, withdraw |

**Design patterns we use (say the names):**
- **Checks-effects-interactions:** check every condition, update storage (delete the listing, credit balances), *then*
  call other contracts (transfer the token). A malicious buyer contract can't exploit a half-finished state (tested
  with `ReentrantBuyer.sol`).
- **Pull payments:** sales credit balances; people `withdraw()` themselves. A recipient that rejects money can't block
  sales (tested).
- **Exact payment:** `msg.value` must equal the price; no change left in the contract.
- **Custom errors** (`AIAlreadyMinted`, `StaleListing`, `TokenIsRented`…): cheaper than strings and turned into clear
  API errors by Core.
- **Events for every state change**, so the history can be rebuilt from the chain.

**Hard questions**
| Question | Answer |
|---|---|
| Why your own marketplace instead of OpenSea? | We need rentals (ERC-4907), subscriptions, ALT's rules (suspended AIs can't be sold) and usage rights served by our persona engine. OpenSea sells collectibles; it can't serve an AI to its renter. Our token is still a standard ERC-721, so it would show in any NFT wallet. |
| What's a re-entrancy attack? | A malicious contract, when it receives a call or payment, calls back into the function before it finished, e.g. buying twice with one payment. Defences: `nonReentrant`, checks-effects-interactions, pull payments. We have a test contract that tries it. |
| What prevents the same AI being minted twice? | `tokenOfAi[aiId]` must be 0; the AI's database id is its on-chain key. And a manifest can be used only once. |
| What's bytes32 aiId? | The AI's UUID (128 bits) written as a 32-byte number, so the contract can store and compare it cheaply. |
| How are royalties calculated? | `royaltyInfo(tokenId, price)` = price × bps / 10,000 (e.g. 500 bps = 5%). Fee = price × 250 / 10,000 (2.5%). Seller gets price − fee − royalty. No royalty when the creator is the seller. |
| How did you test the contracts? | 36 tests (Hardhat 3, node:test, viem) on a fresh chain per test file, including attacks; line coverage AITRegistry 100%, ALTMarketplace 95.9%. `npm run coverage -w @alt/contracts`. Gas per function: `npx hardhat test --gas-stats`. |

---

## 3. Wallets, keys and signatures

**In plain words:** a wallet is a pair of keys. The **private key** signs transactions (proves "I agree"); the
**address** (derived from the public key) is your account number on the chain. Whoever has the private key controls
the money and tokens.

**How it works here:**
- **Every ALT account gets a custodial wallet at sign-up**: ALT generates the key (viem), encrypts it with
  **AES-256-GCM** (key from the server's configuration), stores it in `core.wallets`. People never install anything.
- ALT signs with it **only after the person confirms** with their password or 2FA code, or a one-time approval from
  the ALT window (2 minutes, bound to that exact action and amount).
- **Non-custodial option:** link MetaMask by **signing a message** (no key leaves MetaMask).
- **Sign-In With Ethereum (EIP-4361):** a standard human-readable message ("<site> wants you to sign in with your
  Ethereum account… Nonce: …"); Core checks the domain, the single-use nonce and recovers the signer's address from
  the signature (ECDSA).
- **Relayer:** ALT's own funded account that sends minting transactions, so people don't need currency to verify
  their AI ("gas sponsorship").

**Why custodial by default?** Our users are mobile-first and non-technical; asking everyone to install MetaMask and
buy currency would stop them. The trade-off (ALT holds keys) is mitigated by encryption, per-spend confirmation and,
in production, a KMS or MPC wallet. People who want self-custody can link MetaMask.

**Hard questions**
| Question | Answer |
|---|---|
| If your database leaks, are wallets stolen? | Keys are encrypted with AES-256-GCM; the encryption key is not in the database. Both would have to leak. Mainnet plan: keys in a KMS/MPC service so even the server never sees them in plain form. |
| What's AES-256-GCM? | Symmetric encryption with a 256-bit key; GCM mode also authenticates, so tampered ciphertext is detected. Each encryption uses a random 12-byte IV. Format stored: `v1.<iv>.<tag>.<ciphertext>`. |
| What's ECDSA? | The signature scheme Ethereum uses (secp256k1 curve). From a message and a signature you can recover the signer's address; nobody can forge a signature without the private key. |
| Can a user export their custodial key? | Not in the app (deliberately). They can send their POL to their own MetaMask address (`/me/wallet/send`). Moving an AI token itself out to a linked wallet is not offered yet (ALT signs listings and purchases with the ALT wallet); if a token is moved outside ALT by other means, ALT notices and nobody in ALT owns it until it returns. |

---

## 4. IPFS and content addressing

**In plain words:** normally a link says *where* a file is (a server). IPFS links say *what* the file is: the link
(a **CID**, content identifier) is computed from the file's bytes with a hash. Change one byte and the CID changes,
so a CID proves the content.

**How it works here (`services/core/src/lib/ipfs.ts`):**
- Each AI version's **manifest** (JSON with persona fields and **hashes** of the data, never the data) is written as
  **canonical JSON** (keys sorted, so the same document always gives the same bytes).
- Its CID = **CIDv1, raw codec, SHA-256** of those bytes. The CID is stored in the database and **on-chain** in the
  token (`manifestCid`, `tokenURI = ipfs://<cid>`).
- Development: computed and stored locally, served at `/core/ipfs/<cid>`; reading **re-checks the bytes against the
  CID** (`IPFS_CONTENT_CORRUPT` if changed). Production: **Pinata** pins the same bytes on the public IPFS network.
- Each manifest links its parent version's CID: a **provenance chain** of versions.

**Hard questions**
| Question | Answer |
|---|---|
| Why not put the manifest on-chain? | Storage on-chain is very expensive; a CID (a few dozen bytes) on-chain + the document on IPFS gives the same guarantee. |
| Is IPFS permanent? | Content stays as long as someone **pins** it; we pin with Pinata. Even if it disappeared, the CID on-chain still proves what the content *was*: any copy can be checked against it. |
| Why not store the training data on IPFS? | IPFS is public; anyone with the CID can read it. Private data stays encrypted on our server; only hashes go public. |
| Is it a "real" CID locally? | Yes, computed exactly as IPFS does (multiformats library); the same bytes on Pinata get the same CID. |

---

## 5. Our own identity provider: JWT, RS256, JWKS and friends

**In plain words:** when you sign in, ALT Core gives your app a signed **ticket** (an access token). Every service
checks the signature with Core's **public key** (like checking a stamp) instead of calling Core every time. The
ticket expires in 15 minutes; a second, longer-lived **refresh token** gets a new ticket and can be cancelled any time.

**The pieces (details in `03-wamiq-alt-core.md`):**
- **JWT** (JSON Web Token): header + claims (user, session, platform, roles, issuer, audience, expiry) + signature.
- **RS256**: RSA signature with SHA-256. Private key only in Core; public key published as a **JWKS** (JSON Web Key
  Set) at `/core/.well-known/jwks.json` with a key id (`kid`).
- **Refresh-token rotation with reuse detection**; sessions in the database; instant revocation broadcast with
  PostgreSQL NOTIFY.
- **bcrypt** (cost 12) for passwords; **HMAC-SHA256** for email codes; **SHA-256** for stored tokens and recovery codes;
  **TOTP** (RFC 6238, our own 70-line implementation) for 2FA with replay protection.
- **Handoff codes** for moving between apps (single-use, 60 seconds, bound to the target app, with a confirmation
  for links the app didn't ask for).

**Hard questions:** see the M1 table in `03`. Also: "What's the difference between authentication and
authorisation?" Authentication = proving who you are (password, 2FA, token). Authorisation = what you're allowed to
do (roles, ownership checks such as "only the owner can see a draft AI", staff-only routes).

---

## 6. The hash-chained audit log (a "mini blockchain" inside our database)

**In plain words:** every important action is written to a log where each line includes the fingerprint of the line
before. If anyone edits or deletes a line, every fingerprint after it stops matching, and our check finds the exact
line.

**How:** `hash = SHA-256(canonical JSON of {previous hash, time, action, actor, entity, data})`; writers take turns via
an advisory lock; a database trigger forbids UPDATE and DELETE; `GET /admin/audit/verify` recomputes the chain.

**"Then why do you need a blockchain if you have this?"** The audit log is tamper-*evident* inside our system, but
whoever controls the server could rebuild the whole chain from scratch. The blockchain is tamper-*resistant* against us
too. Plan: anchor the audit log's latest hash on-chain regularly (M5, final evaluation), combining both.

---

## 7. PostgreSQL as our message broker and job queue

**In plain words:** instead of running extra servers (Redis, RabbitMQ, Kafka), we use features of PostgreSQL itself.

| Technique | What it is | Where we use it |
|---|---|---|
| **LISTEN / NOTIFY** | A service can listen on a named channel; `pg_notify` sends a message, delivered **only when the transaction commits** | `alt_sessions_revoked` (sign-out everywhere), `alt_ai_events` (AI verified/suspended/sold → ALTERA), `alt_notifications` (inbox live stream), `alt_jobs` (wake the job worker) |
| **Transactional outbox** | Write the event into a table in the same transaction as the change, so an event is never lost or sent for a change that rolled back | `core.outbox` (`ai.verified`, `ai.owner_changed`, `user.deleted`…) |
| **`SELECT … FOR UPDATE SKIP LOCKED`** | Several workers take jobs from one table without ever taking the same job | `core.jobs` (mint, publish version, starter funds); retries with back-off |
| **Advisory locks** | A lock on a name, not a row | The audit chain (one writer at a time), case merging, the daily behaviour scan (one Core instance) |
| **Triggers** | Code the database runs on changes | Audit log append-only, versions immutable, `updated_at` timestamps |
| **citext, JSONB, arrays, enums** | Case-insensitive text, JSON documents, lists, fixed value sets | Emails/handles, persona configs/manifests, roles/hashtags, statuses |

**Why not Redis/Kafka?** One less server to run and secure; transactional guarantees (an event exists if and only if
its change committed); fine for our scale. Redis is planned only as a shared cache when Core runs as several instances.

---

## 8. Microservices, the gateway and service keys

**In plain words:** instead of one big program, the system is several small programs (services), each owning one area
and its data, all behind one front door (the gateway).

| Service | Language / framework | Port | Owns |
|---|---|---|---|
| Gateway | TypeScript, Fastify | 8080 | Nothing (stateless): routing, token checks, rate limits |
| ALT Core | TypeScript, Fastify | 4000 | Schema `core` |
| ALTERA API | JavaScript, Express, Socket.IO | 4100 | Schema `altera` |
| ALTAR API | TypeScript, Fastify | 4200 | Schema `altar` |
| ALTAR web | Next.js | 4300 | Nothing (UI) |
| Command Centre | Next.js | 4400 | Nothing (UI) |
| ML service | Python, FastAPI | 4500 | Models (no database) |
| Blockchain node | Hardhat | 8545 | The chain |
| PostgreSQL | embedded | 54320 | All schemas |

- Services call each other's `/internal/*` routes with the **service key** (`x-alt-service-key`) and their name
  (`x-alt-service`); the gateway makes those routes unreachable from outside.
- **One command starts everything:** `npm run dev` (or `npm run demo`) starts PostgreSQL from npm binaries, runs
  migrations, starts the chain and deploys contracts, starts every service, waits for health, writes the Flutter
  config and prints the URLs (`scripts/dev.mjs`).
- **Monorepo** with npm workspaces: services, apps and packages in one repository, sharing tooling.

**Hard questions:** "Isn't this over-engineered for an FYP?" Each piece exists because a requirement needs it: one
account across apps (Core + JWKS), fault isolation and one entry point (M4 FE-1/FE-5), separate teams' areas
(ALTERA, ALTAR), and the ML stack in Python. They all start with one command and are covered by tests.

---

## 9. Real time: Server-Sent Events and Socket.IO

| | Server-Sent Events (SSE) | WebSockets (Socket.IO) |
|---|---|---|
| Direction | Server → client only | Both ways |
| We use it for | The ALT inbox stream (`/core/notifications/stream`), keep-alive every 10 s | ALTERA DMs, read receipts, live feed |
| Why | Notifications only flow one way; plain HTTP, simple through proxies | Chat needs both directions, rooms per user, reconnection |

---

## 10. The Flutter side (both phone apps)

- **One shared package** `packages/alt_account` (26 tests) used by ALTER and ALTERA: the ALT sign-in card, token
  storage (`flutter_secure_storage`, Android Keystore), **single-flight token refresh** (several requests needing a
  refresh share one, so a rotated refresh token is never reused by accident, which would sign the person out),
  handoff deep links, the ALT inbox, Account Center, support cases, policy gate, biometric app lock (`local_auth`).
- **Deep links / app links:** `alter://handoff?code=…`, `altera://handoff?code=…`, `alter://signin-request?for=altera`.
  Android activities are `singleTask` so the link returns to the running app.
- **State management:** Riverpod in both apps; routing with go_router (ALTER).
- **Configuration:** no hard-coded URLs: `--dart-define` (`ALT_API_URL`), written by `npm run dev` to `env/dev.json`.

---

## 11. Quick glossary (for rapid-fire questions)

| Term | One-line meaning |
|---|---|
| EVM | Ethereum Virtual Machine: runs smart contracts; Polygon and Hardhat both run it |
| Hardhat | Development blockchain + compiler + test runner for Solidity |
| viem | TypeScript library to talk to EVM chains (read, sign, send) |
| Solidity | The language of our smart contracts |
| OpenZeppelin | Audited, standard contract building blocks |
| NFT | Non-fungible token: a unique token with one owner |
| Gas / POL | Computation fee / Polygon's currency (formerly MATIC) |
| Relayer | ALT's account that pays gas to mint for users |
| Custodial wallet | A wallet whose key ALT keeps (encrypted) for the user |
| CID | IPFS content id: a hash of the content |
| Pinning | Keeping IPFS content available (Pinata does it for us) |
| JWT / RS256 / JWKS | Signed token / its RSA-SHA256 signature / the published public keys |
| TOTP | Time-based one-time password (authenticator apps) |
| bcrypt | Slow, salted password hashing |
| AES-256-GCM | Authenticated symmetric encryption |
| SIWE (EIP-4361) | Sign in by signing a message with your wallet |
| Outbox pattern | Write events in the same transaction as the change |
| SKIP LOCKED | PostgreSQL way for many workers to share a job table |
| SSE | Server-Sent Events, one-way live updates over HTTP |
| ONNX | A portable format for trained ML models |
| Embedding | A list of numbers representing a text's meaning |
| LoRA / QLoRA | Small trainable adapters on a frozen model / the same on a 4-bit base model |
| nDCG, AUC, F1 | Ranking quality / separation quality / balance of precision and recall |
