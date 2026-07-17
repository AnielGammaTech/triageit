"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Activity,
  TriangleAlert,
  Timer,
  MessageSquareWarning,
  UserX,
  Wrench,
  ArrowDownUp,
  Trophy,
  BarChart3,
  ShieldCheck,
  Users,
  WifiOff,
} from "lucide-react";
import type { CommandCenterPayload } from "@/lib/api/command-center-data";

/**
 * /tv — TriageIT Command wallboard for the office 65" TV.
 * Key-gated (?key= → localStorage), self-refreshing (data 30s, clock 1s,
 * full page reload every 6h to pick up deploys), 10-foot typography.
 */

const KEY_STORAGE = "triageit_tv_key";
const REFRESH_MS = 30_000;
const STALE_AFTER_MS = 120_000;
const RELOAD_AFTER_MS = 6 * 3600_000;

const RED = "#ef4444";
const AMBER = "#f59e0b";
const PANEL = "#0d0608";
const PANEL_2 = "#120a0d";
const HAIRLINE = "#331318";
const INK_DIM = "#8a8a93";
const INK_FAINT = "#55555e";

// Halo-ish status hues, brightened where the originals sank into the OLED
// surface (validated: contrast ≥3:1 + CVD-separable on #0d0608)
const STATUS_COLOR: Record<string, string> = {
  "past-due": "#e04b3a",
  "customer reply": "#d33bc4",
  "waiting on tech": "#fe9200",
  "waiting on customer": "#8b5cf6",
  "in progress": "#38a3e8",
  scheduled: "#34a066",
  new: "#a1c652",
  "waiting on parts": "#c026d3",
  "needs quote": "#d946ef",
};
const statusColor = (s: string): string => STATUS_COLOR[s.toLowerCase()] ?? "#8b98ad";

// ── Team presence band (best-effort `dispatch` field on the TV payload) ──
interface TvPresenceTech {
  readonly tech: string;
  readonly status: { readonly state: string; readonly detail: string | null };
  readonly nextCommitment: string | null;
}
type TvPayload = CommandCenterPayload & {
  readonly dispatch?: { readonly techs: ReadonlyArray<TvPresenceTech> };
};

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
const presenceColor = (state: string): string => PRESENCE_COLOR[state] ?? "#f87171";
const presenceLabel = (state: string): string =>
  PRESENCE_LABEL[state] ?? state.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

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
  if (!when || /^until\b/i.test(when)) return null; // happening now — the status word covers it
  const colon = nextCommitment.indexOf(":");
  const kind = colon > 0 ? nextCommitment.slice(0, colon).trim() : "";
  const hint = `→ ${when}${kind ? ` ${kind}` : ""}`;
  return hint.length > 28 ? `${hint.slice(0, 27)}…` : hint;
}

