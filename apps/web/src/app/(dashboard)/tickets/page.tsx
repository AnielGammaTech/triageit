"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TicketDetail } from "@/components/tickets/ticket-detail";
import { OpenTicketList } from "@/components/tickets/open-ticket-list";
import { cn } from "@/lib/utils/cn";
import type { TicketStatus } from "@triageit/shared";

interface TicketRow {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly user_name: string | null;
  readonly original_priority: number | null;
  readonly status: TicketStatus;
  readonly created_at: string;
  readonly halo_status?: string | null;
  readonly halo_team?: string | null;
  readonly halo_agent?: string | null;
  readonly last_retriage_at?: string | null;
  readonly last_customer_reply_at?: string | null;
  readonly last_tech_action_at?: string | null;
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

const RESOLVED_STATUSES = [
  "closed", "resolved", "cancelled", "completed",
  "resolved remotely", "resolved onsite", "resolved - awaiting confirmation",
];

export default function TicketsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedTicketId = searchParams.get("id");
  const [tickets, setTickets] = useState<ReadonlyArray<TicketRow>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"incoming" | "open" | "resolved">("open");
  const [pulling, setPulling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [haloBaseUrl, setHaloBaseUrl] = useState<string | null>(null);
  const hasPulled = useRef(false);

  const loadTickets = useCallback(async () => {
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("tickets")
      .select("*, triage_results(*)")
      .order("created_at", { ascending: false })
      .limit(500);

    if (dbError) {
      setError(dbError.message);
    } else {
      setTickets((data ?? []) as TicketRow[]);
      setError(null);
    }
    setLoading(false);

    // Load Halo base URL for ticket links
    if (!haloBaseUrl) {
      const { data: haloConfig } = await supabase
        .from("integrations")
        .select("config")
        .eq("service", "halo")
        .single();

      if (haloConfig?.config) {
        const cfg = haloConfig.config as { base_url?: string };
        if (cfg.base_url) {
          setHaloBaseUrl(cfg.base_url.replace(/\/$/, ""));
        }
      }
    }
  }, [haloBaseUrl]);

  // Pull open tickets from Halo
  const pullFromHalo = useCallback(async () => {
    setPulling(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/halo/pull-tickets", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatusMessage({ type: "error", text: body.error ?? `Pull failed: ${res.status}` });
      } else {
        const result = await res.json();
        const errInfo = result.errors?.length ? ` (${result.errors.length} errors)` : "";
        const closedInfo = result.closed ? `, ${result.closed} closed` : "";
        setStatusMessage({
          type: result.errors?.length ? "error" : "success",
          text: `Synced ${result.pulled} tickets from Halo — ${result.created} new, ${result.updated} updated${closedInfo}${errInfo}`,
        });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: `Failed to pull tickets: ${(err as Error).message}` });
    }
    setPulling(false);
    await loadTickets();
  }, [loadTickets]);

  // On mount: load DB tickets, then auto-pull from Halo once
  useEffect(() => {
    loadTickets().then(() => {
      if (!hasPulled.current) {
        hasPulled.current = true;
        pullFromHalo();
      }
    });
  }, [loadTickets, pullFromHalo]);

  const isResolved = (t: TicketRow) =>
    t.halo_status && RESOLVED_STATUSES.includes(t.halo_status.toLowerCase());

  // Incoming: tickets that just arrived and haven't been triaged yet
  const incomingTickets = tickets.filter(
    (t) => t.status === "pending" || t.status === "triaging",
  );

  // Open: ALL non-resolved tickets that have been synced from Halo (have halo data)
  const openTickets = tickets.filter((t) => {
    if (isResolved(t)) return false;
    if (t.status === "pending" || t.status === "triaging") return false;
    return true;
  });

  // Resolved: tickets whose Halo status is resolved/closed/cancelled
  const resolvedTickets = tickets.filter((t) => isResolved(t));

  const handleSelectTicket = (id: string) => router.push(`/tickets?id=${id}`);

  if (selectedTicketId) {
    return (
      <div className="mx-auto max-w-4xl">
        <TicketDetail
          ticketId={selectedTicketId}
          onBack={() => router.push("/tickets")}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Tickets</h2>
        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setActiveTab("incoming")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "incoming"
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
              )}
            >
              Incoming
              {incomingTickets.length > 0 && (
                <span className="ml-2 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400 animate-pulse">
                  {incomingTickets.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("open")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--border)]",
                activeTab === "open"
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
              )}
            >
              Open Tickets
              <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
                {openTickets.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("resolved")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--border)]",
                activeTab === "resolved"
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
              )}
            >
              Resolved
              <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
                {resolvedTickets.length}
              </span>
            </button>
          </div>

          {/* Sync button */}
          <button
            onClick={pullFromHalo}
            disabled={pulling}
            className="rounded-lg border border-[#6366f1]/30 bg-[#6366f1]/10 px-3 py-1.5 text-xs font-medium text-[#6366f1] transition-colors hover:bg-[#6366f1]/20 disabled:opacity-50"
          >
            {pulling ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 animate-spin rounded-full border border-[#6366f1]/30 border-t-[#6366f1]" />
                Syncing...
              </span>
            ) : (
              "Sync from Halo"
            )}
          </button>

          <button
            onClick={loadTickets}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            Refresh
          </button>
          <p className="text-sm text-[var(--muted-foreground)]">
            {error
              ? "Unable to load tickets"
              : activeTab === "incoming"
                ? incomingTickets.length > 0
                  ? `${incomingTickets.length} awaiting triage`
                  : "All caught up"
                : activeTab === "resolved"
                  ? `${resolvedTickets.length} resolved`
                  : `${openTickets.length} open`}
          </p>
        </div>
      </div>

      {statusMessage && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm flex items-center justify-between",
            statusMessage.type === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-green-500/30 bg-green-500/10 text-green-400",
          )}
        >
          <span>{statusMessage.text}</span>
          <button onClick={() => setStatusMessage(null)} className="ml-4 text-xs opacity-60 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {activeTab === "incoming" ? (
        incomingTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">
              No incoming tickets. New tickets from Halo webhooks will appear here automatically.
            </p>
          </div>
        ) : (
          <IncomingTicketList tickets={incomingTickets} onSelectTicket={handleSelectTicket} />
        )
      ) : activeTab === "resolved" ? (
        resolvedTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">
              No resolved tickets found.
            </p>
          </div>
        ) : (
          <OpenTicketList tickets={resolvedTickets} onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
        )
      ) : (
        <OpenTicketList tickets={openTickets} onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
      )}
    </div>
  );
}

