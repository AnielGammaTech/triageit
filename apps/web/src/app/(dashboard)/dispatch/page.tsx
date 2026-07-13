"use client";

import { useCallback, useEffect, useState } from "react";
import { isHelpdeskTechnicianName } from "@triageit/shared";
import { ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, ListChecks, Radio, RefreshCw, TriangleAlert, Users } from "lucide-react";

interface TechStatus {
  readonly state:
    | "off"
    | "onsite"
    | "meeting"
    | "on_call"
    | "working"
    | "dnd"
    | "away"
    | "available"
    | "after_hours"
    | "unreachable"
    | "unknown";
  readonly detail: string | null;
}
interface BoardTech {
  readonly tech: string;
  readonly status: TechStatus;
  readonly phone: {
    readonly profile: string | null;
    readonly registered: boolean | null;
    readonly onCall: boolean;
  } | null;
  readonly load: { readonly open: number; readonly wot: number; readonly breaching: number };
  readonly workingTicketId: number | null;
  readonly nextCommitment: string | null;
  readonly aiRead: string | null;
}
interface DispatchBoard {
  readonly generatedAt: string;
  readonly sources: { readonly halo: boolean; readonly threecx: boolean; readonly calendar: boolean };
  readonly haloBaseUrl: string;
  readonly techs: ReadonlyArray<BoardTech>;
}
interface Suggestion {
  readonly tech: string;
  readonly score: number;
  readonly reasons: ReadonlyArray<string>;
}
type DispatchActionLane = "now" | "today" | "watch";
type DispatchActionKind =
  | "sla_breach"
  | "past_due"
  | "assign"
  | "cover"
  | "due_soon"
  | "customer_reply"
  | "waiting_on_tech"
  | "high_priority"
  | "stale";
interface DispatchAction {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly status: string | null;
  readonly assignedTo: string | null;
  readonly priority: number | null;
  readonly kind: DispatchActionKind;
  readonly lane: DispatchActionLane;
  readonly rank: number;
  readonly reason: string;
  readonly action: string;
  readonly since: string | null;
  readonly deadline: string | null;
  readonly suggestions: ReadonlyArray<Suggestion>;
}
interface DispatchSuggestions {
  readonly haloBaseUrl: string;
  readonly actions: ReadonlyArray<DispatchAction>;
  readonly actionCounts: Readonly<Record<DispatchActionLane | "total", number>>;
  readonly actionOmitted: number;
}
interface WeekEvent {
  readonly day: string; // YYYY-MM-DD (ET)
  readonly type: "site_visit" | "reminder" | "pto" | "meeting";
  readonly subject: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
  readonly ticketId: number | null;
}
interface WeekData {
  readonly start: string;
  readonly haloBaseUrl: string;
  readonly days: ReadonlyArray<string>;
  readonly techs: ReadonlyArray<{ readonly tech: string; readonly events: ReadonlyArray<WeekEvent> }>;
}

const RED = "#dc2626";
const PANEL = "#151013";
const HAIRLINE = "#3a1f24";

