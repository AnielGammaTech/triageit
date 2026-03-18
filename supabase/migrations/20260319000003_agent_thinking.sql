-- Allow agents to log thinking steps in real-time
ALTER TABLE agent_logs DROP CONSTRAINT IF EXISTS agent_logs_status_check;
ALTER TABLE agent_logs ADD CONSTRAINT agent_logs_status_check
  CHECK (status IN ('started', 'thinking', 'completed', 'error', 'skipped'));
