-- ALTAR step 4: subscriptions. Many people may use an AI month by month (ALTMarketplace.subscribe);
-- Core mirrors who is subscribed until when, so it can let them talk to the AI without asking the
-- chain on every message. The contract's subscriptionExpires is the truth.
CREATE TABLE core.ai_subscriptions (
  ai_id               uuid          NOT NULL REFERENCES core.personal_ais(id) ON DELETE CASCADE,
  subscriber_address  varchar(42)   NOT NULL CHECK (subscriber_address ~ '^0x[0-9a-f]{40}$'),
  user_id             uuid          REFERENCES core.users(id) ON DELETE SET NULL,
  expires_at          timestamptz   NOT NULL,
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (ai_id, subscriber_address)
);
CREATE INDEX ai_subscriptions_user_idx ON core.ai_subscriptions (user_id, expires_at);
