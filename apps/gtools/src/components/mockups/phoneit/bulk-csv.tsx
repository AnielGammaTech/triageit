const RESULTS = [
  { phone: "(239) 555-0148", name: "Dunder Mifflin Recept.", type: "Business", carrier: "Verizon", line: "Landline", ok: true },
  { phone: "(239) 555-0173", name: "Vance Refrigeration", type: "Business", carrier: "T-Mobile", line: "Mobile", ok: true },
  { phone: "(239) 555-0199", name: "Schrute Farms", type: "Business", carrier: "AT&T", line: "VoIP", ok: false },
] as const;

/** Signature screen: Bulk CSV (default view, unchanged). */
export function BulkCsvView({ accent }: { accent: string }) {
  return (
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
  );
}