// ── Incoming tickets list (simple, clickable) ─────────────────────────

function IncomingTicketList({
  tickets,
  onSelectTicket,
}: {
  readonly tickets: ReadonlyArray<TicketRow>;
  readonly onSelectTicket: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--card)]">
          <tr className="border-b border-[var(--border)]">
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Ticket #</th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Summary</th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Client</th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Reported By</th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Status</th>
            <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Received</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr
              key={ticket.id}
              onClick={() => onSelectTicket(ticket.id)}
              className="border-b border-[var(--border)] transition-colors cursor-pointer hover:bg-[var(--accent)]"
            >
              <td className="px-4 py-3 font-mono text-xs text-blue-400">#{ticket.halo_id}</td>
              <td className="max-w-md truncate px-4 py-3">{ticket.summary}</td>
              <td className="px-4 py-3 text-[var(--muted-foreground)]">{ticket.client_name ?? "—"}</td>
              <td className="px-4 py-3 text-[var(--muted-foreground)]">{ticket.user_name ?? "—"}</td>
              <td className="px-4 py-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                  ticket.status === "pending"
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-blue-500/20 text-blue-400",
                )}>
                  {ticket.status === "triaging" && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                  )}
                  {ticket.status}
                </span>
              </td>
              <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                {timeAgo(ticket.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
