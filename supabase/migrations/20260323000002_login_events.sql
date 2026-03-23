-- Login events table — captures device/IP info on every sign-in
CREATE TABLE IF NOT EXISTS login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address TEXT,
  user_agent TEXT,
  device_type TEXT, -- 'desktop', 'mobile', 'tablet', 'unknown'
  browser TEXT,
  os TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_created_at ON login_events(created_at DESC);

-- RLS
ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;

-- Admins can read all login events
CREATE POLICY "Admins can read login events"
  ON login_events FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Service role can insert (from API)
CREATE POLICY "Service can insert login events"
  ON login_events FOR INSERT
  WITH CHECK (true);
