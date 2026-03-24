"use client";

import { useState } from "react";
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
  readonly selectedIds?: ReadonlyArray<string>;
  readonly onSelectTicket: (ticketId: string) => void;
  readonly onToggleSelect?: (ticketId: string) => void;
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

const PRIORITY_COLORS: Record<number, string> = {
  1: "text-red-400 font-bold",
  2: "text-orange-400 font-semibold",
  3: "text-yellow-400 font-medium",
  4: "text-green-400 font-medium",
  5: "text-gray-400 font-normal",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const PAGE_SIZE = 25;

export function TicketList({
  tickets,
  selectedIds = [],
  onSelectTicket,
  onToggleSelect,
}: TicketListProps) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  const filtered = tickets.filter((t) => {
    const q = search.toLowerCase();
    if (q && !t.summary.toLowerCase().includes(q) && !String(t.halo_id).includes(q) && !(t.client_name ?? "").toLowerCase().includes(q)) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages - 1, 0));
  const pagedTickets = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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
    <>
      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search resolved tickets..."
          className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-[#b91c1c]/50 focus:outline-none focus:ring-1 focus:ring-[#b91c1c]/30"
        />
        {search && (
          <button
            onClick={() => { setSearch(""); setPage(0); }}
            className="rounded-lg px-2 py-1.5 text-xs text-white/30 hover:text-white/60 hover:bg-white/5"
          >
            Clear
          </button>
        )}
        <span className="text-xs text-white/25 ml-auto">{filtered.length} ticket{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Mobile: card layout */}
      <div className="space-y-2 md:hidden">
        {pagedTickets.map((ticket) => {
          const triage = ticket.triage_results[0];
          const isSelected = selectedIds.includes(ticket.id);
          return (
            <div
              key={ticket.id}
              onClick={() => onSelectTicket(ticket.id)}
              className={cn(
                "rounded-lg border border-[var(--border)] p-3 cursor-pointer transition-colors",
                isSelected
                  ? "bg-indigo-500/10 border-indigo-500/30"
                  : "bg-[var(--card)] hover:bg-[var(--accent)]",
              )}
            >
              {onToggleSelect && (
                <div className="float-right ml-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleSelect(ticket.id);
                    }}
                    className="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/50"
                  />
                </div>
              )}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-xs font-medium text-[#b91c1c]">#{ticket.halo_id}</span>
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                    STATUS_STYLES[ticket.status],
                  )}
                >
                  {ticket.status}
                </span>
              </div>
              <p className="text-sm text-white mb-2 line-clamp-2">{ticket.summary}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted-foreground)]">{ticket.client_name ?? "—"}</span>
                {triage ? (
                  <span className={PRIORITY_COLORS[triage.recommended_priority] ?? "font-medium"}>
                    {PRIORITY_LABELS[triage.recommended_priority] ?? `P${triage.recommended_priority}`}
                    <span className="ml-1 opacity-50">(U:{triage.urgency_score}/5)</span>
                  </span>
                ) : (
                  <span className="text-[var(--muted-foreground)]">
                    {ticket.original_priority
                      ? PRIORITY_LABELS[ticket.original_priority] ?? `P${ticket.original_priority}`
                      : "—"}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)] mt-1">
                <span>{triage?.classification?.type ?? "—"}</span>
                <span>{formatDate(ticket.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: table layout */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--card)]">
            <tr className="border-b border-[var(--border)]">
              {onToggleSelect && (
                <th className="w-10 px-3 py-3">
                  <span className="sr-only">Select</span>
                </th>
              )}
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
            {pagedTickets.map((ticket) => {
              const triage = ticket.triage_results[0];
              const isSelected = selectedIds.includes(ticket.id);
              return (
                <tr
                  key={ticket.id}
                  className={cn(
                    "border-b border-[var(--border)] transition-colors cursor-pointer",
                    isSelected
                      ? "bg-indigo-500/10 hover:bg-indigo-500/15"
                      : "hover:bg-[var(--accent)]",
                  )}
                >
                  {onToggleSelect && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          onToggleSelect(ticket.id);
                        }}
                        className="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500/50"
                      />
                    </td>
                  )}
                  <td
                    className="px-4 py-3 font-mono text-xs font-medium text-[#b91c1c]"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    #{ticket.halo_id}
                  </td>
                  <td
                    className="max-w-xl truncate px-4 py-3"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    {ticket.summary}
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--muted-foreground)]"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    {ticket.client_name ?? "—"}
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_STYLES[ticket.status],
                      )}
                    >
                      {ticket.status}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--muted-foreground)]"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    {ticket.original_priority
                      ? PRIORITY_LABELS[ticket.original_priority] ??
                        `P${ticket.original_priority}`
                      : "—"}
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    {triage ? (
                      <span className={PRIORITY_COLORS[triage.recommended_priority] ?? "font-medium"}>
                        {PRIORITY_LABELS[triage.recommended_priority] ??
                          `P${triage.recommended_priority}`}
                        <span className="ml-1 text-xs opacity-50">
                          (U:{triage.urgency_score}/5)
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--muted-foreground)]"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    {triage?.classification?.type ?? "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-xs text-[var(--muted-foreground)]"
                    onClick={() => onSelectTicket(ticket.id)}
                  >
                    {formatDate(ticket.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pt-3">
          <span className="text-xs text-white/30 tabular-nums">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={safePage === 0} className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20">First</button>
            <button onClick={() => setPage(safePage - 1)} disabled={safePage === 0} className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20">Prev</button>
            <span className="px-2 text-xs text-white/50 tabular-nums">{safePage + 1} / {totalPages}</span>
            <button onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages - 1} className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20">Next</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={safePage >= totalPages - 1} className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20">Last</button>
          </div>
        </div>
      )}
    </>
  );
}
