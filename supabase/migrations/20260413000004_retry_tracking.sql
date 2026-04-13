-- Error retry tracking columns
alter table tickets add column if not exists retry_count integer not null default 0;
alter table tickets add column if not exists last_retry_at timestamptz;
