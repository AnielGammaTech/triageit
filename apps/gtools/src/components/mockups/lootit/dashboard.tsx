const STATS = [
  { label: "Customers", value: "58", tone: "#111827" },
  { label: "Matched", value: "41", tone: "#059669" },
  { label: "Under", value: "6", tone: "#DB2777" },
  { label: "Over", value: "3", tone: "#EA580C" },
  { label: "Issues", value: "9", tone: "#DC2626" },
  { label: "Signed Off", value: "38", tone: "#2563EB" },
  { label: "Pending", value: "11", tone: "#B45309" },
  { label: "Anomalies", value: "2", tone: "#7C3AED" },
] as const;

const CUSTOMERS = [
  { name: "Dunder Mifflin", tone: "#059669", services: 12, pct: 100, issues: 0 },
  { name: "Vance Refrigeration", tone: "#EA580C", services: 9, pct: 62, issues: 2 },
  { name: "Schrute Farms", tone: "#EC4899", services: 7, pct: 40, issues: 1 },
] as const;

/** Signature screen: Dashboard (default view, unchanged). */
export function DashboardView() {
  return (
    <div className="flex flex-col gap-1.5 p-2 text-[color:var(--mock-text)]">
      <div className="grid grid-cols-8 gap-0.5">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-md border px-0.5 py-1" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="block truncate text-center text-[5px] font-medium" style={{ color: "var(--mock-muted)" }}>{s.label}</span>
            <span className="block text-center text-[7.5px] font-bold" style={{ color: s.tone }}>{s.value}</span>
          </div>
        ))}
      </div>

      <div className="rounded-md border p-1.5" style={{ borderColor: "#fecaca", background: "#fef2f2" }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[7px] font-semibold" style={{ color: "#b91c1c" }}>⌄ ⚠ Billing Anomalies</span>
          <span className="text-[6.5px]" style={{ color: "#b91c1c" }}>2 flagged</span>
        </div>
        <div className="flex items-center justify-between text-[6.5px]">
          <span className="truncate">Vance Refrigeration · Datto RMM</span>
          <span style={{ color: "#b91c1c" }}>+38% · $420 → $580</span>
        </div>
      </div>

      <div className="flex items-center gap-1 text-[6.5px]">
        <span className="rounded-full px-1.5 py-0.5 font-medium text-white" style={{ background: "#EC4899" }}>All</span>
        <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>Issues</span>
        <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>Matched</span>
        <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>Signed Off</span>
        <span className="ml-auto rounded-full border px-1.5 py-0.5" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>Report 38/58</span>
      </div>

      <div className="rounded-md border" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {CUSTOMERS.map((c, i) => (
          <div
            key={c.name}
            className={`flex items-center gap-1.5 px-1.5 py-1 text-[6.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.tone }} />
            <span className="min-w-0 flex-1 truncate font-medium">
              {c.name} <span style={{ color: "var(--mock-muted)" }}>↗</span>
            </span>
            <span className="shrink-0" style={{ color: "var(--mock-muted)" }}>{c.services} svc</span>
            <span className="h-1 w-6 shrink-0 overflow-hidden rounded-full" style={{ background: "#f1f5f9" }}>
              <span className="block h-full rounded-full" style={{ width: `${c.pct}%`, background: c.tone }} />
            </span>
            {c.issues > 0 ? (
              <span className="shrink-0 rounded-full px-1 py-0.5 font-medium text-white" style={{ background: "#DC2626" }}>{c.issues}</span>
            ) : (
              <span className="shrink-0 rounded-full px-1 py-0.5 font-medium" style={{ background: "#ecfdf5", color: "#059669" }}>OK</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
