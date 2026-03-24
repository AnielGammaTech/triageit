-- Add a flag to track whether Halo considers a ticket "open" (in the open queue).
-- The pull-tickets sync sets this based on Halo's open_only=true API response,
-- which is the source of truth. This avoids guessing from status names.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS halo_is_open boolean DEFAULT true;

-- Backfill: tickets with resolved/closed status are not open
UPDATE tickets
SET halo_is_open = false
WHERE lower(halo_status) IN ('closed', 'cancelled', 'completed')
   OR lower(halo_status) LIKE 'resolved%';
