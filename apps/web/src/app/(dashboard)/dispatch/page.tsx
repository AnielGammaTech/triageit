"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Phone, Radio, RefreshCw, TriangleAlert, Users } from "lucide-react";

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
interface SuggestTicket {
  readonly halo_id: number;
  readonly summary: string | null;
  readonly client_name: string | null;
  readonly status: string | null;
  readonly duplicates?: number;
  readonly suggestions: ReadonlyArray<Suggestion>;
}
interface DispatchSuggestions {
  readonly haloBaseUrl: string;
  readonly tickets: ReadonlyArray<SuggestTicket>;
  readonly omitted?: number;
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
  meeting: "#f59e0b",
  onsite: "#fe9200",
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

/** Compact "what the phone says" label for the right edge of a row. */
function phoneLabel(phone: BoardTech["phone"]): string | null {
  if (!phone) return null;
  if (phone.onCall) return "On a call";
  if (phone.registered === false) return "Not registered";
  if (phone.profile) return phone.profile;
  return phone.registered === true ? "Registered" : null;
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
  const [weekOffset, setWeekOffset] = useState(0);
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

  const loadWeek = useCallback(async (offset: number) => {
    try {
      const qs = offset === 0 ? "" : `?start=${weekStartIso(offset)}`;
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
    void loadWeek(weekOffset);
  }, [loadWeek, weekOffset]);

  const degraded = board ? degradationMessages(board.sources) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: `linear-gradient(135deg, ${RED}, #7f1d1d)`, boxShadow: `0 0 24px -6px ${RED}` }}
          >
            <Radio className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Dispatch</h1>
            <p className="text-sm text-zinc-400">Who&apos;s free right now, and who should take each unassigned ticket</p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-zinc-300 transition hover:text-white"
          style={{ borderColor: HAIRLINE, background: PANEL }}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
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

