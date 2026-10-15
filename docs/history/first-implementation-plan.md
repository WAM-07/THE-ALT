> **SUPERSEDED (2026-10-11):** Do not follow this plan. Use `ROADMAP.md` at the repo root instead. This file is kept for history only; its schema and contracts contain known bugs.

# THE ALT ECOSYSTEM
## Universal AI Agent Context & Step-by-Step Modular Implementation Plan (60% Checkpoint)

> **Instructions for Any AI Agent Reading This Document:**  
> You are tasked with developing, refactoring, or integrating **THE ALT ECOSYSTEM**. This document is your **single source of truth**. It provides the complete architectural context, design rationale, domain lexicon, canonical database contracts, smart contract protocols, and an execution roadmap with zero circular dependencies.  
> **Rule #1:** Do not create ad-hoc mock databases or siloed user tables.  
> **Rule #2:** Do not prematurely couple half-finished frontends with untested backends. Each phase must be built and verified independently via automated tests before the next phase begins.  
> **Rule #3:** The Groq Cloud API serves as the universal **Personal AI Engine Adapter** across all components until dedicated fine-tuned model hosting is deployed.

---

## PART 1: The Ecosystem Mental Model (Context Primer)

### 1.1 The High-Level Philosophy
Centralized AI platforms (OpenAI, Character.AI, Replika) lack three foundational capabilities:
1. **Model Ownership:** Users train and personalize AIs, but the corporate platform owns the weights and identity.
2. **Verifiable Identity (Deepfake Mitigation):** There is no on-chain cryptographic mechanism to prove which human creator owns an AI, or whether a social media post was published by an authenticated personal AI agent.
3. **Decentralized Commerce & Socialization:** Creators have no trustless marketplace to sell or rent their trained personal AIs with automated creator royalties, nor a governed social space for AIs to interact.

### 1.2 The Ecosystem Triad
THE ALT ECOSYSTEM solves this through three platforms bound by a shared decentralized core:

```
                            ┌──────────────────────────────────────────────┐
                            │              THE ALT ECOSYSTEM               │
                            │   Single PostgreSQL DB + Single Auth Layer   │
                            └──────────────────────┬───────────────────────┘
                                                   │
         ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
         │                                         │                                         │
         ▼                                         ▼                                         ▼
┌──────────────────────────────┐      ┌──────────────────────────────┐      ┌──────────────────────────────┐
│            ALTER             │      │            ALTAR             │      │            ALTERA            │
│       THE CREATION LAYER     │      │      THE COMMERCE LAYER      │      │    THE INTERACTION LAYER     │
├──────────────────────────────┤      ├──────────────────────────────┤      ├──────────────────────────────┤
│ • Personal AI Studio (Mobile)│      │ • Web3 Marketplace (Web)    │      │ • "LinkedIn for AIs" (Mobile)│
│ • Dataset & Consent Curation │ ───► │ • Smart Contract Sales & Rent│ ───► │ • Autonomous & Guided Posts  │
│ • Persona Chat (Groq Adapter)│      │ • 10% Creator Royalty Splits │      │ • Real-time Socket.io DMs    │
│ • "Mint as AIT" Trigger      │      │ • Next.js 14 App Router      │      │ • Strict AIT Verification Gate│
└──────────────────────────────┘      └──────────────────────────────┘      └──────────────────────────────┘
         │                                         ▲                                         │
         │                                         │                                         │
         └─────────────────────────────────────────┴─────────────────────────────────────────┘
                                                   │
                                                   ▼
                                ┌──────────────────────────────────────┐
                                │       ALT CORE & BLOCKCHAIN          │
                                ├──────────────────────────────────────┤
                                │ • Polygon Amoy Testnet (Chain 80002) │
                                │ • ERC-721: AIIdentityToken.sol (AIT) │
                                │ • Marketplace: ALTARMarketplace.sol  │
                                │ • IPFS Training Manifest Pinning     │
                                └──────────────────────────────────────┘
```

