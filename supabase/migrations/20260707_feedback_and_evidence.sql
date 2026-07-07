-- Evidence trail + duplicate persistence on triage results
alter table triage_results add column if not exists analyzed_files jsonb;
alter table triage_results add column if not exists duplicates jsonb;

-- Tech feedback on triage quality (thumbs up/down from the embed panel)
create table if not exists triage_feedback (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  triage_result_id uuid references triage_results(id) on delete set null,
  halo_id integer not null,
  rating text not null check (rating in ('up','down')),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists idx_triage_feedback_ticket on triage_feedback(ticket_id);
create index if not exists idx_triage_feedback_created on triage_feedback(created_at);
