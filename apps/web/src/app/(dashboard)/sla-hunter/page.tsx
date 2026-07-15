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
  ChevronLeft,
  ChevronRight,
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
  readonly weekend: boolean;
}

type AtRiskFilter = "all" | "afterhours" | "weekend";

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
const AT_RISK_PAGE_SIZE = 6;

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
  const [atRiskFilter, setAtRiskFilter] = useState<AtRiskFilter>("all");
  const [atRiskPage, setAtRiskPage] = useState(0);

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
  const atRiskAll = data?.atRisk ?? [];
  const atRiskAfterHours = atRiskAll.filter((t) => t.afterHours && !t.weekend);
  const atRiskWeekend = atRiskAll.filter((t) => t.weekend);
  const atRiskShown =
    atRiskFilter === "afterhours" ? atRiskAfterHours : atRiskFilter === "weekend" ? atRiskWeekend : atRiskAll;
  const atRiskPageCount = Math.max(1, Math.ceil(atRiskShown.length / AT_RISK_PAGE_SIZE));
  const safeAtRiskPage = Math.min(atRiskPage, atRiskPageCount - 1);
  const atRiskPageRows = atRiskShown.slice(
    safeAtRiskPage * AT_RISK_PAGE_SIZE,
    (safeAtRiskPage + 1) * AT_RISK_PAGE_SIZE,
  );
  const selectAtRiskFilter = (filter: AtRiskFilter) => {
    setAtRiskFilter(filter);
    setAtRiskPage(0);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{ background: "#991b1b" }}
          >
            <Siren className="h-4.5 w-4.5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white">SLA Hunter</h1>
            <p className="hidden text-xs text-zinc-500 sm:block">
              Live breaches, upcoming deadlines, and call-out accountability
            </p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          aria-label="Refresh SLA Hunter"
          title="Refresh SLA Hunter"
          className="flex h-8 w-8 items-center justify-center rounded-md border text-zinc-400 transition hover:bg-white/[0.03] hover:text-white"
          style={{ borderColor: HAIRLINE, background: PANEL }}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="rounded-lg border p-4 text-sm text-red-300" style={{ borderColor: HAIRLINE, background: PANEL }}>
          Couldn&apos;t load SLA data: {error}
        </div>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border sm:grid-cols-4" style={{ borderColor: HAIRLINE, background: HAIRLINE }}>
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

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
      {/* Currently breaching */}
      <section className="overflow-hidden rounded-md border xl:col-span-5" style={{ borderColor: HAIRLINE, background: PANEL }}>
        <div className="flex min-h-10 items-center gap-2 border-b px-4 py-2" style={{ borderColor: HAIRLINE }}>
          <TriangleAlert className="h-4 w-4" style={{ color: RED }} />
          <h2 className="text-sm font-semibold text-white">Currently Breaching SLA</h2>
          <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: RED }}>
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
              <div key={b.halo_id} className="px-4 py-2.5" style={{ borderColor: HAIRLINE }}>
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
                    className="mt-2 rounded-md border p-2.5"
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
      <section className="overflow-hidden rounded-md border xl:col-span-7" style={{ borderColor: HAIRLINE, background: PANEL }}>
        <div className="flex min-h-10 flex-wrap items-center gap-2 border-b px-4 py-2" style={{ borderColor: HAIRLINE }}>
          <CalendarClock className="h-4 w-4" style={{ color: "#f59e0b" }} />
          <h2 className="text-sm font-semibold text-white">At Risk — Upcoming Breaches</h2>
          <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-black" style={{ background: "#f59e0b" }}>
            {atRiskShown.length}
          </span>
          <span className="hidden text-xs text-zinc-500 sm:inline">next 96h — clear the after-hours ones before you leave</span>
          <div className="ml-auto flex items-center gap-1">
            <FilterChip label="All" count={atRiskAll.length} active={atRiskFilter === "all"} onClick={() => selectAtRiskFilter("all")} />
            <FilterChip label="After Hours" count={atRiskAfterHours.length} active={atRiskFilter === "afterhours"} onClick={() => selectAtRiskFilter("afterhours")} icon={<Moon className="h-3 w-3" />} />
            <FilterChip label="Weekend" count={atRiskWeekend.length} active={atRiskFilter === "weekend"} onClick={() => selectAtRiskFilter("weekend")} icon={<CalendarClock className="h-3 w-3" />} />
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-zinc-500">Loading…</div>
        ) : atRiskShown.length === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-zinc-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            {atRiskFilter === "all"
              ? "Nothing due to breach in the next 96 hours."
              : atRiskFilter === "afterhours"
                ? "Nothing due to breach after hours."
                : "Nothing due to breach over the weekend."}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: HAIRLINE }}>
            {atRiskPageRows.map((t) => (
              <div key={t.halo_id} className="flex min-h-[68px] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5" style={{ borderColor: HAIRLINE }}>
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
                    {t.weekend ? (
                      <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: "#7c3aed" }}>
                        <CalendarClock className="h-2.5 w-2.5" />
                        breaches over weekend
                      </span>
                    ) : t.afterHours ? (
                      <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" style={{ background: "#7c3aed" }}>
                        <Moon className="h-2.5 w-2.5" />
                        breaches after hours
                      </span>
                    ) : null}
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
            {atRiskPageCount > 1 && (
              <div className="flex h-10 items-center justify-between gap-3 px-4" style={{ borderColor: HAIRLINE }}>
                <span className="text-xs text-zinc-500">
                  Showing {safeAtRiskPage * AT_RISK_PAGE_SIZE + 1}–{Math.min((safeAtRiskPage + 1) * AT_RISK_PAGE_SIZE, atRiskShown.length)} of {atRiskShown.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAtRiskPage(Math.max(0, safeAtRiskPage - 1))}
                    disabled={safeAtRiskPage === 0}
                    aria-label="Previous at-risk tickets page"
                    title="Previous page"
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-zinc-400 transition hover:text-white disabled:cursor-default disabled:opacity-30"
                    style={{ borderColor: HAIRLINE }}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-14 text-center text-xs tabular-nums text-zinc-400">
                    {safeAtRiskPage + 1} / {atRiskPageCount}
                  </span>
                  <button
                    onClick={() => setAtRiskPage(Math.min(atRiskPageCount - 1, safeAtRiskPage + 1))}
                    disabled={safeAtRiskPage >= atRiskPageCount - 1}
                    aria-label="Next at-risk tickets page"
                    title="Next page"
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-zinc-400 transition hover:text-white disabled:cursor-default disabled:opacity-30"
                    style={{ borderColor: HAIRLINE }}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      </div>

      {/* Call-out accountability */}
      <section className="overflow-hidden rounded-md border" style={{ borderColor: HAIRLINE, background: PANEL }}>
        <div className="flex min-h-10 flex-wrap items-center gap-2 border-b px-4 py-2" style={{ borderColor: HAIRLINE }}>
          <PhoneCall className="h-4 w-4" style={{ color: "#f87171" }} />
          <h2 className="text-sm font-semibold text-white">Auto Call-Out Accountability</h2>
          <span className="text-xs text-zinc-500">
            {m?.callOutsTotal ?? 0} total · reminder log of every tech the system called about a breach
          </span>
        </div>

        {/* Per-tech chips (this week) */}
        {m && m.callOutsByTech.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-2" style={{ borderColor: HAIRLINE }}>
            {m.callOutsByTech.map((t) => (
              <span
                key={t.tech}
                className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs text-zinc-200"
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
                    <td className="max-w-md px-5 py-2.5 text-xs text-zinc-400">
                      {c.objective ?? (
                        <span style={{ color: "#f87171" }}>SLA breached — called to ask why and confirm the next action</span>
                      )}
                    </td>
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

function FilterChip({
  label,
  count,
  active,
  onClick,
  icon,
}: {
  readonly label: string;
  readonly count: number;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition"
      style={{
        borderColor: active ? "#7c3aed" : HAIRLINE,
        background: active ? "#7c3aed" : "#0f0a0c",
        color: active ? "#fff" : "#a1a1aa",
      }}
    >
      {icon}
      {label}
      <span
        className="rounded px-1 text-[10px] font-bold"
        style={{ background: active ? "rgba(255,255,255,0.25)" : HAIRLINE, color: active ? "#fff" : "#e4e4e7" }}
      >
        {count}
      </span>
    </button>
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
      className="flex min-h-[70px] items-center gap-3 px-4 py-3"
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
        <span className="mt-1 block text-[9px] font-medium uppercase leading-3 tracking-wide text-zinc-500 sm:text-[10px]">{label}</span>
      </div>
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
