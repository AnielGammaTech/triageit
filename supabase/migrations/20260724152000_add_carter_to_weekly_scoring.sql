-- Carter Zimny is a helpdesk technician and must participate in the same
-- weekly competition as the rest of the helpdesk roster.

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
  WHERE lower(t.halo_agent) = 'carter zimny'
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
  jsonb_build_object('source', 'carter_roster_backfill')
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
  WHERE lower(t.halo_agent) = 'carter zimny'
    AND t.last_customer_reply_at IS NOT NULL
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
  jsonb_build_object('source', 'carter_roster_backfill')
FROM known_reply
ON CONFLICT (event_key) DO NOTHING;

-- The activity ledger previously discarded Carter's Halo actions at
-- classification time. Reset only the current score week's sync watermarks;
-- the hourly idempotent action sync will re-read those tickets and recover his
-- emails and other verified work without duplicating existing technicians.
WITH bounds AS (
  SELECT (
    date_trunc('week', now() AT TIME ZONE 'America/New_York')
    AT TIME ZONE 'America/New_York'
  ) AS week_start
)
DELETE FROM technician_activity_ticket_sync sync
USING tickets t, bounds b
WHERE sync.halo_ticket_id = t.halo_id
  AND t.last_tech_action_at >= b.week_start;
