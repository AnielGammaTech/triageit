export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Settings</h2>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
        <p className="text-[var(--muted-foreground)]">
          Application settings and triage rules configuration coming in Phase 4.
        </p>
      </div>

      {/* Dev Notes — Implementation Plan */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6">
        <h3 className="text-lg font-semibold text-amber-400">
          Dev Notes — Open Ticket Re-Triage Plan
        </h3>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Two triage modes: <strong className="text-[var(--foreground)]">New Ticket Triage</strong> (current — runs on webhook)
          and <strong className="text-[var(--foreground)]">Open Ticket Re-Triage</strong> (new — daily scheduled job).
          Mode = <strong className="text-[var(--foreground)]">recommend only</strong> for now (no auto-changes). Daily summary via <strong className="text-[var(--foreground)]">Teams</strong>.
        </p>

        <div className="mt-5 space-y-5">
          {/* Confirmed statuses */}
          <div className="rounded-md border border-green-500/20 bg-green-500/5 p-4">
            <h4 className="text-sm font-semibold text-green-400">Confirmed — Halo Statuses</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {["New", "Scheduled", "In Progress", "Waiting on Customer", "Customer Reply", "Waiting on Tech", "Waiting on Parts", "Needs Quote"].map((s) => (
                <span key={s} className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-300 border border-green-500/20">
                  {s}
                </span>
              ))}
              <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 border border-red-500/20">
                Resolved = closed
              </span>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-[var(--muted-foreground)]">
              <li>• <strong className="text-amber-300">WOT (Waiting on Tech)</strong> — should not exceed 1 day. Re-triage flags these as priority.</li>
              <li>• <strong className="text-amber-300">RFI / Waiting on Customer</strong> — we requested info from client. Track if they replied.</li>
              <li>• <strong className="text-amber-300">Customer Reply</strong> — client responded but no tech action yet. <strong className="text-red-400">If &gt; 1 day, send immediate Teams alert.</strong> We must ensure proper, timely communication with the customer.</li>
            </ul>
          </div>

          {/* SLA info */}
          <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-4">
            <h4 className="text-sm font-semibold text-blue-400">Confirmed — SLA (Gamma Tech SLA)</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>• <strong className="text-[var(--foreground)]">Affects Multiple Users</strong> — Response: 1hr, Resolution: 4hrs (from ticket screenshot)</li>
              <li>• <strong className="text-[var(--foreground)]">High - Severe Productivity Impact</strong> — needs SLA times</li>
              <li>• <strong className="text-[var(--foreground)]">Affects Single User</strong> — needs SLA times</li>
              <li>• <strong className="text-[var(--foreground)]">Low - Minor Issue or Request</strong> — needs SLA times</li>
            </ul>
            <p className="mt-2 text-xs text-amber-300">TODO: Get exact response/resolution targets for each SLA tier from Halo API or Aniel.</p>
          </div>

          {/* How it works */}
          <div>
            <h4 className="text-sm font-semibold text-amber-300">How daily re-triage works</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>1. Daily cron (e.g. 6 AM) pulls all tickets from Halo where status != Resolved</li>
              <li>2. For each ticket, pull full action history (notes, replies, status changes) via <code className="text-amber-200">getTicketActions()</code></li>
              <li>3. Quick Haiku scan per ticket: &quot;what changed? is it stale? SLA risk?&quot;</li>
              <li>4. Flag tickets: <strong className="text-red-400">WOT &gt; 1 day</strong>, <strong className="text-red-400">Customer Reply &gt; 1 day (immediate Teams alert)</strong>, <strong className="text-red-400">SLA breached/at risk</strong>, <strong className="text-yellow-400">unassigned</strong></li>
              <li>5. Post summary to Teams channel with ticket links and recommended actions</li>
              <li>6. <strong className="text-red-400">Real-time alert:</strong> Customer Reply sitting &gt; 1 day triggers an immediate Teams message — not just in the daily summary. Goal: ensure the customer always gets a timely, understandable response.</li>
              <li>6. Write re-triage note to Halo ticket as internal note (optional)</li>
            </ul>
          </div>

          {/* Connectors */}
          <div>
            <h4 className="text-sm font-semibold text-amber-300">Connector plan</h4>
            <ul className="mt-2 space-y-2 text-sm text-[var(--muted-foreground)]">
              <li>
                <strong className="text-green-400">Teams</strong> <span className="text-xs text-green-400/60">(ADDED to integrations)</span>
                <br/>Daily summary delivery. Aniel will set up an Incoming Webhook in Teams and paste the URL.
              </li>
              <li>
                <strong className="text-green-400">CIPP</strong> <span className="text-xs text-green-400/60">(ADDED to integrations)</span>
                <br/>Replaces direct Graph API. Use for: user lookup, mailbox status, MFA check, license info, device compliance. Needs Azure AD App Registration with CIPP API permissions.
              </li>
              <li>
                <strong className="text-blue-400">Datto RMM</strong> <span className="text-xs text-blue-400/60">(already configured)</span>
                <br/>For re-triage: look up devices mentioned in ticket, match to user, check alert status, verify if hardware issue resolved. Link computer/user to ticket context.
              </li>
              <li>
                <strong className="text-blue-400">Halo PSA</strong> <span className="text-xs text-blue-400/60">(already configured)</span>
                <br/>Full access confirmed. Pull open tickets, SLA data, actions, statuses, assigned agents, time tracking.
              </li>
              <li>
                <strong className="text-blue-400">Hudu</strong> <span className="text-xs text-blue-400/60">(already configured)</span>
                <br/>Cross-reference KB articles and client docs for known solutions during re-triage.
              </li>
            </ul>
          </div>

          {/* Halo setup guide */}
          <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-4">
            <h4 className="text-sm font-semibold text-purple-400">Halo setup — what I need access to</h4>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">You said you have full access. Here&apos;s what I need from the Halo API for re-triage:</p>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>1. <strong className="text-[var(--foreground)]">GET /api/tickets</strong> — filter by status (not Resolved), include SLA info. Need <code className="text-purple-200">?status_id_not=RESOLVED_ID&amp;includeslainfo=true</code></li>
              <li>2. <strong className="text-[var(--foreground)]">GET /api/actions</strong> — already using this. Need full action history per ticket</li>
              <li>3. <strong className="text-[var(--foreground)]">GET /api/sla</strong> — to pull SLA policy definitions and thresholds programmatically</li>
              <li>4. <strong className="text-[var(--foreground)]">Halo Status IDs</strong> — I need the numeric IDs for each status (New, In Progress, WOT, etc.) to filter API calls</li>
            </ul>
            <p className="mt-3 text-xs text-amber-300">
              ACTION: Go to Halo &rarr; Configuration &rarr; Tickets &rarr; Status and note the ID numbers.
              Or I can pull them via <code className="text-purple-200">GET /api/status</code> if the API key has access.
            </p>
          </div>

          {/* Teams setup guide */}
          <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-4">
            <h4 className="text-sm font-semibold text-purple-400">Teams setup — how to create the webhook</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>1. Open Microsoft Teams &rarr; pick the channel for triage alerts</li>
              <li>2. Click <strong className="text-[var(--foreground)]">&quot;...&quot; &rarr; Connectors &rarr; Incoming Webhook</strong> (or Workflows &rarr; &quot;Post to a channel when a webhook request is received&quot;)</li>
              <li>3. Name it <strong className="text-[var(--foreground)]">&quot;TriageIt&quot;</strong>, optionally upload a logo</li>
              <li>4. Copy the webhook URL and paste it in <strong className="text-[var(--foreground)]">Integrations &rarr; Microsoft Teams &rarr; Incoming Webhook URL</strong></li>
            </ul>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Note: Microsoft is migrating from O365 Connectors to Workflows (Power Automate). If &quot;Incoming Webhook&quot; connector isn&apos;t available,
              use Workflows instead — create a flow triggered by &quot;When a Teams webhook request is received&quot; and use that URL.
            </p>
          </div>

          {/* CIPP setup guide */}
          <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-4">
            <h4 className="text-sm font-semibold text-purple-400">CIPP setup — API access</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>1. In your CIPP instance, go to <strong className="text-[var(--foreground)]">Settings &rarr; CIPP &rarr; API Access</strong></li>
              <li>2. Create or note the Azure AD App Registration (Client ID, Tenant ID)</li>
              <li>3. Generate a Client Secret for TriageIt</li>
              <li>4. Paste all three values + your CIPP URL in <strong className="text-[var(--foreground)]">Integrations &rarr; CIPP</strong></li>
            </ul>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              CIPP gives us: user details, mailbox status, MFA enrollment, license assignments, device compliance, and tenant health — all without needing direct Graph API access.
            </p>
          </div>

          {/* Cost estimate */}
          <div>
            <h4 className="text-sm font-semibold text-amber-300">Token cost estimate</h4>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Daily re-triage uses Haiku for the quick scan (~500 tokens/ticket).
              Only escalates to Sonnet for tickets needing deep analysis.
              For 50 open tickets/day: ~$0.02-0.05/day on Haiku.
              Notifications still use fast path (Haiku only, ~200 tokens).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
