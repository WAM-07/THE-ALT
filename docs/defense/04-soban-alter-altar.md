# Soban: the personal AI (ALTER) and the marketplace (ALTAR)

Your modules: **M8** Consent Engine, **M10** AI Persona Interaction (both in ALTER, the Flutter app where an AI is
born), **M11** ALTAR Core Engine and **M12** Transactions, Usage Rights and Royalties (ALTAR, the Next.js
marketplace). You built on the original ALTAR design from the 30% stage; its look was kept and rebuilt on ALT
accounts, ALT Core and real smart contracts.

Also read: `06-ml-models.md` (the language models, semantic search and "sounds like you" belong to M10), and the
blockchain part of `08-unique-technologies.md` (M12 runs on the marketplace contract).

---

## The pieces you own

| Piece | Where | What |
|---|---|---|
| ALTER app | `apps/alter` (Flutter, Riverpod, go_router) | Onboarding, consent, Studio (data), Chat, Memories, Versions, Identity |
| AI routes in ALT Core | `services/core/src/http/routes/ais.ts`, `conversations.ts` | Create AI, consents, data items, memories, chat, versions |
| Persona engine | `services/core/src/modules/ai/engine.ts`, `persona.ts`, `llm.ts`, `repo.ts`, `semantic.ts`, `style.ts` | The one place that makes any AI speak |
| ALTAR web | `apps/altar-web` (Next.js 16, React 19, Tailwind 4) | Store, AI pages, buy/rent/subscribe, wallet, list an AI, chat, reviews, profile, help |
| ALTAR API | `services/altar-api` (TypeScript, Fastify, schema `altar`) | Listings, transaction history (from chain events), reviews, wishlist, royalties |
| Wallet and market routes in Core | `services/core/src/http/routes/wallet.ts`, `modules/market/*` | ALT signs for the custodial wallet after the person confirms |
| Marketplace contract | `packages/contracts/contracts/ALTMarketplace.sol` | Sales, rentals, subscriptions, royalties, pull payments |

---

## M8: Consent Engine

### Feature status

