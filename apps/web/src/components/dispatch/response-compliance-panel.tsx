"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";

const PANEL = "#151013";
const HAIRLINE = "#3a1f24";
const REFRESH_MS = 15_000;
const PAGE_SIZE = 5;

type ResponseBucket =
  | "ackOnTime"
  | "ackMissed"
  | "needsApproval"
  | "techOnTime"
  | "techMissed"
  | "ackPending"
  | "techPending";

interface ResponseTicket {
  readonly halo_id: number;
  readonly ticket_summary: string;
  readonly client_name: string | null;
  readonly ticket_created_at: string;
  readonly ticket_is_open: boolean;
  readonly acknowledgment_due_at: string;
  readonly acknowledgment_at: string | null;
  readonly acknowledgment_met: boolean | null;
  readonly acknowledgment_overdue: boolean;
  readonly dispatcher_outcome: "pending" | "met" | "missed" | "pto_exempt" | "pto_unknown";
  readonly approval_id: string | null;
  readonly assigned_tech: string | null;
  readonly assigned_at: string | null;
  readonly technician_response_due_at: string | null;
  readonly technician_response_at: string | null;
  readonly technician_response_met: boolean | null;
  readonly technician_overdue: boolean;
}

interface ResponseCompliancePayload {
  readonly generatedAt: string;
  readonly technicianEmailPerformance: {
    readonly periodDays: number;
    readonly targetMinutes: number;
    readonly schedule: string;
    readonly team: TechnicianEmailMetric;
    readonly technicians: ReadonlyArray<TechnicianEmailMetric & { readonly tech: string }>;
  };
  readonly summary: {
    readonly acknowledgment: {
      readonly onTime: number;
      readonly missed: number;
      readonly ptoExempt: number;
      readonly ptoUnknown: number;
      readonly pending: number;
      readonly approvalNeeded: number;
    };
    readonly technician: {
      readonly onTime: number;
      readonly missed: number;
      readonly pending: number;
    };
  };
  readonly details: Readonly<Record<ResponseBucket, ReadonlyArray<ResponseTicket>>>;
}

interface TechnicianEmailMetric {
  readonly measured: number;
  readonly onTime: number;
  readonly missed: number;
  readonly onTimePercent: number;
  readonly medianEmailMinutes: number | null;
  readonly noEmail: number;
}

interface MetricDefinition {
  readonly key: ResponseBucket;
  readonly label: string;
  readonly value: number;
  readonly tone: string;
}

