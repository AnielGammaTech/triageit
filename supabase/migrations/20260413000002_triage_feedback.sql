-- Triage quality feedback — thumbs up/down from techs/admins
create table if not exists triage_feedback (
  id uuid primary key default gen_random_uuid(),
  triage_result_id uuid not null references triage_results(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,

  -- Simple rating
  rating text not null check (rating in ('helpful', 'not_helpful')),

  -- Granular accuracy
  classification_accurate boolean,
  priority_accurate boolean,
  recommendations_useful boolean,

  -- Free-form
  comment text,

  -- Who submitted
  submitted_by text,  -- tech name or "admin"

  created_at timestamptz not null default now()
);

create index if not exists idx_triage_feedback_result on triage_feedback(triage_result_id);
create index if not exists idx_triage_feedback_ticket on triage_feedback(ticket_id);
create index if not exists idx_triage_feedback_rating on triage_feedback(rating);

-- RLS
alter table triage_feedback enable row level security;

create policy "Service role manage triage_feedback" on triage_feedback for all
  using (current_setting('role') = 'service_role');
create policy "Auth read triage_feedback" on triage_feedback for select
  using (auth.uid() is not null);
create policy "Auth insert triage_feedback" on triage_feedback for insert
  with check (auth.uid() is not null);
