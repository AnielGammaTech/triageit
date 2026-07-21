-- Make candidate intake safe against double-clicks, browser retries, and replayed requests.

alter table public.screenit_candidates
  add column if not exists intake_request_id uuid not null default gen_random_uuid();

create unique index if not exists screenit_candidates_intake_request_idx
  on public.screenit_candidates(intake_request_id);
