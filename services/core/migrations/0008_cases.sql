-- The ALT Portal (M3): staff roles and one queue of cases for reports, automatic flags, support
-- requests, disputes and appeals from ALTER, ALTERA and ALTAR.

-- Staff roles beside 'admin'. (New enum values can't be used in the transaction that adds them.)
ALTER TYPE core.user_role ADD VALUE IF NOT EXISTS 'moderator';
ALTER TYPE core.user_role ADD VALUE IF NOT EXISTS 'support';
ALTER TYPE core.user_role ADD VALUE IF NOT EXISTS 'auditor';

CREATE TABLE core.cases (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  number           bigint       GENERATED ALWAYS AS IDENTITY UNIQUE,  -- shown to people as "#1042"
  kind             text         NOT NULL CHECK (kind IN ('report', 'flag', 'support', 'dispute', 'appeal')),
  status           text         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'dismissed')),
  priority         text         NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  platform         text         NOT NULL CHECK (platform IN ('core', 'alter', 'altera', 'altar')),
  category         text         NOT NULL CHECK (category ~ '^[a-z][a-z_]{1,39}$'),
  -- What the case is about, if anything: an id in the owning service (a post, a review...).
  subject_type     text         CHECK (subject_type IN ('ai', 'user', 'post', 'comment', 'review', 'listing', 'message', 'transaction')),
  subject_id       text         CHECK (length(subject_id) <= 200),
  subject_ai_id    uuid         REFERENCES core.personal_ais(id) ON DELETE SET NULL,
  subject_user_id  uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  opened_by        uuid         REFERENCES core.users(id) ON DELETE SET NULL,  -- null: filed by a service
  title            text         NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  reports          integer      NOT NULL DEFAULT 1,  -- reports merged into this case
  assignee_id      uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  resolution       text         CHECK (length(resolution) <= 2000),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  CHECK ((subject_type IS NULL) = (subject_id IS NULL))
);
CREATE INDEX cases_queue_idx ON core.cases (status, updated_at DESC);
CREATE INDEX cases_opened_by_idx ON core.cases (opened_by);
CREATE INDEX cases_subject_idx ON core.cases (platform, subject_type, subject_id);

-- Everything that happened on a case. Visibility: 'staff' (internal notes), 'author' (a person's
-- own report or message: they and staff see it, other reporters don't), 'participants' (staff
-- replies, status changes people should see).
CREATE TABLE core.case_events (
  id             bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id        uuid         NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  at             timestamptz  NOT NULL DEFAULT now(),
  actor_user_id  uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  actor_service  text,
  kind           text         NOT NULL CHECK (kind IN ('opened', 'reported', 'message', 'reply', 'note', 'status', 'assigned', 'priority')),
  visibility     text         NOT NULL CHECK (visibility IN ('staff', 'author', 'participants')),
  body           text         CHECK (length(body) <= 5000),
  data           jsonb        NOT NULL DEFAULT '{}'
);
CREATE INDEX case_events_case_idx ON core.case_events (case_id, id);
CREATE INDEX case_events_actor_idx ON core.case_events (actor_user_id) WHERE actor_user_id IS NOT NULL;
