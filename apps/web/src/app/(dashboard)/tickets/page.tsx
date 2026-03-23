"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TicketDetail } from "@/components/tickets/ticket-detail";
import { OpenTicketList } from "@/components/tickets/open-ticket-list";
import { ReviewList } from "@/components/tickets/review-list";
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
  const filterParam = searchParams.get("filter"); // "stale" | "unassigned" | null
  const initialTab = (searchParams.get("tab") as "incoming" | "open" | "needs_review" | "alerts" | "retriaged" | "resolved" | "stale") ?? "open";
  const [activeTab, setActiveTab] = useState<"incoming" | "open" | "needs_review" | "alerts" | "retriaged" | "resolved" | "stale">(
    filterParam === "stale" ? "stale" : initialTab,
  );
  const techFilter = searchParams.get("tech");
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [haloBaseUrl, setHaloBaseUrl] = useState<string | null>(null);
  const [haloIdInput, setHaloIdInput] = useState("");
  const [triagingHaloId, setTriagingHaloId] = useState(false);
  const [triagingAll, setTriagingAll] = useState(false);
  const hasPulled = useRef(false);

  const loadTickets = useCallback(async () => {
    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from("tickets")
      .select("*, triage_results(*)")
      .order("created_at", { ascending: false })
      .limit(2000);

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
        const breakdown = result.open_count && result.closed_synced
          ? ` (${result.open_count} open + ${result.closed_synced} recently resolved)`
          : "";
        const pendingInfo = result.pending_retriaged ? `, ${result.pending_retriaged} pending re-queued` : "";
        setStatusMessage({
          type: result.errors?.length ? "error" : "success",
          text: `Synced ${result.pulled} tickets from Halo — ${result.created} new, ${result.updated} updated${closedInfo}${pendingInfo}${breakdown}${errInfo}`,
        });
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: `Failed to pull tickets: ${(err as Error).message}` });
    }
    setPulling(false);
    await loadTickets();
  }, [loadTickets]);

  // Triage a ticket by Halo ID (pulls from Halo if not local)
  const triageByHaloId = useCallback(async () => {
    const haloId = parseInt(haloIdInput.replace("#", "").trim(), 10);
    if (isNaN(haloId) || haloId <= 0) {
      setStatusMessage({ type: "error", text: "Enter a valid Halo ticket number" });
      return;
    }

    setTriagingHaloId(true);
    setStatusMessage(null);

    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId }),
      });

      const result = await res.json();

      if (res.ok) {
        setStatusMessage({
          type: "success",
          text: `Triage triggered for Halo #${haloId}. It will appear in tickets shortly.`,
        });
        setHaloIdInput("");
        // Reload tickets after a short delay to show the new ticket
        setTimeout(() => loadTickets(), 2000);
      } else {
        setStatusMessage({
          type: "error",
          text: result.error ?? `Failed to triage #${haloId}`,
        });
      }
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: `Failed to triage: ${(err as Error).message}`,
      });
    } finally {
      setTriagingHaloId(false);
    }
  }, [haloIdInput, loadTickets]);

  // Triage ALL open tickets (full pipeline with tech performance reviews)
  const triageAll = useCallback(async () => {
    setTriagingAll(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/triage/all", { method: "POST" });
      const result = await res.json();
      if (res.ok) {
        setStatusMessage({
          type: "success",
          text: `${result.message} (${result.skipped} skipped — recently triaged)`,
        });
        setTimeout(() => loadTickets(), 3000);
      } else {
        setStatusMessage({
          type: "error",
          text: result.error ?? "Failed to trigger triage all",
        });
      }
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: `Failed: ${(err as Error).message}`,
      });
    }
    setTriagingAll(false);
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

  const isAlert = (t: TicketRow): boolean => {
    // Check triage notes for "Alert:" or notification fast-path
    const latestTriage = t.triage_results[0];
    if (latestTriage?.internal_notes?.startsWith("Alert:")) return true;
    if (latestTriage?.internal_notes === "Notification/transactional ticket — no action required.") return true;

    // Check classification type/subtype
    const classType = latestTriage?.classification?.type?.toLowerCase() ?? "";
    const subtype = latestTriage?.classification?.subtype?.toLowerCase() ?? "";
    if (["alert", "notification", "monitoring", "automated_alert"].includes(subtype)) return true;
    if (classType === "notification" || classType === "alert") return true;

    // Check summary patterns for common alert/notification sources
    const summary = t.summary.toLowerCase();
    const alertKeywords = [
      // Backup & monitoring systems
      "spanning backup", "backup for office 365",
      "datto alert", "datto rmm",
      "monitoring alert", "system alert",
      "backup fail", "backup error", "backup warning",
      "device offline", "agent offline",
      "threshold exceeded", "certificate expir",
      "client-alert", "backupiq:", "backupiq ",
      // Security/phishing alerts
      "report domain:", "phish911", "phishalarm",
      "risk detection", "o365 p2", "o365 p1",
      "microsoft 365 alert",
      // Phone system
      "3cx",
      // Notification/transactional (clearly automated only)
      "alert:", "completion notice", "order confirmation",
      "auto-replenishment", "low balance warning",
      "nso request",
    ];
    return alertKeywords.some((kw) => summary.includes(kw));
  };

  // Apply tech filter from query params (e.g. from Analytics page)
  const baseFiltered = techFilter
    ? tickets.filter((t) => t.halo_agent === techFilter)
    : tickets;

  // Apply unassigned filter
  const filteredTickets = filterParam === "unassigned"
    ? baseFiltered.filter((t) => !t.halo_agent)
    : baseFiltered;

  // Incoming: tickets that just arrived and haven't been triaged yet
  const incomingTickets = filteredTickets.filter(
    (t) => t.status === "pending" || t.status === "triaging",
  );

  // Alerts: automated alert tickets (non-resolved)
  const alertTickets = filteredTickets.filter((t) => {
    if (isResolved(t)) return false;
    if (t.status === "pending" || t.status === "triaging") return false;
    return isAlert(t);
  });

  // Open: non-resolved, non-alert, non-needs_review tickets
  const openTickets = filteredTickets.filter((t) => {
    if (isResolved(t)) return false;
    if (t.status === "pending" || t.status === "triaging" || t.status === "needs_review") return false;
    return !isAlert(t);
  });

  // Needs Review: re-triaged tickets flagged for manager attention
  const needsReviewTickets = filteredTickets.filter(
    (t) => t.status === "needs_review" && !isResolved(t),
  );

  // Stale: open tickets with no tech activity for 3+ days
  const staleTickets = filteredTickets.filter((t) => {
    if (isResolved(t)) return false;
    if (t.status === "pending" || t.status === "triaging") return false;
    const lastAction = t.last_tech_action_at ?? t.created_at;
    const hoursSince = (Date.now() - new Date(lastAction).getTime()) / (1000 * 60 * 60);
    return hoursSince > 72;
  });

  // Re-triaged: tickets that have been retriaged (sorted by retriage time)
  const retriagedTickets = [...filteredTickets]
    .filter((t) => !!t.last_retriage_at)
    .sort((a, b) => new Date(b.last_retriage_at!).getTime() - new Date(a.last_retriage_at!).getTime());

  // Resolved: tickets whose Halo status is resolved/closed/cancelled
  const resolvedTickets = filteredTickets.filter((t) => isResolved(t));

  // Total non-resolved (should match Halo's open count)
  const totalNonResolved = filteredTickets.filter((t) => !isResolved(t)).length;

  const handleSelectTicket = (id: string) => router.push(`/tickets?id=${id}`);

  if (selectedTicketId) {
    return (
      <div className="mx-auto max-w-4xl">
        <TicketDetail
          ticketId={selectedTicketId}
          onBack={() => router.push("/tickets")}
          haloBaseUrl={haloBaseUrl}
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
      {/* Tech filter banner */}
      {techFilter && (
        <div className="flex items-center justify-between rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-4 py-2">
          <span className="text-sm text-indigo-300">
            Filtering by technician: <strong>{techFilter}</strong>
          </span>
          <button
            onClick={() => router.push("/tickets")}
            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
          >
            Clear filter
          </button>
        </div>
      )}
      {/* Unassigned filter banner */}
      {filterParam === "unassigned" && (
        <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <span className="text-sm text-amber-300">
            Showing <strong>unassigned</strong> tickets only
          </span>
          <button
            onClick={() => router.push("/tickets?tab=open")}
            className="text-xs text-amber-400 hover:text-amber-300 underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Header row: title + actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Tickets</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Triage by Halo # */}
          <div className="flex items-center rounded-lg border border-white/[0.06] bg-white/[0.02]">
            <input
              type="text"
              placeholder="Halo #"
              value={haloIdInput}
              onChange={(e) => setHaloIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  triageByHaloId();
                }
              }}
              className="w-[72px] bg-transparent px-3 py-1.5 text-xs text-white placeholder:text-white/25 focus:outline-none"
            />
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); triageByHaloId(); }}
              disabled={triagingHaloId || !haloIdInput.trim()}
              className="border-l border-white/[0.06] px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/10 disabled:text-white/20 disabled:hover:bg-transparent"
            >
              {triagingHaloId ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 animate-spin rounded-full border border-amber-400/30 border-t-amber-400" />
                  Triaging
                </span>
              ) : (
                "Triage"
              )}
            </button>
          </div>

          <div className="hidden sm:block h-5 w-px bg-white/[0.06]" />

          {/* Sync button */}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); pullFromHalo(); }}
            disabled={pulling}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-400 transition-colors hover:bg-indigo-500/10 disabled:text-white/30"
          >
            {pulling ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border border-indigo-400/30 border-t-indigo-400" />
                <span className="hidden sm:inline">Syncing</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.681.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-.908l.84.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44.908l-.84-.84v1.56a.75.75 0 0 1-1.5 0V9.446a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.681.75.75 0 0 1 1.025-.274Z" clipRule="evenodd" />
                </svg>
                Sync
              </>
            )}
          </button>

          {/* Triage All */}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); triageAll(); }}
            disabled={triagingAll}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:text-white/30"
            title="Run full AI triage on all open tickets (includes tech performance reviews)"
          >
            {triagingAll ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border border-emerald-400/30 border-t-emerald-400" />
                <span className="hidden sm:inline">Triaging All</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M8 1a.75.75 0 0 1 .75.75V6h4.5a.75.75 0 0 1 0 1.5h-4.5v4.25a.75.75 0 0 1-1.5 0V7.5h-4.5a.75.75 0 0 1 0-1.5h4.5V1.75A.75.75 0 0 1 8 1Z" />
                  <path fillRule="evenodd" d="M2.5 13a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 0 1.5h-9.5A.75.75 0 0 1 2.5 13Z" clipRule="evenodd" />
                </svg>
                <span className="hidden sm:inline">Triage All</span>
              </>
            )}
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setRefreshing(true); loadTickets().finally(() => setRefreshing(false)); }}
            disabled={refreshing}
            className="rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60 disabled:text-white/15"
            title="Refresh tickets"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}>
              <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1Z" clipRule="evenodd" />
              <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
        <TabButton
          active={activeTab === "incoming"}
          onClick={() => setActiveTab("incoming")}
          label="Incoming"
          count={incomingTickets.length}
          badgeClass="bg-red-500/20 text-red-400"
          pulse={true}
          hideZero={true}
        />
        <TabButton
          active={activeTab === "open"}
          onClick={() => setActiveTab("open")}
          label="Open"
          count={openTickets.length}
          badgeClass="bg-amber-500/20 text-amber-400"
          pulse={false}
          hideZero={false}
        />
        <TabButton
          active={activeTab === "needs_review"}
          onClick={() => setActiveTab("needs_review")}
          label="Review"
          count={needsReviewTickets.length}
          badgeClass="bg-rose-500/20 text-rose-400"
          pulse={true}
          hideZero={true}
        />
        <TabButton
          active={activeTab === "alerts"}
          onClick={() => setActiveTab("alerts")}
          label="Alerts"
          count={alertTickets.length}
          badgeClass="bg-orange-500/20 text-orange-400"
          pulse={false}
          hideZero={true}
        />
        <TabButton
          active={activeTab === "stale"}
          onClick={() => setActiveTab("stale")}
          label="Stale"
          count={staleTickets.length}
          badgeClass="bg-orange-500/20 text-orange-400"
          pulse={false}
          hideZero={true}
        />
        <TabButton
          active={activeTab === "retriaged"}
          onClick={() => setActiveTab("retriaged")}
          label="Re-triaged"
          count={retriagedTickets.length}
          badgeClass="bg-violet-500/20 text-violet-400"
          pulse={false}
          hideZero={true}
        />
        <TabButton
          active={activeTab === "resolved"}
          onClick={() => setActiveTab("resolved")}
          label="Resolved"
          count={resolvedTickets.length}
          badgeClass="bg-emerald-500/20 text-emerald-400"
          pulse={false}
          hideZero={false}
        />

        {/* Ticket count */}
        <span className="ml-auto text-xs text-white/25 tabular-nums">
          {error
            ? "Unable to load"
            : `${totalNonResolved} open`}
        </span>
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

      {/* Sync progress bar */}
      {pulling && (
        <div className="overflow-hidden rounded-full h-1 bg-white/5">
          <div className="h-full w-1/3 bg-indigo-500/60 rounded-full animate-[pulse_1.5s_ease-in-out_infinite]" style={{ animation: "syncSlide 1.5s ease-in-out infinite" }} />
          <style>{`@keyframes syncSlide { 0% { transform: translateX(-100%); width: 33%; } 50% { transform: translateX(100%); width: 66%; } 100% { transform: translateX(300%); width: 33%; } }`}</style>
        </div>
      )}

      {activeTab === "needs_review" ? (
        <ReviewList onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
      ) : activeTab === "incoming" ? (
        incomingTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">
              No incoming tickets. New tickets from Halo webhooks will appear here automatically.
            </p>
          </div>
        ) : (
          <IncomingTicketList tickets={incomingTickets} onSelectTicket={handleSelectTicket} />
        )
      ) : activeTab === "alerts" ? (
        alertTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">
              No alert tickets. Automated alerts from Spanning, 3CX, Datto, etc. will appear here.
            </p>
          </div>
        ) : (
          <OpenTicketList tickets={alertTickets} onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
        )
      ) : activeTab === "stale" ? (
        staleTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">
              No stale tickets. All open tickets have had tech activity within the last 3 days.
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-3 rounded-lg border border-orange-500/20 bg-orange-500/5 px-4 py-2.5 text-sm text-orange-300">
              These tickets have had no tech activity for 3+ days and may need follow-up.
            </div>
            <OpenTicketList tickets={staleTickets} onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
          </div>
        )
      ) : activeTab === "retriaged" ? (
        retriagedTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">
              No re-triaged tickets yet. Tickets are re-triaged when customers reply or during periodic scans.
            </p>
          </div>
        ) : (
          <RetriagedTicketList tickets={retriagedTickets} onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
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
    <>
      {/* Mobile: card layout */}
      <div className="space-y-2 md:hidden">
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTicket(ticket.id)}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 cursor-pointer hover:bg-[var(--accent)] transition-colors"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-xs text-blue-400">#{ticket.halo_id}</span>
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                ticket.status === "pending"
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-blue-500/20 text-blue-400",
              )}>
                {ticket.status === "triaging" && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                )}
                {ticket.status}
              </span>
            </div>
            <p className="text-sm text-white mb-1.5 line-clamp-2">{ticket.summary}</p>
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>{ticket.client_name ?? "—"}</span>
              <span>{timeAgo(ticket.created_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table layout */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-[var(--border)]">
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
    </>
  );
}

