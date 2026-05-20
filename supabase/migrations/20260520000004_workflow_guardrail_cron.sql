insert into public.cron_jobs (name, description, schedule, endpoint, is_active)
values (
  'Workflow Guardrail Scan',
  'Checks ticket workflow state for missing owners, missing timers, fired auto-release windows, missed deadlines, and escalation steps that require private internal notes.',
  '*/15 * * * *',
  '/workflow-scan',
  true
)
on conflict (name) do update
set
  description = excluded.description,
  schedule = excluded.schedule,
  endpoint = excluded.endpoint,
  is_active = true,
  updated_at = now();
