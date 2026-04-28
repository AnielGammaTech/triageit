import { createServiceClient } from "@/lib/supabase/server";
import { AGENTS } from "@triageit/shared";
import { QuickActions, CollapsibleSection, SpinnerStyles, EmbedTriageButton, AutoRefresh } from "./actions";

/**
 * Embeddable Triage Tab — loaded inside Halo PSA as a custom web tab.
 *
 * URL format: /embed/triage?halo_id=$FAULTID&token={EMBED_SECRET}
 * Halo replaces $FAULTID with the ticket's Halo ID automatically.
 */

// ── Constants ───────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<number, { label: string; color: string; track: string }> = {
  1: { label: "Critical", color: "#ff4757", track: "linear-gradient(90deg, #ff4757, #ff6b81)" },
  2: { label: "High", color: "#ff8c42", track: "linear-gradient(90deg, #ff8c42, #ffa563)" },
  3: { label: "Medium", color: "#ffc312", track: "linear-gradient(90deg, #ffc312, #ffd43b)" },
  4: { label: "Low", color: "#2ed573", track: "linear-gradient(90deg, #2ed573, #7bed9f)" },
  5: { label: "Minimal", color: "#636e72", track: "linear-gradient(90deg, #636e72, #a4b0be)" },
};

const URGENCY_COLOR = (score: number): string =>
  score >= 4 ? "#ff4757" : score >= 3 ? "#ffc312" : "#2ed573";

const AGENT_CHARACTERS: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.name, a.character]),
);

const NOTE_TYPE_CONFIG: Record<string, { label: string; accent: string; tag: string }> = {
  triage: { label: "AI Triage", accent: "#6c5ce7", tag: "TRIAGE" },
  retriage: { label: "Re-Triage", accent: "#fdcb6e", tag: "RETRIAGE" },
  "tech-review": { label: "Tech Review", accent: "#00b894", tag: "REVIEW" },
  "close-review": { label: "Close Review", accent: "#00cec9", tag: "CLOSE" },
  alert: { label: "Alert", accent: "#ff4757", tag: "ALERT" },
  priority: { label: "Priority", accent: "#a29bfe", tag: "PRIORITY" },
  documentation: { label: "Docs", accent: "#74b9ff", tag: "DOCS" },
  other: { label: "Note", accent: "#636e72", tag: "NOTE" },
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
  readonly actiondatecreated?: string;
  readonly datecreated?: string;
  readonly dateoccurred?: string;
  readonly datetime?: string;
  readonly when?: string;
}

function getActionDate(a: HaloAction): string {
  return a.actiondatecreated ?? a.datetime ?? a.datecreated ?? a.dateoccurred ?? a.when ?? "";
}

interface TriageITNote {
  readonly id: number;
  readonly html: string;
  readonly date: string;
  readonly type: string;
}

// ── Halo Note Helpers ──────────────────────────────────────────────────

function isTriageITNote(action: HaloAction): boolean {
  const note = action.note ?? "";
  const lower = note.toLowerCase();
  return (
    lower.includes("triageit") ||
    lower.includes("ai triage") ||
    lower.includes("tech performance review") ||
    lower.includes("close review") ||
    lower.includes("no progress since last review") ||
    note.includes("linear-gradient(135deg,#b91c1c") ||
    note.includes("linear-gradient(135deg,#4f46e5") ||
    note.includes("linear-gradient(135deg,#059669") ||
    note.includes("linear-gradient(135deg,#6366f1") ||
    note.includes("linear-gradient(135deg,#991b1b") ||
    note.includes("linear-gradient(135deg,#065f46")
  );
}

function classifyNote(html: string): string {
  const lower = html.toLowerCase();
  if (lower.includes("close review")) return "close-review";
  if (lower.includes("tech performance review")) return "tech-review";
  if (lower.includes("no progress since last review")) return "retriage";
  if (lower.includes("retriage") || lower.includes("re-triage")) return "retriage";
  if (lower.includes("alert path")) return "alert";
  if (lower.includes("priority recommendation")) return "priority";
  if (lower.includes("documentation gap")) return "documentation";
  if (lower.includes("ai triage")) return "triage";
  return "other";
}

interface HaloConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

