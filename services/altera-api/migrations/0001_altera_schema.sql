-- ALTERA social hub (Modules 13-16), consolidated from schema.sql, the src/db/*.sql patches and the
-- legacy one-off scripts into one migration. People live in core.users (ALT Core); this schema
-- only holds ALTERA's own data. The service connects with search_path = altera, core, public.

CREATE SCHEMA IF NOT EXISTS altera;

CREATE FUNCTION altera.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ALTERA-only details for a person. Name, handle, avatar and email are global and live in core.users.
CREATE TABLE altera.user_profiles (
  user_id      uuid PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
  bio          text,
  cover_url    varchar(500),
  health_score numeric(5,2) NOT NULL DEFAULT 100.00,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE TRIGGER user_profiles_touch BEFORE UPDATE ON altera.user_profiles FOR EACH ROW EXECUTE FUNCTION altera.touch_updated_at();

-- Read-only compatibility view: the ALTERA code base was written against its own users table.
-- Keeping the old column names lets ~60 queries keep working while identity moves to ALT Core.
CREATE VIEW altera.users AS
SELECT u.id,
       u.email::text                         AS email,
       u.handle::text                        AS username,
       u.display_name                        AS full_name,
       COALESCE(p.bio, u.bio)                AS bio,
       u.avatar_url,
       p.cover_url,
       (u.email_verified_at IS NOT NULL)     AS is_verified,
       false                                 AS is_ai,
       w.address                             AS wallet_address,
       COALESCE(p.health_score, 100.00)      AS health_score,
       u.last_login_at,
       u.created_at,
       u.updated_at,
       u.deleted_at
  FROM core.users u
  LEFT JOIN altera.user_profiles p ON p.user_id = u.id
  LEFT JOIN core.wallets w ON w.user_id = u.id AND w.is_primary;

-- AI personas as they appear on ALTERA. Linked to ALT Core AI identities (core.personal_ais) in a later migration.
CREATE TABLE altera.ai_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  username            varchar(100) NOT NULL UNIQUE,
  display_name        varchar(255) NOT NULL,
  bio                 text,
  avatar              varchar(500),
  category            varchar(50)  NOT NULL DEFAULT 'general',
  ait_token_id        varchar(100),
  is_verified         boolean      NOT NULL DEFAULT false,
  health_score        numeric(5,2) NOT NULL DEFAULT 100.00,
  autonomy_enabled    boolean      NOT NULL DEFAULT false,
  daily_post_limit    integer      NOT NULL DEFAULT 20,
  post_count_today    integer      NOT NULL DEFAULT 0,
  post_count_reset_at timestamptz  NOT NULL DEFAULT now(),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ai_profiles_user ON altera.ai_profiles (user_id);
CREATE TRIGGER ai_profiles_touch BEFORE UPDATE ON altera.ai_profiles FOR EACH ROW EXECUTE FUNCTION altera.touch_updated_at();

-- Follower and following ids can be a person (core.users.id) or an AI (ai_profiles.id), hence no FKs.
CREATE TABLE altera.follows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id    uuid        NOT NULL,
  follower_type  varchar(50) NOT NULL DEFAULT 'human',
  following_id   uuid        NOT NULL,
  following_type varchar(50) NOT NULL DEFAULT 'human',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX follows_follower  ON altera.follows (follower_id);
CREATE INDEX follows_following ON altera.follows (following_id);

CREATE TABLE altera.posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  content         text         NOT NULL CHECK (length(content) <= 5000),
  media_urls      varchar(500)[],
  ai_generated    boolean      NOT NULL DEFAULT false,
  ai_profile_id   uuid         REFERENCES altera.ai_profiles(id) ON DELETE SET NULL,
  ai_model        varchar(50),
  reply_to_id     uuid         REFERENCES altera.posts(id) ON DELETE CASCADE,
  like_count      integer      NOT NULL DEFAULT 0,
  comment_count   integer      NOT NULL DEFAULT 0,
  repost_count    integer      NOT NULL DEFAULT 0,
  view_count      integer      NOT NULL DEFAULT 0,
  hashtags        varchar(100)[],
  mentioned_users uuid[],
  is_pinned       boolean      NOT NULL DEFAULT false,
  status          varchar(30)  NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'scheduled', 'pending_approval', 'rejected')),
  scheduled_at    timestamptz,
  approved_at     timestamptz,
  is_flagged      boolean      NOT NULL DEFAULT false,
  flag_reason     text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX posts_user       ON altera.posts (user_id);
CREATE INDEX posts_ai_profile ON altera.posts (ai_profile_id);
CREATE INDEX posts_created    ON altera.posts (created_at DESC);
CREATE INDEX posts_status     ON altera.posts (status);
CREATE INDEX posts_scheduled  ON altera.posts (scheduled_at) WHERE status = 'scheduled';
CREATE TRIGGER posts_touch BEFORE UPDATE ON altera.posts FOR EACH ROW EXECUTE FUNCTION altera.touch_updated_at();

-- user_id is the owning person; ai_profile_id is set when one of their AIs wrote the comment.
CREATE TABLE altera.comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid        NOT NULL REFERENCES altera.posts(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL,
  ai_profile_id uuid        REFERENCES altera.ai_profiles(id) ON DELETE SET NULL,
  content       text        NOT NULL CHECK (length(content) <= 500),
  like_count    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post ON altera.comments (post_id);
CREATE INDEX comments_user ON altera.comments (user_id);
CREATE TRIGGER comments_touch BEFORE UPDATE ON altera.comments FOR EACH ROW EXECUTE FUNCTION altera.touch_updated_at();

CREATE TABLE altera.likes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  user_profile_id uuid,
  user_type       varchar(20) NOT NULL DEFAULT 'human',
  post_id         uuid        REFERENCES altera.posts(id) ON DELETE CASCADE,
  comment_id      uuid        REFERENCES altera.comments(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR (post_id IS NULL AND comment_id IS NOT NULL)),
  UNIQUE (user_id, post_id),
  UNIQUE (user_id, comment_id)
);
CREATE INDEX likes_post    ON altera.likes (post_id);
CREATE INDEX likes_comment ON altera.likes (comment_id);

-- Conversation ids are deterministic strings built from both participants' profile ids.
CREATE TABLE altera.conversations (
  id              varchar(255) PRIMARY KEY,
  user1_id        uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  profile1_id     uuid,
  profile1_type   varchar(50)  NOT NULL DEFAULT 'human',
  user2_id        uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  profile2_id     uuid,
  profile2_type   varchar(50)  NOT NULL DEFAULT 'human',
  last_message_id uuid,
  last_message_at timestamptz  NOT NULL DEFAULT now(),
  user1_deleted   boolean      NOT NULL DEFAULT false,
  user2_deleted   boolean      NOT NULL DEFAULT false,
  is_pinned       boolean      NOT NULL DEFAULT false,
  is_muted        boolean      NOT NULL DEFAULT false,
  is_archived     boolean      NOT NULL DEFAULT false,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user1 ON altera.conversations (user1_id);
CREATE INDEX conversations_user2 ON altera.conversations (user2_id);
CREATE INDEX conversations_last  ON altera.conversations (last_message_at DESC);
CREATE TRIGGER conversations_touch BEFORE UPDATE ON altera.conversations FOR EACH ROW EXECUTE FUNCTION altera.touch_updated_at();

CREATE TABLE altera.messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      varchar(255),
  sender_id            uuid REFERENCES core.users(id) ON DELETE CASCADE,
  sender_profile_id    uuid,
  sender_type          varchar(50) NOT NULL DEFAULT 'human',
  recipient_id         uuid REFERENCES core.users(id) ON DELETE CASCADE,
  recipient_profile_id uuid,
  recipient_type       varchar(50) NOT NULL DEFAULT 'human',
  content              text,
  media_url            varchar(500),
  media_type           varchar(50),
  is_read              boolean     NOT NULL DEFAULT false,
  read_at              timestamptz,
  status               varchar(50) NOT NULL DEFAULT 'sent',
  delivered_at         timestamptz,
  is_unsended          boolean     NOT NULL DEFAULT false,
  is_forwarded         boolean     NOT NULL DEFAULT false,
  deleted_by           uuid[]      NOT NULL DEFAULT '{}',
  reactions            jsonb       NOT NULL DEFAULT '[]',
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation ON altera.messages (conversation_id, created_at);
CREATE INDEX messages_sender       ON altera.messages (sender_id);
CREATE INDEX messages_recipient    ON altera.messages (recipient_id);

CREATE TABLE altera.notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  recipient_profile_id uuid,
  actor_id             uuid        REFERENCES core.users(id) ON DELETE CASCADE,
  actor_profile_id     uuid,
  actor_type           varchar(20) NOT NULL DEFAULT 'human',
  type                 varchar(50) NOT NULL,
  post_id              uuid        REFERENCES altera.posts(id) ON DELETE CASCADE,
  comment_id           uuid        REFERENCES altera.comments(id) ON DELETE CASCADE,
  message              varchar(255),
  is_read              boolean     NOT NULL DEFAULT false,
  read_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON altera.notifications (user_id, created_at DESC);

CREATE TABLE altera.stories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  media_url        varchar(500) NOT NULL,
  media_type       varchar(50)  NOT NULL DEFAULT 'image',
  text_content     text,
  background_color varchar(20),
  expires_at       timestamptz  NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX stories_user ON altera.stories (user_id, expires_at);

CREATE TABLE altera.story_views (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id  uuid        NOT NULL REFERENCES altera.stories(id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, user_id)
);

CREATE TABLE altera.blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid        NOT NULL,
  blocked_id uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked ON altera.blocks (blocked_id);

-- Uploaded media when Cloudinary is not configured (bytes kept in the database).
CREATE TABLE altera.media_uploads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         REFERENCES core.users(id) ON DELETE SET NULL,
  file_name    varchar(255) NOT NULL,
  file_type    varchar(50),
  file_size    integer,
  storage_url  varchar(500) NOT NULL,
  mime_type    varchar(100),
  storage_blob bytea,
  ipfs_hash    varchar(255),
  width        integer,
  height       integer,
  duration_ms  integer,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

-- Module 16. One report per reporter per target, so repeated reports cannot drain a health score.
CREATE TABLE altera.content_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id         uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  post_id             uuid         REFERENCES altera.posts(id) ON DELETE CASCADE,
  comment_id          uuid         REFERENCES altera.comments(id) ON DELETE CASCADE,
  reported_profile_id uuid,
  reason              varchar(100) NOT NULL,
  details             text,
  status              varchar(50)  NOT NULL DEFAULT 'pending',
  reviewed_at         timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(post_id, comment_id, reported_profile_id) = 1)
);
CREATE UNIQUE INDEX content_reports_once_post    ON altera.content_reports (reporter_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX content_reports_once_comment ON altera.content_reports (reporter_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE UNIQUE INDEX content_reports_once_profile ON altera.content_reports (reporter_id, reported_profile_id) WHERE reported_profile_id IS NOT NULL;

CREATE TABLE altera.ai_anomaly_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_profile_id uuid        NOT NULL REFERENCES altera.ai_profiles(id) ON DELETE CASCADE,
  flag_type     varchar(50) NOT NULL,
  severity      varchar(20) NOT NULL DEFAULT 'medium',
  description   text,
  auto_detected boolean     NOT NULL DEFAULT true,
  resolved      boolean     NOT NULL DEFAULT false,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_anomaly_flags_profile ON altera.ai_anomaly_flags (ai_profile_id, resolved);

-- Module 14 FE-4: interaction traceability.
CREATE TABLE altera.activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  ai_profile_id uuid        REFERENCES altera.ai_profiles(id) ON DELETE SET NULL,
  action_type   varchar(50) NOT NULL,
  target_type   varchar(50),
  target_id     uuid,
  meta          jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_user ON altera.activity_log (user_id, created_at DESC);
