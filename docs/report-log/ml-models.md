# Log for the final report: machine-learning models

A running record of every model added to The ALT Ecosystem, kept while the work happens so the final (100%) report
can be written from facts: what each model is, why it was chosen, its data, how it was trained or evaluated, the
measured results, where it runs, and what changed. Newest entries at the bottom of each section. Numbers here come
only from real runs (the command that produced them is noted).

## Overview

| Model | Module | Kind | Status |
|---|---|---|---|
| Toxicity / hate-speech classifier (toxic-bert) | M16 (M14, M15) | Pretrained, integrated and evaluated by us | done: F1 0.861 (block), AUC 0.94 |
| Semantic embeddings, hybrid search (bge-small) | M10, M11 | Pretrained, integrated and evaluated by us | done: nDCG@10 0.677 -> 0.737 |
| Style match ("sounds like you") | M9, M7 | Logistic regression trained by us (style + embeddings) | done: AUC 0.739 on unseen writers |
| Abnormal-behaviour detector (Isolation Forest + extremeness) | M16 FE-3, M7 | Retrained daily on ALT's own logs | done: recall 0.915 at 0.5% FPR (simulated) |
| Personal AI adapter (QLoRA) | M9, M10 | Trained per AI | next phase |

## Decisions (owner)

- 2026-10-20: models where evaluators can see them; the personal adapter (#1) is the next phase. Deploy now the
  ones that need no training time from the team: toxicity (pretrained), embeddings (pretrained), style match
  (baseline), anomaly detector (trains itself in seconds). Feed ranking later (no real engagement data yet).
- 2026-10-20: hate speech in direct messages between people: severe (hate, threats) is blocked; milder toxicity
  warns the sender ("This may be hurtful. Send anyway?"); staff see nothing unless the recipient reports it.
  Messages written by AIs are always checked and blocked. Posts and comments: blocked, as before.

## Architecture

- 2026-10-20: one internal Python service, `services/ml` (FastAPI), beside ALT Core; it holds the models (ONNX
  and scikit-learn) and listens on 127.0.0.1 only, behind the service key. ALT Core calls it; if it is down,
  ALT falls back to its rule-based checks, so nothing stops working. Matches the Python AI service designed in
  Chapter 3 of the report, and is where the personal-adapter trainer plugs in next phase.

## Entries

### 2026-10-20 · Toxicity / hate-speech classifier (Module 16)

**Model.** `unitary/toxic-bert` (Apache-2.0): BERT-base fine-tuned by Unitary on the Jigsaw Toxic Comment
Classification Challenge (Wikipedia comments), six independent labels (toxic, severe_toxic, obscene, threat,
insult, identity_hate; sigmoid outputs). Its authors report a mean ROC-AUC of 0.98636 on Jigsaw's private test set.
ALT runs the int8-quantized ONNX export (`Xenova/toxic-bert`, revision `65cbc2607cb7`, 111 MB) on the CPU with
ONNX Runtime 1.20.1; no PyTorch on the server.

**Why this model.** Open licence; trained on the standard toxicity benchmark; small enough for a 2-vCPU, 4 GB
server; per-label scores let ALT treat threats and identity hate more strictly than insults. Limitation: English
only; weak on Roman Urdu and Urdu script (our own fine-tune is planned). Like most toxicity models it reacts to
slurs and swearing more than to polite but dehumanising wording, which ALT's rules keep catching.

**Levels (ALT's mapping of the six scores).** severe: identity_hate, threat or severe_toxic >= 0.5; toxic: toxic,
insult or obscene >= 0.8; mild: toxic >= 0.5; otherwise none. Posts, comments, AI replies and writing help block
toxic and severe; direct messages between people block severe and ask the sender to confirm toxic or mild.

**Evaluation (ours, on data the model was not trained on).** Davidson et al. (2017), "Automated Hate Speech
Detection and the Problem of Offensive Language" (ICWSM), 24,783 tweets labelled hate speech / offensive / neither
(`tdavidson/hate_speech_offensive`, revision `adc5fb77`; licence unstated, used for evaluation only). Balanced
sample: 1,430 per class (all hate-speech tweets), seed 42, 4,290 tweets. Harmful = hate speech or offensive.
Command: `services/ml> python evaluate_toxicity.py` -> `docs/report-log/results/toxicity-eval.json`.

| Decision | Precision | Recall | F1 | Accuracy |
|---|---|---|---|---|
| Blocked (toxic or severe), posts and comments | 0.974 | 0.772 | 0.861 | 0.834 |
| Warned or blocked (mild and up), direct messages | 0.928 | 0.868 | 0.897 | 0.867 |
| Blocked vs hate speech only (hate vs the rest) | 0.475 | 0.754 | 0.583 | 0.640 |

ROC-AUC of the "toxic" score, harmful vs neither: **0.9375**. Confusion (rows: label; columns: ALT level):

| Label | none | mild | toxic | severe |
|---|---|---|---|---|
| hate speech (1,430) | 199 | 153 | 365 | 713 |
| offensive (1,430) | 179 | 120 | 893 | 238 |
| neither (1,430) | 1,237 | 133 | 52 | 8 |

Threshold sweep for the "toxic" level (severe unchanged): 0.5: P 0.928 R 0.868 F1 0.897; 0.6: 0.943/0.849/0.893;
0.7: 0.958/0.822/0.885; 0.8: 0.974/0.772/0.861; 0.9: 0.987/0.675/0.801. **Chosen: 0.8 for blocking** (only 60 of
1,430 harmless tweets blocked: public posts should rarely be blocked wrongly) and **0.5 for the DM warning** (the
cost of a false alarm is only a "Send anyway?" prompt). Reading: the model separates harmful from harmless well
but cannot tell hate speech from merely offensive language (also found by the dataset's authors).
Speed: 67 ms per tweet on a desktop CPU (batches of 32, int8 ONNX).

**Where it runs.** `services/ml/app.py` (`POST /toxicity`), called by ALT Core's `checkSafety()`
(`services/core/src/modules/ai/moderation.ts`) together with ALT's rules: every AI reply (persona engine), a
person's chat message to an AI, ALTERA's moderation call for posts and comments (`/internal/moderate`), writing
help, and the persona safety check before verification. ALTERA's direct messages apply the DM policy
(`dmSafety()` in `services/altera-api/src/socket/realtime.js`; the ALTERA app shows "Before you send"). If the ML
service is down, ALT falls back to its rules (tested). Private messages are no longer written to the server log.

**Design notes.** Self-harm disclosures in a person's private message are never blocked (a person reaching out
for help); an AI's messages are always checked. Tests: Core `moderation.test.ts` (levels, rules kept, fallback),
ALTERA `altera.test.mjs` "hate speech (Module 16, with the toxicity model)" (posts, comments, DM block / warn /
confirm, self-harm delivered).

### 2026-10-20 · Semantic embeddings and hybrid search (Modules 10 and 11)

**Model.** `BAAI/bge-small-en-v1.5` (MIT; BAAI, 2023): a 33M-parameter sentence-embedding model, 384 dimensions,
CLS pooling, unit-length vectors; questions get bge's retrieval instruction ("Represent this sentence for searching
relevant passages: "), passages are embedded as they are. ALT runs the int8 ONNX export (`Xenova/bge-small-en-v1.5`,
revision `ea104dacec62`) in the same ML service (`POST /embed`), texts cut at 256 tokens.

**Why.** Retrieval before this used BM25 only, which needs a shared word ("What do I enjoy?" never finds "I love
Flutter"). bge-small is among the strongest small models on the MTEB retrieval benchmark and fast on a CPU.

**Design.** Only vectors are stored (`core.dataset_chunks` per passage, `core.ai_search_vectors` per verified AI;
migration `0012`); the passages' text stays encrypted with the item. A passage is embedded once (when its item is
uploaded, in the background) and again only if its text changes (SHA-256 of the passage). Plain `real[]` arrays,
compared in ALT Core: an AI has at most a few hundred passages, so pgvector is not needed yet (planned step).
Ranking = cosine similarity + w x (BM25 / best BM25), "hybrid". Falls back to BM25 when the ML service is down.

**Evaluation (ours).** SciFact (Wadden et al., 2020) from the BEIR benchmark (Thakur et al., 2021): 5,183
scientific abstracts, claims with known supporting abstracts; train claims 809, test claims 300 (`BeIR/scifact`
revision `b3b53356`, `BeIR/scifact-qrels` revision `2938d17d`; CC BY-SA 4.0). Every abstract scored for every claim.
BM25 is a line-for-line port of ALT's `terms()` and `bm25()`. The weight w was chosen on the train claims only.
Command: `services/ml> python evaluate_search.py` -> `docs/report-log/results/search-eval.json`.

| Ranking (test claims) | nDCG@10 | Recall@10 | MRR@10 |
|---|---|---|---|
| BM25 (ALT before) | 0.677 | 0.798 | 0.644 |
| Meaning only (embeddings) | 0.703 | 0.820 | 0.673 |
| **Hybrid, w = 0.1 (chosen on train; ALT uses it)** | **0.737** | 0.855 | **0.708** |
| Hybrid, w = 0.3 (first guess, before tuning) | 0.733 | 0.865 | 0.699 |

Train sweep (nDCG@10): w 0: 0.736, 0.1: 0.767, 0.2: 0.761, 0.3: 0.749, 0.5: 0.736, 0.75: 0.728, 1.0: 0.720.
Sanity check: BEIR's published BM25 on SciFact is 0.665, close to our port's 0.677. Hybrid search improves nDCG@10 by
8.9% (relative) over ALT's previous BM25. Speed: 93 ms per abstract on a desktop CPU (long texts, 256 tokens).
Limitations: English-centred model; abstracts are longer than ALT's 600-character passages.

**"Find an AI like..." on ALTAR.** `GET /core/public/search/ais?q=` ranks verified AIs by meaning (name,
category, description, published persona). bge scores unrelated short texts around 0.40-0.55, so a match needs a
score >= 0.55 and within 0.06 of the best match: hand-calibrated on 5 sample AI descriptions and 7 queries (all 5
relevant pairs scored 0.57-0.69; the best unrelated pair 0.557; two unrelated queries got no match). A small
calibration, not an evaluation. ALTAR's search box ("Search by name, or describe an AI") adds the AIs matched by
meaning to the name matches, and says how many matched by meaning.

**Tests.** Core `semantic.test.ts`: a question with no shared word finds the passage; passages are embedded at
upload and never again; no passage text in the database; BM25 fallback; AI search returns only good matches.

### 2026-10-20 · Abnormal-behaviour detector (Module 16 FE-3)

**What it does.** Once a day, ALT Core counts each account's last 24 hours from its own audit log and chat (12
features: sign-ins, failed sign-ins, lockouts, distinct IP addresses, sessions ended, password changes or resets,
wallet actions, messages to AIs, flagged messages, items added, items deleted, rentals and subscriptions). The ML
service (`POST /anomaly`) learns "normal" from every account's active days in the 30 days before, then judges the
last 24 hours. Accounts it finds unusual become **flag cases** for staff (category `unusual_activity`, with the
counts and the reasons as evidence, audited as `security.unusual_activity`); nothing is done to the account. Staff
see each scan in the Command Centre (**06 Unusual activity**; admins can "Scan now"). Results: `core.behaviour_scans`
(migration `0013`). With fewer than 50 active days of history it says "not enough history yet" instead of guessing.

