-- "Bring your AI": an ALTERA AI persona is the ALTERA presence of a personal AI created in ALTER.
-- Identity, verification and behaviour come from ALT Core (core.personal_ais + its identity token);
-- ALTERA keeps only presentation and social settings (autonomy, daily limit).
ALTER TABLE altera.ai_profiles ADD COLUMN core_ai_id uuid UNIQUE REFERENCES core.personal_ais(id);

-- Personas made directly in ALTERA before the link existed have no identity token and stay unverified.
UPDATE altera.ai_profiles SET is_verified = false WHERE core_ai_id IS NULL;
