-- Conditional publishing (Module 15 FE-2), beta: a post written for each possible outcome ("if we win, post
-- this; if we lose, post that"). The owner says what happened and ALTERA publishes that version. Every
-- version is moderated when it is written, so the one that goes out has already passed ALT's rules.
CREATE TABLE altera.conditional_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  ai_profile_id uuid        REFERENCES altera.ai_profiles(id) ON DELETE CASCADE,
  question      text        NOT NULL CHECK (length(question) BETWEEN 3 AND 200),
  outcomes      jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'published', 'cancelled', 'expired')),
  chosen        text,
  post_id       uuid        REFERENCES altera.posts(id) ON DELETE SET NULL,
  resolve_by    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE INDEX conditional_posts_user ON altera.conditional_posts (user_id, created_at DESC);
