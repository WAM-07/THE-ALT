-- The ALT Command Centre, step 4: what staff do about a case (suspend an AI, remove content, warn,
-- lock an account) is part of the case's history.
ALTER TABLE core.case_events DROP CONSTRAINT case_events_kind_check;
ALTER TABLE core.case_events ADD CONSTRAINT case_events_kind_check
  CHECK (kind IN ('opened', 'reported', 'message', 'reply', 'note', 'status', 'assigned', 'priority', 'action'));
