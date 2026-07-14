-- First-response accountability. Tracking starts when this migration lands so
-- the first worker scan cannot turn historical tickets into a notification
-- flood. Customer email still requires a signed-in Dispatch approval.
CREATE TABLE IF NOT EXISTS response_compliance_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  tracking_started_at timestamptz NOT NULL DEFAULT now(),
  acknowledgment_minutes int NOT NULL DEFAULT 30 CHECK (acknowledgment_minutes > 0),
  technician_response_minutes int NOT NULL DEFAULT 60 CHECK (technician_response_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO response_compliance_settings (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ticket_response_compliance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  halo_id int NOT NULL UNIQUE,
  ticket_summary text NOT NULL,
  client_name text,
  ticket_created_at timestamptz NOT NULL,
  acknowledgment_due_at timestamptz NOT NULL,
  acknowledgment_at timestamptz,
  acknowledgment_by text,
  acknowledgment_action_id int,
  acknowledgment_met boolean,
  dispatcher_outcome text NOT NULL DEFAULT 'pending'
    CHECK (dispatcher_outcome IN ('pending', 'met', 'missed', 'pto_exempt', 'pto_unknown')),
  dispatcher_pto_status text NOT NULL DEFAULT 'unknown'
    CHECK (dispatcher_pto_status IN ('yes', 'no', 'unknown')),
  dispatcher_missed_at timestamptz,
  approval_id uuid REFERENCES dispatch_customer_updates(id) ON DELETE SET NULL,
  teams_alerted_at timestamptz,
  assigned_tech text,
  assigned_at timestamptz,
  technician_response_due_at timestamptz,
  technician_response_at timestamptz,
  technician_response_action_id int,
  technician_response_met boolean,
  technician_missed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_response_compliance_ack_pending
  ON ticket_response_compliance (acknowledgment_due_at)
  WHERE acknowledgment_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_response_compliance_tech_pending
  ON ticket_response_compliance (technician_response_due_at)
  WHERE assigned_at IS NOT NULL AND technician_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_response_compliance_created
  ON ticket_response_compliance (ticket_created_at DESC);

ALTER TABLE response_compliance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_response_compliance ENABLE ROW LEVEL SECURITY;

-- Initial acknowledgments are system-drafted but retain the same human
-- approval and audit trail as technician-requested customer updates.
ALTER TABLE dispatch_customer_updates
  ADD COLUMN IF NOT EXISTS approval_reason text;