**Model.** Retrained on every scan (seconds), on log(1 + count):
1. an **Isolation Forest** (Liu, Ting and Zhou, 2008; scikit-learn 1.6.0, 200 trees, 256 samples per tree): unusual
   combinations of features;
2. a **per-feature extremeness** check: the largest (x - median) / (90th percentile - median) over the features.
Each threshold is the 99.5th percentile of the training days, so about 1% of ordinary days are expected to be flagged.

**Why both (found in our evaluation).** The forest alone missed spam bots (6% caught) and harassment (2%): they
differ in one or two features, and in 12 features many ordinary days already contain one rare event (a lockout, a
password change), which the forest finds just as isolated. The extremeness check catches those, and the forest
catches what no single feature shows (subtle account takeover: 92% vs 0%).

**Evaluation: SIMULATED data** (ALT has no labelled record of real abuse, so this measures the method, not live
data). `services/ml> python evaluate_anomaly.py` (seed 42) -> `docs/report-log/results/anomaly-eval.json`.
2,000 simulated ordinary accounts with their own activity rates, 30 days (24,059 active days), plus 119 unlabelled
attack days mixed into training (0.5%, as real logs would contain). Test: a new day of every account (776 active
ordinary days) and 600 simulated attack days (6 kinds x obvious and subtle x 50).

