"use client";

import { cn } from "@/lib/utils/cn";

interface TicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly user_name: string | null;
  readonly original_priority: number | null;
  readonly status: string;
  readonly created_at: string;
  readonly triage_results: ReadonlyArray<{
    readonly urgency_score: number;
    readonly recommended_priority: number;
    readonly classification: {
      readonly type: string;
      readonly subtype: string;
    };
  }>;
}

interface TicketListProps {
  readonly tickets: ReadonlyArray<TicketRow>;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  triaging: "bg-blue-500/20 text-blue-400",
  triaged: "bg-green-500/20 text-green-400",
  approved: "bg-emerald-500/20 text-emerald-400",
  error: "bg-red-500/20 text-red-400",
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "Critical",
  2: "High",
  3: "Medium",
  4: "Low",
  5: "Minimal",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TicketList({ tickets }: TicketListProps) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
        <p className="text-[var(--muted-foreground)]">
          No tickets yet. Configure your Halo PSA integration to start receiving
          tickets.
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
              ID
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Summary
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Client
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Status
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Priority
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              AI Priority
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Type
            </th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => {
            const triage = ticket.triage_results[0];
            return (
              <tr
                key={ticket.id}
                className="border-b border-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-pointer"
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
                      STATUS_STYLES[ticket.status],
                    )}
                  >
                    {ticket.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {ticket.original_priority
                    ? PRIORITY_LABELS[ticket.original_priority] ??
                      `P${ticket.original_priority}`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  {triage ? (
                    <span className="font-medium">
                      {PRIORITY_LABELS[triage.recommended_priority] ??
                        `P${triage.recommended_priority}`}
                      <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                        ({triage.urgency_score}/5)
                      </span>
                    </span>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {triage?.classification?.type ?? "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                  {formatDate(ticket.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
