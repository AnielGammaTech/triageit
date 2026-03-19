"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TicketList } from "@/components/tickets/ticket-list";
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

export default function TicketsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedTicketId = searchParams.get("id");
  const [tickets, setTickets] = useState<ReadonlyArray<TicketRow>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>([]);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<"new" | "open">("new");

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("tickets")
      .select("*, triage_results(*)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (dbError) {
      setError(dbError.message);
    } else {
      setTickets((data ?? []) as TicketRow[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  async function handleDelete() {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} ticket(s)? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const response = await fetch("/api/triage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_ids: selectedIds }),
      });
      if (response.ok) {
        setSelectedIds([]);
        await loadTickets();
      }
    } finally {
      setDeleting(false);
    }
  }

  function handleToggleSelect(ticketId: string) {
    setSelectedIds((prev) =>
      prev.includes(ticketId)
        ? prev.filter((id) => id !== ticketId)
        : [...prev, ticketId],
    );
  }

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

  // Split tickets into new (triaged recently) and open (all with halo_status or older)
  const newTickets = tickets.filter((t) => t.status === "triaged" || t.status === "pending");
  const openTickets = tickets.filter((t) => t.halo_status && t.halo_status !== "New");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Tickets</h2>
        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setActiveTab("new")}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "new"
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
              )}
            >
              New Tickets
              <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                {newTickets.length}
              </span>
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
          </div>
          {activeTab === "new" && selectedIds.length > 0 && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : `Delete ${selectedIds.length} selected`}
            </button>
          )}
          {activeTab === "new" && (
            <button
              onClick={() =>
                setSelectedIds((prev) =>
                  prev.length === newTickets.length
                    ? []
                    : newTickets.map((t) => t.id),
                )
              }
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
            >
              {selectedIds.length === newTickets.length ? "Deselect All" : "Select All"}
            </button>
          )}
          <button
            onClick={loadTickets}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            Refresh
          </button>
          <p className="text-sm text-[var(--muted-foreground)]">
            {error
              ? "Unable to load tickets"
              : activeTab === "new"
                ? `${newTickets.length} tickets`
                : `${openTickets.length} open`}
          </p>
        </div>
      </div>

      {activeTab === "new" ? (
        <TicketList
          tickets={newTickets}
          selectedIds={selectedIds}
          onSelectTicket={(id) => router.push(`/tickets?id=${id}`)}
          onToggleSelect={handleToggleSelect}
        />
      ) : (
        <OpenTicketList tickets={openTickets} />
      )}
    </div>
  );
}
