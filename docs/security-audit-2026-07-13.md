# TriageIT Security and Reliability Audit - 2026-07-13

## Scope

This audit covered the Next.js web app, Fastify/BullMQ worker, Supabase schema and RLS policies, public webhook/embed/TV entry points, Railway runtime configuration, dependency advisories, scheduled jobs, and customer-contact safeguards.

## Phase 1 - Attack Surface and Live Data Access

### Critical findings

1. `cron_heartbeat`, `sla_call_requests`, `staff_members`, and `workflow_events` had RLS disabled. The public Supabase anon key could read live rows from all four tables.
2. Policies named `Service role can manage` on `tickets`, `triage_results`, and `agent_logs` also granted every authenticated account full write and delete access.
3. Any authenticated account could modify cron configuration and learned skills.
4. Anonymous callers could insert forged `login_events`.
5. Raw ticket embeddings were readable by every authenticated account.

### Resolution

- Enabled RLS on every public table and verified the Supabase security advisor reports no errors.
- Replaced broad write policies with explicit `service_role` policies.
- Limited cron, learned-skill, staff, and worker-run management to admins or the service role.
- Removed anonymous login-event writes and authenticated embedding reads.
- Confirmed the anon key now returns zero rows for the four previously exposed tables while the worker service role retains access.

## Phase 2 - Application and Edge Security

### Findings and resolution

- Adminland, Workers, Settings, configuration, sync, bulk triage, diagnostics, cron, and debug operations were reachable by any signed-in account. They now require the `admin` role at both page and route boundaries.
- Sidebar and floating admin navigation now reflect the signed-in user's actual role.
- The obsolete one-time database migration endpoint was removed.
- Secret comparisons for Halo webhooks, embeds, and TV access now use timing-safe comparison.
- The TV wallboard no longer stores or transmits the permanent key in URLs, local storage, or request headers. Admins create a 15-minute link that exchanges for a 30-day HttpOnly, Secure, SameSite=Strict cookie.
- Public webhook/embed/TV JSON bodies now have streamed byte limits, including chunked requests.
- Halo webhook attempts are rate-limited and fail closed if credentials are missing.
- Normal pages deny framing; the Halo embed permits only the configured Halo origin. Security, referrer, content-type, HSTS, permissions, cache, and indexing headers are applied by route type.
- Unauthenticated API calls now return JSON `401` responses instead of login redirects.
- The in-memory rate limiter now preserves each bucket's own window. Previously, cleanup could reset long-window limits early.
- Production dependencies report zero known npm vulnerabilities and no tracked credentials or private keys were found.

## Phase 3 - Worker Execution and Reliability

- Added `worker_runs` execution history for scheduled, catch-up, and manual jobs with source, status, duration, queue ID, instance, and error.
- Added local and renewable Redis endpoint leases so the same task cannot overlap across queue backlog, deploy catch-up, manual runs, or multiple worker replicas.
- Added stale-run reconciliation and 30-day retention maintenance.
- Adminland Cron Jobs now shows worker heartbeat, queue depth, running count, 24-hour failures, and the latest 25 runs; it refreshes every 15 seconds.
- Cron configuration now validates UUIDs, supported endpoints, lengths, booleans, and five-field schedules before changing the database.
- The worker production container runs as a non-root user and excludes development dependencies.

## Customer Contact Controls

- Automated Teams messages and SLA calls use a final delivery gate of Monday-Friday, 8:00 AM-5:15 PM Eastern. Weekend and after-hours cases are covered by tests.
- Customer emails require a technician-approved draft and a second signed-in Dispatch approval.
- Dispatch approval is rejected outside business hours and uses an atomic claim plus Halo reconciliation to prevent duplicate sends.
- Drafts must contain the exact promised date/time, correct call-or-reply method, and a question asking whether the time works.
- Negative customer schedule replies return to the Dispatch queue for follow-up.

## Residual Risks and Next Review

1. Web rate limits are process-local. This is correct for the current single web replica; move them to Redis before scaling the web service horizontally.
2. The Halo embed uses a shared token because Halo loads a fixed iframe URL. Keep `Referrer-Policy: no-referrer`, restrict `HALO_EMBED_ORIGIN`, and rotate the token when Halo supports a coordinated URL update.
3. Worker-run history retains operational errors for 30 days. Export longer-term history before that point if compliance reporting requires it.
4. Repeat this database policy and dependency audit quarterly and after any new integration or public route is added.
5. Older Supabase migrations predate the linked migration ledger and are not all recorded remotely. Continue applying new migrations explicitly; reconcile each historical migration against the live schema before using a broad `supabase db push`.
