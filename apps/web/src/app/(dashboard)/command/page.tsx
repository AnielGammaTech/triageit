"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  TriangleAlert,
  RefreshCw,
  UserX,
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

/** Fetch the key-gated wallboard URL and open it in a new tab. */
async function openTvMode(): Promise<void> {
  try {
    const res = await fetch("/api/tv/link", { cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      window.alert(body?.error ?? "TV link unavailable — is TV_DASHBOARD_KEY set on the web service?");
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener");
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: `linear-gradient(135deg, ${RED}, #7f1d1d)`, boxShadow: `0 0 24px -6px ${RED}` }}
          >
            <LayoutDashboard className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Command Center</h1>
            <p className="text-sm text-zinc-400">Tickets, tech stats, live SLA breaches, and the wall of shame</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void openTvMode()}
            className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-zinc-300 transition hover:text-white"
            style={{ borderColor: HAIRLINE, background: PANEL }}
            title="Open the key-gated TV wallboard link"
          >
            <Tv className="h-4 w-4" />
            TV Mode
          </button>
          <button
            onClick={() => void load(true)}
            className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-zinc-300 transition hover:text-white"
            style={{ borderColor: HAIRLINE, background: PANEL }}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
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

function Section({ title, icon, children }: { readonly title: string; readonly icon?: React.ReactNode; readonly children: React.ReactNode }) {
  return (
    <section className="rounded-xl border" style={{ borderColor: HAIRLINE, background: PANEL }}>
      <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}
