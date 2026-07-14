-- Direct Teams follow-up for calls that could not be matched safely.
CREATE TABLE IF NOT EXISTS teams_conversation_references (
  user_aad_id text PRIMARY KEY,
  user_teams_id text NOT NULL,
  user_name text NOT NULL,
  conversation_id text NOT NULL,
  service_url text NOT NULL,
  bot_id text NOT NULL,
  tenant_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE teams_conversation_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage Teams conversation references"
  ON teams_conversation_references;
CREATE POLICY "Service role can manage Teams conversation references"
  ON teams_conversation_references FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE call_analyses
  ADD COLUMN IF NOT EXISTS teams_review_status text,
  ADD COLUMN IF NOT EXISTS teams_review_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS teams_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS teams_reviewed_by text,
  ADD COLUMN IF NOT EXISTS teams_review_ticket_id integer,
  ADD COLUMN IF NOT EXISTS teams_review_activity_id text;

CREATE INDEX IF NOT EXISTS idx_call_analyses_teams_review_pending
  ON call_analyses (started_at DESC)
  WHERE halo_id IS NULL AND teams_review_status = 'pending';

UPDATE call_analyses
SET teams_review_status = 'legacy_unreviewed'
WHERE halo_id IS NULL
  AND teams_review_status IS NULL
  AND started_at >= now() - interval '48 hours'
  AND matched_by IN (
    'identified_customer_no_ticket_match',
    'no_halo_user',
    'shared_phone_no_transcript_match',
    'ambiguous_multiple_open',
    'no_open_ticket'
  );
