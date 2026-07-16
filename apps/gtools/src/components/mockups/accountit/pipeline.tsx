const DEALS = [
  { name: "Athlead — Network Expansion", stage: "Negotiating", value: "$18,000", tone: "#6366f1" },
  { name: "WUPHF.com — Backup Migration", stage: "Proposal", value: "$9,400", tone: "#0ea5e9" },
  { name: "Schrute Farms — Security Audit", stage: "Meeting", value: "$4,200", tone: "#f59e0b" },
] as const;

const CARD = { borderColor: "var(--mock-border)", background: "var(--mock-panel)" };

/** "Pipeline" nav view — open deals, stage and value. */
export function PipelineView() {
  return (
    <div className="flex flex-col gap-1.5 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Pipeline</span>
        <span className="text-[6.5px] text-[color:var(--mock-muted)]">$96k weighted · 38% win rate</span>
      </div>
      <div className="rounded-xl border" style={CARD}>
        {DEALS.map((d, i) => (
          <div
            key={d.name}
            className={`flex items-center gap-2 px-2 py-1.5 text-[7.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span
              className="w-16 shrink-0 rounded-full px-1 py-0.5 text-center text-[6px] font-medium"
              style={{ background: "var(--mock-panel-2)", color: d.tone }}
            >
              {d.stage}
            </span>
            <span className="w-10 shrink-0 text-right font-semibold">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
