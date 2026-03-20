import { createServiceClient } from "@/lib/supabase/server";
import { AGENTS } from "@triageit/shared";
import { QuickActions, CollapsibleSection, SpinnerStyles, EmbedTriageButton, AutoRefresh } from "./actions";

/**
 * Embeddable Triage Tab — loaded inside Halo PSA as a custom web tab.
 *
 * URL format: /embed/triage?halo_id=$FAULTID&token={EMBED_SECRET}
 * Halo replaces $FAULTID with the ticket's Halo ID automatically.
 *
 * Shows:
 * 1. Latest triage summary (priority, urgency, type, team)
 * 2. Quick actions (Copy Response, Copy Notes, SummarizeIT, Re-Triage)
 * 3. All TriageIt notes posted to the ticket (in chronological order)
 * 4. Agent activity and triage history
 */

// ── Constants ───────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: "Critical", color: "#fca5a5", bg: "linear-gradient(135deg, #991b1b, #7f1d1d)" },
  2: { label: "High", color: "#fdba74", bg: "linear-gradient(135deg, #9a3412, #7c2d12)" },
  3: { label: "Medium", color: "#fcd34d", bg: "linear-gradient(135deg, #92400e, #78350f)" },
  4: { label: "Low", color: "#6ee7b7", bg: "linear-gradient(135deg, #065f46, #064e3b)" },
  5: { label: "Minimal", color: "#a1a1aa", bg: "linear-gradient(135deg, #3f3f46, #27272a)" },
};

const URGENCY_COLOR = (score: number): string =>
  score >= 4 ? "#f87171" : score >= 3 ? "#fbbf24" : "#34d399";

const AGENT_CHARACTERS: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.name, a.character]),
);

const NOTE_TYPE_CONFIG: Record<string, { label: string; accent: string; icon: string }> = {
  triage: { label: "AI Triage", accent: "#6366f1", icon: "🔍" },
  retriage: { label: "Re-Triage", accent: "#f59e0b", icon: "🔄" },
  "tech-review": { label: "Tech Review", accent: "#10b981", icon: "📋" },
  alert: { label: "Alert", accent: "#ef4444", icon: "🚨" },
  priority: { label: "Priority", accent: "#8b5cf6", icon: "⚡" },
  documentation: { label: "Documentation", accent: "#06b6d4", icon: "📝" },
  other: { label: "Note", accent: "#64748b", icon: "💬" },
};

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

interface HaloAction {
  readonly id: number;
  readonly note: string;
  readonly hiddenfromuser: boolean;
  readonly who?: string;
  readonly datecreated?: string;
}

interface TriageItNote {
  readonly id: number;
  readonly html: string;
  readonly date: string;
  readonly type: string;
}

// ── Halo Note Helpers ──────────────────────────────────────────────────

function isTriageItNote(action: HaloAction): boolean {
  const note = action.note ?? "";
  return (
    note.includes("TriageIt") ||
    note.includes("TriageIt AI") ||
    note.includes("AI Triage") ||
    note.includes("triageit") ||
    note.includes("linear-gradient(135deg,#6366f1") ||
    note.includes("linear-gradient(135deg,#4f46e5") ||
    note.includes("linear-gradient(135deg,#059669")
  );
}

function classifyNote(html: string): string {
  if (html.includes("Tech Performance Review")) return "tech-review";
  if (html.includes("Retriage Check") || html.includes("Re-Triage")) return "retriage";
  if (html.includes("alert path") || html.includes("Alert Path")) return "alert";
  if (html.includes("Priority Recommendation")) return "priority";
  if (html.includes("Documentation Gap")) return "documentation";
  if (html.includes("AI Triage")) return "triage";
  return "other";
}

interface HaloConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

