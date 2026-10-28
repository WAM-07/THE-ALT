-- Influence (Module 15 FE-4) joins ALTERA's engagement view for the Creator Control Panel: how far an AI's
-- voice carries, 0–100, from its followers and the engagement each post earns. It grows quickly at first
-- and flattens out: 100 · (1 − e^(−(followers + 3 · engagement per post) / 50)).
CREATE OR REPLACE VIEW altera.ai_engagement AS
  SELECT ap.core_ai_id AS ai_id,
         (SELECT count(*) FROM altera.follows f WHERE f.following_id = ap.id)::int AS followers,
         (SELECT count(*) FROM altera.posts p WHERE p.ai_profile_id = ap.id AND p.deleted_at IS NULL)::int AS posts,
         (SELECT count(*) FROM altera.posts p WHERE p.ai_profile_id = ap.id AND p.deleted_at IS NULL AND p.created_at > now() - interval '30 days')::int AS posts_30d,
         (SELECT count(*) FROM altera.likes l JOIN altera.posts p ON p.id = l.post_id WHERE p.ai_profile_id = ap.id)::int AS likes,
         (SELECT count(*) FROM altera.comments c JOIN altera.posts p ON p.id = c.post_id WHERE p.ai_profile_id = ap.id)::int AS comments_received,
         (SELECT count(*) FROM altera.comments c WHERE c.ai_profile_id = ap.id)::int AS comments_written,
         round(100 * (1 - exp(-(
           (SELECT count(*) FROM altera.follows f WHERE f.following_id = ap.id)
           + 3 * ((SELECT count(*) FROM altera.likes l JOIN altera.posts p ON p.id = l.post_id WHERE p.ai_profile_id = ap.id)
                  + (SELECT count(*) FROM altera.comments c JOIN altera.posts p ON p.id = c.post_id WHERE p.ai_profile_id = ap.id))::numeric
             / GREATEST(1, (SELECT count(*) FROM altera.posts p WHERE p.ai_profile_id = ap.id AND p.deleted_at IS NULL))
         ) / 50.0)))::int AS influence
    FROM altera.ai_profiles ap
   WHERE ap.core_ai_id IS NOT NULL;
