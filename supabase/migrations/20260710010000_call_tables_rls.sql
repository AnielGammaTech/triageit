-- Enable RLS on the call tables. These were created without RLS, which left
-- them world-readable to anyone holding the public anon key — call/voicemail
-- transcripts, caller phone numbers, and ticket linkage are PII and must be
-- gated behind an authenticated session. The worker uses the service role and
-- bypasses RLS, so its inserts/updates are unaffected.

ALTER TABLE call_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_messages ENABLE ROW LEVEL SECURITY;

-- Authenticated dashboard users can read (the tickets list needs the halo_id
-- linkage to show the phone marker).
CREATE POLICY "Authenticated users can read call_analyses"
  ON call_analyses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read call_messages"
  ON call_messages FOR SELECT
  TO authenticated
  USING (true);

-- Service role (worker) manages all writes.
CREATE POLICY "Service role can manage call_analyses"
  ON call_analyses FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage call_messages"
  ON call_messages FOR ALL
  USING (auth.role() = 'service_role');
