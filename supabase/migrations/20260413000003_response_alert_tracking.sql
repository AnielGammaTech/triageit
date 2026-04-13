-- Response alert dedup columns
alter table tickets add column if not exists last_response_alert_at timestamptz;
alter table tickets add column if not exists last_escalation_alert_at timestamptz;
