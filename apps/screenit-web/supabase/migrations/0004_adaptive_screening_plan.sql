-- Store the candidate-specific screening plan and a human-reviewed role alignment.

alter table public.screenit_candidates
  add column if not exists resume_clarifications jsonb not null default '[]'::jsonb,
  add column if not exists screening_questions jsonb not null default '[]'::jsonb;

alter table public.screenit_reports
  add column if not exists role_alignment text not null default 'insufficient_evidence',
  add column if not exists fit_rationale text not null default 'Human recruiter review required.';

alter table public.screenit_reports
  drop constraint if exists screenit_reports_role_alignment_check;

alter table public.screenit_reports
  add constraint screenit_reports_role_alignment_check
  check (role_alignment in ('strong_alignment', 'partial_alignment', 'limited_alignment', 'insufficient_evidence'));
