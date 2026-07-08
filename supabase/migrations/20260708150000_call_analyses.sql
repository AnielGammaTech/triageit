-- Call analysis — 3CX recordings matched to tickets, one row per recording.
-- recording_id doubles as the processing cursor (max = last handled).
CREATE TABLE IF NOT EXISTS call_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id BIGINT NOT NULL UNIQUE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  halo_id INTEGER,
  tech_name TEXT,
  external_number TEXT,
  direction TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  transcript_chars INTEGER,
  matched_by TEXT,
  summary TEXT,
  note_posted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_analyses_recording ON call_analyses(recording_id DESC);
CREATE INDEX IF NOT EXISTS idx_call_analyses_ticket ON call_analyses(ticket_id);
