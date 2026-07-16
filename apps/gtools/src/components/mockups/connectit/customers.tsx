const CUSTOMERS = [
  { name: "Dunder Mifflin", contacts: 12, phones: 8, source: "HaloPSA" },
  { name: "Vance Refrigeration", contacts: 6, phones: 4, source: "HaloPSA" },
  { name: "Schrute Farms", contacts: 3, phones: 2, source: "HaloPSA" },
] as const;

/** "Customers" nav view — canonical customer records normalized across
 * source systems. */
export function CustomersView() {
  return (
    <div className="flex flex-1 flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold">Customers</span>
        <span className="text-[6.5px] text-[color:var(--mock-muted)]">58 normalized</span>
      </div>
      <div className="rounded-lg border" style={{ borderColor: "var(--mock-border)", background: "var(--mock-panel)" }}>
        {CUSTOMERS.map((c, i) => (
          <div
            key={c.name}
            className={`flex items-center gap-2 px-2 py-1.5 text-[7.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
            <span className="w-16 shrink-0 text-right text-[color:var(--mock-muted)]">{c.contacts} contacts</span>
            <span className="w-14 shrink-0 text-right text-[color:var(--mock-muted)]">{c.phones} phones</span>
            <span className="w-14 shrink-0 rounded-full px-1 py-0.5 text-center text-[6.5px] font-medium" style={{ background: "#eef3fa", color: "#536278" }}>
              {c.source}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
