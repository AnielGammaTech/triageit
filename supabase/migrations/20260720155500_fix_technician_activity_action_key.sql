-- Halo action IDs are scoped to a ticket, not globally unique. Rebuild the
-- just-created ledger with the correct composite identity before production use.
TRUNCATE TABLE technician_ticket_activity, technician_activity_ticket_sync;

ALTER TABLE technician_ticket_activity
  DROP CONSTRAINT IF EXISTS technician_ticket_activity_pkey;
ALTER TABLE technician_ticket_activity
  ADD CONSTRAINT technician_ticket_activity_pkey
  PRIMARY KEY (halo_ticket_id, halo_action_id);
