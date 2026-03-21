-- ═══════════════════════════════════════════════════════════════════════
-- Operational knowledge skills for Michael Scott (manager agent)
-- These encode business rules, response thresholds, and workflow knowledge
-- that the triage pipeline needs to follow.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Gamma Tech Operational Rules ─────────────────────────────────────

INSERT INTO agent_skills (agent_name, title, content, skill_type) VALUES
('michael_scott', 'Response Time & SLA Rules', E'## Tech Response Time Requirements

### Customer Reply Response Threshold
- When a customer replies to a ticket, the assigned tech must respond within **1 hour** during business hours.
- This applies to ALL priorities (P1 through P5) equally.
- **Business hours**: 7:00 AM - 6:00 PM Eastern Time, Monday through Friday.
- If a customer replies outside business hours (evenings, weekends), the clock starts at the next business day open (7:00 AM ET Monday-Friday).

### Excluded from Response Checks
- **Automated alerts**: Tickets classified as alerts (Datto alerts, monitoring notifications, etc.) are excluded from response-time checks. Alerts are not customer interactions.
- **Waiting on Customer** status: The tech already responded and is waiting for the customer — do not flag.

### NOT Excluded (still monitored)
- **Waiting on Vendor / Pending Vendor**: The tech is waiting on a third party, BUT they must still update the customer every **48 hours** with a visible note (e.g., "Still waiting on vendor, will follow up"). Customers get upset when they hear nothing for weeks.
- **On Hold / Scheduled**: Same 48-hour customer-visible update requirement.

### Escalation Policy
- When a customer reply goes unanswered for 1+ hour: Send a Teams alert to management.
- No auto-reassignment or priority changes — management handles escalation manually.
- If a customer explicitly asks for an update ("any news?", "status?", "following up"), flag this as an **update request** — these are high-priority customer satisfaction signals.', 'instruction'),

('michael_scott', 'Team & People Context', E'## Gamma Tech Services LLC
- MSP based in Naples, FL
- Domains: gtmail.us, gamma.tech
- Helpdesk email: help@gamma.tech
- When you see Gamma Tech, gtmail.us, or gamma.tech in tickets — that is US (the MSP), not a client.

## Key People
- **Bryanna**: The only dispatcher. She assigns tickets to technicians. If a ticket is unassigned, Bryanna needs to assign it.
- Technicians are identified by the Halo assigned agent field (agent_name). Use the assigned agent — not whoever last commented — to determine who is responsible for a ticket.

## Communication Standards
- Techs must document their work with internal notes in Halo.
- Techs must keep customers informed — even when waiting on a vendor or third party.
- Customer satisfaction is the #1 priority. Lack of communication is the biggest complaint.
- A ticket open for 1+ day with zero internal notes from the tech is a documentation gap — flag it.
- A ticket open for 7+ days with fewer than 3 tech actions indicates low progress — flag it.', 'context'),

('michael_scott', 'Triage Workflow Rules', E'## When to Retriage
1. **Customer reply**: Immediate retriage when ticket status changes to "Customer Reply"
2. **Hourly check**: Every hour, check for customer replies with no tech response within 1 business hour
3. **3-hour full scan**: Every 3 hours, scan ALL open tickets for stale/unassigned/SLA/documentation issues
4. **Manual**: Admin can retriage any single ticket or bulk-retriage from the dashboard

## What to Skip
- **Alerts**: Automated monitoring alerts (Datto, backup failures, etc.) get the alert fast-path — quick Haiku summary, no full Sonnet pipeline.
- **Notifications**: Transactional emails (invoices, confirmations, renewals) get the notification fast-path — no specialists needed.
- **Closed tickets**: Do not triage unless they are re-opened by a customer reply.

## Retriage vs First Triage
- First triage: Full detailed Halo note with the complete triage table.
- Retriage: Compact review note — priority recommendation + doc gaps inline, not the full table.
- The consumer deduplicates: if a ticket was triaged less than 30 minutes ago, skip it.

## Priority Recommendations
- When recommending priority changes, compare against the ticket''s original_priority from Halo.
- Only recommend a change when there is a meaningful discrepancy — don''t recommend P3→P3.
- Include the reasoning for any priority change recommendation.', 'instruction');
