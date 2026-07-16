const SLA_ITEMS = [
  { id: "#4816", client: "Schrute Farms", remaining: "-0:42", status: "Breached", color: "#ef4444" },
  { id: "#4821", client: "Dunder Mifflin", remaining: "0:18", status: "At Risk", color: "#f59e0b" },
  { id: "#4795", client: "Michael Scott Paper Co.", remaining: "1:05", status: "On Track", color: "#10b981" },
] as const;

/** "SLA Hunter" nav view — scans open tickets against their SLA clocks. */
export function SlaHunterView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="font-display text-[11px] font-semibold">SLA Hunter</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[7px] font-medium"
          style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}
        >
          1 breached
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {SLA_ITEMS.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-lg border p-1.5 text-[8px]"
            style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}
          >
            <span className="font-mono text-[color:var(--mock-muted)]">{s.id}</span>
            <span className="min-w-0 flex-1 truncate">{s.client}</span>
            <span className="font-mono" style={{ color: s.color }}>{s.remaining}</span>
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-medium"
              style={{ background: `color-mix(in srgb, ${s.color} 18%, transparent)`, color: s.color }}
            >
              {s.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
