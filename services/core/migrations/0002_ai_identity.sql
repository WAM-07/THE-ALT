-- ALT Core: personal AIs and everything that makes them trustworthy.
-- Modules 6 (versions), 7 (health score field), 8 (consent, datasets), 9 (lifecycle, training jobs),
-- 10 (chat, memories) and 17 (identity tokens). Mirrors SDS tables 3.4-3.7 where possible.

CREATE TYPE core.ai_status AS ENUM ('draft', 'training', 'ready', 'minting', 'verified', 'suspended', 'retired');

-- SDS Table 3.4. Born in ALTER. creator_id never changes; owner_id follows the identity token.
CREATE TABLE core.personal_ais (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid           NOT NULL REFERENCES core.users(id),
  creator_id         uuid           NOT NULL REFERENCES core.users(id),
  handle             citext         NOT NULL UNIQUE CHECK (handle ~ '^[A-Za-z0-9_.]{3,30}$'),
  name               varchar(80)    NOT NULL,
  description        varchar(500),
  avatar_url         text,
  category           varchar(40)    NOT NULL DEFAULT 'personal',
  status             core.ai_status NOT NULL DEFAULT 'draft',
  -- Persona being edited in ALTER (system prompt, traits, style sliders, boundaries).
  draft_config       jsonb          NOT NULL DEFAULT '{}',
  current_version_id uuid,
  royalty_bps        smallint       NOT NULL DEFAULT 500 CHECK (royalty_bps BETWEEN 0 AND 1000),
  health_score       numeric(5,2)   NOT NULL DEFAULT 100.00,
  owner_confirmed_at timestamptz,   -- "this behaves like me" (clearance gate)
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX personal_ais_owner ON core.personal_ais (owner_id) WHERE deleted_at IS NULL;
CREATE TRIGGER personal_ais_touch BEFORE UPDATE ON core.personal_ais FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- Module 6: an immutable snapshot of the AI's behaviour. Its public manifest (hashes only) is on IPFS.
CREATE TABLE core.ai_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_id            uuid        NOT NULL REFERENCES core.personal_ais(id),
  version_no       integer     NOT NULL,
  persona_config   jsonb       NOT NULL,
  base_model       varchar(100) NOT NULL,
  dataset_ids      uuid[]      NOT NULL DEFAULT '{}',
  memory_ids       uuid[]      NOT NULL DEFAULT '{}',
  manifest         jsonb       NOT NULL,
  manifest_cid     text        NOT NULL UNIQUE,
  manifest_sha256  char(64)    NOT NULL,
  onchain_tx_hash  text,
  created_by       uuid        NOT NULL REFERENCES core.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (ai_id, version_no)
);
ALTER TABLE core.personal_ais
  ADD CONSTRAINT personal_ais_current_version FOREIGN KEY (current_version_id) REFERENCES core.ai_versions(id);

CREATE FUNCTION core.ai_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.persona_config IS DISTINCT FROM OLD.persona_config OR NEW.manifest IS DISTINCT FROM OLD.manifest
     OR NEW.manifest_cid IS DISTINCT FROM OLD.manifest_cid OR NEW.dataset_ids IS DISTINCT FROM OLD.dataset_ids
     OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.ai_id IS DISTINCT FROM OLD.ai_id THEN
    RAISE EXCEPTION 'AI versions are immutable; build a new version instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_versions_no_edit BEFORE UPDATE ON core.ai_versions FOR EACH ROW EXECUTE FUNCTION core.ai_versions_immutable();

-- SDS Table 3.5. Mirror of the on-chain AIT (the chain is the source of truth).
CREATE TABLE core.ai_identity_tokens (
  ai_id            uuid PRIMARY KEY REFERENCES core.personal_ais(id),
  token_id         numeric(78,0) NOT NULL,
  chain_id         integer     NOT NULL,
  contract_address varchar(42) NOT NULL,
  creator_address  varchar(42) NOT NULL,
  owner_address    varchar(42) NOT NULL,
  mint_tx_hash     text        NOT NULL UNIQUE,
  version          integer     NOT NULL DEFAULT 1,
  suspended        boolean     NOT NULL DEFAULT false,
  minted_at        timestamptz NOT NULL DEFAULT now(),
  synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, contract_address, token_id)
);

