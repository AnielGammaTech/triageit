-- TriageIt Initial Schema

-- Profiles (extends Supabase Auth users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'admin'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Integration credentials
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL CHECK (service IN ('halo', 'hudu', 'jumpcloud', 'datto', 'vultr', 'mxtoolbox')),
  display_name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  last_health_check TIMESTAMPTZ,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'down', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service)
);

-- Tickets from Halo PSA
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  halo_id INTEGER NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  details TEXT,
  client_name TEXT,
  client_id INTEGER,
  user_name TEXT,
  user_email TEXT,
  original_priority INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triaging', 'triaged', 'approved', 'error')),
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_halo_id ON tickets(halo_id);
CREATE INDEX idx_tickets_created_at ON tickets(created_at DESC);

-- Triage results
CREATE TABLE triage_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  classification JSONB NOT NULL,
  urgency_score INTEGER NOT NULL CHECK (urgency_score BETWEEN 1 AND 5),
  urgency_reasoning TEXT NOT NULL,
  recommended_priority INTEGER NOT NULL CHECK (recommended_priority BETWEEN 1 AND 5),
  recommended_team TEXT,
  recommended_agent TEXT,
  security_flag BOOLEAN NOT NULL DEFAULT false,
  security_notes TEXT,
  findings JSONB NOT NULL DEFAULT '{}',
  suggested_response TEXT,
  internal_notes TEXT,
  processing_time_ms INTEGER,
  model_tokens_used JSONB,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_triage_results_ticket_id ON triage_results(ticket_id);

-- Agent execution logs
CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'error', 'skipped')),
  input_summary TEXT,
  output_summary TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_logs_ticket_id ON agent_logs(ticket_id);
CREATE INDEX idx_agent_logs_agent_name ON agent_logs(agent_name);

-- Triage rules (for future customization)
CREATE TABLE triage_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row Level Security

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_rules ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read their own, admins can read all
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Integrations: admins only
CREATE POLICY "Admins can manage integrations"
  ON integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Tickets: all authenticated users can read
CREATE POLICY "Authenticated users can read tickets"
  ON tickets FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Tickets: service role can insert/update (for webhooks and worker)
CREATE POLICY "Service role can manage tickets"
  ON tickets FOR ALL
  USING (auth.uid() IS NOT NULL OR current_setting('role') = 'service_role');

-- Triage results: all authenticated users can read
CREATE POLICY "Authenticated users can read triage results"
  ON triage_results FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage triage results"
  ON triage_results FOR ALL
  USING (auth.uid() IS NOT NULL OR current_setting('role') = 'service_role');

-- Agent logs: all authenticated users can read
CREATE POLICY "Authenticated users can read agent logs"
  ON agent_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage agent logs"
  ON agent_logs FOR ALL
  USING (auth.uid() IS NOT NULL OR current_setting('role') = 'service_role');

-- Triage rules: admins only
CREATE POLICY "Admins can manage triage rules"
  ON triage_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Enable realtime for tickets and triage_results
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE triage_results;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_logs;
