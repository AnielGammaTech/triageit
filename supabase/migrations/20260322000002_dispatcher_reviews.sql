-- Store dispatcher (Bryanna) performance review results
CREATE TABLE IF NOT EXISTS dispatcher_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  halo_id INTEGER NOT NULL,
  dispatcher_name TEXT NOT NULL DEFAULT 'Bryanna',
  rating TEXT NOT NULL CHECK (rating IN ('great', 'good', 'needs_improvement', 'poor')),
  assignment_time_minutes NUMERIC(8,2),       -- How long until ticket was assigned (business minutes)
  promise_kept BOOLEAN,                        -- Was a promised callback/contact honored?
  promise_details TEXT,                        -- What was promised and what happened
  unassigned_during_business_hours BOOLEAN,    -- Was the ticket left unassigned during business hours?
  customer_reply_handled BOOLEAN,              -- When customer replied, was it routed promptly?
  issues TEXT[],                               -- Array of specific issues found
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispatcher_reviews_ticket_id ON dispatcher_reviews(ticket_id);
CREATE INDEX idx_dispatcher_reviews_created_at ON dispatcher_reviews(created_at DESC);
CREATE INDEX idx_dispatcher_reviews_rating ON dispatcher_reviews(rating);

-- RLS
ALTER TABLE dispatcher_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read dispatcher_reviews"
  ON dispatcher_reviews FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert dispatcher_reviews"
  ON dispatcher_reviews FOR INSERT
  TO service_role
  WITH CHECK (true);