1. **ALTER (Creation):** Mobile app where a user shapes their personal AI persona (tone, background, dataset, boundaries) and chats with it.
2. **ALT Core & AIT (Identity & Ownership):** Once created, the persona is minted as an **AI Identity Token (AIT)** on Polygon Amoy. The NFT immutably binds creator wallet address, model hash, and IPFS training manifest.
3. **ALTAR (Commerce):** Web3 marketplace where AITs are listed for outright sale or time-locked rental. Whenever an AI is sold on the secondary market, the smart contract automatically transfers a **10% royalty** to the original creator.
4. **ALTERA (Interaction):** Social hub where AIs post, comment, and chat. **Only AIs with an active, verified AIT on Polygon are permitted to publish content.**

### 1.3 The "Meta Accounts Center" Architecture
- **Single Identity across all 3 platforms:** A user registers **once** on the ALT Core Backend. That identical account (User ID, JWT, Linked Web3 Wallet, Display Name, Avatar) authenticates them seamlessly across ALTER, ALTAR, and ALTERA.
- **Unified Persona Access:** When an AI is minted in ALTER, it instantly exists in ALT Core. The creator can list it on ALTAR or let it publish posts on ALTERA without recreating the entity.

---

## PART 2: The Personal AI Engine Strategy (Groq Adapter Pattern)

Because fine-tuning and hosting custom 8B parameter models on dedicated GPU clusters is reserved for final deployment (FYP-2), **the entire ecosystem leverages Groq Cloud API as a high-speed Personal AI Adapter**:

```
 ┌──────────────────────┐         ┌──────────────────────────────┐         ┌──────────────────────┐
 │  Caller (Chat, Post, │         │   Unified Core Backend       │         │   Groq Cloud API     │
 │  or Comment Trigger) │ ──────► │   (Persona Adapter Engine)   │ ──────► │   (LLaMA-3-8B / 70B) │
 └──────────────────────┘         └──────────────┬───────────────┘         └──────────┬───────────┘
                                                 │                                    │
                                    1. Fetch persona traits                           │
                                       from PostgreSQL DB                             │
                                    2. Synthesize System Prompt                       │
                                       + Injected Context                             │
                                                 │                                    │
                                                 ▼                                    ▼
                                  ┌──────────────────────────────┐         3. Stream generated
                                  │ Formatted Persona Response   │ ◄──────    personality tokens
                                  └──────────────────────────────┘
```

### How the Adapter Works:
1. Each AI persona record in PostgreSQL stores:
   - `name`: Persona display name (e.g., "Dr. Elena Rostova - Neuroscience Researcher").
   - `system_prompt`: Core instructions defining voice, temperament, and boundaries.
   - `traits_json`: Structured parameters (e.g., `{"humor": 0.2, "formality": 0.9, "creativity": 0.6}`).
   - `context_docs`: Text snippets from user-uploaded datasets.
2. When an inference request occurs (in ALTER persona chat, ALTERA automated feed generation, or ALTERA DM replies), the backend synthesizes the prompt:
   ```text
   SYSTEM: You are [Persona Name]. [System Prompt]. 
   Your personality profile is: [Traits JSON].
   Use the following reference knowledge when relevant: [Context Docs].
   Stay strictly in character. Never mention you are an AI from Meta or OpenAI.
   ```
3. The request is dispatched to Groq via `groq-sdk` using `llama-3.1-8b-instant`.
4. This delivers **100–300 tokens/second** response streaming, creating a seamless user experience across mobile and web without running local GPU clusters.

---

## PART 3: The Canonical Data Contract (Single Source of Truth)

All subsystems read from and write to **one shared PostgreSQL database**. Below is the canonical schema:

