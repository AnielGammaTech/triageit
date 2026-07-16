const STATS = [
  { label: "Incidents (30d)", value: "14" },
  { label: "Remediated", value: "11" },
  { label: "Avg dwell time", value: "1h 42m" },
  { label: "Active tenants", value: "6" },
] as const;

const BY_SEVERITY = [
  { label: "Critical", value: 2, tone: "#dc2626" },
  { label: "High", value: 5, tone: "#c2410c" },
  { label: "Medium", value: 4, tone: "#b45309" },
  { label: "Low", value: 3, tone: "#475569" },
] as const;

/** "Reporting" nav view — no charts, per the app's strict severity-color,
 * chart-free UI spec: plain stat tiles + a numeric breakdown table. */
export function ReportingView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <span className="text-[10px] font-semibold">Reporting — last 30 days</span>
      <div className="grid grid-cols-4 gap-1.5">
        {STATS.map((s) => (
          <div key={s.label} className="border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="block text-[6.5px] font-medium text-[color:var(--mock-muted)]">{s.label}</span>
            <span className="block text-[9px] font-semibold">{s.value}</span>
          </div>
        ))}
      </div>
      <div className="border p-2" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <span className="mb-1.5 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
          Incidents by severity
        </span>
        <div className="flex flex-col gap-1">
          {BY_SEVERITY.map((row) => (
            <div key={row.label} className="flex items-center gap-1.5 text-[7.5px]">
              <span className="w-12 shrink-0 text-[color:var(--mock-muted)]">{row.label}</span>
              <span className="flex-1" />
              <span className="shrink-0 rounded-none px-1 py-0.5 font-medium" style={{ color: row.tone }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
