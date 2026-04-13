# TriageIT Upgrade Plan — April 2026

## Overview
9 major upgrades across 4 phases. Each phase is deployable independently and builds on the previous one.

---

## Phase 1: Foundation Fixes (1 session)
**Goal:** Fix the plumbing so everything else builds on solid ground.

### 1.1 Wire Up Integration Cache
- Import `integration-cache.ts` into all integration clients
- Cache agent names (24h), Hudu asset layouts (6h), integration configs (1h), client mappings (4h)
- Eliminate the N+1 in ticket-sync (200 API calls → 8)
- **Files:** `integration-cache.ts`, `ticket-sync.ts`, `halo/client.ts`, `hudu/client.ts`, all specialist agents

### 1.2 Fix N+1 Queries
- Batch `resolveAgentName` — pre-fetch all agents once, cache the map
- Toby: replace per-tech/per-client count queries with grouped aggregation
- Daily scan: use stored `last_customer_reply_at`/`last_tech_action_at` instead of fetching actions per ticket
- Share integration config across agents via single pre-fetch
- **Files:** `ticket-sync.ts`, `toby-flenderson.ts`, `daily-scan.ts`, specialist base agent

### 1.3 Staff Names in DB
- Create `staff_members` table with name, role, email
- Replace all hardcoded `STAFF_NAMES` and `TECH_NAMES` arrays
- Read from DB in webhook, daily-scan, triage workload, Toby, Teams bot
- **Files:** New migration, `update-request.ts`, `daily-scan.ts`, `michael-scott.ts`, `bot.ts`

### 1.4 Bulletproof Cron Jobs
- Move catch-up inside BullMQ (delayed jobs, not direct calls)
- Add memory eviction as daily cron (`/memory/evict`)
- Add Teams alert for tickets in `error` status > 1 hour
- Add `/health/failed-jobs` endpoint
- Cap startup pending-ticket processing with backpressure check
- **Files:** `scheduler.ts`, `server.ts`, new cron job entry

**Deploy checkpoint:** All fixes are backward-compatible. Deploy and verify cron health, API call reduction, and no regressions.

---

## Phase 2: Smarter AI (1-2 sessions)
**Goal:** Make the triage pipeline use all available data instead of operating with blind spots.

### 2.1 Cross-Reference Agents on All Tickets
- Add "quick check" mode to Holly (license count), Creed (network status), Phyllis (MX health)
- Run these on ALL Gamma Default tickets, not just their gated classification types
- Quick check = one API call + one-line summary, no full agent analysis
- Michael gets the full picture on every ticket
- **Files:** `holly-flax.ts`, `creed-bratton.ts`, `phyllis-vance.ts`, `michael-scott.ts` (agent selection logic)

### 2.2 Feed Resolution Outcomes Into Triage
- After close review, extract resolution method as structured field
- Store in `close_reviews.resolution_method` (new column)
- Aggregate top 5 resolution patterns per ticket type
- Inject into Michael's synthesis: "For email/delivery_failure, 85% resolved by checking MX records"
- **Files:** `close-reviewer.ts`, new migration, `michael-scott.ts` (synthesis context)

### 2.3 Triage Feedback Loop (Thumbs Up/Down)
- New `triage_feedback` table (ticket_id, rating, comment, user_id, created_at)
- Add feedback buttons to Halo embed triage view
- Add feedback column to dashboard ticket detail
- Toby reads feedback during daily analysis, calibrates prompt recommendations
- **Files:** New migration, embed `page.tsx`, `ticket-detail.tsx`, `toby-flenderson.ts`

**Deploy checkpoint:** Triage notes should be noticeably more actionable. Techs can start giving feedback. Monitor Toby's accuracy metrics.

---

## Phase 3: Proactive Intelligence (1-2 sessions)
**Goal:** TriageIT doesn't wait to be asked — it alerts, reports, and escalates automatically.

### 3.1 Proactive Teams DMs — "Your Tech Is Dropping the Ball"
- After customer reply webhook, schedule a 60-min check
- If no tech action: DM the tech via Teams bot
- If still no action at 120 min: DM David (helpdesk manager)
- Configurable thresholds in adminland
- **Files:** New `proactive-alerts.ts`, `bot.ts` (DM sending), `scheduler.ts`, adminland config

### 3.2 Weekly Team Report Card
- New cron: Monday 8 AM ET
- Toby generates comprehensive report using existing tools
- Per-tech scorecard with trend arrows (vs last week)
- Client highlights, system health, MVPs and concerns
- Posts as Teams adaptive card to configured channel
- **Files:** New `weekly-report.ts`, `toby-flenderson.ts` (report generation), `teams/client.ts`

### 3.3 Error-Status Recovery
- Cron every 30 min: find tickets in `error` status
- Auto-retry triage (max 2 retries)
- After 2 failures: Teams alert to admin with error details
- Dashboard badge showing errored tickets
- **Files:** `scheduler.ts`, new handler, `tickets/page.tsx` (badge)

**Deploy checkpoint:** Teams should start getting proactive alerts. Monday report confirms the whole pipeline is generating useful insights.

---

## Phase 4: Dashboard & Visibility (1-2 sessions)
**Goal:** All the data TriageIT generates is actually visible and actionable from the UI.

### 4.1 Toby Analytics Dashboard
- New `/analytics/toby` page (or replace current analytics)
- Read from `tech_profiles`, `customer_insights`, `trend_detections`, `triage_evaluations`
- Tech scorecards with trend arrows
- Client risk indicators
- Triage accuracy chart (predictions vs outcomes over time)
- Trend alerts feed
- **Files:** New page, new API routes reading Toby's tables

### 4.2 KB Ideas Browser
- New page or tab showing all KB ideas generated across tickets
- Status: pending / accepted / dismissed
- Click to view full article, copy to clipboard, or open in Hudu
- Filter by client, category, confidence
- **Files:** New `/kb-ideas` page, new API route, `kb_ideas` table (may need migration)

### 4.3 Dispatcher Review Tab
- Surface Bryanna's routing reviews in a dashboard tab
- Show: was the assignment correct? Should it have gone to a different tech?
- Helps identify routing patterns that need improvement
- **Files:** New tab in tickets page, `dispatcher-reviewer.ts` output surfaced

### 4.4 Agent Invoke UI
- Let techs run specialist agents on demand from the dashboard
- "Ask Dwight about this client" / "Ask Andy about this device"
- Uses existing `/agent/invoke` endpoint — just needs UI
- **Files:** New component in `ticket-detail.tsx`, wire to existing endpoint

**Deploy checkpoint:** Full visibility into everything TriageIT produces. No more hidden data.

---

## Timeline Estimate

| Phase | Sessions | Priority |
|-------|----------|----------|
| Phase 1: Foundation | 1 | Must do first |
| Phase 2: Smarter AI | 1-2 | Highest value |
| Phase 3: Proactive | 1-2 | Game changer |
| Phase 4: Dashboard | 1-2 | Polish & visibility |

**Total: 4-7 sessions**

## Rules
- Each phase gets deployed and verified before starting the next
- No phase depends on future phases
- Quick wins within each phase get done first
- All changes go to both main + production branches
- Run tsc locally before pushing
