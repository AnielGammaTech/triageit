-- Phone messages recorded on the TriageIt AI phone line (3CX route point).
-- ticket_id/halo_id are null when the caller could not be matched to a
-- single open ticket; note_posted flips true once the private Halo note
-- lands.
create table if not exists call_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  caller_number text,
  ticket_id uuid null references tickets(id) on delete set null,
  halo_id int null,
  transcript text,
  duration_seconds int,
  note_posted boolean not null default false
);

create index if not exists idx_call_messages_created_at on call_messages (created_at desc);