| Detector | Precision | Recall | False-positive rate |
|---|---|---|---|
| **Forest or extremeness (ALT uses it)** | **0.993** | **0.915** | 0.52% |
| Isolation Forest alone | 0.990 | 0.470 | 0.39% |
| Extremeness alone | 0.998 | 0.837 | 0.13% |
| Hand-written rules (failed sign-ins >= 10, messages >= 500, flagged >= 10) | 1.000 | 0.347 | 0% |

ROC-AUC: forest score 0.983, extremeness 0.986. Share caught by kind (ALT's detector / forest alone / rules):
credential stuffing obvious 1.00 / 0.64 / 1.00, subtle 0.96 / 0.26 / 0.84; account takeover obvious 1.00 / 1.00 /
0, subtle 0.92 / 0.92 / 0; spam bot obvious 1.00 / 0.06 / 0.98, subtle 0.98 / 0.10 / 0.48; harassment obvious
1.00 / 0.02 / 0.86, **subtle 0.16** / 0 / 0; data dumping obvious 1.00 / 0.76 / 0, subtle 1.00 / 0.62 / 0; market
abuse obvious 1.00 / 0.88 / 0, subtle 0.96 / 0.38 / 0. Limitation: subtle harassment (a few flagged messages) looks
ordinary for a day; the toxicity model judges each message instead. ALTERA's own activity (posts, DMs) is not in
the counts yet (it lives in ALTERA's database); Core's activity is.

**Tests.** Core `behaviour.test.ts`: counts come from the audit log (failed sign-ins), an unusual account gets one
flag case and an ordinary one none, staff only see the scans, and the scan says "not enough history" or
"unavailable" instead of guessing.

### 2026-10-20 · Style match, "sounds like you" (Modules 9 and 7): a baseline we trained

**Task.** Given samples of how a person writes (their profile) and a new text (an AI reply), the probability that
the same person wrote it: authorship verification. It shows how well an AI imitates its creator now, and is the
measuring stick for the personal adapter (#1) next phase: the same test before and after.

**Model (trained by us).** Logistic regression (scikit-learn 1.6.0) over 14 inputs: for 13 writing-style features
(word length, sentence length, commas, exclamations, questions, ellipses, emoji, capital letters, first-person
words, contractions, sentences starting in lower case, long words, digits; each per word or per letter),
|text - profile mean| / scale, plus the meaning similarity (cosine of the text's bge vector to the profile's
centroid). Trained in seconds; ALT Core applies the 15 numbers (`services/core/src/modules/ai/style-model.json`) in
TypeScript (`style.ts`); its feature code is checked against the Python code on fixed texts (`style.test.ts`).
Without the ML service a style-only model is used.

**Data.** The Blog Authorship Corpus (Schler, Koppel, Argamon and Pennebaker, 2006: 681,288 posts by 19,320
bloggers, 2004; free for non-commercial research), half of the Hugging Face copy (`tasksource/blog_authorship_corpus`
revision `8d658f13`; 430,000 posts, 11,529 bloggers). Bloggers with 30+ posts of 200-3,000 characters (2,041); 300
drawn (seed 42): **200 for training and 100 different bloggers for testing**, so the test is on unseen people, as
with a new ALT owner. Each blogger: a profile of 20 posts, 5 more of their posts and 5 posts by other bloggers
(2,000 training pairs, 1,000 test pairs). Command: `services/ml> python train_style.py` ->
`docs/report-log/results/style-eval.json`.

| Test (100 unseen bloggers) | ROC-AUC | Accuracy at 0.5 | Equal error rate |
|---|---|---|---|
| Style features only | 0.697 | 0.644 | 0.364 |
| Meaning only (cosine) | 0.687 | | |
| **Style + meaning (ALT uses it)** | **0.739** | **0.684** | **0.318** |

Texts cut to **250 characters** (chat length; ALT cuts the same way). Trained first at 600 characters: AUC 0.777
(style 0.733, meaning 0.715), accuracy 0.705, EER 0.292; longer texts carry more signal, but at that length the
model scored short chat messages too low (a matching casual message 0.23), so ALT uses the 250-character model.
By profile size (test AUC): 3 samples 0.717, 5: 0.764, 10: 0.732, 20: 0.752 (differences beyond 3 vs 5 are within
noise for 1,000 pairs); ALT shows the score from **5 samples** of the person's writing.

**Reading.** A modest, honest baseline: it tells writers apart well above chance (0.5) but makes many mistakes on a
single short text. The meaning part also measures topic (bloggers keep to their subjects). Weights: the meaning
similarity dominates (+6.5); sentences starting in lower case (-0.78), ellipses (-0.53), commas, word length and
contractions matter most among the style features. Emoji has weight 0 because 2004 blogs have none, so emoji
style is not yet learned. The personal adapter phase should be judged with this same test.

**In ALT.** The profile is the creator's own messages in the AI's test chats (with the persona-training consent;
unflagged, 20+ characters, newest 40) and the AI's "communication style" items. Each reply in ALTER's test chat
shows "Sounds like you · N%"; `GET /ais/:id/style` gives the average over the last 10 replies and a readable
comparison (words per sentence, exclamations, emoji, capital letters, contractions: you vs the AI).
