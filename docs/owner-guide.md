# The owner's guide: what only you can do, and exactly how

Everything here needs you (an account, a key, a phone, a decision or your own writing). Everything else
is already built; its status is in `PROGRESS.md` → "Road to 100%". When you finish an item, tell me
"done A3" (for example) and I do the part that follows it.

**Golden rule for keys:** put them only in `C:\THE ALT\.env` (never in chat, never in a commit;
`.env` is git-ignored). After changing `.env`, stop `npm run dev` (Ctrl+C) and start it again.

| # | Task | Unblocks | Time | Cost |
|---|---|---|---|---|
| A1 | Set up the RTX 3070 for training | S3: the real trainer (the heart of ALT) | 1–2 h | free |
| A2 | Hugging Face account (only for gated models) | other base models | 5 min | free |
| A3 | Firebase project | push notifications (M2) | 30 min | free |
| A4 | Google sign-in client ids | the Google button (M1) | 30 min | free |
| A5 | Pinata JWT | real IPFS pinning (M6) | 10 min | free tier |
| A6 | Polygon Amoy wallets and RPC | the public test network (M17, S11) | 30 min | free (test POL) |
| A7 | A server | a new beta / production (S11) | 30 min + me | free–low |
| A8 | Revoke the old Groq key | security | 5 min | free |
| B1–B2 | Checks on your phone | the keyboard fix, the new ALTER screens | 30 min | – |
| C1 | Evaluation questions (each member) | real readiness scores (M9) | 30 min each | – |
| C2 | Urdu / Roman Urdu data | moderation in Urdu (M16) | a decision, or 2–3 h | – |
| D1–D4 | Decisions | defaults, auctions, the saved demo, company AIs | 15 min | – |
| E | The report | S12 | – | – |

**Suggested order:** A8 → B1/B2 → C1 → A1 → D1 → A5 → A3 → A4 → A6 → D2/D3 → A7.

---

## A. Accounts and keys

### A1. The RTX 3070 for training (most important)
The full steps, with a troubleshooting table, are in `services/trainer/README.md`. In short:
1. Update the NVIDIA driver (nvidia.com/drivers → GeForce → RTX 30 Series → RTX 3070 → Windows 11 → Download). Then in a terminal, `nvidia-smi` must show the RTX 3070.
2. In `C:\THE ALT\services\trainer`: `python -m venv .venv` then `.venv\Scripts\activate`.
3. `pip install torch --index-url https://download.pytorch.org/whl/cu124`
4. `pip install -r requirements.txt`
5. `python trainer.py --check` → it must end with **"Ready to train."** If not, send me its output.
6. In `C:\THE ALT\.env` add two lines: `TRAINING_MODE=trainer` and `ADAPTER_INFERENCE_URL=http://127.0.0.1:4600`, then restart `npm run dev`.
7. Second terminal (venv active, in `services/trainer`): `uvicorn inference:app --host 127.0.0.1 --port 4600`
8. Third terminal (same): `python trainer.py`
9. In ALTER: chat with your AI a little (your own messages teach it your style), then Identity → **Train**. The first run downloads the base model (about 6 GB).
10. Tell me "done A1" with what the trainer printed; I then measure the training for the report.

To go back to the simulated training (for the demo), remove the two `.env` lines and restart.

### A2. Hugging Face (only if you want a gated model)
The default model (Qwen2.5-3B-Instruct) needs no account. For Llama or Gemma: huggingface.co → Sign up → open the model page → "Agree and access" → Settings → Access Tokens → New token (Read) → in the trainer's terminal: `set HF_TOKEN=hf_...` before `python trainer.py`, and `TRAINER_BASE_MODEL=<model id>` in `.env`.

### A3. Firebase (push notifications)
1. console.firebase.google.com → **Add project** → name "ALT Ecosystem" → Analytics off → Create.
2. Project overview → **Add app → Android**. Package name **`com.altecosystem.alter`**, nickname ALTER → Register → **Download google-services.json** → save it as `C:\THE ALT\apps\alter\android\app\google-services.json`. Skip the remaining steps (I do the code).
3. Same again for **`com.alteraapp.altera_app`** (ALTERA) → save to `C:\THE ALT\apps\altera\android\app\google-services.json`.
4. ⚙ Project settings → **Service accounts** → **Generate new private key** → save the file as `C:\THE ALT\.data\firebase-service-account.json`.
5. In `.env`: `FCM_SERVICE_ACCOUNT=.data/firebase-service-account.json`
6. Tell me "done A3": I add the Firebase plugin to both apps, rebuild them and we test a push on your phone.

### A4. Google sign-in
1. console.cloud.google.com → choose the same project as Firebase (it exists there already) → **APIs & Services → OAuth consent screen** → External → app name "The ALT Ecosystem", your email → add your team's Gmail addresses as test users → Save.
2. **Credentials → Create credentials → OAuth client ID → Web application**, name "ALT web" → Create. Copy the **client ID** (ends in `.apps.googleusercontent.com`).
3. Again: **Android**, package `com.altecosystem.alter`, and the SHA-1 of the signing key. Get it with: `cd "C:\THE ALT\apps\alter\android"` then `.\gradlew signingReport` → copy the SHA1 under "Variant: debug" (and "release" for the APK). Repeat for ALTERA (`com.alteraapp.altera_app`, in `apps\altera\android`).
4. In `.env`: `GOOGLE_CLIENT_IDS=<web id>,<alter android id>,<altera android id>`
5. Tell me "done A4" with the **web** client id (it is not secret): I switch the buttons on in both apps.

