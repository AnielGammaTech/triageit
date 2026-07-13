import { createServiceClient } from "@/lib/supabase/server";
import { normalizeHaloUtcTimestamp } from "@/lib/halo/date";
import { secureTokenEqual } from "@/lib/api/secure-token";
import { AGENTS } from "@triageit/shared";
import { QuickActions, CollapsibleSection, GlobalStyles, EmbedTriageButton, AutoRefresh, TriageFeedback } from "./actions";
import { ToggleableSection, SectionSettings } from "./sections";
import {
  T,
  PRIORITY_THEME,
  urgencyColor,
  ConfidenceRing,
  UrgencyMeter,
  IconShieldAlert,
  IconRadar,
  IconClock,
  IconCpu,
  IconNote,
  IconUsers,
  IconZap,
  IconAlertTriangle,
  IconPaperclip,
} from "./theme";

/**
 * Embeddable Triage Tab — loaded inside Halo PSA as a custom web tab.
 *
 * URL format: /embed/triage?halo_id=$FAULTID&token={EMBED_SECRET}
 * Halo replaces $FAULTID with the ticket's Halo ID automatically.
 */

// ── Constants ───────────────────────────────────────────────────────────

const AGENT_CHARACTERS: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.name, a.character]),
);

const NOTE_TYPE_CONFIG: Record<string, { label: string; accent: string; tag: string }> = {
  triage: { label: "AI Triage", accent: T.brand, tag: "TRIAGE" },
  retriage: { label: "Re-Triage", accent: T.amber, tag: "RETRIAGE" },
  "tech-review": { label: "Tech Review", accent: T.green, tag: "REVIEW" },
  "close-review": { label: "Close Review", accent: T.teal, tag: "CLOSE" },
  alert: { label: "Alert", accent: T.red, tag: "ALERT" },
  priority: { label: "Priority", accent: T.blue, tag: "PRIORITY" },
  documentation: { label: "Docs", accent: T.blue, tag: "DOCS" },
  other: { label: "Note", accent: T.gray, tag: "NOTE" },
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
  readonly analyzed_files: ReadonlyArray<string> | null;
  readonly duplicates: ReadonlyArray<{ halo_id: number; summary: string; similarity: number }> | null;
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
  return normalizeHaloUtcTimestamp(a.actiondatecreated ?? a.datetime ?? a.datecreated ?? a.dateoccurred ?? a.when);
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
  if (!embedSecret || !secureTokenEqual(token, embedSecret)) {
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
        <GlobalStyles />
        <div style={css.emptyWrap}>
          <div style={css.emptyIcon}>
            <IconRadar size={22} color={T.textMute} strokeWidth={1.5} />
          </div>
          <p style={css.emptyText}>No triage data for ticket #{haloId}</p>
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
    const isTriaging = ticket.status === "triaging";
    return (
      <div style={css.page}>
        <GlobalStyles />
        <div style={css.emptyWrap}>
          <div style={{ ...css.emptyIcon, ...(isTriaging ? { borderColor: `${T.brand}44` } : {}) }}>
            <IconRadar
              size={22}
              color={isTriaging ? T.brand : T.textMute}
              strokeWidth={1.5}
              style={isTriaging ? { animation: "pulse 1.6s ease-in-out infinite" } : undefined}
            />
          </div>
          <p style={css.emptyText}>{isTriaging ? "Triage in progress" : "Awaiting triage"}</p>
          {isTriaging ? (
            <AutoRefresh />
          ) : (
            <EmbedTriageButton haloId={ticket.halo_id} token={embedSecret} />
          )}
        </div>
      </div>
    );
  }

  const latest = triageResults[0];
  const pri = PRIORITY_THEME[latest.recommended_priority] ?? {
    label: `P${latest.recommended_priority}`,
    color: T.gray,
    glow: "rgba(122,129,148,0.18)",
  };
  const urgColor = urgencyColor(latest.urgency_score);
  const findingsEntries = Object.entries(latest.findings);
  const completedAgents = logs.filter((l) => l.status === "completed").length;
  const totalTokens = logs.reduce((sum, l) => sum + (l.tokens_used ?? 0), 0);

  return (
    <div style={css.page}>
      <GlobalStyles />

      {/* Severity edge — hairline gradient across the top of the panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "2px",
          background: `linear-gradient(90deg, transparent, ${pri.color}, transparent)`,
          zIndex: 100,
        }}
      />

      {/* ── Command Header ─────────────────────────────────── */}
      <header style={css.header} className="tg-reveal">
        <div style={css.headerLeft}>
          <div style={css.logoMark}>
            <IconRadar size={15} color="#fff" strokeWidth={2} />
          </div>
          <div style={css.headerText}>
            <div style={css.brandRow}>
              <span style={css.brandName}>TRIAGEIT</span>
              <span style={css.ticketNum}>#{ticket.halo_id}</span>
            </div>
            {ticket.client_name && <div style={css.clientName}>{ticket.client_name}</div>}
          </div>
        </div>
        <div style={css.headerRight}>
          {latest.security_flag && (
            <span style={css.secBadge}>
              <span style={css.secDot} className="tg-pulse" />
              SECURITY
            </span>
          )}
          <span style={css.timestamp}>
            <IconClock size={10} color={T.textFaint} />
            {formatTimestamp(latest.created_at)}
          </span>
          <SectionSettings />
        </div>
      </header>

      {/* ── Severity Band ──────────────────────────────────── */}
      <ToggleableSection sectionKey="stats">
      <div
        style={{
          ...css.severityBand,
          boxShadow: `inset 0 1px 0 ${T.lineSoft}, 0 0 40px -18px ${pri.glow}`,
        }}
        className="tg-reveal tg-d1"
      >
        {/* Priority */}
        <div style={{ ...css.sevCell, flex: "1.1 1 0" }}>
          <div style={css.sevLabel}>Priority</div>
          <div
            style={{
              ...css.sevValueBig,
              color: pri.color,
              textShadow: `0 0 18px ${pri.glow}`,
            }}
          >
            {pri.label}
          </div>
          <div style={css.sevTrack}>
            <div
              style={{
                height: "100%",
                width: `${((6 - latest.recommended_priority) / 5) * 100}%`,
                background: `linear-gradient(90deg, ${pri.color}88, ${pri.color})`,
                borderRadius: "2px",
                boxShadow: `0 0 8px ${pri.glow}`,
              }}
            />
          </div>
        </div>

        <div style={css.sevDivider} />

        {/* Urgency */}
        <div style={css.sevCell}>
          <div style={css.sevLabel}>
            <IconZap size={9} color={urgColor} /> Urgency
          </div>
          <div style={{ ...css.sevValueBig, color: urgColor, fontFamily: T.mono }}>
            {latest.urgency_score}
            <span style={css.sevDim}>/5</span>
          </div>
          <UrgencyMeter score={latest.urgency_score} />
        </div>

        <div style={css.sevDivider} />

        {/* Classification */}
        <div style={{ ...css.sevCell, flex: "1.6 1 0" }}>
          <div style={css.sevLabel}>Classification</div>
          <div style={css.sevValue}>{latest.classification.type.replace(/_/g, " ")}</div>
          {latest.classification.subtype && (
            <div style={css.sevSub}>{latest.classification.subtype.replace(/_/g, " ")}</div>
          )}
        </div>

        {latest.recommended_team && (
          <>
            <div style={css.sevDivider} />
            <div style={css.sevCell}>
              <div style={css.sevLabel}>
                <IconUsers size={9} color={T.textMute} /> Team
              </div>
              <div style={css.sevValue}>{latest.recommended_team}</div>
              {latest.recommended_agent && (
                <div style={css.sevSub}>{latest.recommended_agent}</div>
              )}
            </div>
          </>
        )}
      </div>
      </ToggleableSection>

      {/* ── Security Alert ─────────────────────────────────── */}
      {latest.security_flag && latest.security_notes && (
        <div style={css.secAlert} className="tg-reveal tg-d2">
          <div style={css.secAlertIcon}>
            <IconShieldAlert size={16} color={T.red} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={css.secAlertTitle}>Security flag raised</div>
            <p style={css.secAlertText}>{latest.security_notes}</p>
          </div>
        </div>
      )}

      {/* ── Duplicate suggestion ───────────────────────────── */}
      {latest.duplicates && latest.duplicates.length > 0 && (
        <ToggleableSection sectionKey="duplicates">
          <div style={css.dupeBar} className="tg-reveal tg-d2">
            <span style={css.dupeLabel}>POSSIBLE DUPLICATE</span>
            {latest.duplicates.slice(0, 3).map((d) => (
              <span key={d.halo_id} style={css.dupeChip}>
                #{d.halo_id} <span style={css.dupePct}>{Math.round(d.similarity * 100)}%</span>
                <span style={css.dupeSummary}> — {d.summary.slice(0, 60)}</span>
              </span>
            ))}
          </div>
        </ToggleableSection>
      )}

      {/* ── Evidence: attachments the AI read ──────────────── */}
      {latest.analyzed_files && latest.analyzed_files.length > 0 && (
        <div style={css.analyzedBar} className="tg-reveal tg-d2">
          <IconPaperclip size={10} color={T.textMute} />
          <span style={css.analyzedText}>
            Analyzed: {latest.analyzed_files.join(" · ")}
          </span>
        </div>
      )}

      {/* ── Action Deck ────────────────────────────────────── */}
      <div style={css.actionsWrap} className="tg-reveal tg-d2">
        <QuickActions
          ticketId={ticket.id}
          haloId={ticket.halo_id}
          suggestedResponse={latest.suggested_response}
          internalNotes={latest.internal_notes}
          token={embedSecret}
        />
      </div>

      {/* ── Agent Findings ─────────────────────────────────── */}
      {findingsEntries.length > 0 && (
        <ToggleableSection sectionKey="findings">
          <div className="tg-reveal tg-d3">
            <CollapsibleSection
              title="Agent Findings"
              badge={`${findingsEntries.length} agents`}
              accent={T.brand}
              icon="radar"
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
          </div>
        </ToggleableSection>
      )}

      {/* ── TriageIT Notes Timeline ────────────────────────── */}
      {triageItNotes.length > 0 && (
        <ToggleableSection sectionKey="timeline">
        <div style={css.notesSection} className="tg-reveal tg-d3">
          <div style={css.sectionHeader}>
            <IconNote size={11} color={T.textMute} />
            <span style={css.sectionTitle}>Activity Timeline</span>
            <span style={css.sectionCount}>{triageItNotes.length}</span>
          </div>
          <div style={css.timeline}>
            {triageItNotes.map((note, i) => {
              const cfg = NOTE_TYPE_CONFIG[note.type] ?? NOTE_TYPE_CONFIG.other;
              return (
                <div key={note.id} style={css.timelineRow}>
                  <div style={css.timelineRail}>
                    <div
                      style={{
                        ...css.timelineNode,
                        backgroundColor: cfg.accent,
                        boxShadow: `0 0 8px ${cfg.accent}66`,
                      }}
                    />
                    {i < triageItNotes.length - 1 && <div style={css.timelineLine} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: "8px" }}>
                    <CollapsibleSection
                      title={cfg.label}
                      accent={cfg.accent}
                      defaultOpen={i === 0}
                      badge={formatTimestamp(note.date)}
                      tag={cfg.tag}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          lineHeight: 1.6,
                          overflow: "auto",
                          maxHeight: "500px",
                          fontFamily: T.sans,
                        }}
                        dangerouslySetInnerHTML={{ __html: note.html }}
                      />
                    </CollapsibleSection>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </ToggleableSection>
      )}

      {/* ── Urgency Reasoning ──────────────────────────────── */}
      <ToggleableSection sectionKey="reasoning">
        <div className="tg-reveal tg-d4">
          <CollapsibleSection title="Urgency Reasoning" accent={T.brand} icon="brain">
            <p style={css.bodyText}>{latest.urgency_reasoning}</p>
          </CollapsibleSection>
        </div>
      </ToggleableSection>

      {/* ── Internal Notes ─────────────────────────────────── */}
      {latest.internal_notes && (
        <ToggleableSection sectionKey="notes">
          <div className="tg-reveal tg-d4">
            <CollapsibleSection title="Internal Notes" accent={T.blue} icon="note">
              <p style={css.bodyText}>{latest.internal_notes}</p>
            </CollapsibleSection>
          </div>
        </ToggleableSection>
      )}

      {/* ── Agent Pipeline ─────────────────────────────────── */}
      {logs.length > 0 && (
        <ToggleableSection sectionKey="pipeline">
          <div className="tg-reveal tg-d4">
            <CollapsibleSection
              title="Agent Pipeline"
              badge={`${completedAgents}/${logs.length}`}
              accent={T.textMute}
              icon="activity"
            >
              <div style={css.logGrid}>
                {logs.map((log, i) => (
                  <AgentLogRow key={i} log={log} maxDuration={Math.max(...logs.map((l) => l.duration_ms ?? 0), 1)} />
                ))}
              </div>
            </CollapsibleSection>
          </div>
        </ToggleableSection>
      )}

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer style={css.footer} className="tg-reveal tg-d4">
        <span style={css.footerStat}>
          <IconUsers size={10} color={T.textFaint} />
          {completedAgents} agents
        </span>
        <span style={css.footerStat}>
          <IconCpu size={10} color={T.textFaint} />
          {totalTokens.toLocaleString()} tok
        </span>
        {latest.processing_time_ms != null && (
          <span style={css.footerStat}>
            <IconClock size={10} color={T.textFaint} />
            {(latest.processing_time_ms / 1000).toFixed(1)}s
          </span>
        )}
        <span style={{ width: "1px", height: "14px", backgroundColor: T.line }} />
        <TriageFeedback haloId={ticket.halo_id} triageResultId={latest.id} token={embedSecret} />
      </footer>
    </div>
  );
}

// ── Sub Components ──────────────────────────────────────────────────────

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
  const initials = character
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div style={css.findingCard} className="tg-card">
      <div style={css.findingTop}>
        <div style={css.findingAvatar}>{initials}</div>
        <span style={css.findingName}>{character}</span>
        <ConfidenceRing pct={pct} />
      </div>
      <p style={css.findingText}>{summary}</p>
    </div>
  );
}

