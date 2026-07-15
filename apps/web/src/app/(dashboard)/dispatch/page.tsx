"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, ListChecks, MailCheck, Radio, RefreshCw, Send, TriangleAlert, Users, X } from "lucide-react";
import { formatEtTime, isActiveOrUpcomingEvent } from "@/lib/dispatch/schedule-visibility";
import { ResponseCompliancePanel } from "@/components/dispatch/response-compliance-panel";

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
  readonly load: {
    readonly open: number;
    readonly wot: number;
    readonly customerReply?: number;
    readonly breaching: number;
  };
  readonly workingTicketId: number | null;
  readonly statusTicketId?: number | null;
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
interface CustomerUpdateApproval {
  readonly id: string;
  readonly halo_id: number;
  readonly ticket_summary: string;
  readonly client_name: string | null;
  readonly customer_name: string | null;
  readonly customer_email: string | null;
  readonly tech_name: string | null;
  readonly customer_waiting_reason: string;
  readonly raw_message: string;
  readonly draft_message: string;
  readonly contact_method: "call" | "reply" | null;
  readonly next_action_at: string | null;
  readonly customer_reply_message: string | null;
  readonly customer_replied_at: string | null;
  readonly status: "pending" | "failed" | "customer_declined";
  readonly error_message: string | null;
  readonly source: "sla_call" | "initial_acknowledgment";
  readonly approval_reason: string | null;
  readonly tech_approved_at: string;
  readonly created_at: string;
}
const RED = "#dc2626";
const PANEL = "#151013";
const HAIRLINE = "#3a1f24";
const DISPATCH_REFRESH_MS = 15_000;

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
  onsite: "On Site",
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
  const [customerUpdates, setCustomerUpdates] = useState<ReadonlyArray<CustomerUpdateApproval>>([]);
  const [customerDrafts, setCustomerDrafts] = useState<Record<string, string>>({});
  const [customerUpdateBusy, setCustomerUpdateBusy] = useState<string | null>(null);
  const [customerUpdateError, setCustomerUpdateError] = useState<string | null>(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [actionLane, setActionLane] = useState<"now" | "today">("now");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const [boardRes, suggestRes, customerUpdatesRes] = await Promise.all([
        fetch("/api/dispatch/board", { cache: "no-store" }),
        fetch("/api/dispatch/suggest", { cache: "no-store" }),
        fetch("/api/dispatch/customer-updates", { cache: "no-store" }),
      ]);
      if (!boardRes.ok) throw new Error(`HTTP ${boardRes.status}`);
      if (!suggestRes.ok) throw new Error(`HTTP ${suggestRes.status}`);
      setBoard((await boardRes.json()) as DispatchBoard);
      setSuggest((await suggestRes.json()) as DispatchSuggestions);
      if (customerUpdatesRes.ok) {
        const payload = await customerUpdatesRes.json() as { updates?: ReadonlyArray<CustomerUpdateApproval> };
        const updates = payload.updates ?? [];
        setCustomerUpdates(updates);
        setCustomerDrafts((current) => {
          const next: Record<string, string> = {};
          for (const update of updates) next[update.id] = current[update.id] ?? update.draft_message;
          return next;
        });
        setCustomerUpdateError(null);
      } else {
        setCustomerUpdateError("Customer update approvals are unavailable right now.");
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const actOnCustomerUpdate = useCallback(async (id: string, action: "approve" | "dismiss") => {
    setCustomerUpdateBusy(id);
    setCustomerUpdateError(null);
    try {
      const response = await fetch(`/api/dispatch/customer-updates/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "approve" ? JSON.stringify({ draft_message: customerDrafts[id] ?? "" }) : "{}",
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setCustomerUpdates((current) => current.filter((update) => update.id !== id));
      setCustomerDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (error) {
      setCustomerUpdateError(error instanceof Error ? error.message : "Could not update this approval");
    } finally {
      setCustomerUpdateBusy(null);
    }
  }, [customerDrafts]);

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
    void loadDay(dayOffset);
    const t = setInterval(() => {
      void load(true);
      void loadDay(dayOffset);
    }, DISPATCH_REFRESH_MS);
    return () => clearInterval(t);
  }, [dayOffset, load, loadDay]);

  const degraded = board ? degradationMessages(board.sources) : [];
  const displayedTechs = board?.techs ?? [];

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
            onClick={() => {
              void load(true);
              void loadDay(dayOffset);
            }}
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
        <div className="lg:col-span-6">
          <Section
            title="Right Now"
            icon={<Users className="h-4 w-4" style={{ color: RED }} />}
            className="flex flex-col overflow-hidden lg:h-[476px]"
            actions={
              <p className="max-w-[180px] text-right text-[9px] leading-3 text-zinc-500 sm:max-w-none sm:text-[10px] sm:leading-normal">
                <span className="font-semibold text-zinc-300">WOT</span> = Waiting On Tech
                <span className="px-1.5 text-zinc-700">·</span>
                <span className="font-semibold text-zinc-300">CR</span> = Customer Reply
              </p>
            }
          >
            {loading && !board ? (
              <BoardSkeleton />
            ) : displayedTechs.length === 0 ? (
              <div className="p-5 text-sm text-zinc-400">No technicians on the roster right now.</div>
            ) : (
              <div
                className="grid max-h-[408px] min-h-0 grid-cols-1 gap-px overflow-y-auto sm:grid-cols-2 lg:max-h-none lg:flex-1"
                style={{ background: HAIRLINE }}
              >
                {displayedTechs.map((tech) => (
                  <TechRow key={tech.tech} tech={tech} haloBaseUrl={board!.haloBaseUrl} />
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="lg:col-span-6">
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

      <ResponseCompliancePanel haloBaseUrl={board?.haloBaseUrl ?? suggest?.haloBaseUrl ?? ""} />

      <div id="customer-email-approvals" className="scroll-mt-5">
        <CustomerUpdateQueue
          updates={customerUpdates}
          drafts={customerDrafts}
          busyId={customerUpdateBusy}
          error={customerUpdateError}
          haloBaseUrl={board?.haloBaseUrl ?? suggest?.haloBaseUrl ?? ""}
          onDraftChange={(id, value) => setCustomerDrafts((current) => ({ ...current, [id]: value }))}
          onApprove={(id) => void actOnCustomerUpdate(id, "approve")}
          onDismiss={(id) => void actOnCustomerUpdate(id, "dismiss")}
        />
      </div>

      <Section
        title="Next Actions"
        icon={<ListChecks className="h-4 w-4" style={{ color: RED }} />}
        actions={
          <div className="flex h-9 rounded-md border p-0.5" style={{ borderColor: HAIRLINE, background: "#0f0a0c" }}>
            <ActionLaneButton
              active={actionLane === "now"}
              count={suggest?.actionCounts.now ?? 0}
              onClick={() => setActionLane("now")}
            >
              Now
            </ActionLaneButton>
            <ActionLaneButton
              active={actionLane === "today"}
              count={suggest?.actionCounts.today ?? 0}
              onClick={() => setActionLane("today")}
            >
              Today
            </ActionLaneButton>
          </div>
        }
      >
        {loading && !suggest ? <BoardSkeleton /> : <DispatchActionList data={suggest} lane={actionLane} />}
      </Section>
    </div>
  );
}

function CustomerUpdateQueue({
  updates,
  drafts,
  busyId,
  error,
  haloBaseUrl,
  onDraftChange,
  onApprove,
  onDismiss,
}: {
  readonly updates: ReadonlyArray<CustomerUpdateApproval>;
  readonly drafts: Readonly<Record<string, string>>;
  readonly busyId: string | null;
  readonly error: string | null;
  readonly haloBaseUrl: string;
  readonly onDraftChange: (id: string, value: string) => void;
  readonly onApprove: (id: string) => void;
  readonly onDismiss: (id: string) => void;
}) {
  return (
    <Section
      title="Customer Email Approvals"
      icon={<MailCheck className="h-4 w-4 text-amber-400" />}
      actions={
        <span className="inline-flex min-w-7 items-center justify-center rounded border px-2 py-1 text-xs font-bold tabular-nums text-amber-300" style={{ borderColor: "#92400e", background: "#1c1206" }}>
          {updates.length}
        </span>
      }
    >
      {error && (
        <div className="border-b px-5 py-3 text-sm text-red-300" style={{ borderColor: HAIRLINE, background: "#210d12" }}>
          {error}
        </div>
      )}
      {updates.length === 0 ? (
        <div className="px-5 py-5 text-sm text-zinc-500">No customer emails awaiting approval.</div>
      ) : (
        <div className="divide-y" style={{ borderColor: HAIRLINE }}>
          {updates.map((update) => {
            const href = haloTicketUrl(haloBaseUrl, update.halo_id);
            const busy = busyId === update.id;
            const draft = drafts[update.id] ?? update.draft_message;
            const needsFollowUp = update.status === "customer_declined";
            const initialAcknowledgment = update.source === "initial_acknowledgment";
            const legacyDraft = !initialAcknowledgment && (!update.contact_method || !update.next_action_at);
            const approvedAt = new Date(update.tech_approved_at).toLocaleString("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });
            const nextAction = update.next_action_at
              ? new Date(update.next_action_at).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })
              : null;
            return (
              <div key={update.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-mono text-xs font-bold text-white">#{update.halo_id}</span>
                      {needsFollowUp && (
                        <span className="inline-flex items-center gap-1 rounded border border-red-800 bg-red-950/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
                          <TriangleAlert className="h-3 w-3" /> Needs follow-up
                        </span>
                      )}
                      {initialAcknowledgment && (
                        <span className="inline-flex items-center rounded border border-sky-900 bg-sky-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-300">
                          Initial acknowledgment
                        </span>
                      )}
                      <span className="text-sm font-semibold text-zinc-200">{update.client_name ?? "Unknown client"}</span>
                      <span className="min-w-0 break-words text-sm text-zinc-400">{update.ticket_summary}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-zinc-500">
                      <span>{update.customer_name ?? "Customer"}{update.customer_email ? ` · ${update.customer_email}` : ""}</span>
                      <span className="text-zinc-700">·</span>
                      <span>Tech: <span className="text-zinc-300">{update.tech_name ?? "Unknown"}</span></span>
                      <span className="text-zinc-700">·</span>
                      <span>{approvedAt}</span>
                    </div>
                  </div>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ticket ${update.halo_id} in Halo`}
                      title={`Open ticket #${update.halo_id} in Halo`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-zinc-500 transition hover:text-white"
                      style={{ borderColor: HAIRLINE }}
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </a>
                  )}
                </div>
                <p className="mt-3 border-l-2 pl-3 text-xs leading-5 text-amber-200/80" style={{ borderColor: "#d97706" }}>
                  {update.customer_waiting_reason}
                </p>
                {nextAction && update.contact_method && (
                  <p className="mt-2 text-xs font-semibold text-sky-300">
                    {initialAcknowledgment
                      ? `Assigned technician email due by ${nextAction}`
                      : `Email now · ${update.contact_method === "call" ? "Customer call" : "Next email update"} committed for ${nextAction}`}
                  </p>
                )}
                {needsFollowUp && update.customer_reply_message && (
                  <div className="mt-3 rounded-md border border-red-900/70 bg-red-950/30 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-red-300">Customer response</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-zinc-200">{update.customer_reply_message}</p>
                  </div>
                )}
                {legacyDraft && !needsFollowUp && (
                  <p className="mt-2 text-xs text-red-300">This draft was created before exact next-action commitments were required. Restage it from a technician call before sending.</p>
                )}
                {update.status === "failed" && update.error_message && (
                  <p className="mt-2 text-xs text-red-300">Last send failed: {update.error_message}</p>
                )}
                {!needsFollowUp && (
                  <textarea
                    value={draft}
                    onChange={(event) => onDraftChange(update.id, event.target.value)}
                    disabled={busy || legacyDraft}
                    aria-label={`Customer email for ticket ${update.halo_id}`}
                    className="mt-3 min-h-24 w-full resize-y rounded-md border bg-black/20 px-3 py-2.5 text-sm leading-6 text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-red-700 disabled:opacity-60"
                    style={{ borderColor: HAIRLINE }}
                  />
                )}
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    onClick={() => onDismiss(update.id)}
                    disabled={busy}
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-semibold text-zinc-400 transition hover:text-white disabled:cursor-default disabled:opacity-50"
                    style={{ borderColor: HAIRLINE }}
                  >
                    <X className="h-3.5 w-3.5" />
                    {needsFollowUp ? "Clear" : "Dismiss"}
                  </button>
                  {!needsFollowUp && (
                    <button
                      onClick={() => onApprove(update.id)}
                      disabled={busy || legacyDraft || draft.trim().length < 20}
                      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-default disabled:opacity-50"
                      style={{ borderColor: "#dc2626", background: "#991b1b" }}
                    >
                      <Send className={`h-3.5 w-3.5 ${busy ? "animate-pulse" : ""}`} />
                      Approve &amp; Email
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ActionLaneButton({
  active,
  count,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly count: number;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-8 min-w-[68px] cursor-pointer items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition ${
        active ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
      <span className={active ? "text-zinc-300" : "text-zinc-600"}>{count}</span>
    </button>
  );
}

function DispatchActionList({
  data,
  lane,
}: {
  readonly data: DispatchSuggestions | null;
  readonly lane: "now" | "today";
}) {
  const actions = (data?.actions ?? []).filter((item) => item.lane === lane);
  const total = data?.actionCounts[lane] ?? actions.length;
  const visible = actions.slice(0, 5);
  const hidden = Math.max(0, total - visible.length);

  return (
    <div>
      {visible.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-zinc-400">
          Nothing needs dispatch attention {lane === "now" ? "right now" : "today"}.
        </div>
      ) : (
        <div className="divide-y divide-[#3a1f24]">
          {visible.map((item) => (
            <DispatchActionRow key={item.halo_id} item={item} haloBaseUrl={data?.haloBaseUrl ?? ""} />
          ))}
        </div>
      )}

      {hidden > 0 && (
        <div className="flex items-center justify-between gap-3 border-t px-5 py-2.5 text-xs text-zinc-500" style={{ borderColor: HAIRLINE }}>
          <span>Showing the top {visible.length} of {total} {lane} actions.</span>
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

const ACTION_FALLBACK_STATUS: Record<DispatchActionKind, string> = {
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

function ticketStatusColor(status: string | null, fallback: string): string {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (normalized.includes("past-due") || normalized.includes("past due")) return "#fb7185";
  if (normalized.includes("in progress")) return "#38bdf8";
  if (normalized.includes("customer reply")) return "#e879f9";
  if (normalized.includes("waiting on tech")) return "#fbbf24";
  if (normalized.includes("waiting on customer")) return "#c084fc";
  if (normalized === "new") return "#a3e635";
  if (normalized.includes("scheduled")) return "#4ade80";
  return fallback;
}

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
  const status = item.status?.trim() || ACTION_FALLBACK_STATUS[item.kind];
  const statusColor = ticketStatusColor(item.status, color);
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
            style={{ color: statusColor, borderColor: `${statusColor}55`, background: `${statusColor}14` }}
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
  const nowMs = Date.now();
  const relevantTechs = week.techs.map((tech) => ({
    ...tech,
    events: tech.events.filter((event) => event.day === day && isActiveOrUpcomingEvent(event, nowMs)),
  }));
  const activeTechs = relevantTechs.filter((tech) => tech.events.length > 0);
  const quietTechs = week.techs
    .filter((tech) => !relevantTechs.some((candidate) => candidate.tech === tech.tech && candidate.events.length > 0))
    .map((tech) => tech.tech);
  return (
    <Section
      title={header.isToday ? "Today" : header.name}
      icon={<CalendarClock className="h-4 w-4" style={{ color: RED }} />}
      className="flex flex-col overflow-hidden lg:h-[476px]"
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
      <div className="flex min-h-0 flex-1 flex-col">
        <DayAgenda key={day} week={week} day={day} techs={activeTechs} isToday={header.isToday} nowMs={nowMs} />
        {quietTechs.length > 0 && (
          <p
            className="flex h-9 shrink-0 items-center truncate border-t px-5 text-xs text-zinc-500"
            style={{ borderColor: HAIRLINE }}
            title={`${header.isToday ? "No remaining items" : "No scheduled items"}: ${quietTechs.join(", ")}`}
          >
            {header.isToday ? "No remaining items" : "No scheduled items"}: {quietTechs.join(", ")}
          </p>
        )}
      </div>
    </Section>
  );
}

interface AgendaItem {
  readonly tech: string;
  readonly event: WeekEvent;
}

const AGENDA_PAGE_SIZE = 7;

/** One dispatcher day, ordered by time, with the assigned technician on every row. */
function DayAgenda({
  week,
  day,
  techs,
  isToday,
  nowMs,
}: {
  readonly week: WeekData;
  readonly day: string;
  readonly techs: ReadonlyArray<{ readonly tech: string; readonly events: ReadonlyArray<WeekEvent> }>;
  readonly isToday: boolean;
  readonly nowMs: number;
}) {
  const [page, setPage] = useState(0);
  const all = techs.flatMap((tech): ReadonlyArray<AgendaItem> =>
    tech.events.filter((event) => event.day === day).map((event) => ({ tech: tech.tech, event })),
  );
  const offTechs = [...new Set(all.filter((item) => item.event.type === "pto").map((item) => item.tech.split(" ")[0]))];
  const items = all
    .filter((item) => item.event.type !== "pto")
    .toSorted((a, b) => a.event.startsAt.localeCompare(b.event.startsAt) || a.tech.localeCompare(b.tech));
  const pageSize = isToday ? AGENDA_PAGE_SIZE - 1 : AGENDA_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = items.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {offTechs.length > 0 && (
        <p className="shrink-0 px-4 pb-1 pt-3 text-xs font-medium text-zinc-500">Off: {offTechs.join(", ")}</p>
      )}
      {isToday && items.length > 0 && (
        <div className="flex h-7 shrink-0 items-center gap-2 px-4" aria-label={`Current time ${formatEtTime(nowMs)}`}>
          <span className="text-[10px] font-semibold uppercase text-red-400">Now</span>
          <span className="h-px flex-1 bg-red-500/40" />
          <span className="text-[10px] tabular-nums text-zinc-500">{formatEtTime(nowMs)}</span>
        </div>
      )}
      {items.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-5 text-sm text-zinc-400">
          {isToday ? "Nothing else scheduled today." : "Nothing scheduled for this day."}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {visible.map(({ tech, event: scheduledEvent }, index) => (
            <AgendaRow
              key={`${scheduledEvent.startsAt}-${tech}-${index}`}
              tech={tech}
              event={scheduledEvent}
              haloBaseUrl={week.haloBaseUrl}
            />
          ))}
        </div>
      )}
      {pageCount > 1 && (
        <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-t px-4" style={{ borderColor: HAIRLINE }}>
          <button
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={safePage === 0}
            aria-label="Previous schedule page"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border text-zinc-400 hover:text-white disabled:cursor-default disabled:opacity-30"
            style={{ borderColor: HAIRLINE }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-12 text-center text-xs tabular-nums text-zinc-500">{safePage + 1} / {pageCount}</span>
          <button
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={safePage >= pageCount - 1}
            aria-label="Next schedule page"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border text-zinc-400 hover:text-white disabled:cursor-default disabled:opacity-30"
            style={{ borderColor: HAIRLINE }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
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
  const statusTicketId = tech.statusTicketId ?? (tech.status.state === "working" ? tech.workingTicketId : null);
  const contextHref =
    (tech.status.state === "working" || tech.status.state === "onsite") && statusTicketId !== null
      ? haloTicketUrl(haloBaseUrl, statusTicketId)
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
        <p>
          <span className="font-semibold text-zinc-300">{tech.load.open}</span> open
          {tech.load.breaching > 0 && <span className="font-semibold text-red-400"> · {tech.load.breaching} SLA</span>}
        </p>
        <p className="whitespace-nowrap text-[10px]">
          <span className="font-semibold text-zinc-300">{tech.load.wot}</span> WOT
          <span className="text-zinc-700"> · </span>
          <span className="font-semibold text-zinc-300">{tech.load.customerReply ?? 0}</span> CR
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
    <section className={`rounded-lg border ${className}`} style={{ borderColor: HAIRLINE, background: PANEL }}>
      <div className="flex items-center gap-2 border-b px-5 py-3" style={{ borderColor: HAIRLINE }}>
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
