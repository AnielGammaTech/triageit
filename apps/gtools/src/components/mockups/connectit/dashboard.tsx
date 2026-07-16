import { accentVar } from "@/components/browser-frame";

const RUNS = [
  { connector: "HaloPSA", status: "Success", tone: "#17663a", bg: "#e7f7ec" },
  { connector: "Twilio Lookup", status: "Success", tone: "#17663a", bg: "#e7f7ec" },
  { connector: "Datto RMM", status: "Planned", tone: "#536278", bg: "#eef3fa" },
] as const;

/** Signature screen: Dashboard (default view, unchanged). */
export function DashboardView() {
  const accent = accentVar("connectit");
  return (
    <div className="flex flex-1 flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold">Dashboard</span>
        <span className="rounded-full px-2 py-0.5 text-[7px] font-semibold text-white" style={{ background: accent }}>
          Pull All
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: "API", value: "OK" },
          { label: "Database", value: "OK" },
          { label: "Live Connectors", value: "2/14" },
          { label: "Stored Records", value: "128k" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
            <span className="block text-[6.5px] font-medium text-[color:var(--mock-muted)]">{tile.label}</span>
            <span className="block text-[9px] font-semibold">{tile.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1.25fr_0.75fr] gap-1.5">
        <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Sync control</span>
            <span className="rounded-full px-1.5 py-0.5 text-[6.5px] font-medium" style={{ background: "#e7f7ec", color: "#17663a" }}>ready</span>
          </div>
          <span className="block text-[7px] text-[color:var(--mock-muted)]">Last sync: 4m ago</span>
        </div>
        <div className="rounded-lg border p-1.5" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
          <span className="mb-1 block text-[7px] font-medium uppercase tracking-wider text-[color:var(--mock-muted)]">Recent runs</span>
          <div className="flex flex-col gap-1">
            {RUNS.map((run) => (
              <div key={run.connector} className="flex items-center justify-between text-[7px]">
                <span className="truncate">{run.connector}</span>
                <span className="rounded-full px-1 py-0.5 font-medium" style={{ background: run.bg, color: run.tone }}>
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
