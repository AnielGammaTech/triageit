"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

// ── Types ─────────────────────────────────────────────────────────────

interface TicketWithTriage {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly status: string;
  readonly original_priority: number | null;
  readonly created_at: string;
  readonly triage_results: ReadonlyArray<{
    readonly urgency_score: number;
    readonly recommended_priority: number;
    readonly recommended_team: string | null;
    readonly security_flag: boolean;
    readonly classification: {
      readonly type: string;
      readonly subtype: string;
      readonly confidence: number;
    } | null;
    readonly internal_notes: string | null;
  }>;
}

interface AgentLogEntry {
  readonly id: string;
  readonly agent_name: string;
  readonly agent_role: string;
  readonly status: string;
  readonly output_summary: string | null;
  readonly duration_ms: number | null;
  readonly created_at: string;
}

interface CustomerDetailProps {
  readonly customerId: number;
  readonly customerName: string | null;
  readonly customerEmail: string | null;
  readonly customerPhone: string | null;
  readonly customerSite: string | null;
}

type Tab = "tickets" | "history" | "agents";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  triaging: "bg-blue-500/10 text-blue-400",
  triaged: "bg-emerald-500/10 text-emerald-400",
  approved: "bg-green-500/10 text-green-400",
  error: "bg-red-500/10 text-red-400",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "text-red-400",
  2: "text-orange-400",
  3: "text-amber-400",
  4: "text-blue-400",
  5: "text-white/40",
};

// ── Main Component ────────────────────────────────────────────────────

