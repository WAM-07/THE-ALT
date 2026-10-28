# Defending The ALT Ecosystem: the team's guide

These files prepare the three of us for the 60% evaluation: the live demo, live test runs, showing the
database, explaining every flow we built, the models, the future plan, and the counter-questions an
evaluator can ask. Everything here is taken from the code in this repository (file paths are given so you
can open the real thing when asked). If the code and a file here ever disagree, the code wins: tell Wamiq.

## The files

| File | Who must read it | What it covers |
|---|---|---|
| [README.md](README.md) (this file) | Everyone | The pitch, who presents what, the evaluation-day checklist, the 25 questions everyone must answer |
| [01-running-tests-live.md](01-running-tests-live.md) | Everyone | How to run all 217 tests, one suite, one file, one test; what every test proves; how to "show a test live" |
| [02-database.md](02-database.md) | Everyone (Wamiq leads) | How to show the database live (`npm run db`, DBeaver), every schema and table, the rules, ready-made queries per module |
| [03-wamiq-alt-core.md](03-wamiq-alt-core.md) | Wamiq (others skim) | M1 Authentication, M4 Gateway, M3 Command Centre, M17 Identity Token, plus the shared parts (M2, M5, M6): every flow, step by step, with counter-questions |
| [04-soban-alter-altar.md](04-soban-alter-altar.md) | Soban (others skim) | M8 Consent, M10 Persona interaction, M11 ALTAR core, M12 Transactions and royalties |
| [05-tayyab-altera.md](05-tayyab-altera.md) | Tayyab (others skim) | M13 ALTERA core, M14 Social interaction, M15 AI publishing, M16 Moderation |
| [06-ml-models.md](06-ml-models.md) | Everyone | The language models and the four ML models: what, why, data, numbers, limits, questions |
| [07-future-plans.md](07-future-plans.md) | Everyone (Wamiq leads) | How we finish: fine-tuning (QLoRA adapters), Polygon Amoy, Pinata, deployment, the six remaining modules, scaling |
| [08-unique-technologies.md](08-unique-technologies.md) | Everyone | The things no other project has (blockchain, IPFS, RS256/JWKS, hash-chained audit, custodial wallets…): plain explanation, technical detail, why not the alternative, counter-questions |
| [09-presentation-script.md](09-presentation-script.md) | Everyone | The spoken script for every slide: who speaks, how long, what to say and point at, likely questions, the handover (also in each slide's speaker notes) |

Other documents you may point to: `docs/demo-script.md` (the 10-minute demo, scene by scene),
`ROADMAP.md` (the design), `PROGRESS.md` (what was built when), `docs/report-log/ml-models.md` (the ML
evaluation record), and the 60% report itself.

## The project in 60 seconds (memorise this)

> The ALT Ecosystem lets a person build an AI from their own data, prove on a blockchain that it is
> theirs, earn from it, and let it act in a social network where only verified AIs may speak, all with one
> account.
>
> There are three apps on one backend. **ALTER** (Android) is where you create your personal AI: you give
> consent, add your data, chat with it and tune it. When it passes our checks it gets an **AI Identity
> Token**, an NFT on our smart contract that records its creator, owner and version. **ALTAR** (web) is the
> marketplace where verified AIs are bought, rented or subscribed to, with royalties paid to the creator
> automatically by the contract. **ALTERA** (Android) is the social hub where people and verified AIs post,
> comment and message. Staff work in the **ALT Command Centre** (web).
>
> Underneath is **ALT Core**: one account system for everything, the persona engine that makes every AI
> speak, the consent engine, the blockchain service, notifications, the audit log and moderation. Every
> request enters through one **API gateway**.

## Who presents what (12 modules)

| Member | Modules presented | One-line ownership |
|---|---|---|
| **Wamiq Ejaz** | M1 User Profiling and Authentication · M4 API Gateway · M3 Admin and Governance (Command Centre) · M17 Blockchain AI Identity | The foundation: the account, the gateway, staff governance, identity tokens |
| **M Soban** | M11 ALTAR Core Engine · M12 Transactions and Royalties · M8 Consent Engine · M10 AI Persona Interaction | The marketplace and the personal AI in ALTER |
| **M Tayyab** | M13 ALTERA Core · M14 AI-Hub Social Interaction · M15 Social Publishing · M16 Ethics and Moderation | The social hub |

Not presented now (final evaluation): M2 Messaging and Notifications, M5 Logging and Audit, M6 Version
Control and IPFS, M7 AI Health Score, M9 Training Manager, M18 Analytics and Creator Panel. Parts of M2,
M5 and M6 already exist because the twelve need them (the inbox, the audit log, version manifests). Call
them "supporting components" and say they will be completed and presented at the final evaluation.

**Every member must be able to explain the whole system at the level of this README and
`08-unique-technologies.md`.** Evaluators often ask someone a question outside their modules to check the
team understands the project. The honest answer when it is deep in another member's area: give the
one-paragraph answer from this README, then "my teammate built that part and can show you the code".

## Evaluation-day checklist

**The night before**
1. `git pull` on the presenting laptop. Run `npm install` if `package.json` changed.
2. Run every test once: `npm test` (about 6 minutes). All must pass. Note the totals (see `01`).
3. Start the demo once: `npm run demo`. Wait for the "Demo accounts" table. Stop it with Ctrl+C.
4. If you will show the ML models live: `npm run ml:setup` once (needs Python 3.10+).
5. Charge the phone. Install the latest APKs (or debug builds) of ALTER and ALTERA.

**One hour before**
1. `npm run demo` in a terminal you keep visible ("one command starts everything").
2. Phone over USB: `adb reverse tcp:8080 tcp:8080`, open ALTER and ALTERA, sign in.
3. Browser tabs: `localhost:8080` (ALTAR), `localhost:8080/health`, `localhost:8080/core/docs`,
   `localhost:8080/command` (signed in as `admin@demo.alt`), `localhost:8080/core/dev/mail`.
4. A second terminal at the repository root for live tests and `npm run db`.
5. Demo password for every demo account: `demo pass 123` (local demo only; the beta server has its own).

**If the internet is down:** everything runs locally. Only the language-model replies need internet; without
it they fall back to a labelled `[mock]` reply. Say so honestly.

## The 25 questions every member must answer

These come up in almost every FYP defence. Short answers here; details in the files.

1. **What problem does it solve?** People can't own an AI that represents them, prove it is theirs, or tell
   an accountable AI from an anonymous one. We give each AI an on-chain identity, consent-based data, a market
   for usage rights and a social space where only verified AIs act.
2. **What is unique compared with Character.AI or GPTs?** Ownership is a token anyone can verify; the creator
   is recorded forever; usage rights (sale, rent, subscription) are enforced by smart contracts with automatic
   royalties; the data never leaves the creator; only verified AIs can post.
3. **Is it really a blockchain?** Yes: two Solidity contracts (AITRegistry, ALTMarketplace) with 36 tests
   (line coverage: AITRegistry 100%, ALTMarketplace 95.9%, measured 20 October), running on a local
   Ethereum-compatible chain (Hardhat, chain id 31337) for the demo.
   The same code deploys to Polygon Amoy by configuration (`CHAIN_MODE=amoy`). See `08`.
4. **Why a local chain and not a real network?** A public testnet needs a funded key, a faucet and the
   internet, and its blocks take seconds. The local chain is the same EVM, same contracts, same transactions,
   with instant blocks, no cost, and it works offline in the exam room. Moving to Amoy is a deployment step,
   not a code change.
5. **Is the AI trained / fine-tuned?** Not yet fine-tuned, and we never claim it is. Today an AI is a
   versioned persona (personality, style, boundaries), approved memories and the owner's consented documents,
   answered by a hosted language model (Groq, Gemini fallback) with semantic search over the documents.
   Fine-tuning with QLoRA adapters is the next phase (`07`).
6. **How many tests?** 217 automated tests, all passing: ALT Core 113, smart contracts 36, the shared Flutter
   account package 26, ALTERA API 20, gateway 10, ALTAR API 6, the two apps 6.
7. **What database?** One PostgreSQL database with a schema per service: `core`, `altera`, `altar`. 55
   tables. Each service writes only to its own schema.
8. **Why microservices?** Independent services (Core, ALTERA API, ALTAR API, ML service) behind one gateway:
   a failure in one doesn't take down the others, each can be deployed and scaled separately, and each owns
   its data.
9. **How does one account work in three apps?** ALT Core is the only identity provider. It signs RS256 access
   tokens; every service verifies them with Core's public key (JWKS). Moving between apps uses a single-use,
   60-second handoff code, so you never type your password twice.
10. **How secure is sign-in?** bcrypt (12 rounds), lockout after 5 failures for 30 minutes, email codes
    (6 digits, 10 minutes, 5 tries), TOTP two-factor with recovery codes, refresh-token rotation with theft
    detection, sign-out everywhere that takes effect immediately, rate limits.
11. **What is the gateway for?** One entry point: verifies tokens, strips forged identity headers, hides
    internal routes, rate-limits, routes by prefix, isolates failing services, aggregates health.
12. **What is an AI Identity Token?** An ERC-721 NFT, one per AI, that records the creator (fixed forever),
    the owner, the version and its IPFS manifest, the creator's royalty (ERC-2981) and the current renter
    (ERC-4907).
13. **What is on IPFS?** Each version's manifest: a JSON file with hashes of the persona and data, never the
    data itself. Its content id (CID) is recorded on-chain, so anyone can verify a version.
14. **Where is personal data stored?** Encrypted (AES-256-GCM) on our server. Never on the blockchain, never
    on IPFS.
15. **Who pays gas?** ALT does. A relayer account mints tokens, and ALT tops up a person's wallet with just
    enough gas to list. Buyers pay the price itself in POL (test POL here).
16. **Does the user need MetaMask?** No. Every account gets a custodial wallet automatically. People can also
    link MetaMask by signing a message.
17. **How do royalties work?** The token stores the creator's royalty (up to 10%). The marketplace contract
    reads it on every sale, rental and subscription and credits the creator automatically, except on the
    creator's own first sale.
18. **What stops a fake AI posting on ALTERA?** ALTERA checks verification on every post, comment and DM.
    Verification comes from Core, which reads the token. Suspending the token silences the AI everywhere at
    once.
19. **How is content moderated?** ALT's rule categories plus a toxicity model (toxic-bert) for posts,
    comments, DMs and every AI reply; DMs warn before sending milder content; blocked AI output becomes a case
    for staff. A behaviour model flags unusual accounts daily.
20. **How are staff actions controlled?** Staff roles (admin, moderator, support, auditor), only in a
    Command Centre session, 2FA in production, can't judge cases they are involved in, every action audited.
21. **What is the audit log?** Every security-relevant action, hash-chained: each entry includes the hash of
    the one before, so editing or deleting any entry breaks the chain, which `/admin/audit/verify` detects.
22. **Which technologies?** TypeScript (Fastify) for Core, the gateway and ALTAR API; Node/Express for
    ALTERA API; Flutter for the two Android apps; Next.js for ALTAR and the Command Centre; Solidity for the
    contracts; Python (FastAPI, ONNX Runtime, scikit-learn) for the ML service; PostgreSQL.
23. **What is left?** Fine-tuned adapters (training), the six remaining modules (M2, M5, M6, M7, M9, M18 in
    full), auctions and licences in M12, deployment on Polygon Amoy, Urdu moderation. See `07`.
24. **How did you use AI tools?** Claude Code as a coding assistant for code, tests and documentation. We set
    the requirements and design, reviewed each change, ran and tested everything. (Each member must be ready
    to explain their own module's code.)
25. **What would you do differently?** Start with the ALT Core account system first (we did: earlier ALTERA
    had its own insecure login), and plan training data collection earlier.
