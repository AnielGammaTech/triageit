"use client";

import { useState, useEffect, useCallback } from "react";
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
  readonly tickettype_id?: number | null;
  readonly halo_status?: string | null;
  readonly halo_team?: string | null;
  readonly halo_agent?: string | null;
  readonly last_retriage_at?: string | null;
  readonly last_customer_reply_at?: string | null;
  readonly last_tech_action_at?: string | null;
  readonly halo_is_open?: boolean | null;
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

// Fallback for tickets without halo_is_open flag (legacy data)
const CLOSED_STATUSES_FALLBACK = [
  "closed", "cancelled", "completed",
];

export default function TicketsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedTicketId = searchParams.get("id");
  const [tickets, setTickets] = useState<ReadonlyArray<TicketRow>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filterParam = searchParams.get("filter"); // "stale" | "unassigned" | null
  const initialTab = (searchParams.get("tab") as "open" | "needs_review" | "review_close" | "alerts" | "resolved") ?? "open";
  const [activeTab, setActiveTab] = useState<"open" | "needs_review" | "review_close" | "alerts" | "resolved">(initialTab);
  const [staleOnly, setStaleOnly] = useState(filterParam === "stale");
  const techFilter = searchParams.get("tech");
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [haloBaseUrl, setHaloBaseUrl] = useState<string | null>(null);
  const [haloIdInput, setHaloIdInput] = useState("");
  const [triagingHaloId, setTriagingHaloId] = useState(false);
  const [triagingAll, setTriagingAll] = useState(false);

  const loadTickets = useCallback(async () => {
    const supabase = createClient();

    // Fetch open + recently closed Gamma Default tickets (last 90 days)
    // Two queries to avoid Supabase's 1000-row default cap
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const ticketFields = `
      id, halo_id, summary, client_name, user_name, original_priority,
      status, created_at, tickettype_id, halo_status, halo_team, halo_agent,
      halo_is_open, last_retriage_at, last_customer_reply_at, last_tech_action_at,
      triage_results(urgency_score, recommended_priority, triage_type, classification, urgency_reasoning, internal_notes, created_at),
      tech_reviews(id),
      close_reviews(id)
    `;

    const [openResult, closedResult, alertsResult] = await Promise.all([
      // All open Gamma Default tickets (no date limit)
      supabase
        .from("tickets")
        .select(ticketFields)
        .eq("tickettype_id", 31)
        .eq("halo_is_open", true)
        .order("created_at", { ascending: false })
        .limit(500),
      // Recently closed Gamma Default (last 90 days for Resolved tab)
      supabase
        .from("tickets")
        .select(ticketFields)
        .eq("tickettype_id", 31)
        .eq("halo_is_open", false)
        .gte("created_at", threeMonthsAgo)
        .order("created_at", { ascending: false })
        .limit(1000),
      // Alert tickets (type 36) — recent, for Alerts tab
      supabase
        .from("tickets")
        .select(ticketFields)
        .eq("tickettype_id", 36)
        .gte("created_at", threeMonthsAgo)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const dbError = openResult.error ?? closedResult.error ?? alertsResult.error;
    const data = [...(openResult.data ?? []), ...(closedResult.data ?? []), ...(alertsResult.data ?? [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (dbError) {
      setError(dbError.message);
    } else {
      setTickets((data ?? []) as TicketRow[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  // Load Halo base URL once (separate from ticket loading to avoid dependency loops)
  useEffect(() => {
    if (haloBaseUrl) return;
    const supabase = createClient();
    supabase
      .from("integrations")
      .select("config")
      .eq("service", "halo")
      .single()
      .then(({ data: haloConfig }) => {
        if (haloConfig?.config) {
          const cfg = haloConfig.config as { base_url?: string };
          if (cfg.base_url) {
            setHaloBaseUrl(cfg.base_url.replace(/\/$/, ""));
          }
        }
      });
  }, [haloBaseUrl]);

  // Pull open tickets from Halo
  const pullFromHalo = useCallback(async () => {
    setPulling(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/health/force-sync", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatusMessage({ type: "error", text: body.error ?? `Pull failed: ${res.status}` });
      } else {
        const result = await res.json();
        const fetched = result.halo_fetched ?? result.pulled ?? 0;
        const created = result.db_created ?? result.created ?? 0;
        const opened = result.db_opened ?? result.updated ?? 0;
        const closed = result.db_closed ?? result.closed ?? 0;
        const statusFixed = result.db_statuses_fixed ?? 0;
        setStatusMessage({
          type: "success",
          text: `Synced ${fetched} tickets from Halo — ${created} new, ${opened} opened, ${closed} closed${statusFixed ? `, ${statusFixed} statuses fixed` : ""}`,
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

  // On mount: load DB tickets immediately, then auto-pull from Halo in the background
  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Auto-pull disabled — use Health & Maintenance > Sync Now instead
  // useEffect(() => {
  //   if (!loading && !hasPulled.current) {
  //     hasPulled.current = true;
  //     pullFromHalo();
  //   }
  // }, [loading, pullFromHalo]);

  // Use Halo's own open/closed flag (set by pull-tickets sync).
  // Falls back to status name matching for legacy tickets without the flag.
  const isClosed = (t: TicketRow) => {
    if (t.halo_is_open === true) return false;
    if (t.halo_is_open === false) return true;
    // Fallback for tickets synced before halo_is_open was added
    if (!t.halo_status) return false;
    return CLOSED_STATUSES_FALLBACK.includes(t.halo_status.toLowerCase());
  };

  // Apply tech filter from query params (e.g. from Analytics page)
  // Note: pull-tickets already only syncs Gamma Default (type 31) from Halo,
  // so no client-side type filter is needed.
  const baseFiltered = techFilter
    ? tickets.filter((t) => t.halo_agent === techFilter)
    : tickets;

  // Apply unassigned filter
  const filteredTickets = filterParam === "unassigned"
    ? baseFiltered.filter((t) => !t.halo_agent)
    : baseFiltered;

  // ── Tab assignment ──
  // Open = all non-resolved Gamma Default tickets (should match Halo's open count)
  // Stale = sub-filter within Open (no tech activity 3+ days)

  const isStale = (t: TicketRow): boolean => {
    const lastAction = t.last_tech_action_at ?? t.created_at;
    const hoursSince = (Date.now() - new Date(lastAction).getTime()) / (1000 * 60 * 60);
    return hoursSince > 72;
  };

  // Only show Gamma Default (type 31) tickets on the dashboard.
  // Null-type tickets are legacy data from before type tracking — show in Resolved only.
  const GAMMA_DEFAULT_TYPE_ID = 31;
  const gammaDefaultTickets = filteredTickets.filter((t) => t.tickettype_id === GAMMA_DEFAULT_TYPE_ID);
  const legacyTickets = filteredTickets.filter((t) => t.tickettype_id == null);

  // Open: Gamma Default tickets not closed/cancelled — matches Halo's "Agent Tickets" count
  const allOpenTickets = gammaDefaultTickets.filter((t) => !isClosed(t));

  // Alerts: non-Gamma Default tickets (type 36 and others) — separate tab, ignored by triage
  const alertTickets = filteredTickets.filter((t) =>
    t.tickettype_id != null && t.tickettype_id !== GAMMA_DEFAULT_TYPE_ID,
  );

  // Resolved: closed Gamma Default + all legacy (null-type) tickets
  const closedGamma = gammaDefaultTickets.filter((t) => isClosed(t));
  const closedLegacy = legacyTickets;
  const resolvedTickets = [...closedGamma, ...closedLegacy];

  // Stale count (for the filter badge)
  const staleCount = allOpenTickets.filter((t) => isStale(t)).length;

  // Apply stale filter if toggled
  const openTickets = staleOnly
    ? allOpenTickets.filter((t) => isStale(t))
    : allOpenTickets;

  // Review tab count: tech reviews + retriage-flagged tickets (critical/warning)
  const [reviewCount, setReviewCount] = useState<number>(0);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      fetch("/api/tech-reviews").then((r) => r.json()).then((d) => {
        const reviews = (d.reviews ?? []) as ReadonlyArray<{ ticket_id: string }>;
        return new Set(reviews.map((r) => r.ticket_id)).size;
      }).catch(() => 0),
      supabase
        .from("triage_results")
        .select("ticket_id", { count: "exact", head: false })
        .eq("triage_type", "retriage")
        .gte("created_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
        .or("classification->>subtype.eq.critical,classification->>subtype.eq.warning")
        .then(({ data }) => {
          const unique = new Set((data ?? []).map((r: { ticket_id: string }) => r.ticket_id));
          return unique.size;
        }),
    ]).then(([techCount, retriageCount]) => {
      setReviewCount(techCount + retriageCount);
    }).catch(() => setReviewCount(0));
  }, []);

  // Close review count — tickets with poor/needs_improvement close reviews
  const [closeReviewTickets, setCloseReviewTickets] = useState<ReadonlyArray<{
    readonly halo_id: number;
    readonly tech_name: string | null;
    readonly review_data: { tech_performance: { rating: string } };
    readonly created_at: string;
    readonly tickets: { id: string; summary: string; client_name: string | null; halo_id: number };
  }>>([]);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("close_reviews")
          .select("halo_id, tech_name, review_data, created_at, tickets!inner(id, summary, client_name, halo_id, halo_agent, tickettype_id)")
          .order("created_at", { ascending: false })
          .limit(200);

        // Filter: poor/needs_improvement only, Gamma Default only, NO alerts, deduplicate by halo_id
        const ALERT_PATTERNS = ["spanning backup", "3cx alert", "phish911", "backupiq", "datto alert", "datto rms", "report domain"];
        const seen = new Set<number>();
        const bad = (data ?? []).filter((r) => {
          const rating = (r.review_data as { tech_performance?: { rating?: string } })?.tech_performance?.rating;
          const ticket = r.tickets as unknown as { tickettype_id?: number; summary?: string; client_name?: string | null };
          const isGamma = (ticket as Record<string, unknown>).tickettype_id === 31;
          const isBad = rating === "poor" || rating === "needs_improvement";
          // Exclude alerts: client_name "Alerts" or "Unknown", or summary matches alert patterns
          const clientName = ((ticket as Record<string, unknown>).client_name as string | null ?? "").toLowerCase();
          const summary = ((ticket as Record<string, unknown>).summary as string ?? "").toLowerCase();
          const isAlert = clientName === "alerts" || clientName === "unknown" || ALERT_PATTERNS.some((p) => summary.includes(p));
          if (!isBad || !isGamma || isAlert || seen.has(r.halo_id as number)) return false;
          seen.add(r.halo_id as number);
          return true;
        });
        setCloseReviewTickets(bad as unknown as typeof closeReviewTickets);
      } catch {
        setCloseReviewTickets([]);
      }
    })();
  }, []);

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
          active={activeTab === "open"}
          onClick={() => { setActiveTab("open"); setStaleOnly(false); }}
          label="Open"
          count={allOpenTickets.length}
          badgeClass="bg-amber-500/20 text-amber-400"
          pulse={false}
          hideZero={false}
        />
        <TabButton
          active={activeTab === "needs_review"}
          onClick={() => setActiveTab("needs_review")}
          label="Review"
          count={reviewCount}
          badgeClass="bg-rose-500/20 text-rose-400"
          pulse={false}
          hideZero={false}
        />
        <TabButton
          active={activeTab === "review_close"}
          onClick={() => setActiveTab("review_close")}
          label="Close Review"
          count={closeReviewTickets.length}
          badgeClass="bg-yellow-500/20 text-yellow-400"
          pulse={false}
          hideZero
        />
        <TabButton
          active={activeTab === "alerts"}
          onClick={() => setActiveTab("alerts")}
          label="Alerts"
          count={alertTickets.length}
          badgeClass="bg-orange-500/20 text-orange-400"
          pulse={false}
          hideZero
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
            : `${allOpenTickets.length} open · ${resolvedTickets.length} resolved`}
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
      ) : activeTab === "review_close" ? (
        closeReviewTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">No close reviews needing attention.</p>
          </div>
        ) : (
          <CloseReviewCards
            reviews={closeReviewTickets}
            onSelectTicket={handleSelectTicket}
            haloBaseUrl={haloBaseUrl}
          />
        )
      ) : activeTab === "alerts" ? (
        alertTickets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
            <p className="text-[var(--muted-foreground)]">No alert tickets found.</p>
          </div>
        ) : (
          <OpenTicketList tickets={alertTickets} onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
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
        <div>
          {/* Stale filter toggle */}
          {staleCount > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => setStaleOnly(!staleOnly)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  staleOnly
                    ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                    : "bg-white/[0.03] text-white/40 border border-white/[0.06] hover:bg-white/[0.05] hover:text-white/60",
                )}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400" />
                Stale ({staleCount})
              </button>
              {staleOnly && (
                <span className="text-xs text-orange-300/60">
                  Showing tickets with no tech activity for 3+ days
                </span>
              )}
            </div>
          )}
          <OpenTicketList tickets={openTickets} onSelectTicket={handleSelectTicket} haloBaseUrl={haloBaseUrl} />
        </div>
      )}
    </div>
  );
}

