"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ClipboardList, Phone, Radio, RefreshCw, TriangleAlert, Users } from "lucide-react";

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
  readonly nextCommitment: string | null;
  readonly aiRead: string | null;
}
interface DispatchBoard {
  readonly generatedAt: string;
  readonly sources: { readonly halo: boolean; readonly threecx: boolean; readonly calendar: boolean };
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
  readonly suggestions: ReadonlyArray<Suggestion>;
}
interface DispatchSuggestions {
  readonly tickets: ReadonlyArray<SuggestTicket>;
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
  off: "Off",
  unreachable: "Unreachable",
  unknown: "No Signal",
};

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
      return null; // "Available" needs no elaboration
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

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Right Now tech board */}
        <div className="lg:col-span-7">
          <Section title="Right Now" icon={<Users className="h-4 w-4" style={{ color: RED }} />}>
            {loading && !board ? (
              <BoardSkeleton />
            ) : (board?.techs.length ?? 0) === 0 ? (
              <div className="p-5 text-sm text-zinc-400">No technicians on the roster right now.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: HAIRLINE }}>
                {board!.techs.map((t) => (
                  <TechRow key={t.tech} tech={t} />
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Assignment helper */}
        <div className="lg:col-span-5">
          <Section title="Assignment Helper" icon={<ClipboardList className="h-4 w-4" style={{ color: RED }} />}>
            {loading && !suggest ? (
              <BoardSkeleton />
            ) : (suggest?.tickets.length ?? 0) === 0 ? (
              <div className="p-5 text-sm text-zinc-400">No unassigned or New tickets — queue is clean.</div>
            ) : (
              <div className="divide-y" style={{ borderColor: HAIRLINE }}>
                {suggest!.tickets.map((t) => (
                  <TicketSuggestions key={t.halo_id} ticket={t} />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function TechRow({ tech }: { readonly tech: BoardTech }) {
  const color = STATE_COLOR[tech.status.state] ?? "#71717a";
  const context = contextLine(tech.status);
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
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500">
              <Phone className="h-3 w-3" />
              {phoneLabel(tech.phone)}
            </span>
          )}
        </div>
        {context && <div className="mt-0.5 text-xs text-zinc-300">{context}</div>}
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

function TicketSuggestions({ ticket }: { readonly ticket: SuggestTicket }) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm font-bold text-white">#{ticket.halo_id}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
          {ticket.client_name ?? "Unknown client"}
          {ticket.summary ? ` — ${ticket.summary}` : ""}
        </span>
      </div>
      {ticket.suggestions.length === 0 ? (
        <p className="mt-1.5 text-xs text-zinc-500">No suggestions available.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {ticket.suggestions.map((s, i) => (
            <li key={s.tech} className="flex items-start gap-2">
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: i === 0 ? RED : "#7f1d1d" }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={i === 0 ? "text-sm font-semibold text-white" : "text-sm font-medium text-white/80"}>
                    {s.tech}
                  </span>
                  {i === 0 && (
                    <span
                      className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                      style={{ background: `${RED}22`, color: "#fca5a5" }}
                    >
                      Best pick
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500">{s.reasons.join(" · ")}</p>
              </div>
            </li>
          ))}
        </ul>
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
