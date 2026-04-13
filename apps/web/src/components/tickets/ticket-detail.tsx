"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { TriageFeedback } from "@/components/tickets/triage-feedback";
import type { TicketStatus } from "@triageit/shared";

// ── Types ───────────────────────────────────────────────────────────

interface TriageResult {
  readonly id: string;
  readonly classification: { type: string; subtype: string; confidence: number };
  readonly urgency_score: number;
  readonly urgency_reasoning: string;
  readonly recommended_priority: number;
  readonly recommended_team: string | null;
  readonly recommended_agent: string | null;
  readonly security_flag: boolean;
  readonly security_notes: string | null;
  readonly internal_notes: string | null;
  readonly suggested_response: string | null;
  readonly findings: Record<string, { agent_name: string; summary: string; data: Record<string, unknown>; confidence: number }> | null;
  readonly processing_time_ms: number | null;
  readonly model_tokens_used: { manager: number; workers: Record<string, number> } | null;
  readonly created_at: string;
}

interface AgentLog {
  readonly id: string;
  readonly agent_name: string;
  readonly agent_role: string;
  readonly status: string;
  readonly input_summary: string | null;
  readonly output_summary: string | null;
  readonly duration_ms: number | null;
  readonly error_message: string | null;
  readonly created_at: string;
}

interface TicketData {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly details: string | null;
  readonly client_name: string | null;
  readonly client_id: number | null;
  readonly user_name: string | null;
  readonly user_email: string | null;
  readonly original_priority: number | null;
  readonly status: TicketStatus;
  readonly error_message: string | null;
  readonly raw_data: Record<string, unknown> | null;
  readonly halo_status: string | null;
  readonly halo_status_id: number | null;
  readonly halo_agent: string | null;
  readonly halo_team: string | null;
  readonly tickettype_id: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface TicketDetailProps {
  readonly ticketId: string;
  readonly onBack: () => void;
  readonly haloBaseUrl?: string | null;
}

// ── Constants ───────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: "bg-yellow-500/10", text: "text-yellow-400" },
  triaging: { bg: "bg-blue-500/10", text: "text-blue-400" },
  triaged: { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  "re-triaged": { bg: "bg-violet-500/10", text: "text-violet-400" },
  approved: { bg: "bg-green-500/10", text: "text-green-400" },
  error: { bg: "bg-red-500/10", text: "text-red-400" },
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "P1 — Critical",
  2: "P2 — High",
  3: "P3 — Medium",
  4: "P4 — Low",
  5: "P5 — Minimal",
};

const AGENT_COLORS: Record<string, string> = {
  michael_scott: "bg-amber-500",
  ryan_howard: "bg-blue-500",
  dwight_schrute: "bg-emerald-500",
  jim_halpert: "bg-violet-500",
  pam_beesly: "bg-pink-500",
  andy_bernard: "bg-cyan-500",
  stanley_hudson: "bg-sky-500",
  phyllis_vance: "bg-orange-500",
  angela_martin: "bg-red-500",
  meredith_palmer: "bg-purple-500",
  kelly_kapoor: "bg-fuchsia-500",
};

const AGENT_NAMES: Record<string, string> = {
  michael_scott: "Michael Scott",
  ryan_howard: "Ryan Howard",
  dwight_schrute: "Dwight Schrute",
  jim_halpert: "Jim Halpert",
  pam_beesly: "Pam Beesly",
  andy_bernard: "Andy Bernard",
  stanley_hudson: "Stanley Hudson",
  phyllis_vance: "Phyllis Vance",
  angela_martin: "Angela Martin",
  meredith_palmer: "Meredith Palmer",
  kelly_kapoor: "Kelly Kapoor",
};

const AGENT_ROLES: Record<string, string> = {
  michael_scott: "Triage Manager",
  ryan_howard: "Classifier",
  dwight_schrute: "Documentation & Assets",
  jim_halpert: "Identity & Access",
  pam_beesly: "Communications",
  andy_bernard: "Endpoint & RMM",
  stanley_hudson: "Cloud Infrastructure",
  phyllis_vance: "Email & DNS",
  angela_martin: "Security Assessment",
  meredith_palmer: "Backup & Recovery",
  kelly_kapoor: "VoIP & Telephony",
  oscar_martinez: "Backup (Cove)",
  darryl_philbin: "Microsoft 365",
  creed_bratton: "Networking (UniFi)",
  holly_flax: "Licensing (Pax8)",
};

const INVOKABLE_AGENTS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly color: string;
}> = [
  { id: "dwight_schrute", name: "Dwight", desc: "Hudu docs, assets, KB articles", color: "emerald" },
  { id: "darryl_philbin", name: "Darryl", desc: "M365 users, licenses, sign-ins", color: "blue" },
  { id: "andy_bernard", name: "Andy", desc: "Datto devices, alerts, patches", color: "cyan" },
  { id: "holly_flax", name: "Holly", desc: "Pax8 licensing, subscriptions", color: "pink" },
  { id: "angela_martin", name: "Angela", desc: "Security assessment", color: "red" },
  { id: "jim_halpert", name: "Jim", desc: "JumpCloud identity, MFA", color: "violet" },
  { id: "phyllis_vance", name: "Phyllis", desc: "Email, DNS, DMARC", color: "orange" },
  { id: "creed_bratton", name: "Creed", desc: "UniFi networking", color: "sky" },
];

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Component ───────────────────────────────────────────────────────

