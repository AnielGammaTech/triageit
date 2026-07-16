-- Public networks approved for automatic TV-only wallboard access.
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

revoke all on function public.is_tv_ip_trusted(text) from public, anon, authenticated;
grant execute on function public.is_tv_ip_trusted(text) to service_role;
