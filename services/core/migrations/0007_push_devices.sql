-- Notifications module: phones that receive push notifications (Firebase Cloud Messaging) for the ALT
-- inbox while the app is closed. One row per app install; the token comes from Firebase on the phone.
CREATE TABLE core.push_devices (
  token         text         PRIMARY KEY CHECK (length(token) BETWEEN 10 AND 4096),
  user_id       uuid         NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  platform      text         NOT NULL CHECK (platform IN ('alter', 'altera', 'altar')),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  last_seen_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON core.push_devices (user_id);
