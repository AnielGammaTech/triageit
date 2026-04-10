-- Add missing cron jobs: ticket-sync and Toby analysis
-- These were in the default fallback but never seeded in the DB,
-- so they didn't run when the scheduler found existing rows.

insert into public.cron_jobs (name, description, schedule, endpoint, is_active) values
  ('Halo Ticket Sync', 'Syncs open tickets from Halo API. Creates missing tickets, closes removed ones, fixes status mismatches.', '*/30 * * * *', '/ticket-sync', true),
  ('Toby Learning Analysis', 'Toby Flenderson daily learning agent — builds tech profiles, customer insights, trend detections, and triage self-evaluations.', '0 7 * * *', '/toby/analyze', true)
on conflict (name) do nothing;

