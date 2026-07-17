-- Manage active TV access codes and renew approved devices on trusted IPs.
alter table public.tv_access_tokens
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists code_hint text,
  add column if not exists revoked_at timestamptz;

create unique index if not exists tv_access_tokens_id_idx
  on public.tv_access_tokens (id);

create table if not exists public.tv_trusted_ips (
  id uuid primary key default gen_random_uuid(),
  ip_address inet not null unique,
  label text not null default 'Office TV network',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.tv_trusted_ips enable row level security;

revoke all on table public.tv_trusted_ips from anon, authenticated;
grant select, insert, update, delete on table public.tv_trusted_ips to service_role;

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
    and revoked_at is null
    and expires_at > pg_catalog.now()
  returning true into did_consume;

  return coalesce(did_consume, false);
end;
$$;

create or replace function public.is_tv_ip_trusted(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tv_trusted_ips
    where ip_address = p_ip::inet
  );
$$;

revoke all on function public.consume_tv_access_token(text) from public, anon, authenticated;
grant execute on function public.consume_tv_access_token(text) to service_role;

revoke all on function public.is_tv_ip_trusted(text) from public, anon, authenticated;
grant execute on function public.is_tv_ip_trusted(text) to service_role;
