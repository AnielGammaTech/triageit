"use client";

import { useState } from "react";
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
  readonly tech_reviews?: ReadonlyArray<{ readonly id: string }>;
  readonly close_reviews?: ReadonlyArray<{ readonly id: string }>;
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
  { match: "new", style: "bg-blue-500/20 text-blue-400" },
  { match: "in progress", style: "bg-emerald-500/20 text-emerald-400" },
  { match: "scheduled", style: "bg-purple-500/20 text-purple-400" },
  { match: "waiting on customer", style: "bg-yellow-500/20 text-yellow-400" },
  { match: "customer reply", style: "bg-orange-500/20 text-orange-400" },
  { match: "waiting on tech", style: "bg-red-500/20 text-red-400" },
  { match: "waiting on parts", style: "bg-cyan-500/20 text-cyan-400" },
  { match: "pending vendor", style: "bg-indigo-500/20 text-indigo-400" },
  { match: "on hold", style: "bg-gray-500/20 text-gray-400" },
  { match: "needs quote", style: "bg-pink-500/20 text-pink-400" },
];

function getStatusStyle(status: string): string {
  const lower = status.toLowerCase();
  const found = STATUS_KEYWORDS.find((s) => lower.includes(s.match));
  return found?.style ?? "bg-gray-500/20 text-gray-400";
}

const PRIORITY_COLORS: Record<number, string> = {
  1: "text-red-400",
  2: "text-orange-400",
  3: "text-yellow-400",
  4: "text-green-400",
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
  warning: "bg-yellow-500/20 text-yellow-400",
  info: "bg-white/5 text-white/30",
};

const PAGE_SIZE = 25;

function TicketTags({ ticket }: { readonly ticket: TicketRow }) {
  const tags: Array<{ label: string; style: string }> = [];

  if (ticket.last_retriage_at) {
    tags.push({ label: "Re-triaged", style: "bg-violet-500/20 text-violet-400" });
  }
  if (ticket.tech_reviews && ticket.tech_reviews.length > 0) {
    tags.push({ label: "Reviewed", style: "bg-sky-500/20 text-sky-400" });
  }
  if (ticket.close_reviews && ticket.close_reviews.length > 0) {
    tags.push({ label: "Closed", style: "bg-emerald-500/20 text-emerald-400" });
  }

  if (tags.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {tags.map((t) => (
        <span key={t.label} className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", t.style)}>
          {t.label}
        </span>
      ))}
    </span>
  );
}

export function OpenTicketList({ tickets, onSelectTicket, haloBaseUrl }: OpenTicketListProps) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [techFilter, setTechFilter] = useState("");

  // Derive unique values for filters
  const statuses = [...new Set(tickets.map((t) => t.halo_status ?? "Unknown").filter(Boolean))].sort();
  const techs = [...new Set(tickets.map((t) => t.halo_agent).filter((a): a is string => !!a))].sort();

  // Filter tickets
  const filtered = tickets.filter((t) => {
    const q = search.toLowerCase();
    if (q && !t.summary.toLowerCase().includes(q) && !String(t.halo_id).includes(q) && !(t.client_name ?? "").toLowerCase().includes(q)) return false;
    if (statusFilter && (t.halo_status ?? "Unknown") !== statusFilter) return false;
    if (techFilter && t.halo_agent !== techFilter) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(totalPages - 1, 0));
  const pagedTickets = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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
      {/* Search & Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search tickets..."
          className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white placeholder:text-white/25 focus:border-[#b91c1c]/50 focus:outline-none focus:ring-1 focus:ring-[#b91c1c]/30"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-white/70 focus:outline-none"
        >
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={techFilter}
          onChange={(e) => { setTechFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-white/70 focus:outline-none"
        >
          <option value="">All Techs</option>
          {techs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {(search || statusFilter || techFilter) && (
          <button
            onClick={() => { setSearch(""); setStatusFilter(""); setTechFilter(""); setPage(0); }}
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
                      className="font-mono text-xs text-[#b91c1c] hover:text-[#818cf8]"
                    >
                      #{ticket.halo_id}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-[#b91c1c]">#{ticket.halo_id}</span>
                  )}
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", statusStyle)}>
                    {ticket.halo_status ?? "Unknown"}
                  </span>
                  <TicketTags ticket={ticket} />
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
            {pagedTickets.map((ticket) => {
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
                        className="inline-flex items-center gap-1 text-[#b91c1c] hover:text-[#818cf8] transition-colors"
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
                      <span className="text-[#b91c1c]">{ticket.halo_id}</span>
                    )}
                  </td>
                  <td className="max-w-sm px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{ticket.summary}</span>
                      <TicketTags ticket={ticket} />
                    </div>
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
                          <span className="inline-flex items-center gap-1 text-violet-400" title={`Retriaged: ${new Date(retriageAt).toLocaleString()}`}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                            {timeAgo(retriageAt)}
                          </span>
                        );
                      }
                      if (triageAt) {
                        return (
                          <span className="text-emerald-400/70" title={`Triaged: ${new Date(triageAt).toLocaleString()}`}>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pt-3">
          <span className="text-xs text-white/30 tabular-nums">
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent"
            >
              First
            </button>
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent"
            >
              Prev
            </button>
            <span className="px-2 text-xs text-white/50 tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="rounded px-2 py-1 text-xs text-white/40 hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </>
  );
}
