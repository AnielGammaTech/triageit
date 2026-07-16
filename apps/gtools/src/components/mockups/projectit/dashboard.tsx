const STATS = [
  { label: "Tasks due today", value: "6", tone: "#0069af" },
  { label: "Overdue", value: "2", tone: "#dc2626" },
  { label: "Hours logged (wk)", value: "132.5", tone: "#10b981" },
  { label: "Open projects", value: "9", tone: "#f59e0b" },
] as const;

const PROJECTS = [
  { name: "Dunder Mifflin — Office Refresh", pct: 72 },
  { name: "Schrute Farms — Onboarding", pct: 18 },
  { name: "Vance Refrigeration — Mail Migration", pct: 91 },
] as const;

/** "Dashboard" nav view — role-based KPI overview. */
export function DashboardView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <span className="text-[10px] font-semibold">Dashboard</span>
      <div className="grid grid-cols-4 gap-1.5">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-lg border bg-[color:var(--mock-panel)] p-1.5" style={{ borderColor: "var(--mock-border)" }}>
            <span className="block text-[6.5px] font-medium text-[color:var(--mock-muted)]">{s.label}</span>
            <span className="block text-[9px] font-semibold" style={{ color: s.tone }}>{s.value}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-[color:var(--mock-panel)] p-1.5" style={{ borderColor: "var(--mock-border)" }}>
        <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
          Active projects
        </span>
        <div className="flex flex-col gap-1">
          {PROJECTS.map((p) => (
            <div key={p.name} className="flex items-center gap-1.5 text-[7.5px]">
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--mock-panel-2)" }}>
                <span className="block h-full rounded-full" style={{ width: `${p.pct}%`, background: "#0069af" }} />
              </span>
              <span className="w-6 shrink-0 text-right font-medium text-[color:var(--mock-muted)]">{p.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
