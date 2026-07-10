-- Bounded retry counter for the call-analysis sweeper. Without a cap, a
-- recording whose analysis or note-post deterministically fails would be
-- retried every minute for 24h (~1,440 LLM calls/day) at the every-minute
-- cadence. The sweeper now filters analysis_attempts < 5 and increments it
-- per retry.
ALTER TABLE call_analyses ADD COLUMN IF NOT EXISTS analysis_attempts integer NOT NULL DEFAULT 0;