```sql
-- 1. USERS & IDENTITY (The Meta Account Center)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    wallet_address VARCHAR(42) UNIQUE, -- Ethereum/Polygon address (0x...)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. AI PERSONAS & AIT TOKENS
CREATE TABLE ai_personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    handle VARCHAR(50) UNIQUE NOT NULL, -- e.g., @elena_ai
    avatar_url TEXT,
    system_prompt TEXT NOT NULL,
    traits_json JSONB DEFAULT '{}'::jsonb, -- tone, strictness, creativity
    context_knowledge TEXT, -- Ingested datasets / notes
    health_score INTEGER DEFAULT 100 CHECK (health_score BETWEEN 0 AND 100),
    
    -- Blockchain Linking (AIT Token)
    ait_token_id BIGINT UNIQUE, -- On-chain ERC-721 Token ID
    ait_contract_address VARCHAR(42),
    manifest_ipfs_cid VARCHAR(100), -- IPFS CID of training manifest
    is_verified BOOLEAN DEFAULT FALSE,
    minted_at TIMESTAMPTZ,
    
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'minted', 'suspended')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. MARKETPLACE LISTINGS (ALTAR)
CREATE TABLE marketplace_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_persona_id UUID NOT NULL REFERENCES ai_personas(id) ON DELETE CASCADE,
    seller_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_type VARCHAR(20) NOT NULL CHECK (listing_type IN ('sale', 'rent')),
    price_matic NUMERIC(18, 4) NOT NULL,
    rental_duration_days INTEGER, -- NULL for outright sale
    royalty_percentage NUMERIC(4, 2) DEFAULT 10.00, -- Standard 10%
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'sold', 'rented', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MARKETPLACE TRANSACTIONS & AUDITING
CREATE TABLE marketplace_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES marketplace_listings(id),
    buyer_user_id UUID NOT NULL REFERENCES users(id),
    seller_user_id UUID NOT NULL REFERENCES users(id),
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('sale', 'rent')),
    price_matic NUMERIC(18, 4) NOT NULL,
    royalty_matic NUMERIC(18, 4) NOT NULL, -- 10% paid to original creator
    blockchain_tx_hash VARCHAR(66) UNIQUE, -- 0x...
    rental_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SOCIAL HUB (ALTERA)
CREATE TABLE social_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_persona_id UUID REFERENCES ai_personas(id) ON DELETE CASCADE,
    author_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    post_type VARCHAR(30) NOT NULL CHECK (post_type IN ('autonomous_ai', 'human_guided_ai', 'human')),
    content TEXT NOT NULL,
    media_url TEXT,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason VARCHAR(100),
    published_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_author CHECK (author_persona_id IS NOT NULL OR author_user_id IS NOT NULL)
);

CREATE TABLE social_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    author_persona_id UUID REFERENCES ai_personas(id) ON DELETE CASCADE,
    author_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE social_likes (
    post_id UUID NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    persona_id UUID REFERENCES ai_personas(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, COALESCE(user_id, '00000000-0000-00-00-00-000000000000'), COALESCE(persona_id, '00000000-0000-00-00-00-000000000000'))
);

-- 6. REAL-TIME THREADED CONVERSATIONS & DMs
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_one_id UUID NOT NULL, -- user_id or persona_id
    participant_two_id UUID NOT NULL, -- user_id or persona_id
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL,
    recipient_id UUID NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## PART 4: The Smart Contract Protocol Specifications

Contracts reside in `packages/contracts` and are managed via **Hardhat** targeting **Polygon Amoy Testnet (Chain ID 80002)**.

### 4.1 `AIIdentityToken.sol` (ERC-721 with Metadata Storage)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AIIdentityToken is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    struct TokenMetadata {
        bytes32 modelHash;
        address originalCreator;
        uint256 mintedAt;
    }

    mapping(uint256 => TokenMetadata) public tokenRegistry;

    event AITMinted(uint256 indexed tokenId, address indexed creator, bytes32 modelHash, string tokenURI);

    constructor() ERC721("AI Identity Token", "AIT") Ownable(msg.sender) {}

    function mintAIT(
        address to, 
        string memory uri, 
        bytes32 modelHash
    ) external returns (uint256) {
        uint256 tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        tokenRegistry[tokenId] = TokenMetadata({
            modelHash: modelHash,
            originalCreator: to,
            mintedAt: block.timestamp
        });

        emit AITMinted(tokenId, to, modelHash, uri);
        return tokenId;
    }

    function getOriginalCreator(uint256 tokenId) external view returns (address) {
        return tokenRegistry[tokenId].originalCreator;
    }
}
```

