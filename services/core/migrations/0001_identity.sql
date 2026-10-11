-- ALT Core: one account for the whole ecosystem (Module 1), plus the audit log (Module 5)
-- and the event outbox other services consume.

CREATE SCHEMA IF NOT EXISTS core;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE core.platform  AS ENUM ('alter', 'altera', 'altar', 'admin');
CREATE TYPE core.user_role AS ENUM ('creator', 'consumer', 'participant', 'admin');

CREATE FUNCTION core.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- SDS Table 3.3. Email is optional only for accounts created by wallet sign-in.
CREATE TABLE core.users (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle                    citext       NOT NULL UNIQUE CHECK (handle ~ '^[A-Za-z0-9_.]{3,30}$'),
  email                     citext       UNIQUE,
  email_verified_at         timestamptz,
  display_name              varchar(80)  NOT NULL,
  bio                       varchar(500),
  avatar_url                text,
  password_hash             text,
  roles                     core.user_role[] NOT NULL DEFAULT '{participant}',
  failed_login_count        smallint     NOT NULL DEFAULT 0,
  locked_until              timestamptz,
  two_fa_enabled            boolean      NOT NULL DEFAULT false,
  two_fa_secret_enc         text,
  two_fa_pending_secret_enc text,
  two_fa_last_step          bigint,
  last_login_at             timestamptz,
  created_at                timestamptz  NOT NULL DEFAULT now(),
  updated_at                timestamptz  NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);
CREATE TRIGGER users_touch BEFORE UPDATE ON core.users FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TABLE core.two_fa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  code_hash  text        NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX two_fa_recovery_codes_user ON core.two_fa_recovery_codes (user_id);

-- External sign-in providers (Google today). Passwords live on core.users, wallets in core.wallets.
CREATE TABLE core.auth_identities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  provider   text        NOT NULL CHECK (provider IN ('google')),
  subject    text        NOT NULL,
  email      citext,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX auth_identities_user ON core.auth_identities (user_id);

-- One row per signed-in device. Refresh tokens are stored hashed and rotated on every use;
-- presenting the previous token again means it was stolen, and the session is revoked.
CREATE TABLE core.sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid          NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  platform          core.platform NOT NULL,
  device_name       varchar(120),
  user_agent        text,
  ip                inet,
  refresh_hash      text          NOT NULL UNIQUE,
  prev_refresh_hash text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  last_used_at      timestamptz   NOT NULL DEFAULT now(),
  expires_at        timestamptz   NOT NULL,
  revoked_at        timestamptz,
  revoke_reason     text
);
CREATE INDEX sessions_user_active ON core.sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE core.otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  email       citext      NOT NULL,
  purpose     text        NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code_hash   text        NOT NULL,
  attempts    smallint    NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_lookup ON core.otp_codes (email, purpose) WHERE consumed_at IS NULL;

-- Single-use codes that move a signed-in user from one ALT app to another without a password.
CREATE TABLE core.handoff_codes (
  code_hash         text PRIMARY KEY,
  user_id           uuid          NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  source_session_id uuid          REFERENCES core.sessions(id) ON DELETE SET NULL,
  target            core.platform NOT NULL,
  expires_at        timestamptz   NOT NULL,
  used_at           timestamptz,
  created_at        timestamptz   NOT NULL DEFAULT now()
);

-- Sign-In With Ethereum (EIP-4361) nonces.
CREATE TABLE core.siwe_nonces (
  nonce      text PRIMARY KEY,
  purpose    text        NOT NULL CHECK (purpose IN ('login', 'link')),
  user_id    uuid        REFERENCES core.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every account gets a custodial wallet; users may link their own (MetaMask etc.) and make it primary.
CREATE TABLE core.wallets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  address         varchar(42) NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-f]{40}$'),
  kind            text        NOT NULL CHECK (kind IN ('custodial', 'external')),
  private_key_enc text,
  is_primary      boolean     NOT NULL DEFAULT false,
  label           varchar(60),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'custodial') = (private_key_enc IS NOT NULL))
);
CREATE UNIQUE INDEX wallets_one_primary   ON core.wallets (user_id) WHERE is_primary;
CREATE UNIQUE INDEX wallets_one_custodial ON core.wallets (user_id) WHERE kind = 'custodial';

-- Which ALT platforms a user has opened ("connected platforms" in the account centre).
CREATE TABLE core.platform_memberships (
  user_id   uuid          NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  platform  core.platform NOT NULL,
  joined_at timestamptz   NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);

-- Module 5: append-only, hash-chained. Each row's hash covers the previous row's hash,
-- so editing or deleting history breaks the chain and is detectable.
CREATE TABLE core.audit_log (
  id            bigserial PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_service text,
  action        text        NOT NULL,
  entity_type   text,
  entity_id     text,
  ip            inet,
  data          jsonb       NOT NULL DEFAULT '{}',
  prev_hash     text,
  hash          text        NOT NULL
);
CREATE INDEX audit_log_actor  ON core.audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX audit_log_entity ON core.audit_log (entity_type, entity_id);

CREATE FUNCTION core.audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'core.audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON core.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.audit_log_immutable();

-- Transactional outbox: events are written in the same transaction as the change they describe,
-- then delivered to other services (and to Socket.io) by the dispatcher.
CREATE TABLE core.outbox (
  id           bigserial PRIMARY KEY,
  topic        text        NOT NULL,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON core.outbox (id) WHERE published_at IS NULL;
