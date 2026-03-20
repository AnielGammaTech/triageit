"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
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
};

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
  const [activeTab, setActiveTab] = useState<"overview" | "agents" | "triageit" | "raw">("overview");
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [retriaging, setRetriaging] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryMeta, setSummaryMeta] = useState<{ actions: number; appointments: number } | null>(null);
  const [triageItNotes, setTriageItNotes] = useState<ReadonlyArray<{ id: number; note: string; date: string; type: string }>>([]);
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
        // Clear local state for fresh triage
        setTriage(null);
        setAgentLogs([]);
        setActiveTab("agents");
        setIsLive(true);
      }
    } catch (error) {
      console.error("Failed to retriage:", error);
    } finally {
      setRetriaging(false);
    }
  }, [ticketId, retriaging]);

  const loadTriageItNotes = useCallback(async () => {
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
        setTriageItNotes(data.notes);
      }
    } catch (error) {
      console.error("Failed to load TriageIt notes:", error);
    } finally {
      setNotesLoading(false);
      setNotesLoaded(true);
    }
  }, [ticket, notesLoading]);

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

  // Load TriageIt notes when tab is selected (lazy load)
  useEffect(() => {
    if (activeTab === "triageit" && !notesLoaded && !notesLoading) {
      loadTriageItNotes();
    }
  }, [activeTab, notesLoaded, notesLoading, loadTriageItNotes]);

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
      <div className="flex items-start gap-4">
        <button
          onClick={onBack}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/5 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
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
        <div className="flex shrink-0 items-center gap-2">
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
                : "bg-[#6366f1]/10 text-[#6366f1] hover:bg-[#6366f1]/20",
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
        </div>
      </div>

      {/* Info cards row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoCard label="Client" value={ticket.client_name ?? "Unknown"} />
        <InfoCard label="Reported By" value={ticket.user_name ?? ticket.user_email ?? "Unknown"} />
        <InfoCard
          label="Original Priority"
          value={ticket.original_priority ? PRIORITY_LABELS[ticket.original_priority] ?? `P${ticket.original_priority}` : "—"}
        />
        <InfoCard label="Created" value={timeAgo(ticket.created_at)} />
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        {(["overview", "agents", "triageit", "raw"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium capitalize transition-colors",
              activeTab === tab
                ? "border-b-2 border-[#6366f1] text-white"
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

          {/* Specialist findings */}
          {triage?.findings && Object.keys(triage.findings).length > 1 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/30">Specialist Findings</h4>
              <div className="space-y-3">
                {Object.entries(triage.findings)
                  .filter(([name]) => name !== "ryan_howard")
                  .map(([name, finding]) => (
                    <div
                      key={name}
                      className="rounded-lg border border-white/5 bg-white/[0.02] p-4"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <div className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white", AGENT_COLORS[name] ?? "bg-white/20")}>
                          {(AGENT_NAMES[name] ?? name).split(" ").map((w) => w[0]).join("").slice(0, 2)}
                        </div>
                        <span className="text-sm font-medium text-white">
                          {AGENT_NAMES[name] ?? name}
                        </span>
                        <span className="text-[10px] text-white/30">
                          {AGENT_ROLES[name] ?? finding.agent_name}
                        </span>
                        <span className="ml-auto text-[10px] text-white/20">
                          {(finding.confidence * 100).toFixed(0)}% confidence
                        </span>
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed">
                        {finding.summary}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {triage?.suggested_response && (
            <div className="rounded-xl border border-[#6366f1]/20 bg-[#6366f1]/5 p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6366f1]/60">Suggested Client Response</h4>
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
                      isLatest && "ring-1 ring-[#6366f1]/30",
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
          {notesLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-sm text-white/40">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                Loading TriageIt notes from Halo...
              </div>
            </div>
          ) : triageItNotes.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm text-white/40">No TriageIt notes found for this ticket.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/30">
                  {triageItNotes.length} note{triageItNotes.length !== 1 ? "s" : ""} posted by TriageIt
                </p>
                <button
                  onClick={() => { setNotesLoaded(false); loadTriageItNotes(); }}
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
  triage: { bg: "bg-[#6366f1]/10", text: "text-[#6366f1]", label: "Triage" },
  retriage: { bg: "bg-violet-500/10", text: "text-violet-400", label: "Retriage" },
  "tech-review": { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Tech Review" },
  alert: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Alert" },
  priority: { bg: "bg-orange-500/10", text: "text-orange-400", label: "Priority" },
  documentation: { bg: "bg-yellow-500/10", text: "text-yellow-400", label: "Doc Gap" },
  other: { bg: "bg-white/5", text: "text-white/50", label: "Note" },
};

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
            {note.date ? new Date(note.date).toLocaleString() : "Unknown date"}
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

function InfoCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white">{value}</p>
    </div>
  );
}
