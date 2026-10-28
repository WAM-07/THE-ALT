# The models: what we use, what we trained, and the numbers

Evaluators will ask "which models?", "did you train anything?", "how accurate is it?" and "why this model?". The
honest summary, to say in one breath:

> Replies come from **pre-trained hosted language models** (Groq's gpt-oss-120b, Gemini as fallback): we don't
> fine-tune them yet. Around them we run **four ML models of our own** in a Python ML service: two pre-trained models
> we integrated and evaluated ourselves (**toxicity** and **sentence embeddings**) and two we **trained**
> (**style match** and the **behaviour detector**). Every number below was measured by us on public data, and each
> has the command that reproduces it. Fine-tuning a personal adapter for each AI is the next phase.

The full record (data, licences, decisions, all numbers) is `docs/report-log/ml-models.md`; raw results are in
`docs/report-log/results/*.json`.

| # | Model | Kind | Module | Where you see it | Headline result |
|---|---|---|---|---|---|
| 0 | Groq `openai/gpt-oss-120b` (Gemini, DeepSeek fallback) | Pre-trained, hosted | M10, M15 | Every AI reply | 865 ms mean, 1,804 ms 95th percentile (41 demo replies) |
| 1 | **toxic-bert** (hate speech / toxicity) | Pre-trained, run and evaluated by us | M16 | Posts, comments, DMs ("Before you send"), every AI reply | Blocking F1 **0.861**, AUC **0.94** on 4,290 tweets |
| 2 | **bge-small-en-v1.5** (embeddings) | Pre-trained, run and evaluated by us | M10, M11 | The AI finds your notes by meaning; ALTAR "describe an AI" search | nDCG@10 **0.677 → 0.737** (+8.9%) vs our old BM25 |
| 3 | **Style match** ("sounds like you") | **Trained by us** (logistic regression) | M10, M9 | "Sounds like you · N%" under replies in ALTER | AUC **0.739** on 100 writers it never saw |
| 4 | **Behaviour detector** (Isolation Forest + extremeness) | **Retrained daily** on ALT's own logs | M16 FE-3 | Command Centre 06, flag cases | Recall **0.915** at **0.5%** false alarms (simulated data) |

---

## The ML service (architecture)

- `services/ml`: Python, **FastAPI**, **ONNX Runtime** (CPU), HF `tokenizers`, **scikit-learn**. No PyTorch on the
  server (smaller, faster). Listens only on `127.0.0.1:4500`; every request needs the internal service key
  (refused in production without it). Only ALT Core calls it.
- Endpoints: `POST /toxicity`, `POST /embed`, `POST /anomaly`, `GET /health`.
- Models are downloaded once at **pinned revisions** (`services/ml/models.py`), so results are reproducible.
- **If the ML service is down, nothing breaks**: moderation uses ALT's rules alone, search uses BM25, the style score
  uses style features only, the behaviour scan says "unavailable". Tested.
- Speed on the beta server (2 vCPUs): about **21 ms** per message for toxicity, **6 ms** per search query. Memory:
  the whole system uses 1.5 GB of 3.8 GB.
- Set up: `npm run ml:setup` once (Python 3.10+), then `npm run dev`/`demo` starts it. The beta server installs it
  automatically.

## 0. The language model (persona engine)

- **What:** Groq-hosted `openai/gpt-oss-120b` (an open-weight 120-billion-parameter model), with Gemini
  (`gemini-flash-latest`) then DeepSeek as fallbacks, all through one OpenAI-compatible interface (`llm.ts`).
- **How it becomes "your" AI:** the persona engine builds the prompt from the persona config, approved memories and
  the passages found by semantic search; settings map to temperature and length; every reply is moderated and logged.
  See `04-soban-alter-altar.md` (M10).
- **Why hosted now:** no GPU server needed for the demo; fast (sub-second); swappable by configuration. **Not fine-tuned**:
  never claim it is.

## 1. Toxicity / hate speech: toxic-bert

- **Model:** `unitary/toxic-bert` (Apache-2.0): BERT-base fine-tuned by Unitary on the Jigsaw Toxic Comment
  Classification dataset (Wikipedia comments). Six independent outputs (sigmoid): toxic, severe_toxic, obscene,
  threat, insult, identity_hate. Its authors report mean AUC 0.98636 on Jigsaw's test set. We run the int8 ONNX
  export (111 MB).
- **Our levels:** severe = identity_hate, threat or severe_toxic ≥ 0.5; toxic = toxic, insult or obscene ≥ 0.8;
  mild = toxic ≥ 0.5. Posts/comments/AI replies are blocked at toxic or severe; human DMs are blocked at severe and
  warned ("Send anyway?") at toxic or mild.
- **Our evaluation** (data it was never trained on): Davidson et al. 2017, *Automated Hate Speech Detection and the
  Problem of Offensive Language* (ICWSM), tweets labelled hate speech / offensive / neither. Balanced sample: 1,430 per
  class = 4,290 tweets (seed 42). Command: `cd services/ml && python evaluate_toxicity.py`.

| Decision | Precision | Recall | F1 |
|---|---|---|---|
| Blocked (toxic or severe), used for posts and comments | 0.974 | 0.772 | 0.861 |
| Warned or blocked (mild and up), used for DMs | 0.928 | 0.868 | 0.897 |

  ROC-AUC 0.9375. Of 1,430 harmless tweets, only 60 (4.2%) would be blocked. Threshold sweep from 0.5 to 0.9 chose
  0.8 for blocking (few false blocks on public posts) and 0.5 for warning (a false alarm only costs a prompt).
- **Limits (say them before they ask):** English-centred (weak on Urdu / Roman Urdu); it detects harmful vs harmless
  well but can't separate *hate speech* from merely *offensive* language (precision 0.475 on hate alone; the dataset's
  authors found the same); polite but dehumanising sentences score low (ALT's rules catch some of these).

## 2. Semantic search: bge-small-en-v1.5

- **Model:** `BAAI/bge-small-en-v1.5` (MIT): 33M parameters, turns a text into 384 numbers (a vector) so that texts
  with similar *meaning* have similar vectors (cosine similarity). Questions get bge's retrieval instruction prefix.
- **Why:** our old search (BM25) needs a shared word: "What do I enjoy?" never found "I love Flutter". Meaning-based
  search finds it.
- **How we use it:** each passage of the owner's documents is embedded once (re-embedded only if its text changes,
  tracked by SHA-256); only vectors are stored (`core.dataset_chunks`), never the text. Ranking = cosine similarity
  + 0.1 × (BM25 / best BM25) ("hybrid"). ALTAR's search box also finds AIs by meaning ("someone who helps with
  poetry").
