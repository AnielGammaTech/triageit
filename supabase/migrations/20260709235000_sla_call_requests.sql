-- Outbound SLA escalation call queue: rows inserted by the SLA scan (or
-- manually); the worker's /sla-call-requests handler dials the tech.
CREATE TABLE IF NOT EXISTS sla_call_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  halo_id int NOT NULL,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Extension-based dialing: phone optional, resolved from the tech's 3CX
-- extension by name at call time.
ALTER TABLE sla_call_requests ADD COLUMN IF NOT EXISTS tech_name text;
ALTER TABLE sla_call_requests ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE sla_call_requests ADD COLUMN IF NOT EXISTS objective text;
