-- Dylan is no longer active helpdesk staff. Keep the row for historical matching,
-- but remove it from active technician rosters and workload analytics.
update staff_members
set is_active = false,
    updated_at = now()
where lower(name) in ('dylan', 'dylan henjum');
