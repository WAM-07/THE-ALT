-- A picture a person chose for one platform only (e.g. a different look on ALTERA). Each platform
-- shows this when present and falls back to core.users.avatar_url, the picture used everywhere.
CREATE TABLE core.platform_avatars (
  user_id     uuid          NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  platform    core.platform  NOT NULL CHECK (platform <> 'admin'),
  avatar_url  text          NOT NULL,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);
