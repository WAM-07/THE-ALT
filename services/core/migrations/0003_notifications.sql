-- Module 2: one notification inbox for the whole ecosystem. Every ALT app shows the same inbox;
-- `platform` says which app (or Core) the event came from, `link` where to go when it is tapped.
CREATE TABLE core.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  category    text         NOT NULL CHECK (category IN ('ai', 'security', 'moderation', 'social', 'transaction', 'system')),
  type        text         NOT NULL,
  title       varchar(140) NOT NULL,
  body        varchar(1000),
  data        jsonb        NOT NULL DEFAULT '{}',
  platform    text         NOT NULL DEFAULT 'core' CHECK (platform IN ('core', 'alter', 'altera', 'altar', 'admin')),
  link        text,
  read_at     timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_recent ON core.notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_unread ON core.notifications (user_id) WHERE read_at IS NULL;
