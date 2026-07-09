-- Escalating SLA breach alerts: count re-alerts so the 2nd/3rd/nth notice
-- says so. Paired with sla_breach_alerted_at (reset together on recovery).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breach_alert_count int NOT NULL DEFAULT 0;
