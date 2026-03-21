# TriageIt — Development Context

## What This Is
TriageIt is an AI-powered ticket triage system for **Gamma Tech Services LLC**, an MSP in Naples, FL. It reads tickets from Halo PSA, runs them through a multi-agent AI pipeline (The Office-themed), and posts triage notes back to Halo with classification, urgency, root cause analysis, and tech recommendations.

## Architecture
- **apps/web**: Next.js dashboard (Supabase auth, ticket viewer, analytics, settings)
- **apps/worker**: Node.js service (BullMQ queue, agent pipeline, cron jobs, integrations)
- **packages/shared**: Shared types, constants, agent definitions
- **supabase/**: Migrations, DB schema
- **Hosting**: Railway (web + worker as separate services)
- **Queue**: Redis via BullMQ
- **DB**: Supabase (Postgres + pgvector for embeddings)

## Ticket Workflow

### Ingestion (two paths)
1. **Webhook (primary)**: Halo pushes ticket creates/updates to `/api/webhooks/halo`. New tickets get status "pending" and trigger triage immediately.
2. **Pull-tickets (backup)**: `/api/halo/pull-tickets` bulk-syncs all open tickets from Halo API. Catches tickets that missed the webhook. Skips tickets already in the system.

### Triage Pipeline
1. **Ryan Howard** classifies the ticket (type/subtype, urgency 1-5, security flag)
2. **Fast paths**: Notifications skip Sonnet entirely. Automated alerts use Erin Hannon (Haiku) for a cheap summary.
3. **Specialist agents** run in parallel based on classification type (integration-gated by customer mapping)
4. **Michael Scott** synthesizes all findings using Sonnet (or Haiku for simple tickets via model-router)
5. **Halo note** posted as internal note with full triage breakdown
6. **Tech review** (coaching note) posted if eligible — evaluates assigned tech's response time and communication
7. **Teams notification** sent via webhook
8. **Embedding stored** for future similarity search
9. **Memory stored** for Michael's future recall

### Retriage Triggers
1. **Customer reply webhook**: When Halo status changes to "Customer Reply", auto-retriage immediately
2. **Hourly cron**: Check for customer replies with no tech response within 1 hour (business hours only)
3. **Every-3-hour cron**: Full scan of all open tickets — flags stale, unassigned, SLA-breached, no-documentation tickets
4. **Manual**: From the web UI — single ticket or bulk retriage

### Update Request Detection
When a customer asks "any update?", "status?", "following up", etc:
- Detect via regex patterns in the webhook handler
- Immediately retriage the ticket
- Post an internal Halo note with current status summary
- Send a DETAILED Teams alert: ticket #, customer name, assigned tech, what they're asking
- This is critical for customer satisfaction oversight

## Business Rules

### Response Time Thresholds
- **1 hour**: Universal threshold for tech to respond after customer reply (all priorities)
- **Business hours only**: 7:00 AM - 6:00 PM Eastern, Monday - Friday
- **Alerts excluded**: Automated alert tickets are skipped from response-time checks
- **Waiting on Customer**: Excluded from response checks (tech already replied)
- **Waiting on Vendor / On Hold**: NOT excluded, but use 48-hour threshold for customer-visible update (tech must keep customer informed even while waiting on vendor)

### Escalation
- Teams alert only — no auto-reassign or priority changes in Halo
- One webhook channel for now (both critical alerts and daily summaries)

### Teams Notifications
- **Real-time**: Individual cards per critical ticket (customer waiting, SLA breach, update requests)
- **Daily**: Combined summary card with all flagged tickets grouped by severity
- Update request alerts should be visually distinct and include: ticket #, customer name, client company, assigned tech name, what the customer is asking for

### People
- **Bryanna**: Only dispatcher — hardcoded is fine
- **Techs**: Identified by Halo's assigned agent field (agent_name / agent_id)

### Status Handling
- Halo status map is INCOMPLETE — should pull from Halo API (fetchStatusNameMap) rather than relying on hardcoded HALO_STATUS_MAP
- Closed/resolved tickets: Don't triage unless re-opened by customer reply
- Pull-tickets catches missed tickets and fixes "triaged" status bugs

### Model Routing
- Haiku/Sonnet split is working well — don't change
- Haiku: Simple tickets (urgency 1-2, high confidence, few specialists)
- Sonnet: Complex tickets (urgency 3+, security flags, low confidence, 4+ specialists)

### Dead Code
- **Pam Beesly** (`pam-beesly.ts`): Customer response generation is dead code. Only `missing_info` (doc gaps) is used. The `customer_response` field is never posted. Can be removed.

### Tech Reviews
- Working well, actively used by the team
- Posted as internal Halo notes visible to all techs
- Stored in tech_reviews table for the Review tab in the web dashboard

## Agent Roster

### Manager
- **Michael Scott**: Orchestrator — runs the full pipeline, synthesizes findings

### Classifier
- **Ryan Howard**: Ticket classification (type, subtype, urgency, security flag)

### Specialists (integration-gated)
- **Dwight Schrute**: Hudu documentation & assets (always runs)
- **Angela Martin**: Security assessment (no integration, always available)
- **Jim Halpert**: JumpCloud identity/access
- **Andy Bernard**: Datto RMM endpoints
- **Kelly Kapoor**: 3CX/Twilio telephony
- **Stanley Hudson**: Vultr cloud infrastructure
- **Phyllis Vance**: Email/DNS (MX Toolbox + DMARC)
- **Meredith Palmer**: Spanning M365 backup
- **Oscar Martinez**: Cove backup
- **Darryl Philbin**: CIPP M365 management
- **Creed Bratton**: UniFi networking

### Analytics
- **Toby Flenderson**: Learning & analytics agent — runs daily at 2 AM ET. Analyzes all tickets to build tech behavioral profiles, detect customer patterns, identify cross-ticket trends, and self-evaluate triage accuracy. Feeds insights back into Michael's skills and shared memory so the whole pipeline gets smarter over time.

### Support Roles
- **Erin Hannon**: Alert summarizer (fast path for automated alerts)
- **Pam Beesly**: Dead code — customer response drafting (remove)

## Integration Mapping
Agents only run when their integration is active AND has a customer mapping for the ticket's client. Dwight (Hudu) and Angela (security) always run.

### Customer Mapping
- Mappings are **auto-matched by name** between Halo client and each integration's customer list.
- No manual mapping required — system matches on company name.

### Live Integrations (as of March 2026)
- **Hudu** (Dwight) — LIVE
- **Datto RMM** (Andy) — LIVE
- **JumpCloud** (Jim) — LIVE
- All others are stubbed/planned but not live yet.

## Halo PSA Details

### Ticket Types
- **Gamma Default**: The main ticket type for real customer tickets. Triage these fully.
- **Alerts**: Automated monitoring alerts. Fast-path only (Erin Hannon / Haiku).
- **Auto-reclassification**: If Ryan classifies a "Gamma Default" ticket as an alert, the system should **change the ticket type in Halo to Alerts** (write-back to Halo API). This keeps Halo clean and ensures alerts don't clutter the default queue.
- Other ticket types are not currently used.

### 3-Hour Scan Scope
- Only scan open **Gamma Default** tickets. Skip Alerts entirely.
- No age cutoff — scan all open Gamma Default tickets regardless of creation date.

## Client & Environment Context

### Gamma Tech Identity
- **Company**: Gamma Tech Services LLC
- **Location**: Naples, FL
- **Domains**: gtmail.us, gamma.tech
- **Helpdesk email**: help@gamma.tech
- When tickets come from gtmail.us or gamma.tech — that's the MSP itself (internal), not a client.

### Client Profile
- **Typical size**: Mixed SMB — ranges from small offices (5-10 users) to medium companies (50-100 users)
- **Email platform**: M365 dominant — nearly all clients use Microsoft 365
- **VIP clients**: No VIP distinction currently — all clients treated equally

### Tech Team
- **Size**: 4-8 technicians
- **Structure**: No formal L1/L2/L3 tiers — everyone handles everything
- **Dispatcher**: Bryanna (sole dispatcher, hardcoded)
- **Identification**: Techs identified by Halo's assigned agent field (agent_name / agent_id)

## Triage Output Preferences

### Format
- Keep the current structured format (table/sections) but **cut the filler** — less verbose, same structure.
- Techs won't read walls of text. Every sentence should carry useful information.
- Don't pad with obvious statements like "This ticket appears to be about a computer issue."

### Missing Info to Improve
- **Hudu context**: Pull relevant client docs, network diagrams, known issues, passwords context, and previous procedures for that client. Techs currently have to go look this up manually.
- **Datto device info**: If the ticket mentions a specific device, pull its status, recent alerts, patch status, and last-seen from Datto RMM. Techs shouldn't have to open a second console to check device health.

### Retriage Notes
- **Adaptive**: Small update (customer reply with minor info) = compact diff note. Big change (new symptoms, escalation, priority shift) = full retriage note.
- Don't repeat the entire original triage when a customer just says "thanks, that worked."

### Update Requests
- **Internal alert only** — do NOT draft customer responses. The tech decides what to say.
- Teams alert should fire immediately upon detection (within the webhook handler, not batched).

## Toby Flenderson — Learning Agent Details

### What Toby Produces
1. **Tech profiles** (`tech_profiles` table): Per-tech scorecards with avg response time, ticket volume, rating breakdown, strong/weak categories, behavioral patterns summary
2. **Customer insights** (`customer_insights` table): Per-client patterns — recurring issues, top issue types, update request frequency, environment notes
3. **Trend detections** (`trend_detections` table): Cross-ticket patterns — spikes, recurring issues, anomalies, correlations, improvements/degradations
4. **Triage evaluations** (`triage_evaluations` table): Self-assessment — compares AI predictions vs actual outcomes for resolved tickets

### Where Insights Go
- **Database**: All four tables above, displayed in the web dashboard
- **Michael's memory**: Key findings stored as shared memories for all agents
- **Michael's skills**: Updated context skills ("Toby's Tech Profiles" and "Toby's Customer Profiles") injected into every future triage
- **Teams**: Daily summary card with key findings
- **Run log**: `toby_run_log` table tracks every analysis run

### Schedule
- Daily at 2 AM ET via cron job
- Manual trigger: `POST /toby/analyze`
- Analyzes last 30 days of ticket data

## Known Issues

### Cron Jobs Not Running on Railway
The node-cron scheduler in the worker may not be firing reliably on Railway. Cron jobs appear to work locally but not in production. Tickets only get triaged when manually triggered, not automatically.
- **Workaround**: May need to use Railway's native cron service or an external scheduler instead of in-process node-cron.
- **Affected**: Daily retriage scan (every 3 hours), SLA breach scan, Toby's daily analysis (2 AM)
- **Investigate**: Check Railway logs for cron scheduling messages. Consider adding a heartbeat/health endpoint that confirms cron is running.

## Planned Features
- **Thumbs up/down feedback**: Add to the web dashboard so admins can rate triage quality. This will feed into future model fine-tuning and prompt improvement.
- **Triage quality tracking**: Store feedback in a table linked to triage_results for analysis.
- **Fix Railway cron**: Move to Railway's cron service or external scheduler for reliable periodic jobs.
