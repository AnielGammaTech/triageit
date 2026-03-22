-- Cron heartbeat table for monitoring scheduler health
CREATE TABLE IF NOT EXISTS cron_heartbeat (
  id TEXT PRIMARY KEY DEFAULT 'worker-cron',
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_jobs INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add last_run_at to cron_jobs if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cron_jobs' AND column_name = 'last_run_at'
  ) THEN
    ALTER TABLE cron_jobs ADD COLUMN last_run_at TIMESTAMPTZ;
  END IF;
END $$;
