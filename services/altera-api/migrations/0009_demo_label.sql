-- An ALTERA AI profile whose AI was made by the demo story shows "Demo" (synced from core.personal_ais.is_demo).
ALTER TABLE altera.ai_profiles ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
