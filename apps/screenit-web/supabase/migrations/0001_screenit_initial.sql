-- ScreenIT owns these isolated, namespaced tables in Supabase.
-- The application reads and writes through its server-side service role only.

create extension if not exists pgcrypto;

create table if not exists public.screenit_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text not null default 'General',
  location text not null default 'Not specified',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'closed')),
  requirements jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.screenit_candidates (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.screenit_positions(id) on delete restrict,
  full_name text not null,
  email text not null,
  phone text,
  stage text not null default 'new' check (stage in ('new', 'invited', 'interviewing', 'review', 'advanced', 'closed')),
  resume_file_name text not null,
  resume_storage_path text,
  resume_highlights jsonb not null default '[]'::jsonb,
  interview_mode text check (interview_mode is null or interview_mode in ('browser', 'phone')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  public_invite_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  public_invite_expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.screenit_interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.screenit_candidates(id) on delete cascade,
  consented_at timestamptz not null,
  transcript jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.screenit_reports (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.screenit_candidates(id) on delete cascade,
  summary text not null,
  requirement_evidence jsonb not null default '[]'::jsonb,
  clarifications jsonb not null default '[]'::jsonb,
  recommendation text not null default 'recruiter_review' check (recommendation in ('recruiter_review', 'follow_up', 'incomplete')),
  generated_at timestamptz not null default now()
);

create index if not exists screenit_candidates_position_idx on public.screenit_candidates(position_id);
create index if not exists screenit_candidates_stage_idx on public.screenit_candidates(stage);
create index if not exists screenit_candidates_schedule_idx on public.screenit_candidates(scheduled_at);

alter table public.screenit_positions enable row level security;
alter table public.screenit_candidates enable row level security;
alter table public.screenit_interviews enable row level security;
alter table public.screenit_reports enable row level security;

-- No browser policies are intentional: only the service role can reach candidate data.
revoke all on public.screenit_positions from anon, authenticated;
revoke all on public.screenit_candidates from anon, authenticated;
revoke all on public.screenit_interviews from anon, authenticated;
revoke all on public.screenit_reports from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'screenit-resumes',
  'screenit-resumes',
  false,
  10485760,
  array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
