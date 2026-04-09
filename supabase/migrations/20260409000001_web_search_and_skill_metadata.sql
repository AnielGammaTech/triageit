-- Add web-search to the integrations service CHECK constraint
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_service_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_service_check
  CHECK (service IN (
    'halo', 'hudu', 'jumpcloud', 'datto', 'datto-edr', 'rocketcyber',
    'unifi', 'vpentest', 'saas-alerts', 'unitrends', 'cove', 'pax8',
    'vultr', 'mxtoolbox', 'dmarc', 'threecx', 'twilio', 'spanning',
    'ai-provider', 'teams', 'cipp', 'web-search'
  ));

-- Add web-search to integration_mappings service CHECK
ALTER TABLE integration_mappings DROP CONSTRAINT IF EXISTS integration_mappings_service_check;
ALTER TABLE integration_mappings ADD CONSTRAINT integration_mappings_service_check
  CHECK (service IN (
    'halo', 'hudu', 'jumpcloud', 'datto', 'datto-edr', 'rocketcyber',
    'unifi', 'vpentest', 'saas-alerts', 'unitrends', 'cove', 'pax8',
    'vultr', 'mxtoolbox', 'dmarc', 'threecx', 'twilio', 'spanning',
    'ai-provider', 'teams', 'cipp', 'web-search'
  ));

-- Index for finding auto-generated skills (for admin review)
CREATE INDEX IF NOT EXISTS idx_agent_skills_auto_generated
  ON agent_skills ((metadata->>'auto_generated'))
  WHERE metadata->>'auto_generated' = 'true';
