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
  { name: "Acme Dental", tone: "#059669", services: 12, pct: 100, issues: 0 },
  { name: "Coastal Law", tone: "#EA580C", services: 9, pct: 62, issues: 2 },
  { name: "Naples Realty", tone: "#EC4899", services: 7, pct: 40, issues: 1 },
] as const;

export function LootitMockup() {
  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#F8FAFC",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#F8FAFC",
          "--mock-border": "#E5E7EB",
          "--mock-text": "#16181D",
          "--mock-muted": "#6b7280",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: "linear-gradient(90deg, #2E0820, #4A1035)" }}>
        <div className="flex items-center gap-2">
          <span
            className="flex size-3.5 items-center justify-center rounded-[3px] text-[7px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #4A1035, #2E0820)", boxShadow: "0 0 4px #F472B6" }}
          >
            L
          </span>
          <span className="font-display text-[10px] font-bold">
            <span style={{ color: "#F472B6", textShadow: "0 0 6px rgba(244,114,182,0.6)" }}>Loot</span>
            <span className="text-white">IT</span>
          </span>
          <span className="hidden text-[7px] font-medium text-white/60 sm:inline">Dashboard · KB · Settings</span>
          <span className="hidden text-[7px] text-white/35 sm:inline">↗ PortalIT</span>
        </div>
        <span className="hidden text-[6.5px] text-white/45 sm:inline">bryanna@gamma.tech</span>
      </div>

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
            <span className="truncate">Coastal Law · Datto RMM</span>
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
    </div>
  );
}