function AgentLogRow({
  log,
  maxDuration,
}: {
  readonly log: AgentLog;
  readonly maxDuration: number;
}) {
  const character = AGENT_CHARACTERS[log.agent_name] ?? log.agent_name;
  const statusColor: Record<string, string> = {
    completed: T.green,
    error: T.red,
    skipped: T.textFaint,
  };
  const color = statusColor[log.status] ?? T.amber;
  const durationPct = log.duration_ms != null ? Math.max((log.duration_ms / maxDuration) * 100, 2) : 0;

  return (
    <div style={css.logRow}>
      <span style={{ ...css.logDot, backgroundColor: color, boxShadow: `0 0 6px ${color}55` }} />
      <span style={css.logName}>{character}</span>
      <span style={css.logRole}>{log.agent_role}</span>
      <div style={css.logDurTrack}>
        {log.duration_ms != null && (
          <div
            style={{
              height: "100%",
              width: `${durationPct}%`,
              backgroundColor: `${color}66`,
              borderRadius: "1.5px",
            }}
          />
        )}
      </div>
      {log.duration_ms != null && (
        <span style={css.logTime}>{(log.duration_ms / 1000).toFixed(1)}s</span>
      )}
    </div>
  );
}

function ErrorState({ message }: { readonly message: string }) {
  return (
    <div style={css.page}>
      <GlobalStyles />
      <div style={css.emptyWrap}>
        <div style={{ ...css.emptyIcon, borderColor: `${T.red}33` }}>
          <IconAlertTriangle size={22} color={T.red} strokeWidth={1.5} />
        </div>
        <p style={{ ...css.emptyText, color: T.red }}>{message}</p>
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
    fontFamily: T.sans,
    backgroundColor: T.bg,
    color: T.textSoft,
    minHeight: "100vh",
    padding: "12px 14px 16px",
    fontSize: "12px",
    lineHeight: 1.5,
    maxWidth: "1100px",
    margin: "0 auto",
  } as React.CSSProperties,

  // ── Header
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "10px",
  } as React.CSSProperties,
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minWidth: 0,
  } as React.CSSProperties,
  logoMark: {
    width: "26px",
    height: "26px",
    borderRadius: "8px",
    background: `linear-gradient(135deg, ${T.brand}, ${T.brandDeep})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: `0 0 20px -6px ${T.brand}88`,
  } as React.CSSProperties,
  headerText: {
    minWidth: 0,
  } as React.CSSProperties,
  brandRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
  } as React.CSSProperties,
  brandName: {
    fontSize: "11px",
    fontWeight: 700,
    color: T.text,
    letterSpacing: "0.18em",
    fontFamily: T.mono,
  } as React.CSSProperties,
  ticketNum: {
    fontSize: "10px",
    fontWeight: 600,
    color: T.brand,
    fontFamily: T.mono,
    letterSpacing: "0.04em",
  } as React.CSSProperties,
  clientName: {
    fontSize: "11px",
    fontWeight: 500,
    color: T.textMute,
    maxWidth: "300px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    marginTop: "1px",
  } as React.CSSProperties,
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexShrink: 0,
  } as React.CSSProperties,
  secBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "8px",
    fontWeight: 700,
    padding: "3px 8px",
    borderRadius: "99px",
    backgroundColor: "rgba(255,77,94,0.10)",
    color: T.red,
    border: `1px solid rgba(255,77,94,0.28)`,
    letterSpacing: "0.14em",
    fontFamily: T.mono,
  } as React.CSSProperties,
  secDot: {
    width: "5px",
    height: "5px",
    borderRadius: "50%",
    backgroundColor: T.red,
  } as React.CSSProperties,
  timestamp: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "10px",
    color: T.textFaint,
    fontWeight: 500,
    fontFamily: T.mono,
  } as React.CSSProperties,

  // ── Severity band
  severityBand: {
    display: "flex",
    alignItems: "stretch",
    marginBottom: "12px",
    background: `linear-gradient(180deg, ${T.surface2}, ${T.surface1})`,
    border: `1px solid ${T.line}`,
    borderRadius: "10px",
    overflow: "hidden",
  } as React.CSSProperties,
  sevCell: {
    flex: "1 1 0",
    padding: "8px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "3px",
    minWidth: 0,
  } as React.CSSProperties,
  sevDivider: {
    width: "1px",
    background: `linear-gradient(180deg, transparent, ${T.line}, transparent)`,
    alignSelf: "stretch",
  } as React.CSSProperties,
  sevLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "8px",
    fontWeight: 600,
    color: T.textMute,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    fontFamily: T.mono,
  } as React.CSSProperties,
  sevValueBig: {
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: 1.15,
    letterSpacing: "-0.01em",
  } as React.CSSProperties,
  sevValue: {
    fontSize: "13px",
    fontWeight: 600,
    color: T.text,
    textTransform: "capitalize" as const,
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  sevSub: {
    fontSize: "10px",
    color: T.textMute,
    fontWeight: 500,
    textTransform: "capitalize" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  sevDim: {
    fontSize: "11px",
    fontWeight: 500,
    opacity: 0.4,
  } as React.CSSProperties,
  sevTrack: {
    height: "4px",
    backgroundColor: T.surface3,
    borderRadius: "2px",
    overflow: "hidden",
    marginTop: "6px",
  } as React.CSSProperties,

  // ── Security alert
  secAlert: {
    display: "flex",
    gap: "12px",
    marginBottom: "12px",
    padding: "8px 12px",
    background: "linear-gradient(135deg, rgba(255,77,94,0.08), rgba(255,77,94,0.02))",
    border: "1px solid rgba(255,77,94,0.22)",
    borderRadius: "10px",
  } as React.CSSProperties,
  secAlertIcon: {
    width: "32px",
    height: "32px",
    borderRadius: "8px",
    backgroundColor: "rgba(255,77,94,0.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  } as React.CSSProperties,
  secAlertTitle: {
    fontSize: "11px",
    fontWeight: 700,
    color: T.red,
    marginBottom: "3px",
  } as React.CSSProperties,
  secAlertText: {
    color: "#ffb3ba",
    margin: 0,
    fontSize: "11.5px",
    lineHeight: 1.55,
  } as React.CSSProperties,

  // ── Duplicates + evidence
  dupeBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap" as const,
    marginBottom: "10px",
    padding: "7px 12px",
    background: "linear-gradient(135deg, rgba(245,200,76,0.07), rgba(245,200,76,0.02))",
    border: "1px solid rgba(245,200,76,0.2)",
    borderRadius: "8px",
  } as React.CSSProperties,
  dupeLabel: {
    fontSize: "8px",
    fontWeight: 700,
    color: T.amber,
    letterSpacing: "0.12em",
    fontFamily: T.mono,
  } as React.CSSProperties,
  dupeChip: {
    fontSize: "10.5px",
    fontWeight: 600,
    color: T.text,
    backgroundColor: "rgba(245,200,76,0.08)",
    padding: "2px 9px",
    borderRadius: "6px",
  } as React.CSSProperties,
  dupePct: {
    color: T.amber,
    fontFamily: T.mono,
    fontSize: "9.5px",
    fontWeight: 700,
  } as React.CSSProperties,
  dupeSummary: {
    color: T.textMute,
    fontWeight: 400,
    fontSize: "10px",
  } as React.CSSProperties,
  analyzedBar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "10px",
    padding: "5px 12px",
    background: T.surface1,
    border: `1px solid ${T.lineSoft}`,
    borderRadius: "7px",
  } as React.CSSProperties,
  analyzedText: {
    fontSize: "10px",
    color: T.textMute,
    fontFamily: T.mono,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,

  // ── Actions
  actionsWrap: {
    marginBottom: "10px",
    position: "relative" as const,
    zIndex: 30,
  } as React.CSSProperties,

  // ── Sections
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: "9px",
    fontWeight: 600,
    color: T.textMute,
    textTransform: "uppercase" as const,
    letterSpacing: "0.14em",
    flex: 1,
    fontFamily: T.mono,
  } as React.CSSProperties,
  sectionCount: {
    fontSize: "9px",
    fontWeight: 600,
    color: T.brand,
    backgroundColor: "rgba(139,124,255,0.10)",
    padding: "1px 7px",
    borderRadius: "99px",
    fontFamily: T.mono,
  } as React.CSSProperties,

  // ── Findings
  findingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "8px",
  } as React.CSSProperties,
  findingCard: {
    background: T.surface1,
    border: `1px solid ${T.lineSoft}`,
    borderRadius: "8px",
    padding: "10px 12px",
  } as React.CSSProperties,
  findingTop: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "7px",
  } as React.CSSProperties,
  findingAvatar: {
    width: "24px",
    height: "24px",
    borderRadius: "6px",
    background: "linear-gradient(135deg, rgba(139,124,255,0.22), rgba(139,124,255,0.08))",
    border: "1px solid rgba(139,124,255,0.25)",
    color: T.brand,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: "8px",
    flexShrink: 0,
    fontFamily: T.mono,
    letterSpacing: "0.05em",
  } as React.CSSProperties,
  findingName: {
    fontSize: "11.5px",
    fontWeight: 600,
    color: T.text,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  findingText: {
    color: T.textSoft,
    margin: 0,
    fontSize: "11px",
    lineHeight: 1.6,
  } as React.CSSProperties,

  // ── Timeline
  notesSection: {
    marginBottom: "12px",
  } as React.CSSProperties,
  timeline: {
    display: "flex",
    flexDirection: "column" as const,
  } as React.CSSProperties,
  timelineRow: {
    display: "flex",
    gap: "10px",
  } as React.CSSProperties,
  timelineRail: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    width: "10px",
    flexShrink: 0,
    paddingTop: "13px",
  } as React.CSSProperties,
  timelineNode: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    flexShrink: 0,
  } as React.CSSProperties,
  timelineLine: {
    width: "1px",
    flex: 1,
    background: `linear-gradient(180deg, ${T.line}, ${T.lineSoft})`,
    marginTop: "4px",
  } as React.CSSProperties,

  // ── Body text
  bodyText: {
    color: T.textSoft,
    margin: 0,
    whiteSpace: "pre-wrap" as const,
    fontSize: "11.5px",
    lineHeight: 1.7,
  } as React.CSSProperties,

  // ── Agent logs
  logGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1px",
  } as React.CSSProperties,
  logRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "5px 6px",
    borderRadius: "5px",
    fontSize: "11px",
  } as React.CSSProperties,
  logDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    flexShrink: 0,
  } as React.CSSProperties,
  logName: {
    fontWeight: 600,
    color: T.text,
    minWidth: "110px",
    fontSize: "11px",
  } as React.CSSProperties,
  logRole: {
    color: T.textFaint,
    fontSize: "10px",
    minWidth: "120px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  logDurTrack: {
    flex: 1,
    height: "3px",
    backgroundColor: T.surface2,
    borderRadius: "1.5px",
    overflow: "hidden",
  } as React.CSSProperties,
  logTime: {
    color: T.textMute,
    fontSize: "10px",
    fontWeight: 500,
    fontFamily: T.mono,
    minWidth: "36px",
    textAlign: "right" as const,
  } as React.CSSProperties,

  // ── Footer
  footer: {
    display: "flex",
    gap: "14px",
    justifyContent: "center",
    alignItems: "center",
    marginTop: "12px",
    paddingTop: "12px",
    borderTop: `1px solid ${T.lineSoft}`,
  } as React.CSSProperties,
  footerStat: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    color: T.textFaint,
    fontSize: "9.5px",
    fontWeight: 500,
    fontFamily: T.mono,
    letterSpacing: "0.04em",
  } as React.CSSProperties,

  // ── Empty / Error
  emptyWrap: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "260px",
    gap: "14px",
  } as React.CSSProperties,
  emptyIcon: {
    width: "48px",
    height: "48px",
    borderRadius: "12px",
    background: `linear-gradient(180deg, ${T.surface2}, ${T.surface1})`,
    border: `1px solid ${T.line}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as React.CSSProperties,
  emptyText: {
    color: T.textMute,
    textAlign: "center" as const,
    maxWidth: "300px",
    fontSize: "12.5px",
    lineHeight: 1.5,
    fontWeight: 500,
  } as React.CSSProperties,
};
