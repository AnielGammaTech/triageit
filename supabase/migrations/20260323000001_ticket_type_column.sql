-- Add tickettype_id column to tickets table for proper ticket type tracking
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tickettype_id INTEGER;

-- Index for filtering by ticket type
CREATE INDEX IF NOT EXISTS idx_tickets_tickettype_id ON tickets(tickettype_id);

-- Remove the restrictive service check constraint from integration_mappings.
-- The original migration only allowed 6 services but the app uses more (cove, 3cx, etc.).
-- Validation is handled at the application layer.
ALTER TABLE integration_mappings DROP CONSTRAINT IF EXISTS integration_mappings_service_check;
