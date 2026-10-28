# The future plan: how we complete The ALT Ecosystem

Evaluators will ask "what's left?" and then "how exactly will you do it?". A good answer has three parts: **what**,
**how** (concrete technology and steps), and **why it fits what is already built**. Everything below plugs into
existing "sockets" in the code, so nothing built so far is thrown away.

---

## 1. The heart of the project: training a personal AI (M9 Training Manager, M10 FE-5)

### The idea (from the original vision)
A professor with thousands of students can't answer them all. They train an AI **in their own teaching style** on
our platform, check it sounds like them, then let it answer students, and can earn from it (students rent or
subscribe). The AI's **subject knowledge** comes from a capable base model; what we train is the **style**: how
this person explains, phrases and responds.

### The method: QLoRA adapters
- **Base model:** an open model of 3–4 billion parameters (for example Llama 3.2 3B or Qwen 2.5 3B), good enough to
  know the subject, small enough to train cheaply.
- **LoRA** (Low-Rank Adaptation, Hu et al. 2021): instead of changing the base model's billions of weights, train
  small extra matrices (an **adapter**, typically 10–100 MB) inserted into the model's attention and MLP layers. The
  base stays frozen and shared; each AI is just its adapter.
- **QLoRA** (Dettmers et al. 2023): the frozen base is loaded in **4-bit** precision (NF4), so training fits on one
  consumer GPU (the owner's RTX 3070 with 8 GB, or one cloud GPU).
- **Tools:** Python, Hugging Face `transformers`, `peft` (LoRA), `bitsandbytes` (4-bit), `trl` (supervised
  fine-tuning). This is why the ML service is already Python/FastAPI: the trainer joins it.

### The training data (all consented, M8)
1. The owner's own messages and Q&A from the ALTER test chat (`core.chat_messages`, with `persona_training`).
2. "Communication style" items and documents the owner added (`core.datasets`, included only).
3. An **evaluation set**: questions the owner answers themselves, kept aside to test the trained AI.
Converted to instruction pairs ("question → the owner's answer"). Documents stay in **retrieval** (semantic search),
not in the weights: facts change; style doesn't.

### The pipeline (designed as steps E1–E4 in `PROGRESS.md`)
1. **Engine slot (E1):** each version records its *engine*: `base` (today: hosted model + persona + retrieval) or
   `adapter` (trained), the training mode (`cloud`, `local`, or `simulated` for demos, labelled as such), the
   adapter's SHA-256 and a readiness score. The manifest and therefore the token certify which engine a version uses.
2. **Trainer socket:** a training job is queued in Core (the job table already exists). The trainer (Python, on a GPU)
   **claims** the job, downloads a **consented data export** (only included items, only with consent), trains,
   **reports checkpoints** (progress shown live in ALTER, M9 FE-2), and returns the adapter + its hash + scores.
   **The training data is deleted from the GPU machine afterwards** (the original promise: "we train it and delete
   your data").
3. **Local training:** an owner with their own GPU can train locally and upload the adapter; ALT runs the same
   checks before accepting it, and marks it "trained locally".
4. **Readiness and approval (E2, M9 FE-4):** the adapter answers the evaluation set; we compute a **readiness score**
   (answer quality vs the owner's answers + the **style-match score**, our model already in production); the owner
   approves or trains again; then ALT's system check (readiness + safety) before verification.
5. **Serving:** one GPU inference server runs the base model once and loads **many adapters** on demand (multi-LoRA
   serving in vLLM or llama.cpp). The persona engine sends `adapter` versions there instead of to Groq. Nothing
   else changes: same prompt builder, retrieval, moderation, logging, versions, token.
6. **Verification and minting** as today: the version's manifest now includes the adapter hash; publishing it records
   the manifest on-chain. A renter's AI uses exactly the adapter the token certifies.

### Why this design
- One base model + small adapters = cheap storage and serving (thousands of AIs on one GPU server).
- Data minimisation: data leaves for training only with consent and is deleted after; the adapter, not the data, is
  the AI.
- Measurable: the style-match model gives a before/after number for every AI.
- Honest during development: until the trainer exists, demos use a clearly **labelled simulated training** so the
  whole lifecycle can be shown; it is listed under "known mocks".

### Counter-questions
| Question | Answer |
|---|---|
| Why not fine-tune GPT-4 or Gemini? | Their fine-tuning is paid per token, the weights stay with the provider, and the owner's data leaves us. Open models + LoRA keep the adapter ours and allow local training. |
| Can it really copy someone's style? | Style transfer with LoRA on a few hundred examples is well established. We will measure it per AI with the style-match model and the evaluation set, and we won't verify an AI below a readiness threshold. We won't promise 100%. |
| How much data does a person need? | A few hundred good examples (chats, Q&A) for style; documents go to retrieval and have no minimum. |
| GPU cost? | Training a 3B QLoRA adapter takes minutes to about an hour on one GPU. Owners with a GPU train for free locally. Serving: one GPU server holds the base model once for many adapters. |
| What if the adapter learns private data? | Only consented data is used; documents stay out of the weights (retrieval); outputs are still moderated; the adapter is never sold as a file (only usage rights). |

---

## 2. The blockchain on a public network (M17, M12, M6)

**Today:** the same contracts on a local Hardhat chain (31337); a private chain on the beta server.

**Steps to Polygon Amoy (public testnet):**
1. Create a deployer account; fund it from the Polygon faucet (free test POL); get an RPC URL (e.g. Alchemy).
2. Put `AMOY_RPC_URL` and `AMOY_DEPLOYER_PRIVATE_KEY` in the shell (never in the repo), run
   `npm run deploy:amoy -w @alt/contracts` → writes `deployments/amoy.json`.
3. Verify the source on Polygonscan (so anyone can read the contract).
4. In `.env`: `CHAIN_MODE=amoy`, the contract addresses, the relayer and governor keys, `CHAIN_EXPLORER_URL`,
   `CHAIN_CONFIRMATIONS` (e.g. 2–3 for safety).
5. IPFS: `IPFS_MODE=pinata` + `PINATA_JWT`, so manifests are pinned publicly and readable from any IPFS gateway.
6. Explorer links appear automatically in ALTER, ALTERA and ALTAR.

**Then mainnet (Polygon PoS):** professional audit of the contracts; keys in a KMS/HSM (relayer, governor) and the
admin role behind a multi-signature wallet; custodial wallets moved to a KMS or MPC wallet service; monitoring of the
relayer's balance.

**Counter-question:** "Why Polygon?" EVM-compatible (Solidity, OpenZeppelin, standard wallets), low fees, fast
blocks, and widely used for NFTs. Our code is EVM-generic, so any EVM chain works by configuration.

---

## 3. The six remaining modules (final evaluation)

| Module | What exists already | What we will add |
|---|---|---|
| **M2** Messaging and notifications | One inbox for all apps, real-time stream, push code (Firebase) built and tested | Switch on Firebase (needs the project), email digests, notification preferences |
| **M5** Logging and audit | Hash-chained audit log, interaction log, audit page with chain check | **Anchor the audit hash on-chain** periodically (so even a database admin can't rewrite history); an audit explorer for an AI's behaviour over time (forensics, FE-3) |
| **M6** Version control and IPFS | Immutable versions, manifests with CIDs, on-chain version history, verification | Pinata in production; adapter hashes in manifests; a version-diff view |
| **M7** AI Health Score | `interaction_log` (latency, flags), reports, ratings, style score, the behaviour scan | One score per AI from: response speed, moderation hits, reports, reviews, readiness/style scores, drift between versions; shown on ALTAR (ranking, badges) and ALTERA; alerts in the inbox. Replaces the placeholder "Health 100%" |
| **M9** Training manager | Version building, clearance, version history, simulated training design | The trainer (section 1), live training progress, readiness ratio, test-and-compare screen |
| **M18** Creator control panel | Royalties per AI, wallet earnings, ALTERA insights, ALTAR activity | One panel: earnings, royalties, engagement, health, versions; pricing management; CSV/PDF export. Replaces ALTERA's old mocked panel |

Also planned for the presented modules:
- **M12:** auctions (on-chain bids) and licence terms beyond sale/rent/subscription.
- **M14:** AI-to-AI conversations with loop limits.
- **M16:** fine-tune the toxicity model on Urdu and Roman Urdu; a feed-ranking model once real engagement data exists.
- **M1:** Google sign-in buttons in the apps (needs the Google client ids); iOS if required.

---

## 4. Deployment and scaling

**Today (beta, live since 20 October):** one Ubuntu server on AWS EC2 (2 vCPUs, 4 GB), `https://13-207-216-40.sslip.io`.
Caddy in front for HTTPS (automatic certificates), all services in production mode under one systemd service
(`deploy/beta/start.mjs`), the server's PostgreSQL, a private test chain saved and replayed between restarts, Gmail
SMTP for email codes, the ML service. One command deploys from a PC (`bash deploy/beta/deploy.sh`). Memory used: 1.5 GB.

**Production plan:**
1. **Containers** per service; a managed PostgreSQL (e.g. AWS RDS or Neon) with daily backups and point-in-time recovery.
2. **Several Core instances** behind a load balancer. Two things move from memory to a shared store first: the
   one-time spend approvals and the push fan-out (a PostgreSQL table or Redis). Everything else (jobs with
   `SKIP LOCKED`, LISTEN/NOTIFY, the outbox) already works with several instances.
3. **ALTAR web and the Command Centre** on a CDN/edge host (e.g. Vercel); the API behind the gateway.
4. **GPU inference server** for adapters (section 1); the hosted LLMs stay as a fallback.
5. **CI/CD:** GitHub Actions running all 217 tests and the type checks on every push; secret scanning; deploy on
   green.
6. **Monitoring:** structured logs with request ids (already), metrics and alerts (e.g. Grafana/Prometheus, Sentry),
   the relayer's balance, the indexer's lag.
7. **Security hardening:** KMS for keys, staff 2FA enforced (already the production default), regular dependency
   audits, penetration test.

**Counter-questions**
| Question | Answer |
|---|---|
| How many users can it handle? | One small server runs everything today. Each service scales horizontally; PostgreSQL scales vertically and with read replicas; the gateway is stateless. The heaviest part, AI generation, scales by adding GPU servers or relying on hosted providers. |
| What's the single point of failure? | The database and the gateway. Managed PostgreSQL with failover, and several gateway copies behind a load balancer, remove both. |
| Why not Kubernetes now? | Not needed at our size; containers + a load balancer first. The services are already separate processes with health checks, so moving to Kubernetes later is straightforward. |

---

## 5. Order of work to the final evaluation

1. Training: the engine slot and trainer socket (E1), then readiness and approval (E2), then the ALTER screens (E3).
2. M7 Health Score (E5) and M18 Creator panel (E6), using the data already collected.
3. M5 completion (on-chain anchoring) and M6 (Pinata), then Polygon Amoy deployment.
4. M2 push (Firebase), M12 auctions, M14 AI-to-AI, Urdu moderation.
5. CI on GitHub Actions throughout; the 100% report with full test coverage.