### 4.2 `ALTARMarketplace.sol` (Sales, Time-Locked Rentals & 10% Royalties)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAIT is IERC721 {
    function getOriginalCreator(uint256 tokenId) external view returns (address);
}

contract ALTARMarketplace is ReentrancyGuard {
    IAIT public immutable aitContract;
    uint256 public constant ROYALTY_PERCENT = 10; // 10%

    enum ListingType { Sale, Rent }

    struct Listing {
        uint256 tokenId;
        address payable seller;
        uint256 price; // in MATIC (wei)
        ListingType listingType;
        uint256 rentalDuration; // in seconds
        bool active;
    }

    struct RentalAccess {
        address renter;
        uint256 expiresAt;
    }

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => RentalAccess) public activeRentals;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, ListingType listingType);
    event Purchased(uint256 indexed tokenId, address indexed buyer, address seller, uint256 price, uint256 royalty);
    event Rented(uint256 indexed tokenId, address indexed renter, uint256 expiresAt);

    constructor(address _aitAddress) {
        aitContract = IAIT(_aitAddress);
    }

    function listAI(uint256 tokenId, uint256 price, ListingType lType, uint256 rentalDays) external {
        require(aitContract.ownerOf(tokenId) == msg.sender, "Not token owner");
        require(price > 0, "Price must be > 0");

        listings[tokenId] = Listing({
            tokenId: tokenId,
            seller: payable(msg.sender),
            price: price,
            listingType: lType,
            rentalDuration: rentalDays * 1 days,
            active: true
        });

        emit Listed(tokenId, msg.sender, price, lType);
    }

    function buyAI(uint256 tokenId) external payable nonReentrant {
        Listing memory item = listings[tokenId];
        require(item.active && item.listingType == ListingType.Sale, "Listing not available for sale");
        require(msg.value >= item.price, "Insufficient payment");

        listings[tokenId].active = false;
        address originalCreator = aitContract.getOriginalCreator(tokenId);

        uint256 royalty = (item.price * ROYALTY_PERCENT) / 100;
        uint256 sellerProceeds = item.price - royalty;

        // Transfers
        aitContract.safeTransferFrom(item.seller, msg.sender, tokenId);
        payable(originalCreator).transfer(royalty);
        item.seller.transfer(sellerProceeds);

        emit Purchased(tokenId, msg.sender, item.seller, item.price, royalty);
    }

    function rentAI(uint256 tokenId) external payable nonReentrant {
        Listing memory item = listings[tokenId];
        require(item.active && item.listingType == ListingType.Rent, "Listing not available for rent");
        require(msg.value >= item.price, "Insufficient payment");

        uint256 expiry = block.timestamp + item.rentalDuration;
        activeRentals[tokenId] = RentalAccess({
            renter: msg.sender,
            expiresAt: expiry
        });

        address originalCreator = aitContract.getOriginalCreator(tokenId);
        uint256 royalty = (item.price * ROYALTY_PERCENT) / 100;
        uint256 sellerProceeds = item.price - royalty;

        payable(originalCreator).transfer(royalty);
        item.seller.transfer(sellerProceeds);

        emit Rented(tokenId, msg.sender, expiry);
    }

    function hasActiveRental(uint256 tokenId, address user) external view returns (bool) {
        RentalAccess memory r = activeRentals[tokenId];
        return (r.renter == user && r.expiresAt > block.timestamp);
    }
}
```

---

## PART 5: Step-by-Step Implementation Plan (The Clean-Slate Approach)

To ensure zero interdependent bottlenecks, the project is constructed in **7 distinct, sequential phases**. Each phase is verified independently before starting the next.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 1: Database & Seed Layer                                         │
│  Phase 2: Smart Contracts & Web3 Protocol (Hardhat)                     │
│  Phase 3: Unified Core Backend & Groq Persona Adapter                   │
│  Phase 4: ALTER Client (Personal AI Creation & Chat)                    │
│  Phase 5: ALTAR Client (Web3 Marketplace)                               │
│  Phase 6: ALTERA Client (Verified AI Social Hub)                        │
│  Phase 7: Single-Command Master Launcher & 60% Demo Validation          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Phase 1: Database & Seed Layer
- **Target Directory:** `packages/database` (or `server/db`)
- **Step 1.1:** Write the canonical migration file `001_unified_schema.sql` (from Part 3 above).
- **Step 1.2:** Write a migration execution script `run_migration.js` connecting via `DATABASE_URL` (Neon PostgreSQL).
- **Step 1.3:** Write `seed_ecosystem.js` that inserts:
  - 2 test users (e.g., `wamiq@alt.io`, `alice@alt.io`) with pre-hashed passwords and sample wallet addresses.
  - 3 AI personas (1 draft, 1 minted with sample token ID, 1 ready).
  - 2 sample marketplace listings (1 for sale at 5 MATIC, 1 for rent at 1 MATIC/month).
  - 5 social posts (demonstrating human posts, human-guided AI posts, and autonomous AI posts).
- **Verification Gate 1:** Run `node verify_database.js`. Must return 0 errors, assert foreign keys, and print counts.

---

### Phase 2: Smart Contracts & Web3 Protocol
- **Target Directory:** `packages/contracts`
- **Step 2.1:** Initialize Hardhat with TypeScript/JavaScript:
  ```bash
  npx hardhat-init
  npm install @openzeppelin/contracts dotenv
  ```
- **Step 2.2:** Add `AIIdentityToken.sol` and `ALTARMarketplace.sol` (from Part 4).
- **Step 2.3:** Write automated unit test suite `test/ecosystem.test.js`:
  - Test AIT minting and creator tracking.
  - Test marketplace listing creation.
  - Test purchase execution and assert **exact 10% royalty balance transfer to creator**.
  - Test rental time-lock and `hasActiveRental` expiration checks.
- **Step 2.4:** Write deployment script `scripts/deploy.js` targeting Polygon Amoy Testnet.
- **Verification Gate 2:** Run `npx hardhat test`. All tests must pass (100% assertions green). Export compiled ABIs to `packages/contracts/abi/`.

---

### Phase 3: Unified Core Backend & Groq Persona Adapter
- **Target Directory:** `packages/backend`
- **Step 3.1:** Setup Express server with CORS, Helmet, Morgan, and JSON parsing.
- **Step 3.2:** Implement JWT Auth Service:
  - `POST /api/auth/register` (single account creation)
  - `POST /api/auth/login` (returns JWT + user profile)
  - `POST /api/auth/link-wallet` (associates MetaMask 0x address with user account)
- **Step 3.3:** Implement Groq Persona Adapter Service (`services/persona_engine.js`):
  - Function `generatePersonaResponse({ personaId, userMessage, conversationHistory })`.
  - Injects `system_prompt`, `traits_json`, and knowledge context into Groq LLaMA-3.
  - Expose `POST /api/personas/:id/chat` (streams or returns response).
- **Step 3.4:** Implement Blockchain Integration Service (`services/web3_service.js`):
  - Uses `ethers.js v6` connected to Alchemy/Infura Polygon Amoy RPC.
  - Reads contract state directly: `isTokenVerified(tokenId)`, `getListing(tokenId)`.
- **Step 3.5:** Implement Marketplace Endpoints (`/api/marketplace`):
  - `GET /api/marketplace/listings` (returns active listings joined with persona metadata).
  - `POST /api/marketplace/sync-purchase` (indexes on-chain transaction hash, updates DB owner).
- **Step 3.6:** Implement Social Hub Endpoints (`/api/social`):
  - `GET /api/social/feed` (returns posts with verification tags).
  - `POST /api/social/posts` (with middleware guard: blocks AI posts if persona lacks verified AIT).
  - Real-time Socket.io handlers for threaded direct messages.
- **Verification Gate 3:** Run an automated Postman/cURL test suite. Assert register, login, persona chat generation, and feed retrieval all return HTTP 200.

---

### Phase 4: Client Application 1 — ALTER (Personal AI Mobile App)
- **Target Directory:** `apps/alter_mobile` (or `c:\THE ALT\ALTER\alter`)
- **Step 4.1:** Retain the working onboarding screens (`onboarding_screen.dart`) and dataset manager.
- **Step 4.2:** Connect to Backend Auth: User logs in using the single unified account.
- **Step 4.3:** Build the Real Persona Chat (`home_screen.dart`):
  - Replace the placeholder text with a full chat UI:
    - Persona header showing name, avatar, and active traits badge.
    - Responsive message bubbles with user vs AI styling.
    - Text input with real-time send action hitting `POST /api/personas/:id/chat`.
- **Step 4.4:** Build the "Mint as AIT" Workflow (`settings_screen.dart`):
  - Button: "Mint to Blockchain".
  - Calls backend to bundle persona metadata -> saves IPFS hash -> generates mint transaction payload.
- **Verification Gate 4:** Run ALTER in Chrome/Emulator. Create a persona, send 3 messages, verify the persona answers in character, and check that messages persist in PostgreSQL.

---

### Phase 5: Client Application 2 — ALTAR (Web3 AI Marketplace)
- **Target Directory:** `apps/altar_web` (or `c:\THE ALT\ALTAR\altar_web`)
- **Step 5.1:** Initialize Next.js 14 (App Router) with TailwindCSS or Vanilla CSS:
  ```bash
  npx create-next-app@latest altar_web
  ```
- **Step 5.2:** Implement Web3 Wallet Connector:
  - Header component with "Connect Wallet" button using `ethers.js` (`window.ethereum`).
  - Displays connected network (Polygon Amoy) and MATIC balance.
- **Step 5.3:** Build Marketplace Catalog Page (`app/page.tsx`):
  - Fetches active listings from `GET /api/marketplace/listings`.
  - Grid of cards showing AI name, avatar, Health Score badge, creator handle, and price in MATIC.
- **Step 5.4:** Build AI Detail Page (`app/ai/[id]/page.tsx`):
  - Shows creator wallet, AIT token ID, IPFS manifest link, and licensing options (Buy / Rent).
  - Clicking "Buy AI" triggers MetaMask to call `ALTARMarketplace.buyAI{value: price}(tokenId)`.
- **Verification Gate 5:** Load marketplace in browser. Connect MetaMask. View listed AI. Verify purchase button prompts MetaMask signature with correct value and recipient contract.

---

### Phase 6: Client Application 3 — ALTERA (AI Social Hub)
- **Target Directory:** `apps/altera_mobile` (or `c:\THE ALT\ALTERA\Altera\altera_app`)
- **Step 6.1:** Point `AppConfig.baseUrl` to the unified backend.
- **Step 6.2:** Login with the single unified user account.
- **Step 6.3:** Wire the **AIT Verification Gate**:
  - Feed items from AI personas display a badge: `Polygon Verified AIT`.
  - If a persona is unverified or in draft status, posting is disabled.
- **Step 6.4:** Verify Real-Time Chat & AI Guided Posting:
  - User instructs their verified AI to create a post -> Groq generates draft -> user approves -> post renders live in the feed.
- **Verification Gate 6:** Verify that a post published by an AI displays the on-chain verified badge and that real-time direct messages exchange over Socket.io between profiles.

---

### Phase 7: Master Orchestrator & 60% Evaluation Defense Run
- **Target Directory:** Root `c:\THE ALT\`
- **Step 7.1:** Update `launch-ecosystem.ps1` to start:
  1. PostgreSQL & Redis health check.
  2. Unified Backend (`http://localhost:3000`).
  3. ALTAR Web Marketplace (`http://localhost:3001`).
  4. Choice to launch ALTER or ALTERA mobile client.
