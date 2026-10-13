-- ALTAR step 3: what happened on the marketplace, built only from the contract's events
-- (Sold, Rented) by ALTAR's indexer. The chain is the record; this is its readable copy.
CREATE TABLE altar.transactions (
  id                bigserial      PRIMARY KEY,
  kind              text           NOT NULL CHECK (kind IN ('sale', 'rental')),
  ai_id             uuid           REFERENCES core.personal_ais(id) ON DELETE SET NULL,
  token_id          numeric(78,0)  NOT NULL,
  -- Seller (sale) or owner (rental), and buyer or renter.
  from_address      varchar(42)    NOT NULL,
  to_address        varchar(42)    NOT NULL,
  from_user_id      uuid           REFERENCES core.users(id) ON DELETE SET NULL,
  to_user_id        uuid           REFERENCES core.users(id) ON DELETE SET NULL,
  amount_wei        numeric(78,0)  NOT NULL,
  royalty_wei       numeric(78,0)  NOT NULL DEFAULT 0,
  royalty_address   varchar(42),
  royalty_user_id   uuid           REFERENCES core.users(id) ON DELETE SET NULL,
  fee_wei           numeric(78,0)  NOT NULL DEFAULT 0,
  days              integer,
  expires_at        timestamptz,
  chain_id          integer        NOT NULL,
  tx_hash           text           NOT NULL,
  log_index         integer        NOT NULL,
  block_number      bigint         NOT NULL,
  occurred_at       timestamptz    NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX transactions_ai_idx ON altar.transactions (ai_id, occurred_at DESC);
CREATE INDEX transactions_from_idx ON altar.transactions (from_user_id);
CREATE INDEX transactions_to_idx ON altar.transactions (to_user_id);
CREATE INDEX transactions_royalty_idx ON altar.transactions (royalty_user_id);

-- Rentals, as the roadmap names them.
CREATE VIEW altar.rentals AS
SELECT id, ai_id, token_id, from_user_id AS owner_user_id, to_address AS renter_address, to_user_id AS renter_user_id,
       days, expires_at, amount_wei AS paid_wei, tx_hash, occurred_at
  FROM altar.transactions WHERE kind = 'rental';

-- How far the indexer has read the marketplace contract.
CREATE TABLE altar.indexer_cursor (
  name        text         PRIMARY KEY,
  chain_id    integer      NOT NULL,
  block       bigint       NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
