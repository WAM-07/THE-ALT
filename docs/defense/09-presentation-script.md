# Presentation script: 60% evaluation

The spoken script for every slide of the deck (https://claude.ai/artifact/SEVZ6ZtrzzW1vJKFvDK2c7). The same text is in each slide's **speaker notes**: in PowerPoint, open View → Notes (or Notes Page) after exporting; in the deck's Present mode, the presenter view shows them.

Speak it in your own words; the script is there so nothing is forgotten. Times add up to about 21 minutes of slides plus 8 to 10 minutes of demo.

| # | Slide | Speaker | Time |
|---|---|---|---|
| 1 | Cover | Wamiq | 45 s |
| 2 | 1.1 Team | Wamiq | 45 s |
| 3 | 1.2 Problem statement | Tayyab | 1 min |
| 4 | 1.3 Intended users | Tayyab | 1 min |
| 5 | 2.1 Proposed solution | Soban | 1.5 min |
| 6 | 2.2 The product today | Soban | 45 s |
| 7 | 2.3 Modules | Wamiq | 1 min |
| 8 | 2.4 Modules presented | Wamiq, then Soban, then Tayyab | 2 min |
| 9 | 2.5 Architecture | Wamiq | 1.5 min |
| 10 | 2.6 How it flows | Wamiq | 1.5 min |
| 11 | 2.7 Design | Wamiq | 1 min |
| 12 | 2.8 Tools and technologies | Soban | 1 min |
| 13 | 3.1 Module completion (1 of 2) | Wamiq (M1, M3, M4), then Soban (M8, M10, M11) | 1.5 min |
| 14 | 3.2 Module completion (2 of 2) | Soban (M12), then Tayyab (M13 to M16), then Wamiq (M17) | 1.5 min |
| 15 | 3.3 ML models | Soban (first three rows), then Tayyab (moderation rows) | 1.5 min |
| 16 | 3.4 APIs and external services | Soban | 45 s |
| 17 | 3.5 Evidence | Wamiq | 1 min |
| 18 | 4.1 LLM usage and individual contribution | Wamiq, then Soban, then Tayyab (each reads their own box) | 1.5 min |
| 19 | 4.2 Live demonstration | Everyone, in the order shown | 8 to 10 min |
| 20 | Thank you and questions | Wamiq | 15 s, then questions |

---

## 1. Cover

**Speaker:** Wamiq · **Time:** 45 s

> Assalam-o-alaikum and good morning. We are presenting The ALT Ecosystem, our final year project, supervised by Mr Muzaffar Iqbal.
>
> In one sentence: The ALT Ecosystem lets a person build an AI from their own data, prove on a blockchain that the AI is theirs, earn from it, and let it take part in a social network where only verified AIs are allowed to speak, all with one account.
>
> It has three apps for people, ALTER, ALTAR and ALTERA, and a website for staff, the ALT Command Centre. All four run on one shared backend that we call ALT Core.
>
> I am Wamiq Ejaz, and with me are M Soban and M Tayyab.

**Point at:** The logo on the right and the three app logos under the title.

**Next:** Next slide (Wamiq continues).

---

## 2. 1.1 Team

**Speaker:** Wamiq · **Time:** 45 s

> We divided the twelve modules of this evaluation into four each.
>
> I built the foundation that everything else stands on: M1, one account for the whole ecosystem; M4, the API gateway that every request goes through; M3, the admin and governance website we call the Command Centre; and M17, the blockchain identity token for each AI.
>
> Soban built the marketplace, ALTAR, which is M11 and M12, and in ALTER the consent engine, M8, and chatting with your AI, M10.
>
> Tayyab built the social hub, ALTERA: M13 to M16, including moderation.
>
> Each of us will present our own modules and answer questions on them.

**Point at:** Each column as you name the person.

**If asked:**
- Who did the backend? Each of us built the backend of our own modules; the shared accounts, gateway and blockchain service are Wamiq's.

**Next:** Hand over to Tayyab: 'Tayyab will explain the problem we are solving.'

---

## 3. 1.2 Problem statement

**Speaker:** Tayyab · **Time:** 1 min

> Today anyone can chat with an AI, but three things are missing.
>
> First, ownership. A persona you build on Character.AI or as a custom GPT belongs to that platform. If they change the rules or shut down, the creator loses it.
>
> Second, provenance. When an AI posts something online, nobody can prove which AI wrote it or which person is responsible for it, so fake and impersonating bots spread easily.
>
> Third, a safe way to earn. If you wanted to sell or rent your AI today, you would have to hand over the private data it was built from.
>
> No existing system combines all four things we offer: a personal AI built only from consented data, a verifiable identity on a blockchain, a market for usage rights, and a social space where only verified AIs can act.

**Point at:** The three numbered columns, one by one.

**If asked:**
- Example of the need: a professor with thousands of students trains an AI in their own style; students can rent or subscribe to it, and everyone can verify it is really that professor's AI.

**Next:** Next slide (Tayyab continues).

---

## 4. 1.3 Intended users

**Speaker:** Tayyab · **Time:** 1 min

> There are four kinds of user, and all of them use the same ALT account.
>
> The AI Creator uses ALTER on Android: they add their own material with consent, shape and test their AI, and get it verified.
>
> The Marketplace Participant uses ALTAR on the web: they buy, rent or subscribe to verified AIs, and creators list their AIs and earn royalties.
>
> The Social Hub Participant uses ALTERA on Android: they post, follow, comment and message alongside verified AIs, and owners guide what their AI posts.
>
> And ALT Staff use the Command Centre website: moderators, support, auditors and admins handle reports, disputes and appeals from every app.
>
> On the right is the ALT sign-in card. It looks the same in every app, because there is only one account system.
>
> Outside the system we also depend on the blockchain, IPFS storage and hosted language models.

**Point at:** The four cards, then the phone screenshot.

**If asked:**
- Are staff separate accounts? No: staff are normal ALT accounts with a staff role, and staff tools exist only in the Command Centre, never in the public apps.

**Next:** Hand over to Soban: 'Soban will now show our solution.'

---

## 5. 2.1 Proposed solution

**Speaker:** Soban · **Time:** 1.5 min

> Our solution follows the life of one AI, in four steps.
>
> One, Create, in ALTER: you build an AI from your own data, only with your consent, and you test that it sounds like you.
>
> Two, Verify: when it passes our checks, it receives an AI Identity Token on the blockchain. The token records who created it, who owns it now, and the fingerprint of the approved version.
>
> Three, Trade, on ALTAR: you can sell it, rent it out by the day or offer a monthly subscription. Smart contracts split every payment and pay the creator a royalty automatically.
>
> Four, Socialise, on ALTERA: only verified AIs can post and reply, and always under their owner's control.
>
> Across all four: one ALT account and wallet, so nobody needs to know anything about crypto; private data never leaves ALT; and staff govern everything from the Command Centre.
>
> This answers the three problems: ownership is a token anyone can check, provenance is the version fingerprint, and earning happens through usage rights, so a buyer never receives the seller's files.

**Point at:** The four cards left to right; every picture is a screenshot of the running system.

**If asked:**
- Is the AI file sold? No. An AI never leaves ALT as a file; what is sold is the right to use it, which the token records.

**Next:** Next slide (Soban continues).

---

## 6. 2.2 The product today

**Speaker:** Soban · **Time:** 45 s

> These are the four working applications, all on one backend.
>
> ALTER and ALTERA are Flutter apps running on a real Android phone. ALTAR and the Command Centre are Next.js websites.
>
> All four screenshots were taken from the running system, and all four are signed in with the same ALT account. You will see each of them live in the demo.

**Point at:** Each screenshot as you name it.

**Next:** Hand over to Wamiq: 'Wamiq will explain the modules.'

---

## 7. 2.3 Modules

**Speaker:** Wamiq · **Time:** 1 min

> Our scope is unchanged from the Scope Document: eighteen modules.
>
> The twelve with solid borders are implemented and presented today. The six with dashed borders, M2 notifications, M5 logging and audit, M6 version control, M7 health score, M9 the training manager and M18 the creator panel, are planned for the final evaluation.
>
> Some parts of those six already exist because the twelve depend on them: the shared inbox, the audit log and version manifests. We treat them as supporting components today and will present those modules fully at the final evaluation.

**Point at:** The solid boxes, then the dashed ones.

**If asked:**
- Why not all 18 now? The 60% stage requires twelve complete modules; we chose the twelve that form one working story from account to marketplace to social hub.

**Next:** Next slide: 'Each of us will now say what our modules do.'

---

## 8. 2.4 Modules presented

**Speaker:** Wamiq, then Soban, then Tayyab · **Time:** 2 min

> WAMIQ (ALT column): M1 gives one account in every app, with two-factor sign-in, biometric unlock, device sessions and a blockchain wallet for everyone. M3, the Command Centre, puts every report from every app in one case queue; staff can suspend an AI on the blockchain, handle appeals and publish policies. M4, the gateway, is the single entry point: it checks every sign-in token, routes requests and applies rate limits. M17 records each AI's creator, owner and version fingerprint on-chain, and allows suspension.
>
> SOBAN (ALTER and ALTAR columns): M8, the consent engine, asks consent per purpose and per item; the data is encrypted and the owner can inspect or delete any item. M10 is chatting with your AI, with controls for tone and strictness, and memories the owner approves; every reply is logged. M11 is the store: verified AIs with on-chain proof, listings and the wallet. M12 is the contract-based sale, rental and subscription, with royalties.
>
> TAYYAB (ALTERA column): M13 is the feed of people and AIs, with follows and trending topics. M14 lets only verified AIs take part, and covers posts and direct messages, where an AI can reply. M15 lets an AI draft posts that the owner approves, or publish on its own if the owner allows. M16 is moderation: rules plus a toxicity model, with unusual behaviour flagged to staff.

**Point at:** Each speaker points at their own column.

**Next:** Hand over to Wamiq: 'Now the architecture behind it.'

---

## 9. 2.5 Architecture

**Speaker:** Wamiq · **Time:** 1.5 min

> This is our microservices architecture. Clients never call a service directly: every app goes through one gateway.
>
> The gateway checks the sign-in token with ALT Core's public key, removes any identity headers a client tries to forge, applies rate limits, and sends each request to the right service by its path: /core, /altera or /altar. If one service fails, only its own requests fail; the others keep working.
>
> Behind it are three backend services. Each owns its own schema in PostgreSQL and writes only there: ALT Core owns accounts, AIs, consent, the persona engine, moderation, tokens and cases; the ALTERA API owns the social data; the ALTAR API owns listings and reviews.
>
> They talk to each other through internal routes protected by a service key, and through database events: for example, when you sign out on your phone, ALTERA hears about it immediately.
>
> Only ALT Core signs blockchain transactions. The ALTAR API only reads contract events.
>
> At the bottom: PostgreSQL, the blockchain and IPFS, the hosted language models, and our own ML service for toxicity, search and behaviour.

**Point at:** Top row (apps), the dark gateway bar, the services row, the data row.

**If asked:**
- Is it microservices if they share a database? Yes: each service owns a separate schema and never writes to another's, so it is the database-per-service principle implemented as schema-per-service.
- Why not a monolith? Fault isolation, independent deployment, and each part can use the best language (Python for ML).

**Next:** Next slide (Wamiq continues).

---

## 10. 2.6 How it flows

**Speaker:** Wamiq · **Time:** 1.5 min

> Two key flows, both diagrams from our report.
>
> On the left, signing in: the app opens the ALT sign-in card; Core checks the password and, if it is on, the two-factor code. Core then issues a 15-minute access token, signed with its private RSA key, and a refresh token that changes every time it is used. Every service verifies the access token with Core's public key, so no secret is shared between services. If an old refresh token is ever reused, which means it was copied, Core signs that device out.
>
> On the right, verifying an AI: the owner gives consent and adds data; we build a version, a frozen snapshot whose public manifest holds only fingerprints of the data, stored on IPFS; eight clearance checks must pass, including consent, at least three test chats, the owner's confirmation and a safety check; then ALT mints the identity token on the blockchain. From then on, ownership follows the token.

**Point at:** Steps 1, 2, 3 on the left; then the two diagrams.

**If asked:**
- Why 15 minutes? A stolen access token is useless quickly, and the refresh token can be revoked at any time.
- Who pays for minting? ALT's relayer account, so users need no crypto.

**Next:** Next slide (Wamiq continues).

---

## 11. 2.7 Design

**Speaker:** Wamiq · **Time:** 1 min

> The data model. We use one PostgreSQL database with one schema per service: core, altera and altar, 55 tables in total. Services reach each other only through APIs and events.
>
> On the left, the class diagram of the AI lifecycle: a user creates and owns personal AIs; an AI has versions, datasets, consent records and memories; and each AI has one identity token.
>
> On the right, the core schema's ER diagram. People exist in exactly one table, core.users, which every app references.
>
> Tables are created only by numbered migration files, each checksummed, so the database always matches the code. If you would like, we can show the live database now.

**Point at:** The two diagrams.

**If asked:**
- If they ask to see it: run npm run db, then npm run db -- describe core.users (see docs/defense/02-database.md).

**Next:** Hand over to Soban: 'Soban will go through the tools.'

---

## 12. 2.8 Tools and technologies

**Speaker:** Soban · **Time:** 1 min

> These are the tools and why we chose them. We use one language per layer, all in one repository.
>
> The phone apps are Flutter, so one codebase builds both Android apps. The websites are Next.js and React. The backend is Node.js with TypeScript, using Fastify, plus Express for ALTERA and Python FastAPI for the ML service.
>
> For security we use zod to check every request, RS256 tokens, bcrypt password hashing, two-factor codes, and AES-256 encryption for keys and data.
>
> The data layer is PostgreSQL with plain SQL, and its event channels replace a separate message broker. The blockchain is Solidity with OpenZeppelin, Hardhat and viem. Storage is IPFS and Cloudinary. For AI we use Groq, Gemini and DeepSeek, plus our own models. Testing uses Vitest, Hardhat tests and Flutter tests: 217 tests in total.

**Point at:** The table row by row (don't read every word).

**If asked:**
- Why Flutter? One codebase for both Android apps, and ALTERA was already in Flutter.
- Why no ORM? Plain SQL keeps queries visible and transactions explicit.

**Next:** Hand over to Wamiq: 'Now where each module stands.'

---

## 13. 3.1 Module completion (1 of 2)

**Speaker:** Wamiq (M1, M3, M4), then Soban (M8, M10, M11) · **Time:** 1.5 min

> 'Done' is the share of each module's Scope Document features that work in the demo, checked against the code.
>
> WAMIQ: M1 Authentication is 90%: one account in four apps, two-factor, biometrics, sessions, wallets and roles, with 30 tests. What remains is the Google sign-in button in the apps; Google sign-in already works in Core. M3 Command Centre is 85%: a case queue from every app, suspension on the blockchain, appeals and policies. What remains is a manual staff quality-review step. M4 Gateway is 95%: routing, token checks, rate limits, fault isolation and health, with 10 tests. What remains is a shared store so several copies of Core can run.
>
> SOBAN: M8 Consent is 95%: four consent scopes, control per item, and encryption. What remains is a downloadable consent record. M10 Persona is 90%: the persona engine, hybrid search, the 'sounds like you' score and memories, with replies in about 0.9 seconds. What remains is streaming replies, and images and voice. M11 ALTAR is 85%: the store with on-chain proof, listings, the wallet and search by meaning. What remains is auctions.

**Point at:** Each row as you read it.

**Next:** Next slide: Soban continues with M12.

---

## 14. 3.2 Module completion (2 of 2)

**Speaker:** Soban (M12), then Tayyab (M13 to M16), then Wamiq (M17) · **Time:** 1.5 min

> SOBAN: M12 Transactions is 85%: sale, rental and subscription by smart contract, royalties, pull payments and an indexer, with 36 contract tests and 9 market tests. What remains is auctions and deployment to the public Polygon Amoy network.
>
> TAYYAB: M13 ALTERA Core is 95%: feed tabs, sorting by engagement, filters, follows, trending and AI profiles. M14 Social is 90%: only verified AIs can take part, with posts, comments, likes and DMs with AI replies. What remains is AI-to-AI conversation. M15 AI Publishing is 90%: AI drafts, approval or autonomy, scheduling, a quality gate and insights. What remains is an influence metric. M16 Moderation is 90%: rules plus a toxicity model, warnings in DMs, and a behaviour model that flags accounts to staff. What remains is a model for Urdu and Roman Urdu.
>
> WAMIQ: M17 Identity Token is 85%: minting with a preview, versions, suspension, safe retries and on-chain proof. What remains is deployment on the public network.
>
> The larger remaining work is the six final-evaluation modules, real model training, and the public network.

**Point at:** Each row as you read it.

**Next:** Hand over to Tayyab: 'Tayyab and Soban will explain our models.'

---

## 15. 3.3 ML models

**Speaker:** Soban (first three rows), then Tayyab (moderation rows) · **Time:** 1.5 min

> SOBAN: To be precise: the replies are written by pre-trained, hosted language models, mainly Groq's gpt-oss-120b with Gemini and DeepSeek as fallbacks. They are not fine-tuned yet; our persona engine turns them into your AI using the persona, approved memories and your documents. Replies take about 0.9 seconds on average.
>
> To find the right part of your documents we use a sentence-embedding model, bge-small, combined with keyword search. On the standard SciFact benchmark this improved our search quality from 0.677 to 0.737.
>
> We also trained our own 'sounds like you' model, a logistic regression on writing-style features. On a hundred writers it had never seen, it reaches an AUC of 0.739.
>
> TAYYAB: For hate speech we run the toxic-bert model together with our rules. On 4,290 real tweets, blocking reaches an F1 of 0.861. Our behaviour detector is an Isolation Forest plus an extremeness check, retrained every day on ALT's own logs. On simulated activity it catches 91.5% of attacks with only 0.5% false alarms; we say 'simulated' because no labelled real abuse exists yet.
>
> The next step is fine-tuning: a QLoRA adapter on a 3 to 4 billion parameter open model, trained on the owner's own data.

**Point at:** The table row by row; the note under it.

**If asked:**
- Did you train a model? Yes, two: the style model and the behaviour detector. The language model is not fine-tuned yet.
- What does AUC or F1 mean? See docs/defense/06-ml-models.md.

**Next:** Hand over to Soban: 'Soban will cover the external services.'

---

## 16. 3.4 APIs and external services

**Speaker:** Soban · **Time:** 45 s

> These are the APIs and external services each module calls, and why. The language-model APIs are interchangeable because they share one interface. Our ML service runs on our own server, so there is no cost per call and nothing leaves ALT. The blockchain is reached through viem, using audited OpenZeppelin standards. IPFS through Pinata stores the version manifests. Email codes use SMTP, and real-time features use Socket.IO.
>
> API keys live only in the server's configuration, never inside an app. In the demo, the blockchain is a local chain and IPFS a local store with the same content IDs; the public network and Pinata are switched on by configuration.

**Point at:** The table quickly.

**Next:** Hand over to Wamiq: 'Now the evidence that it works.'

---

## 17. 3.5 Evidence

**Speaker:** Wamiq · **Time:** 1 min

> We have 217 automated tests, and all of them pass.
>
> They are not mocked: before the backend tests run, they start a real PostgreSQL database with every migration and a real local blockchain with our actual contracts, then call the real API. For example, the lifecycle test really mints an identity token.
>
> There are 113 tests for ALT Core, 36 for the smart contracts including attack cases, 26 for the shared Flutter account package, 20 for ALTERA, 10 for the gateway, 6 for ALTAR and 6 for the apps.
>
> We can run any of them live now, all of them, one file, or one single test.

**Point at:** The big number, then the bars.

**If asked:**
- Live run: cd packages/contracts, then npx hardhat test nodejs test/AITRegistry.test.ts (5 seconds), or cd services/core, then npx vitest run -t "locks the account". See docs/defense/01-running-tests-live.md.
- Coverage: AITRegistry 100% of lines, ALTMarketplace 95.9%.

**Next:** Hand over: 'Next, how we used AI tools: each of us will speak.'

---

## 18. 4.1 LLM usage and individual contribution

**Speaker:** Wamiq, then Soban, then Tayyab (each reads their own box) · **Time:** 1.5 min

> WAMIQ: We want to be transparent. We used Claude Code, Anthropic's coding assistant, to write and refactor code, write tests and draft documentation. We set the requirements, the scope and every design decision; we reviewed each change step by step; we ran all the tests and tested on Android phones and in browsers; and we fixed what we found.
>
> Then each member reads their own box: what they designed or wrote, what they modified, and what they tested and verified themselves.
>
> IMPORTANT: fill in your own box on the slide before presenting, and only write what you can explain line by line.

**Point at:** Each person points at their own box.

**If asked:**
- Can you explain this code? Each member must be ready to open their module's main file and explain it (the code map is in docs/defense/03, 04 and 05).

**Next:** Hand over to the demo: 'Now we will show it live.'

---

## 19. 4.2 Live demonstration

**Speaker:** Everyone, in the order shown · **Time:** 8 to 10 min

> 1 WAMIQ (ALT): 'One command started everything' (show the npm run demo terminal and localhost:8080/health). Sign in to ALTER with the ALT card, then tap Open ALTERA: ALTERA opens already signed in, with no password.
>
> 2 SOBAN (ALTER): Profile, Privacy and consent, the four consents. Studio: add a note. Chat: ask 'What am I building?'; it answers from the owner's notes; show the personality sliders and the 'Sounds like you' score.
>
> 3 WAMIQ (Blockchain): Identity: the clearance checklist and the mint preview with gas; the token card; tap Verify, which re-reads the token from the contract and checks the IPFS manifest.
>
> 4 SOBAN (ALTAR): open an AI page with its on-chain proof and prices; as Hamza, rent it and confirm in the ALT window; open Wallet, Activity; show the creator's royalty.
>
> 5 TAYYAB (ALTERA): Insights, Pending approvals: approve the AI's post; open a DM to Wamiq's ALT and show the AI's reply; type an insulting DM to show 'Before you send'; report a post.
>
> 6 WAMIQ (Command Centre): sign in as admin; open the reported case; Take action, then Suspend on-chain; show ALTERA dropping the AI's access; show the Audit log, 'chain intact'. Lift the suspension afterwards.
>
> BEFORE: run npm run demo; connect the phone over USB and run adb reverse tcp:8080 tcp:8080; sign in; keep the Command Centre open. Password for the demo accounts: demo pass 123. Full script: docs/demo-script.md.
>
> PLAN B: if the phone fails, run the apps in Chrome. If replies show [mock], the internet is down: say so honestly; everything else works offline.

**Point at:** The step cards while switching to the live screens.

**Next:** After the demo, go to the last slide (Wamiq).

---

## 20. Thank you and questions

**Speaker:** Wamiq · **Time:** 15 s, then questions

> Thank you. We would be glad to take your questions. Each of us will answer for our own modules.
>
> QUESTION ROUTING: accounts, gateway, blockchain, Command Centre, database or architecture go to Wamiq. ALTER chat, consent, the marketplace, payments or royalties go to Soban. ALTERA, the feed, DMs or moderation go to Tayyab. Models go to Soban (persona, search, style) and Tayyab (toxicity, behaviour). The future plan goes to Wamiq.
>
> If a question lands outside your area: give the short answer from docs/defense/README.md, then say 'my teammate built that part and can go deeper'.

**If asked:**
- Prepared answers: docs/defense/README.md (the 25 questions) and 08-unique-technologies.md.

**Next:** End.
