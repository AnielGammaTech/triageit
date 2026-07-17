-- Phase 1 security hardening.
-- Close anonymous table exposure and restore the intended read-only boundary
-- for non-admin authenticated users.

begin;

-- Make the role helper deterministic and independent of a caller-controlled
-- search_path. Only authenticated roles need to execute it.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- These operational tables were added without RLS and were readable and
-- writable through PostgREST with the public anon key.
alter table public.cron_heartbeat enable row level security;
alter table public.sla_call_requests enable row level security;
alter table public.staff_members enable row level security;
alter table public.workflow_events enable row level security;

drop policy if exists "Authenticated users can read cron heartbeat" on public.cron_heartbeat;
drop policy if exists "Service role can manage cron heartbeat" on public.cron_heartbeat;
create policy "Authenticated users can read cron heartbeat"
  on public.cron_heartbeat for select to authenticated using (true);
create policy "Service role can manage cron heartbeat"
  on public.cron_heartbeat for all to service_role using (true) with check (true);

drop policy if exists "Service role can manage SLA call requests" on public.sla_call_requests;
create policy "Service role can manage SLA call requests"
  on public.sla_call_requests for all to service_role using (true) with check (true);

drop policy if exists "Authenticated users can read staff members" on public.staff_members;
drop policy if exists "Admins can manage staff members" on public.staff_members;
drop policy if exists "Service role can manage staff members" on public.staff_members;
create policy "Authenticated users can read staff members"
  on public.staff_members for select to authenticated using (true);
create policy "Admins can manage staff members"
  on public.staff_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Service role can manage staff members"
  on public.staff_members for all to service_role using (true) with check (true);

drop policy if exists "Authenticated users can read workflow events" on public.workflow_events;
drop policy if exists "Service role can manage workflow events" on public.workflow_events;
create policy "Authenticated users can read workflow events"
  on public.workflow_events for select to authenticated using (true);
create policy "Service role can manage workflow events"
  on public.workflow_events for all to service_role using (true) with check (true);

-- These policies were named for the service role but also granted every
-- authenticated account full write/delete access.
drop policy if exists "Service role can manage tickets" on public.tickets;
create policy "Service role can manage tickets"
  on public.tickets for all to service_role using (true) with check (true);

drop policy if exists "Service role can manage triage results" on public.triage_results;
create policy "Service role can manage triage results"
  on public.triage_results for all to service_role using (true) with check (true);

drop policy if exists "Service role can manage agent logs" on public.agent_logs;
create policy "Service role can manage agent logs"
  on public.agent_logs for all to service_role using (true) with check (true);

-- Cron configuration and learned behavior are admin-owned configuration, not
-- general authenticated-user data.
drop policy if exists "Authenticated users can insert cron_jobs" on public.cron_jobs;
drop policy if exists "Authenticated users can update cron_jobs" on public.cron_jobs;
drop policy if exists "Authenticated users can delete cron_jobs" on public.cron_jobs;
drop policy if exists "Admins can manage cron_jobs" on public.cron_jobs;
create policy "Admins can manage cron_jobs"
  on public.cron_jobs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Authenticated users can manage learned skills" on public.michael_learned_skills;
drop policy if exists "Admins can manage learned skills" on public.michael_learned_skills;
create policy "Admins can manage learned skills"
  on public.michael_learned_skills for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Login events are written through an authenticated server route. The old
-- public INSERT policy allowed unauthenticated event spam and forged records.
drop policy if exists "Service can insert login events" on public.login_events;
create policy "Service role can insert login events"
  on public.login_events for insert to service_role with check (true);

-- Raw vectors are worker implementation data and are not used by the browser.
drop policy if exists "Authenticated users can read ticket_embeddings" on public.ticket_embeddings;

commit;
