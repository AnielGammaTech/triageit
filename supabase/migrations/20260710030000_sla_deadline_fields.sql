-- SLA deadline fields captured from Halo's open-ticket list (includeslainfo),
-- so the SLA Hunter can surface UPCOMING breaches — especially ones due
-- outside business hours where no one is working to prevent the breach.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_fix_by timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_respond_by timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_on_hold boolean NOT NULL DEFAULT false;