// ── Tab Button ──────────────────────────────────────────────────────

// ── Close Review Cards — matches Review tab format ──────────────────────

function CloseReviewCards({
  reviews,
  onSelectTicket,
  haloBaseUrl,
}: {
  readonly reviews: ReadonlyArray<{
    readonly halo_id: number;
    readonly tech_name: string | null;
    readonly review_data: { tech_performance: { rating: string; response_time?: string; communication?: string; highlights?: string | null; issues?: string | null } };
    readonly created_at: string;
    readonly tickets: { id: string; summary: string; client_name: string | null; halo_id: number; halo_agent?: string | null };
  }>;
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const ratingStyles: Record<string, { label: string; color: string; border: string }> = {
    poor: { label: "POOR", color: "text-red-400", border: "border-l-red-500" },
    needs_improvement: { label: "NEEDS IMP", color: "text-amber-400", border: "border-l-amber-500" },
    good: { label: "GOOD", color: "text-blue-400", border: "border-l-blue-500" },
    great: { label: "GREAT", color: "text-emerald-400", border: "border-l-emerald-500" },
  };

  return (
    <div className="space-y-1">
      {reviews.map((cr) => {
        const perf = cr.review_data?.tech_performance ?? { rating: "unknown" };
        const rating = perf.rating ?? "unknown";
        const ticket = cr.tickets as unknown as { id: string; summary: string; client_name: string | null; halo_id: number; halo_agent: string | null };
        const techName = ticket.halo_agent ?? cr.tech_name ?? "Unassigned";
        const style = ratingStyles[rating] ?? { label: rating.toUpperCase(), color: "text-white/50", border: "border-l-white/20" };
        const haloLink = haloBaseUrl ? `${haloBaseUrl}/tickets?id=${ticket.halo_id}` : null;
        const key = `${cr.halo_id}-${cr.created_at}`;
        const isOpen = expandedId === key;
        const daysAgo = Math.floor((Date.now() - new Date(cr.created_at).getTime()) / 86400000);

        return (
          <div key={key} className={cn("rounded-lg border border-white/[0.06] border-l-[3px] overflow-hidden", style.border, isOpen && "ring-1 ring-white/10")}>
            {/* Compact row */}
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : key)}
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
            >
              <span className={cn("shrink-0 text-[10px] font-black tracking-wider w-[72px]", style.color)}>{style.label}</span>
              <span className="text-xs font-mono text-white/40 shrink-0">#{ticket.halo_id}</span>
              <span className="text-sm text-white/80 truncate flex-1">{ticket.summary}</span>
              <span className="hidden sm:block shrink-0 text-xs text-white/25 max-w-[100px] truncate">{ticket.client_name ?? ""}</span>
              <span className={cn("hidden sm:block shrink-0 text-xs font-medium w-[110px] text-right", techName === "Unassigned" ? "text-red-400" : "text-white/50")}>{techName}</span>
              <span className="shrink-0 text-[11px] text-white/20 tabular-nums w-6 text-right">{daysAgo}d</span>
              <svg className={cn("shrink-0 h-3.5 w-3.5 text-white/15 transition-transform", isOpen && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded */}
            {isOpen && (
              <div className="border-t border-white/[0.06] px-4 py-3 space-y-3 bg-white/[0.01]">
                <div className="flex flex-wrap items-center gap-4 text-xs text-white/40">
                  {perf.response_time && <span>Response: <span className="text-white/70 font-medium">{perf.response_time}</span></span>}
                  {perf.communication && <span>Communication: <span className="text-white/70 font-medium">{perf.communication}</span></span>}
                </div>

                {(perf.highlights || perf.issues) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {perf.highlights && (
                      <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 px-3 py-2.5">
                        <p className="text-[10px] font-bold text-emerald-400 tracking-wider mb-1">HIGHLIGHTS</p>
                        <p className="text-xs text-emerald-100/70 leading-relaxed">{perf.highlights}</p>
                      </div>
                    )}
                    {perf.issues && (
                      <div className="rounded-lg bg-amber-500/[0.06] border border-amber-500/15 px-3 py-2.5">
                        <p className="text-[10px] font-bold text-amber-400 tracking-wider mb-1">ISSUES</p>
                        <p className="text-xs text-amber-100/70 leading-relaxed">{perf.issues}</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2 border-t border-white/[0.04]">
                  <button onClick={() => onSelectTicket(ticket.id)} className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-[#b91c1c] hover:bg-[#991b1b] transition-colors">
                    View Ticket
                  </button>
                  {haloLink && (
                    <a href={haloLink} target="_blank" rel="noopener noreferrer" className="rounded-md px-3 py-1.5 text-xs font-medium text-white/50 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors">
                      Open in Halo
                    </a>
                  )}
                  <span className="ml-auto text-xs text-white/25">{ticket.client_name ?? ""} | {techName}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