export function CustomerDetail({
  customerId,
  customerName,
  customerEmail,
  customerPhone,
  customerSite,
}: CustomerDetailProps) {
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<Tab>("tickets");
  const [tickets, setTickets] = useState<ReadonlyArray<TicketWithTriage>>([]);
  const [agentLogs, setAgentLogs] = useState<ReadonlyArray<AgentLogEntry>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [customerName]);

  async function loadData() {
    if (!customerName) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // Load tickets for this customer
    const { data: ticketData } = await supabase
      .from("tickets")
      .select("*, triage_results(*)")
      .eq("client_name", customerName)
      .order("created_at", { ascending: false })
      .limit(100);

    const loadedTickets = (ticketData ?? []) as ReadonlyArray<TicketWithTriage>;
    setTickets(loadedTickets);

    // Load agent logs for these tickets
    if (loadedTickets.length > 0) {
      const ticketIds = loadedTickets.map((t) => t.id);
      const { data: logData } = await supabase
        .from("agent_logs")
        .select("*")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: false })
        .limit(200);

      setAgentLogs((logData ?? []) as ReadonlyArray<AgentLogEntry>);
    }

    setLoading(false);
  }

  // Stats
  const totalTickets = tickets.length;
  const triagedTickets = tickets.filter(
    (t) => t.status === "triaged" || t.status === "approved",
  ).length;
  const securityFlags = tickets.filter(
    (t) => t.triage_results?.[0]?.security_flag,
  ).length;
  const avgUrgency =
    tickets.length > 0
      ? (
          tickets.reduce(
            (sum, t) => sum + (t.triage_results?.[0]?.urgency_score ?? 0),
            0,
          ) / tickets.filter((t) => t.triage_results?.length > 0).length || 0
        ).toFixed(1)
      : "—";

  return (
    <div className="space-y-6">
      {/* Customer Header */}
      <div
        className="rounded-xl border border-white/10 p-6"
        style={{ backgroundColor: "#241010" }}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-500/10 text-lg font-bold text-blue-400">
            {customerName?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">
              {customerName ?? `Halo Customer #${customerId}`}
            </h3>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-white/40">
              {customerSite && (
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                  {customerSite}
                </span>
              )}
              {customerEmail && (
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                  {customerEmail}
                </span>
              )}
              {customerPhone && (
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>
                  {customerPhone}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-6 text-center">
            <div>
              <p className="text-2xl font-bold text-white">{totalTickets}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/30">Tickets</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-400">{triagedTickets}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/30">Triaged</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{avgUrgency}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/30">Avg Urgency</p>
            </div>
            {securityFlags > 0 && (
              <div>
                <p className="text-2xl font-bold text-red-400">{securityFlags}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/30">Security</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        {(["tickets", "history", "agents"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium capitalize transition-colors",
              activeTab === tab
                ? "border-b-2 border-[#b91c1c] text-white"
                : "text-white/50 hover:text-white",
            )}
          >
            {tab === "agents" ? "Agent Activity" : tab}
            {tab === "tickets" && totalTickets > 0 && (
              <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50">
                {totalTickets}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-white/40">Loading customer data...</p>
        </div>
      )}

      {/* Tab content */}
      {!loading && activeTab === "tickets" && (
        <TicketsTab tickets={tickets} />
      )}
      {!loading && activeTab === "history" && (
        <HistoryTab tickets={tickets} />
      )}
      {!loading && activeTab === "agents" && (
        <AgentsTab agentLogs={agentLogs} />
      )}
    </div>
  );
}

// ── Tickets Tab ───────────────────────────────────────────────────────

function TicketsTab({
  tickets,
}: {
  readonly tickets: ReadonlyArray<TicketWithTriage>;
}) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="text-sm text-white/50">No tickets from this customer yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/40">Ticket</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/40">Summary</th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/40">Status</th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/40">AI Priority</th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/40">Type</th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/40">Team</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => {
            const triage = ticket.triage_results?.[0];
            return (
              <tr key={ticket.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.04]">
                <td className="px-4 py-3 font-mono text-xs text-white/50">
                  #{ticket.halo_id}
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-white">
                  {ticket.summary}
                  {triage?.security_flag && (
                    <span className="ml-2 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                      SECURITY
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                    STATUS_STYLES[ticket.status] ?? "bg-white/5 text-white/40",
                  )}>
                    {ticket.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {triage ? (
                    <span className={cn("font-bold", PRIORITY_COLORS[triage.recommended_priority] ?? "text-white/40")}>
                      P{triage.recommended_priority}
                    </span>
                  ) : (
                    <span className="text-white/20">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {triage?.classification ? (
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                      {triage.classification.type}
                    </span>
                  ) : (
                    <span className="text-white/20">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-xs text-white/50">
                  {triage?.recommended_team ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────────────

function HistoryTab({
  tickets,
}: {
  readonly tickets: ReadonlyArray<TicketWithTriage>;
}) {
  const triaged = tickets.filter((t) => t.triage_results?.length > 0);

  if (triaged.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="text-sm text-white/50">No triage history for this customer yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {triaged.map((ticket) => {
        const triage = ticket.triage_results[0];
        const date = new Date(ticket.created_at);
        const timeAgo = getTimeAgo(date);

        return (
          <div
            key={ticket.id}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-white/30">
                    #{ticket.halo_id}
                  </span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                    STATUS_STYLES[ticket.status] ?? "bg-white/5 text-white/40",
                  )}>
                    {ticket.status}
                  </span>
                  {triage?.security_flag && (
                    <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                      SECURITY
                    </span>
                  )}
                  <span className="text-[10px] text-white/20">{timeAgo}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-white">
                  {ticket.summary}
                </p>
                {triage?.internal_notes && (
                  <p className="mt-2 rounded-lg bg-white/5 p-3 text-xs leading-relaxed text-white/50">
                    {triage.internal_notes}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {triage?.classification && (
                  <div className="mb-1">
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
                      {triage.classification.type}/{triage.classification.subtype}
                    </span>
                  </div>
                )}
                <p className="text-xs text-white/30">
                  {triage?.recommended_team && `→ ${triage.recommended_team}`}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agents Tab ────────────────────────────────────────────────────────

function AgentsTab({
  agentLogs,
}: {
  readonly agentLogs: ReadonlyArray<AgentLogEntry>;
}) {
  if (agentLogs.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="text-sm text-white/50">No agent activity for this customer yet.</p>
      </div>
    );
  }

  // Group by agent for summary
  const agentSummary = new Map<string, { count: number; avgDuration: number }>();
  for (const log of agentLogs) {
    const existing = agentSummary.get(log.agent_name) ?? {
      count: 0,
      avgDuration: 0,
    };
    const newCount = existing.count + 1;
    const totalDuration =
      existing.avgDuration * existing.count + (log.duration_ms ?? 0);
    agentSummary.set(log.agent_name, {
      count: newCount,
      avgDuration: totalDuration / newCount,
    });
  }

  const CHARACTER_NAMES: Record<string, string> = {
    michael_scott: "Michael Scott",
    ryan_howard: "Ryan Howard",
    dwight_schrute: "Dwight Schrute",
    jim_halpert: "Jim Halpert",
    pam_beesly: "Pam Beesly",
    andy_bernard: "Andy Bernard",
    stanley_hudson: "Stanley Hudson",
    phyllis_vance: "Phyllis Vance",
    angela_martin: "Angela Martin",
    oscar_martinez: "Oscar Martinez",
    kevin_malone: "Kevin Malone",
    kelly_kapoor: "Kelly Kapoor",
    toby_flenderson: "Toby Flenderson",
    meredith_palmer: "Meredith Palmer",
  };

  return (
    <div className="space-y-4">
      {/* Agent summary cards */}
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from(agentSummary.entries()).map(([agent, stats]) => (
          <div
            key={agent}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
          >
            <p className="text-sm font-medium text-white">
              {CHARACTER_NAMES[agent] ?? agent}
            </p>
            <p className="text-xs text-white/40">{agent.replace(/_/g, " ")}</p>
            <div className="mt-2 flex gap-4 text-[11px] text-white/30">
              <span>{stats.count} runs</span>
              <span>{(stats.avgDuration / 1000).toFixed(1)}s avg</span>
            </div>
          </div>
        ))}
      </div>

      {/* Recent activity log */}
      <h4 className="text-xs font-semibold uppercase tracking-wider text-white/30">
        Recent Activity
      </h4>
      <div className="space-y-1">
        {agentLogs.slice(0, 30).map((log) => {
          const date = new Date(log.created_at);
          const timeAgo = getTimeAgo(date);

          return (
            <div
              key={log.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-white/[0.03]"
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  log.status === "completed"
                    ? "bg-emerald-400"
                    : log.status === "error"
                      ? "bg-red-400"
                      : "bg-amber-400",
                )}
              />
              <span className="w-28 shrink-0 font-medium text-white/60">
                {CHARACTER_NAMES[log.agent_name] ?? log.agent_name}
              </span>
              <span className="min-w-0 flex-1 truncate text-white/40">
                {log.output_summary ?? log.status}
              </span>
              {log.duration_ms && (
                <span className="shrink-0 text-white/20">
                  {(log.duration_ms / 1000).toFixed(1)}s
                </span>
              )}
              <span className="shrink-0 text-white/20">{timeAgo}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function getTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
