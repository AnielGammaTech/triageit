"use client";

import { cn } from "@/lib/utils/cn";

interface TicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly halo_status: string | null;
  readonly halo_team: string | null;
  readonly halo_agent: string | null;
  readonly original_priority: number | null;
  readonly last_retriage_at: string | null;
  readonly last_customer_reply_at: string | null;
  readonly last_tech_action_at: string | null;
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
}

const HALO_STATUS_STYLES: Record<string, string> = {
  New: "bg-blue-500/20 text-blue-400",
  "In Progress": "bg-green-500/20 text-green-400",
  Scheduled: "bg-purple-500/20 text-purple-400",
  "Waiting on Customer": "bg-yellow-500/20 text-yellow-400",
  "Customer Reply": "bg-orange-500/20 text-orange-400",
  "Waiting on Tech": "bg-red-500/20 text-red-400",
  "Waiting on Parts": "bg-cyan-500/20 text-cyan-400",
  "Needs Quote": "bg-pink-500/20 text-pink-400",
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
  5: "Minimal",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "< 1hr ago";
  if (hours < 24) return `${hours}hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getFlags(ticket: TicketRow): string[] {
  const flags: string[] = [];
  const now = Date.now();

  // WOT > 1 day
  if (ticket.halo_status === "Waiting on Tech" && ticket.last_tech_action_at) {
    const hours = (now - new Date(ticket.last_tech_action_at).getTime()) / (1000 * 60 * 60);
    if (hours > 24) flags.push("WOT > 24hrs");
  }

  // Customer Reply > 1 day
  if (ticket.halo_status === "Customer Reply" && ticket.last_customer_reply_at) {
    const hours =
      (now - new Date(ticket.last_customer_reply_at).getTime()) / (1000 * 60 * 60);
    if (hours > 24) flags.push("Customer waiting 24hrs+");
  }

  // Unassigned
  if (!ticket.halo_agent) flags.push("Unassigned");

  // Stale — created 3+ days ago with no recent activity
  const daysSinceCreated = (now - new Date(ticket.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreated > 3 && !ticket.last_tech_action_at) flags.push("Stale");

  return flags;
}

export function OpenTicketList({ tickets }: OpenTicketListProps) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
        <p className="text-[var(--muted-foreground)]">
          No open tickets found. Run a daily re-triage scan to populate this view,
          or configure the cron scheduler.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--card)]">
          <tr className="border-b border-[var(--border)]">
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Ticket #
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Summary
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Client
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Halo Status
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Team
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Priority
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Last Activity
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Flags
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Re-Triage
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => {
            const flags = getFlags(ticket);
            const statusStyle =
              HALO_STATUS_STYLES[ticket.halo_status ?? ""] ??
              "bg-gray-500/20 text-gray-400";

            return (
              <tr
                key={ticket.id}
                className={cn(
                  "border-b border-[var(--border)] transition-colors cursor-pointer",
                  flags.length > 0 && flags.some((f) => f.includes("24hrs"))
                    ? "hover:bg-red-500/5 bg-red-500/[0.02]"
                    : "hover:bg-[var(--accent)]",
                )}
              >
                <td className="px-4 py-3 font-mono text-xs">
                  #{ticket.halo_id}
                </td>
                <td className="max-w-xs truncate px-4 py-3">
                  {ticket.summary}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {ticket.client_name ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                      statusStyle,
                    )}
                  >
                    {ticket.halo_status ?? "Unknown"}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)] text-xs">
                  {ticket.halo_team ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {ticket.original_priority
                    ? PRIORITY_LABELS[ticket.original_priority] ??
                      `P${ticket.original_priority}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                  <div>
                    {ticket.last_tech_action_at && (
                      <div>Tech: {timeAgo(ticket.last_tech_action_at)}</div>
                    )}
                    {ticket.last_customer_reply_at && (
                      <div>Client: {timeAgo(ticket.last_customer_reply_at)}</div>
                    )}
                    {!ticket.last_tech_action_at && !ticket.last_customer_reply_at && (
                      <span>—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {flags.map((flag) => (
                      <span
                        key={flag}
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          flag.includes("24hrs") || flag.includes("waiting")
                            ? "bg-red-500/20 text-red-400"
                            : flag === "Unassigned"
                              ? "bg-yellow-500/20 text-yellow-400"
                              : "bg-gray-500/20 text-gray-400",
                        )}
                      >
                        {flag}
                      </span>
                    ))}
                    {flags.length === 0 && (
                      <span className="text-xs text-green-400">OK</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                  {ticket.last_retriage_at
                    ? timeAgo(ticket.last_retriage_at)
                    : "Never"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
