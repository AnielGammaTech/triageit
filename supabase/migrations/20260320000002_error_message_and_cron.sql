-- ============================================================
-- 1. Add error_message column to tickets table
-- ============================================================
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS error_message TEXT;

-- ============================================================
-- 2. Cron jobs configuration table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cron_jobs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  schedule    text not null,
  endpoint    text not null,
  is_active   boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

ALTER TABLE public.cron_jobs ENABLE ROW LEVEL SECURITY;

-- RLS policies (idempotent with IF NOT EXISTS via DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cron_jobs' AND policyname = 'Authenticated users can read cron_jobs') THEN
    CREATE POLICY "Authenticated users can read cron_jobs"   ON public.cron_jobs FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cron_jobs' AND policyname = 'Authenticated users can insert cron_jobs') THEN
    CREATE POLICY "Authenticated users can insert cron_jobs" ON public.cron_jobs FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cron_jobs' AND policyname = 'Authenticated users can update cron_jobs') THEN
    CREATE POLICY "Authenticated users can update cron_jobs" ON public.cron_jobs FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cron_jobs' AND policyname = 'Authenticated users can delete cron_jobs') THEN
    CREATE POLICY "Authenticated users can delete cron_jobs" ON public.cron_jobs FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

-- Seed default cron jobs
INSERT INTO public.cron_jobs (name, description, schedule, endpoint, is_active) VALUES
  ('Daily Re-Triage Scan', 'Scans all open tickets for stale, SLA-risk, and unassigned issues. Posts AI notes to Halo and sends Teams alerts.', '0 */3 * * *', '/retriage', true),
  ('SLA Breach Scan', 'Checks all open Halo tickets for SLA breaches and enqueues affected tickets for triage.', '0 */3 * * *', '/sla-scan', true)
ON CONFLICT (name) DO NOTHING;
