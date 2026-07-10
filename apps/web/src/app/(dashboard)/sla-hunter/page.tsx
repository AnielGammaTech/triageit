"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Siren,
  PhoneCall,
  TriangleAlert,
  Clock,
  ArrowUpRight,
  RefreshCw,
  PhoneOff,
  CheckCircle2,
  User,
  MessageSquare,
  CalendarClock,
  Moon,
} from "lucide-react";

interface BreachRow {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_status: string | null;
  readonly halo_sla_status: string | null;
  readonly sla_breach_alert_count: number | null;
  readonly sla_breach_alerted_at: string | null;
  readonly sla_breach_last_alert_text: string | null;
  readonly sla_breach_last_alert_at: string | null;
}

interface CallRow {
  readonly id: string;
  readonly halo_id: number;
  readonly tech_name: string | null;
  readonly status: string | null;
  readonly objective: string | null;
  readonly created_at: string;
}

interface AtRiskRow {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly halo_agent: string | null;
  readonly halo_status: string | null;
  readonly deadline: string;
  readonly afterHours: boolean;
}

interface Metrics {
  readonly currentlyBreaching: number;
  readonly escalated: number;
  readonly atRisk: number;
  readonly atRiskAfterHours: number;
  readonly callOutsTotal: number;
  readonly callOutsToday: number;
  readonly callOutsThisWeek: number;
  readonly callOutsByStatus: Record<string, number>;
  readonly callOutsByTech: ReadonlyArray<{ readonly tech: string; readonly count: number }>;
}

interface Payload {
  readonly breaches: ReadonlyArray<BreachRow>;
  readonly atRisk: ReadonlyArray<AtRiskRow>;
  readonly calls: ReadonlyArray<CallRow>;
  readonly metrics: Metrics;
  readonly haloBaseUrl: string;
}

const RED = "#dc2626";
const RED_DIM = "#7f1d1d";
const PANEL = "#151013";
const HAIRLINE = "#3a1f24";

