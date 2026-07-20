"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  RefreshCw,
  Search,
  Unlink,
  Users,
} from "lucide-react";
import { fetchWithTimeout } from "@/lib/async-timeout";

interface CallItem {
  readonly recordingId: number;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly direction: "inbound" | "outbound" | "unknown";
  readonly techName: string;
  readonly externalNumber: string | null;
  readonly transcript: string | null;
  readonly transcriptChars: number;
  readonly callSummary: string | null;
  readonly matchState: "matched" | "unmatched" | "attention" | "internal" | "separate" | "ignored";
  readonly matchMethod: string;
  readonly matchLabel: string;
  readonly notePosted: boolean;
  readonly analysisAttempts: number;
  readonly identifiedCustomerName: string | null;
  readonly identifiedClientName: string | null;
  readonly cnamName: string | null;
  readonly cnamType: "BUSINESS" | "CONSUMER" | null;
  readonly matchEvidence: string | null;
  readonly reviewStatus: string | null;
  readonly reviewOwner: string;
  readonly reviewSentAt: string | null;
  readonly reviewedAt: string | null;
  readonly callType: string | null;
  readonly from: { readonly name: string | null; readonly number: string | null };
  readonly to: { readonly name: string | null; readonly number: string | null };
  readonly ticket: {
    readonly haloId: number;
    readonly summary: string | null;
    readonly clientName: string | null;
    readonly status: string | null;
    readonly customerName: string | null;
  } | null;
}

interface CallPayload {
  readonly generatedAt: string;
  readonly haloBaseUrl: string;
  readonly sourceAvailable: boolean;
  readonly viewer: { readonly name: string | null; readonly role: "admin" | "manager" | "viewer" };
  readonly items: ReadonlyArray<CallItem>;
  readonly counts: { readonly total: number; readonly matched: number; readonly unmatched: number; readonly pendingReviews: number; readonly internal: number; readonly separate: number; readonly ignored: number; readonly attention: number };
}

type View = "all" | "reviews" | "matched" | "unmatched" | "internal" | "separate" | "ignored";
const PAGE_SIZE = 15;
const PANEL = "#151013";
const HAIRLINE = "#3a1f24";