// ── Re-triaged tickets list ──────────────────────────────────────────

function RetriagedTicketList({
  tickets,
  onSelectTicket,
  haloBaseUrl,
}: {
  readonly tickets: ReadonlyArray<TicketRow>;
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}) {
  return (
    <>
      {/* Mobile: card layout */}
      <div className="space-y-2 md:hidden">
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelectTicket(ticket.id)}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 cursor-pointer hover:bg-[var(--accent)] transition-colors"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-xs text-blue-400">#{ticket.halo_id}</span>
              <span className="inline-flex items-center gap-1 text-xs text-violet-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                  <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.681.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-.908l.84.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44.908l-.84-.84v1.56a.75.75 0 0 1-1.5 0V9.446a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.681.75.75 0 0 1 1.025-.274Z" clipRule="evenodd" />
                </svg>
                {timeAgo(ticket.last_retriage_at!)}
              </span>
            </div>
            <p className="text-sm text-white mb-1.5 line-clamp-2">{ticket.summary}</p>
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>{ticket.client_name ?? "—"}</span>
              <span>{ticket.halo_agent ?? "Unassigned"}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table layout */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--card)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">#</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Summary</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Client</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Status</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Re-triaged</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Originally Triaged</th>
              <th className="px-4 py-3 text-left font-medium text-[var(--muted-foreground)]">Assigned To</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => {
              const retriageDate = new Date(ticket.last_retriage_at!);
              const triageDate = ticket.triage_results[0]?.created_at
                ? new Date(ticket.triage_results[0].created_at)
                : null;

              return (
                <tr
                  key={ticket.id}
                  onClick={() => onSelectTicket(ticket.id)}
                  className="border-b border-[var(--border)] transition-colors cursor-pointer hover:bg-[var(--accent)]"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {haloBaseUrl ? (
                      <a
                        href={`${haloBaseUrl}/tickets?ticketid=${ticket.halo_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        {ticket.halo_id}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="currentColor" className="h-2.5 w-2.5 opacity-40">
                          <path d="M3.5 1a.5.5 0 0 0 0 1h3.793L1.146 8.146a.5.5 0 1 0 .708.708L8 2.707V6.5a.5.5 0 0 0 1 0v-5a.5.5 0 0 0-.5-.5h-5Z" />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-blue-400">{ticket.halo_id}</span>
                    )}
                  </td>
                  <td className="max-w-md truncate px-4 py-3">{ticket.summary}</td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{ticket.client_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {ticket.halo_status ?? ticket.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1 text-violet-400"
                      title={retriageDate.toLocaleString()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.681.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-.908l.84.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44.908l-.84-.84v1.56a.75.75 0 0 1-1.5 0V9.446a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.681.75.75 0 0 1 1.025-.274Z" clipRule="evenodd" />
                      </svg>
                      {timeAgo(ticket.last_retriage_at!)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-emerald-400/70">
                    {triageDate ? timeAgo(triageDate.toISOString()) : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {ticket.halo_agent ?? (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
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

// ── Tab Button ──────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
  count,
  badgeClass,
  pulse,
  hideZero,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly count: number;
  readonly badgeClass: string;
  readonly pulse: boolean;
  readonly hideZero: boolean;
}) {
  const showBadge = !hideZero || count > 0;
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-white/[0.08] text-white shadow-sm"
          : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]",
      )}
    >
      <span className="flex items-center gap-1.5">
        {label}
        {showBadge && (
          <span className={cn(
            "min-w-[18px] rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums text-center",
            active ? badgeClass : "bg-white/[0.06] text-white/30",
            pulse && count > 0 && "animate-pulse",
          )}>
            {count}
          </span>
        )}
      </span>
    </button>
  );
}
