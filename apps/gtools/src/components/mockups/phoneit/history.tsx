const HISTORY = [
  { phone: "(239) 555-0148", by: "jim", when: "2m ago" },
  { phone: "(239) 555-0173", by: "pam", when: "18m ago" },
  { phone: "(239) 555-0199", by: "dwight", when: "1h ago" },
] as const;

/** "History" nav view — team-wide searchable lookup history. */
export function HistoryView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">Team History</span>
        <span className="rounded-md border px-1.5 py-0.5 text-[7px]" style={{ borderColor: "var(--mock-border)", color: "var(--mock-muted)" }}>
          Search…
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--mock-border)" }}>
        {HISTORY.map((h, i) => (
          <div
            key={`${h.phone}-${i}`}
            className="flex items-center gap-2 border-t px-1.5 py-1 text-[7.5px] first:border-t-0"
            style={{ borderColor: "var(--mock-border)" }}
          >
            <span className="min-w-0 flex-1 truncate">{h.phone}</span>
            <span className="shrink-0 text-[color:var(--mock-muted)]">{h.by}</span>
            <span className="shrink-0 text-[color:var(--mock-muted)]">{h.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
