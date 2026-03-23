"use client";

import { cn } from "@/lib/utils/cn";

interface TicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly halo_status?: string | null;
  readonly halo_team?: string | null;
  readonly halo_agent?: string | null;
  readonly original_priority?: number | null;
  readonly last_retriage_at?: string | null;
  readonly last_customer_reply_at?: string | null;
  readonly last_tech_action_at?: string | null;
  readonly created_at: string;
  readonly triage_results: ReadonlyArray<{
    readonly urgency_score: number;
    readonly recommended_priority: number;
    readonly triage_type?: string;
    readonly classification: {
      readonly type: string;
      readonly subtype: string;
    };
    readonly urgency_reasoning?: string;
    readonly internal_notes?: string;
    readonly created_at?: string;
  }>;
}

interface OpenTicketListProps {
  readonly tickets: ReadonlyArray<TicketRow>;
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl?: string | null;
}

// ── Status styles — fuzzy match on common Halo status names ─────────

const STATUS_KEYWORDS: ReadonlyArray<{
  readonly match: string;
  readonly style: string;
}> = [
  { match: "new", style: "bg-red-500/20 text-red-400" },
  { match: "in progress", style: "bg-red-400/15 text-red-300" },
  { match: "scheduled", style: "bg-rose-500/15 text-rose-300" },
  { match: "waiting on customer", style: "bg-red-500/10 text-red-400/80" },
  { match: "customer reply", style: "bg-red-600/20 text-red-300" },
  { match: "waiting on tech", style: "bg-red-500/25 text-red-400" },
  { match: "waiting on parts", style: "bg-rose-400/15 text-rose-300" },
  { match: "pending vendor", style: "bg-red-400/10 text-red-400/70" },
  { match: "on hold", style: "bg-gray-500/20 text-gray-400" },
  { match: "needs quote", style: "bg-rose-500/15 text-rose-400" },
];

function getStatusStyle(status: string): string {
  const lower = status.toLowerCase();
  const found = STATUS_KEYWORDS.find((s) => lower.includes(s.match));
  return found?.style ?? "bg-gray-500/20 text-gray-400";
}

const PRIORITY_COLORS: Record<number, string> = {
  1: "text-red-400",
  2: "text-red-300",
  3: "text-rose-400",
  4: "text-rose-300",
  5: "text-gray-400",
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "High",
  2: "Multiple Users",
  3: "Single User",
  4: "Low",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / (1000 * 60));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface Flag {
  readonly label: string;
  readonly severity: "critical" | "warning" | "info";
}

function getFlags(ticket: TicketRow): ReadonlyArray<Flag> {
  const flags: Flag[] = [];
  const now = Date.now();
  const status = (ticket.halo_status ?? "").toLowerCase();

  // WOT > 24hrs — critical
  if (status.includes("waiting on tech")) {
    const lastAction = ticket.last_tech_action_at;
    if (lastAction) {
      const hours = (now - new Date(lastAction).getTime()) / (1000 * 60 * 60);
      if (hours > 24) flags.push({ label: "WOT > 24h", severity: "critical" });
    } else {
      flags.push({ label: "WOT no action", severity: "critical" });
    }
  }

  // Customer reply waiting > 24hrs — critical
  if (status.includes("customer reply")) {
    const lastReply = ticket.last_customer_reply_at;
    if (lastReply) {
      const hours = (now - new Date(lastReply).getTime()) / (1000 * 60 * 60);
      if (hours > 24) flags.push({ label: "Awaiting 24h+", severity: "critical" });
    }
  }

  // Unassigned — warning
  if (!ticket.halo_agent) flags.push({ label: "Unassigned", severity: "warning" });

  // Stale — 3+ days, no tech action ever
  const daysSinceCreated = (now - new Date(ticket.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreated > 3 && !ticket.last_tech_action_at) {
    flags.push({ label: "Stale", severity: "info" });
  }

  return flags;
}

const FLAG_STYLES: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400",
  warning: "bg-rose-500/20 text-rose-400",
  info: "bg-white/5 text-white/30",
};

