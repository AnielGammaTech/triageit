"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

// ── Shared types ────────────────────────────────────────────────────

interface TechReview {
  readonly id: string;
  readonly ticket_id: string;
  readonly halo_id: number;
  readonly tech_name: string | null;
  readonly rating: string;
  readonly communication_score: number;
  readonly response_time: string;
  readonly max_gap_hours: number;
  readonly strengths: string | null;
  readonly improvement_areas: string | null;
  readonly suggestions: readonly string[];
  readonly summary: string;
  readonly created_at: string;
  readonly tickets: {
    readonly summary: string;
    readonly client_name: string | null;
    readonly halo_status: string | null;
    readonly halo_agent: string | null;
    readonly halo_is_open?: boolean | null;
  };
}

interface ReTriageItem {
  readonly id: string;
  readonly ticket_id: string;
  readonly halo_id: number;
  readonly severity: string;
  readonly recommendation: string;
  readonly flags: readonly string[];
  readonly positives: readonly string[];
  readonly created_at: string;
  readonly tickets: {
    readonly summary: string;
    readonly client_name: string | null;
    readonly halo_status: string | null;
    readonly halo_agent: string | null;
    readonly halo_is_open?: boolean | null;
  };
}

type ReviewItem =
  | { readonly source: "tech_review"; readonly data: TechReview; readonly sortDate: string; readonly id: string }
  | { readonly source: "retriage"; readonly data: ReTriageItem; readonly sortDate: string; readonly id: string };

// ── Style maps ──────────────────────────────────────────────────────

