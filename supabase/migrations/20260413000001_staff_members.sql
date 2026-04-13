-- Staff members table — replaces hardcoded STAFF_NAMES and DISPATCHER_NAME arrays
create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text not null default 'technician',  -- technician, dispatcher, manager
  is_active boolean not null default true,
  halo_agent_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique on name to prevent duplicates
create unique index if not exists staff_members_name_idx on staff_members (lower(name));

-- Seed with current staff (from the hardcoded arrays)
insert into staff_members (name, role) values
  ('Dylan', 'technician'),
  ('Raul', 'technician'),
  ('Jarid', 'technician'),
  ('Matthew', 'technician'),
  ('Ryan', 'technician'),
  ('Darren', 'technician'),
  ('Bryanna', 'dispatcher'),
  ('David', 'manager'),
  ('Jonathan', 'technician'),
  ('Roman', 'technician'),
  ('Todd', 'technician'),
  ('Aniel', 'manager')
on conflict do nothing;
