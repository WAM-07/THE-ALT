-- Module 2: what a person wants to hear about. Categories they mute stay out of their ALT inbox, push
-- can be muted separately, and an e-mail digest of what they have not read can be daily or weekly.
-- Security and system notices are never muted (enforced in lib/notify.ts and the API).
CREATE TABLE core.notification_settings (
  user_id        uuid        PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
  muted          text[]      NOT NULL DEFAULT '{}',
  push_muted     text[]      NOT NULL DEFAULT '{}',
  digest         text        NOT NULL DEFAULT 'off' CHECK (digest IN ('off', 'daily', 'weekly')),
  last_digest_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
