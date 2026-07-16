const RUNS = [
  { connector: "HaloPSA", started: "3m ago", duration: "8s", status: "Success", tone: "#17663a", bg: "#e7f7ec" },
  { connector: "Twilio Lookup", started: "12m ago", duration: "22s", status: "Success", tone: "#17663a", bg: "#e7f7ec" },
  { connector: "JumpCloud", started: "1h ago", duration: "4s", status: "Failed", tone: "#aa2424", bg: "#fdecec" },
  { connector: "Datto RMM", started: "—", duration: "—", status: "Planned", tone: "#536278", bg: "#eef3fa" },
] as const;

/** "Sync Runs" nav view — every connector pull, audited. */
export function SyncRunsView() {
  return (
    <div className="flex flex-1 flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold">Sync Runs</span>
        <span className="text-[6.5px] text-[color:var(--mock-muted)]">Last 24h</span>
      </div>
      <div className="rounded-lg border" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {RUNS.map((run, i) => (
          <div
            key={run.connector}
            className={`flex items-center gap-2 px-2 py-1.5 text-[7.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate">{run.connector}</span>
            <span className="w-12 shrink-0 text-[color:var(--mock-muted)]">{run.started}</span>
            <span className="w-8 shrink-0 text-right text-[color:var(--mock-muted)]">{run.duration}</span>
            <span className="w-14 shrink-0 rounded-full px-1 py-0.5 text-center text-[6.5px] font-medium" style={{ background: run.bg, color: run.tone }}>
              {run.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