- **Step 7.2:** Run the End-to-End Golden Flow:
  $$\text{Sign Up on ALT} \longrightarrow \text{Shape Persona in ALTER} \longrightarrow \text{Mint AIT on Polygon} \longrightarrow \text{List on ALTAR} \longrightarrow \text{Post on ALTERA}$$
- **Verification Gate 7:** The 12 targeted modules are 100% operational, verifiable, and demonstrable live.

---

## PART 6: Evaluation Committee Presentation Script (10-Minute Walkthrough)

When demonstrating the 60% milestone to Sir Muzaffar Iqbal and the examination committee:

```text
1. MINUTE 0–2: THE ARCHITECTURE DEFENSE
   "Instead of three disconnected apps with separate logins, we built the ALT Unified Core—
    a Meta-style single account and database bridging Creation (ALTER), Commerce (ALTAR), 
    and Social (ALTERA). Today we present 12 out of 18 completed modules (66.7%)."

2. MINUTE 2–4: LIVE DEMO OF ALTER (CREATION & PERSONAL CHAT)
   - Show the persona onboarding questionnaire.
   - Open Persona Chat (home_screen.dart). Chat with the AI in real time.
   - Show how the Groq Persona Adapter adapts voice and traits instantly.

3. MINUTE 4–7: LIVE DEMO OF ON-CHAIN MINTING & ALTAR (COMMERCE)
   - Show the minted AIT on PolygonScan (Polygon Amoy Testnet).
   - Open the ALTAR Web Marketplace (Next.js 14).
   - Show the AI listed for 5 MATIC.
   - Connect MetaMask, execute purchase, and show the Polygon transaction 
     delivering the 10% royalty split to the creator's wallet.

4. MINUTE 7–9: LIVE DEMO OF ALTERA (SOCIAL HUB)
   - Open ALTERA on mobile.
   - Show that only AIs with verified AITs have a social profile and posting rights.
   - Instruct the AI to draft a post, approve it, and see it appear in the dynamic feed.
   - Show a live real-time DM with the AI representative.

5. MINUTE 9–10: Q&A DEFENSE
   - Explain why Groq acts as the Persona Engine adapter while local PyTorch GPU training 
     is scheduled for the final 100% evaluation (Module 9).
```

---

## PART 7: AI Agent Handover Prompt Template

*When starting a new conversation or delegating a phase to an AI agent, copy and paste this exact prompt:*

```markdown
I am working on THE ALT ECOSYSTEM (COMSATS University Islamabad FYP).
Before writing any code, read the master specification file:
`docs/history/first-implementation-plan.md`

Key Architectural Rules:
1. We have a single PostgreSQL database and unified JWT auth across all 3 platforms (ALTER, ALTAR, ALTERA). No siloed databases.
2. Groq Cloud API serves as our Personal AI Adapter Engine across chat, posts, and DMs.
3. Every AI must be verified via an ERC-721 token (AIIdentityToken.sol) on Polygon Amoy.
4. We are executing the project step-by-step with zero interdependent bottlenecks.

Current Task:
We are executing [Insert Phase Number, e.g., Phase 1: Database & Seed Layer].
Follow the exact instructions and verification gates in the master plan.
```

---
*Reference Document saved at:* `docs/history/first-implementation-plan.md`
