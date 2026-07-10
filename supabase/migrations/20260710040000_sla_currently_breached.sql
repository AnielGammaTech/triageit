-- Live SLA-breach flag maintained by the SLA scan every run: true only while
-- the ticket is ACTUALLY breaching right now (negative timer, not on hold).
-- The SLA Hunter "Currently Breaching" panel reads this instead of the sticky
-- sla_breach_alerted_at (which is an alert-tracking flag, not live state — a
-- ticket that went Waiting-on-Customer paused its timer but kept the alert flag).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_currently_breached boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_tickets_sla_currently_breached ON tickets(sla_currently_breached) WHERE sla_currently_breached;