### A5. Pinata (real IPFS)
1. app.pinata.cloud → Sign up (free) → **API Keys → New Key** → Admin (or the pinning scopes) → name "ALT" → Create → copy the **JWT** (shown once).
2. In `.env`: `IPFS_MODE=pinata` and `PINATA_JWT=<the JWT>`; restart.
3. From then on, new versions' manifests are pinned for real (the old ones stay local). Tell me "done A5".

### A6. Polygon Amoy (the public test network)
1. In MetaMask (a browser profile you use for nothing else) create **three new accounts**: "ALT deployer", "ALT relayer", "ALT governor". Never use a wallet that holds real money.
2. Test POL for each: faucet.polygon.technology (choose Amoy) or the Alchemy faucet; about 1 POL each is plenty. The relayer pays everyone's fees, so give it the most.
3. dashboard.alchemy.com → Create app → Chain **Polygon PoS, network Amoy** → copy the **HTTPS URL**.
4. Export each private key (MetaMask → account → ⋮ → Account details → Show private key). Put them **only** in `.env` (the deployer only in your terminal):
   ```
   CHAIN_RPC_URL=<Alchemy URL>
   RELAYER_PRIVATE_KEY=<relayer key>
   GOVERNOR_PRIVATE_KEY=<governor key>
   ```
5. Tell me "done A6" and give me the **addresses** (public, safe). I prepare the deploy; you run
   `set AMOY_RPC_URL=...` and `set AMOY_DEPLOYER_PRIVATE_KEY=...` in a terminal, then `npm run deploy:amoy -w @alt/contracts`.

### A7. A server (new beta or production)
Any Ubuntu 24.04 machine with 2 vCPU, 4 GB RAM and 30 GB disk: your friend's AWS again (t3.medium), Oracle Cloud Always Free (Ampere A1, free) or a small VPS. Open ports 22, 80, 443. Then give me SSH access with the `alt_beta` key (as last time); the steps are in `deploy/beta/README.md` (`setup.sh`, `configure.sh`, `deploy.sh --seed`, then I rebuild the APKs for it).

### A8. Revoke the old Groq key
console.groq.com → API Keys → delete the old key (the one shared during development) → Create API Key → put the new one in `.env` as `GROQ_API_KEY=` → restart.

---

## B. Checks on your phone

How to run the apps on your Redmi (USB):
1. `npm run dev` on the PC.
2. Phone plugged in, USB debugging on, then `adb reverse tcp:8080 tcp:8080`.
3. `cd "C:\THE ALT\apps\altera"` (or `apps\alter`) → `C:\flutter\bin\flutter run --dart-define=ALT_API_URL=http://127.0.0.1:8080`

### B1. ALTERA keyboard fix
Open the feed, a profile, the new-message sheet and a comment box; type in each. The text must stay visible above the keyboard, and the frosted bottom bar must disappear while you type. Tell me any screen where it still hides the text.

### B2. The new ALTER screens
Home → **AI messages** (needs two accounts with verified AIs: message one from the other), Home → **Readiness** (add 3 questions), Identity → **Health**, Settings → **Creator panel** (Copy CSV, Save PDF), Consent → **Download my consent record**, Version history → **What changed**, the inbox's **tune icon** (mute a category). In ALTERA: the composer's **split icon** (conditional post). Screenshots of each help the report.

---

## C. Data

### C1. Evaluation questions (each team member, for their own AI)
In ALTER → Home → **Readiness** → **Add**: 20–30 questions people really ask you, each answered **in your own words** (as you would type them). Mix: your subject ("Explain recursion"), your opinions ("Is Flutter better than React Native?"), and personal style ("How do you start your day?"). Don't paste answers from elsewhere: the score measures how close the AI comes to *you*.

### C2. Urdu / Roman Urdu moderation
Choose one:
- **(a) A public dataset:** say "use a public dataset" and I list candidates with their licences for you to approve; or
- **(b) Your own labels:** a spreadsheet with columns `text`, `language` (urdu / roman_urdu / english) and `label` (ok / mild / toxic / severe); 300–500 rows from real ALTERA-style messages (no personal data). Put it in `docs/data/urdu-moderation.csv`.

---

## D. Decisions (reply in a sentence each)

### D1. The defaults (keep them unless your supervisor asks otherwise)
- Readiness gate in production: **3 questions**, **50%** readiness, scored **70% meaning / 30% style**.
- Health Score: safe replies **35%**, reports **25%**, readiness **20%**, ALTAR rating **10%**, speed **10%**; alert below **60**.
Reply "keep the defaults" or give new numbers.

### D2. Auctions and licence terms (M12)
1. Auction type: **English** (bids go up, highest wins at the deadline) or Dutch (price drops until someone buys)?
2. A reserve price (minimum)? Minimum step between bids (e.g. 5%)? Length (1–7 days)?
3. Licences: which uses should a buyer or renter get: personal only; commercial; may resell; must credit the creator?

### D3. Replacing the saved demo
Auctions and on-chain audit anchoring change the smart contracts, which means a fresh local chain (`npm run demo -- --fresh`) and a new demo story. I would **back up the current demo first** (database and chain files) so it can be restored. Reply "OK to replace the demo after a backup" or "not yet".

### D4. Company AI endpoints (on hold, your call 2026-10-29)
Uploading an adapter (already built) is the safe way. Endpoints would send people's messages to the company's servers, so they need a consent rule and an approved list of servers. No action unless you decide to add them.

---

## E. The report (S12)
Your part: the writing review, Turnitin, supervisor meetings and each member's contribution section. Mine: Chapters 4 and 5 for all 18 modules from `PROGRESS.md` and `docs/report-log/`, the test results, and the training results once A1 has run.
