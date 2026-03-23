-- Close reviews: final summary when a ticket is resolved
CREATE TABLE IF NOT EXISTS close_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  halo_id INTEGER NOT NULL,
  tech_name TEXT,
  review_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_close_reviews_ticket ON close_reviews(ticket_id);
CREATE INDEX idx_close_reviews_halo ON close_reviews(halo_id);

-- RLS
ALTER TABLE close_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read close reviews"
  ON close_reviews FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert close reviews"
  ON close_reviews FOR INSERT
  TO service_role
  WITH CHECK (true);
