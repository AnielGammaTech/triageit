alter table public.screenit_reports
  add column if not exists answer_quality text not null default 'not_assessed',
  add column if not exists answer_quality_rationale text not null default 'Answer quality was not assessed for this report.',
  add column if not exists answer_concerns jsonb not null default '[]'::jsonb;

alter table public.screenit_reports
  drop constraint if exists screenit_reports_answer_quality_check;

alter table public.screenit_reports
  add constraint screenit_reports_answer_quality_check
  check (answer_quality in ('strong', 'mixed', 'weak', 'insufficient', 'not_assessed'));