const STATE_COLOR: Record<TechStatus["state"], string> = {
  available: "#22c55e",
  working: "#38bdf8",
  on_call: "#0f75b1",
  meeting: "#c084fc",
  onsite: "#22c55e",
  dnd: "#e879f9",
  away: "#a1a1aa",
  after_hours: "#71717a",
  off: "#71717a",
  unreachable: "#f87171",
  unknown: "#f87171",
};
const STATE_LABEL: Record<TechStatus["state"], string> = {
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

/** Halo web link for a ticket — null when the Halo base URL is unavailable. */
function haloTicketUrl(base: string | undefined, id: number): string | null {
  return base ? `${base}/tickets?id=${id}` : null;
}

/** A dispatcher-readable context line — only when the chip alone isn't enough. */
function contextLine(status: TechStatus): string | null {
  if (status.detail) return status.detail;
  switch (status.state) {
    case "unknown":
      return "No phone or calendar activity right now";
    case "unreachable":
      return "Phone not registered";
    default:
      return null; // "Available" and "After Hours" need no elaboration
  }
}

function degradationMessages(sources: DispatchBoard["sources"]): ReadonlyArray<string> {
  const messages: string[] = [];
  if (!sources.threecx) messages.push("Phone system unreachable — can't tell who's on a call right now.");
  if (!sources.halo) messages.push("Halo appointments unavailable — onsite visits may be missing.");
  if (!sources.calendar)
    messages.push(
      "Outlook calendars not connected — PTO and meetings won't show. Connect Microsoft 365 under Adminland → Integrations.",
    );
  return messages;
}

export default function DispatchPage() {
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [suggest, setSuggest] = useState<DispatchSuggestions | null>(null);
  const [week, setWeek] = useState<WeekData | null>(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [rosterScope, setRosterScope] = useState<"helpdesk" | "all">("helpdesk");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const [boardRes, suggestRes] = await Promise.all([
        fetch("/api/dispatch/board", { cache: "no-store" }),
        fetch("/api/dispatch/suggest", { cache: "no-store" }),
      ]);
      if (!boardRes.ok) throw new Error(`HTTP ${boardRes.status}`);
      if (!suggestRes.ok) throw new Error(`HTTP ${suggestRes.status}`);
      setBoard((await boardRes.json()) as DispatchBoard);
      setSuggest((await suggestRes.json()) as DispatchSuggestions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadDay = useCallback(async (offset: number) => {
    try {
      const qs = offset === 0 ? "" : `?start=${dayStartIso(offset)}`;
      const res = await fetch(`/api/dispatch/week${qs}`, { cache: "no-store" });
      if (!res.ok) {
        setWeek(null);
        return;
      }
      setWeek((await res.json()) as WeekData);
    } catch {
      setWeek(null); // week view is additive — never break the page over it
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    void loadDay(dayOffset);
  }, [dayOffset, loadDay]);

  const degraded = board ? degradationMessages(board.sources) : [];
  const displayedTechs =
    board?.techs.filter((tech) => rosterScope === "all" || isHelpdeskTechnicianName(tech.tech)) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `linear-gradient(135deg, ${RED}, #7f1d1d)`, boxShadow: `0 0 24px -6px ${RED}` }}
          >
            <Radio className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">Dispatch</h1>
            <p className="hidden text-sm text-zinc-400 sm:block">What needs action, who can take it, and what&apos;s coming next</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void load(true)}
            aria-label="Refresh dispatch data"
            title="Refresh dispatch data"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border text-zinc-300 transition hover:text-white"
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

      {degraded.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm text-amber-200/90"
          style={{ borderColor: "#78350f", background: "#1c1206" }}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="space-y-0.5">
            {degraded.map((msg) => (
              <p key={msg}>{msg}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Section
            title="Right Now"
            icon={<Users className="h-4 w-4" style={{ color: RED }} />}
            actions={
              <div className="flex h-9 rounded-md border p-0.5" style={{ borderColor: HAIRLINE, background: "#0f0a0c" }}>
                <ScopeButton active={rosterScope === "helpdesk"} onClick={() => setRosterScope("helpdesk")}>
                  Dispatch team
                </ScopeButton>
                <ScopeButton active={rosterScope === "all"} onClick={() => setRosterScope("all")}>
                  All staff
                </ScopeButton>
              </div>
            }
          >
            {loading && !board ? (
              <BoardSkeleton />
            ) : displayedTechs.length === 0 ? (
              <div className="p-5 text-sm text-zinc-400">No technicians on the roster right now.</div>
            ) : (
              <div
                className="grid max-h-[340px] grid-cols-1 gap-px overflow-y-auto sm:max-h-none sm:grid-cols-2 sm:overflow-visible"
                style={{ background: HAIRLINE }}
              >
                {displayedTechs.map((tech) => (
                  <TechRow key={tech.tech} tech={tech} haloBaseUrl={board!.haloBaseUrl} />
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="lg:col-span-7">
          {week && week.techs.length > 0 ? (
            <DaySchedule
              week={week}
              onPrev={() => setDayOffset((day) => Math.max(0, day - 1))}
              onNext={() => setDayOffset((day) => day + 1)}
              onToday={() => setDayOffset(0)}
              atToday={dayOffset === 0}
            />
          ) : (
            <Section title="Today" icon={<CalendarClock className="h-4 w-4" style={{ color: RED }} />}>
              <div className="p-5 text-sm text-zinc-400">Schedule unavailable right now.</div>
            </Section>
          )}
        </div>
      </div>

      <Section title="Next Actions" icon={<ListChecks className="h-4 w-4" style={{ color: RED }} />}>
        {loading && !suggest ? <BoardSkeleton /> : <DispatchActionList data={suggest} />}
      </Section>
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 min-w-[84px] cursor-pointer rounded px-2.5 text-xs font-medium transition ${
        active ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function DispatchActionList({ data }: { readonly data: DispatchSuggestions | null }) {
  const actions = data?.actions ?? [];
  const total = data?.actionCounts.total ?? actions.length;
  const visible = actions.slice(0, 5);
  const hidden = Math.max(0, total - visible.length);

  return (
    <div>
      {visible.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-zinc-400">Nothing needs dispatch attention right now.</div>
      ) : (
        <div className="divide-y divide-[#3a1f24]">
          {visible.map((item) => (
            <DispatchActionRow key={item.halo_id} item={item} haloBaseUrl={data?.haloBaseUrl ?? ""} />
          ))}
        </div>
      )}

      {hidden > 0 && (
        <div className="flex items-center justify-between gap-3 border-t px-5 py-2.5 text-xs text-zinc-500" style={{ borderColor: HAIRLINE }}>
          <span>Showing the top {visible.length} of {total} actions.</span>
          <a href="/tickets" className="shrink-0 font-medium text-zinc-300 hover:text-white">Open Tickets</a>
        </div>
      )}
    </div>
  );
}

const ACTION_COLOR: Record<DispatchActionKind, string> = {
  sla_breach: "#f87171",
  past_due: "#fb7185",
  assign: "#38bdf8",
  cover: "#e879f9",
  due_soon: "#f59e0b",
  customer_reply: "#fb923c",
  waiting_on_tech: "#fbbf24",
  high_priority: "#f87171",
  stale: "#38bdf8",
};

const ACTION_STATUS: Record<DispatchActionKind, string> = {
  sla_breach: "SLA Breach",
  past_due: "Past Due",
  assign: "Unassigned",
  cover: "Needs Coverage",
  due_soon: "Due Soon",
  customer_reply: "Customer Reply",
  waiting_on_tech: "Waiting on Tech",
  high_priority: "High Priority",
  stale: "Stale",
};

function relativeAge(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function deadlineText(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return `Due ${date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function actionTiming(item: DispatchAction): string {
  const deadline = deadlineText(item.deadline);
  if (deadline) return deadline;
  const age = relativeAge(item.since);
  if (!age) {
    if (item.lane === "now") return "Needs action now";
    if (item.lane === "today") return "Needs action today";
    return "Keep an eye on this";
  }
  switch (item.kind) {
    case "assign":
      return `${age} unassigned`;
    case "customer_reply":
      return `${age} since reply`;
    case "waiting_on_tech":
    case "stale":
      return `${age} idle`;
    default:
      return `${age} since activity`;
  }
}

function actionLabel(item: DispatchAction): string {
  if (item.kind === "assign" && item.suggestions[0]) {
    return `Assign ${item.suggestions[0].tech}`;
  }
  switch (item.kind) {
    case "sla_breach":
      return "Escalate now";
    case "past_due":
      return item.assignedTo ? "Get recovery plan" : "Assign & recover";
    case "assign":
      return "Assign owner";
    case "cover":
      return "Find coverage";
    case "due_soon":
      return "Confirm deadline";
    case "customer_reply":
      return "Respond";
    case "waiting_on_tech":
      return "Check progress";
    case "high_priority":
      return "Confirm next step";
    case "stale":
      return "Review ticket";
  }
}

function DispatchActionRow({
  item,
  haloBaseUrl,
}: {
  readonly item: DispatchAction;
  readonly haloBaseUrl: string;
}) {
  const color = ACTION_COLOR[item.kind];
  const href = haloTicketUrl(haloBaseUrl, item.halo_id);
  const status = ACTION_STATUS[item.kind];
  const recommendation = actionLabel(item);
  const timing = actionTiming(item);
  const owner = item.assignedTo ?? "Unassigned";
  const body = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-xs font-bold text-white">#{item.halo_id}</span>
          {item.priority && (
            <span className="text-[10px] font-bold" style={{ color }}>
              P{item.priority}
            </span>
          )}
          <span className="min-w-0 break-words text-sm font-medium text-zinc-200">
            {item.client_name ?? "Unknown client"}{item.summary ? ` — ${item.summary}` : ""}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span
            className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase"
            style={{ color, borderColor: `${color}55`, background: `${color}14` }}
          >
            {status}
          </span>
          <span><span className="text-zinc-600">Owner:</span> <span className="text-zinc-300">{owner}</span></span>
          <span className="text-zinc-600">·</span>
          <span>{timing}</span>
        </div>
      </div>
      <span className="basis-full pl-[18px] text-xs font-semibold text-zinc-300 sm:basis-auto sm:pl-0 sm:text-right">
        {recommendation}
      </span>
      {href && <ArrowUpRight className="hidden h-4 w-4 shrink-0 text-zinc-600 transition group-hover:text-white sm:block" />}
    </>
  );
  const className = "group flex min-h-14 flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 transition hover:bg-white/[0.025] sm:flex-nowrap sm:px-5";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className} title={`Open ticket #${item.halo_id} in Halo`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Today (ET) plus `offset` days, as YYYY-MM-DD. Never in the past. */
function dayStartIso(offset: number): string {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() + Math.max(0, offset));
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

const WEEK_EVENT_STYLE: Record<WeekEvent["type"], { bg: string; text: string; label: string }> = {
  site_visit: { bg: "#22c55e22", text: "#4ade80", label: "Site Visit" },
  reminder: { bg: "#38bdf822", text: "#7dd3fc", label: "Reminder" },
  pto: { bg: "#71717a22", text: "#a1a1aa", label: "OFF" },
  meeting: { bg: "#a855f722", text: "#c084fc", label: "Teams" },
};

function fmtDayHeader(day: string): { name: string; date: string; isToday: boolean } {
  const d = new Date(`${day}T12:00:00`);
  const todayEt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const isToday =
    todayEt.getFullYear() === d.getFullYear() && todayEt.getMonth() === d.getMonth() && todayEt.getDate() === d.getDate();
  return {
    name: d.toLocaleDateString("en-US", { weekday: "short" }),
    date: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
    isToday,
  };
}

function eventTime(e: WeekEvent): string {
  if (e.allDay) return "";
  return new Date(e.startsAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}

function DaySchedule({
  week,
  onPrev,
  onNext,
  onToday,
  atToday,
}: {
  readonly week: WeekData;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onToday: () => void;
  readonly atToday: boolean;
}) {
  const day = week.days[0] ?? week.start;
  const header = fmtDayHeader(day);
  const activeTechs = week.techs.filter((tech) => tech.events.some((event) => event.day === day));
  const quietTechs = week.techs
    .filter((tech) => !tech.events.some((event) => event.day === day))
    .map((tech) => tech.tech);
  return (
    <Section
      title={header.isToday ? "Today" : header.name}
      icon={<CalendarClock className="h-4 w-4" style={{ color: RED }} />}
      actions={
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-zinc-400 sm:mr-2">{header.date}</span>
          <button
            onClick={onPrev}
            disabled={atToday}
            aria-label="Previous day"
            className="flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border text-zinc-300 hover:text-white disabled:cursor-default disabled:opacity-30"
            style={{ borderColor: HAIRLINE }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={onToday}
            className="flex h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-xs text-zinc-300 hover:text-white"
            style={{ borderColor: HAIRLINE }}
          >
            Today
          </button>
          <button
            onClick={onNext}
            aria-label="Next day"
            className="flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border text-zinc-300 hover:text-white"
            style={{ borderColor: HAIRLINE }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <DayAgenda week={week} day={day} techs={activeTechs} />
      {quietTechs.length > 0 && (
        <p className="border-t px-5 py-2 text-xs text-zinc-500" style={{ borderColor: HAIRLINE }}>
          No scheduled items: {quietTechs.join(", ")}
        </p>
      )}
    </Section>
  );
}

interface AgendaItem {
  readonly tech: string;
  readonly event: WeekEvent;
}

/** One dispatcher day, ordered by time, with the assigned technician on every row. */
function DayAgenda({
  week,
  day,
  techs,
}: {
  readonly week: WeekData;
  readonly day: string;
  readonly techs: ReadonlyArray<{ readonly tech: string; readonly events: ReadonlyArray<WeekEvent> }>;
}) {
  const all = techs.flatMap((tech): ReadonlyArray<AgendaItem> =>
    tech.events.filter((event) => event.day === day).map((event) => ({ tech: tech.tech, event })),
  );
  const offTechs = [...new Set(all.filter((item) => item.event.type === "pto").map((item) => item.tech.split(" ")[0]))];
  const items = all
    .filter((item) => item.event.type !== "pto")
    .toSorted((a, b) => a.event.startsAt.localeCompare(b.event.startsAt));

  return (
    <div>
      {offTechs.length > 0 && (
        <p className="px-4 pb-1 pt-3 text-xs font-medium text-zinc-500">Off: {offTechs.join(", ")}</p>
      )}
      {items.length === 0 ? (
        <div className="p-5 text-sm text-zinc-400">Nothing scheduled for this day.</div>
      ) : (
        items.map(({ tech, event: scheduledEvent }, index) => (
          <AgendaRow
            key={`${scheduledEvent.startsAt}-${tech}-${index}`}
            tech={tech}
            event={scheduledEvent}
            haloBaseUrl={week.haloBaseUrl}
          />
        ))
      )}
    </div>
  );
}

function AgendaRow({
  tech,
  event: e,
  haloBaseUrl,
}: {
  readonly tech: string;
  readonly event: WeekEvent;
  readonly haloBaseUrl: string;
}) {
  const style = WEEK_EVENT_STYLE[e.type];
  const href = e.ticketId !== null ? haloTicketUrl(haloBaseUrl, e.ticketId) : null;
  const time = e.type === "pto" ? "OFF" : e.allDay ? "All day" : eventTime(e);
  const firstName = tech.split(" ")[0];
  const body = (
    <>
      <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: style.text }} />
      <span className="w-[72px] shrink-0 text-[13px] font-semibold leading-[22px] tabular-nums" style={{ color: style.text }}>
        {time}
      </span>
      <span className="w-[76px] shrink-0 truncate text-[13px] font-semibold leading-[22px] text-white">{firstName}</span>
      <span className={`min-w-0 flex-1 text-[13px] leading-[22px] text-zinc-300 ${href ? "underline-offset-2 group-hover:underline" : ""}`}>
        {e.subject || style.label}
      </span>
    </>
  );
  const rowClass = "flex min-h-11 items-start gap-2.5 px-4 py-2";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`group ${rowClass}`}>
      {body}
    </a>
  ) : (
    <div className={rowClass}>{body}</div>
  );
}

function TechRow({ tech, haloBaseUrl }: { readonly tech: BoardTech; readonly haloBaseUrl: string }) {
  const color = STATE_COLOR[tech.status.state] ?? "#71717a";
  const context = contextLine(tech.status);
  const contextHref =
    tech.status.state === "working" && tech.workingTicketId !== null
      ? haloTicketUrl(haloBaseUrl, tech.workingTicketId)
      : null;
  const detail = context ?? tech.nextCommitment ?? (tech.status.state === "available" ? "Ready for assignment" : null);
  return (
    <div className="flex min-h-[68px] items-center gap-2.5 px-4 py-2.5" style={{ background: PANEL }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="truncate text-sm font-semibold text-white" title={tech.tech}>
            <span className="sm:hidden">{tech.tech}</span>
            <span className="hidden sm:inline">{tech.tech.split(" ")[0]}</span>
          </p>
          <span className="shrink-0 text-[10px] font-bold uppercase" style={{ color }}>
            {STATE_LABEL[tech.status.state] ?? tech.status.state}
          </span>
        </div>
        {detail &&
          (contextHref && context ? (
            <a
              href={contextHref}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate text-xs text-zinc-500 hover:text-zinc-300"
              title={detail}
            >
              {detail}
            </a>
          ) : (
            <p className="mt-0.5 truncate text-xs text-zinc-500" title={detail}>{detail}</p>
          ))}
      </div>
      <div className="shrink-0 text-right text-[11px] leading-4 text-zinc-500">
        <p><span className="font-semibold text-zinc-300">{tech.load.open}</span> open</p>
        <p className={tech.load.breaching > 0 ? "font-semibold text-red-400" : ""}>
          {tech.load.breaching > 0 ? `${tech.load.breaching} breach` : `${tech.load.wot} waiting`}
        </p>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="space-y-3 p-5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: "#0f0a0c" }} />
      ))}
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
    <section className="rounded-lg border" style={{ borderColor: HAIRLINE, background: PANEL }}>
      <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
