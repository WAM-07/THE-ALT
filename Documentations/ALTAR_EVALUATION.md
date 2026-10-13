# ALTAR: evaluation of Soban's code (2026-10-13)

**What was reviewed:** `altar-marketplace/` in the repo root. It is Soban's own git repo (`github.com/msoban3219-h/altar-marketplace`, 5 commits, 2026-05-08 to 05-12) and is **not tracked by THE-ALT's git**. Three of its files have uncommitted formatting-only changes, exactly as delivered.

**How:**
- Read every source file (about 4,800 lines).
- Ran `npm audit`.
- Built it (`next build`).
- Ran it locally with a **dummy database URL**, so nothing touched Soban's live Supabase, and took screenshots.

**Verdict:**
- **The UI is a usable starting point. The logic is not.**
- Every feature runs in the browser over one unauthenticated key-value API. Accounts, money, ownership, escrow and "smart contracts" are all simulated.
- As written, it must **not** be deployed or connected to ALT.

## 1. What it is

| Part | What's there |
|---|---|
| Stack | Next.js **15.1.0** (App Router), React 19, Tailwind 4. Every page is `"use client"`. |
| Pages | Home/browse with search, categories and a "My listings" view; AI detail; List AI; Cart and checkout; Wallet; Profile dashboard (my agents, escrows, resell); Messages (text, files, voice notes); Sign in and sign up (email or Google). |
| "Backend" | `src/app/api/db/route.js`: a generic `GET/POST ?key=` key-value store over one Postgres table, `kv_store(key, value jsonb)`, on **Soban's Supabase**. All business logic lives in React contexts in the browser. |
| Other API routes | `/api/send-code` (Gmail SMTP) and `/api/verify-email` (MX lookup). Both are **unused** by the UI. |
| Extras | Urdu and Arabic UI strings, currency display with fixed rates, wishlist with "back in stock" alerts, reviews with seller replies, discount codes. |
| Dead weight | `mongodb` dependency (unused); `replaceColors*.js` one-off scripts; boilerplate README; ESLint config is broken (`nextVitals is not iterable`). |

Build: ✅ compiles (15 routes).

## 2. Real vs simulated

| Feature | Status |
|---|---|
| UI, navigation, forms | ✅ Real |
| Data saved to Postgres | ✅ Real, but as whole JSON arrays under global keys (`accounts`, `custom_models`, `escrow_transactions`, `wishlists`, `user_messages`, `cart`, `user`) |
| Sign in / sign up | ❌ Fake. The browser downloads every account and compares **plaintext** passwords. A hard-coded `demo@altar.com` / `demo123` backdoor also exists. |
| Google sign-in | ❌ The ID token is decoded in the browser without checking its signature. |
| Session | ❌ One global DB key, `user`, shared by **every visitor**. |
| Wallet | ❌ Starts at 1,000. "Top up" adds any amount for free. |
| Card / PayPal / bank | ❌ Form fields are ignored. Nothing is charged. |
| "Smart contract" | ❌ A 5.5-second animation. No blockchain. |
| Escrow | ❌ A JSON record. The **seller** releases it. Cancelling refunds the buyer's wallet. |
| Ownership, rent, subscription | ❌ Name strings and dates inside the listing JSON. Not enforced anywhere. |
| 5% royalty on resale | ❌ Credited client-side to every account with the creator's display name. |
| AI chat on the detail page | ❌ Random canned replies. |
| Health score | ❌ +1 per sale. |
| The AI itself | ❌ A file upload (`.zip`/`.bin`) stored as base64 inside the listing. Not linked to ALTER, AITs or verification. |

## 3. Security findings

**Critical**
1. **The whole database is public.**
   - `GET /api/db?key=accounts` returns every user's name, email, **plaintext password** and balance.
   - `POST /api/db` lets anyone overwrite or delete anything: balances, listings, escrows, accounts.
   - Google accounts store the Google `sub` as their "password", and that dump exposes it, so they can be taken over too.
2. **Plaintext passwords**, compared in the browser.
3. **Global session, cart and inbox.**
   - Whoever signed in last becomes "the user" on every visitor's next page load, and one logout logs everyone out.
   - All direct messages, files and voice notes sit in one blob that every visitor downloads.
4. **Next.js 15.1.0 has unauthenticated remote-code-execution advisories.** These include the React flight protocol RCE (CVE-2025-66478, GHSA-9qr9-h5gf-34mp). `npm audit` reports 13 vulnerabilities (1 critical, 12 high).
5. **Money can be created from nothing.**
   - Top-up is free.
   - A "card" checkout opens an escrow without charging anything, and cancelling that escrow refunds into the wallet.
   - The refund is the pre-discount price, so discount codes make a profit.
6. **Paid model files are free.** Each listing carries its file as base64, and every visitor downloads every listing.

**High**

7. **Identity is the display name.**
   - Owner, creator, buyer, messages and payouts are all matched by `name`, but sign-up only checks the email.
   - Registering with someone's name gives you their AIs, income and DMs.
