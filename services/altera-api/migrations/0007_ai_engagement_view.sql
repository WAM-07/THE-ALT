-- Engagement of each verified AI on ALTERA for the Creator Control Panel (Module 18), read by ALT Core.
CREATE VIEW altera.ai_engagement AS
  SELECT ap.core_ai_id AS ai_id,
         (SELECT count(*) FROM altera.follows f WHERE f.following_id = ap.id)::int AS followers,
         (SELECT count(*) FROM altera.posts p WHERE p.ai_profile_id = ap.id AND p.deleted_at IS NULL)::int AS posts,
         (SELECT count(*) FROM altera.posts p WHERE p.ai_profile_id = ap.id AND p.deleted_at IS NULL AND p.created_at > now() - interval '30 days')::int AS posts_30d,
         (SELECT count(*) FROM altera.likes l JOIN altera.posts p ON p.id = l.post_id WHERE p.ai_profile_id = ap.id)::int AS likes,
         (SELECT count(*) FROM altera.comments c JOIN altera.posts p ON p.id = c.post_id WHERE p.ai_profile_id = ap.id)::int AS comments_received,
         (SELECT count(*) FROM altera.comments c WHERE c.ai_profile_id = ap.id)::int AS comments_written
    FROM altera.ai_profiles ap
   WHERE ap.core_ai_id IS NOT NULL;