export function TicketDetail({ ticketId, onBack, haloBaseUrl }: TicketDetailProps) {
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [agentLogs, setAgentLogs] = useState<ReadonlyArray<AgentLog>>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "agents" | "triageit" | "halo" | "raw">("overview");
  const [haloActions, setHaloActions] = useState<ReadonlyArray<{ who: string; date: string; note: string; isInternal: boolean; outcome: string | null }>>([]);
  const [haloActionsLoading, setHaloActionsLoading] = useState(false);
  const [haloActionsLoaded, setHaloActionsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [retriaging, setRetriaging] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [closeReviewing, setCloseReviewing] = useState(false);
  const [closeReviewDone, setCloseReviewDone] = useState(false);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [invokingAgent, setInvokingAgent] = useState<string | null>(null);
  const [agentResult, setAgentResult] = useState<{
    readonly agent_name: string;
    readonly summary: string;
    readonly data: Record<string, unknown>;
    readonly confidence: number;
  } | null>(null);
  const [kbDrafts, setKbDrafts] = useState<ReadonlyArray<{ title: string; category: string; content: string; hudu_section: string; why?: string; needs_info?: ReadonlyArray<string>; confidence?: string }>>([]);
  const [copiedKb, setCopiedKb] = useState<number | null>(null);
  const [closeReviewData, setCloseReviewData] = useState<{
    resolution_summary: string;
    tech_performance: { rating: string; response_time: string; communication: string; highlights: string | null; issues: string | null };
    ticket_lifecycle: { total_time: string; first_response_time: string; resolution_method: string };
    onsite_visits: ReadonlyArray<string>;
    documentation_action: { quality_score: number; notes: string; hudu_updates_needed: ReadonlyArray<string> };
  } | null>(null);
  const [kbLoading, setKbLoading] = useState(false);
  const [creatingKb, setCreatingKb] = useState<number | null>(null);
  const [createdKb, setCreatedKb] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<{ actions: number; appointments: number } | null>(null);
  const [triageItNotes, setTriageITNotes] = useState<ReadonlyArray<{ id: number; note: string; date: string; type: string }>>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadTicket = useCallback(async () => {
    const supabase = createClient();

    const [ticketRes, triageRes, logsRes] = await Promise.all([
      supabase.from("tickets").select("*").eq("id", ticketId).single(),
      supabase
        .from("triage_results")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("agent_logs")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true }),
    ]);

    if (ticketRes.data) setTicket(ticketRes.data as TicketData);
    if (triageRes.data) setTriage(triageRes.data as TriageResult);
    if (logsRes.data) setAgentLogs(logsRes.data as AgentLog[]);
    setLoading(false);
  }, [ticketId]);

  const handleRetriage = useCallback(async () => {
    if (retriaging) return;
    setRetriaging(true);

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket_id: ticketId }),
      });

      if (response.ok) {
        // Switch to agents tab and enable live polling — keep existing logs visible
        setActiveTab("agents");
        setIsLive(true);
      }
    } catch (error) {
      console.error("Failed to retriage:", error);
    } finally {
      setRetriaging(false);
    }
  }, [ticketId, retriaging]);

  const handleCloseReview = useCallback(async () => {
    if (closeReviewing || !ticket) return;
    setCloseReviewing(true);

    try {
      const response = await fetch("/api/close-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: ticket.halo_id }),
      });

      if (response.ok) {
        const data = await response.json() as { review?: Record<string, unknown> };
        setCloseReviewDone(true);
        if (data.review) {
          setCloseReviewData(data.review as typeof closeReviewData);
        }
        // Reload TriageIT notes to show the new close review note
        setNotesLoaded(false);
      }
    } catch (error) {
      console.error("Failed to generate close review:", error);
    } finally {
      setCloseReviewing(false);
    }
  }, [ticket, closeReviewing]);

  const handleKbIdeas = useCallback(async () => {
    if (kbLoading || !ticket) return;
    setKbLoading(true);

    try {
      const response = await fetch("/api/kb-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: ticket.halo_id }),
      });

      if (response.ok) {
        const data = await response.json() as { ideas?: ReadonlyArray<typeof kbDrafts[0]>; questions?: ReadonlyArray<string> };
        if (data.ideas) setKbDrafts(data.ideas);
      }
    } catch (error) {
      console.error("Failed to generate KB ideas:", error);
    } finally {
      setKbLoading(false);
    }
  }, [ticket, kbLoading]);

  const handleCreateInHudu = useCallback(async (index: number) => {
    const draft = kbDrafts[index];
    if (!draft || !ticket) return;
    setCreatingKb(index);

    try {
      const response = await fetch("/api/hudu/create-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: ticket.client_name,
          title: draft.title,
          content: draft.content,
        }),
      });

      if (response.ok) {
        setCreatedKb((prev) => new Set([...prev, index]));
      }
    } catch (error) {
      console.error("Failed to create Hudu article:", error);
    } finally {
      setCreatingKb(null);
    }
  }, [kbDrafts, ticket]);

  const loadTriageITNotes = useCallback(async () => {
    if (notesLoading || !ticket) return;
    setNotesLoading(true);

    try {
      const response = await fetch("/api/triageit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: ticket.halo_id }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          notes: ReadonlyArray<{ id: number; note: string; date: string; type: string }>;
        };
        setTriageITNotes(data.notes);
      }
    } catch (error) {
      console.error("Failed to load TriageIT notes:", error);
    } finally {
      setNotesLoading(false);
      setNotesLoaded(true);
    }
  }, [ticket, notesLoading]);

  const loadHaloActions = useCallback(async () => {
    if (haloActionsLoading || !ticket) return;
    setHaloActionsLoading(true);

    try {
      const response = await fetch(`/api/halo/actions?halo_id=${ticket.halo_id}`);
      if (response.ok) {
        const data = (await response.json()) as {
          actions: ReadonlyArray<{ who: string; date: string; note: string; isInternal: boolean; outcome: string | null }>;
        };
        setHaloActions(data.actions);
      }
    } catch (error) {
      console.error("Failed to load Halo actions:", error);
    } finally {
      setHaloActionsLoading(false);
      setHaloActionsLoaded(true);
    }
  }, [ticket, haloActionsLoading]);

  const handleSummarize = useCallback(async () => {
    if (summarizing || !ticket) return;
    setSummarizing(true);
    setSummary(null);

    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: ticket.halo_id }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          summary: string;
          actionCount: number;
          appointmentCount?: number;
        };
        setSummary(data.summary);
        setSummaryMeta({
          actions: data.actionCount,
          appointments: data.appointmentCount ?? 0,
        });
      } else {
        setSummary("Failed to generate summary. Please try again.");
      }
    } catch {
      setSummary("Failed to generate summary. Please try again.");
    } finally {
      setSummarizing(false);
    }
  }, [ticket, summarizing]);

  const handleInvokeAgent = useCallback(async (agentId: string) => {
    if (invokingAgent || !ticket) return;
    setInvokingAgent(agentId);
    setAgentResult(null);
    setShowAgentMenu(false);

    try {
      const res = await fetch("/api/agent/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: ticket.halo_id, agent_name: agentId }),
      });

      if (res.ok) {
        const data = await res.json();
        setAgentResult({
          agent_name: data.agent_name,
          summary: data.summary,
          data: data.data,
          confidence: data.confidence,
        });
        // Switch to agents tab to see the live thinking
        setActiveTab("agents");
      }
    } catch {
      // Non-fatal
    } finally {
      setInvokingAgent(null);
    }
  }, [ticket, invokingAgent]);

  // Initial load + real-time subscriptions
  useEffect(() => {
    loadTicket();

    const supabase = createClient();

    // Subscribe to new agent_logs for this ticket (live thinking)
    const logsChannel = supabase
      .channel(`agent-logs-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_logs",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const newLog = payload.new as AgentLog;
          setAgentLogs((prev) => [...prev, newLog]);
          setIsLive(true);
          // Auto-scroll to bottom
          setTimeout(() => {
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }, 100);
        },
      )
      .subscribe();

    // Subscribe to ticket status changes
    const ticketChannel = supabase
      .channel(`ticket-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `id=eq.${ticketId}`,
        },
        (payload) => {
          setTicket((prev) =>
            prev ? { ...prev, ...(payload.new as Partial<TicketData>) } : prev,
          );
        },
      )
      .subscribe();

    // Subscribe to triage_results for this ticket
    const triageChannel = supabase
      .channel(`triage-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "triage_results",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          setTriage(payload.new as TriageResult);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(logsChannel);
      supabase.removeChannel(ticketChannel);
      supabase.removeChannel(triageChannel);
    };
  }, [ticketId, loadTicket]);

  // Auto-switch to agents tab when triaging starts
  useEffect(() => {
    if (ticket?.status === "triaging" && agentLogs.length > 0) {
      setActiveTab("agents");
    }
  }, [ticket?.status, agentLogs.length]);

  // Load TriageIT notes when tab is selected (lazy load)
  useEffect(() => {
    if (activeTab === "triageit" && !notesLoaded && !notesLoading) {
      loadTriageITNotes();
    }
  }, [activeTab, notesLoaded, notesLoading, loadTriageITNotes]);

  useEffect(() => {
    if (activeTab === "halo" && !haloActionsLoaded && !haloActionsLoading) {
      loadHaloActions();
    }
  }, [activeTab, haloActionsLoaded, haloActionsLoading, loadHaloActions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="py-20 text-center text-white/50">Ticket not found.</div>
    );
  }

  const statusStyle = STATUS_STYLES[ticket.status] ?? STATUS_STYLES.pending;
  const isTriaging = ticket.status === "triaging";

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <button
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/5 hover:text-white self-start"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-xl font-semibold text-white">
              {haloBaseUrl ? (
                <a
                  href={`${haloBaseUrl}/tickets?id=${ticket.halo_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-blue-400 transition-colors"
                  title="Open in Halo"
                >
                  Ticket #{ticket.halo_id}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-40">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ) : (
                <>Ticket #{ticket.halo_id}</>
              )}
            </h2>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusStyle.bg, statusStyle.text)}>
              {isTriaging && (
                <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              )}
              {ticket.status}
            </span>
            {triage?.security_flag && (
              <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                </svg>
                Security
              </span>
            )}
            {isLive && isTriaging && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Live
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-white/70">{ticket.summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          <button
            onClick={handleSummarize}
            disabled={summarizing}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              summarizing
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
            )}
          >
            {summarizing ? (
              <div className="h-3 w-3 animate-spin rounded-full border border-amber-400/30 border-t-amber-400" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M16 13H8" />
                <path d="M16 17H8" />
                <path d="M10 9H8" />
              </svg>
            )}
            {summarizing ? "Summarizing..." : "SummarizeIT"}
          </button>
          <button
            onClick={handleRetriage}
            disabled={retriaging || isTriaging}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              retriaging || isTriaging
                ? "cursor-not-allowed bg-white/5 text-white/20"
                : "bg-[#b91c1c]/10 text-[#b91c1c] hover:bg-[#b91c1c]/20",
            )}
          >
            {retriaging ? (
              <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/60" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            )}
            {retriaging ? "Re-triaging..." : "Re-triage"}
          </button>
          <button
            onClick={handleCloseReview}
            disabled={closeReviewing || closeReviewDone}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              closeReviewDone
                ? "bg-emerald-500/10 text-emerald-400"
                : closeReviewing
                  ? "cursor-not-allowed bg-white/5 text-white/20"
                  : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
            )}
          >
            {closeReviewing ? (
              <div className="h-3 w-3 animate-spin rounded-full border border-emerald-400/30 border-t-emerald-400" />
            ) : closeReviewDone ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            )}
            {closeReviewing ? "Reviewing..." : closeReviewDone ? "Review Posted" : "Close Review"}
          </button>
          {/* Ask Agent dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowAgentMenu(!showAgentMenu)}
              disabled={!!invokingAgent}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                invokingAgent
                  ? "cursor-not-allowed bg-white/5 text-white/20"
                  : "bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20",
              )}
            >
              {invokingAgent ? (
                <div className="h-3 w-3 animate-spin rounded-full border border-indigo-400/30 border-t-indigo-400" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              )}
              {invokingAgent ? `Running ${AGENT_NAMES[invokingAgent] ?? invokingAgent}...` : "Ask Agent"}
            </button>
            {showAgentMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-white/10 bg-[#1a1a2e] shadow-2xl overflow-hidden">
                <div className="px-3 py-2 border-b border-white/5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">Run agent on this ticket</p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {INVOKABLE_AGENTS.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => handleInvokeAgent(agent.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/5"
                    >
                      <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white", `bg-${agent.color}-500`)}>
                        {agent.name[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-white">{agent.name}</p>
                        <p className="text-[10px] text-white/40 truncate">{agent.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info cards row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <InfoCard label="Client" value={ticket.client_name ?? "Unknown"} />
        <InfoCard label="Reported By" value={ticket.user_name ?? ticket.user_email ?? "Unknown"} />
        <InfoCard
          label="Original Priority"
          value={ticket.original_priority ? PRIORITY_LABELS[ticket.original_priority] ?? `P${ticket.original_priority}` : "—"}
        />
        <InfoCard label="Created" value={timeAgo(ticket.created_at)} />
        <InfoCard
          label="Halo Status"
          value={ticket.halo_status ?? "Unknown"}
          accent={getHaloStatusAccent(ticket.halo_status)}
        />
        <InfoCard
          label="Tech Assigned"
          value={ticket.halo_agent ?? "Unassigned"}
          accent={ticket.halo_agent ? undefined : "warning"}
        />
        <InfoCard label="Team" value={ticket.halo_team ?? "—"} />
        <InfoCard label="Ticket Type" value={resolveTicketTypeName(ticket.tickettype_id, ticket.raw_data)} />
      </div>

      {/* Error banner */}
      {ticket.status === "error" && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-5">
          <div className="mb-2 flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 className="text-sm font-semibold text-red-400">Triage Failed</h3>
          </div>
          {ticket.error_message ? (
            <div className="mt-2 rounded-lg bg-red-500/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60 mb-1">Error Message</p>
              <p className="font-mono text-xs text-red-300/80 whitespace-pre-wrap break-all">{ticket.error_message}</p>
            </div>
          ) : (
            <p className="text-sm text-red-300/60">
              An error occurred during triage. No error details were captured. Try re-triaging the ticket.
            </p>
          )}
          {(() => {
            const errorLogs = agentLogs.filter((l) => l.status === "error");
            if (errorLogs.length === 0) return null;
            return (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60">Agent Errors</p>
                {errorLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2">
                    <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white", AGENT_COLORS[log.agent_name] ?? "bg-white/20")}>
                      {(AGENT_NAMES[log.agent_name] ?? log.agent_name).split(" ").map((w) => w[0]).join("").slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-red-300">
                        {AGENT_NAMES[log.agent_name] ?? log.agent_name}
                        <span className="ml-2 text-red-400/40">{AGENT_ROLES[log.agent_name] ?? log.agent_role}</span>
                      </p>
                      {log.error_message && (
                        <p className="mt-0.5 font-mono text-[11px] text-red-300/70 break-all">{log.error_message}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="mt-4">
            <button
              onClick={handleRetriage}
              disabled={retriaging || isTriaging}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                retriaging || isTriaging
                  ? "cursor-not-allowed bg-white/5 text-white/20"
                  : "bg-red-500/10 text-red-400 hover:bg-red-500/20",
              )}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
              {retriaging ? "Re-triaging..." : "Retry Triage"}
            </button>
          </div>
        </div>
      )}

      {/* SummarizeIT result */}
      {(summary || summarizing) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-amber-400">SummarizeIT</h3>
              <span className="text-[10px] text-amber-400/40">Tech Activity Summary</span>
            </div>
            {summaryMeta && (
              <span className="text-[10px] text-amber-400/40">
                {summaryMeta.actions} actions · {summaryMeta.appointments} appointments
              </span>
            )}
          </div>
          {summarizing ? (
            <div className="flex items-center gap-2 py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400/20 border-t-amber-400" />
              <span className="text-sm text-amber-400/60">Reading private notes & appointments...</span>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">
              {summary}
            </div>
          )}
        </div>
      )}

      {/* Agent invoke result */}
      {agentResult && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white", AGENT_COLORS[agentResult.agent_name] ?? "bg-indigo-500")}>
                {(AGENT_NAMES[agentResult.agent_name] ?? agentResult.agent_name).split(" ").map((w: string) => w[0]).join("").slice(0, 2)}
              </div>
              <h3 className="text-sm font-semibold text-indigo-400">{AGENT_NAMES[agentResult.agent_name] ?? agentResult.agent_name}</h3>
              <span className="text-[10px] text-indigo-400/40">{AGENT_ROLES[agentResult.agent_name] ?? "Specialist"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-indigo-400/40">Confidence: {(agentResult.confidence * 100).toFixed(0)}%</span>
              <button
                onClick={() => setAgentResult(null)}
                className="text-white/20 hover:text-white/40 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">
            {agentResult.summary}
          </div>
          {agentResult.data && Object.keys(agentResult.data).length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[10px] text-indigo-400/40 hover:text-indigo-400/60">Show raw data</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/20 p-3 text-[10px] text-white/40">
                {JSON.stringify(agentResult.data, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Triage summary card */}
      {triage && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          {(() => {
            const totalTokens = triage.model_tokens_used
              ? triage.model_tokens_used.manager +
                Object.values(triage.model_tokens_used.workers).reduce((a, b) => a + b, 0)
              : null;
            return (
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">AI Triage Result</h3>
                <span className="text-xs text-white/30">
                  {triage.processing_time_ms ? `${(triage.processing_time_ms / 1000).toFixed(1)}s` : ""}
                  {" · "}
                  {triage.findings ? `${Object.keys(triage.findings).length} agents` : ""}
                  {totalTokens != null ? ` · ${totalTokens.toLocaleString()} tokens` : ""}
                  {" · "}
                  {timeAgo(triage.created_at)}
                </span>
              </div>
            );
          })()}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">Classification</p>
              <p className="mt-1 text-sm font-medium text-white">
                {triage.classification.type}
                <span className="text-white/40"> / {triage.classification.subtype}</span>
              </p>
              <p className="text-[10px] text-white/30">
                {(triage.classification.confidence * 100).toFixed(0)}% confidence
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">AI Priority</p>
              <p className="mt-1 text-sm font-medium text-white">
                {PRIORITY_LABELS[triage.recommended_priority] ?? `P${triage.recommended_priority}`}
              </p>
              <p className="text-[10px] text-white/30">Urgency {triage.urgency_score}/5</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">Recommended Team</p>
              <p className="mt-1 text-sm font-medium text-white">{triage.recommended_team ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">Security</p>
              <p className={cn("mt-1 text-sm font-medium", triage.security_flag ? "text-red-400" : "text-emerald-400")}>
                {triage.security_flag ? "Flagged" : "Clear"}
              </p>
            </div>
          </div>

          {triage.urgency_reasoning && (
            <div className="mt-4 rounded-lg bg-white/5 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">Urgency Reasoning</p>
              <p className="text-sm text-white/70">{triage.urgency_reasoning}</p>
            </div>
          )}

          {triage.security_flag && triage.security_notes && (
            <div className="mt-3 rounded-lg bg-red-500/5 border border-red-500/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60 mb-1">Security Notes</p>
              <p className="text-sm text-red-300/80">{triage.security_notes}</p>
            </div>
          )}

          <TriageFeedback triageResultId={triage.id} ticketId={ticketId} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        {(["overview", "agents", "triageit", "halo", "raw"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium capitalize transition-colors whitespace-nowrap",
              activeTab === tab
                ? "border-b-2 border-[#b91c1c] text-white"
                : "text-white/50 hover:text-white",
            )}
          >
            {tab === "raw"
              ? "Raw Data"
              : tab === "agents"
                ? (
                    <>
                      Agent Thinking ({agentLogs.length})
                      {isTriaging && (
                        <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                      )}
                    </>
                  )
                : tab === "triageit"
                  ? (
                      <>
                        TriageIT
                        {notesLoaded && triageItNotes.length > 0 && (
                          <span className="ml-1.5 text-xs text-white/30">({triageItNotes.length})</span>
                        )}
                      </>
                    )
                  : tab === "halo"
                    ? (
                        <>
                          Halo Notes
                          {haloActionsLoaded && haloActions.length > 0 && (
                            <span className="ml-1.5 text-xs text-white/30">({haloActions.length})</span>
                          )}
                        </>
                      )
                    : "Details"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {ticket.details && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/30">Description</h4>
              <p className="whitespace-pre-wrap text-sm text-white/70">{ticket.details}</p>
            </div>
          )}

          {triage?.internal_notes && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/30">Internal Notes (AI)</h4>
              <p className="whitespace-pre-wrap text-sm text-white/70">{triage.internal_notes}</p>
            </div>
          )}

          {/* Specialist findings — collapsible per agent */}
          {triage?.findings && Object.keys(triage.findings).length > 1 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/30">Specialist Findings</h4>
              <div className="space-y-2">
                {Object.entries(triage.findings)
                  .filter(([name]) => name !== "ryan_howard")
                  .map(([name, finding]) => (
                    <CollapsibleFinding key={name} name={name} finding={finding} />
                  ))}
              </div>
            </div>
          )}

          {triage?.suggested_response && (
            <div className="rounded-xl border border-[#b91c1c]/20 bg-[#b91c1c]/5 p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#b91c1c]/60">Suggested Client Response</h4>
              <p className="whitespace-pre-wrap text-sm text-white/70">{triage.suggested_response}</p>
            </div>
          )}

          {!ticket.details && !triage?.internal_notes && ticket.status !== "error" && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm text-white/40">
                {ticket.status === "pending"
                  ? "This ticket is pending triage. Michael Scott will analyze it soon."
                  : ticket.status === "triaging"
                    ? "Agents are working on this ticket right now..."
                    : "No additional details available."}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "agents" && (
        <div
          ref={scrollRef}
          className="max-h-[600px] space-y-1.5 overflow-y-auto"
        >
          {agentLogs.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm text-white/40">
                {isTriaging ? "Waiting for agent activity..." : "No agent activity yet."}
              </p>
              {isTriaging && (
                <div className="mt-3 flex items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                </div>
              )}
            </div>
          ) : (
            <>
              {agentLogs.map((log, index) => {
                const isThinking = log.status === "thinking";
                const dotColor =
                  log.status === "completed" ? "bg-emerald-400" :
                  log.status === "started" ? "bg-blue-400" :
                  log.status === "error" ? "bg-red-400" :
                  isThinking ? "bg-amber-400" :
                  "bg-white/30";

                const isLatest = index === agentLogs.length - 1 && isTriaging;

                return (
                  <div
                    key={log.id}
                    className={cn(
                      "flex items-start gap-3 rounded-xl px-4 py-3 transition-all",
                      isThinking
                        ? "border border-amber-500/10 bg-amber-500/[0.03]"
                        : "border border-white/10 bg-white/[0.02]",
                      isLatest && "ring-1 ring-[#b91c1c]/30",
                    )}
                  >
                    <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white", AGENT_COLORS[log.agent_name] ?? "bg-white/20")}>
                      {(AGENT_NAMES[log.agent_name] ?? log.agent_name)
                        .split(" ")
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-white">
                          {AGENT_NAMES[log.agent_name] ?? log.agent_name}
                        </p>
                        <span className="text-[9px] text-white/30">
                          {AGENT_ROLES[log.agent_name] ?? log.agent_role}
                        </span>
                        <span className={cn(
                          "inline-block h-1.5 w-1.5 rounded-full",
                          dotColor,
                          isLatest && isThinking && "animate-pulse",
                        )} />
                        <span className={cn(
                          "text-[9px]",
                          isThinking ? "text-amber-400/60" : "text-white/30",
                        )}>
                          {log.status}
                        </span>
                        {log.duration_ms != null && (
                          <span className="text-[9px] text-white/20">{log.duration_ms}ms</span>
                        )}
                      </div>
                      {log.output_summary && (
                        <p className={cn(
                          "mt-1 text-xs leading-relaxed",
                          isThinking ? "text-amber-200/50 italic" : "text-white/50",
                        )}>
                          {isThinking && "💭 "}
                          {log.output_summary}
                        </p>
                      )}
                      {log.input_summary && !log.output_summary && (
                        <p className="mt-1 text-xs text-white/40">
                          {log.input_summary}
                        </p>
                      )}
                      {log.error_message && (
                        <p className="mt-1 text-xs text-red-400/70">{log.error_message}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[9px] text-white/20">
                      {timeAgo(log.created_at)}
                    </span>
                  </div>
                );
              })}
              {isTriaging && (
                <div className="flex items-center justify-center py-3">
                  <div className="flex items-center gap-2 text-xs text-white/30">
                    <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/60" />
                    Agents are working...
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "triageit" && (
        <div className="space-y-3">
          {/* Close Review result — shown after review completes */}
          {closeReviewData && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/70">Close Review</p>
              <p className="text-sm text-white/70">{closeReviewData.resolution_summary}</p>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className={cn("rounded px-2 py-0.5 font-semibold",
                  closeReviewData.tech_performance.rating === "great" ? "bg-green-500/20 text-green-400" :
                  closeReviewData.tech_performance.rating === "good" ? "bg-blue-500/20 text-blue-400" :
                  closeReviewData.tech_performance.rating === "needs_improvement" ? "bg-yellow-500/20 text-yellow-400" :
                  "bg-red-500/20 text-red-400"
                )}>{closeReviewData.tech_performance.rating.replace("_", " ").toUpperCase()}</span>
                <span className="text-white/40">Response: <strong className="text-white/60">{closeReviewData.tech_performance.response_time}</strong></span>
                <span className="text-white/40">Total: <strong className="text-white/60">{closeReviewData.ticket_lifecycle.total_time}</strong></span>
                <span className="text-white/40">Method: <strong className="text-white/60">{closeReviewData.ticket_lifecycle.resolution_method}</strong></span>
                <span className="text-white/40">Docs: <strong className="text-white/60">{closeReviewData.documentation_action.quality_score}/5</strong></span>
              </div>
              {closeReviewData.tech_performance.highlights && (
                <p className="text-xs text-emerald-400/60">{closeReviewData.tech_performance.highlights}</p>
              )}
              {closeReviewData.tech_performance.issues && (
                <p className="text-xs text-amber-400/60">{closeReviewData.tech_performance.issues}</p>
              )}
            </div>
          )}

          {/* KB Ideas button */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleKbIdeas}
              disabled={kbLoading}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                kbLoading
                  ? "cursor-not-allowed bg-white/5 text-white/20"
                  : "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20",
              )}
            >
              {kbLoading ? (
                <div className="h-3 w-3 animate-spin rounded-full border border-blue-400/30 border-t-blue-400" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              )}
              {kbLoading ? "Analyzing..." : "KB Ideas"}
            </button>
            {kbDrafts.length > 0 && (
              <span className="text-[10px] text-white/25">{kbDrafts.length} suggestion{kbDrafts.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* KB Ideas results — collapsible */}
          {kbDrafts.length > 0 && (
            <details open className="group rounded-xl border border-blue-500/20 bg-blue-500/[0.04] overflow-hidden">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 select-none list-none">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400 transition-transform group-open:rotate-90"><path d="M9 18l6-6-6-6" /></svg>
                <span className="text-xs font-medium text-blue-400">KB Suggestions</span>
                <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">{kbDrafts.length}</span>
              </summary>
              <div className="space-y-2 px-3 pb-3">
                {kbDrafts.map((draft, i) => (
                  <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0 rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-blue-300 uppercase">{draft.category}</span>
                        {draft.confidence && (
                          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium",
                            draft.confidence === "high" ? "bg-green-500/20 text-green-400" :
                            draft.confidence === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-white/5 text-white/30"
                          )}>{draft.confidence}</span>
                        )}
                        <span className="truncate text-xs text-white/80">{draft.title}</span>
                      </div>
                      <div className="ml-2 shrink-0 flex items-center gap-1">
                        <button
                          onClick={() => { void navigator.clipboard.writeText(draft.content); setCopiedKb(i); setTimeout(() => setCopiedKb(null), 2000); }}
                          className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors", copiedKb === i ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-white/40 hover:bg-white/10")}
                        >
                          {copiedKb === i ? "Copied" : "Copy"}
                        </button>
                        <button
                          onClick={() => handleCreateInHudu(i)}
                          disabled={creatingKb === i || createdKb.has(i)}
                          className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                            createdKb.has(i) ? "bg-emerald-500/20 text-emerald-400" :
                            creatingKb === i ? "bg-white/5 text-white/20" :
                            "bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25"
                          )}
                        >
                          {createdKb.has(i) ? "Created" : creatingKb === i ? "..." : "Create in Hudu"}
                        </button>
                      </div>
                    </div>
                    {draft.why && <p className="px-3 py-1 text-[10px] text-white/30 border-b border-white/5">{draft.why}</p>}
                    <pre className="px-3 py-1.5 text-[11px] text-white/60 whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto">{draft.content}</pre>
                    {draft.needs_info && draft.needs_info.length > 0 && (
                      <div className="px-3 py-1.5 border-t border-white/5 text-[10px] text-amber-400/60">
                        Needs more info: {draft.needs_info.join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {notesLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-sm text-white/40">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                Loading TriageIT notes from Halo...
              </div>
            </div>
          ) : triageItNotes.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm text-white/40">No TriageIT notes found for this ticket.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/30">
                  {triageItNotes.length} note{triageItNotes.length !== 1 ? "s" : ""} posted by TriageIT
                </p>
                <button
                  onClick={() => { setNotesLoaded(false); loadTriageITNotes(); }}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  Refresh
                </button>
              </div>
              {triageItNotes.map((note) => (
                <CollapsibleNote key={note.id} note={note} />
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === "halo" && (
        <div className="space-y-3">
          {haloActionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-sm text-white/40">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                Loading Halo notes...
              </div>
            </div>
          ) : haloActions.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm text-white/40">No actions found for this ticket in Halo.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/30">
                  {haloActions.length} action{haloActions.length !== 1 ? "s" : ""} from Halo
                </p>
                <button
                  onClick={() => { setHaloActionsLoaded(false); loadHaloActions(); }}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  Refresh
                </button>
              </div>
              {haloActions.map((action, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-xl border p-4",
                    action.isInternal
                      ? "border-amber-500/15 bg-amber-500/[0.03]"
                      : "border-white/10 bg-white/[0.02]",
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-white/70">{action.who}</span>
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                      action.isInternal
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-blue-500/20 text-blue-400",
                    )}>
                      {action.isInternal ? "INTERNAL" : "CUSTOMER"}
                    </span>
                    {action.outcome && (
                      <span className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-white/5 text-white/30">
                        {action.outcome}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-white/25">
                      {action.date ? new Date(action.date).toLocaleString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        timeZone: "America/New_York",
                      }) : "—"}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs text-white/60 leading-relaxed max-h-48 overflow-y-auto">
                    {action.note || "(no content)"}
                  </pre>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === "raw" && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <pre className="max-h-96 overflow-auto text-xs text-white/60">
            {JSON.stringify(ticket.raw_data ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const NOTE_TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  triage: { bg: "bg-[#b91c1c]/10", text: "text-[#b91c1c]", label: "Triage" },
  retriage: { bg: "bg-violet-500/10", text: "text-violet-400", label: "Retriage" },
  "tech-review": { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Tech Review" },
  "close-review": { bg: "bg-teal-500/10", text: "text-teal-400", label: "Close Review" },
  alert: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Alert" },
  priority: { bg: "bg-orange-500/10", text: "text-orange-400", label: "Priority" },
  documentation: { bg: "bg-yellow-500/10", text: "text-yellow-400", label: "Doc Gap" },
  other: { bg: "bg-white/5", text: "text-white/50", label: "Note" },
};

function CollapsibleFinding({ name, finding }: { readonly name: string; readonly finding: { agent_name: string; summary: string; confidence: number } }) {
  const [expanded, setExpanded] = useState(false);
  // Convert **text** to <strong> for readability
  const formatted = finding.summary
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 px-4 py-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white", AGENT_COLORS[name] ?? "bg-white/20")}>
          {(AGENT_NAMES[name] ?? name).split(" ").map((w) => w[0]).join("").slice(0, 2)}
        </div>
        <span className="text-sm font-medium text-white">{AGENT_NAMES[name] ?? name}</span>
        <span className="text-[10px] text-white/30">{AGENT_ROLES[name] ?? finding.agent_name}</span>
        <span className="ml-auto text-[10px] text-white/20">{(finding.confidence * 100).toFixed(0)}%</span>
        <svg
          className={cn("h-3.5 w-3.5 text-white/20 transition-transform", expanded && "rotate-180")}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div
          className="px-4 pb-4 pt-1 text-xs text-white/60 leading-relaxed [&_strong]:text-white/80 [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: formatted }}
        />
      )}
    </div>
  );
}

function CollapsibleNote({ note }: { readonly note: { readonly id: number; readonly note: string; readonly date: string; readonly type: string } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <NoteTypeBadge type={note.type} />
          <span className="text-[10px] text-white/30">
            {note.date ? new Date(note.date).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              timeZone: "America/New_York",
            }) : "Unknown date"}
          </span>
        </div>
        <svg
          className={cn("h-3.5 w-3.5 text-white/30 transition-transform", expanded && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div
          className="p-4 overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_img]:max-h-6"
          dangerouslySetInnerHTML={{ __html: note.note }}
        />
      )}
    </div>
  );
}

function NoteTypeBadge({ type }: { readonly type: string }) {
  const style = NOTE_TYPE_STYLES[type] ?? NOTE_TYPE_STYLES.other;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", style.bg, style.text)}>
      {style.label}
    </span>
  );
}

function InfoCard({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: "success" | "warning" | "info" | "danger";
}) {
  const accentColors: Record<string, string> = {
    success: "text-emerald-400",
    warning: "text-amber-400",
    info: "text-blue-400",
    danger: "text-red-400",
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-medium", accent ? accentColors[accent] : "text-white")}>
        {value}
      </p>
    </div>
  );
}

function getHaloStatusAccent(status: string | null): "success" | "warning" | "info" | "danger" | undefined {
  if (!status) return undefined;
  const lower = status.toLowerCase();
  if (lower.includes("new") || lower.includes("customer reply")) return "warning";
  if (lower.includes("in progress") || lower.includes("waiting on tech")) return "info";
  if (lower.includes("resolved") || lower.includes("closed")) return "success";
  if (lower.includes("on hold") || lower.includes("pending vendor") || lower.includes("waiting on customer")) return undefined;
  return undefined;
}

const TICKET_TYPE_NAMES: Record<number, string> = {
  31: "Gamma Default",
  36: "Alerts",
};

function resolveTicketTypeName(ticketTypeId: number | null, rawData: Record<string, unknown> | null): string {
  const typeId = ticketTypeId ?? (rawData?.tickettype_id as number | undefined);
  if (!typeId) return "—";
  return TICKET_TYPE_NAMES[typeId] ?? `Type ${typeId}`;
}
