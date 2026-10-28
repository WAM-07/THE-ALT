-- Module 7: the AI Health Score. One score per AI (0–100) from how it behaves: safe replies, reports and
-- staff decisions, readiness on the owner's questions, ratings on ALTAR, speed, and drift between
-- versions. personal_ais.health_score holds the latest; this table keeps the history with its parts.
CREATE TABLE core.ai_health (
  id          bigserial PRIMARY KEY,
  ai_id       uuid         NOT NULL REFERENCES core.personal_ais(id) ON DELETE CASCADE,
  score       numeric(5, 2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  components  jsonb        NOT NULL,
  computed_at timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ai_health_ai ON core.ai_health (ai_id, computed_at DESC);
