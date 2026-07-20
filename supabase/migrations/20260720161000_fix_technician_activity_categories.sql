-- Halo includes ticket status metadata on ordinary note actions. Correct the
-- first activity backfill so private notes are not reported as status changes.
UPDATE technician_ticket_activity
SET category = 'private_note'
WHERE is_customer_visible = false
  AND outcome ILIKE '%note%'
  AND category <> 'private_note';