function durationSince(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function durationUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function haloLink(base: string, haloId: number): string {
  return base ? `${base}/tickets?id=${haloId}` : "#";
}

export default function SlaHunterPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const res = await fetch("/api/sla-hunter", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Payload;
      setData(json);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: `linear-gradient(135deg, ${RED}, ${RED_DIM})`, boxShadow: `0 0 24px -6px ${RED}` }}
          >
            <Siren className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">SLA Hunter</h1>
            <p className="text-sm text-zinc-400">
              Live SLA breaches and every automated call-out — accountability at a glance
            </p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-zinc-300 transition hover:text-white"
          style={{ borderColor: HAIRLINE, background: PANEL }}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border p-4 text-sm text-red-300" style={{ borderColor: HAIRLINE, background: PANEL }}>
          Couldn&apos;t load SLA data: {error}
        </div>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Currently Breaching"
          value={m?.currentlyBreaching ?? 0}
          icon={<TriangleAlert className="h-5 w-5" />}
          accent={RED}
          emphasis
        />
        <MetricTile
          label="At Risk (upcoming)"
          value={m?.atRisk ?? 0}
          icon={<CalendarClock className="h-5 w-5" />}
          accent="#f59e0b"
          emphasis
        />
        <MetricTile
          label="Breaches After Hours"
          value={m?.atRiskAfterHours ?? 0}
          icon={<Moon className="h-5 w-5" />}
          accent="#c084fc"
          emphasis
        />
        <MetricTile
          label="Call-outs This Week"
          value={m?.callOutsThisWeek ?? 0}
          icon={<PhoneCall className="h-5 w-5" />}
          accent="#f87171"
        />
      </div>

      {/* Currently breaching */}
      <section className="rounded-xl border" style={{ borderColor: HAIRLINE, background: PANEL }}>
        <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
          <TriangleAlert className="h-4 w-4" style={{ color: RED }} />
          <h2 className="text-sm font-semibold text-white">Currently Breaching SLA</h2>
          <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ background: RED }}>
            {data?.breaches.length ?? 0}
          </span>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-zinc-500">Loading…</div>
        ) : (data?.breaches.length ?? 0) === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-zinc-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            No SLAs are breached right now.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: HAIRLINE }}>
            {data!.breaches.map((b) => (
              <div key={b.halo_id} className="px-5 py-3" style={{ borderColor: HAIRLINE }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={haloLink(data!.haloBaseUrl, b.halo_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 font-mono text-sm font-bold text-white hover:underline"
                      >
                        #{b.halo_id}
                        <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500" />
                      </a>
                      {(b.sla_breach_alert_count ?? 0) >= 2 && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: RED }}>
                          {b.sla_breach_alert_count}× alerted
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-zinc-300">{b.summary ?? "—"}</p>
                    <p className="text-xs text-zinc-500">
                      {b.client_name ?? "Unknown client"}
                      {b.halo_status ? ` · ${b.halo_status}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#f87171" }}>
                      <Clock className="h-3 w-3" />
                      breached {durationSince(b.sla_breach_alerted_at)}
                    </div>
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-xs text-zinc-400">
                      <User className="h-3 w-3" />
                      {b.halo_agent ?? "Unassigned"}
                    </div>
                  </div>
                </div>
                {b.sla_breach_last_alert_text && (
                  <div
                    className="mt-2 rounded-lg border p-2.5"
                    style={{ borderColor: HAIRLINE, background: "#0f0a0c" }}
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      <MessageSquare className="h-3 w-3" style={{ color: "#f87171" }} />
                      Teams message sent{b.sla_breach_last_alert_at ? ` · ${fmtTime(b.sla_breach_last_alert_at)}` : ""}
                    </div>
                    <p className="whitespace-pre-line text-xs leading-relaxed text-zinc-300">
                      {b.sla_breach_last_alert_text}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* At risk — upcoming breaches */}
      <section className="rounded-xl border" style={{ borderColor: HAIRLINE, background: PANEL }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
          <CalendarClock className="h-4 w-4" style={{ color: "#f59e0b" }} />
          <h2 className="text-sm font-semibold text-white">At Risk — Upcoming Breaches</h2>
          <span className="ml-1 rounded-full px-2 py-0.5 text-xs font-bold text-black" style={{ background: "#f59e0b" }}>
            {data?.atRisk.length ?? 0}
          </span>
          <span className="text-xs text-zinc-500">next 96h — clear the after-hours ones before you leave</span>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-zinc-500">Loading…</div>
        ) : (data?.atRisk.length ?? 0) === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-zinc-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Nothing due to breach in the next 96 hours.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: HAIRLINE }}>
            {data!.atRisk.map((t) => (
              <div key={t.halo_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3" style={{ borderColor: HAIRLINE }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={haloLink(data!.haloBaseUrl, t.halo_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 font-mono text-sm font-bold text-white hover:underline"
                    >
                      #{t.halo_id}
                      <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500" />
                    </a>
                    {t.afterHours && (
                      <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: "#7c3aed" }}>
                        <Moon className="h-2.5 w-2.5" />
                        breaches after hours
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-zinc-300">{t.summary ?? "—"}</p>
                  <p className="text-xs text-zinc-500">
                    {t.client_name ?? "Unknown client"}
                    {t.halo_status ? ` · ${t.halo_status}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <div
                    className="flex items-center justify-end gap-1 text-xs font-semibold"
                    style={{ color: t.afterHours ? "#c084fc" : "#fbbf24" }}
                  >
                    <Clock className="h-3 w-3" />
                    due in {durationUntil(t.deadline)}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">{fmtTime(t.deadline)}</div>
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-xs text-zinc-400">
                    <User className="h-3 w-3" />
                    {t.halo_agent ?? "Unassigned"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Call-out accountability */}
      <section className="rounded-xl border" style={{ borderColor: HAIRLINE, background: PANEL }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
          <PhoneCall className="h-4 w-4" style={{ color: "#f87171" }} />
          <h2 className="text-sm font-semibold text-white">Auto Call-Out Accountability</h2>
          <span className="text-xs text-zinc-500">
            {m?.callOutsTotal ?? 0} total · reminder log of every tech the system called about a breach
          </span>
        </div>

        {/* Per-tech chips (this week) */}
        {m && m.callOutsByTech.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
            {m.callOutsByTech.map((t) => (
              <span
                key={t.tech}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-zinc-200"
                style={{ borderColor: HAIRLINE, background: "#0f0a0c" }}
              >
                <User className="h-3 w-3 text-zinc-500" />
                {t.tech}
                <span className="rounded-full px-1.5 font-bold text-white" style={{ background: RED_DIM }}>
                  {t.count}
                </span>
              </span>
            ))}
          </div>
        )}

        {loading ? (
          <div className="p-6 text-sm text-zinc-500">Loading…</div>
        ) : (data?.calls.length ?? 0) === 0 ? (
          <div className="p-6 text-sm text-zinc-400">No automated call-outs on record yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-5 py-2 font-medium">Tech</th>
                  <th className="px-5 py-2 font-medium">Ticket</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium">Why they were called</th>
                </tr>
              </thead>
              <tbody>
                {data!.calls.map((c) => (
                  <tr key={c.id} className="border-t align-top" style={{ borderColor: HAIRLINE }}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs text-zinc-400">{fmtTime(c.created_at)}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-zinc-200">{c.tech_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <a
                        href={haloLink(data!.haloBaseUrl, c.halo_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-zinc-300 hover:underline"
                      >
                        #{c.halo_id}
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <CallStatus status={c.status} />
                    </td>
                    <td className="max-w-md px-5 py-2.5 text-xs text-zinc-400">{c.objective ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricTile({
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
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-bold" style={{ color: value > 0 ? accent : "#e4e4e7" }}>
        {value}
      </p>
    </div>
  );
}

function CallStatus({ status }: { readonly status: string | null }) {
  const s = (status ?? "unknown").toLowerCase();
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    calling: { label: "Called", color: "#f87171", icon: <PhoneCall className="h-3 w-3" /> },
    completed: { label: "Completed", color: "#34d399", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { label: "Failed", color: "#a1a1aa", icon: <PhoneOff className="h-3 w-3" /> },
    pending: { label: "Pending", color: "#fbbf24", icon: <Clock className="h-3 w-3" /> },
  };
  const cfg = map[s] ?? { label: status ?? "—", color: "#a1a1aa", icon: <PhoneCall className="h-3 w-3" /> };
  return (
    <span className="flex items-center gap-1 text-xs font-medium" style={{ color: cfg.color }}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}
