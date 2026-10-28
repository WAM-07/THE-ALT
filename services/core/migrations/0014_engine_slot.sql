-- The engine slot (owner's plan, 2026-10-16: "the engine and the car"). Every AI version records which
-- engine speaks for it: `base` (a large cloud model with the persona and retrieval, the temporary engine)
-- or `adapter` (a model trained on the owner's data). Only a trained version can be verified.

-- Training jobs (Module 9) now really train: queued for a trainer, claimed, checkpoints, result.
ALTER TABLE core.training_jobs
  -- base = the old "build a version" snapshot; cloud = ALT's trainer; local = trained on the owner's GPU;
  -- simulated = the labelled stand-in used until the real trainer exists (development and the demo).
  ADD COLUMN mode             text        NOT NULL DEFAULT 'base' CHECK (mode IN ('base', 'cloud', 'local', 'simulated')),
  -- What the training uses, frozen when it starts (the consented data at that moment).
  ADD COLUMN persona_config   jsonb,
  ADD COLUMN dataset_ids      uuid[]      NOT NULL DEFAULT '{}',
  ADD COLUMN memory_ids       uuid[]      NOT NULL DEFAULT '{}',
  ADD COLUMN base_model       text,
  ADD COLUMN checkpoints      jsonb       NOT NULL DEFAULT '[]',
  ADD COLUMN claimed_by       text,
  ADD COLUMN claimed_at       timestamptz,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN adapter_sha256   char(64),
  ADD COLUMN adapter_uri      text,
  ADD COLUMN scores           jsonb,
  -- The trainer's statement that it deleted the training data it was given.
  ADD COLUMN data_deleted_at  timestamptz;
CREATE INDEX training_jobs_queue ON core.training_jobs (created_at) WHERE status IN ('queued', 'running') AND mode = 'cloud';
CREATE UNIQUE INDEX training_jobs_one_active ON core.training_jobs (ai_id) WHERE status IN ('queued', 'running') AND mode <> 'base';

ALTER TABLE core.ai_versions
  ADD COLUMN engine          text        NOT NULL DEFAULT 'base' CHECK (engine IN ('base', 'adapter')),
  ADD COLUMN training_mode   text        CHECK (training_mode IN ('cloud', 'local', 'simulated')),
  ADD COLUMN training_job_id uuid        REFERENCES core.training_jobs(id),
  ADD COLUMN adapter_sha256  char(64),
  ADD COLUMN adapter_uri     text,
  ADD COLUMN readiness       numeric(5, 2) CHECK (readiness BETWEEN 0 AND 100),
  ADD CONSTRAINT ai_versions_adapter_complete
    CHECK (engine = 'base' OR (training_mode IS NOT NULL AND training_job_id IS NOT NULL AND adapter_sha256 IS NOT NULL));

-- Versions stay immutable, the engine included.
CREATE FUNCTION core.ai_versions_engine_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.engine IS DISTINCT FROM OLD.engine OR NEW.training_mode IS DISTINCT FROM OLD.training_mode
     OR NEW.training_job_id IS DISTINCT FROM OLD.training_job_id OR NEW.adapter_sha256 IS DISTINCT FROM OLD.adapter_sha256
     OR NEW.adapter_uri IS DISTINCT FROM OLD.adapter_uri THEN
    RAISE EXCEPTION 'AI versions are immutable; build a new version instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_versions_engine_no_edit BEFORE UPDATE ON core.ai_versions FOR EACH ROW EXECUTE FUNCTION core.ai_versions_engine_immutable();
