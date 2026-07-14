-- Single-use TV authorization links. Raw tokens are never persisted.
create table if not exists public.tv_access_tokens (
  token_hash text primary key check (length(token_hash) = 64),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tv_access_tokens_expires_at_idx
  on public.tv_access_tokens (expires_at);

alter table public.tv_access_tokens enable row level security;

revoke all on table public.tv_access_tokens from anon, authenticated;
grant select, insert, update, delete on table public.tv_access_tokens to service_role;

create or replace function public.consume_tv_access_token(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  did_consume boolean;
begin
  update public.tv_access_tokens
  set consumed_at = pg_catalog.now()
  where token_hash = p_token_hash
    and consumed_at is null
    and expires_at > pg_catalog.now()
  returning true into did_consume;

  return coalesce(did_consume, false);
end;
$$;

revoke all on function public.consume_tv_access_token(text) from public, anon, authenticated;
grant execute on function public.consume_tv_access_token(text) to service_role;
