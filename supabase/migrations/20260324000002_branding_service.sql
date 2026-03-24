-- Add 'branding' to the integrations service CHECK constraint
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_service_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_service_check
  CHECK (service IN (
    'halo', 'hudu', 'jumpcloud', 'datto', 'datto-edr', 'rocketcyber',
    'unifi', 'vpentest', 'saas-alerts', 'unitrends', 'cove', 'pax8',
    'vultr', 'mxtoolbox', 'dmarc', 'threecx', 'twilio', 'spanning',
    'ai-provider', 'teams', 'cipp', 'branding'
  ));
