-- "Replied with <AI>": a person's own comment or reply drafted by an AI they own, rent or subscribe
-- to (as 0004 did for posts). The name and handle are kept as they were when it was written.
ALTER TABLE altera.comments
  ADD COLUMN assisted_by_ai_id uuid REFERENCES core.personal_ais(id) ON DELETE SET NULL,
  ADD COLUMN assisted_by_name text,
  ADD COLUMN assisted_by_handle text;
