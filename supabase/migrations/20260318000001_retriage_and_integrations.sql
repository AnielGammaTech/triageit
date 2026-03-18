-- Add re-triage support and new integrations

-- Add triage_type to distinguish initial vs re-triage
ALTER TABLE triage_results ADD COLUMN triage_type TEXT NOT NULL DEFAULT 'initial'
  CHECK (triage_type IN ('initial', 'retriage'));

-- Add Halo status tracking to tickets
ALTER TABLE tickets ADD COLUMN halo_status TEXT;
ALTER TABLE tickets ADD COLUMN halo_status_id INTEGER;
ALTER TABLE tickets ADD COLUMN halo_team TEXT;
ALTER TABLE tickets ADD COLUMN halo_agent TEXT;
ALTER TABLE tickets ADD COLUMN halo_sla_status TEXT;
ALTER TABLE tickets ADD COLUMN last_retriage_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN last_customer_reply_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN last_tech_action_at TIMESTAMPTZ;

CREATE INDEX idx_tickets_halo_status ON tickets(halo_status);
CREATE INDEX idx_triage_results_type ON triage_results(triage_type);

-- Update integrations service check to include teams and cipp
ALTER TABLE integrations DROP CONSTRAINT integrations_service_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_service_check
  CHECK (service IN ('halo', 'hudu', 'jumpcloud', 'datto', 'vultr', 'mxtoolbox', 'teams', 'cipp'));

-- Triage rules: add rule_type for categorization
ALTER TABLE triage_rules ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'classification'
  CHECK (rule_type IN ('classification', 'routing', 'notification', 'sla', 'escalation'));

-- Seed default triage rules
INSERT INTO triage_rules (name, description, rule_type, conditions, actions, priority, is_active) VALUES
(
  'WOT > 1 Day Alert',
  'Alert when a ticket has been in Waiting on Tech status for more than 24 hours',
  'escalation',
  '{"status": "Waiting on Tech", "age_hours": 24}',
  '{"notify_teams": true, "flag": "wot_overdue"}',
  1,
  true
),
(
  'Customer Reply > 1 Day Alert',
  'Immediate alert when customer replied but no tech response for 24+ hours',
  'escalation',
  '{"status": "Customer Reply", "age_hours": 24}',
  '{"notify_teams": true, "immediate": true, "flag": "customer_waiting"}',
  1,
  true
),
(
  'SLA Breach Warning',
  'Alert when a ticket is within 30 minutes of SLA breach',
  'sla',
  '{"sla_remaining_minutes": 30}',
  '{"notify_teams": true, "flag": "sla_risk"}',
  2,
  true
),
(
  'Unassigned Ticket Alert',
  'Flag tickets that have been unassigned for more than 2 hours',
  'routing',
  '{"assigned_agent": null, "age_hours": 2}',
  '{"notify_teams": true, "flag": "unassigned"}',
  3,
  true
),
(
  'Skip Notifications',
  'Fast-path billing notifications and transactional emails — skip Sonnet',
  'classification',
  '{"urgency_max": 2, "subtypes": ["notification", "transactional", "confirmation", "receipt", "alert", "auto-replenish"]}',
  '{"skip_manager": true, "team": "General"}',
  1,
  true
),
(
  'Security Escalation',
  'Immediately escalate security-flagged tickets to Security team',
  'routing',
  '{"security_flag": true}',
  '{"team": "Security", "notify_teams": true, "priority_override": 1}',
  1,
  true
);
