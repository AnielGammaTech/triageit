import { createServiceClient } from "@/lib/supabase/server";
import { AGENTS } from "@triageit/shared";

/**
 * Embeddable Triage Tab — loaded inside Halo PSA as a custom web tab.
 *
 * URL format: /embed/triage?halo_id={id}&token={EMBED_SECRET}
 * Halo replaces {id} with the ticket's Halo ID automatically.
 */

// Priority label mapping
const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Critical", color: "#ef4444" },
  2: { label: "High", color: "#f97316" },
  3: { label: "Medium", color: "#f59e0b" },
  4: { label: "Low", color: "#10b981" },
  5: { label: "Minimal", color: "#6b7280" },
};

// Agent name → display character
const AGENT_CHARACTERS: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.name, a.character]),
);

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
}

interface AgentLog {
  readonly agent_name: string;
  readonly agent_role: string;
  readonly status: string;
  readonly output_summary: string | null;
  readonly tokens_used: number | null;
  readonly duration_ms: number | null;
}

interface TicketData {
  readonly id: string;
  readonly halo_id: number;
  readonly summary: string;
  readonly client_name: string | null;
  readonly user_name: string | null;
  readonly status: string;
}

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
      <EmptyState message={`No triage data found for Halo ticket #${haloId}. This ticket hasn't been triaged by TriageIt yet.`} />
    );
  }

  // Fetch latest triage result
  const { data: triage } = await supabase
    .from("triage_results")
    .select("*")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!triage) {
    return (
      <EmptyState
        message={`Ticket #${haloId} is ${ticket.status === "triaging" ? "currently being triaged..." : "queued for triage."}${ticket.status === "triaging" ? " Refresh in a moment." : ""}`}
        status={ticket.status}
      />
    );
  }

  // Fetch agent logs
  const { data: agentLogs } = await supabase
    .from("agent_logs")
    .select("agent_name, agent_role, status, output_summary, tokens_used, duration_ms")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true });

  return (
    <TriageEmbed
      ticket={ticket as TicketData}
      triage={triage as TriageData}
      agentLogs={(agentLogs ?? []) as ReadonlyArray<AgentLog>}
    />
  );
}

// ── Main Triage Embed Component ────────────────────────────────────────

function TriageEmbed({
  ticket,
  triage,
  agentLogs,
}: {
  readonly ticket: TicketData;
  readonly triage: TriageData;
  readonly agentLogs: ReadonlyArray<AgentLog>;
}) {
  const priority = PRIORITY_LABELS[triage.recommended_priority] ?? {
    label: `P${triage.recommended_priority}`,
    color: "#6b7280",
  };
  const classification = triage.classification;
  const triageDate = new Date(triage.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logo}>🤖 TriageIt</span>
          {ticket.client_name && (
            <span style={styles.headerClient}>{ticket.client_name}</span>
          )}
          <span style={styles.headerDate}>{triageDate}</span>
        </div>
        <div style={styles.headerRight}>
          {triage.security_flag && (
            <span style={styles.securityBadge}>🔒 Security</span>
          )}
          <span style={{ ...styles.priorityBadge, backgroundColor: priority.color }}>
            {priority.label}
          </span>
        </div>
      </div>

      {/* Classification & Priority Row */}
      <div style={styles.statsRow}>
        <StatCard
          label="Classification"
          value={classification.type}
          subvalue={classification.subtype}
        />
        <StatCard
          label="Urgency"
          value={`${triage.urgency_score}/5`}
          color={triage.urgency_score >= 4 ? "#ef4444" : triage.urgency_score >= 3 ? "#f59e0b" : "#10b981"}
        />
        <StatCard label="Priority" value={priority.label} color={priority.color} />
        {triage.recommended_team && (
          <StatCard label="Team" value={triage.recommended_team} />
        )}
        {triage.recommended_agent && (
          <StatCard label="Assign To" value={triage.recommended_agent} />
        )}
      </div>

      {/* Urgency Reasoning */}
      <Section title="Urgency Analysis">
        <p style={styles.text}>{triage.urgency_reasoning}</p>
      </Section>

      {/* Security Alert */}
      {triage.security_flag && triage.security_notes && (
        <Section title="🔒 Security Alert" accent="#ef4444">
          <p style={styles.text}>{triage.security_notes}</p>
        </Section>
      )}

      {/* Agent Findings */}
      {Object.keys(triage.findings).length > 0 && (
        <Section title="Agent Findings">
          <div style={styles.findingsGrid}>
            {Object.entries(triage.findings).map(([agentName, finding]) => (
              <FindingCard
                key={agentName}
                agentName={agentName}
                summary={finding.summary}
                confidence={finding.confidence}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Suggested Customer Response */}
      {triage.suggested_response && (
        <Section title="💬 Suggested Customer Response" accent="#06b6d4">
          <p style={styles.responseText}>{triage.suggested_response}</p>
        </Section>
      )}

      {/* Internal Notes */}
      {triage.internal_notes && (
        <Section title="📝 Internal Notes">
          <p style={styles.text}>{triage.internal_notes}</p>
        </Section>
      )}

      {/* Agent Activity */}
      {agentLogs.length > 0 && (
        <Section title="Agent Activity">
          <div style={styles.agentLogList}>
            {agentLogs.map((log, i) => (
              <AgentLogRow key={i} log={log} />
            ))}
          </div>
        </Section>
      )}

      {/* Footer */}
      <div style={styles.footer}>
        <span>
          Processed in {triage.processing_time_ms ? `${(triage.processing_time_ms / 1000).toFixed(1)}s` : "N/A"}
        </span>
        <span>•</span>
        <span>
          {agentLogs.filter((l) => l.status === "completed").length} agents ran
        </span>
        <span>•</span>
        <span>
          {agentLogs.reduce((sum, l) => sum + (l.tokens_used ?? 0), 0).toLocaleString()} tokens
        </span>
      </div>
    </div>
  );
}

// ── Sub Components ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subvalue,
  color,
}: {
  readonly label: string;
  readonly value: string;
  readonly subvalue?: string;
  readonly color?: string;
}) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statLabel}>{label}</span>
      <span style={{ ...styles.statValue, color: color ?? "#fafafa" }}>
        {value}
      </span>
      {subvalue && <span style={styles.statSub}>{subvalue}</span>}
    </div>
  );
}

