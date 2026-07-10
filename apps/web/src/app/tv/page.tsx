"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  TriangleAlert,
  Timer,
  MessageSquareWarning,
  UserX,
  Wrench,
  ArrowDownUp,
  Skull,
  Trophy,
  ShieldCheck,
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
const RED_DEEP = "#7f1d1d";
const AMBER = "#f59e0b";
const PANEL = "#0d0608";
const PANEL_2 = "#120a0d";
const HAIRLINE = "#331318";
const INK_DIM = "#8a8a93";
const INK_FAINT = "#55555e";

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
const statusColor = (s: string): string => STATUS_COLOR[s.toLowerCase()] ?? "#64748b";

const mins = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

export default function TvPage() {
  const [tvKey, setTvKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [data, setData] = useState<CommandCenterPayload | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const keyRef = useRef<string | null>(null);

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
      return;
    }
    try {
      setTvKey(localStorage.getItem(KEY_STORAGE));
    } catch {
      setTvKey(null);
    }
  }, []);

  useEffect(() => {
    keyRef.current = tvKey;
  }, [tvKey]);

  const load = useCallback(async () => {
    const key = keyRef.current;
    if (!key) return;
    try {
      const res = await fetch("/api/tv/command", { cache: "no-store", headers: { "x-tv-key": key } });
      if (res.status === 401 || res.status === 503) {
        setAuthFailed(true);
        return;
      }
      if (!res.ok) return; // keep last good data; staleness indicator handles it
      setData((await res.json()) as CommandCenterPayload);
      setAuthFailed(false);
      setLastOkAt(Date.now());
    } catch {
      /* network blip — keep last good data */
    }
  }, []);

  // Data refresh + clock + daily self-reload
  useEffect(() => {
    if (!tvKey) return;
    void load();
    const dataT = setInterval(() => void load(), REFRESH_MS);
    const clockT = setInterval(() => setNowTick(Date.now()), 1000);
    const reloadT = setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return () => {
      clearInterval(dataT);
      clearInterval(clockT);
      clearTimeout(reloadT);
    };
  }, [tvKey, load]);

  if (!tvKey || (authFailed && !data)) {
    return (
      <Shell>
        <div className="flex h-full flex-col items-center justify-center gap-[2vh]">
          <div
            className="flex h-[8vw] w-[8vw] items-center justify-center rounded-[1.5vw]"
            style={{ background: `linear-gradient(135deg, ${RED}, ${RED_DEEP})`, boxShadow: `0 0 6vw -1vw ${RED}` }}
          >
            <Activity className="h-[4vw] w-[4vw] text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-[2.6vw] font-black tracking-tight text-white">TRIAGEIT COMMAND</h1>
          <p className="text-[1.1vw]" style={{ color: INK_DIM }}>
            {authFailed ? "That access key was rejected — enter the current one." : "Enter the access key to bring the board online."}
          </p>
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
        </div>
      </Shell>
    );
  }

  const m = data?.metrics;
  const stale = lastOkAt > 0 && nowTick - lastOkAt > STALE_AFTER_MS;
  const clock = new Date(nowTick);
  const timeStr = clock.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  const dateStr = clock.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  const syncAgeSec = lastOkAt > 0 ? Math.floor((nowTick - lastOkAt) / 1000) : null;
  const breachAlarm = (m?.breaching ?? 0) > 0;

  return (
    <Shell>
      <div className="flex h-full flex-col gap-[1.2vh] p-[1.2vw]">
        {/* ── Header ── */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-[1vw]">
            <div
              className="flex h-[3.4vw] w-[3.4vw] items-center justify-center rounded-[0.7vw]"
              style={{ background: `linear-gradient(135deg, ${RED}, ${RED_DEEP})`, boxShadow: `0 0 2.5vw -0.6vw ${RED}` }}
            >
              <Activity className="h-[1.9vw] w-[1.9vw] text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-[1.7vw] font-black leading-none tracking-tight text-white">
                TRIAGEIT <span style={{ color: RED }}>COMMAND</span>
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
          <Kpi label="Unacked Replies" value={m?.unackedReplies} icon={MessageSquareWarning} accent={AMBER} alarm={(m?.unackedReplies ?? 0) > 0} />
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

        {/* ── Main grid ── */}
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-[0.8vw]">
          {/* Breach board */}
          <div className="col-span-5 flex min-h-0 flex-col gap-[0.8vw]">
            <Panel
              title="SLA Breaches — Live"
              icon={<TriangleAlert className="h-[1vw] w-[1vw]" style={{ color: RED }} />}
              alarm={breachAlarm}
              className="flex-1"
            >
              {!data ? (
                <Loading />
              ) : data.breaches.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-[1vh] py-[3vh]">
                  <ShieldCheck className="h-[3.5vw] w-[3.5vw]" style={{ color: "#22c55e" }} />
                  <span className="text-[1.6vw] font-black tracking-[0.2em] text-white">ALL CLEAR</span>
                  <span className="text-[0.85vw]" style={{ color: INK_DIM }}>No live SLA breaches</span>
                </div>
              ) : (
                <RowList
                  items={data.breaches.slice(0, 8).map((b) => ({
                    id: b.halo_id,
                    left: `${b.client_name ?? "Unknown"} — ${b.summary ?? ""}`,
                    who: b.halo_agent ?? "UNASSIGNED",
                    badge: b.breachingForMin !== null ? `BREACHED ${mins(b.breachingForMin)}` : `${b.alertCount}× ALERTED`,
                    badgeColor: RED,
                  }))}
                  more={data.breaches.length - 8}
                />
              )}
            </Panel>
            <Panel title="At Risk — SLA due soon" icon={<Timer className="h-[1vw] w-[1vw]" style={{ color: AMBER }} />}>
              {!data ? (
                <Loading />
              ) : data.atRisk.length === 0 ? (
                <Empty text="Nothing due in the next 2 hours." />
              ) : (
                <RowList
                  items={data.atRisk.slice(0, 5).map((t) => ({
                    id: t.halo_id,
                    left: `${t.client_name ?? "Unknown"} — ${t.summary ?? ""}`,
                    who: t.halo_agent ?? "UNASSIGNED",
                    badge: `DUE IN ${mins(t.dueInMin)}`,
                    badgeColor: AMBER,
                  }))}
                  more={data.atRisk.length - 5}
                />
              )}
            </Panel>
          </div>

          {/* Status + tech grid */}
          <div className="col-span-4 flex min-h-0 flex-col gap-[0.8vw]">
            <Panel title="Board by Status">
              {!data ? (
                <Loading />
              ) : (
                <div className="space-y-[0.9vh] px-[1vw] py-[1vh]">
                  {data.statusCounts.slice(0, 9).map((s) => {
                    const max = Math.max(1, ...data.statusCounts.map((x) => x.count));
                    return (
                      <div key={s.status} className="flex items-center gap-[0.7vw]">
                        <div className="w-[9vw] shrink-0 truncate text-[0.85vw] font-semibold text-zinc-300">{s.status}</div>
                        <div className="h-[1.5vh] flex-1 overflow-hidden rounded-full" style={{ background: "#1a0d10" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max(4, (s.count / max) * 100)}%`, background: statusColor(s.status) }} />
                        </div>
                        <span className="w-[2.2vw] text-right text-[1vw] font-black text-white" style={{ fontFamily: "var(--font-mono-tv), monospace" }}>
                          {s.count}
                        </span>
                        {s.breaching > 0 && (
                          <span className="rounded-full px-[0.5vw] py-[0.2vh] text-[0.65vw] font-bold text-white" style={{ background: RED }}>
                            {s.breaching}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
            <Panel title="Tech Load" className="flex-1">
              {!data ? (
                <Loading />
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[0.7vw] uppercase tracking-[0.1em]" style={{ color: INK_FAINT }}>
                      <th className="px-[1vw] py-[0.8vh] font-semibold">Tech</th>
                      <th className="py-[0.8vh] text-center font-semibold">Open</th>
                      <th className="py-[0.8vh] text-center font-semibold">Breach</th>
                      <th className="py-[0.8vh] text-center font-semibold">Owes Cust.</th>
                      <th className="px-[1vw] py-[0.8vh] text-center font-semibold">Unacked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.techStats.slice(0, 8).map((t) => (
                      <tr key={t.tech} className="border-t" style={{ borderColor: HAIRLINE }}>
                        <td className="truncate px-[1vw] py-[0.9vh] text-[0.95vw] font-bold text-white">{t.tech}</td>
                        <Num v={t.openTickets} />
                        <Num v={t.breaching} hot={RED} />
                        <Num v={t.waitingOnTech} hot="#fb923c" />
                        <td className="px-[1vw] py-[0.9vh] text-center text-[1vw] font-black" style={{ fontFamily: "var(--font-mono-tv), monospace", color: t.unackedReplies > 0 ? AMBER : INK_FAINT }}>
                          {t.unackedReplies}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>

          {/* Shame / Fame */}
          <div className="col-span-3 flex min-h-0 flex-col gap-[0.8vw]">
            <Panel title="Wall of Shame" icon={<Skull className="h-[1vw] w-[1vw]" style={{ color: RED }} />} alarm={(data?.wallOfShame.length ?? 0) > 0} className="flex-1">
              {!data ? (
                <Loading />
              ) : data.wallOfShame.length === 0 ? (
                <Empty text="Nobody on the wall. Clean board." />
              ) : (
                <Ranked items={data.wallOfShame.slice(0, 4)} color={RED} />
              )}
            </Panel>
            <Panel title="Wall of Fame" icon={<Trophy className="h-[1vw] w-[1vw]" style={{ color: "#facc15" }} />} className="flex-1">
              {!data ? <Loading /> : data.wallOfFame.length === 0 ? <Empty text="Earn it." /> : <Ranked items={data.wallOfFame.slice(0, 4)} color="#facc15" />}
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
      {children}
    </main>
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
  children,
}: {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly alarm?: boolean;
  readonly className?: string;
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
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

function RowList({
  items,
  more,
}: {
  readonly items: ReadonlyArray<{ readonly id: number; readonly left: string; readonly who: string; readonly badge: string; readonly badgeColor: string }>;
  readonly more: number;
}) {
  return (
    <div>
      {items.map((r) => (
        <div key={r.id} className="flex items-center gap-[0.7vw] border-b px-[1vw] py-[1vh] last:border-b-0" style={{ borderColor: "#1f0d11" }}>
          <span className="shrink-0 text-[0.95vw] font-bold text-white" style={{ fontFamily: "var(--font-mono-tv), monospace" }}>
            #{r.id}
          </span>
          <span className="min-w-0 flex-1 truncate text-[0.9vw] text-zinc-300">{r.left}</span>
          <span className="shrink-0 text-[0.8vw] font-semibold" style={{ color: INK_DIM }}>
            {r.who}
          </span>
          <span
            className="shrink-0 rounded-[0.4vw] px-[0.6vw] py-[0.3vh] text-[0.75vw] font-black tracking-wide text-white"
            style={{ background: r.badgeColor, fontFamily: "var(--font-mono-tv), monospace" }}
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

function Ranked({ items, color }: { readonly items: ReadonlyArray<{ readonly tech: string; readonly reasons: ReadonlyArray<string> }>; readonly color: string }) {
  return (
    <div>
      {items.map((w, i) => (
        <div key={w.tech} className="flex items-start gap-[0.7vw] border-b px-[1vw] py-[1.1vh] last:border-b-0" style={{ borderColor: "#1f0d11" }}>
          <span
            className="mt-[0.2vh] flex h-[1.6vw] w-[1.6vw] shrink-0 items-center justify-center rounded-full text-[0.8vw] font-black"
            style={{ background: i === 0 ? color : "transparent", border: i === 0 ? "none" : `1px solid ${HAIRLINE}`, color: i === 0 ? "#000" : INK_DIM }}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[1.05vw] font-black text-white">{w.tech}</div>
            {w.reasons.slice(0, 2).map((r) => (
              <div key={r} className="truncate text-[0.78vw]" style={{ color: INK_DIM }}>
                {r}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Num({ v, hot }: { readonly v: number; readonly hot?: string }) {
  return (
    <td className="py-[0.9vh] text-center text-[1vw] font-black" style={{ fontFamily: "var(--font-mono-tv), monospace", color: v > 0 && hot ? hot : v > 0 ? "#e4e4e7" : INK_FAINT }}>
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

function Empty({ text }: { readonly text: string }) {
  return (
    <div className="px-[1vw] py-[1.5vh] text-[0.9vw]" style={{ color: INK_DIM }}>
      {text}
    </div>
  );
}
