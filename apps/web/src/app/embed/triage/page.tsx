import { createServiceClient } from "@/lib/supabase/server";
import { AGENTS } from "@triageit/shared";
import { QuickActions, CollapsibleSection, SpinnerStyles } from "./actions";

/**
 * Embeddable Triage Tab — loaded inside Halo PSA as a custom web tab.
 *
 * URL format: /embed/triage?halo_id={id}&token={EMBED_SECRET}
 * Halo replaces {id} with the ticket's Halo ID automatically.
 *
 * Shows the latest triage prominently + full triage history with timestamps.
 */

// ── Constants ───────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Critical", color: "#ef4444" },
  2: { label: "High", color: "#f97316" },
  3: { label: "Medium", color: "#f59e0b" },
  4: { label: "Low", color: "#10b981" },
  5: { label: "Minimal", color: "#6b7280" },
};

const URGENCY_COLOR = (score: number): string =>
  score >= 4 ? "#ef4444" : score >= 3 ? "#f59e0b" : "#10b981";

const AGENT_CHARACTERS: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.name, a.character]),
);

// ── Types ───────────────────────────────────────────────────────────────

interface TriageData {
  readonly id: string;
  readonly classification: {
    readonly type: string;
    readonly subtype?: string;
  };
  readonly urgency_score: number;
  readonly urgency_reasoning: string;
  readonly recommended_priority: number;
  readonly recommended_team: string | null;
  readonly recommended_agent: string | null;
  readonly security_flag: boolean;
  readonly security_notes: string | null;
  readonly findings: Record<
    string,
    { readonly summary: string; readonly confidence: number; readonly data?: Record<string, unknown> }
  >;
  readonly suggested_response: string | null;
  readonly internal_notes: string;
  readonly processing_time_ms: number | null;
  readonly created_at: string;
  readonly triage_type?: string;
}

interface AgentLog {
  readonly agent_name: string;
  readonly agent_role: string;
  readonly status: string;
  readonly output_summary: string | null;
  readonly tokens_used: number | null;
  readonly duration_ms: number | null;
}

// ── Page Component ──────────────────────────────────────────────────────

