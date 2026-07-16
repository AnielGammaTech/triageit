const FIELDS = [
  { label: "Caller Name", value: "Dunder Mifflin Recept." },
  { label: "Type", value: "Business" },
  { label: "Carrier", value: "Verizon" },
  { label: "Line Type", value: "Landline" },
] as const;

/** "Single Lookup" nav view — one-number instant lookup. */
export function SingleLookupView({ accent }: { accent: string }) {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center gap-1.5">
        <span
          className="flex-1 truncate rounded-lg border px-2 py-1 text-[8px]"
          style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}
        >
          (239) 555-0148
        </span>
        <span className="shrink-0 rounded-lg px-2 py-1 text-[8px] font-medium text-white" style={{ background: accent }}>
          Lookup
        </span>
      </div>
      <div className="rounded-lg border p-2" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map((f) => (
            <div key={f.label}>
              <span className="block text-[6.5px] uppercase tracking-wider text-[color:var(--mock-muted)]">{f.label}</span>
              <span className="block text-[8px] font-medium">{f.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