function Section({
  title,
  accent,
  children,
}: {
  readonly title: string;
  readonly accent?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div style={{ ...styles.section, borderLeftColor: accent ?? "#6366f1" }}>
      <h3 style={styles.sectionTitle}>{title}</h3>
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

  return (
    <div style={styles.findingCard}>
      <div style={styles.findingHeader}>
        <span style={styles.findingAgent}>{character}</span>
        <span style={styles.findingConfidence}>
          {Math.round(confidence * 100)}%
        </span>
      </div>
      <p style={styles.findingText}>{summary}</p>
    </div>
  );
}

function AgentLogRow({ log }: { readonly log: AgentLog }) {
  const character = AGENT_CHARACTERS[log.agent_name] ?? log.agent_name;
  const statusIcon =
    log.status === "completed" ? "✅" : log.status === "error" ? "❌" : log.status === "skipped" ? "⏭️" : "⏳";

  return (
    <div style={styles.agentLogRow}>
      <span style={styles.agentLogIcon}>{statusIcon}</span>
      <span style={styles.agentLogName}>{character}</span>
      <span style={styles.agentLogRole}>{log.agent_role}</span>
      {log.duration_ms && (
        <span style={styles.agentLogDuration}>
          {(log.duration_ms / 1000).toFixed(1)}s
        </span>
      )}
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
        <span style={{ fontSize: "32px" }}>
          {status === "triaging" ? "⏳" : "📋"}
        </span>
        <p style={styles.emptyText}>{message}</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { readonly message: string }) {
  return (
    <div style={styles.container}>
      <div style={styles.emptyState}>
        <span style={{ fontSize: "32px" }}>⚠️</span>
        <p style={{ ...styles.emptyText, color: "#ef4444" }}>{message}</p>
      </div>
    </div>
  );
}

// ── Inline Styles (no Tailwind in iframe) ──────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    backgroundColor: "#09090b",
    color: "#fafafa",
    minHeight: "100vh",
    padding: "16px 20px",
    fontSize: "13px",
    lineHeight: "1.5",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
    paddingBottom: "12px",
    borderBottom: "1px solid #1e1e22",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logo: {
    fontSize: "15px",
    fontWeight: 700,
    color: "#6366f1",
  },
  headerClient: {
    fontSize: "12px",
    color: "#a1a1aa",
    fontWeight: 500,
  },
  headerDate: {
    fontSize: "12px",
    color: "#71717a",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  securityBadge: {
    fontSize: "11px",
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: "4px",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    color: "#ef4444",
    border: "1px solid rgba(239, 68, 68, 0.3)",
  },
  priorityBadge: {
    fontSize: "11px",
    fontWeight: 700,
    padding: "2px 10px",
    borderRadius: "4px",
    color: "#fff",
  },
  statsRow: {
    display: "flex",
    gap: "10px",
    marginBottom: "16px",
    flexWrap: "wrap" as const,
  },
  statCard: {
    flex: "1 1 0",
    minWidth: "100px",
    backgroundColor: "#111113",
    border: "1px solid #1e1e22",
    borderRadius: "8px",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
  },
  statLabel: {
    fontSize: "10px",
    fontWeight: 500,
    color: "#71717a",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  statValue: {
    fontSize: "15px",
    fontWeight: 700,
    textTransform: "capitalize" as const,
  },
  statSub: {
    fontSize: "11px",
    color: "#a1a1aa",
    textTransform: "capitalize" as const,
  },
  section: {
    backgroundColor: "#111113",
    border: "1px solid #1e1e22",
    borderLeft: "3px solid #6366f1",
    borderRadius: "8px",
    padding: "12px 16px",
    marginBottom: "12px",
  },
  sectionTitle: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#a1a1aa",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "8px",
  },
  text: {
    color: "#d4d4d8",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
  },
  responseText: {
    color: "#67e8f9",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    fontStyle: "italic" as const,
  },
  findingsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  findingCard: {
    backgroundColor: "#18181b",
    borderRadius: "6px",
    padding: "10px 12px",
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
    fontSize: "11px",
    color: "#71717a",
  },
  findingText: {
    color: "#d4d4d8",
    margin: 0,
    fontSize: "12px",
  },
  agentLogList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  },
  agentLogRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 0",
    fontSize: "12px",
  },
  agentLogIcon: {
    fontSize: "12px",
    width: "18px",
    textAlign: "center" as const,
  },
  agentLogName: {
    fontWeight: 600,
    color: "#fafafa",
    minWidth: "120px",
  },
  agentLogRole: {
    color: "#71717a",
    flex: 1,
  },
  agentLogDuration: {
    color: "#71717a",
    fontSize: "11px",
  },
  footer: {
    display: "flex",
    gap: "8px",
    justifyContent: "center",
    color: "#52525b",
    fontSize: "11px",
    marginTop: "16px",
    paddingTop: "12px",
    borderTop: "1px solid #1e1e22",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "200px",
    gap: "12px",
  },
  emptyText: {
    color: "#71717a",
    textAlign: "center" as const,
    maxWidth: "360px",
  },
};
