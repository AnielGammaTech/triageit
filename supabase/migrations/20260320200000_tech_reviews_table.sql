-- Store tech performance review results for the Review tab
CREATE TABLE IF NOT EXISTS tech_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  halo_id INTEGER NOT NULL,
  tech_name TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('great', 'good', 'needs_improvement', 'poor')),
  communication_score INTEGER NOT NULL CHECK (communication_score BETWEEN 1 AND 5),
  response_time TEXT NOT NULL,
  max_gap_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  strengths TEXT,
  improvement_areas TEXT,
  suggestions TEXT[],
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tech_reviews_ticket_id ON tech_reviews(ticket_id);
CREATE INDEX idx_tech_reviews_created_at ON tech_reviews(created_at DESC);
CREATE INDEX idx_tech_reviews_rating ON tech_reviews(rating);

-- RLS
ALTER TABLE tech_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read tech_reviews"
  ON tech_reviews FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert tech_reviews"
  ON tech_reviews FOR INSERT
  TO service_role
  WITH CHECK (true);