      {/* Right Now — full-width compact card grid */}
      <Section title="Right Now" icon={<Users className="h-4 w-4" style={{ color: RED }} />}>
        {loading && !board ? (
          <BoardSkeleton />
        ) : (board?.techs.length ?? 0) === 0 ? (
          <div className="p-5 text-sm text-zinc-400">No technicians on the roster right now.</div>
        ) : (
          <div className="grid grid-cols-1 gap-px sm:grid-cols-2 xl:grid-cols-3" style={{ background: HAIRLINE }}>
            {board!.techs.map((t) => (
              <div key={t.tech} style={{ background: PANEL }}>
                <TechRow tech={t} haloBaseUrl={board!.haloBaseUrl} />
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Next 3 days schedule + assignment helper, side by side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {week && week.techs.length > 0 ? (
            <WeekGrid week={week} onPrev={() => setWeekOffset((w) => Math.max(0, w - 1))} onNext={() => setWeekOffset((w) => w + 1)} onToday={() => setWeekOffset(0)} atToday={weekOffset === 0} />
          ) : (
            <Section title="Next 3 Days" icon={<CalendarClock className="h-4 w-4" style={{ color: RED }} />}>
              <div className="p-5 text-sm text-zinc-400">Schedule unavailable right now.</div>
            </Section>
          )}
        </div>

        <div className="lg:col-span-5">
          <Section title="Assignment Helper" icon={<ClipboardList className="h-4 w-4" style={{ color: RED }} />}>
            {loading && !suggest ? (
              <BoardSkeleton />
            ) : (suggest?.tickets.length ?? 0) === 0 ? (
              <div className="p-5 text-sm text-zinc-400">No unassigned or New tickets — queue is clean.</div>
            ) : (
              <>
                <div className="divide-y" style={{ borderColor: HAIRLINE }}>
                  {suggest!.tickets.map((t) => (
                    <TicketSuggestions key={t.halo_id} ticket={t} haloBaseUrl={suggest!.haloBaseUrl} />
                  ))}
                </div>
                {(suggest!.omitted ?? 0) > 0 && (
                  <p className="border-t px-5 py-2 text-xs text-zinc-500" style={{ borderColor: HAIRLINE }}>
                    +{suggest!.omitted} more unassigned — see the Tickets queue.
                  </p>
                )}
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/** Today (ET) plus `offset` 3-day pages, as YYYY-MM-DD. Never in the past. */
function weekStartIso(offset: number): string {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() + Math.max(0, offset) * 3);
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

const WEEK_EVENT_STYLE: Record<WeekEvent["type"], { bg: string; text: string; label: string }> = {
  site_visit: { bg: "#fe920022", text: "#fdba74", label: "Site Visit" },
  reminder: { bg: "#38bdf822", text: "#7dd3fc", label: "Reminder" },
  pto: { bg: "#71717a22", text: "#a1a1aa", label: "OFF" },
  meeting: { bg: "#f59e0b22", text: "#fcd34d", label: "Meeting" },
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

const MAX_CHIPS_PER_DAY = 3;

function WeekGrid({
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
  const rangeLabel = `${fmtDayHeader(week.days[0]).date} – ${fmtDayHeader(week.days[week.days.length - 1]).date}`;
  const days = week.days;
  // People with nothing coming up collapse into a single footer line.
  const activeTechs = week.techs.filter((t) => t.events.length > 0);
  const quietTechs = week.techs.filter((t) => t.events.length === 0).map((t) => t.tech);
  return (
    <Section
      title="Next 3 Days"
      icon={<CalendarClock className="h-4 w-4" style={{ color: RED }} />}
      actions={
        <div className="flex items-center gap-1">
          {/* Agenda day headers carry the dates on mobile; hide the range to keep the ≥40px nav buttons from overflowing at 390px. */}
          <span className="mr-2 hidden text-xs text-zinc-400 sm:inline">{rangeLabel}</span>
          <button
            onClick={onPrev}
            disabled={atToday}
            aria-label="Previous days"
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
            aria-label="Next days"
            className="flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border text-zinc-300 hover:text-white"
            style={{ borderColor: HAIRLINE }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      }
    >
      {/* Mobile: per-day agenda list (the 8-column grid is unreadable under ~760px) */}
      <div className="md:hidden">
        <WeekAgenda week={week} days={days} techs={activeTechs} />
      </div>

      {/* Desktop: tech × day grid */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-left">
          <thead>
            <tr>
              <th className="w-32 px-4 py-2 text-xs font-medium text-zinc-400" />
              {days.map((day) => {
                const h = fmtDayHeader(day);
                return (
                  <th key={day} className="border-l px-2 py-2 text-xs font-medium" style={{ borderColor: HAIRLINE }}>
                    <span className={h.isToday ? "rounded-full px-2 py-0.5 font-bold text-white" : "text-zinc-400"} style={h.isToday ? { background: RED } : undefined}>
                      {h.name} {h.date}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {activeTechs.map((row) => (
              <tr key={row.tech} className="border-t align-top" style={{ borderColor: HAIRLINE }}>
                <td className="truncate px-4 py-2 text-sm font-medium text-white">{row.tech}</td>
                {days.map((day) => {
                  const events = row.events.filter((e) => e.day === day);
                  const shown = events.slice(0, MAX_CHIPS_PER_DAY);
                  const hidden = events.length - shown.length;
                  return (
                    <td key={day} className="border-l px-1.5 py-1.5" style={{ borderColor: HAIRLINE }}>
                      <div className="space-y-1">
                        {shown.map((e, i) => {
                          const style = WEEK_EVENT_STYLE[e.type];
                          const href = e.ticketId !== null ? haloTicketUrl(week.haloBaseUrl, e.ticketId) : null;
                          const body = (
                            <>
                              <span className="font-semibold">{e.type === "pto" ? "OFF" : eventTime(e)}</span>{" "}
                              {e.type === "pto" ? "" : e.subject}
                            </>
                          );
                          return href ? (
                            <a
                              key={`${e.startsAt}-${i}`}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              title={`${style.label}: ${e.subject}`}
                              className="block truncate rounded px-1.5 py-1 text-[10px] leading-tight hover:underline"
                              style={{ background: style.bg, color: style.text }}
                            >
                              {body}
                            </a>
                          ) : (
                            <div
                              key={`${e.startsAt}-${i}`}
                              title={`${style.label}: ${e.subject}`}
                              className="truncate rounded px-1.5 py-1 text-[10px] leading-tight"
                              style={{ background: style.bg, color: style.text }}
                            >
                              {body}
                            </div>
                          );
                        })}
                        {hidden > 0 && (
                          <div
                            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500"
                            title={events.slice(MAX_CHIPS_PER_DAY).map((e) => `${eventTime(e)} ${e.subject}`).join("\n")}
                          >
                            +{hidden} more
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {quietTechs.length > 0 && (
        <p className="border-t px-5 py-2 text-xs text-zinc-500" style={{ borderColor: HAIRLINE }}>
          Nothing coming up: {quietTechs.join(", ")}
        </p>
      )}
    </Section>
  );
}

interface AgendaItem {
  readonly tech: string;
  readonly event: WeekEvent;
}

/** Mobile week view — one section per day, one ≥44px row per event, full subjects. */
function WeekAgenda({
  week,
  days,
  techs,
}: {
  readonly week: WeekData;
  readonly days: ReadonlyArray<string>;
  readonly techs: ReadonlyArray<{ readonly tech: string; readonly events: ReadonlyArray<WeekEvent> }>;
}) {
  const byDay = days
    .map((day) => ({
      day,
      items: techs
        .flatMap((t): ReadonlyArray<AgendaItem> => t.events.filter((e) => e.day === day).map((event) => ({ tech: t.tech, event })))
        .toSorted((a, b) => a.event.startsAt.localeCompare(b.event.startsAt)),
    }))
    .filter((d) => d.items.length > 0);

  if (byDay.length === 0) {
    return <div className="p-5 text-sm text-zinc-400">Nothing scheduled this week.</div>;
  }

  return (
    <div>
      {byDay.map(({ day, items }) => {
        const h = fmtDayHeader(day);
        return (
          <div key={day} className="border-t first:border-t-0" style={{ borderColor: HAIRLINE }}>
            <div className="px-4 pb-1 pt-3 text-xs font-medium">
              <span
                className={h.isToday ? "rounded-full px-2 py-0.5 font-bold text-white" : "text-zinc-400"}
                style={h.isToday ? { background: RED } : undefined}
              >
                {h.name} {h.date}
              </span>
            </div>
            {items.map(({ tech, event: e }, i) => (
              <AgendaRow key={`${e.startsAt}-${tech}-${i}`} tech={tech} event={e} haloBaseUrl={week.haloBaseUrl} />
            ))}
          </div>
        );
      })}
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
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: style.text }} />
      <span className="w-16 shrink-0 text-xs font-semibold leading-5" style={{ color: style.text }}>
        {time}
      </span>
      <span className="w-16 shrink-0 truncate text-xs font-medium leading-5 text-white">{firstName}</span>
      <span className={`min-w-0 flex-1 text-xs leading-5 text-zinc-300 ${href ? "underline-offset-2 group-hover:underline" : ""}`}>
        {e.subject || style.label}
      </span>
    </>
  );
  const rowClass = "flex min-h-11 items-start gap-2.5 px-4 py-2.5";
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
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <span
        className="mt-0.5 inline-flex w-24 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ background: `${color}1f`, color, border: `1px solid ${color}55` }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        {STATE_LABEL[tech.status.state] ?? tech.status.state}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-semibold text-white">{tech.tech}</span>
          <span className="text-xs text-zinc-400">
            {tech.load.open} open · {tech.load.wot} waiting on tech
            {tech.load.breaching > 0 && (
              <span className="font-semibold" style={{ color: RED }}>
                {" "}· {tech.load.breaching} breaching SLA
              </span>
            )}
          </span>
          {phoneLabel(tech.phone) && (
            <span className="ml-auto inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] text-zinc-500">
              <Phone className="h-3 w-3 shrink-0" />
              <span className="truncate">{phoneLabel(tech.phone)}</span>
            </span>
          )}
        </div>
        {context &&
          (contextHref ? (
            <a
              href={contextHref}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block text-xs text-zinc-300 hover:underline"
            >
              {context}
            </a>
          ) : (
            <div className="mt-0.5 text-xs text-zinc-300">{context}</div>
          ))}
        {tech.nextCommitment && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
            <CalendarClock className="h-3 w-3 shrink-0" />
            Next: {tech.nextCommitment}
          </div>
        )}
      </div>
    </div>
  );
}

function TicketSuggestions({
  ticket,
  haloBaseUrl,
}: {
  readonly ticket: SuggestTicket;
  readonly haloBaseUrl: string;
}) {
  const href = haloTicketUrl(haloBaseUrl, ticket.halo_id);
  return (
    <div className="px-5 py-3">
      <div className="flex items-baseline gap-2">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="font-mono text-sm font-bold text-white hover:underline">
            #{ticket.halo_id}
          </a>
        ) : (
          <span className="font-mono text-sm font-bold text-white">#{ticket.halo_id}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
          {ticket.client_name ?? "Unknown client"}
          {ticket.summary ? ` — ${ticket.summary}` : ""}
        </span>
        {(ticket.duplicates ?? 0) > 0 && (
          <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] text-zinc-400" style={{ borderColor: HAIRLINE }}>
            ×{(ticket.duplicates ?? 0) + 1}
          </span>
        )}
      </div>
      {ticket.suggestions.length === 0 ? (
        <p className="mt-1.5 text-xs text-zinc-500">No suggestions available.</p>
      ) : (
        <div className="mt-1.5">
          {/* One clear recommendation; the runners-up are a single muted line. */}
          <div className="flex items-baseline gap-2">
            <span
              className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
              style={{ background: `${RED}22`, color: "#fca5a5" }}
            >
              Assign
            </span>
            <span className="text-sm font-semibold text-white">{ticket.suggestions[0].tech}</span>
            <span className="min-w-0 truncate text-xs text-zinc-500">
              {ticket.suggestions[0].reasons.slice(0, 2).join(" · ")}
            </span>
          </div>
          {ticket.suggestions.length > 1 && (
            <p className="mt-0.5 truncate text-xs text-zinc-600">
              Also: {ticket.suggestions.slice(1).map((s) => s.tech.split(" ")[0]).join(", ")}
            </p>
          )}
        </div>
      )}
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
