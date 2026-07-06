-- Keep integration mappings open to every service TriageIT can manage.
alter table public.integration_mappings
  drop constraint if exists integration_mappings_service_check;

alter table public.integration_mappings
  add constraint integration_mappings_service_check
  check (
    service in (
      'halo',
      'hudu',
      'jumpcloud',
      'datto',
      'datto-edr',
      'rocketcyber',
      'unifi',
      'vpentest',
      'saas-alerts',
      'unitrends',
      'cove',
      'pax8',
      'vultr',
      'dmarc',
      'threecx',
      'spanning',
      'twilio',
      'ai-provider',
      'teams',
      'cipp',
      'web-search',
      'mxtoolbox',
      'automapper'
    )
  );

-- Halo needs to sync frequently enough that techs do not have to keep clicking Sync.
insert into public.cron_jobs (name, description, schedule, endpoint, is_active)
values
  (
    'Halo Ticket Sync',
    'Syncs open tickets from Halo API every minute. Creates missing tickets, closes removed ones, and fixes status mismatches.',
    '* * * * *',
    '/ticket-sync',
    true
  )
on conflict (name) do update
set
  description = excluded.description,
  schedule = excluded.schedule,
  endpoint = excluded.endpoint,
  is_active = true,
  updated_at = now();

insert into public.cron_jobs (name, description, schedule, endpoint, is_active)
values
  (
    'Integration Heartbeat',
    'Checks active integration health and stores per-service heartbeat details for Adminland and Michael.',
    '*/5 * * * *',
    '/integration-heartbeat',
    true
  )
on conflict (name) do update
set
  description = excluded.description,
  schedule = excluded.schedule,
  endpoint = excluded.endpoint,
  is_active = true,
  updated_at = now();

-- One reusable quality instruction for every worker. The BaseAgent also
-- enforces this in code; this keeps the skill visible/editable in Adminland.
delete from public.agent_skills
where metadata->>'source' = '20260702_worker_quality_standard';

insert into public.agent_skills (agent_name, title, content, skill_type, metadata, is_active)
select
  agent_name,
  'Evidence-first worker investigation standard',
  'State exactly which integration data was checked and with what search terms. Do not say a client has no site, no devices, no license, no backup, or no deployment unless the integration returned a successful empty result. If auth, mapping, lookup, or endpoint access failed, say that instead and tell the technician the exact next fix. Pick integrations by ticket intent. Pax8/Holly is only for licenses, subscriptions, seats, billing, marketplace, Azure subscriptions, or Microsoft 365 plan changes. Always return concise technician steps and a confidence level tied to evidence quality.',
  'instruction',
  '{"source":"20260702_worker_quality_standard"}'::jsonb,
  true
from unnest(array[
  'michael_scott',
  'dwight_schrute',
  'jim_halpert',
  'pam_beesly',
  'ryan_howard',
  'andy_bernard',
  'stanley_hudson',
  'phyllis_vance',
  'angela_martin',
  'oscar_martinez',
  'kevin_malone',
  'kelly_kapoor',
  'toby_flenderson',
  'meredith_palmer',
  'darryl_philbin',
  'creed_bratton',
  'holly_flax',
  'erin_hannon'
]) as agent_name;
