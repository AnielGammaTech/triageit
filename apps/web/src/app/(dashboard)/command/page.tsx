"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  TriangleAlert,
  RefreshCw,
  UserX,
  Users,
  Clock,
  MessageSquareWarning,
  ArrowUpRight,
  Tv,
  Timer,
  Wrench,
  X,
  Trophy,
} from "lucide-react";
import { ResponseCompliancePanel } from "@/components/dispatch/response-compliance-panel";
import { fetchWithTimeout } from "@/lib/async-timeout";
import type { CommandScore } from "@/lib/api/command-center-data";

interface StatusCount {
  readonly status: string;
  readonly count: number;
  readonly breaching: number;
}
interface Breach {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly alertCount: number;
  readonly breachingForMin: number | null;
}
interface TechStat {
  readonly tech: string;
  readonly openTickets: number;
  readonly breaching: number;
  readonly waitingOnTech: number;
  readonly unackedReplies: number;
  readonly poorReviews: number;
  readonly worstGapHours: number;
}
interface AtRiskTicket {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly dueInMin: number;
}
interface QueueTicket {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent?: string | null;
  readonly ageMin: number;
}
interface Payload {
  readonly metrics: {
    readonly open: number;
    readonly breaching: number;
    readonly atRisk: number;
    readonly unassigned: number;
    readonly waitingOnTech: number;
    readonly customerReply: number;
    readonly unackedReplies: number;
  };
  readonly statusCounts: ReadonlyArray<StatusCount>;
  readonly breaches: ReadonlyArray<Breach>;
  readonly atRisk: ReadonlyArray<AtRiskTicket>;
  readonly oldestTickets: ReadonlyArray<QueueTicket>;
  readonly customerReplyTickets: ReadonlyArray<QueueTicket>;
  readonly techStats: ReadonlyArray<TechStat>;
  readonly scoreboard: ReadonlyArray<CommandScore>;
  readonly haloBaseUrl: string;
}

const RED = "#dc2626";
const PANEL = "#151013";
const HAIRLINE = "#3a1f24";

