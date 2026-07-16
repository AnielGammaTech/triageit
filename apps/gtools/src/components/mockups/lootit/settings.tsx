const RULES = [
  { name: "Datto RMM device count", tolerance: "±0 units", enabled: true },
  { name: "Cove backup seats", tolerance: "±1 unit", enabled: true },
  { name: "JumpCloud licenses", tolerance: "±0 units", enabled: false },
] as const;

/** "Settings" nav view — matching rules and anomaly alert thresholds. */
export function SettingsView() {
  return (
    <div className="flex flex-col gap-1.5 p-2.5 text-[color:var(--mock-text)]">
      <span className="text-[10px] font-semibold">Settings</span>
      <div className="rounded-md border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <span className="mb-1 block text-[6.5px] font-medium uppercase tracking-wider" style={{ color: "var(--mock-muted)" }}>
          Matching rules
        </span>
        <div className="flex flex-col gap-1">
          {RULES.map((r) => (
            <div key={r.name} className="flex items-center gap-1.5 text-[7px]">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: r.enabled ? "#EC4899" : "var(--mock-panel-2)", border: r.enabled ? "none" : "1px solid var(--mock-border)" }}
              />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="shrink-0 text-[6.5px]" style={{ color: "var(--mock-muted)" }}>{r.tolerance}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-md border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <span className="mb-1 block text-[6.5px] font-medium uppercase tracking-wider" style={{ color: "var(--mock-muted)" }}>
          Anomaly alerts
        </span>
        <div className="flex items-center justify-between text-[7px]">
          <span>Notify when spend changes by</span>
          <span className="font-semibold">$50 or 15%</span>
        </div>
      </div>
    </div>
  );
}
