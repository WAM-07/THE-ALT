-- Readiness and the approval loop (Module 9 FE-2/FE-4; owner's plan E2). The owner writes questions with
-- their own answers (the evaluation set); each trained version answers them and gets a readiness score;
-- the owner approves the version or trains again; ALT's system check needs readiness and safety.

-- The owner's questions and their own answers. Answers are personal data: encrypted (AES-256-GCM, like
-- datasets) and seen only by the owner.
CREATE TABLE core.ai_eval_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_id       uuid        NOT NULL REFERENCES core.personal_ais(id),
  question    text        NOT NULL CHECK (length(question) BETWEEN 3 AND 500),
  answer_enc  text        NOT NULL,
  created_by  uuid        NOT NULL REFERENCES core.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX ai_eval_items_ai ON core.ai_eval_items (ai_id) WHERE deleted_at IS NULL;

-- One run of a version over the evaluation set. `items` holds, per question, the AI's answer and scores.
CREATE TABLE core.ai_evaluations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_id        uuid        NOT NULL REFERENCES core.personal_ais(id),
  version_id   uuid        NOT NULL REFERENCES core.ai_versions(id),
  status       text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  readiness    numeric(5, 2) CHECK (readiness BETWEEN 0 AND 100),
  safe         boolean,
  items        jsonb       NOT NULL DEFAULT '[]',
  error        text,
  requested_by uuid        NOT NULL REFERENCES core.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ai_evaluations_version ON core.ai_evaluations (version_id, created_at DESC);

-- The owner's verdict on a version: it behaves like me (approved), or not yet (rejected → train again).
ALTER TABLE core.ai_versions
  ADD COLUMN owner_verdict    text CHECK (owner_verdict IN ('approved', 'rejected')),
  ADD COLUMN owner_verdict_at timestamptz,
  ADD COLUMN owner_note       text CHECK (length(owner_note) <= 500);
