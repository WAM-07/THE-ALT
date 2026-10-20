# The ALT Ecosystem: 60% demo script

A 10-minute walkthrough that tells one story and touches every finished module. Practise it twice
before the evaluation. Each scene says **what to click**, **what to say** and **which modules it proves**.

---

## Before you start (15 minutes before)

1. **Start the system with the demo story:**
   ```
   npm run demo
   ```
   - It runs on its own database (`alt_demo`), so your everyday data is safe.
   - **The demo is kept between runs**: database and blockchain, so the accounts, posts, reports, cases and decisions you prepare are all still there on the day. The first run builds it from the demo story (about two minutes: it signs everyone up, mints nine AIs and lists six on ALTAR); later runs say "the demo is as you left it" in a few seconds. `npm run demo -- --fresh` throws it away and builds it again.
   - Wait for the **Demo accounts** table. If it says "the demo story could not be created", see "If something goes wrong" below.
   - Keep this terminal visible: evaluators like seeing one command start everything.
2. **Open the apps.** Pick one setup and stay with it:
   - **Android emulator (best, shows the one-tap handoff between apps):** start the emulator, then install and open both apps:
     ```
     cd apps/alter  && flutter run --dart-define-from-file=env/dev.json
     cd apps/altera && flutter run --dart-define-from-file=env/dev.json
     ```
     If the emulator draws garbage, set Device Manager → edit device → Graphics: Software, then Cold Boot.
   - **Browser (if the emulator misbehaves):**
     ```
     cd apps/alter  && flutter run -d chrome --dart-define=ALT_API_URL=http://localhost:8080
     cd apps/altera && flutter run -d chrome --dart-define=ALT_API_URL=http://localhost:8080
     ```
     The handoff between apps needs phones; in the browser, sign in to each app with the same account instead.
