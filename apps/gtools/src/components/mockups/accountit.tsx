const NAV = ["Dashboard", "Accounts", "QBR", "Pipeline", "Reports"] as const;

const STATS = [
  { label: "Active accounts", value: "42", caption: "9% have QBR history", icon: "◆", bg: "#eff6ff", fg: "#2563eb" },
  { label: "QBR actions", value: "6", caption: "Schedule, prep, or follow up", icon: "✓", bg: "#ecfdf5", fg: "#059669" },
  { label: "Open pipeline", value: "$96k", caption: "7 active opportunities", icon: "$", bg: "#fffbeb", fg: "#b45309" },
  { label: "Contract risk", value: "12", caption: "3 overdue · 4 due in 30d", icon: "!", bg: "#fef2f2", fg: "#dc2626" },
] as const;

const QBR_ROWS = [
  { name: "Dunder Mifflin", sub: "0/1 prep complete", pill: "Prep", overdue: false },
  { name: "Vance Refrigeration", sub: "51d past cadence", pill: "Overdue", overdue: true },
  { name: "Schrute Farms", sub: "0/1 prep complete", pill: "Prep", overdue: false },
] as const;

const STAGES = [
  { name: "New", count: 8, pct: 80 },
  { name: "Contacted", count: 6, pct: 62 },
  { name: "Meeting", count: 4, pct: 44 },
  { name: "Proposal", count: 3, pct: 30 },
  { name: "Negotiating", count: 2, pct: 18 },
] as const;

const CARD = { borderColor: "var(--mock-border)", background: "var(--mock-panel)" };

export function AccountitMockup() {
  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={{ "--mock-bg": "#f8fafc", "--mock-panel": "#ffffff", "--mock-panel-2": "#f1f5f9", "--mock-border": "#e2e8f0", "--mock-text": "#0f172a", "--mock-muted": "#64748b", borderColor: "var(--mock-border)", background: "var(--mock-bg)" } as React.CSSProperties}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5" style={{ background: "#1e2532" }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="relative flex size-4 shrink-0 items-center justify-center rounded-[5px] text-[8px] font-bold text-white" style={{ background: "#0f172a" }}>
              A<span className="absolute -right-px -top-px size-[3px] rounded-full" style={{ background: "#a5b4fc" }} />
            </span>
            <div className="flex flex-col leading-none">
              <span className="font-display text-[9px] font-bold text-white">AccountIT</span>
              <span className="text-[5.5px] font-semibold uppercase tracking-wider text-white/40">CRM</span>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-[6.5px] font-medium sm:flex">
            {NAV.map((item, i) => (
              <span key={item} className="rounded px-1 py-0.5" style={i === 0 ? { background: "rgba(255,255,255,0.1)", color: "#fff", boxShadow: "inset 0 -1.5px 0 #818cf8" } : { color: "rgba(255,255,255,0.45)" }}>
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-white px-1.5 py-0.5 text-[6.5px] font-semibold" style={{ color: "#1e2532" }}>QuoteIT ↗</span>
          <span className="flex size-3.5 items-center justify-center rounded-full text-[6px] font-semibold text-white" style={{ background: "#475569" }}>J</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-2.5 text-[color:var(--mock-text)]">
        <div className="rounded-xl border p-1.5" style={CARD}>
          <span className="block text-[6px] font-semibold uppercase tracking-wider text-[color:var(--mock-muted)]">Customer Success</span>
          <span className="block text-[10px] font-semibold">Dashboard</span>
          <span className="block text-[6.5px] text-[color:var(--mock-muted)]">What needs attention across accounts, QBRs, and pipeline.</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-xl border p-1.5" style={CARD}>
              <span className="mb-1 flex size-3.5 items-center justify-center rounded-md text-[7px] font-bold" style={{ background: s.bg, color: s.fg }}>{s.icon}</span>
              <span className="block text-[9px] font-semibold">{s.value}</span>
              <span className="block text-[6.5px] font-medium">{s.label}</span>
              <span className="block truncate text-[6px] text-[color:var(--mock-muted)]">{s.caption}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[1.3fr_0.9fr] gap-1.5">
          <div className="rounded-xl border p-1.5" style={CARD}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[6.5px] font-semibold uppercase tracking-wider text-[color:var(--mock-muted)]">QBR priorities</span>
              <span className="text-[6px] font-medium" style={{ color: "#6366f1" }}>View all →</span>
            </div>
            <div className="flex flex-col gap-1">
              {QBR_ROWS.map((r) => (
                <div key={r.name} className="flex items-center gap-1.5">
                  <span className="relative flex size-3.5 shrink-0 items-center justify-center rounded-md" style={{ background: r.overdue ? "#fef2f2" : "#f1f5f9" }}>
                    <span className="size-1.5 rounded-sm" style={{ background: r.overdue ? "#fca5a5" : "#94a3b8" }} />
                    {r.overdue ? <span className="absolute -right-0.5 -top-0.5 flex size-2 items-center justify-center rounded-full bg-rose-500 text-[5px] font-bold text-white">!</span> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[7px] font-medium">{r.name}</span>
                    <span className="block truncate text-[5.5px] text-[color:var(--mock-muted)]">{r.sub}</span>
                  </div>
                  <span className="shrink-0 rounded-full px-1 py-0.5 text-[5.5px] font-medium" style={r.overdue ? { background: "#fef2f2", color: "#dc2626" } : { background: "#f1f5f9", color: "#475569" }}>{r.pill}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border p-1.5" style={CARD}>
            <span className="mb-1 block text-[6.5px] font-semibold uppercase tracking-wider text-[color:var(--mock-muted)]">Pipeline snapshot</span>
            <div className="mb-1.5 grid grid-cols-2 gap-1">
              <div className="rounded-lg p-1" style={{ background: "var(--mock-panel-2)" }}>
                <span className="block text-[5px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Weighted forecast</span>
                <span className="block text-[8px] font-semibold">$96k</span>
              </div>
              <div className="rounded-lg p-1" style={{ background: "var(--mock-panel-2)" }}>
                <span className="block text-[5px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Win rate</span>
                <span className="block text-[8px] font-semibold">38%</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {STAGES.map((s) => (
                <div key={s.name} className="flex items-center gap-1 text-[5.5px]">
                  <span className="w-11 shrink-0 truncate text-[color:var(--mock-muted)]">{s.name}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "var(--mock-panel-2)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${s.pct}%`, background: "#6366f1" }} />
                  </span>
                  <span className="w-2.5 shrink-0 text-right font-medium">{s.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 flex items-center justify-between border-t pt-1" style={{ borderColor: "var(--mock-border)" }}>
              <span className="text-[5px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Next deal</span>
              <span className="text-[6px] font-semibold">Athlead · $18k</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
