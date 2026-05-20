-- Workflow state fields for the Halo Help Desk Workflow.
-- These are separate from TriageIT's internal processing status.

alter table tickets add column if not exists workflow_status text;
alter table tickets add column if not exists workflow_owner_role text;
alter table tickets add column if not exists auto_release_at timestamptz;
alter table tickets add column if not exists resolution_time_at timestamptz;
alter table tickets add column if not exists workflow_past_due boolean not null default false;
alter table tickets add column if not exists rfi_cycle_count integer not null default 0;
alter table tickets add column if not exists past_due_count integer not null default 0;
alter table tickets add column if not exists escalation_level integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_workflow_status_check'
  ) then
    alter table tickets add constraint tickets_workflow_status_check
      check (
        workflow_status is null or workflow_status in (
          'NEW',
          'WOT',
          'IN_PROGRESS',
          'WAITING_ON_CUSTOMER',
          'WAITING_ON_PARTS',
          'NEEDS_QUOTE',
          'PAST_DUE',
          'RESOLVED'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tickets_workflow_owner_role_check'
  ) then
    alter table tickets add constraint tickets_workflow_owner_role_check
      check (
        workflow_owner_role is null or workflow_owner_role in (
          'Triage',
          'Assigned Tech',
          'Parts Owner',
          'Triage Lead',
          'Help Desk Manager',
          'Director'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tickets_escalation_level_check'
  ) then
    alter table tickets add constraint tickets_escalation_level_check
      check (escalation_level between 0 and 3);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tickets_rfi_cycle_count_check'
  ) then
    alter table tickets add constraint tickets_rfi_cycle_count_check
      check (rfi_cycle_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tickets_past_due_count_check'
  ) then
    alter table tickets add constraint tickets_past_due_count_check
      check (past_due_count >= 0);
  end if;
end $$;

create table if not exists workflow_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  halo_id integer not null,
  event_type text not null,
  from_owner_role text,
  to_owner_role text,
  workflow_status text,
  auto_release_at timestamptz,
  resolution_time_at timestamptz,
  escalation_level integer,
  note text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_tickets_workflow_status on tickets(workflow_status);
create index if not exists idx_tickets_auto_release_at on tickets(auto_release_at);
create index if not exists idx_tickets_resolution_time_at on tickets(resolution_time_at);
create index if not exists idx_workflow_events_ticket_id on workflow_events(ticket_id);
create index if not exists idx_workflow_events_halo_id on workflow_events(halo_id);
