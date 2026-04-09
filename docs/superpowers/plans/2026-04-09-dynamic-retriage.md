# Dynamic Retriage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retriage urgency-based (critical=1h, medium=2h, low=3h), reset clock only on customer-facing activity, use AI holistically for assessments, and clean up Teams notifications to only alert on real problems.

**Architecture:** Modify the daily-scan to check per-ticket timing based on urgency and last customer-facing activity. Change the cron schedule from 3h to 30min. Update tech reviewer to flag no-documentation and reopened-without-reason. Filter Teams notifications to urgency 3+ and bad reviews only.

**Tech Stack:** Node.js, TypeScript, BullMQ, Anthropic Claude API, Halo PSA API

---

## File Structure

### Modified Files
- `apps/worker/src/agents/retriage/daily-scan.ts` — Urgency-based timing, AI-driven assessment, customer-facing clock
- `apps/worker/src/agents/manager/tech-reviewer.ts` — New red flags (no documentation, reopened without reason)
- `apps/worker/src/agents/manager/michael-scott.ts` — Filter Teams to urgency 3+ only
- `apps/worker/src/cron/scheduler.ts` — Update default retriage schedule to 30min
- `supabase/migrations/20260319000004_seed_agent_skills.sql` — N/A (cron_jobs table updated via SQL)

### No New Files
All changes are modifications to existing files.

---

## Task 1: Urgency-Based Retriage Timing in Daily Scan

**Files:**
- Modify: `apps/worker/src/agents/retriage/daily-scan.ts`

This is the core change. The scan currently processes every open ticket. Now it should skip tickets whose urgency-based timer hasn't expired yet.

- [ ] **Step 1: Add urgency interval helper function**

Add after the `getLastTechAction` function (after line 138):

```typescript
/**
 * Get the retriage interval in hours based on ticket urgency.
 * Critical tickets get checked more frequently.
 */
function getRetriageIntervalHours(urgencyScore: number | null): number {
  if (urgencyScore === null) return 3; // default if unknown
  if (urgencyScore >= 4) return 1;    // critical: every hour
  if (urgencyScore === 3) return 2;   // medium: every 2 hours
  return 3;                           // low: every 3 hours
}

/**
 * Get the last customer-facing activity timestamp.
 * Only visible replies count — internal notes do NOT reset the clock.
 * Falls back to ticket creation date if no customer-facing activity exists.
 */
function getLastCustomerFacingActivity(
  actions: ReadonlyArray<HaloAction>,
  ticketCreatedAt: string | undefined,
): string {
  // Customer-facing = not hidden from user, and not from TriageIt
  const customerFacing = actions.filter(
    (a) => !a.hiddenfromuser && a.who && !a.who.toLowerCase().includes("triageit"),
  );

  if (customerFacing.length === 0) return ticketCreatedAt ?? new Date().toISOString();

  const sorted = [...customerFacing].sort(
    (a, b) =>
      new Date(b.datecreated ?? "").getTime() -
      new Date(a.datecreated ?? "").getTime(),
  );

  return sorted[0]?.datecreated ?? ticketCreatedAt ?? new Date().toISOString();
}
```

- [ ] **Step 2: Add timer check in the main scan loop**

In `runDailyScan()`, after the alert-ticket skip block and before the rule-based checks, add a timer check. Find the section after `enrichedTicket` is resolved (around line 599+) and before `quickRuleCheck` is called. Add:

```typescript
      // ── Urgency-based timer check ──
      // Look up the last triage's urgency score for this ticket
      let urgencyScore: number | null = null;
      if (localTicket) {
        const { data: lastTriage } = await supabase
          .from("triage_results")
          .select("urgency_score")
          .eq("ticket_id", localTicket.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        urgencyScore = (lastTriage?.urgency_score as number) ?? null;
      }

      const intervalHours = getRetriageIntervalHours(urgencyScore);
      const lastCustomerFacing = getLastCustomerFacingActivity(actions, enrichedTicket.datecreated);
      const hoursSinceCustomerFacing =
        (Date.now() - new Date(lastCustomerFacing).getTime()) / (1000 * 60 * 60);

      // Skip if timer hasn't expired yet
      if (hoursSinceCustomerFacing < intervalHours) {
        // Still upsert tracking data
        await upsertTicketFromHalo(supabase, enrichedTicket, actions, halo);
        continue;
      }
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/agents/retriage/daily-scan.ts
git commit -m "feat: urgency-based retriage timing — critical=1h, medium=2h, low=3h, customer-facing clock"
```