/** Slim full-width TV band: one tech = dot + first name + state (+ until / next commitment). */
function TeamBand({ techs }: { readonly techs: ReadonlyArray<TvPresenceTech> }) {
  return (
    <div
      className="flex shrink-0 items-center gap-[1vw] rounded-[0.8vw] border px-[1vw] py-[0.7vh]"
      style={{ borderColor: HAIRLINE, background: PANEL }}
    >
      <span className="flex shrink-0 items-center gap-[0.5vw]">
        <Users className="h-[1vw] w-[1vw]" style={{ color: "#fe9200" }} />
        <span className="text-[0.72vw] font-semibold uppercase tracking-[0.12em]" style={{ color: INK_FAINT }}>
          Team
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[1.6vw] gap-y-[0.4vh]">
        {techs.map((t) => {
          const color = presenceColor(t.status.state);
          const until = t.status.state === "onsite" || t.status.state === "meeting" ? untilTime(t.status.detail) : null;
          const hint = commitmentHint(t.nextCommitment);
          return (
            <span key={t.tech} className="flex items-center gap-[0.45vw]">
              <span className="h-[0.6vw] w-[0.6vw] shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 0.6vw ${color}66` }} />
              <span className="text-[1vw] font-black text-white">{t.tech.split(" ")[0]}</span>
              <span className="text-[0.9vw] font-bold" style={{ color }}>
                {presenceLabel(t.status.state)}
              </span>
              {until && (
                <span className="text-[0.85vw] font-semibold" style={{ color: INK_DIM }}>
                  til {until}
                </span>
              )}
              {hint && (
                <span className="max-w-[12vw] truncate text-[0.85vw] font-semibold" style={{ color: INK_DIM }}>
                  {hint}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const mins = (m: number): string => {
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
};

function BrandMark({ size }: { readonly size: string }) {
  // Real TriageIT logo (app icon.svg — served by Next at /icon.svg)
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icon.svg" alt="TriageIT" style={{ width: size, height: size, filter: "drop-shadow(0 0 1.2vw rgba(239,68,68,0.5))" }} />;
}

const CAROUSEL_SLIDES = [
  { title: "Tech Load", icon: <Wrench className="h-[1vw] w-[1vw]" style={{ color: "#fb923c" }} /> },
  { title: "Tech Scoreboard — 30 days", icon: <Trophy className="h-[1vw] w-[1vw]" style={{ color: "#facc15" }} /> },
  { title: "Tickets by Status", icon: <BarChart3 className="h-[1vw] w-[1vw]" style={{ color: "#0f75b1" }} /> },
] as const;

interface TvPairingRequest {
  readonly requestId: string;
  readonly secret: string;
  readonly approvalUrl: string;
  readonly expiresAt: string;
  readonly detectedIp: string | null;
}

export default function TvPage() {
  const [tvKey, setTvKey] = useState<string | null>(null);
  const [keyResolved, setKeyResolved] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [data, setData] = useState<TvPayload | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [pairing, setPairing] = useState<TvPairingRequest | null>(null);
  const [pairingQr, setPairingQr] = useState("");
  const [lastOkAt, setLastOkAt] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const keyRef = useRef<string | null>(null);
  const pairingRequestInFlight = useRef(false);

  // Resolve the key: URL param wins (and is persisted), else localStorage.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("key");
    if (fromUrl) {
      try {
        localStorage.setItem(KEY_STORAGE, fromUrl);
      } catch {
        /* private mode — key still usable from state */
      }
      setTvKey(fromUrl);
      setKeyResolved(true);
      return;
    }
    try {
      setTvKey(localStorage.getItem(KEY_STORAGE));
    } catch {
      setTvKey(null);
    }
    setKeyResolved(true);
  }, []);

  useEffect(() => {
    keyRef.current = tvKey;
  }, [tvKey]);

  const checkAutomaticSession = useCallback(async () => {
    try {
      const response = await fetch("/api/tv/session", { method: "GET", cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  const startPairing = useCallback(async () => {
    if (pairingRequestInFlight.current) return;
    pairingRequestInFlight.current = true;
    try {
      const response = await fetch("/api/tv/pairing", { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Could not create pairing request");
      setPairing((await response.json()) as TvPairingRequest);
      setAccessError("");
    } catch {
      setAccessError("QR approval is temporarily unavailable. Use the emergency access key below.");
    } finally {
      pairingRequestInFlight.current = false;
    }
  }, []);

  const load = useCallback(async () => {
    const key = keyRef.current;
    if (!key && !sessionReady) return;
    try {
      const res = await fetch("/api/tv/command", {
        cache: "no-store",
        headers: key ? { "x-tv-key": key } : undefined,
      });
      if (res.status === 401 || res.status === 503) {
        const restored = await checkAutomaticSession();
        if (restored) {
          setSessionReady(true);
          setAuthFailed(false);
        } else {
          try { localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
          setTvKey(null);
          setSessionReady(false);
          setAuthFailed(true);
        }
        return;
      }
      if (!res.ok) return; // keep last good data; staleness indicator handles it
      setData((await res.json()) as TvPayload);
      setAuthFailed(false);
      setLastOkAt(Date.now());
    } catch {
      /* network blip — keep last good data */
    }
  }, [checkAutomaticSession, sessionReady]);

  useEffect(() => {
    if (!keyResolved || tvKey || sessionReady || pairing) return;
    let active = true;
    const authorize = async () => {
      const automatic = await checkAutomaticSession();
      if (!active) return;
      if (automatic) {
        setSessionReady(true);
        setAuthFailed(false);
        return;
      }
      setAuthFailed(true);
      await startPairing();
    };
    void authorize();
    return () => { active = false; };
  }, [checkAutomaticSession, keyResolved, pairing, sessionReady, startPairing, tvKey]);

  useEffect(() => {
    if (!pairing) {
      setPairingQr("");
      return;
    }
    let active = true;
    void QRCode.toDataURL(pairing.approvalUrl, {
      width: 520,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#080405", light: "#ffffff" },
    }).then((url) => {
      if (active) setPairingQr(url);
    }).catch(() => {
      if (active) setAccessError("Could not draw the QR code. Use the emergency access key below.");
    });
    return () => { active = false; };
  }, [pairing]);

  useEffect(() => {
    if (!pairing || sessionReady) return;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch("/api/tv/pairing", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: pairing.requestId, secret: pairing.secret }),
        });
        if (response.ok) {
          setSessionReady(true);
          setAuthFailed(false);
          setAccessError("");
          setPairing(null);
        } else if (response.status === 410) {
          setPairing(null);
        }
      } catch {
        // Keep the QR visible and retry.
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(timer);
  }, [pairing, sessionReady]);

  // Data refresh + clock + daily self-reload
  useEffect(() => {
    if (!tvKey && !sessionReady) return;
    void load();
    const dataT = setInterval(() => void load(), REFRESH_MS);
    const clockT = setInterval(() => setNowTick(Date.now()), 1000);
    const reloadT = setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return () => {
      clearInterval(dataT);
      clearInterval(clockT);
      clearTimeout(reloadT);
    };
  }, [tvKey, sessionReady, load]);

  if (!keyResolved || (!tvKey && !sessionReady) || (authFailed && !data)) {
    return (
      <Shell>
        <div className="flex h-full flex-col items-center justify-center gap-[1.4vh] px-[4vw]">
          <BrandMark size="4.4vw" />
          <h1 className="text-[2.6vw] font-black tracking-tight text-white">
            TRIAGE<span style={{ color: RED }}>IT</span> <span style={{ color: "#a1a1aa" }}>COMMAND</span>
          </h1>
          <p className="text-[1.05vw]" style={{ color: INK_DIM }}>
            {!keyResolved ? "Checking this TV..." : "Scan to approve this TV from an authenticated TriageIT admin account."}
          </p>

          {pairingQr && pairing ? (
            <div className="mt-[0.5vh] flex items-center gap-[2vw] rounded-[1vw] border p-[1vw]" style={{ borderColor: HAIRLINE, background: PANEL }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pairingQr} alt="QR code to approve this TV" className="h-[13vw] w-[13vw] rounded-[0.5vw] bg-white p-[0.35vw]" />
              <div className="max-w-[25vw]">
                <p className="text-[1.35vw] font-black text-white">Approve this wallboard</p>
                <ol className="mt-[1vh] space-y-[0.65vh] text-[0.95vw] leading-relaxed" style={{ color: INK_DIM }}>
                  <li><span className="font-bold text-white">1.</span> Scan with your phone</li>
                  <li><span className="font-bold text-white">2.</span> Sign in to TriageIT if asked</li>
                  <li><span className="font-bold text-white">3.</span> Tap <span className="font-bold text-white">Approve this TV</span></li>
                </ol>
                <p className="mt-[1.2vh] text-[0.78vw]" style={{ color: INK_FAINT }}>
                  Keep “Trust this office network” checked and future visits activate automatically.
                </p>
                {pairing.detectedIp && (
                  <p className="mt-[0.5vh] font-mono text-[0.68vw]" style={{ color: INK_FAINT }}>Detected IP {pairing.detectedIp}</p>
                )}
              </div>
            </div>
          ) : keyResolved ? (
            <div className="flex h-[13vw] w-[13vw] items-center justify-center rounded-[0.7vw] border" style={{ borderColor: HAIRLINE, background: PANEL }}>
              <div className="h-[2.2vw] w-[2.2vw] animate-spin rounded-full border-[0.25vw] border-white/10 border-t-red-500" />
            </div>
          ) : null}

          {accessError && <p className="text-[0.85vw] font-semibold" style={{ color: AMBER }}>{accessError}</p>}

          <div className="flex items-center gap-[0.8vw]">
            <span className="h-px w-[6vw]" style={{ background: HAIRLINE }} />
            <span className="text-[0.72vw] font-semibold uppercase tracking-[0.14em]" style={{ color: INK_FAINT }}>emergency access key</span>
            <span className="h-px w-[6vw]" style={{ background: HAIRLINE }} />
          </div>
          <form
            className="flex items-center gap-[0.8vw]"
            onSubmit={(e) => {
              e.preventDefault();
              const k = keyInput.trim();
              if (!k) return;
              try {
                localStorage.setItem(KEY_STORAGE, k);
              } catch {
                /* ignore */
              }
              setAuthFailed(false);
              setPairing(null);
              setTvKey(k);
            }}
          >
            <input
              type="password"
              autoFocus
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Access key"
              className="w-[24vw] rounded-[0.6vw] border px-[1vw] py-[0.7vw] text-[1.2vw] text-white outline-none"
              style={{ background: PANEL, borderColor: HAIRLINE, fontFamily: "var(--font-mono-tv), monospace" }}
            />
            <button
              type="submit"
              className="cursor-pointer rounded-[0.6vw] px-[1.4vw] py-[0.7vw] text-[1.2vw] font-bold text-white transition-opacity hover:opacity-85"
              style={{ background: RED }}
            >
              Unlock
            </button>
          </form>
          <p className="text-[0.8vw]" style={{ color: INK_FAINT }}>
            MAC addresses are not exposed to websites. This TV is remembered by a secure device cookie and its trusted public network.
          </p>
        </div>
      </Shell>
    );
  }

  const m = data?.metrics;
  const stale = lastOkAt > 0 && nowTick - lastOkAt > STALE_AFTER_MS;
  const clock = new Date(nowTick);
  const timeStr = clock.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  const dateStr = clock.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  const syncAgeSec = lastOkAt > 0 ? Math.floor((nowTick - lastOkAt) / 1000) : null;
  const breachAlarm = (m?.breaching ?? 0) > 0;
  // Carousel advances every 10s, derived from the 1s clock tick — no extra timer
  const slide = Math.floor(nowTick / 10_000) % CAROUSEL_SLIDES.length;
  // Keep room for both owner-action queues at all times. Breaches and
  // unassigned remain first, while WOT and Customer Reply split the rest 50/50.
  const breachCap = Math.min(data?.breaches.length ?? 0, 3);
  const unassignedCap = Math.min(data?.unassignedTickets.length ?? 0, 3);
  const ownerQueueCap = Math.max(2, Math.floor((10 - breachCap - unassignedCap) / 2));

  return (
    <Shell>
      <div className="flex h-full flex-col gap-[1.2vh] p-[1.2vw]">
        {/* ── Header ── */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-[1vw]">
            <BrandMark size="3.4vw" />
            <div>
              <h1 className="text-[1.7vw] font-black leading-none tracking-tight text-white">
                TRIAGE<span style={{ color: RED }}>IT</span> <span style={{ color: "#a1a1aa" }}>COMMAND</span>
              </h1>
              <div className="mt-[0.4vh] flex items-center gap-[0.6vw] text-[0.85vw]" style={{ color: INK_DIM }}>
                {stale ? (
                  <>
                    <WifiOff className="h-[0.9vw] w-[0.9vw]" style={{ color: AMBER }} />
                    <span style={{ color: AMBER }}>RECONNECTING — data {syncAgeSec !== null ? mins(Math.floor(syncAgeSec / 60)) || `${syncAgeSec}s` : "?"} old</span>
                  </>
                ) : (
                  <>
                    <span className="relative flex h-[0.55vw] w-[0.55vw]">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "#22c55e" }} />
                      <span className="relative inline-flex h-full w-full rounded-full" style={{ background: "#22c55e" }} />
                    </span>
                    <span>LIVE{syncAgeSec !== null ? ` · synced ${syncAgeSec}s ago` : ""}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[2.4vw] font-bold leading-none text-white" style={{ fontFamily: "var(--font-mono-tv), monospace" }}>
              {timeStr}
            </div>
            <div className="mt-[0.4vh] text-[0.9vw]" style={{ color: INK_DIM }}>
              {dateStr} · Eastern
            </div>
          </div>
        </header>

        {/* ── KPI band ── */}
        <div className="grid grid-cols-7 gap-[0.8vw]">
          <Kpi label="Open Tickets" value={m?.open} icon={Activity} accent="#e4e4e7" />
          <Kpi label="Breaching Now" value={m?.breaching} icon={TriangleAlert} accent={RED} alarm={breachAlarm} />
          <Kpi label="At Risk < 2h" value={m?.atRisk} icon={Timer} accent={AMBER} alarm={(m?.atRisk ?? 0) > 0} />
          <Kpi label="Customer Reply" value={m?.customerReply} icon={MessageSquareWarning} accent={AMBER} alarm={(m?.customerReply ?? 0) > 0} />
          <Kpi label="Waiting on Tech" value={m?.waitingOnTech} icon={Wrench} accent="#fb923c" />
          <Kpi label="Unassigned" value={m?.unassigned} icon={UserX} accent="#f87171" />
          <div className="rounded-[0.8vw] border p-[0.9vw]" style={{ borderColor: HAIRLINE, background: PANEL }}>
            <div className="flex items-center justify-between">
              <span className="text-[0.72vw] font-semibold uppercase tracking-[0.12em]" style={{ color: INK_FAINT }}>
                Today
              </span>
              <ArrowDownUp className="h-[1vw] w-[1vw]" style={{ color: INK_DIM }} />
            </div>
            <div className="mt-[1vh] flex items-baseline gap-[0.9vw]">
              <div>
                <span className="text-[2.2vw] font-black leading-none text-white">{m?.openedToday ?? "—"}</span>
                <span className="ml-[0.3vw] text-[0.75vw]" style={{ color: INK_DIM }}>in</span>
              </div>
              <div>
                <span className="text-[2.2vw] font-black leading-none" style={{ color: "#4ade80" }}>{m?.resolvedToday ?? "—"}</span>
                <span className="ml-[0.3vw] text-[0.75vw]" style={{ color: INK_DIM }}>resolved</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Team presence band — who's onsite / on a call / free right now ── */}
        {(data?.dispatch?.techs.length ?? 0) > 0 && <TeamBand techs={data!.dispatch!.techs} />}

        {/* ── Main grid: unified action queue + rotating carousel ── */}
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-[0.8vw]">
          {/* Needs Action — everything demanding a human, priority order */}
          <Panel
            title="Needs Action"
            icon={<TriangleAlert className="h-[1vw] w-[1vw]" style={{ color: RED }} />}
            alarm={breachAlarm || (data?.unassignedTickets.length ?? 0) > 0}
            className="col-span-7"
          >
            {!data ? (
              <Loading />
            ) : data.breaches.length === 0
              && data.unassignedTickets.length === 0
              && data.oldestTickets.length === 0
              && data.customerReplyTickets.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-[1.2vh]">
                <ShieldCheck className="h-[4vw] w-[4vw]" style={{ color: "#22c55e" }} />
                <span className="text-[1.8vw] font-black tracking-[0.2em] text-white">ALL CLEAR</span>
                <span className="text-[0.9vw]" style={{ color: INK_DIM }}>No breaches, nothing unassigned, nothing due soon</span>
              </div>
            ) : (
              <div className="flex h-full flex-col overflow-hidden">
                {data.breaches.length > 0 && (
                  <>
                    <QueueHeader label="SLA BREACHES" count={data.breaches.length} color={RED} />
                    <RowList
                      items={data.breaches.slice(0, breachCap).map((b) => ({
                        id: b.halo_id,
                        left: `${b.client_name ?? "Unknown"} — ${b.summary ?? ""}`,
                        who: b.halo_agent ?? "UNASSIGNED",
                        badge: b.breachingForMin !== null ? `BREACHED ${mins(b.breachingForMin)}` : `${b.alertCount}× ALERTED`,
                        badgeColor: RED,
                        highlight: "rgba(239,68,68,0.16)",
                      }))}
                      more={data.breaches.length - breachCap}
                    />
                  </>
                )}
                {data.unassignedTickets.length > 0 && (
                  <>
                    <QueueHeader label="UNASSIGNED" count={data.unassignedTickets.length} color="#e4e4e7" />
                    <RowList
                      items={data.unassignedTickets.slice(0, unassignedCap).map((t) => ({
                        id: t.halo_id,
                        left: t.client_name ?? "Unknown",
                        who: "",
                        badge: `WAITING ${mins(t.ageMin)}`,
                        badgeColor: "#e4e4e7",
                        badgeFg: "#000",
                        highlight: "rgba(228,228,231,0.08)",
                      }))}
                      more={data.unassignedTickets.length - unassignedCap}
                    />
                  </>
                )}
                <div className="grid min-h-0 flex-1 grid-rows-2">
                  <div className="min-h-0 overflow-hidden border-t" style={{ borderColor: HAIRLINE }}>
                    <QueueHeader label="WAITING ON TECH — OLDEST FIRST" count={m?.waitingOnTech ?? data.oldestTickets.length} color="#fe9200" />
                    {data.oldestTickets.length === 0 ? (
                      <QueueEmpty label="No tickets are waiting on a technician." />
                    ) : (
                      <RowList
                        items={data.oldestTickets.slice(0, ownerQueueCap).map((t) => ({
                          id: t.halo_id,
                          left: `${t.client_name ?? "Unknown"} — ${t.summary ?? ""}`,
                          who: t.halo_agent ?? "UNASSIGNED",
                          badge: `WAITING ${mins(t.ageMin)}`,
                          badgeColor: "#fe9200",
                        }))}
                        more={Math.max(0, (m?.waitingOnTech ?? 0) - Math.min(data.oldestTickets.length, ownerQueueCap))}
                      />
                    )}
                  </div>
                  <div className="min-h-0 overflow-hidden border-t" style={{ borderColor: HAIRLINE }}>
                    <QueueHeader label="CUSTOMER REPLIES — OLDEST FIRST" count={m?.customerReply ?? data.customerReplyTickets.length} color="#e879f9" />
                    {data.customerReplyTickets.length === 0 ? (
                      <QueueEmpty label="No customer replies are waiting for a technician." />
                    ) : (
                      <RowList
                        items={data.customerReplyTickets.slice(0, ownerQueueCap).map((t) => ({
                          id: t.halo_id,
                          left: `${t.client_name ?? "Unknown"} — ${t.summary ?? ""}`,
                          who: t.halo_agent ?? "UNASSIGNED",
                          badge: `REPLIED ${mins(t.ageMin)} AGO`,
                          badgeColor: "#e879f9",
                        }))}
                        more={Math.max(0, (m?.customerReply ?? 0) - Math.min(data.customerReplyTickets.length, ownerQueueCap))}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </Panel>

          {/* Carousel (top) + Oldest Open (bottom) */}
          <div className="col-span-5 flex min-h-0 flex-col gap-[0.8vw]">
          <Panel
            title={CAROUSEL_SLIDES[slide].title}
            icon={CAROUSEL_SLIDES[slide].icon}
            className="flex-[3]"
            trailing={
              <span className="ml-auto flex items-center gap-[0.4vw]">
                {CAROUSEL_SLIDES.map((s, i) => (
                  <span key={s.title} className="h-[0.45vw] w-[0.45vw] rounded-full" style={{ background: i === slide ? "#e4e4e7" : "#3f3f46" }} />
                ))}
              </span>
            }
          >
            {!data ? (
              <Loading />
            ) : (
              <div key={slide} className="h-full" style={{ animation: "tvFadeIn 1100ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
                {slide === 0 && (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[0.7vw] uppercase tracking-[0.1em]" style={{ color: INK_FAINT }}>
                        <th className="px-[1.1vw] py-[0.6vh] font-semibold">Tech</th>
                        <th className="py-[0.6vh] text-center font-semibold">Open</th>
                        <th className="py-[0.6vh] text-center font-semibold">SLA Breach</th>
                        <th className="py-[0.6vh] text-center font-semibold">WOT</th>
                        <th className="px-[1.1vw] py-[0.6vh] text-center font-semibold">Customer Reply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.techStats.slice(0, 12).map((t) => (
                        <tr key={t.tech} className="border-t" style={{ borderColor: HAIRLINE }}>
                          <td className="truncate px-[1.1vw] py-[0.55vh] text-[0.92vw] font-bold text-white">{t.tech}</td>
                          <Num v={t.openTickets} />
                          <Num v={t.breaching} hot={RED} />
                          <Num v={t.waitingOnTech} hot="#fb923c" />
                          <td className="px-[1.1vw] py-[0.55vh] text-center text-[0.92vw] font-black" style={{ fontFamily: "var(--font-mono-tv), monospace", color: t.unackedReplies > 0 ? AMBER : INK_FAINT }}>
                            {t.unackedReplies}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {slide === 1 && (
                  <div className="flex h-full flex-col">
                    {data.scoreboard.slice(0, 7).map((t, i, arr) => {
                      const worst = i === arr.length - 1 && t.score < 0;
                      const chips: Array<{ label: string; color: string }> = [];
                      if (t.good > 0) chips.push({ label: `${t.good} good`, color: "#4ade80" });
                      if (t.poor > 0) chips.push({ label: `${t.poor} poor`, color: "#f87171" });
                      if (t.breaching > 0) chips.push({ label: `${t.breaching} breaching`, color: RED });
                      if (t.unacked > 0) chips.push({ label: `${t.unacked} unacked`, color: AMBER });
                      return (
                        <div key={t.tech} className="flex flex-1 items-center gap-[0.8vw] border-b px-[1.1vw] last:border-b-0" style={{ borderColor: "#1f0d11" }}>
                          <span
                            className="flex h-[1.9vw] w-[1.9vw] shrink-0 items-center justify-center rounded-full text-[0.95vw] font-black"
                            style={{
                              background: i === 0 ? "#facc15" : worst ? RED : "transparent",
                              border: i === 0 || worst ? "none" : `1px solid ${HAIRLINE}`,
                              color: i === 0 ? "#000" : worst ? "#fff" : INK_DIM,
                            }}
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[1.15vw] font-black text-white">{t.tech}</span>
                          <span className="flex shrink-0 items-center gap-[0.5vw]">
                            {chips.map((c) => (
                              <span key={c.label} className="rounded-full border px-[0.55vw] py-[0.2vh] text-[0.75vw] font-bold" style={{ borderColor: c.color, color: c.color }}>
                                {c.label}
                              </span>
                            ))}
                          </span>
                          <span
                            className="w-[3vw] shrink-0 text-right text-[1.3vw] font-black"
                            style={{ fontFamily: "var(--font-mono-tv), monospace", color: t.score > 0 ? "#4ade80" : t.score < 0 ? RED : INK_DIM }}
                          >
                            {t.score > 0 ? `+${t.score}` : t.score}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {slide === 2 && <StatusDonut statusCounts={data.statusCounts} total={data.metrics.open} />}
              </div>
            )}
          </Panel>
          <Panel title="At Risk — SLA Due Soon" icon={<Timer className="h-[1vw] w-[1vw]" style={{ color: AMBER }} />} className="flex-[2]">
            {!data ? (
              <Loading />
            ) : data.atRisk.length === 0 ? (
              <div className="px-[1vw] py-[1.5vh] text-[0.9vw]" style={{ color: INK_DIM }}>
                Nothing due in the next 2 hours.
              </div>
            ) : (
              <RowList
                items={data.atRisk.slice(0, 4).map((t) => ({
                  id: t.halo_id,
                  left: `${t.client_name ?? "Unknown"} — ${t.summary ?? ""}`,
                  who: t.halo_agent ?? "UNASSIGNED",
                  badge: `DUE IN ${mins(t.dueInMin)}`,
                  badgeColor: AMBER,
                }))}
                more={data.atRisk.length - 4}
              />
            )}
          </Panel>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="h-screen w-screen overflow-hidden" style={{ background: "#000", cursor: "none" }}>
      <style>{`@keyframes tvFadeIn { from { opacity: 0; transform: translateY(0.8vh); } to { opacity: 1; transform: none; } }`}</style>
      {children}
    </main>
  );
}

function StatusDonut({
  statusCounts,
  total,
}: {
  readonly statusCounts: ReadonlyArray<{ readonly status: string; readonly count: number; readonly breaching: number }>;
  readonly total: number;
}) {
  // Top 6 statuses get a slice; the tail folds into a neutral "Other" —
  // 9 slivers on a TV donut would be unreadable.
  const top = statusCounts.slice(0, 6);
  const restCount = statusCounts.slice(6).reduce((s, x) => s + x.count, 0);
  const restBreaching = statusCounts.slice(6).reduce((s, x) => s + x.breaching, 0);
  const segments = [
    ...top.map((s) => ({ label: s.status, count: s.count, breaching: s.breaching, color: statusColor(s.status) })),
    ...(restCount > 0 ? [{ label: "Other", count: restCount, breaching: restBreaching, color: "#8b98ad" }] : []),
  ];
  const sum = Math.max(1, segments.reduce((s, x) => s + x.count, 0));
  const R = 70;
  const C = 2 * Math.PI * R;
  const GAP = 3; // surface gap between slices
  let acc = 0;
  return (
    <div className="flex h-full items-center gap-[1.2vw] px-[1.2vw]">
      <div className="relative h-full shrink-0 py-[1.5vh]" style={{ aspectRatio: "1" }}>
        <svg viewBox="0 0 200 200" className="h-full w-full">
          {segments.map((seg) => {
            const len = (seg.count / sum) * C;
            const dash = Math.max(0.5, len - GAP);
            const offset = -acc;
            acc += len;
            return (
              <circle
                key={seg.label}
                cx="100"
                cy="100"
                r={R}
                fill="none"
                stroke={seg.color}
                strokeWidth="30"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={offset}
                transform="rotate(-90 100 100)"
              />
            );
          })}
          <text x="100" y="94" textAnchor="middle" fill="#fff" style={{ fontSize: "34px", fontWeight: 900, fontFamily: "var(--font-mono-tv), monospace" }}>
            {total}
          </text>
          <text x="100" y="116" textAnchor="middle" fill={INK_DIM} style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.2em" }}>
            OPEN
          </text>
        </svg>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.1vh]">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-[0.6vw]">
            <span className="h-[0.7vw] w-[0.7vw] shrink-0 rounded-full" style={{ background: seg.color }} />
            <span className="min-w-0 flex-1 truncate text-[0.95vw] font-semibold text-zinc-300">{seg.label}</span>
            {seg.breaching > 0 && (
              <span className="rounded-full px-[0.45vw] py-[0.1vh] text-[0.7vw] font-bold text-white" style={{ background: RED }}>
                {seg.breaching}
              </span>
            )}
            <span className="w-[2.4vw] shrink-0 text-right text-[1.1vw] font-black text-white" style={{ fontFamily: "var(--font-mono-tv), monospace" }}>
              {seg.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QueueHeader({ label, count, color }: { readonly label: string; readonly count: number; readonly color: string }) {
  return (
    <div className="flex shrink-0 items-center gap-[0.6vw] px-[1vw] py-[0.7vh]" style={{ background: PANEL_2 }}>
      <span className="h-[0.5vw] w-[0.5vw] rounded-full" style={{ background: color }} />
      <span className="text-[0.75vw] font-bold tracking-[0.15em]" style={{ color }}>
        {label}
      </span>
      <span className="text-[0.75vw] font-black text-white" style={{ fontFamily: "var(--font-mono-tv), monospace" }}>
        {count}
      </span>
    </div>
  );
}

function QueueEmpty({ label }: { readonly label: string }) {
  return (
    <div className="px-[1vw] py-[1vh] text-[0.8vw]" style={{ color: INK_DIM }}>
      {label}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  accent,
  alarm,
}: {
  readonly label: string;
  readonly value: number | undefined;
  readonly icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  readonly accent: string;
  readonly alarm?: boolean;
}) {
  const hot = alarm && (value ?? 0) > 0;
  return (
    <div
      className="rounded-[0.8vw] border p-[0.9vw]"
      style={{
        borderColor: hot ? accent : HAIRLINE,
        background: hot ? `linear-gradient(160deg, ${PANEL_2}, #1a0508)` : PANEL,
        boxShadow: hot ? `0 0 3vw -0.8vw ${accent}` : "none",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.72vw] font-semibold uppercase tracking-[0.12em]" style={{ color: INK_FAINT }}>
          {label}
        </span>
        <Icon className="h-[1vw] w-[1vw]" style={{ color: accent }} />
      </div>
      <p className="mt-[1vh] text-[2.6vw] font-black leading-none" style={{ color: (value ?? 0) > 0 ? accent : "#e4e4e7" }}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function Panel({
  title,
  icon,
  alarm,
  className,
  trailing,
  children,
}: {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly alarm?: boolean;
  readonly className?: string;
  readonly trailing?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-[0.8vw] border ${className ?? ""}`}
      style={{ borderColor: alarm ? "#7f1d1d" : HAIRLINE, background: PANEL, boxShadow: alarm ? `0 0 3vw -1vw ${RED}` : "none" }}
    >
      <div className="flex shrink-0 items-center gap-[0.5vw] border-b px-[1vw] py-[0.9vh]" style={{ borderColor: HAIRLINE, background: PANEL_2 }}>
        {icon}
        <h2 className="text-[0.85vw] font-bold uppercase tracking-[0.15em] text-white">{title}</h2>
        {trailing}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function RowList({
  items,
  more,
}: {
  readonly items: ReadonlyArray<{
    readonly id: number;
    readonly left: string;
    readonly who: string;
    readonly badge: string;
    readonly badgeColor: string;
    readonly badgeFg?: string;
    readonly highlight?: string;
  }>;
  readonly more: number;
}) {
  return (
    <div>
      {items.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-[0.7vw] border-b px-[1vw] py-[1vh] last:border-b-0"
          style={{ borderColor: "#1f0d11", background: r.highlight }}
        >
          <span className="shrink-0 text-[0.95vw] font-bold text-white" style={{ fontFamily: "var(--font-mono-tv), monospace" }}>
            #{r.id}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.9vw] text-zinc-300">{r.left}</span>
          <span className="shrink-0 text-[0.8vw] font-semibold" style={{ color: INK_DIM }}>
            {r.who}
          </span>
          <span
            className="shrink-0 rounded-[0.4vw] px-[0.6vw] py-[0.3vh] text-[0.75vw] font-black tracking-wide"
            style={{ background: r.badgeColor, color: r.badgeFg ?? "#fff", fontFamily: "var(--font-mono-tv), monospace" }}
          >
            {r.badge}
          </span>
        </div>
      ))}
      {more > 0 && (
        <div className="px-[1vw] py-[0.8vh] text-[0.8vw] font-semibold" style={{ color: INK_DIM }}>
          +{more} more
        </div>
      )}
    </div>
  );
}

function Num({ v, hot }: { readonly v: number; readonly hot?: string }) {
  return (
    <td className="py-[0.55vh] text-center text-[0.92vw] font-black" style={{ fontFamily: "var(--font-mono-tv), monospace", color: v > 0 && hot ? hot : v > 0 ? "#e4e4e7" : INK_FAINT }}>
      {v}
    </td>
  );
}

function Loading() {
  return (
    <div className="px-[1vw] py-[1.5vh] text-[0.9vw]" style={{ color: INK_FAINT }}>
      Loading…
    </div>
  );
}
