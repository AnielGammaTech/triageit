-- Correct canonical staff roles used by TriageIT analytics and review logic.
-- Jonathan handles project work. Roman and Todd are sales, not technicians.

update staff_members
set role = 'project_manager',
    updated_at = now()
where lower(name) = 'jonathan';

update staff_members
set role = 'sales',
    updated_at = now()
where lower(name) in ('roman', 'todd');

