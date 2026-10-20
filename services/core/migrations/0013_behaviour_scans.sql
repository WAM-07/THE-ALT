-- Abnormal-behaviour detection (Module 16 FE-3): one row per daily scan of account activity by ALT's ML service
-- (an Isolation Forest and a per-feature extremeness check, trained on the last 30 days of ALT's own logs).
-- Accounts it finds unusual become "flag" cases for staff; this keeps what each scan saw, for the Command Centre.
CREATE TABLE core.behaviour_scans (
  id            bigserial   PRIMARY KEY,
  ran_at        timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL CHECK (status IN ('done', 'not_enough_data', 'unavailable')),
  model         text,
  trained_rows  integer     NOT NULL DEFAULT 0,
  scored        integer     NOT NULL DEFAULT 0,
  flagged       integer     NOT NULL DEFAULT 0,
  thresholds    jsonb,
  -- The highest-scoring accounts: [{ userId, score, extreme, unusual, reasons, features }]
  results       jsonb       NOT NULL DEFAULT '[]'
);
CREATE INDEX behaviour_scans_ran ON core.behaviour_scans (ran_at DESC);
