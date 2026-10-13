-- ALTAR step 3: buying and renting.

-- The token's current user (ERC-4907: who is renting it, until when), mirrored from the chain so
-- Core can let a renter talk to the AI without asking the chain on every message.
ALTER TABLE core.ai_identity_tokens
  ADD COLUMN user_address varchar(42) CHECK (user_address ~ '^0x[0-9a-f]{40}$'),
  ADD COLUMN user_expires timestamptz;

-- Where a conversation happens: the owner testing in ALTER ('alter_chat') or a renter on ALTAR
-- ('altar_rental'). Each person only ever sees their own conversations.
ALTER TABLE core.chat_sessions ADD COLUMN channel text NOT NULL DEFAULT 'alter_chat'
  CHECK (channel IN ('alter_chat', 'altar_rental'));

-- How far Core has read the identity registry's events (transfers and rentals).
CREATE TABLE core.chain_cursors (
  name        text         PRIMARY KEY,
  chain_id    integer      NOT NULL,
  block       bigint       NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
