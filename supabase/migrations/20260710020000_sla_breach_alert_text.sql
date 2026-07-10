-- Persist the exact Teams breach-alert message sent for a ticket, so the SLA
-- Hunter tab can show "the message sent" for accountability.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breach_last_alert_text text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breach_last_alert_at timestamptz;
