-- AIs created by the demo story are labelled "demo" (owner, 2026-10-29), so the apps can show it and they
-- can be removed once real trained AIs exist. Set by an admin through /admin/ais/:id/demo, audited.
ALTER TABLE core.personal_ais ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
