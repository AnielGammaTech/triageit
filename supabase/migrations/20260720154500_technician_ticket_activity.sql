-- Durable, deduplicated Halo action ledger for management reporting.
-- Stores operational metadata only; customer message/note bodies are intentionally omitted.

CREATE TABLE IF NOT EXISTS technician_ticket_activity (
  halo_action_id bigint NOT NULL,
  halo_ticket_id int NOT NULL,
  technician_name text NOT NULL,
  technician_agent_id int,
  action_at timestamptz NOT NULL,
  category text NOT NULL CHECK (category IN (
    'customer_email', 'private_note', 'status_change', 'assignment_change',
    'appointment', 'phone_call', 'work_log', 'other'
  )),
  outcome text,
  is_customer_visible boolean NOT NULL DEFAULT false,
  email_direction text,
  old_status text,
  new_status text,
  work_minutes numeric(10,2) NOT NULL DEFAULT 0,
  charged_hours numeric(10,2) NOT NULL DEFAULT 0,
  noncharge_hours numeric(10,2) NOT NULL DEFAULT 0,
  is_billable boolean,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (halo_ticket_id, halo_action_id)
);

CREATE INDEX IF NOT EXISTS idx_technician_activity_action_at
  ON technician_ticket_activity(action_at DESC);
CREATE INDEX IF NOT EXISTS idx_technician_activity_tech_date
  ON technician_ticket_activity(technician_name, action_at DESC);
CREATE INDEX IF NOT EXISTS idx_technician_activity_ticket
  ON technician_ticket_activity(halo_ticket_id, action_at DESC);

CREATE TABLE IF NOT EXISTS technician_activity_ticket_sync (
  halo_ticket_id int PRIMARY KEY,
  last_halo_action_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE technician_ticket_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_activity_ticket_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read technician activity"
  ON technician_ticket_activity FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Service role manages technician activity"
  ON technician_ticket_activity FOR ALL
  USING (current_setting('role', true) = 'service_role')
  WITH CHECK (current_setting('role', true) = 'service_role');
CREATE POLICY "Service role manages technician activity sync"
  ON technician_activity_ticket_sync FOR ALL
  USING (current_setting('role', true) = 'service_role')
  WITH CHECK (current_setting('role', true) = 'service_role');