function ticketUrl(baseUrl: string, haloId: number): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/tickets`;
    url.search = `?id=${haloId}`;
    return url.toString();
  } catch {
    return null;
  }
}

function callTime(value: string | null): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function duration(start: string | null, end: string | null): string | null {
  const startMs = start ? new Date(start).getTime() : NaN;
  const endMs = end ? new Date(end).getTime() : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const seconds = Math.round((endMs - startMs) / 1_000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function phone(value: string | null): string {
  const digits = (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : value || "No external number";
}

function partyName(party: CallItem["from"] | CallItem["to"]): string {
  return party.name || phone(party.number);
}

function peopleNamesOverlap(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const tokens = (value: string) => new Set(value.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 3));
  const a = tokens(left);
  const b = tokens(right);
  return [...a].filter((token) => b.has(token)).length >= Math.min(2, a.size, b.size);
}

function isPendingReview(item: CallItem): boolean {
  return item.matchState === "unmatched" && item.reviewStatus === "pending";
}

export default function CallsPage() {
  const [data, setData] = useState<CallPayload | null>(null);
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialReviewFocusApplied = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const response = await fetchWithTimeout("/api/calls", { cache: "no-store" }, undefined, "3CX calls");
      const payload = await response.json() as CallPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setData(payload);
      if (!initialReviewFocusApplied.current) {
        initialReviewFocusApplied.current = true;
        if (payload.counts.pendingReviews > 0) setView("reviews");
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load calls");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => setPage(0), [view, search]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.items ?? []).filter((item) => {
      if (view === "matched" && !item.ticket) return false;
      if (view === "reviews" && !isPendingReview(item)) return false;
      if (view === "unmatched" && item.matchState !== "unmatched") return false;
      if (view === "internal" && item.matchState !== "internal") return false;
      if (view === "separate" && item.matchState !== "separate") return false;
      if (view === "ignored" && item.matchState !== "ignored") return false;
      if (!needle) return true;
      return [
        item.techName,
        item.externalNumber,
        item.from.name,
        item.from.number,
        item.to.name,
        item.to.number,
        item.transcript,
        item.callSummary,
        item.matchLabel,
        item.ticket?.haloId,
        item.ticket?.summary,
        item.ticket?.clientName,
        item.ticket?.customerName,
        item.cnamName,
      ].some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }, [data, search, view]);
  const pendingReviewCount = data?.counts.pendingReviews ?? 0;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: "#991b1b" }}>
            <PhoneCall className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">3CX Calls</h1>
            <p className="hidden text-xs text-zinc-500 sm:block">Call identity, ticket matches, and recordings that need a decision</p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          aria-label="Refresh 3CX calls"
          title="Refresh 3CX calls"
          className="flex h-8 w-8 items-center justify-center rounded-md border text-zinc-400 transition hover:bg-white/[0.03] hover:text-white disabled:opacity-50"
          style={{ borderColor: HAIRLINE, background: PANEL }}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border sm:grid-cols-4" style={{ borderColor: HAIRLINE, background: HAIRLINE }}>
        <Metric label="Recent Calls" value={data?.counts.total ?? 0} icon={<PhoneCall className="h-4 w-4" />} color="#e4e4e7" />
        <Metric label="Matched" value={data?.counts.matched ?? 0} icon={<Link2 className="h-4 w-4" />} color="#4ade80" />
        <Metric label="Unmatched" value={data?.counts.unmatched ?? 0} icon={<Unlink className="h-4 w-4" />} color="#fbbf24" />
        <Metric label="Needs Tech Match" value={pendingReviewCount} icon={<Users className="h-4 w-4" />} color="#fbbf24" />
      </div>

      <section className="overflow-hidden rounded-md border" style={{ borderColor: HAIRLINE, background: PANEL }}>
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: HAIRLINE }}>
          <div className="grid w-full grid-cols-3 rounded-md border p-0.5 sm:flex sm:h-8 sm:w-auto" style={{ borderColor: HAIRLINE, background: "#0f0a0c" }}>
            <ViewButton active={view === "all"} onClick={() => setView("all")} label="All" count={data?.counts.total ?? 0} />
            <ViewButton active={view === "reviews"} onClick={() => setView("reviews")} label="Needs review" count={pendingReviewCount} />
            <ViewButton active={view === "matched"} onClick={() => setView("matched")} label="Matched" count={data?.counts.matched ?? 0} />
            <ViewButton active={view === "unmatched"} onClick={() => setView("unmatched")} label="Unmatched" count={data?.counts.unmatched ?? 0} />
            <ViewButton active={view === "internal"} onClick={() => setView("internal")} label="Internal" count={data?.counts.internal ?? 0} />
            <ViewButton active={view === "separate"} onClick={() => setView("separate")} label="Separate" count={data?.counts.separate ?? 0} />
            <ViewButton active={view === "ignored"} onClick={() => setView("ignored")} label="Ignored" count={data?.counts.ignored ?? 0} />
          </div>
          <label className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-600" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search calls or tickets"
              className="h-8 w-full rounded-md border bg-black/20 pl-8 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-red-800"
              style={{ borderColor: HAIRLINE }}
            />
          </label>
        </div>

        {!data?.sourceAvailable && (
          <div className="border-b bg-amber-950/20 px-4 py-2.5 text-xs text-amber-300" style={{ borderColor: HAIRLINE }}>
            3CX is temporarily unavailable. Stored transcripts and match audits are still shown.
          </div>
        )}
        {error && <div className="border-b bg-red-950/30 px-4 py-3 text-sm text-red-300" style={{ borderColor: HAIRLINE }}>{error}</div>}
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-zinc-500">Loading recent 3CX calls...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">No calls match this view.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: HAIRLINE }}>
            {visible.map((item) => (
              <CallRow
                key={item.recordingId}
                item={item}
                haloBaseUrl={data?.haloBaseUrl ?? ""}
                viewer={data?.viewer ?? { name: null, role: "viewer" }}
                onMatched={() => load(true)}
              />
            ))}
          </div>
        )}

        <div className="flex min-h-11 items-center justify-between border-t px-4" style={{ borderColor: HAIRLINE }}>
          <span className="text-xs text-zinc-500">Showing {visible.length} of {filtered.length} calls</span>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={safePage === 0} aria-label="Previous calls page" className="flex h-7 w-7 items-center justify-center rounded border text-zinc-400 disabled:opacity-30" style={{ borderColor: HAIRLINE }}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-12 text-center text-xs tabular-nums text-zinc-500">{safePage + 1} / {pageCount}</span>
              <button onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={safePage >= pageCount - 1} aria-label="Next calls page" className="flex h-7 w-7 items-center justify-center rounded border text-zinc-400 disabled:opacity-30" style={{ borderColor: HAIRLINE }}>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, icon, color }: { readonly label: string; readonly value: number; readonly icon: React.ReactNode; readonly color: string }) {
  return (
    <div className="flex min-h-[62px] items-center gap-3 px-4 py-2.5" style={{ background: PANEL }}>
      <span style={{ color }}>{icon}</span>
      <div>
        <p className="text-xl font-semibold leading-none tabular-nums text-white">{value}</p>
        <p className="text-[10px] font-semibold uppercase text-zinc-500">{label}</p>
      </div>
    </div>
  );
}

function ViewButton({ active, onClick, label, count }: { readonly active: boolean; readonly onClick: () => void; readonly label: string; readonly count: number }) {
  return (
    <button onClick={onClick} className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-1 text-[10px] font-medium transition sm:flex-none sm:px-2 sm:text-[11px] ${active ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
      {label}<span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

function CallRow({ item, haloBaseUrl, viewer, onMatched }: { readonly item: CallItem; readonly haloBaseUrl: string; readonly viewer: CallPayload["viewer"]; readonly onMatched: () => Promise<void> }) {
  const href = item.ticket ? ticketUrl(haloBaseUrl, item.ticket.haloId) : null;
  const elapsed = duration(item.startedAt, item.endedAt);
  const DirectionIcon = item.direction === "inbound" ? PhoneIncoming : item.direction === "outbound" ? PhoneOutgoing : PhoneCall;
  const internal = item.matchState === "internal";
  const separate = item.matchState === "separate";
  const ignored = item.matchState === "ignored";
  const pendingReview = isPendingReview(item);
  const ownedByViewer = pendingReview && peopleNamesOverlap(item.reviewOwner, viewer.name);
  const canResolve = ownedByViewer || viewer.role === "admin" || viewer.role === "manager";
  const stateColor = item.matchState === "matched" ? "#4ade80" : item.matchState === "attention" ? "#fb7185" : internal ? "#60a5fa" : separate ? "#a1a1aa" : ignored ? "#71717a" : "#fbbf24";
  const stateLabel = item.matchState === "matched" ? "Matched" : item.matchState === "attention" ? "Match needs attention" : internal ? "Internal" : separate ? "Separate" : ignored ? "Ignored" : ownedByViewer ? "Your review" : pendingReview ? "Tech review" : "Unmatched";
  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-2.5 px-3 py-2.5 transition hover:bg-white/[0.02] sm:grid-cols-[140px_minmax(190px,0.9fr)_minmax(280px,1.5fr)_auto] sm:items-center">
        <div>
          <p className="text-sm font-medium text-zinc-200">{callTime(item.startedAt)}</p>
          <p className="mt-0.5 text-[11px] text-zinc-600">Recording {item.recordingId}{elapsed ? ` · ${elapsed}` : ""}</p>
        </div>
        <div className="hidden min-w-0 sm:block">
          <p className="flex items-center gap-1.5 truncate text-sm text-zinc-300">
            <DirectionIcon className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span className="truncate">{partyName(item.from)} → {partyName(item.to)}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{phone(item.from.number)} → {phone(item.to.number)} · {internal ? "internal" : item.direction}</p>
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          {internal ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-sky-300">Internal call</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">{partyName(item.from)} called {partyName(item.to)}</p>
            </div>
          ) : ignored ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-400">Ignored call</p>
              <p className="mt-0.5 truncate text-xs text-zinc-600">{item.matchLabel}</p>
            </div>
          ) : item.ticket ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-200">#{item.ticket.haloId} · {item.ticket.clientName ?? "Unknown client"}</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {[item.ticket.customerName, item.ticket.summary ?? item.callSummary ?? "Ticket subject unavailable"].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-300">{ownedByViewer ? "Needs your ticket match" : pendingReview ? `Waiting for ${item.reviewOwner}` : "No ticket matched"}</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {item.identifiedCustomerName
                  ? [item.identifiedCustomerName, item.identifiedClientName].filter(Boolean).join(" · ")
                  : item.cnamName
                    ? `${item.cnamName} · Twilio CNAM${item.cnamType ? ` ${item.cnamType.toLowerCase()}` : ""} hint`
                  : item.matchLabel}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 self-start sm:self-center">
          <span className="hidden rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase sm:inline" style={{ borderColor: `${stateColor}55`, color: stateColor, background: `${stateColor}10` }}>{stateLabel}</span>
          <ChevronDown className="h-4 w-4 text-zinc-600 transition group-open:rotate-180" />
        </div>
      </summary>
      <div className="border-t bg-black/15 px-4 py-3" style={{ borderColor: HAIRLINE }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-zinc-300">{item.matchLabel}</p>
            {item.matchEvidence && <p className="mt-1 text-xs text-zinc-400">Identity evidence: {item.matchEvidence}</p>}
            <p className="mt-1 text-xs text-zinc-600">
              {internal ? "Internal staff call; no ticket match expected" : ignored ? "Non-actionable call; no ticket review needed" : item.notePosted ? "Call Summary posted to Halo" : item.ticket ? "Ticket matched, but no Call Summary note was posted" : "No Halo ticket was changed"}
              {item.analysisAttempts > 0 ? ` · ${item.analysisAttempts} retry attempt${item.analysisAttempts === 1 ? "" : "s"}` : ""}
            </p>
            {pendingReview && (
              <div className="mt-1 text-xs font-medium text-amber-300">
                <p>Assigned in TriageIT to {item.reviewOwner}, the technician on the call. Match it to the correct ticket below.</p>
                <p className="mt-0.5 text-[11px] font-normal text-zinc-500">
                  {item.reviewSentAt ? `Private Teams review delivered ${callTime(item.reviewSentAt)}.` : "Private Teams delivery is pending; this review remains visible here until resolved."}
                </p>
              </div>
            )}
          </div>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold text-zinc-300 hover:text-white" style={{ borderColor: HAIRLINE }}>
              Open ticket <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        {!internal && !item.ticket && canResolve && (
          <ManualMatchForm recordingId={item.recordingId} onMatched={onMatched} />
        )}
        {item.callSummary && (
          <div className="mt-4 border-l-2 pl-3" style={{ borderColor: stateColor }}>
            <p className="text-[10px] font-bold uppercase text-zinc-600">AI call summary</p>
            <p className="mt-1 text-sm leading-6 text-zinc-300">{item.callSummary}</p>
          </div>
        )}
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-zinc-600"><FileText className="h-3.5 w-3.5" /> 3CX transcription</p>
          <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border bg-black/20 px-3 py-2.5 text-sm leading-6 text-zinc-300" style={{ borderColor: HAIRLINE }}>
            {item.transcript || "Transcription is not available yet."}
          </div>
        </div>
      </div>
    </details>
  );
}

function ManualMatchForm({ recordingId, onMatched }: { readonly recordingId: number; readonly onMatched: () => Promise<void> }) {
  const [ticketNumber, setTicketNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const haloId = Number(ticketNumber);
    if (!Number.isInteger(haloId) || haloId <= 0) {
      setError("Enter a valid ticket number");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchWithTimeout(`/api/calls/${recordingId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ halo_id: haloId }),
      }, undefined, "Call match");
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not match the call");
      await onMatched();
    } catch (matchError) {
      setError(matchError instanceof Error ? matchError.message : "Could not match the call");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4" style={{ borderColor: HAIRLINE }}>
      <label className="min-w-44">
        <span className="mb-1.5 block text-[10px] font-bold uppercase text-zinc-600">Halo ticket</span>
        <input
          value={ticketNumber}
          onChange={(event) => setTicketNumber(event.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="Ticket #"
          aria-label="Halo ticket number"
          className="h-9 w-full rounded-md border bg-black/20 px-3 text-sm tabular-nums text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-red-800"
          style={{ borderColor: HAIRLINE }}
        />
      </label>
      <button
        type="submit"
        disabled={submitting || !ticketNumber}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold text-zinc-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        style={{ borderColor: HAIRLINE, background: "#201418" }}
      >
        <Link2 className="h-3.5 w-3.5" />
        {submitting ? "Matching..." : "Match & post"}
      </button>
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </form>
  );
}
