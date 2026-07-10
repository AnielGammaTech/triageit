-- Add 'msgraph' (Microsoft 365 Calendar) to the integrations service CHECK.
-- Also restores 'branding', which the 20260409 web-search migration
-- accidentally dropped from the list when it rebuilt the constraint.
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_service_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_service_check
  CHECK (service IN (
    'halo', 'hudu', 'jumpcloud', 'datto', 'datto-edr', 'rocketcyber',
    'unifi', 'vpentest', 'saas-alerts', 'unitrends', 'cove', 'pax8',
    'vultr', 'mxtoolbox', 'dmarc', 'threecx', 'twilio', 'spanning',
    'ai-provider', 'teams', 'cipp', 'branding', 'web-search', 'msgraph'
  ));