async function fetchTriageItNotes(
  config: HaloConfig,
  haloId: number,
): Promise<ReadonlyArray<TriageItNote>> {
  try {
    // Get Halo token
    const tokenUrl = `${config.base_url}/auth/token`;
    const tokenBody = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.client_id,
      client_secret: config.client_secret,
      scope: "all",
    });
    if (config.tenant) tokenBody.set("tenant", config.tenant);

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) return [];
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Fetch all actions for this ticket
    const actionsRes = await fetch(
      `${config.base_url}/api/actions?ticket_id=${haloId}&excludesys=true`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!actionsRes.ok) return [];
    const data = (await actionsRes.json()) as { actions: HaloAction[] };
    const actions = data.actions ?? [];

    // Filter to TriageIt notes and sort chronologically (oldest first)
    return actions
      .filter(isTriageItNote)
      .sort(
        (a, b) =>
          new Date(a.datecreated ?? "").getTime() -
          new Date(b.datecreated ?? "").getTime(),
      )
      .map((a) => ({
        id: a.id,
        html: a.note,
        date: a.datecreated ?? "",
        type: classifyNote(a.note),
      }));
  } catch (err) {
    console.error("[EMBED] Failed to fetch TriageIt notes:", err);
    return [];
  }
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

  // Embed token is REQUIRED — fail-safe if EMBED_SECRET is not configured
  const embedSecret = process.env.EMBED_SECRET;
  if (!embedSecret || token !== embedSecret) {
    return <ErrorState message="Unauthorized — invalid or missing embed token." />;
  }

  if (!haloId || isNaN(Number(haloId))) {
    return <ErrorState message="Missing or invalid halo_id parameter." />;
  }

  const supabase = await createServiceClient();

  // Fetch Halo integration config (needed for notes)
  const { data: haloIntegration } = await supabase
    .from("integrations")
    .select("config")
    .eq("service", "halo")
    .eq("is_active", true)
    .single();

  const haloConfig = haloIntegration?.config as HaloConfig | null;

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, halo_id, summary, client_name, user_name, status")
    .eq("halo_id", Number(haloId))
    .single();

  if (!ticket) {
    return (
      <div style={s.page}>
        <SpinnerStyles />
        <div style={s.emptyWrap}>
          <div style={s.emptyIcon}>{"\u2014"}</div>
          <p style={s.emptyText}>
            No triage data found for Halo ticket #{haloId}.
          </p>
          <EmbedTriageButton haloId={Number(haloId)} token={embedSecret} />
        </div>
      </div>
    );
  }

  // Fetch triage results, agent logs, and TriageIt notes in parallel
  const [triageResultsRes, agentLogsRes, triageItNotes] = await Promise.all([
    supabase
      .from("triage_results")
      .select("*")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_logs")
      .select("agent_name, agent_role, status, output_summary, tokens_used, duration_ms")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true }),
    haloConfig ? fetchTriageItNotes(haloConfig, ticket.halo_id) : Promise.resolve([]),
  ]);

  const triageResults = (triageResultsRes.data ?? []) as ReadonlyArray<TriageData>;
  const logs = (agentLogsRes.data ?? []) as ReadonlyArray<AgentLog>;

  if (triageResults.length === 0) {
    return (
      <div style={s.page}>
        <SpinnerStyles />
        <div style={s.emptyWrap}>
          <div style={{ ...s.emptyIcon, color: ticket.status === "triaging" ? "#6366f1" : "#52525b" }}>
            {ticket.status === "triaging" ? "\u23F3" : "\u2014"}
          </div>
          <p style={s.emptyText}>
            {ticket.status === "triaging"
              ? "Currently being triaged..."
              : "Queued for triage."}
          </p>
          {ticket.status === "triaging" ? (
            <AutoRefresh />
          ) : (
            <EmbedTriageButton haloId={ticket.halo_id} token={embedSecret} />
          )}
        </div>
      </div>
    );
  }

  const latest = triageResults[0];
  const priority = PRIORITY_CONFIG[latest.recommended_priority] ?? {
    label: `P${latest.recommended_priority}`,
    color: "#a1a1aa",
    bg: "linear-gradient(135deg, #3f3f46, #27272a)",
  };

  return (
    <div style={s.page}>
      <SpinnerStyles />

      {/* ── Header Bar ──────────────────────────────────────── */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.logoMark}>T</div>
          <div>
            <div style={s.headerTitle}>TriageIt</div>
            {ticket.client_name && (
              <div style={s.headerClient}>{ticket.client_name}</div>
            )}
          </div>
        </div>
        <div style={s.headerRight}>
          {latest.security_flag && <span style={s.badgeSecurity}>SECURITY</span>}
          {latest.triage_type === "retriage" && <span style={s.badgeRetriage}>RE-TRIAGE</span>}
          <span style={s.headerTime}>{formatTimestamp(latest.created_at)}</span>
        </div>
      </div>

      {/* ── Priority Hero ───────────────────────────────────── */}
      <div style={{ ...s.heroRow, gap: "10px" }}>
        <div style={{ ...s.heroCard, background: priority.bg, flex: "1.5 1 0" }}>
          <span style={s.heroLabel}>PRIORITY</span>
          <span style={{ ...s.heroValue, color: priority.color, fontSize: "22px" }}>
            {priority.label}
          </span>
        </div>
        <div style={s.heroCard}>
          <span style={s.heroLabel}>URGENCY</span>
          <span style={{ ...s.heroValue, color: URGENCY_COLOR(latest.urgency_score) }}>
            {latest.urgency_score}<span style={s.heroValueDim}>/5</span>
          </span>
        </div>
        <div style={s.heroCard}>
          <span style={s.heroLabel}>TYPE</span>
          <span style={s.heroValue}>{latest.classification.type}</span>
          {latest.classification.subtype && (
            <span style={s.heroSub}>{latest.classification.subtype}</span>
          )}
        </div>
        {latest.recommended_team && (
          <div style={s.heroCard}>
            <span style={s.heroLabel}>TEAM</span>
            <span style={s.heroValue}>{latest.recommended_team}</span>
          </div>
        )}
      </div>

      {/* ── Quick Actions ───────────────────────────────────── */}
      <div style={s.actionsRow}>
        <QuickActions
          ticketId={ticket.id}
          haloId={ticket.halo_id}
          suggestedResponse={latest.suggested_response}
          internalNotes={latest.internal_notes}
          token={embedSecret}
        />
      </div>

      {/* ── Security Alert ──────────────────────────────────── */}
      {latest.security_flag && latest.security_notes && (
        <div style={s.securityBox}>
          <div style={s.securityIcon}>!</div>
          <div>
            <div style={s.securityTitle}>Security Alert</div>
            <p style={s.bodyText}>{latest.security_notes}</p>
          </div>
        </div>
      )}

      {/* ── TriageIt Notes History ────────────────────────────── */}
      {triageItNotes.length > 0 && (
        <div style={s.notesSection}>
          <div style={s.notesSectionHeader}>
            <span style={s.notesSectionDot} />
            <span style={s.notesSectionTitle}>TriageIt Notes</span>
            <span style={s.notesSectionBadge}>{triageItNotes.length} notes</span>
          </div>
          <div style={s.notesList}>
            {triageItNotes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        </div>
      )}

      {/* ── Urgency Analysis ────────────────────────────────── */}
      <CollapsibleSection title="Urgency Analysis" accent="#6366f1" defaultOpen={triageItNotes.length === 0}>
        <p style={s.bodyText}>{latest.urgency_reasoning}</p>
      </CollapsibleSection>

      {/* ── Suggested Response ──────────────────────────────── */}
      {latest.suggested_response && (
        <CollapsibleSection title="Suggested Customer Response" accent="#06b6d4">
          <p style={s.responseText}>{latest.suggested_response}</p>
        </CollapsibleSection>
      )}

      {/* ── Internal Notes ──────────────────────────────────── */}
      {latest.internal_notes && (
        <CollapsibleSection title="Internal Notes" accent="#a78bfa">
          <p style={s.bodyText}>{latest.internal_notes}</p>
        </CollapsibleSection>
      )}

      {/* ── Agent Findings ──────────────────────────────────── */}
      {Object.keys(latest.findings).length > 0 && (
        <CollapsibleSection
          title="Agent Findings"
          badge={`${Object.keys(latest.findings).length} agents`}
        >
          <div style={s.findingsGrid}>
            {Object.entries(latest.findings).map(([name, finding]) => (
              <FindingCard key={name} agentName={name} summary={finding.summary} confidence={finding.confidence} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Agent Activity ──────────────────────────────────── */}
      {logs.length > 0 && (
        <CollapsibleSection
          title="Agent Activity"
          badge={`${logs.filter((l) => l.status === "completed").length}/${logs.length}`}
        >
          <div style={s.logList}>
            {logs.map((log, i) => (
              <AgentLogRow key={i} log={log} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Footer ──────────────────────────────────────────── */}
      <div style={s.footer}>
        {latest.processing_time_ms != null && (
          <span>{(latest.processing_time_ms / 1000).toFixed(1)}s</span>
        )}
        <span style={s.footerDot} />
        <span>{logs.filter((l) => l.status === "completed").length} agents</span>
        <span style={s.footerDot} />
        <span>{logs.reduce((sum, l) => sum + (l.tokens_used ?? 0), 0).toLocaleString()} tokens</span>
      </div>
    </div>
  );
}

// ── Sub Components ──────────────────────────────────────────────────────

function NoteCard({ note }: { readonly note: TriageItNote }) {
  const cfg = NOTE_TYPE_CONFIG[note.type] ?? NOTE_TYPE_CONFIG.other;

  return (
    <div style={s.noteCard}>
      <div style={s.noteCardHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px" }}>{cfg.icon}</span>
          <span style={{ ...s.noteCardType, color: cfg.accent }}>{cfg.label}</span>
        </div>
        <span style={s.noteCardDate}>{formatTimestamp(note.date)}</span>
      </div>
      <div
        style={s.noteCardBody}
        dangerouslySetInnerHTML={{ __html: note.html }}
      />
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
  const barColor = pct >= 80 ? "#34d399" : pct >= 60 ? "#fbbf24" : "#71717a";

  return (
    <div style={s.findingCard}>
      <div style={s.findingHeader}>
        <span style={s.findingAgent}>{character}</span>
        <span style={{ ...s.findingPct, color: barColor }}>{pct}%</span>
      </div>
      <div style={s.confidenceTrack}>
        <div style={{ ...s.confidenceBar, width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <p style={s.findingText}>{summary}</p>
    </div>
  );
}

function AgentLogRow({ log }: { readonly log: AgentLog }) {
  const character = AGENT_CHARACTERS[log.agent_name] ?? log.agent_name;
  const cfg: Record<string, { icon: string; color: string }> = {
    completed: { icon: "\u2713", color: "#34d399" },
    error: { icon: "\u2717", color: "#f87171" },
    skipped: { icon: "\u2192", color: "#71717a" },
  };
  const c = cfg[log.status] ?? { icon: "\u2026", color: "#fbbf24" };

  return (
    <div style={s.logRow}>
      <span style={{ ...s.logIcon, color: c.color, backgroundColor: `${c.color}15` }}>{c.icon}</span>
      <span style={s.logName}>{character}</span>
      <span style={s.logRole}>{log.agent_role}</span>
      {log.duration_ms != null && (
        <span style={s.logDuration}>{(log.duration_ms / 1000).toFixed(1)}s</span>
      )}
    </div>
  );
}

function ErrorState({ message }: { readonly message: string }) {
  return (
    <div style={s.page}>
      <SpinnerStyles />
      <div style={s.emptyWrap}>
        <div style={{ ...s.emptyIcon, color: "#f87171" }}>!</div>
        <p style={{ ...s.emptyText, color: "#f87171" }}>{message}</p>
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

// ── Styles ──────────────────────────────────────────────────────────────

const s = {
  page: {
    fontFamily: "'Inter', 'SF Pro Display', system-ui, -apple-system, sans-serif",
    backgroundColor: "#0a0a0c",
    color: "#fafafa",
    minHeight: "100vh",
    padding: "16px 20px",
    fontSize: "13px",
    lineHeight: 1.5,
  } as React.CSSProperties,

  // Header
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
    paddingBottom: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  } as React.CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  } as React.CSSProperties,
  logoMark: {
    width: "28px",
    height: "28px",
    borderRadius: "8px",
    background: "linear-gradient(135deg, #6366f1, #4f46e5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
    fontWeight: 800,
    color: "#fff",
    boxShadow: "0 2px 8px rgba(99, 102, 241, 0.3)",
  } as React.CSSProperties,
  headerTitle: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#e4e4e7",
    letterSpacing: "-0.01em",
  } as React.CSSProperties,
  headerClient: {
    fontSize: "11px",
    color: "#71717a",
    fontWeight: 500,
    marginTop: "1px",
  } as React.CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  } as React.CSSProperties,
  headerTime: {
    fontSize: "11px",
    color: "#52525b",
    fontWeight: 500,
  } as React.CSSProperties,
  badgeSecurity: {
    fontSize: "9px",
    fontWeight: 700,
    padding: "3px 8px",
    borderRadius: "6px",
    background: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.08))",
    color: "#f87171",
    border: "1px solid rgba(239, 68, 68, 0.2)",
    letterSpacing: "0.08em",
  } as React.CSSProperties,
  badgeRetriage: {
    fontSize: "9px",
    fontWeight: 700,
    padding: "3px 8px",
    borderRadius: "6px",
    background: "linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.08))",
    color: "#fbbf24",
    border: "1px solid rgba(245, 158, 11, 0.2)",
    letterSpacing: "0.08em",
  } as React.CSSProperties,

  // Hero cards
  heroRow: {
    display: "flex",
    marginBottom: "12px",
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  heroCard: {
    flex: "1 1 0",
    minWidth: "80px",
    background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "10px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "3px",
  } as React.CSSProperties,
  heroLabel: {
    fontSize: "9px",
    fontWeight: 700,
    color: "rgba(255,255,255,0.35)",
    letterSpacing: "0.1em",
  } as React.CSSProperties,
  heroValue: {
    fontSize: "16px",
    fontWeight: 800,
    color: "#fafafa",
    textTransform: "capitalize" as const,
    lineHeight: 1.2,
  } as React.CSSProperties,
  heroValueDim: {
    fontSize: "13px",
    fontWeight: 500,
    opacity: 0.5,
  } as React.CSSProperties,
  heroSub: {
    fontSize: "10px",
    color: "#71717a",
    textTransform: "capitalize" as const,
    fontWeight: 500,
  } as React.CSSProperties,

  // Actions
  actionsRow: {
    marginBottom: "14px",
    padding: "10px 14px",
    background: "linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: "10px",
  } as React.CSSProperties,

  // Security
  securityBox: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "14px 16px",
    background: "linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.03))",
    border: "1px solid rgba(239, 68, 68, 0.15)",
    borderRadius: "10px",
    marginBottom: "10px",
  } as React.CSSProperties,
  securityIcon: {
    width: "24px",
    height: "24px",
    borderRadius: "6px",
    background: "rgba(239, 68, 68, 0.15)",
    color: "#f87171",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 800,
    flexShrink: 0,
  } as React.CSSProperties,
  securityTitle: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#f87171",
    letterSpacing: "0.03em",
    marginBottom: "4px",
  } as React.CSSProperties,

  // TriageIt Notes section
  notesSection: {
    marginBottom: "14px",
  } as React.CSSProperties,
  notesSectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "10px",
    paddingBottom: "8px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  } as React.CSSProperties,
  notesSectionDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "#6366f1",
    boxShadow: "0 0 6px rgba(99, 102, 241, 0.5)",
  } as React.CSSProperties,
  notesSectionTitle: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#a1a1aa",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    flex: 1,
  } as React.CSSProperties,
  notesSectionBadge: {
    fontSize: "10px",
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: "10px",
    backgroundColor: "rgba(99, 102, 241, 0.1)",
    color: "#6366f1",
    border: "1px solid rgba(99, 102, 241, 0.2)",
  } as React.CSSProperties,
  notesList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
  } as React.CSSProperties,
  noteCard: {
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "10px",
    overflow: "hidden",
  } as React.CSSProperties,
  noteCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    background: "rgba(255,255,255,0.02)",
  } as React.CSSProperties,
  noteCardType: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.02em",
  } as React.CSSProperties,
  noteCardDate: {
    fontSize: "10px",
    color: "#52525b",
    fontWeight: 500,
  } as React.CSSProperties,
  noteCardBody: {
    padding: "10px 12px",
    fontSize: "12px",
    lineHeight: 1.6,
    overflow: "auto",
    maxHeight: "500px",
  } as React.CSSProperties,

  // Text
  bodyText: {
    color: "#d4d4d8",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    fontSize: "12px",
    lineHeight: 1.7,
  } as React.CSSProperties,
  responseText: {
    color: "#67e8f9",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    fontSize: "12px",
    lineHeight: 1.7,
  } as React.CSSProperties,

  // Findings
  findingsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  } as React.CSSProperties,
  findingCard: {
    background: "rgba(255,255,255,0.03)",
    borderRadius: "8px",
    padding: "10px 12px",
    border: "1px solid rgba(255,255,255,0.05)",
  } as React.CSSProperties,
  findingHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "6px",
  } as React.CSSProperties,
  findingAgent: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#a78bfa",
  } as React.CSSProperties,
  findingPct: {
    fontSize: "11px",
    fontWeight: 700,
  } as React.CSSProperties,
  confidenceTrack: {
    height: "3px",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: "2px",
    marginBottom: "8px",
    overflow: "hidden",
  } as React.CSSProperties,
  confidenceBar: {
    height: "100%",
    borderRadius: "2px",
    transition: "width 0.3s ease",
  } as React.CSSProperties,
  findingText: {
    color: "#a1a1aa",
    margin: 0,
    fontSize: "11px",
    lineHeight: 1.5,
  } as React.CSSProperties,

  // Agent logs
  logList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  } as React.CSSProperties,
  logRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "5px 6px",
    borderRadius: "6px",
    fontSize: "12px",
  } as React.CSSProperties,
  logIcon: {
    width: "20px",
    height: "20px",
    borderRadius: "5px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "10px",
    fontWeight: 800,
    flexShrink: 0,
  } as React.CSSProperties,
  logName: {
    fontWeight: 600,
    color: "#e4e4e7",
    minWidth: "110px",
    fontSize: "11px",
  } as React.CSSProperties,
  logRole: {
    color: "#52525b",
    flex: 1,
    fontSize: "11px",
  } as React.CSSProperties,
  logDuration: {
    color: "#52525b",
    fontSize: "10px",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontWeight: 500,
  } as React.CSSProperties,

  // Footer
  footer: {
    display: "flex",
    gap: "8px",
    justifyContent: "center",
    alignItems: "center",
    color: "#3f3f46",
    fontSize: "10px",
    marginTop: "16px",
    paddingTop: "12px",
    borderTop: "1px solid rgba(255,255,255,0.04)",
    fontWeight: 500,
  } as React.CSSProperties,
  footerDot: {
    width: "3px",
    height: "3px",
    borderRadius: "50%",
    backgroundColor: "#27272a",
  } as React.CSSProperties,

  // Empty / Error
  emptyWrap: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "240px",
    gap: "12px",
  } as React.CSSProperties,
  emptyIcon: {
    fontSize: "24px",
    color: "#52525b",
    width: "48px",
    height: "48px",
    borderRadius: "14px",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.05)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as React.CSSProperties,
  emptyText: {
    color: "#52525b",
    textAlign: "center" as const,
    maxWidth: "320px",
    fontSize: "13px",
    lineHeight: 1.5,
    fontWeight: 500,
  } as React.CSSProperties,
};
