-- Weekly scoreboard deductions must survive ticket recovery. Live ticket flags
-- are operational state and are cleared when a ticket recovers, so they cannot
-- be the historical source of truth for a weekly competition.

CREATE TABLE IF NOT EXISTS weekly_score_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('sla_breach', 'overdue_customer_reply')),
  halo_ticket_id int NOT NULL,
  technician_name text NOT NULL,
  points numeric(6,2) NOT NULL CHECK (points < 0),
  occurred_at timestamptz NOT NULL,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_score_events_occurred
  ON weekly_score_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_score_events_tech_occurred
  ON weekly_score_events(technician_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_score_events_ticket
  ON weekly_score_events(halo_ticket_id, occurred_at DESC);

ALTER TABLE weekly_score_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read weekly score events"
  ON weekly_score_events FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Service role manages weekly score events"
  ON weekly_score_events FOR ALL
  USING (current_setting('role', true) = 'service_role')
  WITH CHECK (current_setting('role', true) = 'service_role');

-- Preserve known deductions from the current week so deploying this migration
-- does not make already-observed incidents disappear from the scoreboard.
WITH bounds AS (
  SELECT
    (
      date_trunc('week', now() AT TIME ZONE 'America/New_York')
      AT TIME ZONE 'America/New_York'
    ) AS week_start,
    to_char(
      date_trunc('week', now() AT TIME ZONE 'America/New_York'),
      'YYYY-MM-DD'
    ) AS week_key
),
known_sla AS (
  SELECT
    t.halo_id,
    t.halo_agent,
    t.summary,
    b.week_key,
    COALESCE(t.sla_breach_last_alert_at, t.sla_breach_alerted_at) AS occurred_at
  FROM tickets t, bounds b
  WHERE t.halo_agent IS NOT NULL
    AND lower(t.halo_agent) IN (
      'raul tapanes', 'jarid carlson', 'matthew lawyer',
      'ryan fitzpatrick', 'darren davillier'
    )
    AND COALESCE(t.sla_breach_last_alert_at, t.sla_breach_alerted_at) >= b.week_start
)
INSERT INTO weekly_score_events (
  event_key, event_type, halo_ticket_id, technician_name, points, occurred_at, summary, metadata
)
SELECT
  'sla_breach:' || week_key || ':' || halo_id,
  'sla_breach',
  halo_id,
  halo_agent,
  -3,
  occurred_at,
  summary,
  jsonb_build_object('source', 'ticket_sla_alert_backfill')
FROM known_sla
ON CONFLICT (event_key) DO NOTHING;

WITH bounds AS (
  SELECT (
    date_trunc('week', now() AT TIME ZONE 'America/New_York')
    AT TIME ZONE 'America/New_York'
  ) AS week_start
),
known_reply AS (
  SELECT
    t.halo_id,
    t.halo_agent,
    t.summary,
    t.last_customer_reply_at,
    GREATEST(t.last_response_alert_at, t.last_escalation_alert_at) AS occurred_at
  FROM tickets t, bounds b
  WHERE t.halo_agent IS NOT NULL
    AND t.last_customer_reply_at IS NOT NULL
    AND lower(t.halo_agent) IN (
      'raul tapanes', 'jarid carlson', 'matthew lawyer',
      'ryan fitzpatrick', 'darren davillier'
    )
    AND GREATEST(t.last_response_alert_at, t.last_escalation_alert_at) >= b.week_start
)
INSERT INTO weekly_score_events (
  event_key, event_type, halo_ticket_id, technician_name, points, occurred_at, summary, metadata
)
SELECT
  'overdue_customer_reply:' || halo_id || ':' ||
    (extract(epoch FROM last_customer_reply_at) * 1000)::bigint,
  'overdue_customer_reply',
  halo_id,
  halo_agent,
  -2,
  occurred_at,
  summary,
  jsonb_build_object('source', 'ticket_response_alert_backfill')
FROM known_reply
ON CONFLICT (event_key) DO NOTHING;
