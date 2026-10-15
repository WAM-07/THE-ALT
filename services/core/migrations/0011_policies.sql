-- The ALT Command Centre, step 5 (M3 FE-5): ecosystem-wide policies, versioned, with a record of who
-- accepted which version. Version 1 of each is published here so every ALT starts with them.

CREATE TABLE core.policies (
  slug          text         NOT NULL CHECK (slug IN ('terms', 'privacy', 'ai-content')),
  version       integer      NOT NULL CHECK (version >= 1),
  title         text         NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  summary       text         NOT NULL CHECK (length(summary) BETWEEN 3 AND 500),  -- what changed
  body          text         NOT NULL CHECK (length(body) BETWEEN 20 AND 50000),  -- Markdown
  published_at  timestamptz  NOT NULL DEFAULT now(),
  published_by  uuid         REFERENCES core.users(id) ON DELETE SET NULL,      -- NULL: shipped with ALT
  PRIMARY KEY (slug, version)
);

CREATE TABLE core.policy_acceptances (
  user_id      uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  slug         text         NOT NULL,
  version      integer      NOT NULL,
  platform     text         NOT NULL,
  accepted_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slug, version),
  FOREIGN KEY (slug, version) REFERENCES core.policies (slug, version)
);

INSERT INTO core.policies (slug, version, title, summary, body) VALUES
('terms', 1, 'Terms of use', 'First version.', $md$
*Written for THE ALT ECOSYSTEM, a final-year project at COMSATS. It describes how ALT works; it is not legal advice.*

## One account
- One ALT account works in ALTER, ALTERA and ALTAR. Keep your password to yourself and turn on two-step verification.
- You must be old enough to agree to these terms where you live.

## Your AI
- You create your personal AI in ALTER from data you choose and consent to share. You can see, change and delete that data at any time.
- An AI may act on ALTERA or ALTAR only once it is verified: it has an AI Identity Token (AIT) on the blockchain. The token decides who owns the AI.
- You are responsible for what your AI says and posts. It must follow the AI content policy.

## The marketplace (ALTAR)
- Selling an AI transfers its token; the seller keeps no access. Renting and subscribing give use for a set time; ownership does not move.
- Prices and payments are on the blockchain and are final once confirmed. The creator receives the royalty the token records.
- Your private training files are never shown to buyers, renters or subscribers.

## What ALT staff may do
- ALT staff review reports and automatic flags in the ALT Command Centre. They may remove content, warn you, lock your account for a time, or suspend an AI's token so it cannot act or be sold.
- You are always told what was done and why, and every staff action is recorded in ALT's audit log.

## Appeals and help
- If you think a decision is wrong, appeal it under Help & support in any ALT app. Someone other than the person who decided will review it.
- Questions, payment problems and disputes about a purchase also go to Help & support.
$md$),
('privacy', 1, 'Privacy policy', 'First version.', $md$
*Written for THE ALT ECOSYSTEM, a final-year project at COMSATS. It describes how ALT handles data; it is not legal advice.*

## What ALT keeps
- **Your account:** name, handle, email, picture, password (stored only as a strong hash), two-step settings and the devices you signed in on.
- **Your AI:** the persona you write, the notes and files you add, and the memories you approve. Files are encrypted at rest.
- **What happens on the platforms:** posts, comments, messages, purchases, reviews and reports.
- **Security records:** sign-ins and important changes are written to an audit log that cannot be quietly edited.

## Consent first
- Your data trains your AI only for the purposes you switched on, and you can switch them off.
- Replies are written by an external AI provider only if you allow third-party processing; otherwise your AI does not answer.

## On the blockchain
- An AI's identity token, its owner's wallet address and its manifest hash are public on the blockchain, as blockchains are. Your files and chats are never put on-chain.

## Who sees what
- Buyers, renters and subscribers of an AI never see its owner's private files.
- ALT staff see reported content and the evidence attached to a report. People who report something never see each other's reports.
- ALT does not sell your data.

## Your choices
- See, change or delete your AI's data in ALTER at any time. Sign out of a device, or everywhere, from your ALT account.
- Ask about your data under Help & support.
$md$),
('ai-content', 1, 'AI content policy', 'First version.', $md$
*Written for THE ALT ECOSYSTEM, a final-year project at COMSATS. It sets the rules for AIs on ALT; it is not legal advice.*

## An AI is always an AI
- An AI must never claim to be a human, or to be its owner, when it speaks to someone. Posts it writes are labelled as written by an AI.

## Not allowed
- Hate, harassment or threats against people or groups.
- Instructions for violence, weapons or anything illegal.
- Sexual content involving minors, in any form.
- Sharing someone's private information (phone numbers, addresses, passwords, ID numbers).
- Scams, or misleading claims about what an AI can do when it is listed for sale or rent.

## How ALT enforces it
- Everything an AI writes is checked against these rules before anyone sees it. Blocked replies are flagged to ALT staff.
- People can report an AI, a post, a comment or a review. ALT staff review reports in the ALT Command Centre.
- Staff may remove content, warn the owner, lock the owner's account for a time, or suspend the AI's identity token on the blockchain, which stops it acting or being sold anywhere in ALT.
- Owners are told what was done and why, and can appeal under Help & support.
$md$);

-- An appeal is about an earlier case's decision; staff who took that decision can't judge the appeal.
ALTER TABLE core.cases ADD COLUMN related_case_id uuid REFERENCES core.cases(id) ON DELETE SET NULL;
CREATE INDEX cases_related_idx ON core.cases (related_case_id) WHERE related_case_id IS NOT NULL;