export default async function EmbedTriagePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const haloId = params.halo_id;
  const token = params.token;

  // Validate embed token
  const embedSecret = process.env.EMBED_SECRET;
  if (embedSecret && token !== embedSecret) {
    return <ErrorState message="Unauthorized — invalid embed token." />;
  }

  if (!haloId || isNaN(Number(haloId))) {
    return <ErrorState message="Missing or invalid halo_id parameter." />;
  }

  const supabase = await createServiceClient();

  // Fetch ticket by halo_id
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, user_name, status")
    .eq("halo_id", Number(haloId))
    .single();

  if (!ticket) {
    return (
      <EmptyState
        message={`No triage data found for Halo ticket #${haloId}. This ticket hasn't been triaged by TriageIt yet.`}
      />
    );
  }

  // Fetch ALL triage results (not just latest) for history
  const { data: allTriageResults } = await supabase
    .from("triage_results")
    .select("*")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: false });

  const triageResults = (allTriageResults ?? []) as ReadonlyArray<TriageData>;

  if (triageResults.length === 0) {
    return (
      <EmptyState
        message={`Ticket #${haloId} is ${ticket.status === "triaging" ? "currently being triaged..." : "queued for triage."}${ticket.status === "triaging" ? " Refresh in a moment." : ""}`}
        status={ticket.status}
      />
    );
  }

  // Latest is the first item (sorted desc)
  const latest = triageResults[0];
  const history = triageResults.slice(1);

  // Fetch agent logs for latest triage
  const { data: agentLogs } = await supabase
    .from("agent_logs")
    .select("agent_name, agent_role, status, output_summary, tokens_used, duration_ms")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });

  return (
    <div style={styles.container}>
      <SpinnerStyles />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>TriageIt</span>
          {ticket.client_name && (
            <span style={styles.headerChip}>{ticket.client_name}</span>
          )}
        </div>
        <div style={styles.headerRight}>
          {latest.security_flag && (
            <span style={styles.securityBadge}>SECURITY</span>
          )}
          {latest.triage_type === "retriage" && (
            <span style={styles.retriageBadge}>RE-TRIAGE</span>
          )}
        </div>
      </div>

      {/* ── At-a-Glance Row ─────────────────────────────────────── */}
      <AtAGlanceRow triage={latest} />

      {/* ── Quick Actions ───────────────────────────────────────── */}
      <div style={styles.actionsBar}>
        <QuickActions
          ticketId={ticket.id}
          suggestedResponse={latest.suggested_response}
          internalNotes={latest.internal_notes}
        />
        <span style={styles.timestamp}>
          {formatTimestamp(latest.created_at)}
        </span>
      </div>

      {/* ── Security Alert ──────────────────────────────────────── */}
      {latest.security_flag && latest.security_notes && (
        <div style={styles.securityAlert}>
          <div style={styles.securityAlertHeader}>SECURITY ALERT</div>
          <p style={styles.bodyText}>{latest.security_notes}</p>
        </div>
      )}

      {/* ── Urgency Analysis ────────────────────────────────────── */}
      <Section title="Urgency Analysis">
        <p style={styles.bodyText}>{latest.urgency_reasoning}</p>
      </Section>

      {/* ── Suggested Response (collapsible) ─────────────────────── */}
      {latest.suggested_response && (
        <CollapsibleSection
          title="Suggested Customer Response"
          accent="#06b6d4"
          defaultOpen
        >
          <p style={styles.responseText}>{latest.suggested_response}</p>
        </CollapsibleSection>
      )}

      {/* ── Internal Notes (collapsible) ─────────────────────────── */}
      {latest.internal_notes && (
        <CollapsibleSection title="Internal Notes" accent="#a78bfa" defaultOpen>
          <p style={styles.bodyText}>{latest.internal_notes}</p>
        </CollapsibleSection>
      )}

      {/* ── Agent Findings (collapsible) ─────────────────────────── */}
      {Object.keys(latest.findings).length > 0 && (
        <CollapsibleSection
          title="Agent Findings"
          badge={`${Object.keys(latest.findings).length} agents`}
        >
          <div style={styles.findingsGrid}>
            {Object.entries(latest.findings).map(([agentName, finding]) => (
              <FindingCard
                key={agentName}
                agentName={agentName}
                summary={finding.summary}
                confidence={finding.confidence}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Agent Activity (collapsible) ─────────────────────────── */}
      {(agentLogs ?? []).length > 0 && (
        <CollapsibleSection
          title="Agent Activity"
          badge={`${(agentLogs ?? []).filter((l) => l.status === "completed").length}/${(agentLogs ?? []).length}`}
        >
          <div style={styles.agentLogList}>
            {(agentLogs ?? []).map((log, i) => (
              <AgentLogRow key={i} log={log as AgentLog} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Triage History ──────────────────────────────────────── */}
      {history.length > 0 && (
        <CollapsibleSection
          title="Triage History"
          accent="#f59e0b"
          badge={`${history.length} previous`}
        >
          <div style={styles.historyList}>
            {history.map((triage) => (
              <HistoryCard key={triage.id} triage={triage} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div style={styles.footer}>
        <span>
          {latest.processing_time_ms
            ? `${(latest.processing_time_ms / 1000).toFixed(1)}s`
            : "N/A"}
        </span>
        <span style={styles.footerDot} />
        <span>
          {(agentLogs ?? []).filter((l) => l.status === "completed").length} agents
        </span>
        <span style={styles.footerDot} />
        <span>
          {(agentLogs ?? []).reduce((sum, l) => sum + (l.tokens_used ?? 0), 0).toLocaleString()} tokens
        </span>
      </div>
    </div>
  );
}

// ── Sub Components ──────────────────────────────────────────────────────

function AtAGlanceRow({ triage }: { readonly triage: TriageData }) {
  const priority = PRIORITY_LABELS[triage.recommended_priority] ?? {
    label: `P${triage.recommended_priority}`,
    color: "#6b7280",
  };
  const classification = triage.classification;

  return (
    <div style={styles.glanceRow}>
      {/* Priority — most prominent */}
      <div style={styles.glanceCard}>
        <span style={styles.glanceLabel}>Priority</span>
        <span
          style={{
            ...styles.glancePriorityValue,
            color: priority.color,
          }}
        >
          {priority.label}
        </span>
      </div>

      {/* Urgency */}
      <div style={styles.glanceCard}>
        <span style={styles.glanceLabel}>Urgency</span>
        <span
          style={{
            ...styles.glanceValue,
            color: URGENCY_COLOR(triage.urgency_score),
          }}
        >
          {triage.urgency_score}/5
        </span>
      </div>

      {/* Classification */}
      <div style={styles.glanceCard}>
        <span style={styles.glanceLabel}>Type</span>
        <span style={styles.glanceValue}>
          {classification.type}
        </span>
        {classification.subtype && (
          <span style={styles.glanceSub}>{classification.subtype}</span>
        )}
      </div>

      {/* Team */}
      {triage.recommended_team && (
        <div style={styles.glanceCard}>
          <span style={styles.glanceLabel}>Team</span>
          <span style={styles.glanceValue}>{triage.recommended_team}</span>
        </div>
      )}

      {/* Assign To */}
      {triage.recommended_agent && (
        <div style={styles.glanceCard}>
          <span style={styles.glanceLabel}>Assign To</span>
          <span style={styles.glanceValue}>{triage.recommended_agent}</span>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function FindingCard({
  agentName,
  summary,
  confidence,
}: {
  readonly agentName: string;
  readonly summary: string;
  readonly confidence: number;
}) {
  const character = AGENT_CHARACTERS[agentName] ?? agentName;
  const pct = Math.round(confidence * 100);

  return (
    <div style={styles.findingCard}>
      <div style={styles.findingHeader}>
        <span style={styles.findingAgent}>{character}</span>
        <span
          style={{
            ...styles.findingConfidence,
            color: pct >= 80 ? "#10b981" : pct >= 60 ? "#f59e0b" : "#71717a",
          }}
        >
          {pct}% confidence
        </span>
      </div>
      <p style={styles.findingText}>{summary}</p>
    </div>
  );
}

function AgentLogRow({ log }: { readonly log: AgentLog }) {
  const character = AGENT_CHARACTERS[log.agent_name] ?? log.agent_name;
  const statusStyles: Record<string, { icon: string; color: string }> = {
    completed: { icon: "\u2713", color: "#10b981" },
    error: { icon: "\u2717", color: "#ef4444" },
    skipped: { icon: "\u2192", color: "#71717a" },
  };
  const s = statusStyles[log.status] ?? { icon: "\u2026", color: "#f59e0b" };

  return (
    <div style={styles.agentLogRow}>
      <span style={{ ...styles.agentLogIcon, color: s.color }}>{s.icon}</span>
      <span style={styles.agentLogName}>{character}</span>
      <span style={styles.agentLogRole}>{log.agent_role}</span>
      {log.duration_ms != null && (
        <span style={styles.agentLogDuration}>
          {(log.duration_ms / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

function HistoryCard({ triage }: { readonly triage: TriageData }) {
  const priority = PRIORITY_LABELS[triage.recommended_priority] ?? {
    label: `P${triage.recommended_priority}`,
    color: "#6b7280",
  };

  return (
    <div style={styles.historyCard}>
      <div style={styles.historyCardHeader}>
        <span style={styles.historyTimestamp}>
          {formatTimestamp(triage.created_at)}
        </span>
        {triage.triage_type === "retriage" && (
          <span style={styles.historyRetriageBadge}>re-triage</span>
        )}
        <span
          style={{
            ...styles.historyPriority,
            color: priority.color,
          }}
        >
          {priority.label}
        </span>
        <span
          style={{
            ...styles.historyUrgency,
            color: URGENCY_COLOR(triage.urgency_score),
          }}
        >
          U{triage.urgency_score}
        </span>
      </div>
      <div style={styles.historyCardBody}>
        <div style={styles.historyRow}>
          <span style={styles.historyLabel}>Type</span>
          <span style={styles.historyValue}>
            {triage.classification.type}
            {triage.classification.subtype ? ` / ${triage.classification.subtype}` : ""}
          </span>
        </div>
        {triage.recommended_team && (
          <div style={styles.historyRow}>
            <span style={styles.historyLabel}>Team</span>
            <span style={styles.historyValue}>{triage.recommended_team}</span>
          </div>
        )}
        <div style={styles.historyRow}>
          <span style={styles.historyLabel}>Reasoning</span>
          <span style={styles.historyValue}>{triage.urgency_reasoning}</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  message,
  status,
}: {
  readonly message: string;
  readonly status?: string;
}) {
  return (
    <div style={styles.container}>
      <div style={styles.emptyState}>
        <div style={{ fontSize: "28px", opacity: 0.6 }}>
          {status === "triaging" ? "\u23F3" : "\u2014"}
        </div>
        <p style={styles.emptyText}>{message}</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { readonly message: string }) {
  return (
    <div style={styles.container}>
      <div style={styles.emptyState}>
        <p style={{ ...styles.emptyText, color: "#ef4444" }}>{message}</p>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Inline Styles ───────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    backgroundColor: "#09090b",
    color: "#fafafa",
    minHeight: "100vh",
    padding: "14px 18px",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  // Header
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
    paddingBottom: "10px",
    borderBottom: "1px solid #1e1e22",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  logo: {
    fontSize: "14px",
    fontWeight: 800,
    color: "#6366f1",
    letterSpacing: "-0.02em",
  },
  headerChip: {
    fontSize: "11px",
    color: "#a1a1aa",
    fontWeight: 500,
    padding: "2px 8px",
    backgroundColor: "#18181b",
    borderRadius: "4px",
    border: "1px solid #27272a",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  securityBadge: {
    fontSize: "10px",
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: "4px",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    color: "#ef4444",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    letterSpacing: "0.05em",
  },
  retriageBadge: {
    fontSize: "10px",
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: "4px",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    color: "#f59e0b",
    border: "1px solid rgba(245, 158, 11, 0.3)",
    letterSpacing: "0.05em",
  },

  // At-a-glance row
  glanceRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "12px",
    flexWrap: "wrap" as const,
  },
  glanceCard: {
    flex: "1 1 0",
    minWidth: "90px",
    backgroundColor: "#111113",
    border: "1px solid #1e1e22",
    borderRadius: "8px",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
  },
  glanceLabel: {
    fontSize: "9px",
    fontWeight: 600,
    color: "#52525b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  glancePriorityValue: {
    fontSize: "18px",
    fontWeight: 800,
    textTransform: "capitalize" as const,
    lineHeight: 1.2,
  },
  glanceValue: {
    fontSize: "14px",
    fontWeight: 700,
    textTransform: "capitalize" as const,
    color: "#fafafa",
  },
  glanceSub: {
    fontSize: "11px",
    color: "#71717a",
    textTransform: "capitalize" as const,
  },

  // Actions bar
  actionsBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
    padding: "8px 12px",
    backgroundColor: "#111113",
    border: "1px solid #1e1e22",
    borderRadius: "8px",
  },
  timestamp: {
    fontSize: "11px",
    color: "#52525b",
    whiteSpace: "nowrap" as const,
  },

  // Security alert
  securityAlert: {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    borderLeft: "3px solid #ef4444",
    borderRadius: "8px",
    padding: "12px 14px",
    marginBottom: "10px",
  },
  securityAlertHeader: {
    fontSize: "10px",
    fontWeight: 700,
    color: "#ef4444",
    letterSpacing: "0.08em",
    marginBottom: "6px",
  },

  // Section (non-collapsible)
  section: {
    backgroundColor: "#111113",
    border: "1px solid #1e1e22",
    borderLeft: "3px solid #6366f1",
    borderRadius: "8px",
    padding: "12px 14px",
    marginBottom: "10px",
  },
  sectionTitle: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#a1a1aa",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "6px",
  },

  // Text
  bodyText: {
    color: "#d4d4d8",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    fontSize: "12px",
    lineHeight: 1.6,
  },
  responseText: {
    color: "#67e8f9",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    fontSize: "12px",
    lineHeight: 1.6,
  },

  // Findings
  findingsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  findingCard: {
    backgroundColor: "#18181b",
    borderRadius: "6px",
    padding: "8px 10px",
    border: "1px solid #27272a",
  },
  findingHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "4px",
  },
  findingAgent: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#a78bfa",
  },
  findingConfidence: {
    fontSize: "10px",
    fontWeight: 600,
  },
  findingText: {
    color: "#d4d4d8",
    margin: 0,
    fontSize: "11px",
    lineHeight: 1.5,
  },

  // Agent logs
  agentLogList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
  },
  agentLogRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "3px 0",
    fontSize: "12px",
  },
  agentLogIcon: {
    fontSize: "11px",
    width: "16px",
    textAlign: "center" as const,
    fontWeight: 700,
  },
  agentLogName: {
    fontWeight: 600,
    color: "#fafafa",
    minWidth: "110px",
    fontSize: "11px",
  },
  agentLogRole: {
    color: "#52525b",
    flex: 1,
    fontSize: "11px",
  },
  agentLogDuration: {
    color: "#52525b",
    fontSize: "10px",
    fontFamily: "monospace",
  },

  // History
  historyList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  historyCard: {
    backgroundColor: "#18181b",
    border: "1px solid #27272a",
    borderRadius: "6px",
    overflow: "hidden",
  },
  historyCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    backgroundColor: "#1a1a1e",
    borderBottom: "1px solid #27272a",
  },
  historyTimestamp: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#a1a1aa",
    flex: 1,
  },
  historyRetriageBadge: {
    fontSize: "9px",
    fontWeight: 600,
    padding: "1px 5px",
    borderRadius: "3px",
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    color: "#f59e0b",
    border: "1px solid rgba(245, 158, 11, 0.2)",
  },
  historyPriority: {
    fontSize: "11px",
    fontWeight: 700,
  },
  historyUrgency: {
    fontSize: "11px",
    fontWeight: 600,
  },
  historyCardBody: {
    padding: "8px 10px",
  },
  historyRow: {
    display: "flex",
    gap: "8px",
    padding: "2px 0",
    fontSize: "11px",
  },
  historyLabel: {
    color: "#52525b",
    fontWeight: 600,
    minWidth: "60px",
    flexShrink: 0,
  },
  historyValue: {
    color: "#a1a1aa",
    flex: 1,
  },

  // Footer
  footer: {
    display: "flex",
    gap: "8px",
    justifyContent: "center",
    alignItems: "center",
    color: "#3f3f46",
    fontSize: "10px",
    marginTop: "14px",
    paddingTop: "10px",
    borderTop: "1px solid #1e1e22",
  },
  footerDot: {
    width: "3px",
    height: "3px",
    borderRadius: "50%",
    backgroundColor: "#3f3f46",
  },

  // Empty / Error states
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "200px",
    gap: "12px",
  },
  emptyText: {
    color: "#52525b",
    textAlign: "center" as const,
    maxWidth: "360px",
    fontSize: "13px",
    lineHeight: 1.5,
  },
};
