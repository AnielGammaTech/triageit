"use client";

import { useEffect, useState } from "react";
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
  readonly processing_time_ms: number | null;
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
  readonly raw_data: Record<string, unknown> | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface TicketDetailProps {
  readonly ticketId: string;
  readonly onBack: () => void;
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

export function TicketDetail({ ticketId, onBack }: TicketDetailProps) {
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [agentLogs, setAgentLogs] = useState<ReadonlyArray<AgentLog>>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "agents" | "raw">("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTicket();
  }, [ticketId]);

  async function loadTicket() {
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
  }

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
              Ticket #{ticket.halo_id}
            </h2>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusStyle.bg, statusStyle.text)}>
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
          </div>
          <p className="mt-1 text-sm text-white/70">{ticket.summary}</p>
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

      {/* Triage summary card */}
      {triage && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">AI Triage Result</h3>
            <span className="text-xs text-white/30">
              {triage.processing_time_ms ? `${(triage.processing_time_ms / 1000).toFixed(1)}s` : ""}
              {" · "}
              {timeAgo(triage.created_at)}
            </span>
          </div>
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
        {(["overview", "agents", "raw"] as const).map((tab) => (
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
            {tab === "raw" ? "Raw Data" : tab === "agents" ? `Agent Activity (${agentLogs.length})` : "Details"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {/* Ticket details */}
          {ticket.details && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/30">Description</h4>
              <p className="whitespace-pre-wrap text-sm text-white/70">{ticket.details}</p>
            </div>
          )}

          {/* Internal notes from triage */}
          {triage?.internal_notes && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/30">Internal Notes (AI)</h4>
              <p className="whitespace-pre-wrap text-sm text-white/70">{triage.internal_notes}</p>
            </div>
          )}

          {/* Suggested response */}
          {triage?.suggested_response && (
            <div className="rounded-xl border border-[#6366f1]/20 bg-[#6366f1]/5 p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6366f1]/60">Suggested Client Response</h4>
              <p className="whitespace-pre-wrap text-sm text-white/70">{triage.suggested_response}</p>
            </div>
          )}

          {!ticket.details && !triage?.internal_notes && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm text-white/40">
                {ticket.status === "pending"
                  ? "This ticket is pending triage. Michael Scott will analyze it soon."
                  : "No additional details available."}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "agents" && (
        <div className="space-y-2">
          {agentLogs.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-sm text-white/40">No agent activity yet.</p>
            </div>
          ) : (
            agentLogs.map((log) => {
              const dotColor =
                log.status === "completed" ? "bg-emerald-400" :
                log.status === "started" ? "bg-blue-400" :
                log.status === "error" ? "bg-red-400" :
                "bg-white/30";

              return (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
                >
                  <div className={cn("mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white", AGENT_COLORS[log.agent_name] ?? "bg-white/20")}>
                    {(AGENT_NAMES[log.agent_name] ?? log.agent_name)
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">
                        {AGENT_NAMES[log.agent_name] ?? log.agent_name}
                      </p>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/40">
                        {log.agent_role}
                      </span>
                      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColor)} />
                      <span className="text-[10px] text-white/30">{log.status}</span>
                    </div>
                    {log.output_summary && (
                      <p className="mt-1 text-xs text-white/50">{log.output_summary}</p>
                    )}
                    {log.error_message && (
                      <p className="mt-1 text-xs text-red-400/70">{log.error_message}</p>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-white/30">
                      <span>{timeAgo(log.created_at)}</span>
                      {log.duration_ms != null && <span>{log.duration_ms}ms</span>}
                    </div>
                  </div>
                </div>
              );
            })
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

function InfoCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white">{value}</p>
    </div>
  );
}
