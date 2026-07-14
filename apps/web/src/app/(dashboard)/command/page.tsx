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
  Skull,
  ArrowUpRight,
  Tv,
} from "lucide-react";

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
interface Shame {
  readonly tech: string;
  readonly score: number;
  readonly reasons: ReadonlyArray<string>;
}
interface Payload {
  readonly metrics: {
    readonly open: number;
    readonly breaching: number;
    readonly unassigned: number;
    readonly waitingOnTech: number;
    readonly customerReply: number;
    readonly unackedReplies: number;
  };
  readonly statusCounts: ReadonlyArray<StatusCount>;
  readonly breaches: ReadonlyArray<Breach>;
  readonly techStats: ReadonlyArray<TechStat>;
  readonly wallOfShame: ReadonlyArray<Shame>;
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
    const res = await fetch("/api/tv/link", { method: "POST", cache: "no-store" });
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
      const res = await fetch("/api/command-center", { cache: "no-store" });
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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: `linear-gradient(135deg, ${RED}, #7f1d1d)`, boxShadow: `0 0 24px -6px ${RED}` }}
          >
            <LayoutDashboard className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">Command Center</h1>
            <p className="hidden text-sm text-zinc-400 sm:block">Tickets, tech stats, live SLA breaches, and the wall of shame</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void openTvMode()}
            aria-label="Open TV Mode"
            className="flex h-10 w-10 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm text-zinc-300 transition hover:text-white sm:w-auto sm:px-3"
            style={{ borderColor: HAIRLINE, background: PANEL }}
            title="Create and open a one-time TV wallboard link"
          >
            <Tv className="h-4 w-4" />
            <span className="hidden sm:inline">TV Mode</span>
          </button>
          <button
            onClick={() => void load(true)}
            aria-label="Refresh Command Center"
            title="Refresh Command Center"
            className="flex h-10 w-10 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm text-zinc-300 transition hover:text-white sm:w-auto sm:px-3"
            style={{ borderColor: HAIRLINE, background: PANEL }}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border p-4 text-sm text-red-300" style={{ borderColor: HAIRLINE, background: PANEL }}>
          Couldn&apos;t load: {error}
        </div>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Tile label="Open Tickets" value={m?.open ?? 0} icon={<LayoutDashboard className="h-5 w-5" />} accent="#a1a1aa" />
        <Tile label="Breaching Now" value={m?.breaching ?? 0} icon={<TriangleAlert className="h-5 w-5" />} accent={RED} emphasis />
        <Tile label="Unacked Replies" value={m?.unackedReplies ?? 0} icon={<MessageSquareWarning className="h-5 w-5" />} accent="#f59e0b" emphasis />
        <Tile label="Waiting on Tech" value={m?.waitingOnTech ?? 0} icon={<Clock className="h-5 w-5" />} accent="#fb923c" />
        <Tile label="Unassigned" value={m?.unassigned ?? 0} icon={<UserX className="h-5 w-5" />} accent="#f87171" />
      </div>

      <TeamAvailability />

      {/* Status breakdown */}
      <Section title="Tickets by Status">
        {loading && !data ? (
          <div className="p-5 text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="space-y-2 p-4">
            {data!.statusCounts.map((s) => (
              <div key={s.status} className="flex items-center gap-3">
                <div className="w-40 shrink-0 text-xs text-zinc-300">{s.status}</div>
                <div className="h-5 flex-1 overflow-hidden rounded" style={{ background: "#0f0a0c" }}>
                  <div
                    className="flex h-full items-center rounded pl-2 text-[10px] font-bold text-white"
                    style={{ width: `${Math.max(6, (s.count / maxStatus) * 100)}%`, background: statusColor(s.status) }}
                  >
                    {s.count}
                  </div>
                </div>
                {s.breaching > 0 && (
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: RED }}>
                    {s.breaching} breaching
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Wall of Shame */}
        <Section title="Wall of Shame" icon={<Skull className="h-4 w-4" style={{ color: RED }} />}>
          {loading && !data ? (
            <div className="p-5 text-sm text-zinc-500">Loading…</div>
          ) : (data?.wallOfShame.length ?? 0) === 0 ? (
            <div className="p-5 text-sm text-zinc-400">Nobody on the wall right now — clean board.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: HAIRLINE }}>
              {data!.wallOfShame.map((w, i) => (
                <div key={w.tech} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: i === 0 ? RED : "#7f1d1d" }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white">{w.tech}</div>
                    <ul className="mt-0.5 space-y-0.5">
                      {w.reasons.map((r) => (
                        <li key={r} className="text-xs text-zinc-400">
                          • {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Currently breaching */}
        <Section title="Currently Breaching SLA" icon={<TriangleAlert className="h-4 w-4" style={{ color: RED }} />}>
          {loading && !data ? (
            <div className="p-5 text-sm text-zinc-500">Loading…</div>
          ) : (data?.breaches.length ?? 0) === 0 ? (
            <div className="p-5 text-sm text-zinc-400">No live SLA breaches.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: HAIRLINE }}>
              {data!.breaches.map((b) => (
                <a
                  key={b.halo_id}
                  href={haloLink(data!.haloBaseUrl, b.halo_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-5 py-2.5 hover:bg-white/[0.02]"
                >
                  <span className="font-mono text-sm font-bold text-white">#{b.halo_id}</span>
                  <ArrowUpRight className="h-3 w-3 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{b.summary}</span>
                  <span className="text-xs text-zinc-400">{b.halo_agent ?? "Unassigned"}</span>
                </a>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Tech stats */}
      <Section title="Tech Stats">
        {loading && !data ? (
          <div className="p-5 text-sm text-zinc-500">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-2 font-medium">Tech</th>
                  <th className="px-5 py-2 font-medium">Open</th>
                  <th className="px-5 py-2 font-medium">Breaching</th>
                  <th className="px-5 py-2 font-medium">Waiting on Tech</th>
                  <th className="px-5 py-2 font-medium">Unacked</th>
                  <th className="px-5 py-2 font-medium">Poor Reviews (30d)</th>
                </tr>
              </thead>
              <tbody>
                {data!.techStats.map((t) => (
                  <tr key={t.tech} className="border-t" style={{ borderColor: HAIRLINE }}>
                    <td className="px-5 py-2.5 font-medium text-white/90">{t.tech}</td>
                    <td className="px-5 py-2.5 text-zinc-300">{t.openTickets}</td>
                    <td className="px-5 py-2.5" style={{ color: t.breaching > 0 ? RED : "#71717a" }}>{t.breaching}</td>
                    <td className="px-5 py-2.5 text-zinc-300">{t.waitingOnTech}</td>
                    <td className="px-5 py-2.5" style={{ color: t.unackedReplies > 0 ? "#f59e0b" : "#71717a" }}>{t.unackedReplies}</td>
                    <td className="px-5 py-2.5" style={{ color: t.poorReviews > 0 ? "#f87171" : "#71717a" }}>{t.poorReviews}</td>
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
      const res = await fetch("/api/dispatch/board", { cache: "no-store" });
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

  if (!techs || techs.length === 0) return null;

  const available = techs.filter((tech) => tech.status.state === "available").length;
  const unavailableStates = new Set(["off", "after_hours", "away", "unreachable", "unknown"]);
  const unavailable = techs.filter((tech) => unavailableStates.has(tech.status.state)).length;
  const active = techs.length - available - unavailable;

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
      <div className="grid grid-cols-1 gap-px overflow-hidden md:grid-cols-2" style={{ background: HAIRLINE }}>
        {techs.map((t) => {
          const color = presenceColor(t.status.state);
          const until = t.status.state === "onsite" || t.status.state === "meeting" ? untilTime(t.status.detail) : null;
          const hint = commitmentHint(t.nextCommitment);
          const detail = (until ? `Until ${until}` : null) ?? t.status.detail ?? hint ?? (t.status.state === "available" ? "Ready for assignment" : null);
          return (
            <div
              key={t.tech}
              className="flex min-h-14 items-center gap-2.5 px-4 py-2.5"
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
    </Section>
  );
}

function Tile({
  label,
  value,
  icon,
  accent,
  emphasis,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: React.ReactNode;
  readonly accent: string;
  readonly emphasis?: boolean;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: emphasis && value > 0 ? accent : HAIRLINE,
        background: PANEL,
        boxShadow: emphasis && value > 0 ? `0 0 20px -8px ${accent}` : "none",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-bold" style={{ color: value > 0 ? accent : "#e4e4e7" }}>
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  actions,
  children,
}: {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly actions?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border" style={{ borderColor: HAIRLINE, background: PANEL }}>
      <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