// Halo-ish status colors
const STATUS_COLOR: Record<string, string> = {
  "past-due": "#9f0500",
  "customer reply": "#ab149e",
  "waiting on tech": "#fe9200",
  "waiting on customer": "#653294",
  "in progress": "#0f75b1",
  scheduled: "#194d33",
  new: "#a1c652",
  "waiting on parts": "#c026d3",
  "needs quote": "#d946ef",
};
function statusColor(s: string): string {
  return STATUS_COLOR[s.toLowerCase()] ?? "#64748b";
}
function haloLink(base: string, id: number): string {
  return base ? `${base}/tickets?id=${id}` : "#";
}
function durationLabel(minutes: number): string {
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

// ── Team presence (worker dispatch board via /api/dispatch/board) ──
interface PresenceTech {
  readonly tech: string;
  readonly status: { readonly state: string; readonly detail: string | null };
  readonly nextCommitment: string | null;
}
interface PresenceBoard {
  readonly techs: ReadonlyArray<PresenceTech>;
}

const PRESENCE_COLOR: Record<string, string> = {
  available: "#22c55e",
  working: "#38bdf8",
  on_call: "#0f75b1",
  meeting: "#f59e0b",
  onsite: "#fe9200",
  dnd: "#e879f9",
  away: "#a1a1aa",
  after_hours: "#a1a1aa",
  off: "#71717a",
  unreachable: "#f87171",
  unknown: "#f87171",
};
const PRESENCE_LABEL: Record<string, string> = {
  available: "Available",
  working: "Working",
  on_call: "On Call",
  meeting: "Meeting",
  onsite: "Onsite",
  dnd: "DND",
  away: "Away",
  after_hours: "After Hours",
  off: "Off",
  unreachable: "Unreachable",
  unknown: "No Signal",
};
function presenceColor(state: string): string {
  return PRESENCE_COLOR[state] ?? "#f87171";
}
function presenceLabel(state: string): string {
  return PRESENCE_LABEL[state] ?? state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "Onsite — Allen Concrete until 4:00 PM" → "4:00 PM" (null when not parseable). */
function untilTime(detail: string | null): string | null {
  const m = detail?.match(/\buntil (.+)$/i);
  return m ? m[1] : null;
}

/** "Site Visit: Jenn :: Laptop Setup — Mon 1:00 PM" → "→ Mon 1:00 PM Site Visit" (future only, hard-truncated). */
function commitmentHint(nextCommitment: string | null): string | null {
  if (!nextCommitment) return null;
  const dash = nextCommitment.lastIndexOf(" — ");
  if (dash === -1) return null;
  const when = nextCommitment.slice(dash + 3).trim();
  if (!when || /^until\b/i.test(when)) return null; // happening now — the status chip covers it
  const colon = nextCommitment.indexOf(":");
  const kind = colon > 0 ? nextCommitment.slice(0, colon).trim() : "";
  const hint = `→ ${when}${kind ? ` ${kind}` : ""}`;
  return hint.length > 28 ? `${hint.slice(0, 27)}…` : hint;
}

/** Create a one-time wallboard link and open it in a new tab. */
async function openTvMode(): Promise<void> {
  try {
    const res = await fetchWithTimeout("/api/tv/link", { method: "POST", cache: "no-store" }, undefined, "TV link");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      window.alert(body?.error ?? "TV link unavailable — is TV_DASHBOARD_KEY set on the web service?");
      return;
    }
    const { setupUrl } = (await res.json()) as { setupUrl: string };
    window.open(setupUrl, "_blank", "noopener");
  } catch {
    window.alert("Couldn't fetch the TV link.");
  }
}

export default function CommandPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const res = await fetchWithTimeout("/api/command-center", { cache: "no-store" }, undefined, "Command Center");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as Payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const m = data?.metrics;
  const maxStatus = Math.max(1, ...(data?.statusCounts ?? []).map((s) => s.count));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-md"
            style={{ background: "#991b1b" }}
          >
            <LayoutDashboard className="h-4.5 w-4.5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white">Command Center</h1>
            <p className="hidden text-xs text-zinc-500 sm:block">Live load, team coverage, SLA exceptions, and accountability</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void openTvMode()}
            aria-label="Open TV Mode"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-zinc-400 transition hover:bg-white/[0.03] hover:text-white"
            style={{ borderColor: HAIRLINE, background: PANEL }}
            title="Create and open a one-time TV wallboard link"
          >
            <Tv className="h-4 w-4" />
          </button>
          <button
            onClick={() => void load(true)}
            aria-label="Refresh Command Center"
            title="Refresh Command Center"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-zinc-400 transition hover:bg-white/[0.03] hover:text-white"
            style={{ borderColor: HAIRLINE, background: PANEL }}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border p-4 text-sm text-red-300" style={{ borderColor: HAIRLINE, background: PANEL }}>
          Couldn&apos;t load: {error}
        </div>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border sm:grid-cols-5" style={{ borderColor: HAIRLINE, background: HAIRLINE }}>
        <Tile label="Open Tickets" value={m?.open ?? 0} icon={<LayoutDashboard className="h-5 w-5" />} accent="#a1a1aa" />
        <Tile label="Breaching Now" value={m?.breaching ?? 0} icon={<TriangleAlert className="h-5 w-5" />} accent={RED} emphasis />
        <Tile label="Unacked Replies" value={m?.unackedReplies ?? 0} icon={<MessageSquareWarning className="h-5 w-5" />} accent="#f59e0b" emphasis />
        <Tile label="Waiting on Tech" value={m?.waitingOnTech ?? 0} icon={<Clock className="h-5 w-5" />} accent="#fb923c" />
        <Tile className="col-span-2 sm:col-span-1" label="Unassigned" value={m?.unassigned ?? 0} icon={<UserX className="h-5 w-5" />} accent="#f87171" />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <TeamAvailability />
        </div>
        <div className="xl:col-span-5">
          <Section title="Tickets by Status">
            {loading && !data ? (
              <div className="p-4 text-sm text-zinc-500">Loading…</div>
            ) : (
              <div className="space-y-1.5 p-3">
                {data!.statusCounts.map((s) => (
                  <div key={s.status} className="flex items-center gap-2">
                    <div className="w-32 shrink-0 truncate text-xs text-zinc-300" title={s.status}>{s.status}</div>
                    <div className="h-4 flex-1 overflow-hidden rounded-sm" style={{ background: "#0f0a0c" }}>
                      <div
                        className="flex h-full items-center rounded-sm pl-1.5 text-[10px] font-bold text-white"
                        style={{ width: `${Math.max(6, (s.count / maxStatus) * 100)}%`, background: statusColor(s.status) }}
                      >
                        {s.count}
                      </div>
                    </div>
                    {s.breaching > 0 && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: RED }}>
                        {s.breaching} SLA
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>

      <ResponseCompliancePanel haloBaseUrl={data?.haloBaseUrl ?? ""} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OperationalQueue
          title="Waiting on Tech"
          count={m?.waitingOnTech ?? 0}
          color="#fb923c"
          icon={<Wrench className="h-4 w-4" />}
          loading={loading && !data}
          emptyLabel="No tickets are waiting on a technician."
          haloBaseUrl={data?.haloBaseUrl ?? ""}
          items={(data?.oldestTickets ?? []).map((ticket) => ({
            id: ticket.halo_id,
            client: ticket.client_name,
            summary: ticket.summary,
            owner: ticket.halo_agent,
            badge: `WAITING ${durationLabel(ticket.ageMin)}`,
          }))}
        />
        <OperationalQueue
          title="Customer Replies"
          count={m?.customerReply ?? 0}
          color="#e879f9"
          icon={<MessageSquareWarning className="h-4 w-4" />}
          loading={loading && !data}
          emptyLabel="No customer replies are waiting for a technician."
          haloBaseUrl={data?.haloBaseUrl ?? ""}
          items={(data?.customerReplyTickets ?? []).map((ticket) => ({
            id: ticket.halo_id,
            client: ticket.client_name,
            summary: ticket.summary,
            owner: ticket.halo_agent,
            badge: `REPLIED ${durationLabel(ticket.ageMin)} AGO`,
          }))}
        />
        <OperationalQueue
          title="SLA Expiring <2h"
          count={m?.atRisk ?? 0}
          color="#f59e0b"
          icon={<Timer className="h-4 w-4" />}
          loading={loading && !data}
          emptyLabel="No SLAs expire in the next two hours."
          haloBaseUrl={data?.haloBaseUrl ?? ""}
          items={(data?.atRisk ?? []).map((ticket) => ({
            id: ticket.halo_id,
            client: ticket.client_name,
            summary: ticket.summary,
            owner: ticket.halo_agent,
            badge: `DUE IN ${durationLabel(ticket.dueInMin)}`,
          }))}
        />
        <OperationalQueue
          title="Currently Breaching SLA"
          count={m?.breaching ?? 0}
          color={RED}
          icon={<TriangleAlert className="h-4 w-4" />}
          loading={loading && !data}
          emptyLabel="No live SLA breaches."
          haloBaseUrl={data?.haloBaseUrl ?? ""}
          items={(data?.breaches ?? []).map((ticket) => ({
            id: ticket.halo_id,
            client: ticket.client_name,
            summary: ticket.summary,
            owner: ticket.halo_agent,
            badge: ticket.breachingForMin !== null
              ? `BREACHED ${durationLabel(ticket.breachingForMin)}`
              : `${ticket.alertCount}× ALERTED`,
          }))}
        />
      </div>

      <ScoreboardSection
        scores={data?.scoreboard ?? []}
        haloBaseUrl={data?.haloBaseUrl ?? ""}
        loading={loading && !data}
      />

      {/* Tech stats */}
      <Section title="Tech Stats">
        {loading && !data ? (
          <div className="p-5 text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2 font-medium">Tech</th>
                  <th className="px-4 py-2 font-medium">Open</th>
                  <th className="px-4 py-2 font-medium">Breaching</th>
                  <th className="px-4 py-2 font-medium">Waiting on Tech</th>
                  <th className="px-4 py-2 font-medium">Unacked</th>
                  <th className="px-4 py-2 font-medium">Poor Reviews (30d)</th>
                </tr>
              </thead>
              <tbody>
                {data!.techStats.map((t) => (
                  <tr key={t.tech} className="border-t" style={{ borderColor: HAIRLINE }}>
                    <td className="px-4 py-2 font-medium text-white/90">{t.tech}</td>
                    <td className="px-4 py-2 text-zinc-300">{t.openTickets}</td>
                    <td className="px-4 py-2" style={{ color: t.breaching > 0 ? RED : "#71717a" }}>{t.breaching}</td>
                    <td className="px-4 py-2 text-zinc-300">{t.waitingOnTech}</td>
                    <td className="px-4 py-2" style={{ color: t.unackedReplies > 0 ? "#f59e0b" : "#71717a" }}>{t.unackedReplies}</td>
                    <td className="px-4 py-2" style={{ color: t.poorReviews > 0 ? "#f87171" : "#71717a" }}>{t.poorReviews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * Compact team presence roster fed by the worker dispatch board. Best-effort:
 * renders nothing until the board loads and keeps the last good snapshot on
 * refresh errors.
 */
function TeamAvailability() {
  const [techs, setTechs] = useState<ReadonlyArray<PresenceTech> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithTimeout("/api/dispatch/board", { cache: "no-store" }, undefined, "Team availability");
      if (!res.ok) return; // keep last good snapshot
      const board = (await res.json()) as PresenceBoard;
      if (Array.isArray(board.techs)) setTechs(board.techs);
    } catch {
      /* network blip — keep last good snapshot */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const roster = techs ?? [];
  const available = roster.filter((tech) => tech.status.state === "available").length;
  const unavailableStates = new Set(["off", "after_hours", "away", "unreachable", "unknown"]);
  const unavailable = roster.filter((tech) => unavailableStates.has(tech.status.state)).length;
  const active = roster.length - available - unavailable;

  return (
    <Section
      title="Team Availability"
      icon={<Users className="h-4 w-4" style={{ color: "#f59e0b" }} />}
      actions={
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <span><strong className="text-emerald-400">{available}</strong> available</span>
          <span className="text-zinc-700">·</span>
          <span><strong className="text-sky-400">{active}</strong> active</span>
          <span className="hidden text-zinc-700 sm:inline">·</span>
          <span className="hidden sm:inline"><strong className="text-zinc-400">{unavailable}</strong> off</span>
        </div>
      }
    >
      {!techs ? (
        <div className="p-4 text-sm text-zinc-500">Loading team coverage…</div>
      ) : techs.length === 0 ? (
        <div className="p-4 text-sm text-zinc-500">No roster data is available.</div>
      ) : (
        <div className="grid grid-cols-1 gap-px overflow-hidden sm:grid-cols-2 xl:grid-cols-3" style={{ background: HAIRLINE }}>
        {techs.map((t) => {
          const color = presenceColor(t.status.state);
          const until = t.status.state === "onsite" || t.status.state === "meeting" ? untilTime(t.status.detail) : null;
          const hint = commitmentHint(t.nextCommitment);
          const detail = (until ? `Until ${until}` : null) ?? t.status.detail ?? hint ?? (t.status.state === "available" ? "Ready for assignment" : null);
          return (
            <div
              key={t.tech}
              className="flex min-h-12 items-center gap-2.5 px-3 py-2"
              style={{ background: PANEL }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-semibold text-white/90">{t.tech}</span>
                  <span className="shrink-0 text-[10px] font-bold uppercase" style={{ color }}>
                    {presenceLabel(t.status.state)}
                  </span>
                </div>
                {detail && <p className="mt-0.5 truncate text-xs text-zinc-500" title={detail}>{detail}</p>}
              </div>
            </div>
          );
        })}
        </div>
      )}
    </Section>
  );
}

function signedScore(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function reviewPointLabel(review: CommandScore["evidence"]["reviews"][number]): string {
  const parts: string[] = [];
  if (review.positivePoints > 0) parts.push(`+${review.positivePoints} review`);
  if (review.delayPenaltyPoints > 0) parts.push(`−${review.delayPenaltyPoints} delay`);
  return parts.length > 0 ? `${parts.join(" ")} = ${signedScore(review.points)}` : "0 points";
}

function ScoreboardSection({
  scores,
  haloBaseUrl,
  loading,
}: {
  readonly scores: ReadonlyArray<CommandScore>;
  readonly haloBaseUrl: string;
  readonly loading: boolean;
}) {
  const [selected, setSelected] = useState<CommandScore | null>(null);

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selected]);

  return (
    <>
      <Section
        title="Tech Scoreboard"
        icon={<Trophy className="h-4 w-4 text-amber-400" />}
        actions={<span className="text-[11px] text-zinc-500">Today + verified 30-day reviews</span>}
      >
        {loading ? (
          <div className="p-5 text-sm text-zinc-500">Loading score evidence…</div>
        ) : scores.length === 0 ? (
          <div className="p-5 text-sm text-zinc-500">No technician score evidence is available yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2 font-medium">Rank / Tech</th>
                  <th className="px-4 py-2 font-medium">Exact score equation</th>
                  <th className="px-4 py-2 font-medium">Context only</th>
                  <th className="px-4 py-2 text-right font-medium">Net</th>
                  <th className="w-36 px-4 py-2 text-right font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((score, index) => {
                  const liveApplied = score.livePenaltyDeferred > 0
                    ? 0
                    : score.slaPenaltyPoints + score.replyPenaltyPoints;
                  return (
                    <tr
                      key={score.tech}
                      className="border-t transition hover:bg-white/[0.02]"
                      style={{ borderColor: HAIRLINE }}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                            style={{
                              background: index === 0 ? "#facc15" : "#21161a",
                              color: index === 0 ? "#111" : "#a1a1aa",
                            }}
                          >
                            {index + 1}
                          </span>
                          <span className="font-semibold text-white/90">{score.tech}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                          <ScoreChip value={score.emailPoints} label="emails" tone="positive" />
                          <span className="text-zinc-600">+</span>
                          <ScoreChip value={score.positiveReviewPoints} label="reviews" tone="positive" />
                          <span className="text-zinc-600">−</span>
                          <ScoreChip value={score.responsePenaltyPoints} label="delays" tone="negative" />
                          {liveApplied > 0 && (
                            <>
                              <span className="text-zinc-600">−</span>
                              <ScoreChip value={liveApplied} label="live" tone="negative" />
                            </>
                          )}
                          {score.livePenaltyDeferred > 0 && (
                            <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">
                              {score.livePenaltyDeferred} live deferred
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">
                        {score.needs} coaching · {score.poor} poor
                        <span className="block text-[10px] text-zinc-600">Labels alone do not deduct points</span>
                      </td>
                      <td
                        className="px-4 py-2.5 text-right font-mono text-lg font-bold"
                        style={{ color: score.score > 0 ? "#4ade80" : score.score < 0 ? "#f87171" : "#a1a1aa" }}
                      >
                        {signedScore(score.score)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setSelected(score)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.04] hover:text-white"
                          style={{ borderColor: HAIRLINE }}
                          data-testid={`command-score-row-${score.tech.replace(/\s+/g, "-")}`}
                        >
                          View score audit
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {selected && (
        <CommandScoreAudit
          score={selected}
          haloBaseUrl={haloBaseUrl}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ScoreChip({
  value,
  label,
  tone,
}: {
  readonly value: number;
  readonly label: string;
  readonly tone: "positive" | "negative";
}) {
  const color = tone === "positive" ? "#86efac" : "#fca5a5";
  const background = tone === "positive" ? "#14532d30" : "#7f1d1d30";
  return (
    <span className="rounded border px-1.5 py-0.5" style={{ borderColor: `${color}45`, background, color }}>
      {value} {label}
    </span>
  );
}

function CommandScoreAudit({
  score,
  haloBaseUrl,
  onClose,
}: {
  readonly score: CommandScore;
  readonly haloBaseUrl: string;
  readonly onClose: () => void;
}) {
  const liveDeferred = score.livePenaltyDeferred > 0;
  const reviews = [...score.evidence.reviews].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const emails = [...score.evidence.emails].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const ticketHref = (haloId: number): string => haloLink(haloBaseUrl, haloId);
  const components = [
    { label: "Customer emails today", value: score.emailPoints, color: "#38bdf8" },
    { label: "Positive reviews", value: score.positiveReviewPoints, color: "#4ade80" },
    { label: "Verified delays", value: -score.responsePenaltyPoints, color: "#f87171" },
    {
      label: `Live SLA${liveDeferred ? " · deferred" : ""}`,
      value: liveDeferred ? 0 : -score.slaPenaltyPoints,
      color: liveDeferred ? "#71717a" : "#f87171",
    },
    {
      label: `Replies >1h${liveDeferred ? " · deferred" : ""}`,
      value: liveDeferred ? 0 : -score.replyPenaltyPoints,
      color: liveDeferred ? "#71717a" : "#f59e0b",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${score.tech} score audit`}
      data-testid="command-score-audit"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{ borderColor: "#5b2029", background: "#100b0d" }}
      >
        <header className="flex items-center gap-4 border-b px-5 py-4" style={{ borderColor: HAIRLINE }}>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-400">Score audit</p>
            <h2 className="truncate text-xl font-semibold text-white">{score.tech}</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Every point below links back to the ticket evidence used.
            </p>
          </div>
          <span
            className="font-mono text-3xl font-bold"
            style={{ color: score.score > 0 ? "#4ade80" : score.score < 0 ? "#f87171" : "#a1a1aa" }}
          >
            {signedScore(score.score)}
          </span>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close score audit"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
            style={{ borderColor: HAIRLINE }}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 gap-px border-b sm:grid-cols-5" style={{ borderColor: HAIRLINE, background: HAIRLINE }}>
          {components.map((component) => (
            <div key={component.label} className="px-4 py-3" style={{ background: PANEL }}>
              <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{component.label}</p>
              <p className="mt-1 font-mono text-xl font-bold" style={{ color: component.color }}>
                {signedScore(component.value)}
              </p>
            </div>
          ))}
        </div>

        {liveDeferred && (
          <div className="border-b bg-amber-950/20 px-5 py-2 text-xs text-amber-200" style={{ borderColor: HAIRLINE }}>
            {score.livePenaltyDeferred} live penalty point{score.livePenaltyDeferred === 1 ? "" : "s"} deferred because the schedule says
            {" "}{score.scheduleReason ?? presenceLabel(score.scheduleState ?? "off")}. The evidence remains visible.
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
          <AuditEvidenceSection title={`Verified reviews · ${reviews.length}`}>
            {reviews.length === 0 ? (
              <AuditEmpty>No reviews are inside the 30-day scoring window.</AuditEmpty>
            ) : reviews.map((review) => (
              <div key={`${review.halo_id}-${review.occurredAt}`} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: HAIRLINE }}>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={ticketHref(review.halo_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs font-bold text-sky-400 hover:underline"
                  >
                    #{review.halo_id} <ArrowUpRight className="inline h-3 w-3" />
                  </a>
                  <span
                    className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase"
                    style={{
                      borderColor: review.points < 0 ? "#7f1d1d" : review.points > 0 ? "#14532d" : "#3f3f46",
                      color: review.points < 0 ? "#fca5a5" : review.points > 0 ? "#86efac" : "#a1a1aa",
                    }}
                  >
                    {review.rating.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs font-semibold text-zinc-300">{reviewPointLabel(review)}</span>
                  <span className="ml-auto text-[10px] text-zinc-500">{review.maxGapHours.toFixed(1)} business h max</span>
                </div>
                {review.summary && <p className="mt-1.5 text-xs leading-5 text-zinc-400">{review.summary}</p>}
              </div>
            ))}
          </AuditEvidenceSection>

          <AuditEvidenceSection title={`Today and live evidence · ${emails.length + score.evidence.live.length}`} rightBorder={false}>
            {score.evidence.live.map((item) => (
              <div key={`live-${item.halo_id}-${item.label}`} className="border-b px-4 py-3" style={{ borderColor: HAIRLINE }}>
                <div className="flex items-start gap-2">
                  <a href={ticketHref(item.halo_id)} target="_blank" rel="noreferrer" className="font-mono text-xs font-bold text-sky-400 hover:underline">
                    #{item.halo_id}
                  </a>
                  <p className="min-w-0 flex-1 text-xs leading-5 text-zinc-300">{item.label}</p>
                  <span className="font-mono text-xs font-bold" style={{ color: liveDeferred ? "#71717a" : "#f87171" }}>
                    {liveDeferred ? "deferred" : signedScore(item.points)}
                  </span>
                </div>
              </div>
            ))}
            {emails.map((email) => (
              <div key={`${email.halo_id}-${email.occurredAt}`} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: HAIRLINE }}>
                <div className="flex items-center gap-2">
                  <a href={ticketHref(email.halo_id)} target="_blank" rel="noreferrer" className="font-mono text-xs font-bold text-sky-400 hover:underline">
                    #{email.halo_id}
                  </a>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{email.label}</span>
                  <span className="font-mono text-xs font-bold text-sky-400">+1</span>
                </div>
              </div>
            ))}
            {score.evidence.live.length === 0 && emails.length === 0 && (
              <AuditEmpty>No customer-email or live-ticket score events exist today.</AuditEmpty>
            )}
          </AuditEvidenceSection>
        </div>

        <footer className="shrink-0 border-t px-5 py-3 text-xs leading-5 text-zinc-500" style={{ borderColor: HAIRLINE }}>
          Formula: customer emails today + positive reviews from the latest 30 days − verified business-hour response delays − applicable live SLA/reply penalties.
          Coaching and poor labels are context only until deterministic evidence verifies a deduction.
        </footer>
      </div>
    </div>
  );
}

function AuditEvidenceSection({
  title,
  rightBorder = true,
  children,
}: {
  readonly title: string;
  readonly rightBorder?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={`min-h-0 lg:overflow-y-auto ${rightBorder ? "lg:border-r" : ""}`} style={{ borderColor: HAIRLINE }}>
      <h3 className="sticky top-0 z-10 border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white" style={{ borderColor: HAIRLINE, background: "#181014" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function AuditEmpty({ children }: { readonly children: React.ReactNode }) {
  return <p className="p-4 text-xs leading-5 text-zinc-500">{children}</p>;
}

function Tile({
  className = "",
  label,
  value,
  icon,
  accent,
  emphasis,
}: {
  readonly className?: string;
  readonly label: string;
  readonly value: number;
  readonly icon: React.ReactNode;
  readonly accent: string;
  readonly emphasis?: boolean;
}) {
  return (
    <div
      className={`flex min-h-[70px] items-center gap-3 px-4 py-3 ${className}`}
      style={{
        background: PANEL,
        boxShadow: emphasis && value > 0 ? `inset 0 2px 0 ${accent}` : "none",
      }}
    >
      <span className="shrink-0" style={{ color: accent }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none tabular-nums" style={{ color: value > 0 ? accent : "#e4e4e7" }}>
          {value}
        </p>
        <span className="mt-1 block text-[10px] font-medium uppercase leading-3 tracking-wide text-zinc-500">{label}</span>
      </div>
    </div>
  );
}

interface OperationalQueueItem {
  readonly id: number;
  readonly client: string | null;
  readonly summary: string | null;
  readonly owner: string | null | undefined;
  readonly badge: string;
}

function OperationalQueue({
  title,
  count,
  color,
  icon,
  loading,
  emptyLabel,
  haloBaseUrl,
  items,
}: {
  readonly title: string;
  readonly count: number;
  readonly color: string;
  readonly icon: React.ReactNode;
  readonly loading: boolean;
  readonly emptyLabel: string;
  readonly haloBaseUrl: string;
  readonly items: ReadonlyArray<OperationalQueueItem>;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = items.slice(0, 3);
  const more = Math.max(0, items.length - visible.length);

  useEffect(() => {
    if (!showAll) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowAll(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showAll]);

  return (
    <>
      <Section
        title={title}
        icon={<span style={{ color }}>{icon}</span>}
        className="flex h-[258px] flex-col"
        actions={(
          <span className="rounded px-2 py-0.5 text-xs font-bold tabular-nums" style={{ color, background: `${color}18` }}>
            {count}
          </span>
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="p-4 text-sm text-zinc-500">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="p-4 text-xs leading-5 text-zinc-500">{emptyLabel}</div>
          ) : (
            <div className="divide-y" style={{ borderColor: HAIRLINE }}>
              {visible.map((item) => (
                <OperationalQueueRow key={item.id} item={item} color={color} haloBaseUrl={haloBaseUrl} />
              ))}
            </div>
          )}
        </div>
        {more > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full cursor-pointer border-t px-3 py-1.5 text-left text-[10px] font-semibold transition hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
            style={{ borderColor: HAIRLINE, color }}
            aria-label={`View all ${count} tickets in ${title}`}
          >
            +{more} more — view full queue
          </button>
        )}
      </Section>

      {showAll && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`queue-dialog-${title.replace(/\W+/g, "-").toLowerCase()}`}
            className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border shadow-2xl"
            style={{ borderColor: HAIRLINE, background: "#100b0d" }}
          >
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: HAIRLINE }}>
              <span style={{ color }}>{icon}</span>
              <div className="min-w-0 flex-1">
                <h2 id={`queue-dialog-${title.replace(/\W+/g, "-").toLowerCase()}`} className="text-base font-semibold text-white">
                  {title}
                </h2>
                <p className="text-xs text-zinc-500">{items.length} live ticket{items.length === 1 ? "" : "s"} · ordered by urgency</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAll(false)}
                autoFocus
                aria-label={`Close ${title}`}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
                style={{ borderColor: HAIRLINE }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto divide-y" style={{ borderColor: HAIRLINE }}>
              {items.map((item) => (
                <OperationalQueueRow key={item.id} item={item} color={color} haloBaseUrl={haloBaseUrl} expanded />
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function OperationalQueueRow({
  item,
  color,
  haloBaseUrl,
  expanded = false,
}: {
  readonly item: OperationalQueueItem;
  readonly color: string;
  readonly haloBaseUrl: string;
  readonly expanded?: boolean;
}) {
  return (
    <a
      href={haloLink(haloBaseUrl, item.id)}
      target="_blank"
      rel="noreferrer"
      className={`block transition hover:bg-white/[0.025] ${expanded ? "px-4 py-3" : "px-3 py-2"}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`shrink-0 font-mono font-bold text-white ${expanded ? "text-xs" : "text-[11px]"}`}>#{item.id}</span>
        <span className={`min-w-0 flex-1 truncate font-medium text-zinc-300 ${expanded ? "text-sm" : "text-xs"}`}>
          {item.client ?? "Unknown customer"}
        </span>
        <ArrowUpRight className="h-3 w-3 shrink-0 text-zinc-600" />
      </div>
      <p className={`mt-0.5 truncate text-zinc-500 ${expanded ? "text-xs" : "text-[11px]"}`} title={item.summary ?? ""}>{item.summary ?? "No summary"}</p>
      <div className={`mt-1 flex items-center justify-between gap-2 ${expanded ? "text-xs" : "text-[10px]"}`}>
        <span className="min-w-0 truncate text-zinc-500">{item.owner ?? "Unassigned"}</span>
        <span className="shrink-0 font-semibold tabular-nums" style={{ color }}>{item.badge}</span>
      </div>
    </a>
  );
}

function Section({
  title,
  icon,
  actions,
  className = "",
  children,
}: {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={`overflow-hidden rounded-md border ${className}`} style={{ borderColor: HAIRLINE, background: PANEL }}>
      <div className="flex min-h-10 items-center gap-2 border-b px-4 py-2" style={{ borderColor: HAIRLINE }}>
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
