-- Cron jobs configuration and run history
create table if not exists public.cron_jobs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  schedule    text not null,           -- cron expression (e.g. "0 */3 * * *")
  endpoint    text not null,           -- worker endpoint to call (e.g. "/retriage")
  is_active   boolean not null default true,
  last_run_at timestamptz,
  last_status text,                    -- 'success' | 'error'
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Enable RLS
alter table public.cron_jobs enable row level security;

-- Allow authenticated users to read/write cron jobs (admin-only in practice via app logic)
create policy "Authenticated users can read cron_jobs"
  on public.cron_jobs for select
  to authenticated
  using (true);

create policy "Authenticated users can insert cron_jobs"
  on public.cron_jobs for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update cron_jobs"
  on public.cron_jobs for update
  to authenticated
  using (true);

create policy "Authenticated users can delete cron_jobs"
  on public.cron_jobs for delete
  to authenticated
  using (true);

-- Seed the default cron jobs that match the worker's existing cron tasks
insert into public.cron_jobs (name, description, schedule, endpoint, is_active) values
  ('Daily Re-Triage Scan', 'Scans all open tickets for stale, SLA-risk, and unassigned issues. Posts AI notes to Halo and sends Teams alerts.', '0 */3 * * *', '/retriage', true),
  ('SLA Breach Scan', 'Checks all open Halo tickets for SLA breaches and enqueues affected tickets for triage.', '0 */3 * * *', '/sla-scan', true)
on conflict (name) do nothing;
