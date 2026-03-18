-- Integration customer mappings
-- Maps external service customers/sites to internal client identifiers
CREATE TABLE integration_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('halo', 'hudu', 'jumpcloud', 'datto', 'vultr', 'mxtoolbox')),
  external_id TEXT NOT NULL,
  external_name TEXT NOT NULL,
  customer_name TEXT,
  customer_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(integration_id, external_id)
);

CREATE INDEX idx_integration_mappings_integration ON integration_mappings(integration_id);
CREATE INDEX idx_integration_mappings_service ON integration_mappings(service);
CREATE INDEX idx_integration_mappings_customer ON integration_mappings(customer_id);

ALTER TABLE integration_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage integration mappings"
  ON integration_mappings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Service role can manage integration mappings"
  ON integration_mappings FOR ALL
  USING (current_setting('role') = 'service_role');
