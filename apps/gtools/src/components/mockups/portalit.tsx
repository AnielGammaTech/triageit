interface Metric {
  readonly label: string;
  readonly value: string;
  readonly tone: string;
  readonly bg: string;
}

const METRICS: readonly Metric[] = [
  { label: "Active customers", value: "58", tone: "#5b21b6", bg: "#f5f3ff" },
  { label: "Monthly revenue", value: "$48.2k", tone: "#059669", bg: "#ecfdf5" },
  { label: "Active contracts", value: "71", tone: "#2563eb", bg: "#eff6ff" },
  { label: "Reconciliation health", value: "94%", tone: "#b45309", bg: "#fffbeb" },
];

const CUSTOMERS = [
  { name: "Acme Dental", pct: 100, tone: "#059669", status: "Reconciled" },
  { name: "Coastal Law", pct: 62, tone: "#e11d48", status: "Under-billed" },
  { name: "Naples Realty", pct: 100, tone: "#059669", status: "Reconciled" },
] as const;

export function PortalitMockup() {
  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#f8fafc",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#f1f5f9",
          "--mock-border": "#e2e8f0",
          "--mock-text": "#0f172a",
          "--mock-muted": "#64748b",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-3 px-2.5 py-1.5" style={{ background: "#0f172a" }}>
        <span className="font-display text-[10px] font-bold">
          <span className="text-white">Portal</span>
          <span style={{ color: "#a78bfa" }}>IT</span>
        </span>
        <div className="flex items-center gap-2.5 text-[7px] font-medium">
          <span className="border-b-2 pb-0.5 text-white" style={{ borderColor: "#a78bfa" }}>Dashboard</span>
          <span style={{ color: "rgba(255,255,255,0.55)" }}>Customers</span>
          <span className="rounded px-1 py-0.5" style={{ color: "#f9a8d4", boxShadow: "0 0 6px rgba(244,114,182,0.5)" }}>LootIT</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
        <div className="grid grid-cols-4 gap-1.5">
          {METRICS.map((m) => (
            <div key={m.label} className="rounded-xl p-1.5" style={{ background: m.bg }}>
              <span className="block text-[7px] font-medium" style={{ color: m.tone }}>
                {m.label}
              </span>
              <span className="block text-[9px] font-semibold">{m.value}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1.35fr_0.65fr] gap-1.5">
          <div className="rounded-xl border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
              Customer accounts
            </span>
            <div className="flex flex-col gap-1.5">
              {CUSTOMERS.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5">
                  <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[6px] font-semibold text-white" style={{ background: "#5b21b6" }}>
                    {c.name[0]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[8px]">{c.name}</span>
                  <span className="h-1 w-8 overflow-hidden rounded-full" style={{ background: "var(--mock-panel-2)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${c.pct}%`, background: c.tone }} />
                  </span>
                  <span className="shrink-0 rounded-full border px-1 py-0.5 text-[6px] font-medium" style={{ borderColor: c.tone, color: c.tone }}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="rounded-xl border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
              <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
                Billing reconciliation
              </span>
              <div className="flex justify-between text-[8px]">
                <span>Health <b>94%</b></span>
                <span className="text-rose-500">Under $940</span>
              </div>
            </div>
            <div className="rounded-xl border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
              <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
                Recent syncs
              </span>
              <span className="block text-[8px]">Pax8 · 2m ago <span className="text-emerald-500">OK</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