8. **Lost updates.** Every change re-saves a whole shared array from one browser, so concurrent users overwrite each other.
9. **`/api/send-code` is an open mail relay** from Soban's Gmail, and the attacker controls the `code` it puts into the HTML. It is unused, but it is deployed with the app.
10. **Database handling.**
    - TLS checking is off (`rejectUnauthorized: false`).
    - Tables are created at request time, which breaks our rule 5.
    - Nothing limits size (base64 images, models and voice notes go into JSONB).

**Secrets:** `.env.local` holds a live Supabase connection string and a Google client ID. It is git-ignored and **was never committed** (checked the full history). Never copy it into THE-ALT. If this app was ever deployed publicly, treat every password stored in it as leaked and rotate the Supabase password.

## 4. Against our design (ROADMAP §5, Milestone 7)

| ROADMAP needs | Soban's code | Plan |
|---|---|---|
| One ALT account (session via gateway) | Own accounts and Google login | Drop it; use ALT sign-in/handoff |
| Only verified AIs (AIT) can be listed | Upload any file | Listing = pick one of *your verified AIs* from Core |
| `ALTMarketplace` (already built and tested): POL, pull payments, royalty on secondary sales only, ERC-4907 rentals | Client-side wallet, escrow and 5% royalty | Use the contract; `altar-api` indexes its events |
| Renters use the AI through the persona engine until expiry | File download plus canned chat | `altar_rental` channel, enforced by the rental mirror |
| `altar` schema, migrations, zod-validated API | `kv_store` JSON blobs | New `altar-api` service |
| Notifications through the ALT inbox | Own DMs and alerts | Use `AltInbox`; drop DMs or point to ALTERA |

## 5. What's worth keeping
- **Visual design and page layouts:** home/hero, browse grid, detail page, list form, cart and checkout, profile dashboard, wallet. It's a consistent black-and-green look.
- **UX ideas for later:** wishlist alerts, reviews with seller replies, Urdu UI, currency display.
- **Not reusable:** all of `src/contexts/*`, all of `src/app/api/*`, sign-in and sign-up.

## 6. Open questions for the owner
1. Was this app ever deployed publicly (for example on Vercel)? If so, ask Soban to take it down and rotate the Supabase password.
2. Keep Soban's black-and-green look, or move ALTAR to ALTER's Obsidian style?
3. Which extras count toward the 60% (subscriptions, discount codes, reviews, wishlist, DMs)? ROADMAP defers subscriptions and auctions.
4. Selling an AI means transferring its AIT (and its use through ALT), not downloading a file. Confirm this, so the upload step goes away.

## 7. Decisions and plan (owner, 2026-10-13)

**Decided:**
- Keep Soban's **frontend design only**. The backend and functionality are rebuilt on ALT's central system; Supabase goes.
- ALTAR's colour is **green** (ALTERA orange; ALTER to be redesigned later).
- **Sale** = the AIT moves to the buyer; the seller loses all access and rights. **Rent** = one person, sole use, for set days; the owner keeps ownership. **Subscription** = many people, monthly use. **Royalties** go to the original creator.
- Where something can't be real yet, use a clearly labelled placeholder that the real system can replace.

**How an AI changes hands (the "model file" question).** An ALT AI is not a file. It is:
1. its **AIT** (the on-chain right: who owns it, who is renting it until when);
2. its **published version**: persona, consented data and approved memories, frozen and hashed (only hashes are public on IPFS);
3. **Core's persona engine**, which is the only thing that ever runs it.

Nobody downloads an AI, so there is nothing a seller can keep. Core decides who may talk to or edit an AI by reading the token: the owner (`ownerOf`) edits and uses it, the renter (`userOf`, until expiry) uses it, subscribers use it until their period ends. When the token moves, Core moves the AI to the new owner in ALTER on the next chain event.
- **What the seller keeps:** their own raw notes and files (they're the seller's, and could be used to build a *new* AI, which would be a different token with its own provenance) and their old chat history as read-only.
- **What the buyer gets:** the published versions and the right to build new ones. The seller's raw datasets stay sealed: the buyer can use the AI but can't read the seller's private documents.
- **Fine-tuned adapters later** (after the 60%) follow the same rule: stored encrypted by Core, attached to a version, never downloadable.

**Steps (each stops for the owner's review):**
1. ✅ **Foundation** (2026-10-13): `apps/altar-web` with Soban's design on Next.js 16.4 (patched), served by the gateway at `/`; ALT accounts (sign-in with 2FA and email codes, sign-up, handoff from ALTER/ALTERA); browse and detail pages from Core's verified AIs with a live on-chain token check; My AIs; Soban's fake backend removed.
2. **Listings and wallet:** `altar-api` service and `altar` schema (listings, terms, reviews, wishlist); list a verified AI for sale, rent and subscription; the wallet shows the custodial balance, test funds on the local chain, earnings and withdraw. Core signs marketplace transactions with the custodial key after the person confirms.
3. **Buying and renting:** buy and rent through `ALTMarketplace`; an indexer turns contract events into `altar.transactions` and `altar.rentals`; Core moves ownership and rental rights; renters chat with the AI on ALTAR (`altar_rental`); ALTER and ALTERA follow the new owner; inbox notifications.
4. **Subscriptions and royalties:** add `subscribe` to `ALTMarketplace` (owner's decision needed: it changes `packages/contracts`), creator royalty view, reviews from real buyers, demo seed and docs.
