const STATS = [
  { label: "Open quotes", value: "12" },
  { label: "Accepted (30d)", value: "7" },
  { label: "Win rate", value: "48%" },
  { label: "Pipeline value", value: "$96k" },
] as const;

/** "Dashboard" nav view — quote pipeline at a glance. */
export function DashboardView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <span className="text-[10px] font-semibold">Dashboard</span>
      <div className="grid grid-cols-4 gap-1.5">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="block text-[6.5px] font-medium text-[color:var(--mock-muted)]">{s.label}</span>
            <span className="block text-[9px] font-semibold">{s.value}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">
          Next to follow up
        </span>
        <div className="flex items-center justify-between text-[7.5px]">
          <span>Q-2031 · Athlead</span>
          <span style={{ color: "var(--mock-muted)" }}>Viewed 2d ago</span>
        </div>
      </div>
    </div>
  );
}
