-- Track which SLA breaches have already fired a Teams alert so the 3-hourly
-- scan alerts ONCE per breach instead of re-pinging forever.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breach_alerted_at timestamptz;
