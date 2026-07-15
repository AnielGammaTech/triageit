const STAGES = [
  { name: "New", accent: "#0ea5e9", count: 8, total: "41k" },
  { name: "Contacted", accent: "#8b5cf6", count: 6, total: "38k" },
  { name: "Meeting", accent: "#f59e0b", count: 4, total: "29k" },
  { name: "Proposal", accent: "#6366f1", count: 3, total: "52k" },
  { name: "Negotiating", accent: "#06b6d4", count: 2, total: "24k" },
  { name: "Won", accent: "#10b981", count: 5, total: "68k" },
] as const;

const CARDS: Record<string, { name: string; owner: string; hot?: boolean; stale?: boolean }> = {
  New: { name: "Coastal Law", owner: "J", stale: true },
  Contacted: { name: "Acme Dental", owner: "B" },
  Meeting: { name: "Naples Realty", owner: "M", hot: true },
  Proposal: { name: "Coastal Law", owner: "J" },
  Negotiating: { name: "Acme Dental", owner: "B" },
  Won: { name: "Naples Realty", owner: "M" },
};

export function AccountitMockup() {
  const orange = "#f96302";
  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#f9fafb",
          "--mock-panel": "#ffffff",
          "--mock-panel-2": "#f3f4f6",
          "--mock-border": "#e5e7eb",
          "--mock-text": "#0f1729",
          "--mock-muted": "#6b7280",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: "#0f1729" }}>
        <div className="flex items-center gap-2">
          <span className="font-display text-[10px] font-bold">
            <span className="text-white">Quote</span>
            <span style={{ color: orange }}>IT</span>
          </span>
          <span className="hidden text-[7px] font-medium text-white/50 sm:inline">Dashboard · Quotes ·</span>
          <span className="hidden border-b text-[7px] font-semibold text-white sm:inline" style={{ borderColor: orange }}>
            CRM
          </span>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[7px] font-semibold text-white" style={{ background: `linear-gradient(90deg, ${orange}, #fb923c)` }}>
          + Add Lead
        </span>
      </div>

      <div className="flex items-center gap-2.5 border-b px-2.5 py-1 text-[7px] font-medium" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>
        <span>Active</span>
        <span className="border-b-2 pb-0.5" style={{ borderColor: orange, color: "var(--mock-text)" }}>
          Pipeline
        </span>
        <span>Inactive</span>
        <span>QBR</span>
      </div>

      <div className="flex flex-col gap-1.5 p-2 text-[color:var(--mock-text)]">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 text-[7px]">
            <span className="rounded border px-1 py-0.5" style={{ borderColor: "var(--mock-border)" }}>Q3 2026</span>
            <span className="rounded px-1 py-0.5 font-medium text-white" style={{ background: "#0f1729" }}>Board</span>
            <span className="rounded border px-1.5 py-0.5" style={{ borderColor: "#fdba74", color: orange, background: "#fff7ed" }}>3 stale</span>
          </div>
          <div className="flex items-center gap-2 text-[7px]" style={{ color: "var(--mock-muted)" }}>
            <span>Pipeline <b style={{ color: "var(--mock-text)" }}>$252k</b></span>
            <span>Forecast <b style={{ color: "var(--mock-text)" }}>$96k</b></span>
            <span>Won <b style={{ color: "#059669" }}>$68k</b></span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[6.5px]">
          <span className="rounded-full px-1.5 py-0.5 font-medium text-white" style={{ background: "#0f1729" }}>Open</span>
          <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>All</span>
          <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>Lost</span>
          <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: "#fecdd3", color: "#e11d48", background: "#fff1f2" }}>Hot</span>
        </div>

        <div className="flex gap-1 overflow-hidden">
          {STAGES.map((stage) => {
            const card = CARDS[stage.name];
            return (
              <div
                key={stage.name}
                className="flex min-w-0 flex-1 flex-col gap-1 rounded-md p-1"
                style={{ background: `linear-gradient(180deg, ${stage.accent}26, ${stage.accent}05)` }}
              >
                <div className="flex items-center justify-between gap-0.5">
                  <span className="truncate text-[6px] font-semibold" style={{ color: stage.accent }}>{stage.name}</span>
                  <span className="shrink-0 rounded-full px-1 text-[5.5px] font-medium text-white" style={{ background: stage.accent }}>{stage.count}</span>
                </div>
                <span className="text-[6px] font-medium" style={{ color: "var(--mock-muted)" }}>${stage.total}</span>
                {card ? (
                  <div
                    className="flex flex-col gap-0.5 rounded border bg-[color:var(--mock-panel)] p-1"
                    style={card.stale ? { borderColor: "#fb923c", boxShadow: "0 0 0 1px #fb923c" } : { borderColor: "var(--mock-border)" }}
                  >
                    <span className="truncate text-[6px] font-medium">{card.name}</span>
                    <div className="flex items-center justify-between">
                      <span className="flex size-2.5 items-center justify-center rounded-full text-[5px] font-semibold text-white" style={{ background: stage.accent }}>
                        {card.owner}
                      </span>
                      {card.hot ? <span className="text-[6px]">🔥</span> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
