const CODES = [
  { number: "+1 (239) 555-0142", code: "482 913", received: "12s ago" },
  { number: "+1 (239) 555-0187", code: "719 305", received: "4m ago" },
  { number: "+1 (239) 555-0142", code: "550 221", received: "22m ago" },
] as const;

/** "TextIT" nav view — the shared MFA inbox: SMS codes forwarded to Teams. */
export function TextitView() {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-[color:var(--mock-text)]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">TextIT — shared MFA inbox</span>
        <span className="rounded-full px-1.5 py-0.5 text-[6.5px] font-medium" style={{ background: "#ecfdf5", color: "#059669" }}>
          Live
        </span>
      </div>
      <div className="rounded-xl border bg-[color:var(--mock-panel)] shadow-sm" style={{ borderColor: "var(--mock-border)" }}>
        {CODES.map((c, i) => (
          <div
            key={c.received}
            className={`flex items-center gap-2 px-1.5 py-1.5 text-[7.5px] ${i > 0 ? "border-t" : ""}`}
            style={{ borderColor: "var(--mock-panel-2)" }}
          >
            <span className="min-w-0 flex-1 truncate text-[color:var(--mock-muted)]">{c.number}</span>
            <span className="shrink-0 font-mono font-semibold">{c.code}</span>
            <span className="shrink-0 text-[6.5px] text-[color:var(--mock-muted)]">{c.received}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
