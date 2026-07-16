-- A TV creates a short-lived pairing request, displays its approval URL as a
-- QR code, and polls with the secret until an authenticated admin approves it.
-- Raw pairing secrets never persist in the database.
create table if not exists public.tv_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null unique check (length(secret_hash) = 64),
  requested_ip inet,
  expires_at timestamptz not null,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tv_pairing_requests_expires_at_idx
  on public.tv_pairing_requests (expires_at);

alter table public.tv_pairing_requests enable row level security;

revoke all on table public.tv_pairing_requests from anon, authenticated;
grant select, insert, update, delete on table public.tv_pairing_requests to service_role;
