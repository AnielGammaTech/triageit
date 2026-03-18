export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Settings</h2>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
        <p className="text-[var(--muted-foreground)]">
          Application settings and triage rules configuration coming in Phase 4.
        </p>
      </div>

      {/* Dev Notes */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6">
        <h3 className="text-lg font-semibold text-amber-400">
          Dev Notes — Open Ticket Re-Triage
        </h3>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Planning for two triage modes: <strong className="text-[var(--foreground)]">New Ticket Triage</strong> (current — runs on webhook)
          and <strong className="text-[var(--foreground)]">Open Ticket Re-Triage</strong> (new — daily scheduled job).
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-amber-300">How it would work</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>• Daily cron job (e.g. 6 AM) pulls all open/in-progress tickets from Halo via the existing API</li>
              <li>• For each open ticket, pull the full action history (notes, replies, status changes) using <code className="text-amber-200">getTicketActions()</code></li>
              <li>• Run a &quot;re-triage&quot; pass: compare current state vs. original triage — has the issue changed? Is it stale? Escalation needed?</li>
              <li>• Flag tickets that have been open too long with no updates (SLA risk)</li>
              <li>• Flag tickets where the client replied but no tech has responded</li>
              <li>• Write a daily summary note to Halo or post to a Slack/Teams channel</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-amber-300">What I can do with current connectors</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>• <strong className="text-[var(--foreground)]">Halo PSA</strong> — already connected. Can pull open tickets, actions, status, SLA data, assigned tech. This is the core of re-triage.</li>
              <li>• <strong className="text-[var(--foreground)]">Hudu</strong> — can cross-reference client docs, KB articles, known issues. Useful for &quot;has this been solved before?&quot;</li>
              <li>• <strong className="text-[var(--foreground)]">Datto RMM</strong> — can check if a device alert has cleared since the ticket was opened</li>
              <li>• <strong className="text-[var(--foreground)]">MX Toolbox</strong> — can re-check DNS/email issues to see if they resolved</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-amber-300">Connectors that would help (not yet built)</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>• <strong className="text-[var(--foreground)]">Slack / Teams webhook</strong> — post daily re-triage summary to a channel (e.g. &quot;5 stale tickets, 3 need escalation, 2 SLA at risk&quot;)</li>
              <li>• <strong className="text-[var(--foreground)]">Halo PSA Reports API</strong> — pull SLA breach data and time-tracking to know which tickets are burning hours</li>
              <li>• <strong className="text-[var(--foreground)]">Microsoft 365 / Graph API</strong> — check user mailbox for bounced replies, calendar for scheduled follow-ups, SharePoint for shared docs referenced in tickets</li>
              <li>• <strong className="text-[var(--foreground)]">ConnectWise / Automate</strong> — if any clients use CW alongside Halo, could pull script run history and remediation status</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-amber-300">What I need from you</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              <li>1. <strong className="text-[var(--foreground)]">Which Halo statuses count as &quot;open&quot;?</strong> — e.g. New, In Progress, Waiting on Client, Waiting on Vendor?</li>
              <li>2. <strong className="text-[var(--foreground)]">SLA thresholds</strong> — what&apos;s your SLA per priority? (e.g. P1 = 1hr response / 4hr resolution)</li>
              <li>3. <strong className="text-[var(--foreground)]">Where should the daily summary go?</strong> — Slack channel? Teams? Email? Halo dashboard?</li>
              <li>4. <strong className="text-[var(--foreground)]">Should re-triage update ticket priority automatically?</strong> — or just flag/recommend?</li>
              <li>5. <strong className="text-[var(--foreground)]">Which of the suggested connectors would be useful?</strong> — Slack/Teams is the highest-value add for daily summaries</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-amber-300">Token cost estimate</h4>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Re-triage would use Haiku for most tickets (cheap scan: &quot;has anything changed?&quot;).
              Only escalate to Sonnet for tickets that need deeper analysis.
              Estimated ~500 tokens/ticket for the daily check, vs. 1500-4000 for initial triage.
              For 50 open tickets/day that&apos;s roughly $0.02-0.05/day on Haiku.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
