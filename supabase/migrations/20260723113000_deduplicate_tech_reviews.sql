-- A retriage refreshes the review for a ticket; it is not a second,
-- independently scoreable performance event. Keep the newest review only and
-- make future writes replace that row.

WITH ranked_reviews AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY halo_id
      ORDER BY created_at DESC, id::text DESC
    ) AS review_rank
  FROM tech_reviews
)
DELETE FROM tech_reviews
WHERE id IN (
  SELECT id
  FROM ranked_reviews
  WHERE review_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_reviews_halo_id_unique
  ON tech_reviews(halo_id);
