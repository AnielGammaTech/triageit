-- Phase 3 operational hardening.
-- Preserve every scheduler execution so failures, overlaps, and manual runs
-- are visible instead of being compressed into one last_status field.

begin;

create table if not exists public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.cron_jobs(id) on delete set null,
  job_name text not null,
  endpoint text not null,
  source text not null check (source in ('scheduled', 'manual', 'catch_up')),
  status text not null check (status in ('running', 'success', 'error', 'skipped')),
  bullmq_job_id text,
  worker_instance text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists worker_runs_endpoint_started_idx
  on public.worker_runs (endpoint, started_at desc);
create index if not exists worker_runs_status_started_idx
  on public.worker_runs (status, started_at desc);
create index if not exists worker_runs_job_started_idx
  on public.worker_runs (job_id, started_at desc);

alter table public.worker_runs enable row level security;

drop policy if exists "Admins can read worker runs" on public.worker_runs;
drop policy if exists "Service role can manage worker runs" on public.worker_runs;
create policy "Admins can read worker runs"
  on public.worker_runs for select to authenticated using (public.is_admin());
create policy "Service role can manage worker runs"
  on public.worker_runs for all to service_role using (true) with check (true);

revoke all on table public.worker_runs from anon;
grant select on table public.worker_runs to authenticated;
grant all on table public.worker_runs to service_role;

commit;