-- Module 8: consent is an append-only history; the current state is the latest event per scope.
CREATE TABLE core.consent_events (
  id             bigserial PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES core.users(id),
  ai_id          uuid        REFERENCES core.personal_ais(id),
  scope          text        NOT NULL CHECK (scope IN ('persona_training', 'third_party_processing', 'public_deployment', 'interaction_learning')),
  granted        boolean     NOT NULL,
  policy_version text        NOT NULL,
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_events_latest ON core.consent_events (ai_id, scope, id DESC);

-- SDS Table 3.6. Personal data used to build the AI. Files are encrypted at rest; only the owner sees them.
CREATE TABLE core.datasets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_id             uuid         NOT NULL REFERENCES core.personal_ais(id),
  owner_id          uuid         NOT NULL REFERENCES core.users(id),
  kind              text         NOT NULL CHECK (kind IN ('text', 'document', 'image', 'voice', 'chat_export')),
  title             varchar(120) NOT NULL,
  file_name         varchar(255),
  mime_type         varchar(100),
  size_bytes        bigint       NOT NULL DEFAULT 0,
  storage_key       text,
  sha256            char(64)     NOT NULL,
  training_category text         NOT NULL DEFAULT 'knowledge' CHECK (training_category IN ('personality', 'knowledge', 'communication_style', 'preferences')),
  -- Per-item consent (Module 8 FE-5): only included items are used to build versions.
  included          boolean      NOT NULL DEFAULT true,
  is_processed      boolean      NOT NULL DEFAULT false,
  text_chars        integer      NOT NULL DEFAULT 0,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX datasets_ai ON core.datasets (ai_id) WHERE deleted_at IS NULL;
CREATE TRIGGER datasets_touch BEFORE UPDATE ON core.datasets FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- Module 10 FE-6: facts and preferences the AI remembers. Only owner-approved memories are used.
CREATE TABLE core.ai_memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_id       uuid         NOT NULL REFERENCES core.personal_ais(id),
  content     varchar(500) NOT NULL,
  source      text         NOT NULL CHECK (source IN ('owner', 'chat')),
  status      text         NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'discarded')),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX ai_memories_ai ON core.ai_memories (ai_id, status);

-- SDS Table 3.7. Lifecycle of building a version (Module 9).
CREATE TABLE core.training_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_id          uuid        NOT NULL REFERENCES core.personal_ais(id),
  initiated_by   uuid        NOT NULL REFERENCES core.users(id),
  status         text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress       smallint    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  stage          text,
  version_id     uuid        REFERENCES core.ai_versions(id),
  error_code     text,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  completed_at   timestamptz
);
CREATE INDEX training_jobs_ai ON core.training_jobs (ai_id, created_at DESC);

-- Module 10: conversations with your AI in ALTER.
CREATE TABLE core.chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_id       uuid         NOT NULL REFERENCES core.personal_ais(id),
  user_id     uuid         NOT NULL REFERENCES core.users(id),
  title       varchar(120),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX chat_sessions_ai_user ON core.chat_sessions (ai_id, user_id, updated_at DESC);

CREATE TABLE core.chat_messages (
  id          bigserial PRIMARY KEY,
  session_id  uuid        NOT NULL REFERENCES core.chat_sessions(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text        NOT NULL,
  version_id  uuid        REFERENCES core.ai_versions(id),
  model       text,
  latency_ms  integer,
  flagged     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_session ON core.chat_messages (session_id, id);

-- Every AI response anywhere in the ecosystem (Modules 5, 7, 18).
CREATE TABLE core.interaction_log (
  id             bigserial PRIMARY KEY,
  ai_id          uuid        NOT NULL REFERENCES core.personal_ais(id),
  version_id     uuid        REFERENCES core.ai_versions(id),
  channel        text        NOT NULL,
  caller_user_id uuid,
  caller_service text,
  provider       text        NOT NULL,
  model          text,
  latency_ms     integer     NOT NULL,
  tokens_in      integer,
  tokens_out     integer,
  flagged        boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interaction_log_ai ON core.interaction_log (ai_id, created_at DESC);

-- Durable background jobs (minting, publishing versions). Workers claim rows with FOR UPDATE SKIP LOCKED.
CREATE TABLE core.jobs (
  id            bigserial PRIMARY KEY,
  kind          text        NOT NULL,
  payload       jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts      smallint    NOT NULL DEFAULT 0,
  max_attempts  smallint    NOT NULL DEFAULT 5,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  last_error    text,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready ON core.jobs (run_after) WHERE status = 'queued';
CREATE TRIGGER jobs_touch BEFORE UPDATE ON core.jobs FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
