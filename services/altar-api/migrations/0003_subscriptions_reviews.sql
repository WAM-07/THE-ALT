-- ALTAR step 4.

-- Subscriptions are on-chain now (ALTMarketplace.subscribe): they join the history.
ALTER TABLE altar.transactions DROP CONSTRAINT transactions_kind_check;
ALTER TABLE altar.transactions ADD CONSTRAINT transactions_kind_check CHECK (kind IN ('sale', 'rental', 'subscription'));
ALTER TABLE altar.transactions ADD COLUMN months integer;

-- Reviews, only from people who really bought, rented or subscribed to the AI (checked against
-- altar.transactions, i.e. the chain). One per person per AI; they can edit or remove it.
CREATE TABLE altar.reviews (
  ai_id        uuid         NOT NULL REFERENCES core.personal_ais(id) ON DELETE CASCADE,
  reviewer_id  uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  rating       smallint     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body         text         CHECK (char_length(body) <= 1000),
  -- How they used it, from the chain: 'bought', 'rented' or 'subscribed'.
  basis        text         NOT NULL CHECK (basis IN ('bought', 'rented', 'subscribed')),
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (ai_id, reviewer_id)
);
CREATE INDEX reviews_ai_idx ON altar.reviews (ai_id, updated_at DESC);
