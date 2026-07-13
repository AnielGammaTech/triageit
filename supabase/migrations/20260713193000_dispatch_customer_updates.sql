-- Tech-confirmed customer updates from SLA calls. The voice assistant may
-- only stage a draft here; a signed-in person must approve it in Dispatch
-- before the worker creates a customer email action in Halo.
CREATE TABLE IF NOT EXISTS dispatch_customer_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  halo_id int NOT NULL,
  ticket_summary text NOT NULL,
  client_name text,
  customer_name text,
  customer_email text,
  tech_name text,
  customer_waiting_reason text NOT NULL,
  raw_message text NOT NULL,
  draft_message text NOT NULL,
  source text NOT NULL DEFAULT 'sla_call',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'dismissed', 'failed')),
  tech_approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by_user_id uuid,
  approved_by_email text,
  approved_at timestamptz,
  sent_at timestamptz,
  dismissed_at timestamptz,
  halo_action_id int,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_customer_updates_queue
  ON dispatch_customer_updates (status, created_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_customer_updates_ticket
  ON dispatch_customer_updates (halo_id, created_at DESC);

ALTER TABLE dispatch_customer_updates ENABLE ROW LEVEL SECURITY;

-- Browser clients never access this table directly. The authenticated web
-- route proxies through the worker's service-role client so every approval
-- can be attributed and the send can be claimed atomically.