export function OpenTicketList({ tickets, onSelectTicket, haloBaseUrl }: OpenTicketListProps) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
        <p className="text-[var(--muted-foreground)]">
          No open tickets. Click &quot;Sync from Halo&quot; to pull open tickets.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: card layout */}
      <div className="space-y-2 md:hidden">
        {tickets.map((ticket) => {
          const flags = getFlags(ticket);
          const hasCritical = flags.some((f) => f.severity === "critical");
          const statusStyle = getStatusStyle(ticket.halo_status ?? "");

          const techTime = ticket.last_tech_action_at ? new Date(ticket.last_tech_action_at).getTime() : 0;
          const clientTime = ticket.last_customer_reply_at ? new Date(ticket.last_customer_reply_at).getTime() : 0;
          const latestTime = Math.max(techTime, clientTime);
          const activityLabel = latestTime > 0 ? timeAgo(new Date(latestTime).toISOString()) : "—";

          return (
            <div
              key={ticket.id}
              onClick={() => onSelectTicket(ticket.id)}
              className={cn(
                "rounded-lg border p-3 cursor-pointer transition-colors",
                hasCritical
                  ? "border-red-500/20 bg-red-500/[0.04] hover:bg-red-500/[0.08]"
                  : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)]",
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  {haloBaseUrl ? (
                    <a
                      href={`${haloBaseUrl}/tickets?id=${ticket.halo_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs text-[#dc2626] hover:text-[#f87171]"
                    >
                      #{ticket.halo_id}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-[#dc2626]">#{ticket.halo_id}</span>
                  )}
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", statusStyle)}>
                    {ticket.halo_status ?? "Unknown"}
                  </span>
                </div>
                <span className="text-xs text-[var(--muted-foreground)]">{activityLabel}</span>
              </div>

              <p className="text-sm text-white mb-2 line-clamp-2">{ticket.summary}</p>

              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted-foreground)]">{ticket.client_name ?? "—"}</span>
                <span className={cn("text-xs", ticket.halo_agent ? "text-[var(--muted-foreground)]" : "")}>
                  {ticket.halo_agent ? (
                    ticket.halo_agent
                  ) : (
                    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium", FLAG_STYLES.warning)}>
                      Unassigned
                    </span>
                  )}
                </span>
              </div>

              {flags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {flags.map((flag) => (
                    <span
                      key={flag.label}
                      className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium", FLAG_STYLES[flag.severity])}
                    >
                      {flag.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: table layout */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--card)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">#</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">Summary</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">Client</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">Status</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">Pri</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">Activity</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">Triaged</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)]">Assigned To</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => {
              const flags = getFlags(ticket);
              const hasCritical = flags.some((f) => f.severity === "critical");
              const statusStyle = getStatusStyle(ticket.halo_status ?? "");

              const techTime = ticket.last_tech_action_at
                ? new Date(ticket.last_tech_action_at).getTime()
                : 0;
              const clientTime = ticket.last_customer_reply_at
                ? new Date(ticket.last_customer_reply_at).getTime()
                : 0;
              const latestTime = Math.max(techTime, clientTime);
              const activityLabel = latestTime > 0
                ? timeAgo(new Date(latestTime).toISOString())
                : "—";

              return (
                <tr
                  key={ticket.id}
                  onClick={() => onSelectTicket(ticket.id)}
                  className={cn(
                    "border-b border-[var(--border)] transition-colors cursor-pointer",
                    hasCritical
                      ? "hover:bg-red-500/5 bg-red-500/[0.02]"
                      : "hover:bg-[var(--accent)]",
                  )}
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {haloBaseUrl ? (
                      <a
                        href={`${haloBaseUrl}/tickets?id=${ticket.halo_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[#dc2626] hover:text-[#f87171] transition-colors"
                        title="Open in Halo"
                      >
                        {ticket.halo_id}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-[#dc2626]">{ticket.halo_id}</span>
                    )}
                  </td>
                  <td className="max-w-sm truncate px-3 py-2">
                    {ticket.summary}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    {ticket.client_name ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", statusStyle)}>
                      {ticket.halo_status ?? "Unknown"}
                    </span>
                  </td>
                  <td className={cn("px-3 py-2 text-xs font-medium", PRIORITY_COLORS[ticket.original_priority ?? 0] ?? "text-[var(--muted-foreground)]")}>
                    {ticket.original_priority ? (PRIORITY_LABELS[ticket.original_priority] ?? `P${ticket.original_priority}`) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    {activityLabel}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {(() => {
                      const retriageAt = ticket.last_retriage_at;
                      const triageAt = ticket.triage_results[0]?.created_at;
                      if (retriageAt) {
                        return (
                          <span className="inline-flex items-center gap-1 text-rose-400" title={`Retriaged: ${new Date(retriageAt).toLocaleString()}`}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                            {timeAgo(retriageAt)}
                          </span>
                        );
                      }
                      if (triageAt) {
                        return (
                          <span className="text-red-400/70" title={`Triaged: ${new Date(triageAt).toLocaleString()}`}>
                            {timeAgo(triageAt)}
                          </span>
                        );
                      }
                      return <span className="text-white/20">—</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {ticket.halo_agent ? (
                      <span className="text-[var(--muted-foreground)]">{ticket.halo_agent}</span>
                    ) : (
                      <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium", FLAG_STYLES.warning)}>
                        Unassigned
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
