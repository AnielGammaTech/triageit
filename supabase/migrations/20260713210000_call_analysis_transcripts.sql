-- Keep the source transcript with the match audit. 3CX retention should not
-- determine whether staff can later review why TriageIT chose a ticket.
ALTER TABLE call_analyses
  ADD COLUMN IF NOT EXISTS transcript text;

CREATE INDEX IF NOT EXISTS idx_call_analyses_unmatched_recent
  ON call_analyses (recording_id DESC)
  WHERE halo_id IS NULL;
