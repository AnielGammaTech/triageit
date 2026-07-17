-- Preserve both sides of every 3CX call so internal extension calls can be
-- shown as staff-to-staff activity without treating them as unmatched tickets.
ALTER TABLE call_analyses
  ADD COLUMN IF NOT EXISTS call_type text,
  ADD COLUMN IF NOT EXISTS from_name text,
  ADD COLUMN IF NOT EXISTS from_number text,
  ADD COLUMN IF NOT EXISTS to_name text,
  ADD COLUMN IF NOT EXISTS to_number text;

CREATE INDEX IF NOT EXISTS idx_call_analyses_internal_recent
  ON call_analyses (recording_id DESC)
  WHERE matched_by = 'internal_call';