---

## Task 2: AI-Driven Retriage Assessment

**Files:**
- Modify: `apps/worker/src/agents/retriage/daily-scan.ts`

Update the retriage prompt to be more holistic — Michael Scott as manager, not just a rule checker.

- [ ] **Step 1: Replace RETRIAGE_PROMPT**

Replace the `RETRIAGE_PROMPT` constant (lines 34-61) with:

```typescript
const RETRIAGE_PROMPT = `You are Michael Scott, Regional Manager at Gamma Tech Services. You're reviewing an open support ticket to determine if the assigned technician is handling it properly.

You are the MANAGER. These are YOUR employees. You hold them to YOUR standards. Be honest, fair, but firm.

## What You're Evaluating

1. **Customer Communication** — Has the tech communicated with the customer? If the customer is waiting and hasn't heard anything, that's a failure. Internal notes don't count — the CUSTOMER needs to know what's happening.

2. **Response Time** — How fast did the tech respond to the customer's messages? Over 1 hour during business hours is concerning. Over 4 hours is unacceptable for urgent tickets.

3. **Documentation** — Is the tech documenting their work? If the ticket gets resolved with no notes about what they did, that's a red flag. We need this for Hudu and for the team to learn.

4. **Progress** — Is the tech actually making progress, or just touching the ticket without advancing it? Look at the conversation — is the issue getting closer to resolution?

5. **Ticket Hygiene** — If the ticket was resolved and reopened, is there a reason? If it's been open for days with no movement, why?

## Your Judgment Calls

Use what you've learned from past tickets (your memories) to inform your assessment. If you've seen this tech handle similar tickets well before, note it. If they have a pattern of slow responses, call it out.

When you're not sure if something is acceptable, err on the side of flagging it. It's better to ask than to let a customer wait.

## Output Format
Respond with ONLY valid JSON:
{
  "flags": ["list any issues found — use descriptive names like: customer_waiting_no_reply, no_documentation, slow_response, stale_no_progress, reopened_no_explanation, unassigned, sla_at_risk, closed_without_documentation"],
  "positives": ["list good behaviors — like: fast_response, good_communication, well_documented, proactive_followup, thorough_troubleshooting"],
  "severity": "critical|warning|info",
  "recommendation": "What should the tech do RIGHT NOW? Be specific and direct. Address the tech by name. Max 3 sentences.",
  "customer_impact": "How is the customer being affected? Is someone waiting? Is their business impacted?"
}`;
```

- [ ] **Step 2: Commit**

```bash
git add apps/worker/src/agents/retriage/daily-scan.ts
git commit -m "feat: AI-driven retriage — Michael Scott as manager, holistic ticket assessment"
```

---

## Task 3: Tech Reviewer — New Red Flags

**Files:**
- Modify: `apps/worker/src/agents/manager/tech-reviewer.ts`

Add three new red flags to the tech review prompt.

- [ ] **Step 1: Read the current file to find the prompt**

Read `apps/worker/src/agents/manager/tech-reviewer.ts` and find the system prompt where the rating criteria are defined.

- [ ] **Step 2: Add new red flags to the tech review prompt**

Find the "Hard calls" section in the prompt and add these after the existing hard calls:

```typescript
  - Ticket resolved but no documentation of HOW it was resolved → POOR. Say: "Ticket resolved but no resolution steps documented. Without documentation, Hudu can't learn from this and the team can't reference it for similar issues."
  - Ticket was resolved then reopened with no explanation in the notes → flag it. Say: "This ticket was reopened after being resolved, but there's no note explaining why. What changed?"
  - Tech is doing internal work but hasn't communicated with the customer at all → flag it even if work is happening. Say: "There's internal activity on this ticket but the customer hasn't been updated. Even a quick 'we're working on it' goes a long way."
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/agents/manager/tech-reviewer.ts
git commit -m "feat: tech reviewer flags no-documentation, reopened-without-reason, no-customer-communication"
```