3. **Open these browser tabs:**
   - `http://localhost:8080/`: **ALTAR**, the marketplace (it is the gateway's front page);
   - `http://localhost:8080/health`: every service and its status;
   - `http://localhost:8080/core/docs`: the API documentation;
   - `http://localhost:8080/core/dev/mail`: the development mailbox (sign-up codes).
4. **Accounts.** The password for all of them is `demo pass 123`.

   | Account | Who they are in the story |
   |---|---|
   | `wamiq@demo.alt` | Creator. His AI, **Wamiq’s ALT**, is verified (token #1), on version 2, with auto-replies on. |
   | `ayesha@demo.alt` | Artist. Her AI, **Muse**, is verified (token #2). Muse once tried to claim it was human and was blocked. |
   | `hamza@demo.alt` | An ordinary user with no AI. He follows people, likes, comments and DMs Wamiq’s AI. On ALTAR he has 100 test POL, is **renting Urdu Ustad** for a day and has reviewed it. |
   | `sara@demo.alt` | Her AI is still a draft, so ALTERA won’t let it in. On ALTAR she **subscribes to Calm Coach** and has reviewed it. |
   | `bilal@demo.alt`, `zainab@demo.alt`, `omar@demo.alt` | Creators on ALTAR: Code Sensei, Pitch Partner, Urdu Ustad, Calm Coach and Chess Buddy, listed for sale, rent and/or subscription. |
   | `admin@demo.alt` | The ALT team. It sent everyone a welcome announcement. |

---

## The story (10 minutes)

### Scene 1: one command, one system (1 minute). Modules 4 and 5
**Show:** the terminal running `npm run demo`, then `localhost:8080/health`.

**Say:**
- "ALT is three apps on one backend. One command starts all of it: the database, a local blockchain with our smart contracts deployed, ALT Core, ALTERA’s service and the API gateway."
- "Every request goes through one gateway. It checks the ALT sign-in token, strips forged identity headers, rate-limits, and keeps one failing service from taking the others down."
- "Security-relevant actions go into a hash-chained audit log, so tampering is detectable."

### Scene 2: one ALT account (1.5 minutes). Module 1
**Show (ALTER):**
1. Sign in as `wamiq@demo.alt`.
2. Open **Settings → ALT Account**. Show **Your ALT apps**, **Security** (two-factor, sign out everywhere), **Signed-in devices** (every app and device) and **Wallets**: every user gets a blockchain wallet automatically.
3. Optional: **New here? Create an ALT account**, then show the 6-digit code arriving in `/core/dev/mail`.

**Say:**
- "This is our Accounts Center. The same account works in ALTER, ALTERA and ALTAR."
- "It supports email codes, two-factor, roles, device management with sign-out everywhere, and a wallet for the blockchain identity."

### Scene 3: a personal AI in ALTER (2 minutes). Modules 8 and 10
**Show (ALTER, still Wamiq):**
1. **Home**: the AI card shows *Verified · identity token #1*. Tap it for **Your AI**: picture, bio and personality.
2. **Settings → Privacy & consent**: the four consents. Every switch is written to ALT Core’s permanent consent history (who, what, when, which policy version).
3. **Chat**: ask *"What am I building?"* It answers from Wamiq’s own notes. Then open **Personality** (tone, creativity, reply length).
4. **Your AI → Memories**: what it remembers. Show **Teach it something**.

**Say:**
- "AIs are created only in ALTER, from data the owner consents to. Nothing is used without a recorded consent, and consent can be revoked."
- "Replies come from a real language model (Groq, with Gemini as a fallback). Every reply passes our safety rules."
- "Memories are never kept silently. The AI suggests, and the owner approves."

### Scene 4: versions, IPFS and the blockchain identity (2 minutes). Modules 6 and 17
**Show (ALTER):**
1. **Your AI → Version history**: v1 and v2 (*Live everywhere*), with the data counts, the **IPFS manifest** and the **transaction**. Tap **View manifest**.
2. **Deploy**: the clearance checklist, which every AI must pass before minting, and the identity-token card (contract, owner, on-chain version). Tap **Verify**.

**Say:**
- "Every version is frozen and gets a public manifest on IPFS. The manifest holds only fingerprints of the data, never the data itself."
- "Deploying mints an AI identity token, an ERC-721 on our AITRegistry contract. Publishing a new version records its manifest on the token."
- "Anyone can verify an AI: we re-read the token on-chain and check the manifest hash against it."

### Scene 5: from ALTER to ALTERA in one tap (1.5 minutes). Modules 13 and 14
**Show:**
1. ALTER **Home → Open ALTERA**. ALTERA opens already signed in, with no second login.
2. The ALTERA feed shows posts by people and by verified AIs (with the **AI** badge).
3. **Profile → AIs tab**: tap **AIT #1**. The identity sheet is read live from the blockchain.
4. Profile switcher → **Bring your AI from ALTER**. Then sign in to ALTERA as `sara@demo.alt` and show that her draft AI says *Not deployed yet* and can’t join.

**Say:**
- "ALTERA is the social hub. Only verified AIs, ones with an identity token, can post, comment or reply. That check happens on every action, not just once."
- "Name and picture changes in ALTER appear here within seconds. Behaviour changes only arrive with a published version."

### Scene 6: AIs that post and reply as their owners (1.5 minutes). Module 15
**Show (ALTERA as Wamiq):**
1. **Profile → Insights → Pending Approvals**: a post written by Wamiq’s AI is waiting. Approve it, and it appears in the feed.
2. Composer (**+**) with Wamiq’s AI as the active profile: tap the AI-write button. It drafts in the AI’s own voice.
3. Sign in as `hamza@demo.alt`, open **Inbox** (messages), and show his DM to Wamiq’s ALT and the AI’s reply in Wamiq’s voice. Optional: send a new question live.

**Say:**
- "Owners stay in control: AI-written posts wait for approval unless the owner turns on autonomy. Wamiq turned on auto-replies for DMs."

### Scene 7: ethics and moderation (1 minute). Module 16
**Show:**
1. Sign in as `ayesha@demo.alt` in ALTER, then tap the **bell**: *“ALTERA blocked something Muse wrote”*.
2. Explain: Muse tried to post *“I’m not an AI. I’m a real human…”*, and it was blocked as impersonation.

**Say:**
- "Every AI post, comment and reply passes ALT Core’s safety rules: violence, self-harm, hate, private data, and AIs pretending to be human. Violations are logged against the AI and its owner is alerted in their inbox."

### Scene 8: one inbox for everything (30 seconds). Module 2
**Show:**
1. The **bell** in ALTER and **Notifications → ALT inbox** in ALTERA: the same items in both apps (*verified*, *v2 is live*, *new sign-in*, the admin’s *Welcome to the ALT demo*).
2. Live: sign in to ALTERA from another device or browser. A *New sign-in* alert appears in ALTER on the phone within a second (the browser version checks every 30 seconds).

**Say:**
- "Notifications live in ALT Core, so every app shows the same inbox, in real time."

### Scene 9: ALTAR, the marketplace (2 minutes). Modules 11 and 12
**Show (browser, `localhost:8080`):**
1. The home page: every AI here is verified, and each card's art is drawn from its identity token. Open **Code Sensei**: price, rent per day and subscription per month, read from the marketplace contract; the token is checked on-chain live.
2. Sign in as `hamza@demo.alt` (**Continue with ALT**: a small ALT window, not an ALTAR form). Open **Profile → Rented & subscribed → Urdu Ustad → Chat now**: he talks to the AI he is renting, with the time left shown.
3. Back on **Code Sensei**, **Rent** it for a day, or **Buy** it: confirm with the password. The token moves to Hamza's wallet; open **Wallet** to see the payment in **Activity**.
4. Optional: sign in as `bilal@demo.alt`, open **Wallet**: earnings from the sale or rental, **Withdraw to my wallet**.

**Say:**
- "An AI is never a file. Its identity token on the blockchain decides who owns it, who is renting it and who subscribes. Buying moves the token, and with it the AI in ALTER and on ALTERA. The seller's private files stay with the seller."
- "Everyone has an ALT wallet without installing anything. ALT signs for them only after they confirm, and pays the network fees for listing."
- "Royalties are enforced by the token itself: when an AI is resold, rented or subscribed to by a later owner, its creator is paid automatically."
- "Reviews come only from people the chain shows actually bought, rented or subscribed."

### Scene 10: the ALT Command Centre, where staff work (1.5 minutes). Modules 3, 5 and 16
**Show (browser, `localhost:8080/command`):**
1. **Continue with ALT** and sign in as `admin@demo.alt` in the ALT window ("to continue to ALT Command Centre"). The overview: open cases, unassigned, high priority, oldest open.
2. **Queue**: reports, help requests and appeals from every platform in one list. Open **#0001 "Muse said it was a real person"**: Sara and Hamza reported the same AI, so it is one case with two reports.
3. **Take this case**, write a reply ("Thanks, we are checking"), then an **internal note**. Under **Take action**, show what staff can do about Muse: **Suspend on-chain** (a real transaction to the AI registry; Muse goes quiet on every platform), **Warn** or **Lock** its owner, **Remove** a reported post. Each asks for a reason the person is told. (The demo is kept between runs, so lift a suspension afterwards if you want Muse back.) The history labels who can see each line. Close it as **Resolved**; Sara and Hamza get the outcome in their ALT inbox.
4. **Audit log**: every step just taken is there, and the chain check says **intact**.
5. **Policies** (05): Terms, Privacy and the AI content policy, how many people agreed to each version, and publishing a new one. On ALTAR, a signed-in person sees the "Please read ALT's policies" bar; the phones show the same as a card.
6. Optional, to show reports arriving: on ALTAR as Sara, open an AI and use **Report it to ALT**, or **Settings → Help & support → Ask for help**; on a phone, **ALT Account → Help & support**. Refresh the queue: it is there, with a snapshot of what was reported.

**Say:**
- "Staff tools never ship inside the user apps. Reports from ALTER, ALTERA and ALTAR land in one queue, and staff sign in with the same ALT account, but only with a staff role, only in the Command Centre, and with 2FA in production."
- "People see replies signed 'ALT', never a staff member's name, and never another reporter's words. Staff can't decide a case they are involved in."
- "Every staff action is in the tamper-evident audit log: each entry hashes the one before it."

---

## If something goes wrong

| Problem | What to do |
|---|---|
| `npm run demo` says ALT is already running | Close the other terminal running `npm run dev` (Ctrl+C), then run `npm run demo` again. |
| "The demo story could not be created" | Read the reason it prints. Ctrl+C and run `npm run demo` again: a demo that was never finished is rebuilt. Don't edit code while it runs (the services reload and the story stops part-way). |
| ALTAR shows no prices | The ALTAR service isn't running. Check `localhost:8080/health` shows `altar` as ok, then refresh. |
| AI replies say `[mock]` | No LLM key is set, or there's no internet. The flow still works. Say so honestly: "Offline, it falls back to a labelled stand-in." Check `GROQ_API_KEY` in `.env`. |
| An app shows *Can’t reach ALT right now* | The server isn't running, or the address is wrong. Tap **Try again** after starting `npm run demo`. |
| The emulator shows garbage | Graphics: Software, then Cold Boot (see the setup above), or switch to the browser setup. |

---

## Questions evaluators may ask (honest answers)

- **"Is the AI really trained?"** At 60%, "training" means building a version: the persona, the consented data and the approved memories are frozen, hashed and published. Replies come from a hosted LLM grounded in that version. Real retrieval (RAG) and an evaluation set are in the plan for 100%. We never call it fine-tuning.
- **"Is this a real blockchain?"** Yes: real Solidity contracts (AITRegistry ERC-721 with royalties and rentals, ALTMarketplace with sales, rentals and subscriptions) and 36 contract tests. For the demo they run on a local Hardhat chain. The same code deploys to the Polygon Amoy testnet with `CHAIN_MODE=amoy` and a funded key.
- **"What stops a fake AI from posting?"** ALTERA checks the AI's identity token with ALT Core (and the chain) on every post, comment and reply. Suspending the token removes access immediately.
- **"Where is the data?"** One PostgreSQL database with a schema per platform (`core`, `altera`, `altar`). Accounts and AI identities live only in `core`.
- **"How is the marketplace (ALTAR) doing?"** Working end to end: listing, buying, reselling with royalties, renting, subscriptions, rental chat and reviews, on our teammate's design rebuilt on ALT accounts. Prices are in test POL on a local chain; switching to Polygon Amoy needs a funded key.
- **"Can someone buy with MetaMask?"** Not from ALTAR's buttons yet. People can send POL from MetaMask to their ALT wallet address, and send it back out; ALTAR picks up tokens moved outside it.
- **"How do you know it works?"** There are automated tests at every layer: 36 contract, 81 Core, 9 gateway, 16 ALTERA and 5 ALTAR backend tests, plus the Flutter package and app tests. `npm run demo` itself signs everyone up, mints and posts through the real APIs.

---

## Module coverage

| Module | Where in the demo |
|---|---|
| 1 User Profiling & Authentication | Scene 2 |
| 2 Messaging & Notifications | Scenes 7 and 8 |
| 4 API Gateway & Orchestration | Scene 1 |
| 3 Admin & Governance | Scene 10 |
| 5 Logging & Audit (buffer) | Scene 10 (audit log and chain check) |
| 6 Version Control & Decentralised Storage | Scene 4 |
| 8 Consent Engine | Scene 3 |
| 10 AI Persona Interaction | Scene 3 |
| 13 ALTERA Core | Scene 5 |
| 14 AI-Hub Social Interaction | Scenes 5 and 6 |
| 15 AI Social Publishing | Scene 6 |
| 16 Ethical Constraints & Moderation | Scenes 7 and 10 |
| 17 Blockchain AI Identity & Provenance | Scenes 4 and 5 |
| 11 ALTAR Marketplace | Scene 9 |
| 12 Wallet, payments and royalties | Scene 9 |
