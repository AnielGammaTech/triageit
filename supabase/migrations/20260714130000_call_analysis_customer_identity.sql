-- Preserve transcript-derived caller context even when no ticket is safe to match.
ALTER TABLE call_analyses
  ADD COLUMN IF NOT EXISTS identified_customer_name text,
  ADD COLUMN IF NOT EXISTS identified_client_name text,
  ADD COLUMN IF NOT EXISTS match_evidence text;
