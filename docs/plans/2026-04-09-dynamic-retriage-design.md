# Dynamic Retriage & Notification Cleanup — Design

## Overview

Redesign the retriage system to be urgency-based (not fixed 3-hour cycles), AI-driven (not just rule-based), and honest (Michael Scott as manager holding techs accountable). Clean up Teams notifications to only alert when something actually needs attention.

## Retriage Timing

Clock resets only on **customer-facing activity** (visible replies). Internal notes don't reset it.

| Urgency | Interval | Examples |
|---------|----------|----------|
| 4-5 (Critical) | 1 hour | Server down, security breach, business-critical system offline |
| 3 (Medium) | 2 hours | Can't print, email issues, VPN not connecting |
| 1-2 (Low) | 3 hours | Feature request, minor annoyance, cosmetic issue |

- Scan runs every 30 minutes
- For each open Gamma Default ticket: `now - last_customer_facing_activity > urgency_interval`
- If no customer-facing activity exists, use `created_at`
- Retriage uses AI (not just rules) to analyze the ticket holistically

## AI-Driven Retriage (Not Just Rules)

The retriage should use AI to make judgment calls:
- Analyze the full conversation history
- Consider what the customer is expecting vs what's happened
- Use memories from past similar tickets to inform assessment
- Use learned skills to recognize patterns
- Make management-level decisions: is this ticket being handled well?

The current rule-based checks (WOT overdue, customer waiting, etc.) become inputs to the AI, not the final decision. The AI synthesizes everything and produces a holistic assessment.

## Teams Notifications — Only When It Matters

**Send alerts for:**
- Tech review is **poor** or **needs_improvement**
- Customer waiting > 1 hour with no visible reply
- Update request detected ("any update?", "status?")
- New triage with **urgency 3+** only

**Stop sending:**
- Every new triage (urgency 1-2 — routine tickets)
- "All clear" summaries when nothing is wrong
- Good/great tech reviews

## Tech Review Standards (Michael as Manager)

Michael Scott manages the team. He's honest, fair, but holds standards. When unsure about standards, he escalates to David Wallace (the admin).

**Red flags to enforce:**
- **No documentation on resolution** — ticket closed with no resolution steps → poor rating ("Ticket resolved but no resolution steps documented. Hudu cannot learn from this.")
- **Reopened without explanation** — resolved ticket reopened with no note → flag it, question the tech
- **No customer communication** — internal work but customer hasn't heard anything → flag even if tech is working behind the scenes
- **Generic canned response** — tech sent a template without addressing the actual issue → call it out
- **Closed without fixing** — customer still has the problem → poor rating

**AI-informed decisions:**
- Use memories: "Last time this client had this issue, it took 2 days. This tech resolved it in 4 hours — great job."
- Use skills: "For printer issues, the standard response time is X based on our learned procedures."
- Use ticket context: "The customer asked for a callback and the tech only sent an email — communication mismatch."

## Code Changes

| File | Change |
|------|--------|
| `daily-scan.ts` | Urgency-based interval, customer-facing activity clock, AI-driven assessment |
| `scheduler.ts` | Change retriage cron from 3h to 30min |
| `michael-scott.ts` | Filter Teams notifications to urgency 3+ |
| `tech-reviewer.ts` | Add documentation, reopened, and communication red flags; use AI holistically |
| `teams/client.ts` | Called less often, only for actionable alerts |
