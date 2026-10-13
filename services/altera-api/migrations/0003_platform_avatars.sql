-- A person may choose a picture for ALTERA only (core.platform_avatars, owned by ALT Core). ALTERA
-- shows it when present, otherwise the global ALT picture. Same columns as before, so every query
-- written against altera.users keeps working.
CREATE OR REPLACE VIEW altera.users AS
SELECT u.id,
       u.email::text                         AS email,
       u.handle::text                        AS username,
       u.display_name                        AS full_name,
       COALESCE(p.bio, u.bio)                AS bio,
       COALESCE(pa.avatar_url, u.avatar_url) AS avatar_url,
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
  LEFT JOIN core.wallets w ON w.user_id = u.id AND w.is_primary
  LEFT JOIN core.platform_avatars pa ON pa.user_id = u.id AND pa.platform = 'altera';