const TECH_RATINGS: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  poor: { label: "POOR", color: "text-red-400", bg: "bg-red-500/10", border: "border-l-red-500", dot: "bg-red-400" },
  needs_improvement: { label: "NEEDS IMP", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", dot: "bg-amber-400" },
  good: { label: "GOOD", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-l-blue-500", dot: "bg-blue-400" },
  great: { label: "GREAT", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-l-emerald-500", dot: "bg-emerald-400" },
};

const RETRIAGE_SEVERITY: Record<string, { label: string; color: string; border: string; dot: string }> = {
  critical: { label: "CRITICAL", color: "text-red-400", border: "border-l-red-500", dot: "bg-red-400" },
  warning: { label: "WARNING", color: "text-amber-400", border: "border-l-amber-500", dot: "bg-amber-400" },
  info: { label: "INFO", color: "text-blue-400", border: "border-l-blue-500", dot: "bg-blue-400" },
};

const FLAG_LABELS: Record<string, string> = {
  wot_overdue: "Waiting on Tech > 24h",
  customer_waiting: "Customer waiting 24h+",
  stale: "No activity 3+ days",
  unassigned: "Unassigned",
  no_tech_notes: "No tech documentation",
  low_progress: "Low progress",
  high_priority_aging: "High priority aging",
  sla_breached: "SLA breached",
  slow_response: "Slow response",
  no_documentation: "No documentation",
  customer_waiting_no_reply: "Customer waiting, no reply",
  reopened_no_explanation: "Reopened without explanation",
};

const CLOSED_STATUS_MARKERS = ["closed", "resolved", "cancelled", "canceled", "completed"];

// ── Helpers ──────────────────────────────────────────────────────────

function isClosedTicket(ticket: { readonly halo_is_open?: boolean | null; readonly halo_status?: string | null }): boolean {
  const status = (ticket.halo_status ?? "").toLowerCase();
  if (CLOSED_STATUS_MARKERS.some((marker) => status.includes(marker))) return true;
  return ticket.halo_is_open === false;
}

function resolveTechName(review: TechReview): { name: string; isDispatch: boolean } {
  const techName = review.tech_name;
  const haloAgent = review.tickets.halo_agent;
  if (techName && !/^\d+$/.test(techName.trim())) return { name: techName, isDispatch: false };
  if (haloAgent && !/^\d+$/.test(haloAgent.trim())) return { name: haloAgent, isDispatch: false };
  return { name: "Unassigned", isDispatch: true };
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ── Component ───────────────────────────────────────────────────────

interface ReviewListProps {
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}

export function ReviewList({ onSelectTicket, haloBaseUrl }: ReviewListProps) {
  const [items, setItems] = useState<readonly ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"" | "tech_review" | "retriage">("");
  const [techFilter, setTechFilter] = useState("");

  const loadAll = useCallback(async () => {
    try {
      // Fetch tech reviews
      const techRes = await fetch("/api/tech-reviews");
      const techData = techRes.ok ? await techRes.json() : { reviews: [] };
      const techReviews = (techData.reviews ?? []) as readonly TechReview[];

      // Dedupe tech reviews — keep latest per ticket
      const techByTicket = new Map<string, TechReview>();
      for (const r of techReviews) {
        if (isClosedTicket(r.tickets)) continue;
        if (!techByTicket.has(r.ticket_id)) techByTicket.set(r.ticket_id, r);
      }

      const techItems: ReviewItem[] = [...techByTicket.values()].map((r) => ({
        source: "tech_review" as const,
        data: r,
        sortDate: r.created_at,
        id: `tr-${r.id}`,
      }));

      // Fetch retriage-flagged tickets (triage_results with retriage type, critical/warning)
      const supabase = createClient();
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data: retriageResults } = await supabase
        .from("triage_results")
        .select("id, ticket_id, classification, urgency_reasoning, findings, created_at, tickets!inner(halo_id, summary, client_name, halo_status, halo_agent, halo_is_open)")
        .eq("triage_type", "retriage")
        .gte("created_at", threeDaysAgo)
        .order("created_at", { ascending: false })
        .limit(200);

      const retriageItems: ReviewItem[] = [];
      const seenTickets = new Set<string>();

      for (const tr of retriageResults ?? []) {
        if (seenTickets.has(tr.ticket_id)) continue;
        seenTickets.add(tr.ticket_id);

        const classification = tr.classification as { type?: string; subtype?: string } | null;
        const severity = classification?.subtype ?? "info";
        if (severity === "info") continue; // Only show critical + warning

        const findings = tr.findings as { daily_scan?: { flags?: string[]; positives?: string[]; recommendation?: string } } | null;
        const scan = findings?.daily_scan;
        const ticket = Array.isArray(tr.tickets) ? tr.tickets[0] : tr.tickets;
        if (!ticket) continue;
        if (isClosedTicket(ticket)) continue;

        retriageItems.push({
          source: "retriage" as const,
          data: {
            id: tr.id,
            ticket_id: tr.ticket_id,
            halo_id: (ticket as { halo_id: number }).halo_id,
            severity,
            recommendation: scan?.recommendation ?? tr.urgency_reasoning ?? "",
            flags: scan?.flags ?? [],
            positives: scan?.positives ?? [],
            created_at: tr.created_at,
            tickets: ticket as ReTriageItem["tickets"],
          },
          sortDate: tr.created_at,
          id: `rt-${tr.id}`,
        });
      }

      // Combine and sort by date
      const combined = [...techItems, ...retriageItems].sort(
        (a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime(),
      );

      setItems(combined.filter((item) => !isClosedTicket(item.data.tickets)));
    } catch {
      /* silent */
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" /></div>;
  }

  if (items.length === 0) {
    return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-16 text-center"><p className="text-sm text-white/30">No reviews or retriage flags.</p></div>;
  }

  // Filters
  const allTechs = [...new Set(items.map((i) => {
    if (i.source === "tech_review") return resolveTechName(i.data).name;
    return i.data.tickets.halo_agent ?? "Unassigned";
  }))].sort();

  const filtered = items.filter((i) => {
    if (isClosedTicket(i.data.tickets)) return false;
    if (sourceFilter && i.source !== sourceFilter) return false;
    const q = search.toLowerCase();
    if (q) {
      const ticket = i.source === "tech_review" ? i.data.tickets : i.data.tickets;
      const haloId = i.source === "tech_review" ? i.data.halo_id : i.data.halo_id;
      if (
        !ticket.summary.toLowerCase().includes(q) &&
        !String(haloId).includes(q) &&
        !(ticket.client_name ?? "").toLowerCase().includes(q) &&
        !(ticket.halo_agent ?? "").toLowerCase().includes(q)
      ) return false;
    }
    if (techFilter) {
      const tech = i.source === "tech_review" ? resolveTechName(i.data).name : (i.data.tickets.halo_agent ?? "Unassigned");
      if (tech !== techFilter) return false;
    }
    return true;
  });

  // Counts
  const techReviewCount = filtered.filter((i) => i.source === "tech_review").length;
  const retriageCritical = filtered.filter((i) => i.source === "retriage" && i.data.severity === "critical").length;
  const retriageWarning = filtered.filter((i) => i.source === "retriage" && i.data.severity === "warning").length;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
          className="flex-1 min-w-[180px] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-white/20 focus:outline-none" />
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-white/70 focus:outline-none">
          <option value="">All Types</option>
          <option value="tech_review">Tech Reviews</option>
          <option value="retriage">AI Retriage</option>
        </select>
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-white/70 focus:outline-none">
          <option value="">All Techs</option>
          {allTechs.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-3">
        <span className="text-sm font-semibold text-white/50">{filtered.length} Items</span>
        <div className="flex items-center gap-4 ml-auto">
          {retriageCritical > 0 && <span className="flex items-center gap-1.5 text-sm font-bold text-red-400"><span className="h-2.5 w-2.5 rounded-full bg-red-400" />{retriageCritical} Critical</span>}
          {retriageWarning > 0 && <span className="flex items-center gap-1.5 text-sm font-bold text-amber-400"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />{retriageWarning} Warning</span>}
          {techReviewCount > 0 && <span className="flex items-center gap-1.5 text-sm font-bold text-blue-400"><span className="h-2.5 w-2.5 rounded-full bg-blue-400" />{techReviewCount} Tech Reviews</span>}
        </div>
      </div>

      {/* ── Rows ── */}
      <div className="space-y-1">
        {filtered.map((item) => {
          if (item.source === "tech_review") return <TechReviewRow key={item.id} review={item.data} expandedId={expandedId} setExpandedId={setExpandedId} onSelectTicket={onSelectTicket} haloBaseUrl={haloBaseUrl} />;
          return <ReTriageRow key={item.id} item={item.data} expandedId={expandedId} setExpandedId={setExpandedId} onSelectTicket={onSelectTicket} haloBaseUrl={haloBaseUrl} />;
        })}
      </div>
    </div>
  );
}

// ── Tech Review Row ─────────────────────────────────────────────────

function TechReviewRow({ review: r, expandedId, setExpandedId, onSelectTicket, haloBaseUrl }: {
  readonly review: TechReview;
  readonly expandedId: string | null;
  readonly setExpandedId: (id: string | null) => void;
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}) {
  const style = TECH_RATINGS[r.rating] ?? TECH_RATINGS.good;
  const tech = resolveTechName(r);
  const haloLink = haloBaseUrl ? `${haloBaseUrl}/tickets?id=${r.halo_id}` : null;
  const itemId = `tr-${r.id}`;
  const isOpen = expandedId === itemId;

  return (
    <div className={cn("rounded-lg border border-white/[0.06] border-l-[3px] overflow-hidden", style.border, isOpen && "ring-1 ring-white/10")}>
      <button type="button" onClick={() => setExpandedId(isOpen ? null : itemId)}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors">
        <span className="shrink-0 text-[9px] font-bold tracking-wider text-white/30 bg-white/[0.04] px-1.5 py-0.5 rounded">TECH</span>
        <span className={cn("shrink-0 text-[10px] font-black tracking-wider w-[72px]", style.color)}>{style.label}</span>
        <span className="text-xs font-mono text-white/40 shrink-0">#{r.halo_id}</span>
        <span className="text-sm text-white/80 truncate flex-1">{r.tickets.summary}</span>
        <span className="hidden sm:block shrink-0 text-xs text-white/25 max-w-[100px] truncate">{r.tickets.client_name ?? ""}</span>
        <span className={cn("hidden sm:block shrink-0 text-xs font-medium w-[110px] text-right", tech.isDispatch ? "text-red-400" : "text-white/50")}>{tech.name}</span>
        <span className="shrink-0 text-[11px] text-white/20 tabular-nums w-6 text-right">{timeAgo(r.created_at)}</span>
        <svg className={cn("shrink-0 h-3.5 w-3.5 text-white/15 transition-transform", isOpen && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3 bg-white/[0.01]">
          <p className="text-[13px] text-white/80 leading-relaxed">{r.summary}</p>
          <div className="flex flex-wrap items-center gap-4 text-xs text-white/40">
            <span>Response: <span className="text-white/70 font-medium">{r.response_time}</span></span>
            {r.max_gap_hours > 0 && <span>Gap: <span className={cn("font-medium", r.max_gap_hours > 4 ? "text-red-400" : r.max_gap_hours > 2 ? "text-amber-400" : "text-white/70")}>{r.max_gap_hours.toFixed(1)}h</span></span>}
            <span>Comm: <span className="text-white/70 font-medium">{r.communication_score}/5</span></span>
            <span>Status: <span className="text-white/70">{r.tickets.halo_status ?? "?"}</span></span>
          </div>
          {(r.strengths || r.improvement_areas) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {r.strengths && (
                <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 px-3 py-2.5">
                  <p className="text-[10px] font-bold text-emerald-400 tracking-wider mb-1">STRENGTHS</p>
                  <p className="text-xs text-emerald-100/70 leading-relaxed">{r.strengths}</p>
                </div>
              )}
              {r.improvement_areas && (
                <div className="rounded-lg bg-amber-500/[0.06] border border-amber-500/15 px-3 py-2.5">
                  <p className="text-[10px] font-bold text-amber-400 tracking-wider mb-1">NEEDS WORK</p>
                  <p className="text-xs text-amber-100/70 leading-relaxed">{r.improvement_areas}</p>
                </div>
              )}
            </div>
          )}
          {r.suggestions.length > 0 && (
            <div className="rounded-lg bg-blue-500/[0.05] border border-blue-500/15 px-3 py-2.5">
              <p className="text-[10px] font-bold text-blue-400 tracking-wider mb-1">SUGGESTIONS</p>
              {r.suggestions.map((s, i) => (
                <p key={i} className="text-xs text-blue-100/70 leading-relaxed">{i + 1}. {s}</p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.04]">
            <button onClick={() => onSelectTicket(r.ticket_id)} className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-[#b91c1c] hover:bg-[#991b1b] transition-colors">View Ticket</button>
            {haloLink && (
              <a href={haloLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-md px-3 py-1.5 text-xs font-medium text-white/50 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors">Open in Halo</a>
            )}
            <span className="ml-auto text-xs text-white/25">{r.tickets.client_name ?? ""} | {tech.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Retriage Row ─────────────────────────────────────────────────

function ReTriageRow({ item, expandedId, setExpandedId, onSelectTicket, haloBaseUrl }: {
  readonly item: ReTriageItem;
  readonly expandedId: string | null;
  readonly setExpandedId: (id: string | null) => void;
  readonly onSelectTicket: (id: string) => void;
  readonly haloBaseUrl: string | null;
}) {
  const style = RETRIAGE_SEVERITY[item.severity] ?? RETRIAGE_SEVERITY.info;
  const tech = item.tickets.halo_agent ?? "Unassigned";
  const haloLink = haloBaseUrl ? `${haloBaseUrl}/tickets?id=${item.halo_id}` : null;
  const itemId = `rt-${item.id}`;
  const isOpen = expandedId === itemId;

  return (
    <div className={cn("rounded-lg border border-white/[0.06] border-l-[3px] overflow-hidden", style.border, isOpen && "ring-1 ring-white/10")}>
      <button type="button" onClick={() => setExpandedId(isOpen ? null : itemId)}
        className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors">
        <span className="shrink-0 text-[9px] font-bold tracking-wider text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">AI</span>
        <span className={cn("shrink-0 text-[10px] font-black tracking-wider w-[72px]", style.color)}>{style.label}</span>
        <span className="text-xs font-mono text-white/40 shrink-0">#{item.halo_id}</span>
        <span className="text-sm text-white/80 truncate flex-1">{item.tickets.summary}</span>
        <span className="hidden sm:block shrink-0 text-xs text-white/25 max-w-[100px] truncate">{item.tickets.client_name ?? ""}</span>
        <span className={cn("hidden sm:block shrink-0 text-xs font-medium w-[110px] text-right", tech === "Unassigned" ? "text-red-400" : "text-white/50")}>{tech}</span>
        <span className="shrink-0 text-[11px] text-white/20 tabular-nums w-6 text-right">{timeAgo(item.created_at)}</span>
        <svg className={cn("shrink-0 h-3.5 w-3.5 text-white/15 transition-transform", isOpen && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3 bg-white/[0.01]">
          {/* AI Recommendation */}
          <p className="text-[13px] text-white/80 leading-relaxed">{item.recommendation}</p>

          {/* Flags */}
          {item.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.flags.map((f) => (
                <span key={f} className="rounded-md bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-300">
                  {FLAG_LABELS[f] ?? f.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {/* Positives */}
          {item.positives.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.positives.map((p) => (
                <span key={p} className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  {p.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-white/40">
            <span>Status: <span className="text-white/70">{item.tickets.halo_status ?? "?"}</span></span>
            <span>Assigned: <span className={cn("font-medium", tech === "Unassigned" ? "text-red-400" : "text-white/70")}>{tech}</span></span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.04]">
            <button onClick={() => onSelectTicket(item.ticket_id)} className="rounded-md px-3 py-1.5 text-xs font-medium text-white bg-[#b91c1c] hover:bg-[#991b1b] transition-colors">View Ticket</button>
            {haloLink && (
              <a href={haloLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="rounded-md px-3 py-1.5 text-xs font-medium text-white/50 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors">Open in Halo</a>
            )}
            <span className="ml-auto text-xs text-white/25">{item.tickets.client_name ?? ""} | {tech}</span>
          </div>
        </div>
      )}
    </div>
  );
}