| FE | Status | How |
|---|---|---|
| FE-1 Collect text, documents, preferences, interaction data | ✅ | Text notes, file uploads (PDF read; images and voice stored), personality preferences, chat memories |
| FE-2 Explicit consent before data is used | ✅ | Four consent scopes, enforced by the server (`CONSENT_REQUIRED`) |
| FE-3 Inspect, modify, revoke, delete data | ✅ | Studio: read an item (even a PDF's extracted text), include/exclude, delete for good |
| FE-4 Delete or update items with transparency | ✅ | Every change audited; deletion removes the encrypted file |
| FE-5 Only approved data used | ✅ | Only `included`, not-deleted items with real text, and only **approved** memories, go into a version |

### The four consents (`modules/ai/repo.ts`, policy version `2026-10-v1`)

| Scope | What the person agrees to (the exact text shown) | Enforced where |
|---|---|---|
| `persona_training` | "Use the information and files I add to build my personal AI." | Adding data, building a version |
| `third_party_processing` | "Send my messages and the relevant parts of my data to an external AI provider (Groq) to generate my AI's replies." | The persona engine refuses to call an external LLM without it |
| `public_deployment` | "When I choose to deploy my AI, it may appear on ALTERA and ALTAR under its own identity token." | Clearance before minting; serving the AI to other platforms |
| `interaction_learning` | "My AI may suggest things to remember from our chats; nothing is kept unless I approve it." | Memory suggestions |

### Flow 8.1: Giving or withdrawing consent
1. ALTER onboarding (or Profile → Privacy & consent) → `PUT /core/ais/:id/consents/:scope {granted}`.
2. Core **appends** a row to `core.consent_events`: who, which AI, scope, granted true/false, **policy version**, IP,
   time. Nothing is ever updated or deleted: the history is the proof.
3. The current state = the latest event per scope (`SELECT DISTINCT ON (scope) … ORDER BY scope, id DESC`).
4. `GET /core/ais/:id/consents` shows the state and when it was given.
Why append-only: if a regulator or the person asks "did I agree to this on 12 October?", the answer is a row.

### Flow 8.2: Adding data
1. Studio → add a note (`POST /ais/:id/datasets`, up to 200,000 characters) or upload a file
   (`POST /ais/:id/datasets/upload`, up to **10 MB**). Both first check `persona_training` consent.
2. The kind is decided from the file type: text, document (PDF etc.), image or voice.
3. The bytes are **encrypted with AES-256-GCM** and written to `.data/uploads/datasets/<id>.enc`. The database row
   (`core.datasets`) keeps the title, kind, size, **SHA-256** fingerprint, category and flags, never the content.
4. **PDFs are read once at upload** (the `unpdf` library): the extracted text is stored encrypted beside the file
   (`<id>.txt.enc`) and its length in `text_chars`. Images and voice notes are stored but not read (honest: not yet).
5. With the ML service on, the item's passages are embedded in the background for semantic search (vectors only).
6. Audit `dataset.added`.

### Flow 8.3: Inspect, include/exclude, delete
- `GET /ais/:id/datasets/:datasetId/content` (`?as=text` for a PDF's extracted text): the owner reads exactly what
  the AI reads.
- `PATCH …/datasets/:datasetId {included}`: an excluded item stays stored but is left out of the next version.
- `DELETE …/datasets/:datasetId`: marks it deleted, removes the **encrypted file and its text** from disk, audits
  `dataset.deleted`. The next version no longer contains it, and retrieval stops using it at once (only items that
  are not deleted and are included are ever read).
- **The seller's private files stay with the seller:** item routes show, change or delete only items **the caller
  added**, so a buyer of the AI never sees the original owner's files (test: market test).

### Flow 8.4: Memories (approved learning)
1. In chat, "remember that I teach at COMSATS" → Core proposes a memory (only with `interaction_learning`).
2. ALTER shows it; the owner approves or discards (`PATCH /ais/:id/memories/:id {status}`), or teaches one directly
   (`POST /ais/:id/memories`).
3. Only `approved` memories enter prompts and versions.

### M8 counter-questions

| Question | Answer |
|---|---|
| Why four separate consents and not one checkbox? | Different uses have different risks: building the AI from your data, sending text to an outside provider, appearing publicly, learning from chats. A person can say yes to some and no to others, and the system enforces each one separately. |
| Can consent be withdrawn after the AI is published? | Yes. Withdrawing `third_party_processing` stops replies through the external model; withdrawing `persona_training` stops new versions with that data. Published versions are immutable records of what was agreed at the time; you can delete items and publish a new version without them. |
| Where is the data physically? | On ALT's server disk, encrypted (AES-256-GCM, key in the server's configuration). Never on IPFS or the blockchain: only hashes go there. |
| Does the external provider keep our data? | We send only what one reply needs (persona, approved memories, the relevant passages, the recent messages), and the person consented to exactly that (`third_party_processing`, which names the provider). What the provider does with it is governed by its API terms, which is why consent is explicit and can be withdrawn. In the fine-tuning phase the model runs on our own servers, so nothing leaves ALT (see `07`). |
| Why hash every item? | The version manifest lists each item's SHA-256, so anyone can later prove which data a version was built from without seeing the data. |

---

## M10: AI Persona Interaction

### Feature status

| FE | Status | How |
|---|---|---|
| FE-1 Real-time chat with personality-specific replies | ✅ | ALTER Chat; a real LLM (Groq gpt-oss-120b, Gemini fallback); ~865 ms average reply |
| FE-2 Customise tone, behaviour, strictness, creativity | ✅ | Personality sliders: tone, creativity, strictness, reply length; plus traits, interests, boundaries, languages |
| FE-3 AI-assisted tasks and content generation | ✅ | Drafting posts and comments on ALTERA, writing help |
| FE-4 Logs interactions for performance and safety | ✅ | `core.interaction_log` for every reply (model, latency, flagged) |
| FE-5 Fine-tune/retrain with more data | 🟡 | New data + new version = retrain of the persona/knowledge; **weight fine-tuning is the next phase** (QLoRA, `07`) |
| FE-6 Multi-session memory continuity | ✅ | Approved memories + saved conversations; the same conversation continues in ALTER, ALTERA and ALTAR |

### Flow 10.1: One chat message, end to end
1. ALTER Chat → `POST /core/ais/:id/chat/sessions/:sessionId/messages {content, version: 'draft'|'current'}`
   (Draft = the owner's work in progress; Live = the published version others see).
2. Core checks the person's message with the safety check (rules + toxicity model when the ML service runs).
3. `respond()` in `modules/ai/engine.ts` (**the persona engine**, the only place any AI speaks):
   1. **Which version:** draft config, or the published version's frozen persona, memories and data (only verified
      AIs can use `current`).
   2. **Consent:** refuses an external provider without `third_party_processing`.
   3. **Loads** the approved memories and the readable data items.
   4. **Retrieval:** finds the most relevant passages of the owner's documents for the question: **hybrid search**
      (meaning from the embedding model + BM25 word scores); everything is sent when the notes are short.
   5. **Builds one system prompt** (`buildSystemPrompt`): "You are <name> (@handle), the personal AI of <owner>…
      You are an AI, not a human. If asked, say so plainly." + about, pronouns, roles, traits, interests, tone,
      reply length, the strictness rule, languages, approved memories, relevant notes, **boundaries** (the owner's +
      "never share private data", "refuse hateful, violent, sexual or illegal requests"), the owner's extra
      instructions, and the **channel's rules** (e.g. ALTERA post: "at most 600 characters, up to 3 hashtags").
   6. **Calls the LLM** with the last 12 messages, temperature from creativity, max length from verbosity.
   7. **Moderates the reply** (rules + toxicity model). A blocked reply is replaced by a safe message; for a live
      AI it also becomes a flag case for staff (one open case per AI; only the AI's reply is kept as evidence).
   8. **Logs** the interaction (`core.interaction_log`).
4. Core saves both messages, may propose a memory ("remember that…"), and adds the **"Sounds like you · N%"** score
   (style-match model) once the owner has written enough.

### How the sliders change behaviour (`persona.ts`)

| Setting | Effect |
|---|---|
| Creativity 0–1 | Sampling temperature = 0.2 + 0.9 × creativity (0.2 = predictable, 1.1 = imaginative) |
| Strictness ≥ 0.7 | "Only state facts you were given or are confident about; say when you do not know." |
| Strictness ≤ 0.3 | "You may speculate and improvise, but mark guesses as guesses." |
| Reply length | short 180 / medium 450 / long 900 tokens maximum, and an instruction to match |
| Tone | casual, friendly, professional, playful or formal |
| Boundaries | The owner's own rules, always plus ALT's safety rules |
| Instructions (advanced) | Private; only a **hash** goes into the public manifest |

### Channels (one engine, different rules)

`alter_chat` (owner testing) · `altera_post`, `altera_comment`, `altera_dm` (the AI on ALTERA) · `altera_draft`,
`altera_draft_comment` (the AI writes *for* a renter/subscriber, in their voice) · `altar_trial`,
`altar_rental` (on ALTAR). Same persona everywhere, channel-specific rules.

### The language model providers (`llm.ts`)
Groq (`openai/gpt-oss-120b`) first, then Gemini (`gemini-flash-latest`), then DeepSeek, all through one
OpenAI-compatible interface; each gets 20 seconds; a short rate limit is waited out once; if all fail, a clear
`AI_UNAVAILABLE` error (in development a labelled `[mock]` reply). Changing models is configuration, not code.

### M10 counter-questions

| Question | Answer |
|---|---|
| So it's just ChatGPT with a prompt? | Today the *generator* is a hosted model, yes, and we say so. What we built is everything around it: a structured persona per AI, consented data with retrieval, owner-approved memories, versions frozen and hashed, the same AI on three platforms, safety checks on every reply, logging, and an on-chain identity. The next phase replaces the generator with an adapter fine-tuned on the owner's own writing (`07`), plugged into the same engine. |
| How do you stop the AI hallucinating? | Strictness setting; retrieval puts the owner's real notes in the prompt; the system prompt says to admit not knowing; the reply is moderated. Hallucination measurement is part of M7 Health Score (final evaluation). |
| How does it remember across sessions? | Approved memories are in every prompt; conversations are stored and continue in any app (`/ais/:id/conversations`). |
| How do you know it sounds like the owner? | The owner tests it (at least 3 messages) and confirms before it can be minted; the "Sounds like you" score (our trained style model, AUC 0.739) is shown under each reply. |
| What does "retrain with new data" do now? | Adding data and building a new version freezes the new knowledge; publishing it updates the AI everywhere and records the new manifest on-chain. |
| What if Groq is down? | Automatic fallback to Gemini, then DeepSeek. |
| Can a renter make the AI say private things about the owner? | The renter talks to the *published* version only; the system prompt forbids revealing private details to people who aren't the owner (`altera_dm`, `altar_rental` rules); the owner's private files never belong to anyone else. |

---

## M11: ALTAR Core Engine (the marketplace)

### Feature status

| FE | Status | How |
|---|---|---|
| FE-1 List AIs for sale, rent, subscription, licensing | ✅ sale, rent, subscription; 🟡 licensing terms are free text in the listing; auctions planned | List an AI page |
| FE-2 Details: ownership, provenance, health, pricing, usage rights | ✅ ownership, provenance (live from the chain), prices, rights; 🟡 health score is M7 (final evaluation) | AI page |
| FE-3 Pricing models, royalties, licensing via integrated wallet | ✅ | ALT wallet; contract prices; royalty preview |
| FE-4 Record of owned AIs, transactions, transfers | ✅ | Profile tabs, wallet activity from chain events |
| FE-5 Categorised e-commerce store | ✅ | Home: categories, filter, sort, search by meaning, "newly minted" |

### ALTAR web pages (`apps/altar-web/src/app/`)

| Page | What it does |
|---|---|
| `/` (home) | Hero with the newest tokens, ticker, "newly minted" table, three ways to hold an AI, the store grid (categories, filter, sort, **search by meaning**), creators |
| `/details/[handle]` | The AI: token art, Own / Rent / Subscribe panel with live contract prices, about and traits, **on-chain proof re-read live**, activity, reviews, report |
| `/list-ai` | List for sale, rent (max days) and/or subscription; pitch and terms; fee and royalty preview |
| `/wallet` | Balance, marketplace earnings + withdraw, send POL, test funds (local chain), your AI tokens, activity, royalties as a creator, Connect MetaMask |
| `/chat/[handle]` | Talk to an AI you own, rent or subscribe to (time left shown); a column of your AIs |
| `/profile` | My AIs, Saved, Rented & subscribed |
| `/creator/[handle]` | A creator's public page |
| `/signin`, `/signup`, `/handoff` | "Continue with ALT": the ALT Account window, never an ALTAR password form |
| `/help`, `/settings`, `/legal/[slug]` | Support cases, settings, policies |

ALTAR web has **no database and no accounts of its own**: it talks only to `/core/...` and `/altar/...` on the same
origin. The access token lives in memory; the refresh token is Core's httpOnly cookie.

### The ALTAR API (`services/altar-api`)
- **Listings** (`altar.listings`): the seller's pitch, terms and subscription price + a **mirror of the on-chain
  prices**, re-read from the contract on every save. A listing counts only while its lister still holds the token.
- **Indexer** (every 4 seconds): reads `Sold`, `Rented`, `Subscribed` events and writes `altar.transactions`
  (amount, royalty, fee, days/months, tx hash, log index; re-reading a block is harmless because `tx_hash +
  log_index` is unique). It also creates, updates or removes listings to follow the contract.
- **Reviews**: one per person per AI, **only if the chain shows they bought, rented or subscribed** (never the
  owner or creator), moderated by ALT Core.
- `GET /me/activity`, `/me/rentals`, `/me/royalties`, `GET /activity?aiId=` (public: sales and rentals only;
  subscribers stay private), wishlist.
- It **never signs transactions or holds keys**: only ALT Core spends, after the person confirms.

### Flow 11.1: Listing an AI
1. Owner → ALTAR → List AI → prices → confirm.
2. ALTAR → `PUT /core/ais/:id/market` with the prices and the confirmation.
3. Core checks the person (password or 2FA, or a one-time approval from the ALT window), then with the person's
   **custodial key**: approves the marketplace once per wallet (`setApprovalForAll`), then `listForSale` /
   `listForRent` / `listForSubscription` / cancel (only what changed). **ALT pays the gas**: the relayer first tops
   the wallet up with just enough POL for the transactions.
4. The ALTAR indexer sees the events and updates the listing; the store shows the prices.

---

## M12: Transactions, usage rights and royalties

### What can be bought (owner's decisions)
- **Sale**: the token moves; the buyer becomes the owner in ALTER, ALTERA and ALTAR; the seller loses access (keeps
  old chats read-only). The AI's persona, versions and memories go with the token; **the seller's private files do
  not**.
- **Rent**: one person gets sole use for 1–365 days (ERC-4907 `userOf`); ownership doesn't move; access ends
  automatically at expiry.
- **Subscription**: many people, by the month (1–12 months of 30 days); renewing adds time; ownership doesn't move.
- **Royalty**: the creator gets their royalty (set at mint, max 10%) on every later sale, rental and subscription,
  except their own first sale. Platform fee: 2.5% to the treasury.

### Flow 12.1: Buying an AI (the full path)
1. Hamza → Code Sensei → Buy → "Confirm in ALT": the ALT Account window opens and asks his password or 2FA code →
   Core returns a **one-time approval** (`POST /me/spend-approvals`): valid **2 minutes**, bound to Hamza, the action
   "buy", this AI and this price, usable once.
2. ALTAR → `POST /core/ais/:id/market/buy {confirm: {approval}, expectedPrice}`.
3. Core checks the approval (or password/code), checks the **price hasn't changed** (`PRICE_CHANGED`), checks the
   balance, and sends `ALTMarketplace.buy(tokenId)` from Hamza's custodial wallet with **exactly** the price.
4. **The contract** (all in one transaction, re-entrancy guarded):
   - checks: listed, exact payment, seller still owns it, not your own, not suspended, not rented;
   - deletes the listing and rental/subscription offers (effects before interactions);
   - **splits**: fee (2.5%) → treasury balance; royalty (ERC-2981 `royaltyInfo`) → creator balance (0 if the
     creator is the seller); the rest → seller balance;
   - transfers the token to the buyer; emits `Sold(tokenId, seller, buyer, price, royaltyReceiver, royalty, fee)`.
5. Core runs `syncToken`: reads `ownerOf` → moves `owner_id` to Hamza, adds role `consumer`, audits
   `ai.ownership_changed`, notifies both, tells ALTERA (the AI's ALTERA profile moves to Hamza with auto-replies off).
6. The ALTAR indexer records the sale in `altar.transactions`. Hamza's wallet shows it; Bilal's shows earnings.
7. Bilal → Wallet → **Withdraw**: the contract's `withdraw()` sends his balance (pull payment).

### Flow 12.2: Renting and talking
1. Rent → days picker → total = price/day × days → confirm (same as buying) → `rent(tokenId, days)`: exact payment,
   split like a sale, then the registry's `setUser(renter, now + days)`.
2. Core mirrors the renter (`user_address`, `user_expires`) and notifies both.
3. Hamza → Chat: `GET /ais/:id/access` says he is the renter until <time>; he talks to the **published** version
   (channel `altar_rental`). He can also use it in ALTER and ALTERA (draft posts "posted with Urdu Ustad").
4. At expiry `userOf` returns zero by itself; Core refuses new messages; old conversations stay readable.

### Flow 12.3: Subscribing
`subscribe(tokenId, months)`: expiry = max(now, current expiry) + months × 30 days; the owner is paid (minus fee and
royalty); Core mirrors it in `core.ai_subscriptions`; subscribers talk like renters until their time ends. Many
people can subscribe at once.

### Why "pull payments"?
The contract credits balances and people withdraw. If it sent money directly during a sale and the seller were a
contract that rejects payments, every sale of that AI would fail. With pull payments a bad recipient only fails its
own withdrawal (tested), and there is no re-entrancy through payouts.

### M11/M12 counter-questions

| Question | Answer |
|---|---|
| Is the AI file sold? Can the buyer download the model? | No. An AI never leaves ALT as a file. What is sold is the **right**, recorded by the token; Core's persona engine serves the AI to whoever the chain says owns, rents or subscribes. |
| Is this real money? | Test POL on our local chain (no value). The same contracts run on Polygon Amoy (test) or Polygon mainnet (real POL) by configuration. |
| How do you prevent double-spending or paying twice? | The contract checks the exact price; one transaction does everything or nothing; the listing is deleted before the transfer; `nonReentrant` on every payable function. |
| What if the price changes while I'm paying? | `expectedPrice` guard: Core refuses with `PRICE_CHANGED`; the contract also requires the exact current price. |
| Who holds the buyer's key? | ALT, encrypted (custodial wallet), and it signs **only** after the person confirms with their password or 2FA code (or a one-time 2-minute approval from the ALT window). People who want their own keys can link MetaMask. |
| Can ALTAR (the website) steal money? | No. ALTAR never sees a password or a key and can't sign; spending happens only in Core after the person's confirmation, for exactly the approved action and amount. |
| How do royalties work technically? | ERC-2981: the registry stores (creator, royalty bps) at mint; the marketplace asks `royaltyInfo(tokenId, price)` on every payment. It can't be skipped through our marketplace. (Any NFT marketplace that honours ERC-2981 would pay it too.) |
| Why can't you refund? | On-chain payments are final by design: nobody, including ALT, can take money back from a person's balance. Disputes go to staff, who can act on the seller or the AI (M3). |
| What prevents fake reviews? | A review is accepted only if the chain shows the reviewer actually bought, rented or subscribed; one per person per AI; moderated. |
| Is the marketplace history trustworthy? | `altar.transactions` is built only from contract events, each with its transaction hash; anyone can check them on the chain. |
| Licensing and auctions? | Sale, rent and subscription are done. Licence terms are currently text in the listing; auctions (on-chain bids) are planned for the final evaluation. |
