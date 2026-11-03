# Log for the final report: what was built after the 60% evaluation

Dated facts for the 100% report (Chapters 4 and 5): what each piece is, why, where it lives and how it is
tested. Status of everything: `PROGRESS.md` → "Road to 100%". Models: `ml-models.md`.

## 2026-10-28

- **Hardening (S1).** Fixed an authorisation bug in ALTERA's block/unblock (a client-sent `blocker_id` was
  trusted; now it must be the caller or one of their AIs). Added four missing foreign keys to ALTERA's legacy
  schema without risking old rows (`NOT VALID`, then validated where clean). The report's Unit Tests 01–04 became
  named automated tests. Both smart contracts reached 100% line coverage. GitHub Actions CI added.
- **Training is the only way in (S2, owner's plan "the engine and the car").** Every AI version records its
  engine (base, or a trained adapter), how it was trained and the adapter's SHA-256; only trained versions pass
  clearance or can be published, and the IPFS manifest certifies it. Until the real trainer runs, a labelled
  simulated training produces versions that say so in their manifest. A "trainer socket" (claim with a lease,
  consented data export, checkpoints, adapter, data deletion stated) and an "inference socket" were built and
  tested with stand-ins.
- **Readiness and approval (S4, M9).** The owner writes questions with their own answers (encrypted); each trained
  version answers them and is scored on meaning (sentence embeddings) and style (our style-match model): readiness
  0–100. The owner approves or trains again; ALT's system check needs readiness and safe answers.
- **Bring a trained AI (S5).** Owners may upload an adapter trained on their own GPU (safetensors/GGUF checked by
  header, hashed while streamed); it goes through the same checks, labelled "trained locally".
- **Health Score (S6, M7).** One 0–100 score per AI from blocked replies, reports, readiness, ratings and speed,
  minus drift between versions; hourly; inbox alert below 60. Data from other services is read only through views
  they own (ALTAR's ratings).
- **Creator Control Panel (S7, M18).** Earnings and royalties (from ALTAR's view of the contract's events),
  engagement and influence (ALTERA's view), health and versions (Core), with CSV and a PDF written without a library.
- **ALTERA:** AI-to-AI comments with loop limits (M14), engagement filter (M13), influence metric (M15); the
  keyboard bug fixed (owner's report).
- **M8 / M6:** a downloadable consent record (PDF) and a "what changed" diff between versions.
- **M2:** notification preferences (mute per category, in the inbox or on the phone) and e-mail digests.
- **M5:** forensics: an AI's behaviour over time for staff.

## 2026-10-29

- **AI-to-AI messages (owner's request, M14 FE-1).** A person's AI writes to a teammate's AI from its owner's
  brief; the owner approves every message (so AIs never answer each other unsupervised); the teammate's AI passes
  it on when they chat, with the messages marked as information, not instructions (prompt-injection guard).
- **Conditional posts, beta (M15 FE-2).** One post per outcome, all moderated up front; the owner says what
  happened and that version is published.
- **Staff review before minting (M3),** optional (`DEPLOY_REVIEW`).
- **Demo AIs labelled "demo"** in every app; the Command Centre's AI forensics page.
- **Security:** Next.js critical advisory patched (16.4.3) with the compatible dependency fixes.
- **CI:** first green run on GitHub.

## 2026-11-03

- **The real trainer (S3), code.** `services/trainer`: QLoRA (4-bit NF4 base model, LoRA rank 16 on attention and
  MLP layers, 3 epochs, lr 2e-4) on the owner's writing samples, documents and memories; default base model
  Qwen2.5-3B-Instruct (Apache-2.0, fits an 8 GB GPU). The adapter is packed into one safetensors file with its
  config, uploaded to Core under its SHA-256, and served by an inference server that switches adapters on one base
  model. The trainer deletes the data before telling Core it is done. Tested without a GPU (protocol, dataset,
  adapter file); the first real training on the RTX 3070 is the next measurement for the report.

## Test totals

| Date | Backend | Flutter | Trainer (Python) | Total |
|---|---|---|---|---|
| 2026-10-20 (60%) | 185 | 32 | – | 217 |
| 2026-10-28 | 209 | 32 | – | 241 |
| 2026-11-03 | 234 | 34 | 5 | 273 |