function haloTicketUrl(base: string, id: number): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/tickets`;
    url.search = `?id=${id}`;
    return url.toString();
  } catch {
    return null;
  }
}

function etTime(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clockDistance(value: string | null, generatedAt: string): string {
  if (!value) return "No deadline recorded";
  const dueAt = Date.parse(value);
  const now = Date.parse(generatedAt);
  if (!Number.isFinite(dueAt) || !Number.isFinite(now)) return "No deadline recorded";
  const remainingMinutes = Math.round((dueAt - now) / 60_000);
  const absoluteMinutes = Math.abs(remainingMinutes);
  const duration = absoluteMinutes >= 60
    ? `${Math.floor(absoluteMinutes / 60)}h ${absoluteMinutes % 60}m`
    : `${absoluteMinutes}m`;
  return remainingMinutes >= 0 ? `due in ${duration}` : `overdue by ${duration}`;
}

function emailMinutes(value: number | null): string {
  if (value === null) return "No email";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function performanceTone(percent: number): string {
  if (percent >= 90) return "#4ade80";
  if (percent >= 75) return "#facc15";
  return "#f87171";
}

function responseDetail(bucket: ResponseBucket, ticket: ResponseTicket, generatedAt: string): string {
  switch (bucket) {
    case "ackOnTime":
      return `Initial customer reply sent ${etTime(ticket.acknowledgment_at)} · due ${etTime(ticket.acknowledgment_due_at)}`;
    case "ackMissed":
      return `Initial customer reply due ${etTime(ticket.acknowledgment_due_at)} · ${ticket.acknowledgment_at ? `sent ${etTime(ticket.acknowledgment_at)}` : "no reply recorded"}`;
    case "needsApproval":
      return `Initial customer reply ready for approval · due ${etTime(ticket.acknowledgment_due_at)}`;
    case "techOnTime":
      return `Tech response ${etTime(ticket.technician_response_at)} · due ${etTime(ticket.technician_response_due_at)}`;
    case "techMissed":
      return `Tech response due ${etTime(ticket.technician_response_due_at)} · ${ticket.technician_response_at ? `sent ${etTime(ticket.technician_response_at)}` : "no response recorded"}`;
    case "ackPending":
      return `Expected from Bryanna / Dispatch · ${clockDistance(ticket.acknowledgment_due_at, generatedAt)} · deadline ${etTime(ticket.acknowledgment_due_at)}`;
    case "techPending":
      return `Expected from ${ticket.assigned_tech ?? "assigned technician"} · ${clockDistance(ticket.technician_response_due_at, generatedAt)} · deadline ${etTime(ticket.technician_response_due_at)}`;
  }
}

export function ResponseCompliancePanel({ haloBaseUrl }: { readonly haloBaseUrl: string }) {
  const [data, setData] = useState<ResponseCompliancePayload | null>(null);
  const [selected, setSelected] = useState<ResponseBucket>("ackMissed");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dispatch/response-compliance", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData((await response.json()) as ResponseCompliancePayload);
      setError(null);
    } catch {
      setError("First-response ticket details are unavailable.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => setPage(0), [selected]);

  const metrics = useMemo<ReadonlyArray<MetricDefinition>>(() => {
    const ack = data?.summary.acknowledgment;
    const tech = data?.summary.technician;
    return [
      { key: "ackOnTime", label: "Initial reply in 30m", value: ack?.onTime ?? 0, tone: "#4ade80" },
      { key: "ackMissed", label: "Bryanna missed", value: ack?.missed ?? 0, tone: "#f87171" },
      { key: "needsApproval", label: "Needs approval", value: ack?.approvalNeeded ?? 0, tone: "#fbbf24" },
      { key: "techOnTime", label: "Tech on time", value: tech?.onTime ?? 0, tone: "#7dd3fc" },
      { key: "techMissed", label: "Tech missed", value: tech?.missed ?? 0, tone: "#fb7185" },
    ];
  }, [data]);
  const selectedMetric = metrics.find((metric) => metric.key === selected) ?? metrics[0];
  const selectedLabel = selected === "ackPending"
    ? "Customer reply clocks"
    : selected === "techPending"
      ? "Technician reply clocks"
      : selectedMetric.label;
  const tickets = data?.details?.[selected] ?? [];
  const pageCount = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleTickets = tickets.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <section className="overflow-hidden rounded-lg border" style={{ borderColor: HAIRLINE, background: PANEL }}>
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
        <Clock3 className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-semibold text-white">First Response</h2>
        <span className="border-l pl-2 text-[10px] font-semibold uppercase text-zinc-500" style={{ borderColor: HAIRLINE }}>Today&apos;s results + live queue</span>
        <span className="ml-auto text-[10px] text-zinc-500">Reply to customer in 30m · assigned tech email in 1h · business time</span>
      </div>

      <div className="grid grid-cols-2 border-b sm:grid-cols-3 lg:grid-cols-5" style={{ borderColor: HAIRLINE }}>
        {metrics.map((metric) => {
          const active = metric.key === selected;
          return (
            <button
              key={metric.key}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(metric.key)}
              className="min-w-0 cursor-pointer border-r px-4 py-3 text-left transition hover:bg-white/[0.03] last:border-r-0"
              style={{
                borderColor: HAIRLINE,
                background: active ? `${metric.tone}0d` : "transparent",
                boxShadow: active ? `inset 0 -2px ${metric.tone}` : "none",
              }}
              title={`Show ${metric.label.toLowerCase()} tickets`}
            >
              <p className="truncate text-[10px] font-semibold uppercase text-zinc-500">{metric.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: metric.tone }}>{metric.value}</p>
            </button>
          );
        })}
      </div>

      {data?.technicianEmailPerformance && (
        <div className="border-b" style={{ borderColor: HAIRLINE }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
            <div>
              <p className="text-xs font-semibold text-white">Technician email response speed · last {data.technicianEmailPerformance.periodDays} days</p>
              <p className="mt-0.5 text-[10px] text-zinc-500">
                Customer-visible email only · target {data.technicianEmailPerformance.targetMinutes}m · {data.technicianEmailPerformance.schedule}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3 text-[11px]">
              <span className="text-zinc-500">Team</span>
              <strong style={{ color: performanceTone(data.technicianEmailPerformance.team.onTimePercent) }}>
                {data.technicianEmailPerformance.team.onTimePercent}% on time
              </strong>
              <span className="text-zinc-500">{data.technicianEmailPerformance.team.onTime}/{data.technicianEmailPerformance.team.measured}</span>
              <span className="text-zinc-500">Median email {emailMinutes(data.technicianEmailPerformance.team.medianEmailMinutes)}</span>
              <span className={data.technicianEmailPerformance.team.noEmail > 0 ? "text-red-300" : "text-zinc-500"}>
                No email {data.technicianEmailPerformance.team.noEmail}
              </span>
            </div>
          </div>

          {data.technicianEmailPerformance.technicians.length === 0 ? (
            <div className="border-t px-5 py-3 text-xs text-zinc-500" style={{ borderColor: HAIRLINE }}>
              No completed technician response clocks in the last {data.technicianEmailPerformance.periodDays} days.
            </div>
          ) : (
            <div className="overflow-x-auto border-t" style={{ borderColor: HAIRLINE }}>
              <table className="w-full min-w-[700px] text-left">
                <thead>
                  <tr className="text-[9px] font-semibold uppercase tracking-wide text-zinc-600">
                    <th className="px-5 py-1.5">Technician</th>
                    <th className="px-3 py-1.5">On time</th>
                    <th className="px-3 py-1.5">Median email time</th>
                    <th className="px-3 py-1.5">Missed</th>
                    <th className="px-5 py-1.5 text-right">No qualifying email</th>
                  </tr>
                </thead>
                <tbody>
                  {data.technicianEmailPerformance.technicians.map((tech) => {
                    const tone = performanceTone(tech.onTimePercent);
                    return (
                      <tr key={tech.tech} className="border-t text-xs" style={{ borderColor: HAIRLINE }}>
                        <td className="px-5 py-2 font-semibold text-white/90">{tech.tech}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <strong className="w-9 tabular-nums" style={{ color: tone }}>{tech.onTimePercent}%</strong>
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                              <div className="h-full rounded-full" style={{ width: `${tech.onTimePercent}%`, background: tone }} />
                            </div>
                            <span className="text-[10px] text-zinc-600">{tech.onTime}/{tech.measured} within {data.technicianEmailPerformance.targetMinutes}m</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-zinc-300">{emailMinutes(tech.medianEmailMinutes)}</span>
                          <span className="ml-1.5 text-[10px] text-zinc-600">emails eventually sent</span>
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: tech.missed > 0 ? "#f87171" : "#71717a" }}>{tech.missed}</td>
                        <td className="px-5 py-2 text-right font-semibold tabular-nums" style={{ color: tech.noEmail > 0 ? "#f87171" : "#71717a" }}>{tech.noEmail}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 border-b px-5 py-2" style={{ borderColor: HAIRLINE }}>
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-300">
          {selectedLabel} <span className="ml-1 text-zinc-600">{tickets.length}</span>
        </p>
        {tickets.length > PAGE_SIZE && (
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <button
              type="button"
              aria-label="Previous first-response ticket page"
              title="Previous page"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="flex h-7 w-7 items-center justify-center border disabled:opacity-30"
              style={{ borderColor: HAIRLINE }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="w-10 text-center tabular-nums">{safePage + 1} / {pageCount}</span>
            <button
              type="button"
              aria-label="Next first-response ticket page"
              title="Next page"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              className="flex h-7 w-7 items-center justify-center border disabled:opacity-30"
              style={{ borderColor: HAIRLINE }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {error && !data ? (
        <div className="px-5 py-4 text-sm text-red-300">{error}</div>
      ) : !data ? (
        <div className="px-5 py-4 text-sm text-zinc-500">Loading first-response tickets…</div>
      ) : visibleTickets.length === 0 ? (
        <div className="px-5 py-4 text-sm text-zinc-500">No tickets in this category.</div>
      ) : (
        <div className="divide-y" style={{ borderColor: HAIRLINE }}>
          {visibleTickets.map((ticket) => {
            const href = haloTicketUrl(haloBaseUrl, ticket.halo_id);
            return (
              <div key={ticket.halo_id} className="flex min-h-[58px] items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-300">
                    <span className="mr-2 font-mono text-xs font-bold text-white">#{ticket.halo_id}</span>
                    <span className="font-semibold">{ticket.client_name ?? "Unknown client"}</span>
                    <span className="text-zinc-500"> · {ticket.ticket_summary}</span>
                  </p>
                  <p className="mt-1 truncate text-[11px] text-zinc-500">
                    <span className={ticket.ticket_is_open ? "text-emerald-400" : "text-zinc-600"}>{ticket.ticket_is_open ? "Open" : "Closed"}</span>
                    <span> · Assigned to {ticket.assigned_tech ?? "Unassigned"} · {responseDetail(selected, ticket, data.generatedAt)}</span>
                  </p>
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open Halo ticket #${ticket.halo_id}`}
                    aria-label={`Open Halo ticket #${ticket.halo_id}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-zinc-600 transition hover:text-white"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-1 border-t px-4 py-1.5 text-[11px] text-zinc-500" style={{ borderColor: HAIRLINE }}>
          <button
            type="button"
            aria-pressed={selected === "ackPending"}
            onClick={() => setSelected("ackPending")}
            className="flex items-center gap-1.5 px-2 py-1 transition hover:text-white"
            style={{ color: selected === "ackPending" ? "#7dd3fc" : undefined }}
            title="Show every open ticket waiting for its initial customer reply"
          >
            <Clock3 className="h-3 w-3" />
            <span>{data.summary.acknowledgment.pending} customer reply clock{data.summary.acknowledgment.pending === 1 ? "" : "s"} running</span>
            <ChevronRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-pressed={selected === "techPending"}
            onClick={() => setSelected("techPending")}
            className="flex items-center gap-1.5 px-2 py-1 transition hover:text-white"
            style={{ color: selected === "techPending" ? "#7dd3fc" : undefined }}
            title="Show every assigned ticket waiting for its technician response"
          >
            <Clock3 className="h-3 w-3" />
            <span>{data.summary.technician.pending} technician clock{data.summary.technician.pending === 1 ? "" : "s"} running</span>
            <ChevronRight className="h-3 w-3" />
          </button>
          {error && <span className="text-red-300">Refresh failed; showing the last update.</span>}
        </div>
      )}
    </section>
  );
}