async function fetchTriageITNotes(
  config: HaloConfig,
  haloId: number,
): Promise<ReadonlyArray<TriageITNote>> {
  try {
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

    return actions
      .filter(isTriageITNote)
      .sort(
        (a, b) =>
          new Date(getActionDate(b)).getTime() -
          new Date(getActionDate(a)).getTime(),
      )
      .map((a) => ({
        id: a.id,
        html: a.note,
        date: getActionDate(a),
        type: classifyNote(a.note),
      }));
  } catch (err) {
    console.error("[EMBED] Failed to fetch TriageIT notes:", err);
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

  const embedSecret = process.env.EMBED_SECRET;
  if (!embedSecret || token !== embedSecret) {
    return <ErrorState message="Unauthorized -- invalid or missing embed token." />;
  }

  if (!haloId || isNaN(Number(haloId))) {
    return <ErrorState message="Missing or invalid halo_id parameter." />;
  }

  const supabase = await createServiceClient();

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
      <div style={css.page}>
        <SpinnerStyles />
        <div style={css.emptyWrap}>
          <div style={css.emptyIcon}>?</div>
          <p style={css.emptyText}>
            No triage data for ticket #{haloId}
          </p>
          <EmbedTriageButton haloId={Number(haloId)} token={embedSecret} />
        </div>
      </div>
    );
  }

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
    haloConfig ? fetchTriageITNotes(haloConfig, ticket.halo_id) : Promise.resolve([]),
  ]);

  const triageResults = (triageResultsRes.data ?? []) as ReadonlyArray<TriageData>;
  const logs = (agentLogsRes.data ?? []) as ReadonlyArray<AgentLog>;

  if (triageResults.length === 0) {
    return (
      <div style={css.page}>
        <SpinnerStyles />
        <div style={css.emptyWrap}>
          <div style={{
            ...css.emptyIcon,
            color: ticket.status === "triaging" ? "#6c5ce7" : "#636e72",
          }}>
            {ticket.status === "triaging" ? "..." : "--"}
          </div>
          <p style={css.emptyText}>
            {ticket.status === "triaging"
              ? "Triage in progress"
              : "Awaiting triage"}
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
  const pri = PRIORITY_CONFIG[latest.recommended_priority] ?? {
    label: `P${latest.recommended_priority}`,
    color: "#636e72",
    track: "linear-gradient(90deg, #636e72, #a4b0be)",
  };
  const findingsEntries = Object.entries(latest.findings);
  const completedAgents = logs.filter((l) => l.status === "completed").length;

  return (
    <div style={css.page}>
      <SpinnerStyles />

      {/* ── Top Bar: Logo + Client + Time ─────────────────── */}
      <div style={css.topBar}>
        <div style={css.topBarLeft}>
          <div style={css.logo}>T</div>
          <span style={css.brandName}>TriageIT</span>
          {ticket.client_name && (
            <>
              <span style={css.topBarSep}>/</span>
              <span style={css.clientName}>{ticket.client_name}</span>
            </>
          )}
        </div>
        <div style={css.topBarRight}>
          {latest.security_flag && <span style={css.secBadge}>SEC</span>}
          <span style={css.timestamp}>{formatTimestamp(latest.created_at)}</span>
        </div>
      </div>

      {/* ── Status Strip: Priority / Urgency / Type / Team ── */}
      <div style={css.statusStrip}>
        <div style={css.statusItem}>
          <div style={css.statusLabel}>PRI</div>
          <div style={{ ...css.statusValue, color: pri.color }}>{pri.label}</div>
          <div style={css.statusTrack}>
            <div style={{
              height: "100%",
              width: `${(latest.recommended_priority / 5) * 100}%`,
              background: pri.track,
              borderRadius: "2px",
            }} />
          </div>
        </div>
        <div style={css.statusDivider} />
        <div style={css.statusItem}>
          <div style={css.statusLabel}>URG</div>
          <div style={{ ...css.statusValue, color: URGENCY_COLOR(latest.urgency_score), fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
            {latest.urgency_score}<span style={css.statusDim}>/5</span>
          </div>
        </div>
        <div style={css.statusDivider} />
        <div style={{ ...css.statusItem, flex: "1.5 1 0" }}>
          <div style={css.statusLabel}>TYPE</div>
          <div style={css.statusValue}>
            {latest.classification.type.replace(/_/g, " ")}
            {latest.classification.subtype && (
              <span style={css.statusSub}> / {latest.classification.subtype.replace(/_/g, " ")}</span>
            )}
          </div>
        </div>
        {latest.recommended_team && (
          <>
            <div style={css.statusDivider} />
            <div style={css.statusItem}>
              <div style={css.statusLabel}>TEAM</div>
              <div style={css.statusValue}>{latest.recommended_team}</div>
            </div>
          </>
        )}
      </div>

      {/* ── Security Alert ──────────────────────────────── */}
      {latest.security_flag && latest.security_notes && (
        <div style={css.secAlert}>
          <div style={css.secAlertBar} />
          <div style={css.secAlertContent}>
            <div style={css.secAlertTitle}>SECURITY FLAG</div>
            <p style={css.secAlertText}>{latest.security_notes}</p>
          </div>
        </div>
      )}

      {/* ── Actions ────────────────────────────────────── */}
      <div style={css.actionsWrap}>
        <QuickActions
          ticketId={ticket.id}
          haloId={ticket.halo_id}
          suggestedResponse={latest.suggested_response}
          internalNotes={latest.internal_notes}
          token={embedSecret}
        />
      </div>

      {/* ── Agent Findings (collapsible) ──────────────── */}
      {findingsEntries.length > 0 && (
        <CollapsibleSection
          title="Agent Findings"
          badge={`${findingsEntries.length} agents`}
          accent="#a29bfe"
          defaultOpen={findingsEntries.length <= 3}
        >
          <div style={css.findingsGrid}>
            {findingsEntries.map(([name, finding]) => (
              <FindingCard
                key={name}
                agentName={name}
                summary={finding.summary}
                confidence={finding.confidence}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── TriageIT Notes ─────────────────────────────── */}
      {triageItNotes.length > 0 && (
        <div style={css.notesSection}>
          <div style={css.sectionHeader}>
            <span style={css.sectionTitle}>Halo Notes</span>
            <span style={css.sectionCount}>{triageItNotes.length}</span>
          </div>
          <div style={css.notesList}>
            {triageItNotes.map((note, i) => (
              <NoteCard key={note.id} note={note} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      )}

      {/* ── Urgency Reasoning ──────────────────────────── */}
      <CollapsibleSection title="Urgency Reasoning" accent="#6c5ce7">
        <p style={css.bodyText}>{latest.urgency_reasoning}</p>
      </CollapsibleSection>

      {/* ── Internal Notes ─────────────────────────────── */}
      {latest.internal_notes && (
        <CollapsibleSection title="Internal Notes" accent="#a29bfe">
          <p style={css.bodyText}>{latest.internal_notes}</p>
        </CollapsibleSection>
      )}

      {/* ── Agent Activity Log ─────────────────────────── */}
      {logs.length > 0 && (
        <CollapsibleSection
          title="Agent Pipeline"
          badge={`${completedAgents}/${logs.length}`}
          accent="#636e72"
        >
          <div style={css.logGrid}>
            {logs.map((log, i) => (
              <AgentLogRow key={i} log={log} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Footer ─────────────────────────────────────── */}
      <div style={css.footer}>
        <span>{completedAgents} agents</span>
        <span style={css.footerDot} />
        <span>{logs.reduce((sum, l) => sum + (l.tokens_used ?? 0), 0).toLocaleString()} tok</span>
        {latest.processing_time_ms != null && (
          <>
            <span style={css.footerDot} />
            <span>{(latest.processing_time_ms / 1000).toFixed(1)}s</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub Components ──────────────────────────────────────────────────────

function NoteCard({ note, defaultOpen }: { readonly note: TriageITNote; readonly defaultOpen: boolean }) {
  const cfg = NOTE_TYPE_CONFIG[note.type] ?? NOTE_TYPE_CONFIG.other;

  return (
    <CollapsibleSection
      title={cfg.label}
      accent={cfg.accent}
      defaultOpen={defaultOpen}
      badge={formatTimestamp(note.date)}
      tag={cfg.tag}
    >
      <div
        style={{ fontSize: "12px", lineHeight: 1.6, overflow: "auto", maxHeight: "500px" }}
        dangerouslySetInnerHTML={{ __html: note.html }}
      />
    </CollapsibleSection>
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
  const barColor = pct >= 80 ? "#00b894" : pct >= 60 ? "#fdcb6e" : "#636e72";

  return (
    <div style={{
      padding: "8px 10px",
      borderBottom: "1px solid #1e2028",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "4px",
      }}>
        <span style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "#a29bfe",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}>{character}</span>
        <span style={{ flex: 1 }} />
        <div style={{
          width: "32px",
          height: "3px",
          backgroundColor: "#1e2028",
          borderRadius: "2px",
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: barColor,
            borderRadius: "2px",
          }} />
        </div>
        <span style={{
          fontSize: "9px",
          fontWeight: 700,
          color: barColor,
          minWidth: "24px",
          textAlign: "right" as const,
        }}>{pct}%</span>
      </div>
      <p style={{
        color: "#8b8fa3",
        margin: 0,
        fontSize: "11px",
        lineHeight: 1.6,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>{summary}</p>
    </div>
  );
}

function AgentLogRow({ log }: { readonly log: AgentLog }) {
  const character = AGENT_CHARACTERS[log.agent_name] ?? log.agent_name;
  const statusMap: Record<string, { symbol: string; color: string }> = {
    completed: { symbol: "+", color: "#00b894" },
    error: { symbol: "x", color: "#ff4757" },
    skipped: { symbol: "-", color: "#636e72" },
  };
  const st = statusMap[log.status] ?? { symbol: "~", color: "#fdcb6e" };

  return (
    <div style={css.logRow}>
      <span style={{ ...css.logStatus, color: st.color }}>{st.symbol}</span>
      <span style={css.logName}>{character}</span>
      <span style={css.logRole}>{log.agent_role}</span>
      {log.duration_ms != null && (
        <span style={css.logTime}>{(log.duration_ms / 1000).toFixed(1)}s</span>
      )}
    </div>
  );
}

function ErrorState({ message }: { readonly message: string }) {
  return (
    <div style={css.page}>
      <SpinnerStyles />
      <div style={css.emptyWrap}>
        <div style={{ ...css.emptyIcon, color: "#ff4757" }}>!</div>
        <p style={{ ...css.emptyText, color: "#ff4757" }}>{message}</p>
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
    timeZone: "America/New_York",
  });
}

// ── Styles ──────────────────────────────────────────────────────────────

const css = {
  page: {
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    backgroundColor: "#0c0d10",
    color: "#c8ccd4",
    minHeight: "100vh",
    padding: "14px 16px",
    fontSize: "12px",
    lineHeight: 1.5,
  } as React.CSSProperties,

  // ── Top Bar
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
    paddingBottom: "10px",
    borderBottom: "1px solid #1e2028",
  } as React.CSSProperties,
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  } as React.CSSProperties,
  logo: {
    width: "22px",
    height: "22px",
    borderRadius: "4px",
    background: "#6c5ce7",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: 900,
    color: "#fff",
    letterSpacing: "-0.02em",
  } as React.CSSProperties,
  brandName: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#6c5ce7",
    letterSpacing: "0.04em",
  } as React.CSSProperties,
  topBarSep: {
    color: "#2d3040",
    fontSize: "11px",
    fontWeight: 400,
  } as React.CSSProperties,
  clientName: {
    fontSize: "11px",
    fontWeight: 500,
    color: "#636e72",
    maxWidth: "200px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  topBarRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  } as React.CSSProperties,
  secBadge: {
    fontSize: "8px",
    fontWeight: 800,
    padding: "2px 6px",
    borderRadius: "3px",
    backgroundColor: "rgba(255, 71, 87, 0.12)",
    color: "#ff4757",
    border: "1px solid rgba(255, 71, 87, 0.25)",
    letterSpacing: "0.1em",
  } as React.CSSProperties,
  timestamp: {
    fontSize: "10px",
    color: "#3d4051",
    fontWeight: 500,
  } as React.CSSProperties,

  // ── Status Strip
  statusStrip: {
    display: "flex",
    alignItems: "stretch",
    gap: "0",
    marginBottom: "12px",
    background: "#12131a",
    border: "1px solid #1e2028",
    borderRadius: "6px",
    overflow: "hidden",
  } as React.CSSProperties,
  statusItem: {
    flex: "1 1 0",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "3px",
    minWidth: 0,
  } as React.CSSProperties,
  statusDivider: {
    width: "1px",
    backgroundColor: "#1e2028",
    alignSelf: "stretch",
  } as React.CSSProperties,
  statusLabel: {
    fontSize: "8px",
    fontWeight: 700,
    color: "#3d4051",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  statusValue: {
    fontSize: "13px",
    fontWeight: 800,
    color: "#e4e6ed",
    textTransform: "capitalize" as const,
    lineHeight: 1.2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  statusDim: {
    fontSize: "10px",
    fontWeight: 500,
    opacity: 0.4,
  } as React.CSSProperties,
  statusSub: {
    fontSize: "10px",
    color: "#636e72",
    fontWeight: 500,
  } as React.CSSProperties,
  statusTrack: {
    height: "3px",
    backgroundColor: "#1e2028",
    borderRadius: "2px",
    overflow: "hidden",
    marginTop: "2px",
  } as React.CSSProperties,

  // ── Security Alert
  secAlert: {
    display: "flex",
    marginBottom: "12px",
    background: "rgba(255, 71, 87, 0.04)",
    border: "1px solid rgba(255, 71, 87, 0.15)",
    borderRadius: "6px",
    overflow: "hidden",
  } as React.CSSProperties,
  secAlertBar: {
    width: "3px",
    backgroundColor: "#ff4757",
    flexShrink: 0,
  } as React.CSSProperties,
  secAlertContent: {
    padding: "10px 12px",
    flex: 1,
  } as React.CSSProperties,
  secAlertTitle: {
    fontSize: "9px",
    fontWeight: 800,
    color: "#ff4757",
    letterSpacing: "0.1em",
    marginBottom: "4px",
  } as React.CSSProperties,
  secAlertText: {
    color: "#ff6b81",
    margin: 0,
    fontSize: "11px",
    lineHeight: 1.5,
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,

  // ── Actions
  actionsWrap: {
    marginBottom: "14px",
  } as React.CSSProperties,

  // ── Sections
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: "9px",
    fontWeight: 800,
    color: "#3d4051",
    textTransform: "uppercase" as const,
    letterSpacing: "0.12em",
    flex: 1,
  } as React.CSSProperties,
  sectionCount: {
    fontSize: "9px",
    fontWeight: 700,
    color: "#6c5ce7",
    backgroundColor: "rgba(108, 92, 231, 0.1)",
    padding: "1px 6px",
    borderRadius: "3px",
  } as React.CSSProperties,

  // ── Findings
  findingsSection: {
    marginBottom: "14px",
  } as React.CSSProperties,
  findingsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  } as React.CSSProperties,
  findingCard: {
    background: "#12131a",
    border: "1px solid #1e2028",
    borderRadius: "6px",
    padding: "10px 12px",
  } as React.CSSProperties,
  findingTop: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px",
  } as React.CSSProperties,
  findingAvatar: {
    width: "20px",
    height: "20px",
    borderRadius: "4px",
    backgroundColor: "rgba(108, 92, 231, 0.15)",
    color: "#a29bfe",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    flexShrink: 0,
  } as React.CSSProperties,
  findingName: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#a29bfe",
    flex: 1,
  } as React.CSSProperties,
  findingConfWrap: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  } as React.CSSProperties,
  findingConfTrack: {
    width: "40px",
    height: "3px",
    backgroundColor: "#1e2028",
    borderRadius: "2px",
    overflow: "hidden",
  } as React.CSSProperties,
  findingConfPct: {
    fontSize: "9px",
    fontWeight: 700,
    minWidth: "28px",
    textAlign: "right" as const,
  } as React.CSSProperties,
  findingText: {
    color: "#8b8fa3",
    margin: 0,
    fontSize: "11px",
    lineHeight: 1.6,
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,

  // ── Notes
  notesSection: {
    marginBottom: "14px",
  } as React.CSSProperties,
  notesList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  } as React.CSSProperties,

  // ── Body text
  bodyText: {
    color: "#8b8fa3",
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    fontSize: "11px",
    lineHeight: 1.7,
    fontFamily: "'Inter', system-ui, sans-serif",
  } as React.CSSProperties,

  // ── Agent logs
  logGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
  } as React.CSSProperties,
  logRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 6px",
    borderRadius: "4px",
    fontSize: "11px",
  } as React.CSSProperties,
  logStatus: {
    width: "14px",
    textAlign: "center" as const,
    fontWeight: 800,
    fontSize: "10px",
    flexShrink: 0,
  } as React.CSSProperties,
  logName: {
    fontWeight: 600,
    color: "#c8ccd4",
    minWidth: "100px",
    fontSize: "11px",
  } as React.CSSProperties,
  logRole: {
    color: "#3d4051",
    flex: 1,
    fontSize: "10px",
  } as React.CSSProperties,
  logTime: {
    color: "#3d4051",
    fontSize: "10px",
    fontWeight: 500,
  } as React.CSSProperties,

  // ── Footer
  footer: {
    display: "flex",
    gap: "8px",
    justifyContent: "center",
    alignItems: "center",
    color: "#2d3040",
    fontSize: "9px",
    marginTop: "14px",
    paddingTop: "10px",
    borderTop: "1px solid #1e2028",
    fontWeight: 500,
    letterSpacing: "0.04em",
  } as React.CSSProperties,
  footerDot: {
    width: "2px",
    height: "2px",
    borderRadius: "50%",
    backgroundColor: "#1e2028",
  } as React.CSSProperties,

  // ── Empty / Error
  emptyWrap: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "240px",
    gap: "12px",
  } as React.CSSProperties,
  emptyIcon: {
    fontSize: "18px",
    color: "#3d4051",
    width: "40px",
    height: "40px",
    borderRadius: "6px",
    background: "#12131a",
    border: "1px solid #1e2028",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
  } as React.CSSProperties,
  emptyText: {
    color: "#3d4051",
    textAlign: "center" as const,
    maxWidth: "280px",
    fontSize: "12px",
    lineHeight: 1.5,
    fontWeight: 500,
  } as React.CSSProperties,
};
