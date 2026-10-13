-- ALTAR's own data. People and AIs live in ALT Core (core.users, core.personal_ais); prices and
-- ownership are decided on-chain by ALTMarketplace and AITRegistry. This schema keeps what the chain
-- doesn't: how a seller describes the offer, subscription prices (on-chain from step 4), a mirror of
-- the on-chain listing for fast browsing, and each person's saved AIs.
CREATE SCHEMA IF NOT EXISTS altar;

CREATE TABLE altar.listings (
  ai_id                   uuid           PRIMARY KEY REFERENCES core.personal_ais(id) ON DELETE CASCADE,
  token_id                numeric(78,0)  NOT NULL,
  seller_id               uuid           NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  pitch                   text           CHECK (char_length(pitch) <= 280),
  terms                   text           CHECK (char_length(terms) <= 2000),
  -- Mirror of ALTMarketplace, refreshed whenever the seller saves (an indexer keeps it fresh from step 3).
  sale_price_wei          numeric(78,0),
  rent_price_per_day_wei  numeric(78,0),
  rent_max_days           integer        CHECK (rent_max_days BETWEEN 1 AND 365),
  -- Monthly subscription: the seller's price; subscribing opens when the contract supports it (step 4).
  subscription_price_wei  numeric(78,0),
  synced_at               timestamptz    NOT NULL DEFAULT now(),
  created_at              timestamptz    NOT NULL DEFAULT now(),
  updated_at              timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX listings_seller_idx ON altar.listings (seller_id);

-- AIs a person keeps an eye on ("Saved").
CREATE TABLE altar.wishlist (
  user_id     uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  ai_id       uuid         NOT NULL REFERENCES core.personal_ais(id) ON DELETE CASCADE,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ai_id)
);
