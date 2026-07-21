-- Production mirror of ScreenIT migration 0008.

alter table public.screenit_reports
  add column if not exists stated_motivation text not null default 'Not discussed.',
  add column if not exists conversation_signals jsonb not null default '[]'::jsonb;