---

## Task 4: Filter Teams Notifications

**Files:**
- Modify: `apps/worker/src/agents/manager/michael-scott.ts`

Only send Teams notifications for urgency 3+ new triages. The Teams client calls for daily summaries and tech performance stay as-is (they're already filtered to problems).

- [ ] **Step 1: Find the Teams notification call in michael-scott.ts**

Search for `sendTriageSummary` or `TeamsClient` in michael-scott.ts. Find where it sends the new-triage Teams notification.

- [ ] **Step 2: Wrap the Teams notification in an urgency check**

Add a condition: only send if `classification.urgency_score >= 3`:

```typescript
      // Only notify Teams for urgent tickets (3+) — routine tickets don't need alerts
      if (classification.urgency_score >= 3) {
        // existing Teams notification code
      }
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/agents/manager/michael-scott.ts
git commit -m "feat: Teams notifications only for urgency 3+ new triages"
```

---

## Task 5: Update Cron Schedule

**Files:**
- Modify: `apps/worker/src/cron/scheduler.ts` (documentation only — actual schedule is in DB)

The cron schedule lives in the `cron_jobs` database table. Update it via SQL.

- [ ] **Step 1: SQL to update retriage schedule**

```sql
UPDATE cron_jobs
SET schedule = '*/30 * * * *'
WHERE endpoint = '/retriage';
```

This changes the retriage scan from every 3 hours to every 30 minutes. The urgency-based timer check in Task 1 ensures we only retriage tickets whose timer has expired.

- [ ] **Step 2: Update the scheduler.ts default comment**

Find the comment about default cron patterns and update it to reflect the new 30-minute schedule for retriage:

```typescript
// Default: retriage scan every 30 minutes (urgency-based timer decides which tickets to process)
```

- [ ] **Step 3: Restart the worker service**

After deploying and running the SQL, restart the worker so it picks up the new cron schedule from the DB.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/cron/scheduler.ts
git commit -m "docs: update retriage schedule comment to reflect 30-minute scan"
```

---

## Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Retriage Triggers section**

Replace the current retriage triggers section with:

```markdown
### Retriage Triggers
1. **Customer reply webhook**: When Halo status changes to "Customer Reply", auto-retriage immediately
2. **Urgency-based scan (every 30 min)**: Checks each open ticket's timer based on urgency:
   - Urgency 4-5 (critical): retriage every 1 hour
   - Urgency 3 (medium): retriage every 2 hours
   - Urgency 1-2 (low): retriage every 3 hours
   - Clock resets only on **customer-facing activity** (visible replies), not internal notes
3. **SLA scan (every 3 hours)**: Flags SLA-breached tickets for immediate triage
4. **Manual**: From the web UI — single ticket or bulk retriage
```

- [ ] **Step 2: Update Teams Notifications section**

Add to the Teams Notifications section:

```markdown
- **New triage**: Only for urgency 3+ tickets (routine tickets don't alert)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with urgency-based retriage and Teams filter"
```

---

## Summary

| Task | What it does | Files |
|------|-------------|-------|
| 1 | Urgency-based timer (1h/2h/3h) + customer-facing clock | daily-scan.ts |
| 2 | AI-driven retriage prompt (Michael as manager) | daily-scan.ts |
| 3 | Tech reviewer new red flags (no docs, reopened, no comms) | tech-reviewer.ts |
| 4 | Teams notifications only for urgency 3+ | michael-scott.ts |
| 5 | Cron schedule to 30min (SQL + comment) | scheduler.ts + SQL |
| 6 | Update CLAUDE.md docs | CLAUDE.md |

**Total: 5 modified files, 6 commits + 1 SQL change**

**SQL to run after deploy:**
```sql
UPDATE cron_jobs SET schedule = '*/30 * * * *' WHERE endpoint = '/retriage';
```
