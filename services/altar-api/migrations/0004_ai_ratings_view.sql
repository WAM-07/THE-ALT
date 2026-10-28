-- Ratings per AI, for ALT Core's Health Score (Module 7). A view, so Core reads ALTAR's numbers without
-- touching its tables (each service owns its data).
CREATE VIEW altar.ai_ratings AS
  SELECT ai_id, round(avg(rating)::numeric, 2) AS avg_rating, count(*)::int AS reviews
    FROM altar.reviews
   GROUP BY ai_id;