- **Our evaluation:** SciFact from the BEIR benchmark (5,183 scientific abstracts, claims with known answers; CC BY-SA
  4.0). The hybrid weight was chosen on the 809 *train* claims only, then tested once on the 300 *test* claims.
  Command: `python evaluate_search.py`.

| Ranking (test) | nDCG@10 | Recall@10 | MRR@10 |
|---|---|---|---|
| BM25 (our old search) | 0.677 | 0.798 | 0.644 |
| Meaning only | 0.703 | 0.820 | 0.673 |
| **Hybrid (what ALT uses)** | **0.737** | 0.855 | **0.708** |

  Sanity check: BEIR's published BM25 score on SciFact is 0.665, close to our port's 0.677, so our BM25 is faithful.
- **What nDCG@10 means (if asked):** how good the top-10 list is, rewarding the right answer higher up; 1.0 is perfect.

## 3. Style match: "sounds like you" (trained by us)

- **Task:** given samples of how a person writes and a new text, the probability the same person wrote it
  (authorship verification). It measures how well an AI imitates its creator *now*, and it is the yardstick for the
  fine-tuned adapter later (same test before and after).
- **Model:** logistic regression (scikit-learn) on 14 inputs: **13 writing-style features** (word length, sentence
  length, commas, exclamations, questions, ellipses, emoji, capital letters, first-person words, contractions,
  sentences starting in lower case, long words, digits), each as the distance from the person's average, plus the
  **meaning similarity** (bge cosine to the person's centroid). 15 learned numbers, applied in TypeScript in Core
  (`style.ts`, checked against the Python code by a test).
- **Data:** the Blog Authorship Corpus (Schler et al. 2006; free for non-commercial research): 300 bloggers, **200 for
  training and 100 different bloggers for testing**, so the test is on unseen people like a new ALT owner. Texts cut to
  250 characters (chat length). Command: `python train_style.py`.

| Test (100 unseen writers) | ROC-AUC | Accuracy | Equal error rate |
|---|---|---|---|
| Style features only | 0.697 | 0.644 | 0.364 |
| Meaning only | 0.687 | | |
| **Style + meaning (ALT uses it)** | **0.739** | **0.684** | **0.318** |

- In ALT: the profile is the creator's own messages in the test chat (with consent) and "communication style" items;
  the score shows from 5 samples. `GET /ais/:id/style` compares you vs the AI (words per sentence, emoji…).
- **Limits:** a modest baseline: better than chance (0.5) but wrong on many single short texts; the meaning part also
  measures topic; emoji weight is 0 because 2004 blogs have no emoji. On 600-character texts it reached 0.777, but it
  scored short chat messages too low, so we deliberately use the 250-character model.

## 4. Behaviour detector: unusual accounts (trained daily)

- **What:** once a day ALT Core counts each account's last 24 hours from its own audit log and chats: sign-ins,
  failed sign-ins, lockouts, distinct IP addresses, sessions ended, password changes, wallet actions, messages to AIs,
  flagged messages, items added/deleted, rentals and subscriptions (12 numbers). The ML service learns "normal" from
  every account's active days in the 30 days before and judges the last 24 hours.
- **Model:** an **Isolation Forest** (Liu, Ting and Zhou 2008; 200 trees): unusual *combinations* are easy to isolate
  with few random splits. Plus a **per-feature extremeness check** (how far the most extreme feature is above normal).
  Each threshold is the 99.5th percentile of the training days. Unusual → a **flag case for staff**; nothing happens to
  the account automatically. Fewer than 50 active days of history → it says "not enough history" instead of guessing.
- **Why both parts (our finding):** the forest alone caught only 6% of spam bots and 2% of harassment (they differ in
  one or two numbers while many normal days contain one rare event); the extremeness check catches those; the forest
  catches subtle account takeovers that no single number shows (92% vs 0%).
- **Evaluation on SIMULATED activity** (no labelled real abuse exists; we say so): 2,000 simulated accounts × 30 days,
  6 attack types at two strengths. Command: `python evaluate_anomaly.py`.

| Detector | Precision | Recall | False alarms |
|---|---|---|---|
| **Forest or extremeness (ALT uses it)** | **0.993** | **0.915** | **0.52%** |
| Forest alone | 0.990 | 0.470 | 0.39% |
| Extremeness alone | 0.998 | 0.837 | 0.13% |
| Hand-written rules | 1.000 | 0.347 | 0% |

  Weakness: subtle harassment (a few flagged messages) looks normal for a day (16% caught); the toxicity model judges
  each message instead.

---

## Counter-questions

| Question | Answer |
|---|---|
| Did you train any model? | Yes, two: the style-match model (trained on the Blog Authorship Corpus) and the behaviour detector (trained every day on ALT's own logs). We integrated and *evaluated* two pre-trained models (toxicity, embeddings). We have not fine-tuned a language model yet; that's the next phase. |
| Why not train your own hate-speech model? | A model trained by Unitary on 160,000 labelled comments beats anything we could train on a small set in the time. Our contribution is choosing it, setting thresholds from measurements, evaluating it on different data, and the policy (block vs warn). Fine-tuning it on Urdu is planned. |
| What's ONNX and why? | A standard format for trained models; ONNX Runtime runs them fast on a CPU without PyTorch (a much smaller install). We use the int8-quantised versions: 4× smaller, nearly the same accuracy. |
| How do you know your numbers aren't cheating? | Evaluation data was never used for training or tuning (separate datasets, or train/test splits by *person*); thresholds and weights chosen on train data only; scripts and pinned data revisions let anyone reproduce them. |
| What's precision vs recall? | Precision: of what we flagged, how much was really bad. Recall: of everything bad, how much we flagged. F1 balances both. |
| What's AUC? | The chance a random bad example scores higher than a random good one: 0.5 = guessing, 1.0 = perfect. |
| Why is the behaviour evaluation simulated? | Real labelled attacks on ALT don't exist yet (the beta started on 20 October). Simulation measures the *method*. The model itself trains on real ALT logs every day. |
| Does the ML slow the app down? | 6–21 ms per call on the 2-vCPU server; LLM replies take ~865 ms anyway. |
| Isn't sending text to an ML service a privacy risk? | It runs on our own server, internal only, behind the service key; nothing leaves ALT. |
