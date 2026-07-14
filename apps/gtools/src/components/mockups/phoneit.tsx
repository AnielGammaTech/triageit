import { accentVar } from "@/components/browser-frame";

const RESULTS = [
  { phone: "(239) 555-0148", name: "Acme Dental Front Desk", type: "Business", carrier: "Verizon", line: "Landline", ok: true },
  { phone: "(239) 555-0173", name: "Coastal Law LLP", type: "Business", carrier: "T-Mobile", line: "Mobile", ok: true },
  { phone: "(239) 555-0199", name: "Naples Realty Group", type: "Business", carrier: "AT&T", line: "VoIP", ok: false },
] as const;

export function PhoneitMockup() {
  const accent = accentVar("phoneit");
  return (
    <div
      className="mock-root overflow-hidden rounded-md border"
      style={
        {
          "--mock-bg": "#0f1117",
          "--mock-panel": "#161b22",
          "--mock-panel-2": "#0f1117",
          "--mock-border": "#30363d",
          "--mock-text": "#e1e4e8",
          "--mock-muted": "#8b949e",
          borderColor: "var(--mock-border)",
          background: "var(--mock-bg)",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between border-b px-2.5 py-1.5" style={{ background: "var(--mock-panel)", borderColor: "var(--mock-border)" }}>
        <span className="font-display text-[10px] font-bold" style={{ color: "#58a6ff" }}>
          PhoneIT
        </span>
        <div className="flex items-center gap-1 text-[7px] font-medium">
          <span className="rounded-[6px] px-1.5 py-0.5 text-[color:var(--mock-muted)]">Single Lookup</span>
          <span className="rounded-[6px] px-1.5 py-0.5 text-white" style={{ background: accent }}>Bulk CSV</span>
          <span className="rounded-[6px] px-1.5 py-0.5 text-[color:var(--mock-muted)]">History</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
        <div className="rounded-lg border-2 border-dashed p-2 text-center" style={{ borderColor: "var(--mock-border)" }}>
          <span className="block text-[7.5px]">Drag &amp; drop a CSV file here, or click to select</span>
          <span className="block text-[6.5px] text-[color:var(--mock-muted)]">One phone number per row · max 500</span>
        </div>

        <div>
          <span className="block h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#21262d" }}>
            <span className="block h-full w-full rounded-full" style={{ background: accent }} />
          </span>
          <span className="mt-0.5 block text-[6.5px] text-[color:var(--mock-muted)]">Complete!</span>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-1.5 text-[8px]" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
          <span className="text-[color:var(--mock-muted)]">Total 500</span>
          <span className="text-[color:var(--mock-muted)]">Processed 500</span>
          <span style={{ color: "#3fb950" }}>Success 494</span>
          <span style={{ color: "#f85149" }}>Failed 6</span>
        </div>

        <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--mock-border)" }}>
          <div
            className="grid grid-cols-[1.2fr_1.4fr_0.8fr_0.9fr_0.9fr_0.7fr] gap-1 px-1.5 py-1 text-[6.5px] font-semibold uppercase tracking-wider"
            style={{ background: "var(--mock-panel)", color: "var(--mock-muted)" }}
          >
            <span>Phone</span>
            <span>Caller Name</span>
            <span>Type</span>
            <span>Carrier</span>
            <span>Line Type</span>
            <span>Status</span>
          </div>
          {RESULTS.map((row) => (
            <div
              key={row.phone}
              className="grid grid-cols-[1.2fr_1.4fr_0.8fr_0.9fr_0.9fr_0.7fr] gap-1 border-t px-1.5 py-1 text-[7.5px]"
              style={{ borderColor: "var(--mock-border)" }}
            >
              <span className="truncate">{row.phone}</span>
              <span className="truncate">{row.name}</span>
              <span className="truncate text-[color:var(--mock-muted)]">{row.type}</span>
              <span className="truncate text-[color:var(--mock-muted)]">{row.carrier}</span>
              <span className="truncate text-[color:var(--mock-muted)]">{row.line}</span>
              <span className="truncate font-medium" style={{ color: row.ok ? "#3fb950" : "#f85149" }}>
                {row.ok ? "OK" : "Failed"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
