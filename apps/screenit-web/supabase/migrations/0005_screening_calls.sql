-- Durable outbound screening-call queue shared by ScreenIT and the TriageIT voice worker.

create table if not exists public.screenit_call_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.screenit_candidates(id) on delete cascade,
  phone text not null,
  status text not null default 'pending' check (status in ('pending', 'calling', 'connected', 'completed', 'no_answer', 'failed')),
  error text,
  answered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists screenit_one_active_call_per_candidate_idx
  on public.screenit_call_requests(candidate_id)
  where status in ('pending', 'calling', 'connected');

create index if not exists screenit_call_requests_status_idx
  on public.screenit_call_requests(status, created_at);

alter table public.screenit_call_requests enable row level security;
revoke all on public.screenit_call_requests from anon, authenticated;
