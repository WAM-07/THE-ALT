-- "Posted with <AI>": a person's own post drafted by an AI they own, rent or subscribe to (owner's
-- decision, 2026-10-15). The post stays the person's; the AI's name and handle are kept as they were
-- when it was posted, so the tag survives the rental ending or the AI being renamed.
ALTER TABLE altera.posts
  ADD COLUMN assisted_by_ai_id uuid REFERENCES core.personal_ais(id) ON DELETE SET NULL,
  ADD COLUMN assisted_by_name text,
  ADD COLUMN assisted_by_handle text;
